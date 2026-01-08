import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

const mapRoleToEnum = (role?: string | null) => {
  if (!role) return 'USER'
  const normalized = role.toLowerCase()
  const mapping: Record<string, string> = {
    user: 'USER',
    admin: 'ADMIN',
    superadmin: 'SUPER_ADMIN',
  }
  return mapping[normalized] || role.toUpperCase()
}

const normalizeRoleInput = (role?: string | null) => {
  if (!role) return null
  const trimmed = role.trim().toLowerCase()
  if (trimmed === 'super_admin') return 'superadmin'
  if (trimmed === 'super-admin') return 'superadmin'
  return trimmed
}

const normalizeDepartmentName = (name?: string | null) => {
  if (!name) return null
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : null
}

const normalizeEmailInput = (email?: string | null) => {
  if (!email) return ''
  return email.trim().toLowerCase()
}

const isSuperAdmin = (role?: string | null) => role?.toLowerCase() === 'superadmin'
const isAdminOrSuperAdmin = (role?: string | null) => {
  const normalized = role?.toLowerCase()
  return normalized === 'admin' || normalized === 'superadmin'
}

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
        role: true,
        company: true,
        employeeId: true,
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

    const departments = await Promise.all(
      Array.from(departmentMap.values()).map(async (dept) => {
        const [userCount, projectCount] = await Promise.all([
          prisma.user.count({ where: { department: dept.name } }),
          prisma.project.count({ where: { department: dept.name } }),
        ])
        return { ...dept, userCount, projectCount }
      })
    )

    res.json(departments)
  } catch (error: any) {
    console.error('Error fetching departments:', error)
    const errorMessage = error?.message || 'Internal server error'
    res.status(500).json({ error: errorMessage })
  }
})

// Create a new department (super admin only)
router.post('/departments', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    if (!currentUser || !isSuperAdmin(currentUser.role)) {
      return res.status(403).json({ error: 'Only super admins can manage departments' })
    }

    const normalizedName = normalizeDepartmentName(req.body?.name)
    if (!normalizedName) {
      return res.status(400).json({ error: 'Department name is required' })
    }

    // Check if department model is available
    if (!prisma.department) {
      return res.status(500).json({ 
        error: 'Department model not available. Please run: npx prisma generate in the backend directory' 
      })
    }

    try {
      const existingDepartment = await prisma.department.findFirst({
        where: { name: { equals: normalizedName, mode: 'insensitive' } },
      })

      if (existingDepartment) {
        return res.status(409).json({ error: 'A department with this name already exists' })
      }

      // Check if any users/projects already have this department name (legacy)
      const existingUsers = await prisma.user.findFirst({
        where: { department: { equals: normalizedName, mode: 'insensitive' } },
      })

      if (existingUsers) {
        return res.status(409).json({ error: 'A department with this name already exists (in use by users/projects)' })
      }

      const department = await prisma.department.create({
        data: {
          name: normalizedName,
          createdById: req.userId,
        },
      })

      const [userCount, projectCount] = await Promise.all([
        prisma.user.count({ where: { department: department.name } }),
        prisma.project.count({ where: { department: department.name } }),
      ])

      res.status(201).json({ ...department, userCount, projectCount })
    } catch (deptError: any) {
      // If Department model doesn't exist, provide helpful error
      if (deptError?.code === 'P2001' || deptError?.code === 'P2002' || deptError?.message?.includes('model') || deptError?.message?.includes('Department')) {
        console.error('Department model error:', deptError)
        return res.status(500).json({ 
          error: 'Department model not available. Please run: npx prisma generate in the backend directory' 
        })
      }
      throw deptError
    }
  } catch (error: any) {
    console.error('Error creating department:', error)
    const errorMessage = error?.message || 'Internal server error'
    res.status(500).json({ error: errorMessage })
  }
})

// Delete a department (super admin only)
router.delete('/departments/:departmentId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    if (!currentUser || !isSuperAdmin(currentUser.role)) {
      return res.status(403).json({ error: 'Only super admins can delete departments' })
    }

    // Check if department model is available
    if (!prisma.department) {
      return res.status(500).json({ 
        error: 'Department model not available. Please run: npx prisma generate in the backend directory' 
      })
    }

    try {
      const department = await prisma.department.findUnique({
        where: { id: req.params.departmentId },
      })

      if (!department) {
        return res.status(404).json({ error: 'Department not found' })
      }

      const [userCount, projectCount] = await Promise.all([
        prisma.user.count({ where: { department: department.name } }),
        prisma.project.count({ where: { department: department.name } }),
      ])

      if (userCount > 0 || projectCount > 0) {
        return res.status(400).json({
          error: 'Cannot delete department while it is assigned to users or projects',
          userCount,
          projectCount,
        })
      }

      await prisma.department.delete({
        where: { id: req.params.departmentId },
      })

      res.json({ success: true })
    } catch (deptError: any) {
      // If Department model doesn't exist, provide helpful error
      if (deptError?.code === 'P2001' || deptError?.code === 'P2002' || deptError?.message?.includes('model') || deptError?.message?.includes('Department')) {
        console.error('Department model error:', deptError)
        return res.status(500).json({ 
          error: 'Department model not available. Please run: npx prisma generate in the backend directory' 
        })
      }
      throw deptError
    }
  } catch (error: any) {
    console.error('Error deleting department:', error)
    const errorMessage = error?.message || 'Internal server error'
    res.status(500).json({ error: errorMessage })
  }
})

// Update a department name (super admin only)
router.put('/departments/:departmentId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    if (!currentUser || !isSuperAdmin(currentUser.role)) {
      return res.status(403).json({ error: 'Only super admins can update departments' })
    }

    const normalizedName = normalizeDepartmentName(req.body?.name)
    if (!normalizedName) {
      return res.status(400).json({ error: 'Department name is required' })
    }

    // Check if department model is available
    if (!prisma.department) {
      return res.status(500).json({ 
        error: 'Department model not available. Please run: npx prisma generate in the backend directory' 
      })
    }

    try {
      const existing = await prisma.department.findUnique({
        where: { id: req.params.departmentId },
      })

      if (!existing) {
        return res.status(404).json({ error: 'Department not found' })
      }

      const oldDepartmentName = existing.name

      // Check for name conflicts
      const conflict = await prisma.department.findFirst({
        where: {
          id: { not: req.params.departmentId },
          name: { equals: normalizedName, mode: 'insensitive' },
        },
        select: { id: true },
      })

      if (conflict) {
        return res.status(409).json({ error: 'Another department with this name already exists' })
      }

      // Update the department record
      const updated = await prisma.department.update({
        where: { id: req.params.departmentId },
        data: { name: normalizedName },
      })

      // Update all users with the old department name to the new name
      const updateUsersResult = await prisma.user.updateMany({
        where: { department: oldDepartmentName },
        data: { department: normalizedName },
      })

      // Update all projects with the old department name to the new name
      const updateProjectsResult = await prisma.project.updateMany({
        where: { department: oldDepartmentName },
        data: { department: normalizedName },
      })

      const [userCount, projectCount] = await Promise.all([
        prisma.user.count({ where: { department: normalizedName } }),
        prisma.project.count({ where: { department: normalizedName } }),
      ])

      res.json({ 
        ...updated, 
        userCount, 
        projectCount,
        usersUpdated: updateUsersResult.count,
        projectsUpdated: updateProjectsResult.count,
      })
    } catch (deptError: any) {
      // If Department model doesn't exist, provide helpful error
      if (deptError?.code === 'P2001' || deptError?.code === 'P2002' || deptError?.message?.includes('model') || deptError?.message?.includes('Department')) {
        console.error('Department model error:', deptError)
        return res.status(500).json({ 
          error: 'Department model not available. Please run: npx prisma generate in the backend directory' 
        })
      }
      throw deptError
    }
  } catch (error: any) {
    console.error('Error updating department:', error)
    const errorMessage = error?.message || 'Internal server error'
    res.status(500).json({ error: errorMessage })
  }
})

// Get team members with statistics
router.get('/members', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const limit = parseInt(req.query.limit as string) || 20
    const skip = parseInt(req.query.skip as string) || 0
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
    const where: any = {
      isActive: true, // Only show active users
    }
    
    // Apply department filter first (before search)
    if (!isSuperAdmin && currentUser.department) {
      // Regular users: only show their department
      if (!department || department === 'all') {
        where.department = currentUser.department
      } else if (department && typeof department === 'string' && department !== 'all') {
        // If department filter is selected, use that (but only if it matches user's department)
        where.department = department === currentUser.department ? department : currentUser.department
      }
    } else if (isSuperAdmin) {
      // Super admin can see all departments or filter by selected department
      if (department && typeof department === 'string' && department !== 'all') {
        where.department = department
      }
      // If no department filter, show all (no where condition)
    }

    // Apply search filter in database query if possible
    if (search && typeof search === 'string') {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Get total count
    const total = await prisma.user.count({ where })

    // Get paginated users
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
        role: true,
        company: true,
        employeeId: true,
      },
      orderBy: {
        name: 'asc',
      },
      take: limit,
      skip: skip,
    })
    
    const userIds = users.map(u => u.id)
    
    // Optimized: Batch all queries instead of N+1 queries
    const [allTasks, allProjects, allCredentialMembers, allSubscriptionMembers, allUserData] = await Promise.all([
      // Get all tasks for all users at once
      prisma.task.findMany({
        where: {
          assignees: {
            some: {
              userId: { in: userIds },
            },
          },
        },
        select: {
          id: true,
          status: true,
          assignees: {
            select: {
              userId: true,
            },
          },
        },
      }),
      // Get all projects for all users at once
      prisma.projectMember.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, projectId: true },
      }),
      // Get all credential memberships at once
      prisma.credentialMember.findMany({
        where: { userId: { in: userIds } },
        include: {
          credential: {
            select: { id: true, company: true },
          },
        },
      }),
      // Get all subscription memberships at once
      prisma.subscriptionMember.findMany({
        where: { userId: { in: userIds } },
        include: {
          subscription: {
            select: { id: true, name: true },
          },
        },
      }),
      // Get all user permissions at once
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          hasCredentialAccess: true,
          hasSubscriptionAccess: true,
        },
      }),
    ])

    // Create lookup maps for O(1) access
    const tasksByUser = new Map<string, any[]>()
    const projectsByUser = new Map<string, number>()
    const credentialMembersByUser = new Map<string, any[]>()
    const subscriptionMembersByUser = new Map<string, any[]>()
    const userDataMap = new Map<string, any>()

    // Group tasks by user
    allTasks.forEach(task => {
      task.assignees.forEach((assignee: any) => {
        if (!tasksByUser.has(assignee.userId)) {
          tasksByUser.set(assignee.userId, [])
        }
        tasksByUser.get(assignee.userId)!.push(task)
      })
    })

    // Group projects by user
    allProjects.forEach(pm => {
      projectsByUser.set(pm.userId, (projectsByUser.get(pm.userId) || 0) + 1)
    })

    // Group credential members by user
    allCredentialMembers.forEach(cm => {
      const userId = (cm as any).userId
      if (!credentialMembersByUser.has(userId)) {
        credentialMembersByUser.set(userId, [])
      }
      credentialMembersByUser.get(userId)!.push(cm)
    })

    // Group subscription members by user
    allSubscriptionMembers.forEach(sm => {
      const userId = (sm as any).userId
      if (!subscriptionMembersByUser.has(userId)) {
        subscriptionMembersByUser.set(userId, [])
      }
      subscriptionMembersByUser.get(userId)!.push(sm)
    })

    // Map user data
    allUserData.forEach(ud => {
      userDataMap.set(ud.id, ud)
    })

    // Build response
    const teamMembers = users.map(user => {
      const userId = user.id
      const tasks = tasksByUser.get(userId) || []
      const projectsCount = projectsByUser.get(userId) || 0
      const credentialMembers = credentialMembersByUser.get(userId) || []
      const subscriptionMembers = subscriptionMembersByUser.get(userId) || []
      const userData = userDataMap.get(userId)

      return {
        id: userId,
        name: user.name,
        email: user.email,
        department: user.department,
        company: user.company,
        employeeId: user.employeeId,
        role: mapRoleToEnum(user.role),
        tasksAssigned: tasks.length,
        projectsInvolved: projectsCount,
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
        credentialMembers: credentialMembers.map((cm: any) => ({
          id: cm.id,
          credentialId: cm.credentialId,
          credentialName: cm.credential.company,
          isActive: cm.isActive,
        })),
        subscriptionMembers: subscriptionMembers.map((sm: any) => ({
          id: sm.id,
          subscriptionId: sm.subscriptionId,
          subscriptionName: sm.subscription.name,
          isActive: sm.isActive,
        })),
      }
    })

    res.json({
      members: teamMembers,
      total,
      hasMore: skip + teamMembers.length < total,
    })
  } catch (error) {
    console.error('Error fetching team members:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create a new team member (super admin only)
router.post('/members', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    if (!currentUser || !isSuperAdmin(currentUser.role)) {
      return res.status(403).json({ error: 'Only super admins can create members' })
    }

    const {
      name,
      email,
      password,
      department,
      company,
      employeeId,
      role,
      hasCredentialAccess,
      hasSubscriptionAccess,
    } = req.body

    const normalizedEmail = normalizeEmailInput(email)

    if (!normalizedEmail) {
      return res.status(400).json({ error: 'A valid email address is required' })
    }

    if (!password || typeof password !== 'string' || password.trim().length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' })
    }

    const normalizedRole = normalizeRoleInput(role) || 'user'
    const allowedRoles = ['user', 'admin', 'superadmin']
    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({ error: 'Invalid role. Allowed roles are USER, ADMIN, SUPER_ADMIN.' })
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (existingUser) {
      return res.status(400).json({ error: 'A user with this email already exists' })
    }

    const hashedPassword = await bcrypt.hash(password.trim(), 10)

    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        name: name?.trim() || null,
        department: department?.trim() || null,
        company: company?.trim() || null,
        employeeId: employeeId?.trim() || null,
        role: normalizedRole,
        hasCredentialAccess: Boolean(hasCredentialAccess),
        hasSubscriptionAccess: Boolean(hasSubscriptionAccess),
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
        company: true,
        employeeId: true,
        role: true,
        hasCredentialAccess: true,
        hasSubscriptionAccess: true,
      },
    })

    res.status(201).json({
      ...newUser,
      role: mapRoleToEnum(newUser.role),
    })
  } catch (error) {
    console.error('Error creating team member:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update member details (super admin only)
router.put('/members/:userId/details', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    if (!currentUser || !isSuperAdmin(currentUser.role)) {
      return res.status(403).json({ error: 'Only super admins can update member details' })
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: {
        id: true,
        role: true,
        email: true,
      },
    })

    if (!targetUser) {
      return res.status(404).json({ error: 'Team member not found' })
    }

    const {
      name,
      email,
      password,
      department,
      company,
      employeeId,
      role,
      hasCredentialAccess,
      hasSubscriptionAccess,
    } = req.body

    const updates: Record<string, any> = {}

    if (name !== undefined) {
      updates.name = name?.trim() || null
    }
    if (department !== undefined) {
      updates.department = department?.trim() || null
    }
    if (company !== undefined) {
      updates.company = company?.trim() || null
    }
    if (employeeId !== undefined) {
      updates.employeeId = employeeId?.trim() || null
    }

    if (email !== undefined) {
      const normalizedEmail = normalizeEmailInput(email)
      if (!normalizedEmail) {
        return res.status(400).json({ error: 'A valid email address is required' })
      }

      if (normalizedEmail !== targetUser.email) {
        const emailExists = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          select: { id: true },
        })

        if (emailExists && emailExists.id !== req.params.userId) {
          return res.status(400).json({ error: 'Another user already uses this email' })
        }
      }

      updates.email = normalizedEmail
    }

    if (password !== undefined) {
      if (password && typeof password === 'string' && password.trim().length >= 6) {
        updates.password = await bcrypt.hash(password.trim(), 10)
      } else if (password) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long' })
      }
    }

    if (role !== undefined) {
      const normalizedRole = normalizeRoleInput(role)
      const allowedRoles = ['user', 'admin', 'superadmin']
      if (!normalizedRole || !allowedRoles.includes(normalizedRole)) {
        return res.status(400).json({ error: 'Invalid role. Allowed roles are USER, ADMIN, SUPER_ADMIN.' })
      }
      updates.role = normalizedRole
    }

    if (hasCredentialAccess !== undefined) {
      updates.hasCredentialAccess = Boolean(hasCredentialAccess)
    }

    if (hasSubscriptionAccess !== undefined) {
      updates.hasSubscriptionAccess = Boolean(hasSubscriptionAccess)
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields provided to update' })
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.params.userId },
      data: updates,
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
        company: true,
        employeeId: true,
        role: true,
        hasCredentialAccess: true,
        hasSubscriptionAccess: true,
      },
    })

    res.json({
      ...updatedUser,
      role: mapRoleToEnum(updatedUser.role),
    })
  } catch (error) {
    console.error('Error updating team member details:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update member department (admin or super admin)
router.put('/members/:userId/department', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    if (!currentUser || !isAdminOrSuperAdmin(currentUser.role)) {
      return res.status(403).json({ error: 'Only admins can update departments' })
    }

    const normalizedDepartment = normalizeDepartmentName(req.body?.department)

    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: {
        id: true,
        role: true,
        email: true,
      },
    })

    if (!targetUser) {
      return res.status(404).json({ error: 'Team member not found' })
    }

    let resolvedDepartment = normalizedDepartment

    // Try to find or create department record if department name is provided
    if (normalizedDepartment) {
      try {
        let departmentRecord = await prisma.department.findFirst({
          where: { name: { equals: normalizedDepartment, mode: 'insensitive' } },
        })

        if (!departmentRecord) {
          departmentRecord = await prisma.department.create({
            data: {
              name: normalizedDepartment,
              createdById: req.userId,
            },
          })
        }

        resolvedDepartment = departmentRecord.name
      } catch (deptError: any) {
        // If Department model doesn't exist or Prisma client not regenerated, 
        // fall back to using the department name directly (legacy mode)
        console.warn('Department model not available, using legacy mode:', deptError.message)
        resolvedDepartment = normalizedDepartment
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.params.userId },
      data: { department: resolvedDepartment || null },
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
        company: true,
        employeeId: true,
        role: true,
        hasCredentialAccess: true,
        hasSubscriptionAccess: true,
      },
    })

    res.json({
      ...updatedUser,
      role: mapRoleToEnum(updatedUser.role),
    })
  } catch (error: any) {
    console.error('Error updating member department:', error)
    const errorMessage = error?.message || 'Internal server error'
    res.status(500).json({ error: errorMessage })
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

// Update user role (admin/super admin only)
router.put('/members/:userId/role', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' })
    }

    const currentUserRole = currentUser.role?.toLowerCase()
    const allowedRoles = ['user', 'admin', 'superadmin']
    if (currentUserRole !== 'admin' && currentUserRole !== 'superadmin') {
      return res.status(403).json({ error: 'Only admins can update roles' })
    }

    const { role } = req.body as { role?: string }
    const normalizedRole = normalizeRoleInput(role)

    if (!normalizedRole || !allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({ error: 'Invalid role. Allowed roles are USER, ADMIN, SUPER_ADMIN.' })
    }

    if (normalizedRole === 'superadmin' && currentUserRole !== 'superadmin') {
      return res.status(403).json({ error: 'Only super admins can assign the SUPER_ADMIN role' })
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: { id: true, role: true, email: true, name: true, department: true },
    })

    if (!targetUser) {
      return res.status(404).json({ error: 'Target user not found' })
    }

    if (targetUser.role?.toLowerCase() === 'superadmin' && currentUserRole !== 'superadmin') {
      return res.status(403).json({ error: 'Only super admins can modify another super admin' })
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.params.userId },
      data: { role: normalizedRole },
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
        role: true,
      },
    })

    res.json({
      ...updatedUser,
      role: mapRoleToEnum(updatedUser.role),
    })
  } catch (error) {
    console.error('Error updating user role:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Deactivate user (admin/super admin only)
router.delete('/members/:userId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' })
    }

    const currentUserRole = currentUser.role?.toLowerCase()
    if (currentUserRole !== 'admin' && currentUserRole !== 'superadmin') {
      return res.status(403).json({ error: 'Only admins can deactivate members' })
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: { id: true, role: true },
    })

    if (!targetUser) {
      return res.status(404).json({ error: 'Target user not found' })
    }

    if (targetUser.id === req.userId) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' })
    }

    if (targetUser.role?.toLowerCase() === 'superadmin' && currentUserRole !== 'superadmin') {
      return res.status(403).json({ error: 'Only super admins can deactivate another super admin' })
    }

    await prisma.user.update({
      where: { id: req.params.userId },
      data: { isActive: false },
    })

    res.json({ success: true })
  } catch (error) {
    console.error('Error deactivating user:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router

