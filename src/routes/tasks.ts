import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { logActivity } from '../utils/activityLogger'
import { TaskReviewStatus } from '@prisma/client'

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
          { createdAt: 'desc' },
          { statusUpdatedAt: 'desc' },
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

    // Allow any authenticated user to access department tasks for their own department.
    // (UI uses this for "Team Tasks" = all tasks assigned to members of the user's department.)

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
    const memberId = (req.query.memberId as string | undefined) || null
    const statusRaw = (req.query.status as string | undefined) || null
    const status = statusRaw?.trim() || null

    const where: any = {
      assignees: {
        some: {
          userId: {
            in: departmentUserIds,
          },
        },
      },
    }

    // Optional: filter to a particular member (must be within the same department)
    if (memberId) {
      where.assignees = {
        some: {
          userId: memberId,
        },
      }
    }

    // Optional: status filter
    if (status && status !== 'all') {
      where.status = status
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
          { createdAt: 'desc' },
          { statusUpdatedAt: 'desc' },
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

    // Get current user's role + department (to exclude their own department)
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
    const isSuperAdmin = userRole === 'superadmin'

    // Only super admin can access all departments tasks
    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Only super admins can access all departments tasks' })
    }

    const currentUserDept = currentUser.department?.trim() || null
    const requestedDeptRaw = (req.query.department as string | undefined) || null
    const requestedDept = requestedDeptRaw?.trim() || null
    const memberIdRaw = (req.query.memberId as string | undefined) || null
    const memberId = memberIdRaw?.trim() || null

    // Build a single prisma where clause so "total" matches the task list.
    // "Other Department" means: exclude current user's department; optionally filter to a chosen department.
    const where =
      currentUserDept || requestedDept
        ? {
            assignees: {
              some: {
                user: {
                  department: {
                    ...(requestedDept ? { equals: requestedDept } : {}),
                    ...(currentUserDept ? { not: currentUserDept } : {}),
                  },
                },
              },
            },
          }
        : undefined

    // Optional: filter to a specific member (assignee userId)
    // Note: this will naturally be constrained by department rules above if department is selected.
    const whereWithMember =
      memberId
        ? {
            ...(where ?? {}),
            assignees: {
              some: {
                userId: memberId,
                ...(where?.assignees?.some?.user ? { user: where.assignees.some.user } : {}),
              },
            },
          }
        : where

    // Get tasks from other departments (optionally filtered by a specific department)
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where: whereWithMember,
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
          { createdAt: 'desc' },
          { statusUpdatedAt: 'desc' },
        ],
        take: limit,
        skip: skip,
      }),
      prisma.task.count(whereWithMember ? { where: whereWithMember } : undefined),
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
          { createdAt: 'desc' },
          { statusUpdatedAt: 'desc' },
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
        in: [TaskReviewStatus.REVIEW_REQUESTED, TaskReviewStatus.UNDER_REVIEW],
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
          { createdAt: 'desc' },
          { statusUpdatedAt: 'desc' },
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

    const { title, description, status, priority, startDate, dueDate, projectId, brand, tags, recurring, assignees, imageCount, videoCount, link, tasks } = req.body

    // Support both new format (tasks array) and old format (single title)
    let taskInputs: Array<{ title: string; description?: string | null; imageCount?: number; videoCount?: number }> = []

    if (tasks && Array.isArray(tasks) && tasks.length > 0) {
      // New format: tasks array
      taskInputs = tasks
        .map((t: any) => ({
          title: typeof t.title === 'string' ? t.title.trim() : '',
          description: typeof t.description === 'string' ? t.description.trim() : null,
          imageCount: typeof t.imageCount !== 'undefined' ? t.imageCount : undefined,
          videoCount: typeof t.videoCount !== 'undefined' ? t.videoCount : undefined,
        }))
        .filter((t: { title: string }) => t.title.length > 0)
    } else if (title && typeof title === 'string' && title.trim()) {
      // Old format: single title (backward compatibility) - treat as ONE task, no comma splitting
      taskInputs = [{
        title: title.trim(),
        description: description && typeof description === 'string' && description.trim() 
          ? description.trim() 
          : null,
      }]
    }

    if (taskInputs.length === 0) {
      return res.status(400).json({ error: 'At least one valid task title is required' })
    }

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
    const tasksToCreate = taskInputs.map((taskInput) => {
      // Use per-task imageCount/videoCount if available, otherwise fall back to top-level values
      const taskImageCount = taskInput.imageCount !== undefined ? parseCount(taskInput.imageCount) : parseCount(imageCount)
      const taskVideoCount = taskInput.videoCount !== undefined ? parseCount(taskInput.videoCount) : parseCount(videoCount)
      
      return {
        title: taskInput.title,
        description: taskInput.description && taskInput.description.trim() !== '' ? taskInput.description.trim() : null,
        status: status || 'IN_PROGRESS',
        priority: priority || 'MEDIUM',
        startDate: startDateValue,
        dueDate: dueDate && dueDate.trim() !== '' ? new Date(dueDate) : null,
        projectId: cleanProjectId,
        brand: cleanBrand,
        tags: cleanTags,
        recurring: cleanRecurring as any,
        imageCount: taskImageCount,
        videoCount: taskVideoCount,
        link: link && link.trim() !== '' ? link.trim() : null,
        createdById: req.userId!,
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

    // Get creator info for notifications
    const creator = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { name: true, email: true },
    })

    await Promise.all(
      createdTasks.map(async (task) => {
        // Log activity
        await logActivity({
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
          userId: req.userId!,
        })

        // Create notifications and send emails to assignees (excluding creator if they're assigned)
        if (task.assignees && task.assignees.length > 0) {
          const assigneeNotifications = task.assignees
            .filter((assignee) => assignee.userId !== req.userId) // Don't notify creator if they're assigned
            .map(async (assignee) => {
              const assigneeUser = assignee.user
              if (!assigneeUser || !assigneeUser.email) return

              // Create notification
              await prisma.notification.create({
                data: {
                  userId: assignee.userId,
                  type: 'TASK_ASSIGNED',
                  title: 'New Task Assigned',
                  message: `You have been assigned to task "${task.title}"${project ? ` in project "${project.name}"` : ''}`,
                  link: `/tasks/${task.id}`,
                },
              })

              // Send email notification
              try {
                const { microsoftGraphClient } = await import('../lib/microsoft-graph')
                const emailSubject = `New Task Assigned: ${task.title}`
                const emailBody = `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">New Task Assigned</h2>
                    <p>Hello ${assigneeUser.name || assigneeUser.email},</p>
                    <p>You have been assigned to a new task:</p>
                    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                      <p style="margin: 5px 0;"><strong>Task:</strong> ${task.title}</p>
                      ${task.description ? `<p style="margin: 5px 0;"><strong>Description:</strong> ${task.description}</p>` : ''}
                      ${project ? `<p style="margin: 5px 0;"><strong>Project:</strong> ${project.name}</p>` : ''}
                      <p style="margin: 5px 0;"><strong>Status:</strong> ${task.status}</p>
                      <p style="margin: 5px 0;"><strong>Priority:</strong> ${task.priority}</p>
                      ${task.dueDate ? `<p style="margin: 5px 0;"><strong>Due Date:</strong> ${new Date(task.dueDate).toLocaleDateString()}</p>` : ''}
                      ${creator ? `<p style="margin: 5px 0;"><strong>Assigned by:</strong> ${creator.name || creator.email}</p>` : ''}
                    </div>
                    <p><a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/tasks/${task.id}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Task</a></p>
                    <p style="color: #666; font-size: 12px; margin-top: 20px;">This is an automated notification from the Project Tracker system.</p>
                  </div>
                `
                await microsoftGraphClient.sendEmail(assigneeUser.email, null, emailSubject, emailBody)
                console.log(`Task assignment email sent to ${assigneeUser.email} for task "${task.title}"`)
              } catch (emailError: any) {
                console.error(`Failed to send task assignment email to ${assigneeUser.email}:`, emailError.message)
                // Don't fail the request if email fails
              }
            })

          await Promise.all(assigneeNotifications)
        }
      })
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

    // Sync status to corresponding request if this task was created from a request
    // Tasks created from requests have title format: [Request] {request.title}
    // and have [RequestID:{id}] in the description
    // Sync request status when task status changes
    if (isStatusChanged && status) {
      try {
        // Use old task description to find RequestID (since we're syncing based on the old task state)
        // The RequestID should be in the description when the task was created
        // When only status is updated, description is not sent, so we use oldTask.description
        const taskDescription = oldTask.description || ''
        
        // Try to extract request ID from description first (most reliable)
        let requestId: string | null = null
        if (taskDescription) {
          const requestIdMatch = taskDescription.match(/\[RequestID:([a-fA-F0-9]{24})\]/)
          if (requestIdMatch && requestIdMatch[1]) {
            requestId = requestIdMatch[1]
            console.log(`[Task Sync] Found RequestID in description: ${requestId}`)
          } else {
            console.log(`[Task Sync] No RequestID found in description. Task ID: ${task.id}, Title: ${oldTask.title}`)
            console.log(`[Task Sync] Description preview: ${taskDescription.substring(0, 200)}`)
          }
        } else {
          console.log(`[Task Sync] Task has no description. Task ID: ${task.id}, Title: ${oldTask.title}`)
        }

        // If no request ID in description, fall back to title matching (for tasks with [Request] prefix)
        let relatedRequest = null
        const taskTitle = task.title || oldTask.title
        if (requestId) {
          // Direct lookup by ID (most reliable)
          relatedRequest = await prisma.request.findUnique({
            where: { id: requestId },
          })
          console.log(`[Task Sync] Request lookup by ID ${requestId}:`, relatedRequest ? `Found (current status: ${relatedRequest.status})` : 'Not found')
        } else if (taskTitle.startsWith('[Request] ')) {
          // Fallback: Extract request title from task title and find by title + assignee
          const requestTitle = taskTitle.replace(/^\[Request\] /, '').trim()
          
          const taskAssignees = await prisma.taskAssignee.findMany({
            where: { taskId: task.id },
            select: { userId: true },
          })
          const assigneeIds = taskAssignees.map(a => a.userId)

          if (assigneeIds.length > 0) {
            relatedRequest = await prisma.request.findFirst({
              where: {
                title: requestTitle,
                assignedToId: { in: assigneeIds },
              },
            })
            console.log(`[Task Sync] Request lookup by title "${requestTitle}":`, relatedRequest ? `Found (current status: ${relatedRequest.status})` : 'Not found')
          }
        }
        
        // Map task status to request status
        let requestStatus: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'IN_PROGRESS' | 'WAITING_INFO' | 'COMPLETED' | 'CLOSED' | null = null
        if (status === 'YTS') {
          requestStatus = 'APPROVED' // Yet To Start -> Approved
        } else if (status === 'IN_PROGRESS') {
          requestStatus = 'IN_PROGRESS'
        } else if (status === 'ON_HOLD') {
          requestStatus = 'WAITING_INFO'
        } else if (status === 'COMPLETED') {
          requestStatus = 'COMPLETED'
        } else if (status === 'RECURRING') {
          requestStatus = 'IN_PROGRESS'
        }

        if (relatedRequest && requestStatus) {
          const updatedRequest = await prisma.request.update({
            where: { id: relatedRequest.id },
            data: { status: requestStatus },
            include: {
              createdBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  department: true,
                },
              },
              assignedTo: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  department: true,
                },
              },
              fromDepartment: {
                select: {
                  id: true,
                  name: true,
                },
              },
              toDepartment: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          })
          console.log(`[Task Sync] Successfully synced task "${task.id}" status "${status}" to request "${relatedRequest.id}" (status: ${relatedRequest.status} -> ${requestStatus})`)
          
          // Log activity for request status change from task
          if (req.userId) {
            try {
              const { logActivity } = await import('../utils/activityLogger')
              await logActivity({
                userId: req.userId,
                type: 'TASK_STATUS_CHANGED',
                action: 'Request Status Updated from Task',
                description: `Request "${relatedRequest.title}" status changed to ${requestStatus} via task update`,
                entityType: 'request',
                entityId: relatedRequest.id,
              })
            } catch (logError) {
              // Don't fail if logging fails
              console.error('Error logging request status change from task:', logError)
            }
          }
        } else {
          if (oldTask.title.startsWith('[Request] ') || (oldTask.description && oldTask.description.includes('[RequestID:'))) {
            console.warn(`[Task Sync] Could not find related request for task: ${task.id}, title: "${oldTask.title}"`)
            if (oldTask.description) {
              console.warn(`[Task Sync] Task description: ${oldTask.description.substring(0, 200)}`)
            }
          }
        }
      } catch (requestSyncError: any) {
        // Log error but don't fail the task update
        console.error('Error syncing task status to request:', requestSyncError)
      }
    }

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

    // Check if assignees were updated and send emails to new assignees
    if (Array.isArray(assignees) && updatedTask.assignees) {
      const oldAssigneeIds = new Set(oldTask.assignees?.map(a => a.userId) || [])
      const newAssigneeIds = new Set(updatedTask.assignees.map(a => a.userId))
      
      // Find newly assigned users (in new list but not in old list)
      const newlyAssigned = updatedTask.assignees.filter(
        assignee => !oldAssigneeIds.has(assignee.userId) && assignee.userId !== req.userId
      )

      if (newlyAssigned.length > 0) {
        // Get creator/updater info
        const updater = await prisma.user.findUnique({
          where: { id: req.userId },
          select: { name: true, email: true },
        })

        // Create notifications and send emails to newly assigned users
        await Promise.all(
          newlyAssigned.map(async (assignee) => {
            const assigneeUser = assignee.user
            if (!assigneeUser || !assigneeUser.email) return

            // Create notification
            await prisma.notification.create({
              data: {
                userId: assignee.userId,
                type: 'TASK_ASSIGNED',
                title: 'Task Assigned',
                message: `You have been assigned to task "${updatedTask.title}"${updatedTask.project ? ` in project "${updatedTask.project.name}"` : ''}`,
                link: `/tasks/${updatedTask.id}`,
              },
            })

            // Send email notification
            try {
              const { microsoftGraphClient } = await import('../lib/microsoft-graph')
              const emailSubject = `Task Assigned: ${updatedTask.title}`
              const emailBody = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #333;">Task Assigned</h2>
                  <p>Hello ${assigneeUser.name || assigneeUser.email},</p>
                  <p>You have been assigned to a task:</p>
                  <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <p style="margin: 5px 0;"><strong>Task:</strong> ${updatedTask.title}</p>
                    ${updatedTask.description ? `<p style="margin: 5px 0;"><strong>Description:</strong> ${updatedTask.description}</p>` : ''}
                    ${updatedTask.project ? `<p style="margin: 5px 0;"><strong>Project:</strong> ${updatedTask.project.name}</p>` : ''}
                    <p style="margin: 5px 0;"><strong>Status:</strong> ${updatedTask.status}</p>
                    <p style="margin: 5px 0;"><strong>Priority:</strong> ${updatedTask.priority}</p>
                    ${updatedTask.dueDate ? `<p style="margin: 5px 0;"><strong>Due Date:</strong> ${new Date(updatedTask.dueDate).toLocaleDateString()}</p>` : ''}
                    ${updater ? `<p style="margin: 5px 0;"><strong>Assigned by:</strong> ${updater.name || updater.email}</p>` : ''}
                  </div>
                  <p><a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/tasks/${updatedTask.id}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Task</a></p>
                  <p style="color: #666; font-size: 12px; margin-top: 20px;">This is an automated notification from the Project Tracker system.</p>
                </div>
              `
              await microsoftGraphClient.sendEmail(assigneeUser.email, null, emailSubject, emailBody)
              console.log(`Task assignment email sent to ${assigneeUser.email} for task "${updatedTask.title}"`)
            } catch (emailError: any) {
              console.error(`Failed to send task assignment email to ${assigneeUser.email}:`, emailError.message)
              // Don't fail the request if email fails
            }
          })
        )
      }
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

