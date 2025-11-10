import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

// Get all notifications for the current user
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const notifications = await prisma.notification.findMany({
      where: {
        userId: req.userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50, // Limit to 50 most recent
    })

    res.json(notifications)
  } catch (error) {
    console.error('Error fetching notifications:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get unread notification count
router.get('/unread-count', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const count = await prisma.notification.count({
      where: {
        userId: req.userId,
        read: false,
      },
    })

    res.json({ count })
  } catch (error) {
    console.error('Error fetching unread count:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Mark notification as read
router.put('/:id/read', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const notification = await prisma.notification.update({
      where: {
        id: req.params.id,
        userId: req.userId, // Ensure user can only update their own notifications
      },
      data: {
        read: true,
        readAt: new Date(),
      },
    })

    res.json(notification)
  } catch (error) {
    console.error('Error marking notification as read:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Mark all notifications as read
router.put('/read-all', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    await prisma.notification.updateMany({
      where: {
        userId: req.userId,
        read: false,
      },
      data: {
        read: true,
        readAt: new Date(),
      },
    })

    res.json({ message: 'All notifications marked as read' })
  } catch (error) {
    console.error('Error marking all notifications as read:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create a notification (internal use - can be called from other routes)
export const createNotification = async (
  userId: string,
  type: 'REQUEST' | 'COMMENT' | 'INVITE' | 'TASK_ASSIGNED' | 'PROJECT_INVITE',
  title: string,
  message: string,
  link?: string
) => {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        link,
      },
    })
    return notification
  } catch (error) {
    console.error('Error creating notification:', error)
    throw error
  }
}

export default router



