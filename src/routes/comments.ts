import { Router, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { logActivity } from '../utils/activityLogger'

const router = Router()

// Get comments for a task
router.get('/tasks/:taskId/comments', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const comments = await prisma.comment.findMany({
      where: { taskId: req.params.taskId },
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
        createdAt: 'asc',
      },
    })

    res.json(comments)
  } catch (error) {
    console.error('Error fetching comments:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create a comment with @mentions
router.post('/tasks/:taskId/comments', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { content, mentions } = req.body

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content is required' })
    }

    const comment = await prisma.comment.create({
      data: {
        content: content.trim(),
        taskId: req.params.taskId,
        userId: req.userId,
        mentions: mentions && Array.isArray(mentions) ? JSON.stringify(mentions) : null,
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

    // Create notifications for mentioned users
    if (mentions && Array.isArray(mentions) && mentions.length > 0) {
      const task = await prisma.task.findUnique({
        where: { id: req.params.taskId },
        select: { title: true },
      })

      await Promise.all(
        mentions.map((userId: string) =>
          prisma.notification.create({
            data: {
              userId,
              type: 'COMMENT',
              title: 'You were mentioned in a comment',
              message: `${req.userId} mentioned you in a comment on task: ${task?.title || 'Task'}`,
              link: `/tasks/${req.params.taskId}`,
            },
          })
        )
      )
    }

    res.status(201).json(comment)
  } catch (error) {
    console.error('Error creating comment:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Request review for a task
router.post('/tasks/:taskId/review', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { reviewerId } = req.body

    if (!reviewerId) {
      return res.status(400).json({ error: 'Reviewer ID is required' })
    }

    const task = await prisma.task.findUnique({
      where: { id: req.params.taskId },
      include: {
        assignees: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    })

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // Check if user is assigned to the task
    const isAssigned = task.assignees.some(a => a.userId === req.userId)
    if (!isAssigned) {
      return res.status(403).json({ error: 'You can only request review for tasks assigned to you' })
    }

    // Update task to REVIEW_REQUESTED (waiting for acceptance)
    const updatedTask = await prisma.task.update({
      where: { id: req.params.taskId },
      data: {
        reviewStatus: 'REVIEW_REQUESTED' as any,
        reviewRequestedById: req.userId,
        reviewRequestedAt: new Date(),
        reviewerId: reviewerId, // Store who was requested to review
        status: 'ON_HOLD', // Pause the task
      },
      include: {
        assignees: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        project: true,
        reviewRequestedBy: {
          select: { id: true, name: true, email: true },
        },
        reviewer: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    // Create notification for reviewer
    await prisma.notification.create({
      data: {
        userId: reviewerId,
        type: 'REQUEST',
        title: 'Task Review Requested',
        message: `A task "${task.title}" has been sent for your review`,
        link: `/tasks/${req.params.taskId}`,
      },
    })

    // Log activity
    await logActivity({
      type: 'TASK_REVIEW_REQUESTED',
      action: 'Review Requested',
      description: `Requested review for task "${updatedTask.title}"${updatedTask.project ? ` in project "${updatedTask.project.name}"` : ''}${updatedTask.reviewer ? ` from ${updatedTask.reviewer.name || updatedTask.reviewer.email}` : ''}`,
      entityType: 'task',
      entityId: updatedTask.id,
      metadata: {
        taskTitle: updatedTask.title,
        projectName: updatedTask.project?.name,
        reviewerName: updatedTask.reviewer?.name || updatedTask.reviewer?.email,
      },
      userId: req.userId,
    })

    res.json(updatedTask)
  } catch (error) {
    console.error('Error requesting review:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Accept or cancel review request
router.post('/tasks/:taskId/review/accept', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { accept } = req.body // accept: true to accept, false to cancel

    const task = await prisma.task.findUnique({
      where: { id: req.params.taskId },
      include: {
        assignees: {
          select: {
            userId: true,
          },
        },
      },
    })

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // Check if task is in REVIEW_REQUESTED status
    if (task.reviewStatus !== 'REVIEW_REQUESTED') {
      return res.status(400).json({ error: 'Task is not in review request status' })
    }

    // Check if current user is the requested reviewer
    if (task.reviewerId !== req.userId) {
      return res.status(403).json({ error: 'You are not the requested reviewer for this task' })
    }

    if (accept) {
      // Double-check that task is still in REVIEW_REQUESTED status (prevent race conditions)
      const currentTask = await prisma.task.findUnique({
        where: { id: req.params.taskId },
        select: { reviewStatus: true },
      })
      
      if (currentTask?.reviewStatus !== 'REVIEW_REQUESTED') {
        return res.status(400).json({ error: 'Task review request has already been processed' })
      }
      
      // Accept: Change status to UNDER_REVIEW
      const updatedTask = await prisma.task.update({
        where: { id: req.params.taskId },
        data: {
          reviewStatus: 'UNDER_REVIEW' as any,
        },
        include: {
          assignees: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
          project: true,
          reviewRequestedBy: {
            select: { id: true, name: true, email: true },
          },
          reviewer: {
            select: { id: true, name: true, email: true },
          },
        },
      })

      console.log('Task accepted for review:', {
        taskId: updatedTask.id,
        title: updatedTask.title,
        reviewStatus: updatedTask.reviewStatus,
        reviewerId: updatedTask.reviewerId,
        reviewer: updatedTask.reviewer,
      })

      // Notify the requester that review was accepted
      if (task.reviewRequestedById) {
        await prisma.notification.create({
          data: {
            userId: task.reviewRequestedById,
            type: 'COMMENT',
            title: 'Review Request Accepted',
            message: `Your review request for task "${task.title}" has been accepted`,
            link: `/tasks/${req.params.taskId}`,
          },
        })
      }

      // Log activity
      await logActivity({
        type: 'TASK_REVIEW_ACCEPTED',
        action: 'Review Accepted',
        description: `Accepted review request for task "${updatedTask.title}"${updatedTask.project ? ` in project "${updatedTask.project.name}"` : ''}`,
        entityType: 'task',
        entityId: updatedTask.id,
        metadata: {
          taskTitle: updatedTask.title,
          projectName: updatedTask.project?.name,
        },
        userId: req.userId,
      })

      res.json(updatedTask)
    } else {
      // Cancel: Remove review request, resume task
      const updatedTask = await prisma.task.update({
        where: { id: req.params.taskId },
        data: {
          reviewStatus: null,
          reviewRequestedById: null,
          reviewRequestedAt: null,
          reviewerId: null,
          status: 'IN_PROGRESS', // Resume the task
        },
        include: {
          assignees: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
          project: true,
          reviewRequestedBy: {
            select: { id: true, name: true, email: true },
          },
          reviewer: {
            select: { id: true, name: true, email: true },
          },
        },
      })

      // Notify the requester that review was cancelled
      if (task.reviewRequestedById) {
        await prisma.notification.create({
          data: {
            userId: task.reviewRequestedById,
            type: 'COMMENT',
            title: 'Review Request Cancelled',
            message: `Your review request for task "${task.title}" has been cancelled`,
            link: `/tasks/${req.params.taskId}`,
          },
        })
      }

      res.json(updatedTask)
    }
  } catch (error) {
    console.error('Error accepting/cancelling review:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Approve or reject review
router.post('/tasks/:taskId/review/respond', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { action, comment } = req.body // action: 'APPROVED' or 'REJECTED'

    if (!action || !['APPROVED', 'REJECTED'].includes(action)) {
      return res.status(400).json({ error: 'Action must be APPROVED or REJECTED' })
    }

    const task = await prisma.task.findUnique({
      where: { id: req.params.taskId },
      include: {
        assignees: {
          select: {
            userId: true,
          },
        },
      },
    })

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // Check if task is under review
    if (task.reviewStatus !== 'UNDER_REVIEW') {
      return res.status(400).json({ error: 'Task is not under review' })
    }

    // Update task review status
    const updatedTask = await prisma.task.update({
      where: { id: req.params.taskId },
      data: {
        reviewStatus: (action === 'APPROVED' ? 'APPROVED' : 'REJECTED') as any,
        reviewedById: req.userId,
        reviewedAt: new Date(),
        status: action === 'APPROVED' ? 'IN_PROGRESS' : 'ON_HOLD', // Resume if approved, keep on hold if rejected
      },
      include: {
        assignees: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        project: true,
        reviewRequestedBy: {
          select: { id: true, name: true, email: true },
        },
        reviewer: {
          select: { id: true, name: true, email: true },
        },
        reviewedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    // Add comment if provided
    if (comment && comment.trim()) {
      await prisma.comment.create({
        data: {
          content: comment.trim(),
          taskId: req.params.taskId,
          userId: req.userId,
        },
      })
    }

    // Create notification for task assignees
    const assigneeIds = task.assignees?.map(a => a.userId) || []
    if (task.reviewRequestedById) {
      assigneeIds.push(task.reviewRequestedById)
    }

    await Promise.all(
      [...new Set(assigneeIds)].map((userId) =>
        prisma.notification.create({
          data: {
            userId,
            type: 'COMMENT',
            title: `Task Review ${action}`,
            message: `Task "${task.title}" has been ${action.toLowerCase()}`,
            link: `/tasks/${req.params.taskId}`,
          },
        })
      )
    )

    // Log activity
    await logActivity({
      type: 'TASK_REVIEW_COMPLETED',
      action: `Review ${action}`,
      description: `${action} review for task "${updatedTask.title}"${updatedTask.project ? ` in project "${updatedTask.project.name}"` : ''}`,
      entityType: 'task',
      entityId: updatedTask.id,
      metadata: {
        taskTitle: updatedTask.title,
        projectName: updatedTask.project?.name,
        action,
      },
      userId: req.userId,
    })

    res.json(updatedTask)
  } catch (error) {
    console.error('Error responding to review:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router

