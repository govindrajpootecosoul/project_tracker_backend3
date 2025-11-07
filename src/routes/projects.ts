import { Router, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

// Get all projects
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // Try the full query first
    let projects
    try {
      projects = await prisma.project.findMany({
        include: {
          members: {
            where: {
              user: {
                isNot: null,
              },
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
                user: {
                  isNot: null,
                },
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
          include: {
            members: {
              where: {
                user: {
                  isNot: null,
                },
              },
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

export default router

