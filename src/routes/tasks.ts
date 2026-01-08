import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { logActivity } from '../utils/activityLogger'

const router = Router()

// Get all tasks
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const tasks = await prisma.task.findMany({
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
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
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
        comments: {
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
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    res.json(tasks)
  } catch (error) {
    console.error('Error fetching tasks:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get user's tasks (only assigned tasks)
router.get('/my', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const limit = parseInt(req.query.limit as string) || 20
    const skip = parseInt(req.query.skip as string) || 0

    const where = {
      assignees: {
        some: {
          userId: req.userId,
        },
      },
    }

    // Optimized: Removed comments, use select for better performance
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          startDate: true,
          dueDate: true,
          projectId: true,
          brand: true,
          tags: true,
          recurring: true,
          imageCount: true,
          videoCount: true,
          link: true,
          reviewStatus: true,
          reviewRequestedById: true,
          reviewRequestedAt: true,
          reviewerId: true,
          reviewedById: true,
          reviewedAt: true,
          statusUpdatedAt: true,
          createdAt: true,
          updatedAt: true,
          createdById: true,
          assignees: {
            select: {
              id: true,
              userId: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
              brand: true,
              department: true,
            },
          },
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
        orderBy: [
          { statusUpdatedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        take: limit,
        skip: skip,
      }),
      prisma.task.count({ where }),
    ])

    res.json({
      tasks,
      total,
      hasMore: skip + tasks.length < total,
    })
  } catch (error) {
    console.error('Error fetching my tasks:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get department tasks (for admin - tasks from users in same department)
router.get('/department', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
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

    // Only admin and super admin can access department tasks
    if (!isAdmin && !isSuperAdmin) {
      return res.status(403).json({ error: 'Only admins can access department tasks' })
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

    const departmentUserIds = departmentUsers.map(u => u.id)

    const limit = parseInt(req.query.limit as string) || 20
    const skip = parseInt(req.query.skip as string) || 0

    const where = {
      assignees: {
        some: {
          userId: {
            in: departmentUserIds,
          },
        },
      },
    }

    // Optimized: Removed comments, use select
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          startDate: true,
          dueDate: true,
          projectId: true,
          brand: true,
          tags: true,
          recurring: true,
          imageCount: true,
          videoCount: true,
          link: true,
          reviewStatus: true,
          reviewRequestedById: true,
          reviewRequestedAt: true,
          reviewerId: true,
          reviewedById: true,
          reviewedAt: true,
          statusUpdatedAt: true,
          createdAt: true,
          updatedAt: true,
          createdById: true,
          assignees: {
            select: {
              id: true,
              userId: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  department: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
              brand: true,
              department: true,
            },
          },
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
        orderBy: [
          { statusUpdatedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        take: limit,
        skip: skip,
      }),
      prisma.task.count({ where }),
    ])

    res.json({
      tasks,
      total,
      hasMore: skip + tasks.length < total,
    })
  } catch (error) {
    console.error('Error fetching department tasks:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get all departments tasks (for super admin - tasks from all departments)
router.get('/all-departments', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const limit = parseInt(req.query.limit as string) || 20
    const skip = parseInt(req.query.skip as string) || 0

    // Get current user's role
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        role: true,
      },
    })

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' })
    }

    const userRole = currentUser.role?.toLowerCase()
    const isSuperAdmin = userRole === 'superadmin'

    // Only super admin can access all departments tasks
    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Only super admins can access all departments tasks' })
    }

    // Get all tasks from all departments
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        include: {
          assignees: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  department: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
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
          comments: {
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
          },
        },
        orderBy: [
          { statusUpdatedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        take: limit,
        skip: skip,
      }),
      prisma.task.count(),
    ])

    res.json({
      tasks,
      total,
      hasMore: skip + tasks.length < total,
    })
  } catch (error) {
    console.error('Error fetching all departments tasks:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get team tasks
router.get('/team', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const limit = parseInt(req.query.limit as string) || 20
    const skip = parseInt(req.query.skip as string) || 0

    // Get logged-in user's department
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { department: true },
    })

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' })
    }

    // If user has no department, return empty array
    if (!currentUser.department) {
      return res.json({ tasks: [], total: 0, hasMore: false })
    }

    // Get all users in the same department
    const departmentUsers = await prisma.user.findMany({
      where: {
        department: currentUser.department,
        id: { not: req.userId }, // Exclude current user
      },
      select: { id: true },
    })

    const departmentUserIds = departmentUsers.map(u => u.id)

    const where = {
      assignees: {
        some: {
          userId: {
            in: departmentUserIds,
          },
        },
      },
    }

    // Get tasks assigned to users in the same department - Optimized: removed comments
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          startDate: true,
          dueDate: true,
          projectId: true,
          brand: true,
          tags: true,
          recurring: true,
          imageCount: true,
          videoCount: true,
          link: true,
          reviewStatus: true,
          reviewRequestedById: true,
          reviewRequestedAt: true,
          reviewerId: true,
          reviewedById: true,
          reviewedAt: true,
          statusUpdatedAt: true,
          createdAt: true,
          updatedAt: true,
          createdById: true,
          assignees: {
            select: {
              id: true,
              userId: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
              brand: true,
              department: true,
            },
          },
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
        orderBy: [
          { statusUpdatedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        take: limit,
        skip: skip,
      }),
      prisma.task.count({ where }),
    ])

    res.json({
      tasks,
      total,
      hasMore: skip + tasks.length < total,
    })
  } catch (error) {
    console.error('Error fetching team tasks:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get tasks for review (where user is the reviewer)
router.get('/review', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const limit = parseInt(req.query.limit as string) || 20
    const skip = parseInt(req.query.skip as string) || 0

    console.log('Fetching review tasks for user:', req.userId)

    const where = {
      reviewerId: req.userId,
      reviewStatus: {
        in: ['REVIEW_REQUESTED', 'UNDER_REVIEW'],
      },
    }

    // Optimized: Removed comments, use select for better performance
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          startDate: true,
          dueDate: true,
          projectId: true,
          brand: true,
          tags: true,
          recurring: true,
          imageCount: true,
          videoCount: true,
          link: true,
          reviewStatus: true,
          reviewRequestedById: true,
          reviewRequestedAt: true,
          reviewerId: true,
          reviewedById: true,
          reviewedAt: true,
          statusUpdatedAt: true,
          createdAt: true,
          updatedAt: true,
          createdById: true,
          assignees: {
            select: {
              id: true,
              userId: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
              brand: true,
              department: true,
            },
          },
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
        orderBy: [
          { statusUpdatedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        take: limit,
        skip: skip,
      }),
      prisma.task.count({ where }),
    ])

    console.log('Review tasks found:', {
      count: tasks.length,
      total,
      userId: req.userId,
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        reviewStatus: t.reviewStatus,
        reviewerId: t.reviewerId,
      })),
    })

    res.json({
      tasks,
      total,
      hasMore: skip + tasks.length < total,
    })
  } catch (error) {
    console.error('Error fetching review tasks:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get assignable members for task assignment (admin and super admin only)
router.get('/assignable-members', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { search } = req.query

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

    // Only admin and super admin can assign tasks
    if (!isAdmin && !isSuperAdmin) {
      return res.status(403).json({ error: 'Only admins and super admins can assign tasks' })
    }

    // Build where condition
    const where: any = {
      isActive: true, // Only show active users
    }

    // Admin sees only their department members, super admin sees all
    if (isAdmin && !isSuperAdmin && currentUser.department) {
      where.department = currentUser.department
    }
    // Super admin sees all (no department filter)

    // Get users
    let users = await prisma.user.findMany({
      where,
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

    // Apply search filter if provided
    if (search && typeof search === 'string') {
      const searchLower = search.toLowerCase()
      users = users.filter(user => 
        user.name?.toLowerCase().includes(searchLower) ||
        user.email.toLowerCase().includes(searchLower)
      )
    }

    res.json(users)
  } catch (error) {
    console.error('Error fetching assignable members:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get task statistics
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Get view parameter (my/department/all-departments)
    const view = req.query.view as string || 'my'

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

    let tasks: any[] = []

    // Determine which tasks to fetch based on view
    if (view === 'my') {
      // My tasks - only tasks assigned to the user
      tasks = await prisma.task.findMany({
        where: {
          assignees: {
            some: {
              userId: req.userId,
            },
          },
        },
      })
    } else if (view === 'department') {
      // Department tasks - only for admin/super admin
      if (!isAdmin && !isSuperAdmin) {
        return res.status(403).json({ error: 'Only admins can access department tasks' })
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

      const departmentUserIds = departmentUsers.map(u => u.id)

      // Get tasks assigned to department users
      tasks = await prisma.task.findMany({
        where: {
          assignees: {
            some: {
              userId: {
                in: departmentUserIds,
              },
            },
          },
        },
      })
    } else if (view === 'all-departments') {
      // All departments tasks - only for super admin
      if (!isSuperAdmin) {
        return res.status(403).json({ error: 'Only super admins can access all departments tasks' })
      }

      // Get all tasks
      tasks = await prisma.task.findMany({})
    } else {
      // Default to my tasks if invalid view - only assigned tasks
      tasks = await prisma.task.findMany({
        where: {
          assignees: {
            some: {
              userId: req.userId,
            },
          },
        },
      })
    }

    // Helper function to normalize status for comparison
    const normalizeStatus = (status: string | null | undefined): string => {
      if (!status) return ''
      return String(status).toUpperCase().trim()
    }

    const stats = {
      totalTasks: tasks.length,
      completedTasks: tasks.filter(t => normalizeStatus(t.status) === 'COMPLETED').length,
      inProgress: tasks.filter(t => normalizeStatus(t.status) === 'IN_PROGRESS').length,
      yts: tasks.filter(t => normalizeStatus(t.status) === 'YTS').length,
      onHold: tasks.filter(t => {
        const status = normalizeStatus(t.status)
        return status === 'ON_HOLD' || status === 'ONHOLD' || status === 'ON HOLD'
      }).length,
      overdue: tasks.filter(t => {
        if (!t.dueDate) return false
        return new Date(t.dueDate) < new Date() && normalizeStatus(t.status) !== 'COMPLETED'
      }).length,
      recurring: tasks.filter(t => t.recurring !== null).length,
    }

    res.json(stats)
  } catch (error) {
    console.error('Error fetching task stats:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get single task
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
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
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
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
        comments: {
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
        },
      },
    })

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    res.json(task)
  } catch (error) {
    console.error('Error fetching task:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create task
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { title, description, status, priority, startDate, dueDate, projectId, brand, tags, recurring, assignees, imageCount, videoCount, link } = req.body

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' })
    }

    // Split titles by comma and trim
    const titles = title
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0)

    if (titles.length === 0) {
      return res.status(400).json({ error: 'At least one valid title is required' })
    }

    // Split descriptions by comma and trim (optional)
    const descriptions = description && typeof description === 'string' && description.trim()
      ? description
          .split(',')
          .map(d => d.trim())
          .filter(d => d.length > 0)
      : []

    // Clean up empty strings to null and validate ObjectIDs
    // MongoDB ObjectID must be 24 hex characters (12 bytes)
    const isValidObjectId = (id: string | null | undefined): boolean => {
      if (!id || typeof id !== 'string') return false
      return /^[0-9a-fA-F]{24}$/.test(id.trim())
    }

    const cleanProjectId = projectId && projectId.trim() !== '' && isValidObjectId(projectId)
      ? projectId.trim()
      : null
    
    if (projectId && projectId.trim() !== '' && !isValidObjectId(projectId)) {
      return res.status(400).json({ error: 'Invalid project ID format. Project ID must be a valid MongoDB ObjectID.' })
    }

    const cleanBrand = brand && brand.trim() !== '' ? brand.trim() : null
    const cleanTags = tags && tags.trim() !== '' ? tags.trim() : null
    const cleanRecurring = recurring && recurring.trim() !== '' ? recurring.trim() : null

    const startDateValue =
      typeof startDate === 'string' && startDate.trim() !== ''
        ? new Date(startDate)
        : new Date()

    const parseCount = (value: unknown): number => {
      const num = Number(value)
      if (!Number.isFinite(num) || num < 0) {
        return 0
      }
      return Math.round(num)
    }

    // Prepare assignees list
    const assigneeList = assignees && Array.isArray(assignees) && assignees.length > 0
      ? assignees.map((userId: string) => ({ userId }))
      : [{ userId: req.userId }]

    // Create multiple tasks
    const tasksToCreate = titles.map((taskTitle, index) => {
      // Map description: first description to first task, second to second, etc.
      // If no description for this task, use empty string
      const taskDescription = index < descriptions.length 
        ? descriptions[index] 
        : null

      return {
        title: taskTitle,
        description: taskDescription && taskDescription.trim() !== '' ? taskDescription.trim() : null,
        status: status || 'IN_PROGRESS',
        priority: priority || 'MEDIUM',
        startDate: startDateValue,
        dueDate: dueDate && dueDate.trim() !== '' ? new Date(dueDate) : null,
        projectId: cleanProjectId,
        brand: cleanBrand,
        tags: cleanTags,
        recurring: cleanRecurring as any,
        imageCount: parseCount(imageCount),
        videoCount: parseCount(videoCount),
        link: link && link.trim() !== '' ? link.trim() : null,
        createdById: req.userId,
        assignees: {
          create: assigneeList,
        },
      }
    })

    // Create all tasks in a transaction
    const createdTasks = await prisma.$transaction(
      tasksToCreate.map(taskData =>
        prisma.task.create({
          data: taskData,
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
            project: {
              select: { name: true },
            },
          },
        })
      )
    )

    // Log activity for each task
    const project = cleanProjectId ? await prisma.project.findUnique({
      where: { id: cleanProjectId },
      select: { name: true },
    }) : null

    await Promise.all(
      createdTasks.map(task =>
        logActivity({
          type: 'TASK_CREATED',
          action: 'Task Created',
          description: `Created task "${task.title}"${project ? ` in project "${project.name}"` : ''}`,
          entityType: 'task',
          entityId: task.id,
          metadata: {
            taskTitle: task.title,
            projectName: project?.name,
            status: task.status,
            priority: task.priority,
          },
          userId: req.userId,
        })
      )
    )

    // Return all created tasks
    // If only one task was created, return it directly for backward compatibility
    // Otherwise return an array
    if (createdTasks.length === 1) {
      res.status(201).json(createdTasks[0])
    } else {
      res.status(201).json({
        success: true,
        count: createdTasks.length,
        tasks: createdTasks,
      })
    }
  } catch (error: any) {
    console.error('Error creating task(s):', error)
    // Return more detailed error message
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Task with this identifier already exists' })
    }
    if (error.message) {
      return res.status(500).json({ error: error.message })
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update task
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, status, priority, startDate, dueDate, projectId, brand, tags, recurring, assignees, imageCount, videoCount, link } = req.body

    // Get old task data for activity logging
    const oldTask = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: {
        project: { select: { name: true } },
        assignees: {
          select: { userId: true },
        },
      },
    })

    if (!oldTask) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // Validate ObjectID format if projectId is provided
    const isValidObjectId = (id: string | null | undefined): boolean => {
      if (!id || typeof id !== 'string') return false
      return /^[0-9a-fA-F]{24}$/.test(id.trim())
    }

    if (projectId !== undefined && projectId !== null && projectId.trim() !== '' && !isValidObjectId(projectId)) {
      return res.status(400).json({ error: 'Invalid project ID format. Project ID must be a valid MongoDB ObjectID.' })
    }

    const cleanProjectId = projectId && projectId.trim() !== '' && isValidObjectId(projectId)
      ? projectId.trim()
      : null

    const parseCount = (value: unknown): number | undefined => {
      if (value === undefined || value === null || value === '') return undefined
      const num = Number(value)
      if (!Number.isFinite(num) || num < 0) return 0
      return Math.round(num)
    }
    const parsedImageCount = parseCount(imageCount)
    const parsedVideoCount = parseCount(videoCount)

    // Check if status is being changed
    const isStatusChanged = status && status !== oldTask.status
    
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(status && { status }),
        ...(priority && { priority }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(projectId !== undefined && { projectId: cleanProjectId }),
        ...(brand !== undefined && { brand: brand || null }),
        ...(tags !== undefined && { tags: tags || null }),
        ...(recurring !== undefined && { recurring: recurring || null }),
        ...(parsedImageCount !== undefined && { imageCount: parsedImageCount }),
        ...(parsedVideoCount !== undefined && { videoCount: parsedVideoCount }),
        ...(link !== undefined && { link: link && link.trim() !== '' ? link.trim() : null }),
        // Update statusUpdatedAt when status changes
        ...(isStatusChanged && { statusUpdatedAt: new Date() }),
        // Clear review status when status is manually changed (unless it's ON_HOLD due to review)
        ...(status && status !== 'ON_HOLD' && { 
          reviewStatus: null,
          reviewRequestedById: null,
          reviewRequestedAt: null,
          reviewedById: null,
          reviewedAt: null,
        }),
      },
    })

    // Update assignees if provided
    if (Array.isArray(assignees)) {
      await prisma.taskAssignee.deleteMany({
        where: { taskId: req.params.id },
      })

      const sanitizedAssignees = assignees
        .flatMap((userId: unknown) => {
          if (typeof userId !== 'string') return []
          const trimmed = userId.trim()
          return trimmed ? [trimmed] : []
        })

      const fallbackAssignees = oldTask.assignees?.map(a => a.userId) ?? []
      const finalAssigneeIds = sanitizedAssignees.length > 0
        ? sanitizedAssignees
        : fallbackAssignees.length > 0
          ? fallbackAssignees
          : req.userId
            ? [req.userId]
            : []

      const uniqueAssigneeIds = Array.from(new Set(finalAssigneeIds))

      if (uniqueAssigneeIds.length > 0) {
        await prisma.taskAssignee.createMany({
          data: uniqueAssigneeIds.map(userId => ({
            taskId: req.params.id,
            userId,
          })),
        })
      }
    }
    
    // Always refetch task with all includes to ensure all fields are up to date
    const updatedTask = await prisma.task.findUnique({
      where: { id: req.params.id },
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
        comments: {
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
        },
      },
    })
    
    // Log activity for task update
    if (!updatedTask) {
      return res.status(404).json({ error: 'Task not found after update' })
    }

    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const changes: string[] = []
    if (title && title !== oldTask.title) changes.push(`title: "${oldTask.title}" → "${title}"`)
    if (status && status !== oldTask.status) {
      changes.push(`status: "${oldTask.status}" → "${status}"`)
      await logActivity({
        type: 'TASK_STATUS_CHANGED',
        action: 'Task Status Changed',
        description: `Changed task "${updatedTask.title}" status from "${oldTask.status}" to "${status}"`,
        entityType: 'task',
        entityId: updatedTask.id,
        metadata: {
          taskTitle: updatedTask.title,
          oldStatus: oldTask.status,
          newStatus: status,
          projectName: updatedTask.project?.name,
        },
        userId: req.userId,
      })
    }
    if (priority && priority !== oldTask.priority) changes.push(`priority: "${oldTask.priority}" → "${priority}"`)
    if (projectId !== undefined && projectId !== oldTask.projectId) {
      const newProject = projectId ? await prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true },
      }) : null
      changes.push(`project: "${oldTask.project?.name || 'None'}" → "${newProject?.name || 'None'}"`)
    }

    if (changes.length > 0) {
      await logActivity({
        type: 'TASK_UPDATED',
        action: 'Task Updated',
        description: `Updated task "${updatedTask.title}": ${changes.join(', ')}`,
        entityType: 'task',
        entityId: updatedTask.id,
        metadata: {
          taskTitle: updatedTask.title,
          changes,
          projectName: updatedTask.project?.name,
        },
        userId: req.userId,
      })
    }
    
    return res.json(updatedTask)
  } catch (error: any) {
    console.error('Error updating task:', error)
    // Return more detailed error message
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Task not found' })
    }
    if (error.message) {
      return res.status(500).json({ error: error.message })
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete task
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // Get task data before deletion for activity logging
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: { project: { select: { name: true } } },
    })

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    await prisma.task.delete({
      where: { id: req.params.id },
    })

    // Log activity
    if (req.userId) {
      await logActivity({
        type: 'TASK_DELETED',
        action: 'Task Deleted',
        description: `Deleted task "${task.title}"${task.project ? ` from project "${task.project.name}"` : ''}`,
        entityType: 'task',
        entityId: task.id,
        metadata: {
          taskTitle: task.title,
          projectName: task.project?.name,
          status: task.status,
        },
        userId: req.userId,
      })
    }

    res.json({ message: 'Task deleted successfully' })
  } catch (error) {
    console.error('Error deleting task:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router

