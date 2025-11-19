import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { microsoftGraphClient } from '../lib/microsoft-graph'

const router = Router()

// Get all projects
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      role: true,
      department: true,
    },
  })

  if (!currentUser) {
    return res.status(404).json({ error: 'User not found' })
  }

  const isSuperAdmin = currentUser.role?.toLowerCase() === 'superadmin'
  let whereClause: Record<string, unknown> | undefined = undefined

  if (!isSuperAdmin) {
    const orConditions: Record<string, unknown>[] = []
    if (currentUser.department) {
      orConditions.push({ department: currentUser.department })
    }
    orConditions.push({
      members: {
        some: {
          userId: req.userId,
        },
      },
    })
    if (orConditions.length === 1) {
      whereClause = orConditions[0]
    } else if (orConditions.length > 1) {
      whereClause = { OR: orConditions }
    }
  }

  try {
    // Try the full query first
    let projects
    try {
      projects = await prisma.project.findMany({
        where: whereClause,
        include: {
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          _count: {
            select: {
              tasks: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      })
    } catch (queryError: any) {
      // If the query fails, try a simpler version
      console.warn('Full query failed, trying simpler query:', queryError.message)
      projects = await prisma.project.findMany({
        where: whereClause,
        include: {
          _count: {
            select: {
              tasks: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      })
      
      // Manually fetch members for each project
      projects = await Promise.all(
        projects.map(async (project: any) => {
          try {
            const members = await prisma.projectMember.findMany({
              where: {
                projectId: project.id,
              },
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            })
            return {
              ...project,
              members,
            }
          } catch {
            return {
              ...project,
              members: [],
            }
          }
        })
      )
    }

    res.json(projects)
  } catch (error: any) {
    console.error('Error fetching projects:', error)
    console.error('Error stack:', error.stack)
    console.error('Error details:', JSON.stringify(error, null, 2))
    
    // If error is due to inconsistent relations, try fetching without user relation
    if (error.message?.includes('Inconsistent query result') || error.message?.includes('Field user is required')) {
      try {
        const projects = await prisma.project.findMany({
          where: whereClause,
          include: {
            members: {
              select: {
                id: true,
                projectId: true,
                userId: true,
                role: true,
                joinedAt: true,
              },
            },
            _count: {
              select: {
                tasks: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        })

        // Manually fetch users for each member
        const projectsWithUsers = await Promise.all(
          projects.map(async (project: any) => {
            const membersWithUsers = await Promise.all(
              project.members.map(async (member: any) => {
                if (!member.userId) return null
                try {
                  const user = await prisma.user.findUnique({
                    where: { id: member.userId },
                    select: {
                      id: true,
                      name: true,
                      email: true,
                    },
                  })
                  if (!user) return null
                  return {
                    ...member,
                    user,
                  }
                } catch {
                  return null
                }
              })
            )
            return {
              ...project,
              members: membersWithUsers.filter((m: any) => m !== null) as any,
            }
          })
        )

        res.json(projectsWithUsers)
        return
      } catch (fallbackError: any) {
        console.error('Fallback query also failed:', fallbackError)
        console.error('Fallback error stack:', fallbackError.stack)
        res.status(500).json({ 
          error: 'Internal server error',
          message: fallbackError.message || 'Failed to fetch projects',
          details: process.env.NODE_ENV === 'development' ? fallbackError.stack : undefined
        })
        return
      }
    }
    
    // Return more detailed error in development
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message || 'Failed to fetch projects',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
})

// Get single project
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        role: true,
        department: true,
      },
    })

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' })
    }

    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        tasks: {
          include: {
            assignees: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        _count: {
          select: {
            tasks: true,
          },
        },
      },
    })

    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const isSuperAdmin = currentUser.role?.toLowerCase() === 'superadmin'
    const isMember = project.members.some((member) => member.userId === req.userId)
    const hasDepartmentAccess =
      !!currentUser.department &&
      !!project.department &&
      currentUser.department === project.department

    if (!isSuperAdmin && !isMember && !hasDepartmentAccess) {
      return res.status(403).json({ error: 'You do not have access to this project' })
    }

    // Filter out members with null users (orphaned records)
    const cleanedProject = {
      ...project,
      members: project.members.filter((member: any) => member.user !== null),
      tasks: project.tasks.map((task: any) => ({
        ...task,
        assignees: task.assignees.filter((assignee: any) => assignee.user !== null),
      })),
    }

    res.json(cleanedProject)
  } catch (error) {
    console.error('Error fetching project:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create project
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { name, description, brand, company, status } = req.body

    if (!name) {
      return res.status(400).json({ error: 'Name is required' })
    }

    // Verify user exists before creating project
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
    })

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const project = await prisma.project.create({
      data: {
        name,
        description: description || null,
        brand: brand || null,
        company: company || null,
        status: status || 'ACTIVE',
        department: user.department || null,
        createdById: req.userId,
        members: {
          create: {
            userId: req.userId,
            role: 'owner',
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        _count: {
          select: {
            tasks: true,
          },
        },
      },
    })

    // Filter out members with null users (shouldn't happen for new projects, but defensive)
    const cleanedProject = {
      ...project,
      members: project.members.filter((member: any) => member.user !== null),
    }

    res.status(201).json(cleanedProject)
  } catch (error: any) {
    console.error('Error creating project:', error)
    const errorMessage = error.message || 'Internal server error'
    res.status(500).json({ error: errorMessage })
  }
})

// Update project
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, brand, company, status } = req.body

    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description: description || null }),
        ...(brand !== undefined && { brand: brand || null }),
        ...(company !== undefined && { company: company || null }),
        ...(status && { status }),
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        _count: {
          select: {
            tasks: true,
          },
        },
      },
    })

    // Filter out members with null users (orphaned records)
    const cleanedProject = {
      ...project,
      members: project.members.filter((member: any) => member.user !== null),
    }

    res.json(cleanedProject)
  } catch (error: any) {
    console.error('Error updating project:', error)
    const errorMessage = error.message || 'Internal server error'
    res.status(500).json({ error: errorMessage })
  }
})

// Delete project
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.project.delete({
      where: { id: req.params.id },
    })

    res.json({ message: 'Project deleted successfully' })
  } catch (error) {
    console.error('Error deleting project:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Helper function to sanitize ID arrays
const sanitizeIdArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

// Bulk collaboration for multiple projects and members
router.post('/collaborations/request', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const projectIds = sanitizeIdArray(req.body?.projectIds)
    const memberIds = sanitizeIdArray(req.body?.memberIds)
    const manualEmails = Array.isArray(req.body?.manualEmails) 
      ? req.body.manualEmails.filter((email: any): email is string => typeof email === 'string' && email.trim().length > 0 && email.includes('@'))
      : []
    const requestedRole = typeof req.body?.role === 'string' ? req.body.role.toLowerCase() : 'member'
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : undefined

    if (projectIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one project for collaboration.' })
    }

    if (memberIds.length === 0 && manualEmails.length === 0) {
      return res.status(400).json({ error: 'Please select at least one team member or add an email address to collaborate with.' })
    }

    // Get current user with role to check permissions
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true, email: true, role: true, department: true },
    })

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' })
    }

    const isSuperAdmin = currentUser.role?.toLowerCase() === 'superadmin'
    const isAdmin = isSuperAdmin || currentUser.role?.toLowerCase() === 'admin'

    // Build where clause - superadmin/admin can access all projects
    const projectWhereClause: any = { id: { in: projectIds } }
    if (!isSuperAdmin && !isAdmin) {
      projectWhereClause.OR = [
        { createdById: req.userId },
        { members: { some: { userId: req.userId, role: 'owner' } } },
      ]
    }

    const [requester, projects, members] = await Promise.all([
      Promise.resolve(currentUser), // Use currentUser as requester
      prisma.project.findMany({
        where: projectWhereClause,
        include: {
          members: {
            select: {
              userId: true,
            },
          },
        },
      }),
      prisma.user.findMany({
        where: {
          id: { in: memberIds },
          isActive: true,
        },
        select: { id: true, name: true, email: true },
      }),
    ])

    const memberLookup = new Map(members.map((member) => [member.id, member]))
    const inaccessibleProjectCount = projectIds.length - projects.length

    if (projects.length === 0) {
      // Provide more helpful error message
      if (inaccessibleProjectCount > 0 && !isSuperAdmin && !isAdmin) {
        return res.status(403).json({ 
          error: 'You do not have permission to collaborate on the selected projects. Only project creators or owners can invite collaborators.' 
        })
      }
      return res.status(403).json({ error: 'No selected projects are available for collaboration.' })
    }

    const results: {
      memberId: string
      memberName: string
      memberEmail: string
      action: 'created' | 'updated' | 'skipped'
      projectCount: number
      note?: string
    }[] = []

    for (const memberId of memberIds) {
      const member = memberLookup.get(memberId)
      if (!member) {
        results.push({
          memberId,
          memberName: '',
          memberEmail: '',
          action: 'skipped',
          projectCount: 0,
          note: 'User not found or inactive',
        })
        continue
      }

      if (memberId === req.userId) {
        results.push({
          memberId,
          memberName: member.name || '',
          memberEmail: member.email,
          action: 'skipped',
          projectCount: 0,
          note: 'Cannot send collaboration request to yourself',
        })
        continue
      }

      const shareableProjectIds = projects
        .filter((project) => project.createdById !== memberId && !project.members.some((m) => m.userId === memberId))
        .map((project) => project.id)

      if (shareableProjectIds.length === 0) {
        results.push({
          memberId,
          memberName: member.name || '',
          memberEmail: member.email,
          action: 'skipped',
          projectCount: 0,
          note: 'Member already has access to all selected projects',
        })
        continue
      }

      // Add members to projects
      let addedCount = 0
      for (const projectId of shareableProjectIds) {
        try {
          await prisma.projectMember.upsert({
            where: {
              projectId_userId: {
                projectId,
                userId: memberId,
              },
            },
            update: {
              role: requestedRole,
            },
            create: {
              projectId,
              userId: memberId,
              role: requestedRole,
            },
          })
          addedCount++
        } catch (error: any) {
          console.error(`Error adding member ${memberId} to project ${projectId}:`, error)
        }
      }

      // Create notification
      await prisma.notification.create({
        data: {
          userId: memberId,
          type: 'PROJECT_INVITE',
          title: 'Project Collaboration Invitation',
          message: `${requester?.name || requester?.email || 'A teammate'} invited you to collaborate on ${addedCount} project${addedCount > 1 ? 's' : ''}.`,
          link: `/projects`,
        },
      })

      results.push({
        memberId,
        memberName: member.name || '',
        memberEmail: member.email,
        action: 'created',
        projectCount: addedCount,
      })
    }

    // Handle manual emails (for admin to add other department employees)
    const emailResults: {
      email: string
      action: 'sent' | 'skipped'
      note?: string
    }[] = []

    if (manualEmails.length > 0 && projects.length > 0) {
      const projectNames = projects.map(p => p.name).join(', ')
      const emailSubject = `Project Collaboration Invitation - ${projectNames}`
      const emailBody = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #006ba6;">Project Collaboration Invitation</h2>
          <p>Hello,</p>
          <p>${requester?.name || requester?.email || 'A teammate'} has invited you to collaborate on the following project(s):</p>
          <ul>
            ${projects.map(p => `<li><strong>${p.name}</strong>${p.description ? ` - ${p.description}` : ''}</li>`).join('')}
          </ul>
          <p>You will have access to view and collaborate on these projects.</p>
          <p>Please log in to your account to access these projects.</p>
          <p>Best regards,<br>Project Management Team</p>
        </div>
      `

      for (const email of manualEmails) {
        try {
          // Check if user exists with this email
          const existingUser = await prisma.user.findUnique({
            where: { email: email.toLowerCase().trim() },
            select: { id: true },
          })

          if (existingUser) {
            // User exists - add them to projects
            let addedCount = 0
            for (const projectId of projectIds) {
              try {
                await prisma.projectMember.upsert({
                  where: {
                    projectId_userId: {
                      projectId,
                      userId: existingUser.id,
                    },
                  },
                  update: {
                    role: requestedRole,
                  },
                  create: {
                    projectId,
                    userId: existingUser.id,
                    role: requestedRole,
                  },
                })
                addedCount++
              } catch (error: any) {
                console.error(`Error adding user ${existingUser.id} to project ${projectId}:`, error)
              }
            }

            // Create notification
            await prisma.notification.create({
              data: {
                userId: existingUser.id,
                type: 'PROJECT_INVITE',
                title: 'Project Collaboration Invitation',
                message: `${requester?.name || requester?.email || 'A teammate'} invited you to collaborate on ${addedCount} project${addedCount > 1 ? 's' : ''}.`,
                link: `/projects`,
              },
            })

            emailResults.push({
              email,
              action: 'sent',
            })
          } else {
            // User doesn't exist - send invitation email
            try {
              await microsoftGraphClient.sendEmail([email], null, emailSubject, emailBody)
              emailResults.push({
                email,
                action: 'sent',
                note: 'Invitation email sent (user not in system)',
              })
            } catch (emailError: any) {
              console.error(`Error sending email to ${email}:`, emailError)
              emailResults.push({
                email,
                action: 'skipped',
                note: 'Failed to send invitation email',
              })
            }
          }
        } catch (error: any) {
          console.error(`Error processing manual email ${email}:`, error)
          emailResults.push({
            email,
            action: 'skipped',
            note: 'Error processing email',
          })
        }
      }
    }

    const createdCount = results.filter((entry) => entry.action === 'created').length
    const skippedCount = results.filter((entry) => entry.action === 'skipped').length
    const emailsSent = emailResults.filter((entry) => entry.action === 'sent').length

    res.json({
      message: 'Collaboration requests processed',
      summary: {
        created: createdCount,
        updated: 0,
        skipped: skippedCount,
        inaccessibleProjectCount,
        emailsSent,
        emailResults,
        details: results,
      },
    })
  } catch (error) {
    console.error('Error creating collaboration requests:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Remove a project member
router.delete('/:projectId/members/:memberId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { projectId, memberId } = req.params

    const [currentUser, project] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.userId },
        select: { id: true, role: true },
      }),
      prisma.project.findUnique({
        where: { id: projectId },
        include: {
          members: true,
        },
      }),
    ])

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const isSuperAdmin = currentUser.role?.toLowerCase() === 'superadmin'
    const isAdmin = isSuperAdmin || currentUser.role?.toLowerCase() === 'admin'
    const isProjectCreator = project.createdById === req.userId
    const requesterMembership = project.members.find((member) => member.userId === req.userId)
    const isProjectOwner = requesterMembership?.role?.toLowerCase() === 'owner'
    const isSelfRemoval = req.userId === memberId

    if (!isSuperAdmin && !isAdmin && !isProjectCreator && !isProjectOwner && !isSelfRemoval) {
      return res.status(403).json({ error: 'You do not have permission to remove members from this project.' })
    }

    const membership = project.members.find((member) => member.userId === memberId)

    if (!membership) {
      return res.status(404).json({ error: 'Member not found in this project.' })
    }

    const memberRole = membership.role?.toLowerCase() || 'member'
    const ownerCount = project.members.filter((member) => member.role?.toLowerCase() === 'owner').length

    if (memberRole === 'owner' && ownerCount <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last owner from the project.' })
    }

    await prisma.projectMember.delete({
      where: { id: membership.id },
    })

    res.json({ success: true })
  } catch (error: any) {
    console.error('Failed to remove project member:', error)
    res.status(500).json({ error: error.message || 'Failed to remove project member' })
  }
})

export default router

