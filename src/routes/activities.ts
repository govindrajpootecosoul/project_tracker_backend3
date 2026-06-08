import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

// Get recent activities
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Get view parameter (my/department/all-departments)
    const view = req.query.view as string || 'my'
    const rawLimit = parseInt((req.query.limit as string) || '20', 10)
    const limitRequested = Number.isFinite(rawLimit) ? rawLimit : 20
    const limit = Math.min(Math.max(limitRequested, 1), 50) // hard cap for performance
    const skip = parseInt((req.query.skip as string) || '0', 10)

    const shouldLog = process.env.NODE_ENV !== 'production'
    if (shouldLog) {
      console.log('Fetching activities:', { userId: req.userId, view, limit, skip })
    }

    // Check if ActivityLog model exists in Prisma client
    if (!prisma.activityLog) {
      console.error('ActivityLog model not found in Prisma client. Please run: npx prisma generate && npx prisma db push')
      return res.json([]) // Return empty array instead of error
    }

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

    const userRole = currentUser.role?.toLowerCase()
    const isAdmin = userRole === 'admin'
    const isSuperAdmin = userRole === 'superadmin'

    // Performance note:
    // Avoid building huge taskId/projectId lists for OR filters; those become slow as data grows.
    // We keep semantics close while staying fast:
    // - my: activities by user OR activities on projects the user is a member of
    // - department: activities by users in the department
    // - all-departments: all activities
    let whereClause: any = {}

    // Determine which activities to fetch based on view
    if (view === 'my') {
      const userProjects = await prisma.projectMember.findMany({
        where: { userId: req.userId },
        select: { projectId: true },
      })
      const projectIds = userProjects.map((p) => p.projectId)

      whereClause = projectIds.length
        ? {
            OR: [
              { userId: req.userId },
              { entityType: 'project', entityId: { in: projectIds } },
            ],
          }
        : { userId: req.userId }
    } else if (view === 'department') {
      // Department activities - only for admin/super admin
      if (!isAdmin && !isSuperAdmin) {
        return res.status(403).json({ error: 'Only admins can access department activities' })
      }

      if (!currentUser.department) {
        return res.status(400).json({ error: 'User does not have a department assigned' })
      }

      // Get all users in the same department
      const departmentUsers = await prisma.user.findMany({
        where: {
          department: currentUser.department,
          isActive: true,
        },
        select: {
          id: true,
        },
      })

      const userIds = departmentUsers.map((u) => u.id)
      whereClause = userIds.length ? { userId: { in: userIds } } : { userId: req.userId }
    } else if (view === 'all-departments') {
      // All departments activities - only for super admin
      if (!isSuperAdmin) {
        return res.status(403).json({ error: 'Only super admins can access all departments activities' })
      }
      whereClause = {}
    } else {
      // Default to "my" behavior
      const userProjects = await prisma.projectMember.findMany({
        where: { userId: req.userId },
        select: { projectId: true },
      })
      const projectIds = userProjects.map((p) => p.projectId)
      whereClause = projectIds.length
        ? {
            OR: [
              { userId: req.userId },
              { entityType: 'project', entityId: { in: projectIds } },
            ],
          }
        : { userId: req.userId }
    }

    const activities = await prisma.activityLog.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: skip,
    })

    res.json(activities)
  } catch (error: any) {
    console.error('Error fetching activities:', error)
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      name: error.name,
    })
    
    // If it's a Prisma error about missing model, return empty array
    if (error.message && (error.message.includes('activityLog') || error.message.includes('ActivityLog'))) {
      console.error('ActivityLog model not found. Please run: npx prisma generate && npx prisma db push')
      return res.json([]) // Return empty array instead of error
    }
    
    res.status(500).json({ error: 'Internal server error', message: error.message })
  }
})

export default router

