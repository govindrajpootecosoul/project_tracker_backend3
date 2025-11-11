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

    console.log('Fetching activities for user:', req.userId)

    // Check if ActivityLog model exists in Prisma client
    if (!prisma.activityLog) {
      console.error('ActivityLog model not found in Prisma client. Please run: npx prisma generate && npx prisma db push')
      return res.json([]) // Return empty array instead of error
    }

    // Get user's projects to filter activities
    const userProjects = await prisma.projectMember.findMany({
      where: { userId: req.userId },
      select: { projectId: true },
    })

    const projectIds = userProjects.map(p => p.projectId)
    console.log('User project IDs:', projectIds)

    // Get tasks assigned to user, created by user, or in user's projects
    const userTasks = await prisma.task.findMany({
      where: {
        OR: [
          { assignees: { some: { userId: req.userId } } },
          { createdById: req.userId },
          { projectId: { in: projectIds } },
        ],
      },
      select: { id: true },
    })

    const taskIds = userTasks.map(t => t.id)
    console.log('User task IDs:', taskIds)

    // Get activities related to user's tasks and projects
    const activities = await prisma.activityLog.findMany({
      where: {
        OR: [
          { userId: req.userId },
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
      take: 50, // Get last 50 activities
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

