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
    const limit = parseInt((req.query.limit as string) || '20', 10)
    const skip = parseInt((req.query.skip as string) || '0', 10)

    console.log('Fetching activities for user:', req.userId, 'view:', view, 'limit:', limit, 'skip:', skip)

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

    let taskIds: string[] = []
    let projectIds: string[] = []
    let userIds: string[] = []

    // Determine which activities to fetch based on view
    if (view === 'my') {
      // My activities - activities from user's assigned tasks only
      const userProjects = await prisma.projectMember.findMany({
        where: { userId: req.userId },
        select: { projectId: true },
      })

      projectIds = userProjects.map(p => p.projectId)

      // Only get tasks assigned to the user (not created by them)
      const userTasks = await prisma.task.findMany({
        where: {
          assignees: {
            some: {
              userId: req.userId,
            },
          },
        },
        select: { id: true },
      })

      taskIds = userTasks.map(t => t.id)
      userIds = [req.userId]
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

      userIds = departmentUsers.map(u => u.id)

      // Get tasks assigned to department users
      const departmentTasks = await prisma.task.findMany({
        where: {
          assignees: {
            some: {
              userId: {
                in: userIds,
              },
            },
          },
        },
        select: { id: true },
      })

      taskIds = departmentTasks.map(t => t.id)

      // Get projects that department users are members of
      const departmentProjects = await prisma.projectMember.findMany({
        where: {
          userId: {
            in: userIds,
          },
        },
        select: { projectId: true },
      })

      projectIds = [...new Set(departmentProjects.map(p => p.projectId))]
    } else if (view === 'all-departments') {
      // All departments activities - only for super admin
      if (!isSuperAdmin) {
        return res.status(403).json({ error: 'Only super admins can access all departments activities' })
      }

      // Get all tasks
      const allTasks = await prisma.task.findMany({
        select: { id: true },
      })

      taskIds = allTasks.map(t => t.id)

      // Get all projects
      const allProjects = await prisma.project.findMany({
        select: { id: true },
      })

      projectIds = allProjects.map(p => p.id)

      // Get all users
      const allUsers = await prisma.user.findMany({
        select: { id: true },
      })

      userIds = allUsers.map(u => u.id)
    } else {
      // Default to my activities if invalid view - only assigned tasks
      const userProjects = await prisma.projectMember.findMany({
        where: { userId: req.userId },
        select: { projectId: true },
      })

      projectIds = userProjects.map(p => p.projectId)

      // Only get tasks assigned to the user (not created by them)
      const userTasks = await prisma.task.findMany({
        where: {
          assignees: {
            some: {
              userId: req.userId,
            },
          },
        },
        select: { id: true },
      })

      taskIds = userTasks.map(t => t.id)
      userIds = [req.userId]
    }

    console.log('User project IDs:', projectIds)
    console.log('User task IDs:', taskIds)
    console.log('User IDs:', userIds)

    // Get activities related to tasks, projects, and users
    const activities = await prisma.activityLog.findMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          {
            entityType: 'task',
            entityId: { in: taskIds },
          },
          {
            entityType: 'project',
            entityId: { in: projectIds },
          },
        ],
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
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: skip,
    })

    console.log('Found activities:', activities.length)
    if (activities.length > 0) {
      console.log('Activities:', activities.map(a => ({ id: a.id, type: a.type, description: a.description, userId: a.userId })))
    } else {
      // Check if there are any activities at all in the database
      const allActivities = await prisma.activityLog.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
      })
      console.log('Total activities in database:', allActivities.length)
      if (allActivities.length > 0) {
        console.log('Sample activities:', allActivities.map(a => ({ id: a.id, type: a.type, userId: a.userId, entityType: a.entityType, entityId: a.entityId })))
      }
    }

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

