import { Router, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

// Get all users (for search and filtering)
router.get('/users', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { department, search } = req.query

    // Get current user's role and department
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
    
    const where: any = {}
    
    // If not super admin, filter by user's department by default
    if (!isSuperAdmin && currentUser.department) {
      // Default to user's department if no department filter is selected
      if (!department || department === 'all') {
        where.department = currentUser.department
      } else if (department && typeof department === 'string' && department !== 'all') {
        // If department filter is selected, use that (but only if it matches user's department)
        where.department = department === currentUser.department ? department : currentUser.department
      }
    } else if (isSuperAdmin) {
      // Super admin can see all departments
      if (department && typeof department === 'string' && department !== 'all') {
        where.department = department
      }
      // If no department filter, show all (no where condition)
    }

    let users = await prisma.user.findMany({
      where: {
        ...where,
        isActive: true, // Only show active users
      },
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
      },
      orderBy: {
        name: 'asc',
      },
    })

    // Apply search filter (case-insensitive) - search across all users regardless of department
    if (search && typeof search === 'string') {
      const searchLower = search.toLowerCase()
      users = users.filter(user => 
        user.name?.toLowerCase().includes(searchLower) ||
        user.email.toLowerCase().includes(searchLower)
      )
    }

    res.json(users)
  } catch (error) {
    console.error('Error fetching users:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get unique departments
router.get('/departments', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const users = await prisma.user.findMany({
      where: {
        department: { not: null },
      },
      select: {
        department: true,
      },
      distinct: ['department'],
    })

    const departments = users
      .map(u => u.department)
      .filter((d): d is string => d !== null)
      .sort()

    res.json(departments)
  } catch (error) {
    console.error('Error fetching departments:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get team members with statistics
router.get('/members', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { department, search } = req.query

    // Get current user's role and department
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
    
    // Build where condition for users
    const where: any = {}
    
    // If searching, search across ALL users (don't filter by department)
    // If not searching, apply department filter
    if (!search || typeof search !== 'string') {
      // If not super admin, filter by user's department by default
      if (!isSuperAdmin && currentUser.department) {
        // Default to user's department if no department filter is selected
        if (!department || department === 'all') {
          where.department = currentUser.department
        } else if (department && typeof department === 'string' && department !== 'all') {
          // If department filter is selected, use that (but only if it matches user's department)
          where.department = department === currentUser.department ? department : currentUser.department
        }
      } else if (isSuperAdmin) {
        // Super admin can see all departments
        if (department && typeof department === 'string' && department !== 'all') {
          where.department = department
        }
        // If no department filter, show all (no where condition)
      }
    }
    // If searching, don't add department filter - we want to search all users

    // Get all users matching the criteria
    let users = await prisma.user.findMany({
      where: {
        ...where,
        isActive: true, // Only show active users
      },
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
      },
      orderBy: {
        name: 'asc',
      },
    })

    // Apply search filter (case-insensitive) - search across ALL users
    if (search && typeof search === 'string') {
      const searchLower = search.toLowerCase()
      users = users.filter(user => 
        user.name?.toLowerCase().includes(searchLower) ||
        user.email.toLowerCase().includes(searchLower)
      )
      
      // After search, apply department filter if selected
      if (!isSuperAdmin && currentUser.department) {
        // Regular users: only show their department even after search
        users = users.filter(user => user.department === currentUser.department)
      } else if (isSuperAdmin && department && typeof department === 'string' && department !== 'all') {
        // If super admin selected a department, filter by that
        users = users.filter(user => user.department === department)
      }
      // If super admin and no department filter, show all search results
    }
    
    const userIds = users.map(u => u.id)
    
    const teamMembers = await Promise.all(
      userIds.map(async (userId) => {
        const tasks = await prisma.task.findMany({
          where: {
            assignees: {
              some: {
                userId,
              },
            },
          },
        })

        const projects = await prisma.projectMember.findMany({
          where: { userId },
          select: { projectId: true },
        })

        // Get credential memberships
        const credentialMembers = await prisma.credentialMember.findMany({
          where: { userId },
          include: {
            credential: {
              select: { id: true, company: true },
            },
          },
        })

        // Get subscription memberships
        const subscriptionMembers = await prisma.subscriptionMember.findMany({
          where: { userId },
          include: {
            subscription: {
              select: { id: true, name: true },
            },
          },
        })

        const user = users.find(u => u.id === userId)

        // Get user permissions
        const userData = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            hasCredentialAccess: true,
            hasSubscriptionAccess: true,
          },
        })

        return {
          id: userId,
          name: user?.name,
          email: user?.email,
          department: user?.department,
          tasksAssigned: tasks.length,
          projectsInvolved: projects.length,
          hasCredentialAccess: userData?.hasCredentialAccess || false,
          hasSubscriptionAccess: userData?.hasSubscriptionAccess || false,
          statusSummary: {
            inProgress: tasks.filter(t => t.status === 'IN_PROGRESS').length,
            completed: tasks.filter(t => t.status === 'COMPLETED').length,
            yts: tasks.filter(t => t.status === 'YTS').length,
            onHold: tasks.filter(t => {
              const status = String(t.status).toUpperCase().trim()
              return status === 'ON_HOLD' || status === 'ONHOLD' || status === 'ON HOLD'
            }).length,
            recurring: tasks.filter(t => t.status === 'RECURRING').length,
          },
          credentialMembers: credentialMembers.map(cm => ({
            id: cm.id,
            credentialId: cm.credentialId,
            credentialName: cm.credential.company,
            isActive: cm.isActive,
          })),
          subscriptionMembers: subscriptionMembers.map(sm => ({
            id: sm.id,
            subscriptionId: sm.subscriptionId,
            subscriptionName: sm.subscription.name,
            isActive: sm.isActive,
          })),
        }
      })
    )

    res.json(teamMembers)
  } catch (error) {
    console.error('Error fetching team members:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update user feature access (only admins can do this)
router.put('/members/:userId/features', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check if user is admin or super admin
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    if (!currentUser || (currentUser.role?.toLowerCase() !== 'admin' && currentUser.role?.toLowerCase() !== 'superadmin')) {
      return res.status(403).json({ error: 'Only admins can update feature access' })
    }

    const { hasCredentialAccess, hasSubscriptionAccess } = req.body

    const updatedUser = await prisma.user.update({
      where: { id: req.params.userId },
      data: {
        ...(hasCredentialAccess !== undefined && { hasCredentialAccess }),
        ...(hasSubscriptionAccess !== undefined && { hasSubscriptionAccess }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        hasCredentialAccess: true,
        hasSubscriptionAccess: true,
      },
    })

    res.json(updatedUser)
  } catch (error) {
    console.error('Error updating user features:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router

