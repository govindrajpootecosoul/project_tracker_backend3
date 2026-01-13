import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { logActivity } from '../utils/activityLogger'

// Utility: validate Mongo ObjectId strings (24 hex characters)
const isValidObjectId = (value?: string | null) => {
  if (!value) return false
  return /^[a-fA-F0-9]{24}$/.test(value.trim())
}

const router = Router()

// Get all requests (sent by user)
router.get('/sent', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check if Request model exists in Prisma client
    if (!('request' in prisma)) {
      console.error('Request model not found in Prisma client. Please run: npx prisma generate')
      return res.status(500).json({ 
        error: 'Request model not available. Please run "npx prisma generate" in the backend directory and restart the server.' 
      })
    }

    const requests = await prisma.request.findMany({
      where: {
        createdById: req.userId,
      },
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
      orderBy: {
        createdAt: 'desc',
      },
    })

    res.json(requests)
  } catch (error: any) {
    console.error('Error fetching sent requests:', error)
    const errorMessage = error?.message || 'Internal server error'
    // Check if it's a Prisma model not found error
    if (errorMessage.includes('request') || errorMessage.includes('Request')) {
      return res.status(500).json({ 
        error: 'Request model not available. Please run "npx prisma generate" in the backend directory and restart the server.',
        details: errorMessage
      })
    }
    res.status(500).json({ error: errorMessage })
  }
})

// Get all requests (received by user's department or assigned to user)
router.get('/received', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { department: true, role: true },
    })

    if (!currentUser) {
      return res.status(401).json({ error: 'User not found' })
    }

    // Build where clause: requests assigned to user OR to user's department
    const where: any = {
      OR: [
        { assignedToId: req.userId },
      ],
    }

    // If user has a department, also include requests to that department
    if (currentUser.department) {
      // Find department ID by name
      const department = await prisma.department.findFirst({
        where: { name: currentUser.department },
      })

      if (department) {
        where.OR.push({ toDepartmentId: department.id })
      }
    }

    const requests = await prisma.request.findMany({
      where,
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
      orderBy: {
        createdAt: 'desc',
      },
    })

    res.json(requests)
  } catch (error: any) {
    console.error('Error fetching received requests:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get department admins for a specific department (by ID or name)
router.get('/department-admins/:departmentIdOrName', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { departmentIdOrName } = req.params
    let departmentName: string | null = null

    // Try to find department by ID first (only if valid ObjectId)
    if (isValidObjectId(departmentIdOrName)) {
      const department = await prisma.department.findUnique({
        where: { id: departmentIdOrName },
      })
      if (department) {
        departmentName = department.name
      }
    }

    // If still no department name, try using the ID as name (for legacy departments)
    if (!departmentName) {
      departmentName = departmentIdOrName
    }

    // Get all admins (admin or superadmin) in this department
    const admins = await prisma.user.findMany({
      where: {
        department: departmentName,
        role: {
          in: ['admin', 'superadmin'],
        },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
      orderBy: {
        name: 'asc',
      },
    })

    res.json(admins)
  } catch (error: any) {
    console.error('Error fetching department admins:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create a new request
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check if Request model exists in Prisma client
    if (!('request' in prisma)) {
      console.error('Request model not found in Prisma client. Please run: npx prisma generate')
      return res.status(500).json({ 
        error: 'Request model not available. Please run "npx prisma generate" in the backend directory and restart the server.' 
      })
    }

    const {
      title,
      description,
      requestType,
      priority,
      toDepartmentId,
      assignedToId,
    } = req.body

    // Validation
    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' })
    }

    if (!requestType || !['AUTOMATION', 'DATA', 'ACCESS', 'SUPPORT', 'OTHER'].includes(requestType)) {
      return res.status(400).json({ error: 'Valid request type is required' })
    }

    if (!priority || !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(priority)) {
      return res.status(400).json({ error: 'Valid priority is required' })
    }

    // Get current user's department
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { department: true },
    })

    let fromDepartmentId: string | null = null
    if (currentUser?.department) {
      let fromDept = await prisma.department.findFirst({
        where: { name: currentUser.department },
      })
      
      // If department doesn't exist, create it
      if (!fromDept) {
        try {
          fromDept = await prisma.department.create({
            data: {
              name: currentUser.department,
              createdById: req.userId,
            },
          })
        } catch (error: any) {
          // If creation fails (e.g., duplicate), try to find it again
          fromDept = await prisma.department.findFirst({
            where: { name: currentUser.department },
          })
        }
      }
      
      fromDepartmentId = fromDept?.id || null
    }

    // Verify toDepartmentId exists (can be ID or name)
    let toDeptId: string | null = null
    if (toDepartmentId) {
      // Try by ID only if it is a valid ObjectId; otherwise skip to name/legacy lookup
      let toDept = null
      if (isValidObjectId(toDepartmentId)) {
        toDept = await prisma.department.findUnique({
          where: { id: toDepartmentId },
        })
      }
      
      // If not found by ID, try by name (for legacy departments)
      if (!toDept) {
        toDept = await prisma.department.findFirst({
          where: { name: toDepartmentId },
        })
      }
      
      // If still not found, check if it's a legacy department name (exists in users/projects but not in Department model)
      if (!toDept) {
        const userWithDept = await prisma.user.findFirst({
          where: { department: toDepartmentId },
        })
        const projectWithDept = await prisma.project.findFirst({
          where: { department: toDepartmentId },
        })
        
        if (userWithDept || projectWithDept) {
          // It's a valid legacy department, create it in the Department model
          try {
            const newDept = await prisma.department.create({
              data: {
                name: toDepartmentId,
                createdById: req.userId,
              },
            })
            toDeptId = newDept.id
          } catch (error: any) {
            // If creation fails (e.g., duplicate), try to find it again
            const existingDept = await prisma.department.findFirst({
              where: { name: toDepartmentId },
            })
            if (existingDept) {
              toDeptId = existingDept.id
            } else {
              return res.status(400).json({ error: 'Failed to create or find target department' })
            }
          }
        } else {
          return res.status(400).json({ error: 'Target department not found' })
        }
      } else {
        toDeptId = toDept.id
      }
    }

    // Verify assignedToId if provided
    if (assignedToId) {
      const assignedUser = await prisma.user.findUnique({
        where: { id: assignedToId },
      })
      if (!assignedUser) {
        return res.status(400).json({ error: 'Assigned user not found' })
      }
    }

    const request = await prisma.request.create({
      data: {
        title,
        description,
        requestType,
        priority,
        status: 'SUBMITTED',
        fromDepartmentId,
        toDepartmentId: toDeptId,
        createdById: req.userId,
        assignedToId: assignedToId || null,
      },
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

    // Log activity
    await logActivity({
      userId: req.userId,
      type: 'TASK_CREATED', // Reusing activity type
      action: 'Request Created',
      description: `Request "${title}" created`,
      entityType: 'request',
      entityId: request.id,
    })

    res.status(201).json(request)
  } catch (error: any) {
    console.error('Error creating request:', error)
    // Check if it's a Prisma model not found error
    if (error?.message?.includes('request') || error?.message?.includes('Request') || error?.code === 'P2001') {
      return res.status(500).json({ 
        error: 'Request model not available. Please run "npx prisma generate" in the backend directory and restart the server.',
        details: error.message
      })
    }
    // Check if it's a validation error
    if (error?.code === 'P2002') {
      return res.status(400).json({ 
        error: 'A request with this information already exists',
        details: error.message
      })
    }
    const errorMessage = error?.message || 'Internal server error'
    res.status(500).json({ error: errorMessage, details: error?.code || 'Unknown error' })
  }
})

// Update request tentative deadline
router.patch('/:id/deadline', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check if Request model exists in Prisma client
    if (!('request' in prisma)) {
      console.error('Request model not found in Prisma client. Please run: npx prisma generate')
      return res.status(500).json({ 
        error: 'Request model not available. Please run "npx prisma generate" in the backend directory and restart the server.' 
      })
    }

    const { id } = req.params
    const { tentativeDeadline } = req.body

    // Get the request
    const request = await prisma.request.findUnique({
      where: { id },
      include: {
        assignedTo: true,
        toDepartment: true,
      },
    })

    if (!request) {
      return res.status(404).json({ error: 'Request not found' })
    }

    // Check if user can update deadline (must be assigned to the request or admin in target department)
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true, department: true },
    })

    const canUpdate =
      request.assignedToId === req.userId ||
      (currentUser?.role?.toLowerCase() === 'admin' && request.toDepartment?.name === currentUser.department) ||
      currentUser?.role?.toLowerCase() === 'superadmin'

    if (!canUpdate) {
      return res.status(403).json({ error: 'You do not have permission to update this request deadline' })
    }

    // Parse the date string properly
    let deadlineDate: Date | null = null
    if (tentativeDeadline) {
      try {
        deadlineDate = new Date(tentativeDeadline)
        // Validate the date
        if (isNaN(deadlineDate.getTime())) {
          return res.status(400).json({ error: 'Invalid date format' })
        }
      } catch (dateError) {
        return res.status(400).json({ error: 'Invalid date format' })
      }
    }

    const updatedRequest = await prisma.request.update({
      where: { id },
      data: { 
        tentativeDeadline: deadlineDate
      },
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

    // Log activity
    await logActivity({
      userId: req.userId,
      type: 'TASK_UPDATED',
      action: 'Request Deadline Updated',
      description: `Request "${request.title}" tentative deadline ${tentativeDeadline ? `set to ${tentativeDeadline}` : 'removed'}`,
      entityType: 'request',
      entityId: request.id,
    })

    res.json(updatedRequest)
  } catch (error: any) {
    console.error('Error updating request deadline:', error)
    // Check if it's a Prisma field not found error
    if (error?.message?.includes('tentativeDeadline') || error?.code === 'P2009' || error?.code === 'P2016') {
      return res.status(500).json({ 
        error: 'Tentative deadline field not available. Please run "npx prisma generate" and "npx prisma db push" in the backend directory and restart the server.',
        details: error.message
      })
    }
    const errorMessage = error?.message || 'Internal server error'
    res.status(500).json({ error: errorMessage, details: error?.code || 'Unknown error' })
  }
})

// Update request status
router.patch('/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { id } = req.params
    let { status } = req.body

    // Accept both request statuses and task statuses, map task statuses to request statuses
    const validRequestStatuses = ['SUBMITTED', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'WAITING_INFO', 'COMPLETED', 'CLOSED']
    const validTaskStatuses = ['YTS', 'IN_PROGRESS', 'ON_HOLD', 'RECURRING', 'COMPLETED']
    
    if (!status) {
      return res.status(400).json({ error: 'Valid status is required' })
    }

    // Map task status to request status if needed
    if (validTaskStatuses.includes(status)) {
      if (status === 'YTS') {
        status = 'APPROVED'
      } else if (status === 'ON_HOLD') {
        status = 'WAITING_INFO'
      } else if (status === 'RECURRING') {
        status = 'IN_PROGRESS'
      }
      // IN_PROGRESS and COMPLETED are the same in both
    }

    if (!validRequestStatuses.includes(status)) {
      return res.status(400).json({ error: 'Valid status is required' })
    }

    // Get the request
    const request = await prisma.request.findUnique({
      where: { id },
      include: {
        assignedTo: true,
        toDepartment: true,
      },
    })

    if (!request) {
      return res.status(404).json({ error: 'Request not found' })
    }

    // Check if user can update status (must be assigned to the request or admin in target department)
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true, department: true },
    })

    const canUpdate =
      request.assignedToId === req.userId ||
      (currentUser?.role?.toLowerCase() === 'admin' && request.toDepartment?.name === currentUser.department) ||
      currentUser?.role?.toLowerCase() === 'superadmin'

    if (!canUpdate) {
      return res.status(403).json({ error: 'You do not have permission to update this request status' })
    }

    const updatedRequest = await prisma.request.update({
      where: { id },
      data: { status },
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

    // Sync status to corresponding task(s) if they exist
    // Tasks created from requests have title format: [Request] {request.title}
    try {
      const taskTitlePattern = `[Request] ${request.title}`
      
      // Map request status to task status
      let taskStatus: 'IN_PROGRESS' | 'COMPLETED' | 'YTS' | 'ON_HOLD' | 'RECURRING' | null = null
      if (status === 'SUBMITTED' || status === 'APPROVED') {
        taskStatus = 'YTS' // Yet To Start
      } else if (status === 'IN_PROGRESS') {
        taskStatus = 'IN_PROGRESS'
      } else if (status === 'WAITING_INFO') {
        taskStatus = 'ON_HOLD'
      } else if (status === 'COMPLETED' || status === 'CLOSED') {
        taskStatus = 'COMPLETED'
      } else if (status === 'REJECTED') {
        taskStatus = 'ON_HOLD'
      }

      if (taskStatus) {
        // Find tasks with matching title pattern
        const relatedTasks = await prisma.task.findMany({
          where: {
            title: taskTitlePattern,
            assignees: request.assignedToId ? {
              some: {
                userId: request.assignedToId,
              },
            } : undefined,
          },
        })

        // Update all related tasks
        if (relatedTasks.length > 0) {
          await Promise.all(
            relatedTasks.map(task =>
              prisma.task.update({
                where: { id: task.id },
                data: { 
                  status: taskStatus,
                  statusUpdatedAt: new Date(),
                },
              })
            )
          )
          console.log(`Synced request status to ${relatedTasks.length} task(s)`)
        }
      }
    } catch (taskSyncError: any) {
      // Log error but don't fail the request update
      console.error('Error syncing request status to tasks:', taskSyncError)
    }

    // Log activity
    await logActivity({
      userId: req.userId,
      type: 'TASK_STATUS_CHANGED',
      action: 'Request Status Updated',
      description: `Request "${request.title}" status changed to ${status}`,
      entityType: 'request',
      entityId: request.id,
    })

    res.json(updatedRequest)
  } catch (error: any) {
    console.error('Error updating request status:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete request (only by creator)
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { id } = req.params

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid request ID' })
    }

    // Check if Request model exists in Prisma client
    if (!('request' in prisma)) {
      console.error('Request model not found in Prisma client. Please run: npx prisma generate')
      return res.status(500).json({ 
        error: 'Request model not available. Please run "npx prisma generate" in the backend directory and restart the server.' 
      })
    }

    // Get the request
    const request = await prisma.request.findUnique({
      where: { id },
    })

    if (!request) {
      return res.status(404).json({ error: 'Request not found' })
    }

    // Only the creator can delete the request
    if (request.createdById !== req.userId) {
      return res.status(403).json({ error: 'You can only delete requests you created' })
    }

    // Delete the request
    await prisma.request.delete({
      where: { id },
    })

    // Log activity
    await logActivity({
      userId: req.userId,
      type: 'TASK_DELETED',
      action: 'Request Deleted',
      description: `Request "${request.title}" was deleted`,
      entityType: 'request',
      entityId: request.id,
    })

    res.json({ message: 'Request deleted successfully' })
  } catch (error: any) {
    console.error('Error deleting request:', error)
    const errorMessage = error?.message || 'Internal server error'
    res.status(500).json({ error: errorMessage, details: error?.code || 'Unknown error' })
  }
})

// Update request assignment (assign to team member)
router.patch('/:id/assign', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { id } = req.params
    const { assignedToId } = req.body

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid request ID' })
    }

    // Check if Request model exists in Prisma client
    if (!('request' in prisma)) {
      console.error('Request model not found in Prisma client. Please run: npx prisma generate')
      return res.status(500).json({ 
        error: 'Request model not available. Please run "npx prisma generate" in the backend directory and restart the server.' 
      })
    }

    // Get the request
    const request = await prisma.request.findUnique({
      where: { id },
      include: {
        toDepartment: true,
        assignedTo: true,
      },
    })

    if (!request) {
      return res.status(404).json({ error: 'Request not found' })
    }

    // Check permissions: only admin in target department or superadmin can assign
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true, department: true },
    })

    const canAssign =
      (currentUser?.role?.toLowerCase() === 'admin' && request.toDepartment?.name === currentUser.department) ||
      currentUser?.role?.toLowerCase() === 'superadmin' ||
      request.assignedToId === req.userId // Current assignee can reassign

    if (!canAssign) {
      return res.status(403).json({ error: 'You do not have permission to assign this request' })
    }

    // Verify assignedToId if provided
    let assignedUser = null
    if (assignedToId) {
      if (!isValidObjectId(assignedToId)) {
        return res.status(400).json({ error: 'Invalid assigned user ID' })
      }
      assignedUser = await prisma.user.findUnique({
        where: { id: assignedToId },
        select: { id: true, name: true, email: true, department: true },
      })
      if (!assignedUser) {
        return res.status(400).json({ error: 'Assigned user not found' })
      }
    }

    // Update the request
    const updatedRequest = await prisma.request.update({
      where: { id },
      data: { assignedToId: assignedToId || null },
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

    // Log activity
    await logActivity({
      userId: req.userId,
      type: 'TASK_STATUS_CHANGED',
      action: 'Request Assigned',
      description: `Request "${request.title}" ${assignedToId ? `assigned to ${assignedUser?.name || assignedUser?.email}` : 'unassigned'}`,
      entityType: 'request',
      entityId: request.id,
    })

    res.json(updatedRequest)
  } catch (error: any) {
    console.error('Error updating request assignment:', error)
    const errorMessage = error?.message || 'Internal server error'
    res.status(500).json({ error: errorMessage, details: error?.code || 'Unknown error' })
  }
})

// Get all departments (same logic as team/departments to include legacy departments)
router.get('/departments', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    let departmentRecords: { id: string; name: string }[] = []
    
    // Try to fetch managed departments, but fall back to legacy if model doesn't exist
    try {
      departmentRecords = await prisma.department.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    } catch (deptError: any) {
      // If Department model doesn't exist, just use empty array (will fall back to legacy)
      console.warn('Department model not available, using legacy mode:', deptError?.message || 'Unknown error')
    }

    const [userDepartments, projectDepartments] = await Promise.all([
      prisma.user.findMany({
        where: { department: { not: null } },
        select: { department: true },
        distinct: ['department'],
      }),
      prisma.project.findMany({
        where: { department: { not: null } },
        select: { department: true },
        distinct: ['department'],
      }),
    ])

    const departmentMap = new Map<string, { id?: string; name: string }>()

    // Add managed departments
    departmentRecords.forEach((dept) => {
      const normalized = dept.name.toLowerCase()
      departmentMap.set(normalized, { id: dept.id, name: dept.name })
    })

    // Add any departments that exist only via legacy user/project data
    const legacyDepartments = [...userDepartments, ...projectDepartments]
      .map((entry) => entry.department)
      .filter((dept): dept is string => Boolean(dept))

    legacyDepartments.forEach((deptName) => {
      const normalized = deptName.toLowerCase()
      if (!departmentMap.has(normalized)) {
        departmentMap.set(normalized, { name: deptName })
      }
    })

    const departments = Array.from(departmentMap.values()).map((dept) => ({
      id: dept.id || null,
      name: dept.name,
    }))

    res.json(departments)
  } catch (error: any) {
    console.error('Error fetching departments:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router

