import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

// AI query endpoint - processes natural language queries about tasks
router.post('/ai/query', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { query } = req.body

    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'Query is required' })
    }

    const queryLower = query.toLowerCase()

    // Check if this is a task creation request
    const createPatterns = [
      /(?:create|add|make|new)\s+(?:a\s+)?task\s+(?:for|to|assigned to|assign to)\s+(.+)/i,
      /(?:create|add|make|new)\s+(?:a\s+)?task\s+(?:called|named|titled)\s+(.+)/i,
      /(?:add|create|make)\s+(.+)\s+(?:as\s+)?(?:a\s+)?task\s+(?:for|to|assigned to|assign to)\s+(.+)/i,
    ]

    let isCreateRequest = false
    let taskTitle: string | null = null
    let assigneeIdentifier: string | null = null

    for (const pattern of createPatterns) {
      const match = query.match(pattern)
      if (match) {
        isCreateRequest = true
        if (match.length > 2) {
          // Pattern with both title and assignee
          taskTitle = match[1].trim()
          assigneeIdentifier = match[2]?.trim() || null
        } else if (match[1]) {
          // Pattern with assignee or title
          const content = match[1].trim()
          // Try to detect if it's an assignee (email or name) or title
          if (content.includes('@') || /^[A-Z][a-z]+/.test(content)) {
            assigneeIdentifier = content
          } else {
            taskTitle = content
          }
        }
        break
      }
    }

    // If it's a create request, handle it
    if (isCreateRequest) {
      // Extract task details from query
      let status: string = 'IN_PROGRESS'
      let priority: string = 'MEDIUM'
      let dueDate: string | null = null
      let projectId: string | null = null

      // Extract status
      if (queryLower.includes('completed') || queryLower.includes('done')) {
        status = 'COMPLETED'
      } else if (queryLower.includes('in progress') || queryLower.includes('working')) {
        status = 'IN_PROGRESS'
      } else if (queryLower.includes('pending') || queryLower.includes('yet to start') || queryLower.includes('yts')) {
        status = 'YTS'
      } else if (queryLower.includes('on hold') || queryLower.includes('paused')) {
        status = 'ON_HOLD'
      } else if (queryLower.includes('recurring')) {
        status = 'RECURRING'
      }

      // Extract priority
      if (queryLower.includes('high priority') || queryLower.includes('urgent') || queryLower.includes('important')) {
        priority = 'HIGH'
      } else if (queryLower.includes('low priority')) {
        priority = 'LOW'
      } else if (queryLower.includes('medium priority') || queryLower.includes('normal')) {
        priority = 'MEDIUM'
      }

      // Extract due date (simple patterns)
      const todayMatch = queryLower.match(/due\s+(?:today|now)/i)
      const weekMatch = queryLower.match(/due\s+(?:this\s+week|next\s+week)/i)
      const dateMatch = query.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)

      if (todayMatch) {
        const today = new Date()
        dueDate = today.toISOString()
      } else if (weekMatch) {
        const today = new Date()
        const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
        dueDate = nextWeek.toISOString()
      } else if (dateMatch) {
        const dateStr = dateMatch[1]
        const parsedDate = new Date(dateStr)
        if (!isNaN(parsedDate.getTime())) {
          dueDate = parsedDate.toISOString()
        }
      }

      // Find assignee user
      let assigneeUserId: string | null = null
      let assigneeUserName: string | null = null

      if (assigneeIdentifier) {
        const allUsers = await prisma.user.findMany({
          select: { id: true, name: true, email: true },
        })

        const user = allUsers.find((u: { id: string; name: string | null; email: string }) => 
          u.email.toLowerCase().includes(assigneeIdentifier!.toLowerCase()) ||
          (u.name && u.name.toLowerCase().includes(assigneeIdentifier!.toLowerCase()))
        )

        if (user) {
          assigneeUserId = user.id
          assigneeUserName = user.name || user.email
        } else {
          // If assignee not found, use current user
          assigneeUserId = req.userId
        }
      } else {
        // No assignee mentioned, use current user
        assigneeUserId = req.userId
      }

      // If task title is not extracted, try to extract it from the query
      if (!taskTitle) {
        // Try to extract title from various patterns
        const titlePatterns = [
          /(?:create|add|make|new)\s+(?:a\s+)?task\s+(?:called|named|titled|about)\s+"?([^"]+)"?/i,
          /(?:create|add|make|new)\s+(?:a\s+)?task:\s*(.+)/i,
          /task:\s*(.+)/i,
        ]

        for (const pattern of titlePatterns) {
          const match = query.match(pattern)
          if (match && match[1]) {
            taskTitle = match[1].trim()
            // Remove common trailing phrases
            if (taskTitle) {
              taskTitle = taskTitle.replace(/\s+(?:for|to|assigned to|assign to).*$/i, '').trim()
            }
            break
          }
        }

        // If still no title, use a default or ask for clarification
        if (!taskTitle) {
          return res.json({
            success: false,
            query: query,
            message: 'Please provide a task title. Example: "Create a task called Review document for John"',
            requiresInput: true,
            inputType: 'task_creation',
            fields: {
              title: { required: true, label: 'Task Title' },
              status: { required: false, label: 'Status', options: ['IN_PROGRESS', 'YTS', 'ON_HOLD', 'RECURRING'] },
              priority: { required: false, label: 'Priority', options: ['HIGH', 'MEDIUM', 'LOW'] },
              assignee: { required: false, label: 'Assign To (User Name or Email)' },
              dueDate: { required: false, label: 'Due Date (MM/DD/YYYY)' },
            },
          })
        }
      }

      // Create the task
      const task = await prisma.task.create({
        data: {
          title: taskTitle,
          status: status as any,
          priority: priority as any,
          dueDate: dueDate ? new Date(dueDate) : null,
          projectId: projectId,
          createdById: req.userId,
          assignees: {
            create: [{ userId: assigneeUserId }],
          },
        },
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
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })

      return res.json({
        success: true,
        query: query,
        action: 'created',
        task: task,
        message: `Task "${taskTitle}" created successfully${assigneeUserName ? ` for ${assigneeUserName}` : ''}`,
      })
    }

    // Original query logic for searching tasks and other entities
    const queryLower2 = query.toLowerCase()

    // Helper function to find user by mention (@mention, name, or email)
    const findUserByMention = async (mention: string): Promise<{ id: string; name: string | null; email: string } | null> => {
      // Remove @ symbol if present
      const cleanMention = mention.replace(/^@/, '').trim()
      
      // Fetch all users
      const allUsers = await prisma.user.findMany({
        select: { id: true, name: true, email: true },
      })

      // First, try exact match (case-insensitive)
      // Check full name match first
      const exactNameMatch = allUsers.find((u: { id: string; name: string | null; email: string }) => 
        u.name && u.name.toLowerCase() === cleanMention.toLowerCase()
      )
      if (exactNameMatch) return exactNameMatch

      // Check exact email match
      const exactEmailMatch = allUsers.find((u: { id: string; name: string | null; email: string }) => 
        u.email.toLowerCase() === cleanMention.toLowerCase()
      )
      if (exactEmailMatch) return exactEmailMatch

      // If mention contains space, try to match first name + last name
      if (cleanMention.includes(' ')) {
        const nameParts = cleanMention.toLowerCase().split(' ').filter(p => p.length > 0)
        if (nameParts.length >= 2) {
          const firstName = nameParts[0]
          const lastName = nameParts[nameParts.length - 1]
          
          // Try to find user where first name matches first part and last name matches last part
          const fullNameMatch = allUsers.find((u: { id: string; name: string | null; email: string }) => {
            if (!u.name) return false
            const userNameParts = u.name.toLowerCase().split(' ').filter(p => p.length > 0)
            if (userNameParts.length >= 2) {
              return userNameParts[0] === firstName && userNameParts[userNameParts.length - 1] === lastName
            }
            return false
          })
          if (fullNameMatch) return fullNameMatch
        }
      }

      // Try partial match on full name (contains check)
      const partialNameMatch = allUsers.find((u: { id: string; name: string | null; email: string }) => 
        u.name && u.name.toLowerCase().includes(cleanMention.toLowerCase())
      )
      if (partialNameMatch) return partialNameMatch

      // Try partial match on email
      const partialEmailMatch = allUsers.find((u: { id: string; name: string | null; email: string }) => 
        u.email.toLowerCase().includes(cleanMention.toLowerCase())
      )

      return partialEmailMatch || null
    }

    // Extract user name/email from query (supports @mentions, names, emails)
    // Patterns: "tasks for @John", "tasks for John", "show tasks for user@example.com", etc.
    let targetUserId: string | null = null
    let targetUserName: string | null = null

    // Get current user data first for comparison
    const currentUserData = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true, email: true },
    })

    // Check if query mentions "me" or "my" - default to logged-in user
    const queryLowerForMe = query.toLowerCase()
    if (queryLowerForMe.includes(' for me') || 
        queryLowerForMe.includes(' about me') || 
        queryLowerForMe.includes(' my ') ||
        queryLowerForMe === 'show tasks' ||
        queryLowerForMe === 'show dashboard' ||
        queryLowerForMe === 'show projects') {
      if (currentUserData) {
        targetUserId = currentUserData.id
        targetUserName = currentUserData.name || currentUserData.email
      }
    }

    // Check for @mentions first (only if not already set to "me")
    if (!targetUserId) {
      const atMentionPattern = /@([a-zA-Z0-9._%+-]+(?:@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?|[a-zA-Z]+(?:\s+[a-zA-Z]+)+?)/i
      const atMentionMatch = query.match(atMentionPattern)
      if (atMentionMatch && atMentionMatch[1]) {
        const mentionedUser = await findUserByMention(atMentionMatch[1])
        if (mentionedUser) {
          targetUserId = mentionedUser.id
          targetUserName = mentionedUser.name || mentionedUser.email
        }
      }
    }

    // If no @mention found, check for other user mention patterns
    if (!targetUserId) {
      const userMentions = [
        // Pattern for "tell me about sumit mishra" - captures full name (multiple words)
        /(?:tell me about|information about|details about|about|who is)\s+@?([a-zA-Z]+(?:\s+[a-zA-Z]+)+?)(?:\s|$)/i,
        // Pattern for email addresses
        /(?:tell me about|information about|details about|about|who is)\s+@?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
        // Pattern for single word names (fallback)
        /(?:tell me about|information about|details about|about|who is)\s+@?([a-zA-Z]+)/i,
        // Pattern for status + user: "show inprogress task @shivank" or "show completed tasks @john"
        /(?:show|list|get|find|display)\s+(?:in\s+progress|completed|pending|on\s+hold|recurring|yts|in-progress)\s+(?:tasks?|task)\s+@?([a-zA-Z0-9._%+-]+)/i,
        /(?:show|list|get|find|display)\s+(?:in\s+progress|completed|pending|on\s+hold|recurring|yts|in-progress)\s+(?:tasks?|task)\s+(?:for|of|assigned to)\s+@?([a-zA-Z0-9._%+-]+)/i,
        /(?:tasks?|work|assignments?|projects?|credentials?|subscriptions?|team)\s+(?:for|of|assigned to|belonging to)\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
        /(?:tasks?|work|assignments?|projects?|credentials?|subscriptions?|team)\s+(?:for|of|assigned to|belonging to)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)+?)(?:\s|$)/i,
        /(?:tasks?|work|assignments?|projects?|credentials?|subscriptions?|team)\s+(?:for|of|assigned to|belonging to)\s+([a-zA-Z]+)/i,
        /(?:show|list|get|find|display)\s+(?:tasks?|work|assignments?|projects?|credentials?|subscriptions?|team)\s+(?:for|of|assigned to)\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
        /(?:show|list|get|find|display)\s+(?:tasks?|work|assignments?|projects?|credentials?|subscriptions?|team)\s+(?:for|of|assigned to)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)+?)(?:\s|$)/i,
        /(?:show|list|get|find|display)\s+(?:tasks?|work|assignments?|projects?|credentials?|subscriptions?|team)\s+(?:for|of|assigned to)\s+([a-zA-Z]+)/i,
        /(?:what|which)\s+(?:tasks?|work|assignments?|projects?|credentials?|subscriptions?|team)\s+(?:does|do)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)+?)(?:\s|$)/i,
        /(?:what|which)\s+(?:tasks?|work|assignments?|projects?|credentials?|subscriptions?|team)\s+(?:does|do)\s+([a-zA-Z]+)\s+(?:have|own)/i,
      ]

      for (const pattern of userMentions) {
        const match = query.match(pattern)
        if (match && match[1]) {
          const identifier = match[1].trim()
          
          // Check if the identifier matches current user's name or email
          if (currentUserData && (
            (currentUserData.name && currentUserData.name.toLowerCase() === identifier.toLowerCase()) ||
            currentUserData.email.toLowerCase() === identifier.toLowerCase() ||
            currentUserData.email.toLowerCase().includes(identifier.toLowerCase())
          )) {
            targetUserId = currentUserData.id
            targetUserName = currentUserData.name || currentUserData.email
            break
          }
          
          const mentionedUser = await findUserByMention(identifier)
          if (mentionedUser) {
            targetUserId = mentionedUser.id
            targetUserName = mentionedUser.name || mentionedUser.email
            break
          }
        }
      }
    }

    // If no user mentioned, default to logged-in user
    if (!targetUserId && currentUserData) {
      targetUserId = currentUserData.id
      targetUserName = currentUserData.name || currentUserData.email
    }

    // Get current user role for permissions
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    const isAdmin = currentUser?.role?.toLowerCase() === 'admin' || currentUser?.role?.toLowerCase() === 'superadmin'

    // Detect query type based on keywords
    const isUserInfoQuery = queryLower2.includes('tell me about') || 
                            queryLower2.includes('information about') || 
                            queryLower2.includes('details about') || 
                            (queryLower2.includes('about') && targetUserId) ||
                            queryLower2.includes('who is')
    const isUnderReviewQuery = queryLower2.includes('under review') || queryLower2.includes('review tasks') || queryLower2.includes('reviewing')
    const isTeamTasksQuery = queryLower2.includes('team task') || queryLower2.includes('team tasks') || queryLower2.includes('team member')
    const isDashboardQuery = queryLower2.includes('dashboard') || queryLower2.includes('overview') || queryLower2.includes('statistics') || queryLower2.includes('stats')
    const isProjectsQuery = queryLower2.includes('project') && !queryLower2.includes('task')
    const isCredentialsQuery = queryLower2.includes('credential') || queryLower2.includes('login') || queryLower2.includes('password')
    const isSubscriptionsQuery = queryLower2.includes('subscription') || queryLower2.includes('subscriptions')
    const isTeamManagementQuery = queryLower2.includes('team management') || queryLower2.includes('team member') || (queryLower2.includes('team') && queryLower2.includes('management'))
    
    // Detect status-specific queries (check before other query types to prioritize status filtering)
    const statusKeywords = {
      'COMPLETED': ['completed', 'done', 'finished', 'finish'],
      'IN_PROGRESS': ['in progress', 'in-progress', 'working', 'active', 'progress'],
      'YTS': ['yet to start', 'yts', 'pending', 'not started', 'not-started'],
      'ON_HOLD': ['on hold', 'on-hold', 'hold', 'paused', 'pause'],
      'RECURRING': ['recurring', 'repeat', 'repeating']
    }
    
    let detectedStatus: string | null = null
    for (const [status, keywords] of Object.entries(statusKeywords)) {
      if (keywords.some(keyword => queryLower2.includes(keyword))) {
        detectedStatus = status
        break
      }
    }
    
    // If status is detected and query is asking for tasks with that status, prioritize it
    const isStatusSpecificTaskQuery = detectedStatus && (
      queryLower2.includes('show') || 
      queryLower2.includes('list') || 
      queryLower2.includes('get') || 
      queryLower2.includes('find') || 
      queryLower2.includes('display') ||
      queryLower2.includes('task')
    )

    // Handle user information query first (before other queries)
    if (isUserInfoQuery && targetUserId) {
      try {
        // Fetch full user details
        const userDetails = await prisma.user.findUnique({
          where: { id: targetUserId },
          select: {
            id: true,
            name: true,
            email: true,
            employeeId: true,
            department: true,
            company: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        })

        if (!userDetails) {
          return res.json({
            success: false,
            query: query,
            error: `User "${targetUserName}" not found`,
          })
        }

        // Count projects for this user
        const projectCount = await prisma.project.count({
          where: {
            members: {
              some: { userId: targetUserId },
            },
          },
        })

        // Count tasks for this user
        const taskCount = await prisma.task.count({
          where: {
            OR: [
              {
                assignees: {
                  some: { userId: targetUserId },
                },
              },
              {
                createdById: targetUserId,
              },
            ],
          },
        })

        // Count tasks by status
        const tasksByStatus = await prisma.task.groupBy({
          by: ['status'],
          where: {
            OR: [
              {
                assignees: {
                  some: { userId: targetUserId },
                },
              },
              {
                createdById: targetUserId,
              },
            ],
          },
          _count: {
            id: true,
          },
        })

        return res.json({
          success: true,
          query: query,
          action: 'query',
          type: 'user_info',
          user: targetUserName,
          data: {
            user: userDetails,
            projectCount,
            taskCount,
            tasksByStatus: tasksByStatus.reduce((acc: any, item: any) => {
              acc[item.status] = item._count.id
              return acc
            }, {}),
          },
          message: `Information about ${userDetails.name || userDetails.email}`,
        })
      } catch (error: any) {
        console.error('Error fetching user information:', error)
        return res.status(500).json({
          success: false,
          query: query,
          error: 'Failed to fetch user information',
        })
      }
    }

    // Handle different query types
    if (isUnderReviewQuery) {
      // Fetch UNDER_REVIEW tasks where user is the reviewer
      const reviewTasks = await prisma.task.findMany({
        where: {
          reviewerId: targetUserId || req.userId,
          reviewStatus: {
            in: ['REVIEW_REQUESTED', 'UNDER_REVIEW'],
          },
        },
        include: {
          assignees: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          project: true,
          reviewer: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })

      // Filter out orphaned records
      const cleanedTasks = reviewTasks.map((task: any) => ({
        ...task,
        assignees: task.assignees.filter((assignee: any) => assignee.user !== null),
      }))

      return res.json({
        success: true,
        query: query,
        action: 'query',
        type: 'under_review_tasks',
        user: targetUserName,
        data: cleanedTasks,
        message: `Found ${cleanedTasks.length} task(s) under review${targetUserName ? ` for ${targetUserName}` : ''}`,
      })
    }

    if (isTeamTasksQuery) {
      // Fetch team tasks (all tasks visible to user's team)
      const teamTasks = await prisma.task.findMany({
        where: {
          assignees: {
            some: {
              userId: {
                in: isAdmin ? undefined : [req.userId], // Admins see all, others see their own team's tasks
              },
            },
          },
        },
        include: {
          assignees: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          project: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })

      const cleanedTasks = teamTasks.map((task: any) => ({
        ...task,
        assignees: task.assignees.filter((assignee: any) => assignee.user !== null),
      }))

      return res.json({
        success: true,
        query: query,
        action: 'query',
        type: 'team_tasks',
        user: targetUserName,
        data: cleanedTasks,
        message: `Found ${cleanedTasks.length} team task(s)${targetUserName ? ` for ${targetUserName}` : ''}`,
      })
    }

    if (isDashboardQuery) {
      // Fetch dashboard statistics
      const [totalTasks, completedTasks, inProgressTasks, overdueTasks, activeProjects, totalCredentials, activeSubscriptions] = await Promise.all([
        prisma.task.count({
          where: {
            OR: [
              {
                assignees: {
                  some: { userId: targetUserId || req.userId },
                },
              },
              {
                createdById: targetUserId || req.userId,
              },
            ],
          },
        }),
        prisma.task.count({
          where: {
            OR: [
              {
                assignees: {
                  some: { userId: targetUserId || req.userId },
                },
              },
              {
                createdById: targetUserId || req.userId,
              },
            ],
            status: 'COMPLETED',
          },
        }),
        prisma.task.count({
          where: {
            OR: [
              {
                assignees: {
                  some: { userId: targetUserId || req.userId },
                },
              },
              {
                createdById: targetUserId || req.userId,
              },
            ],
            status: 'IN_PROGRESS',
          },
        }),
        prisma.task.count({
          where: {
            OR: [
              {
                assignees: {
                  some: { userId: targetUserId || req.userId },
                },
              },
              {
                createdById: targetUserId || req.userId,
              },
            ],
            status: { not: 'COMPLETED' },
            dueDate: { lt: new Date() },
          },
        }),
        prisma.project.count({
          where: {
            members: {
              some: { userId: targetUserId || req.userId },
            },
          },
        }),
        prisma.credential.count({
          where: {
            OR: [
              { createdById: targetUserId || req.userId },
              { members: { some: { userId: targetUserId || req.userId } } },
            ],
          },
        }),
        prisma.subscription.count({
          where: {
            OR: [
              { createdById: targetUserId || req.userId },
              { members: { some: { userId: targetUserId || req.userId } } },
            ],
            status: 'ACTIVE',
          },
        }),
      ])

      return res.json({
        success: true,
        query: query,
        action: 'query',
        type: 'dashboard',
        user: targetUserName,
        data: {
          totalTasks,
          completedTasks,
          inProgressTasks,
          overdueTasks,
          activeProjects,
          totalCredentials,
          activeSubscriptions,
        },
        message: `Dashboard statistics${targetUserName ? ` for ${targetUserName}` : ''}`,
      })
    }

    if (isProjectsQuery) {
      // Fetch projects
      let projects: any[] = []
      try {
        projects = await prisma.project.findMany({
          where: targetUserId && !isAdmin
            ? {
                members: {
                  some: { userId: targetUserId },
                },
              }
            : {},
          include: {
            members: {
              include: {
                user: {
                  select: { id: true, name: true, email: true },
                },
              },
            },
            _count: {
              select: { tasks: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })

        // Filter out members with null users (orphaned records)
        const cleanedProjects = projects.map((project: any) => ({
          ...project,
          members: project.members.filter((member: any) => member.user !== null && member.user !== undefined),
        }))

        return res.json({
          success: true,
          query: query,
          action: 'query',
          type: 'projects',
          user: targetUserName,
          data: cleanedProjects,
          message: `Found ${cleanedProjects.length} project(s)${targetUserName ? ` for ${targetUserName}` : ''}`,
        })
      } catch (error: any) {
        console.error('Error fetching projects in AI route:', error)
        // If error is due to inconsistent relations, try fetching without user relation
        if (error.message?.includes('Inconsistent query result') || error.message?.includes('Field user is required')) {
          try {
            projects = await prisma.project.findMany({
              where: targetUserId && !isAdmin
                ? {
                    members: {
                      some: { userId: targetUserId },
                    },
                  }
                : {},
              include: {
                members: {
                  select: {
                    id: true,
                    projectId: true,
                    userId: true,
                    role: true,
                    joinedAt: true,
                  },
                },
                _count: {
                  select: { tasks: true },
                },
              },
              orderBy: { createdAt: 'desc' },
              take: 100,
            })

            // Manually fetch users for each member
            const projectsWithUsers = await Promise.all(
              projects.map(async (project: any) => {
                const membersWithUsers = await Promise.all(
                  project.members.map(async (member: any) => {
                    try {
                      const user = await prisma.user.findUnique({
                        where: { id: member.userId },
                        select: {
                          id: true,
                          name: true,
                          email: true,
                        },
                      })
                      return {
                        ...member,
                        user: user || null,
                      }
                    } catch {
                      return null
                    }
                  })
                )
                return {
                  ...project,
                  members: membersWithUsers.filter((m: any) => m !== null && m.user !== null) as any,
                }
              })
            )

            return res.json({
              success: true,
              query: query,
              action: 'query',
              type: 'projects',
              user: targetUserName,
              data: projectsWithUsers,
              message: `Found ${projectsWithUsers.length} project(s)${targetUserName ? ` for ${targetUserName}` : ''}`,
            })
          } catch (fallbackError) {
            console.error('Fallback query also failed:', fallbackError)
            return res.status(500).json({
              success: false,
              query: query,
              error: 'Failed to fetch projects',
            })
          }
        } else {
          throw error
        }
      }
    }

    if (isCredentialsQuery) {
      // Fetch credentials
      const credentials = await prisma.credential.findMany({
        where: {
          OR: [
            { createdById: targetUserId || req.userId },
            { members: { some: { userId: targetUserId || req.userId } } },
          ],
        },
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          members: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })

      return res.json({
        success: true,
        query: query,
        action: 'query',
        type: 'credentials',
        user: targetUserName,
        data: credentials,
        message: `Found ${credentials.length} credential(s)${targetUserName ? ` for ${targetUserName}` : ''}`,
      })
    }

    if (isSubscriptionsQuery) {
      // Fetch subscriptions
      const subscriptions = await prisma.subscription.findMany({
        where: {
          OR: [
            { createdById: targetUserId || req.userId },
            { members: { some: { userId: targetUserId || req.userId } } },
          ],
        },
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          members: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })

      return res.json({
        success: true,
        query: query,
        action: 'query',
        type: 'subscriptions',
        user: targetUserName,
        data: subscriptions,
        message: `Found ${subscriptions.length} subscription(s)${targetUserName ? ` for ${targetUserName}` : ''}`,
      })
    }

    if (isTeamManagementQuery) {
      // Fetch team members
      const teamMembers = await prisma.user.findMany({
        where: isAdmin
          ? {}
          : {
              department: (await prisma.user.findUnique({
                where: { id: req.userId },
                select: { department: true },
              }))?.department,
            },
        select: {
          id: true,
          name: true,
          email: true,
          department: true,
          role: true,
          isActive: true,
          _count: {
            select: {
              tasksAssigned: true,
            },
          },
        },
        take: 100,
      })

      return res.json({
        success: true,
        query: query,
        action: 'query',
        type: 'team_management',
        user: targetUserName,
        data: teamMembers,
        message: `Found ${teamMembers.length} team member(s)`,
      })
    }

    // Default: Regular task query
    // Build query conditions
    let whereCondition: any = {}

    // Apply user filter first
    if (targetUserId) {
      // Tasks assigned to or created by specific user
      whereCondition.OR = [
        {
          assignees: {
            some: {
              userId: targetUserId,
            },
          },
        },
        {
          createdById: targetUserId,
        },
      ]
    } else if (!isAdmin) {
      // Non-admin users can only see their own tasks (assigned or created)
      whereCondition.OR = [
        {
          assignees: {
            some: {
              userId: req.userId,
            },
          },
        },
        {
          createdById: req.userId,
        },
      ]
    }

    // Apply status filter (works together with user filter)
    if (detectedStatus) {
      whereCondition.status = detectedStatus
    } else {
      // Fallback to original detection logic
      if (queryLower2.includes('completed') || queryLower2.includes('done') || queryLower2.includes('finished')) {
        whereCondition.status = 'COMPLETED'
      } else if (queryLower2.includes('in progress') || queryLower2.includes('in-progress') || queryLower2.includes('working') || queryLower2.includes('active')) {
        whereCondition.status = 'IN_PROGRESS'
      } else if (queryLower2.includes('pending') || queryLower2.includes('yet to start') || queryLower2.includes('yts') || queryLower2.includes('not started')) {
        whereCondition.status = 'YTS'
      } else if (queryLower2.includes('on hold') || queryLower2.includes('on-hold') || queryLower2.includes('paused') || queryLower2.includes('hold')) {
        whereCondition.status = 'ON_HOLD'
      } else if (queryLower2.includes('recurring') || queryLower2.includes('repeat') || queryLower2.includes('repeating')) {
        whereCondition.status = 'RECURRING'
      }
    }

    // Extract priority filters
    if (queryLower2.includes('high priority') || queryLower2.includes('urgent')) {
      whereCondition.priority = 'HIGH'
    } else if (queryLower2.includes('low priority')) {
      whereCondition.priority = 'LOW'
    } else if (queryLower2.includes('medium priority')) {
      whereCondition.priority = 'MEDIUM'
    }

    // Extract date filters
    if (queryLower2.includes('today')) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      whereCondition.dueDate = {
        gte: today,
        lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      }
    } else if (queryLower2.includes('this week')) {
      const today = new Date()
      const weekStart = new Date(today)
      weekStart.setDate(today.getDate() - today.getDay())
      weekStart.setHours(0, 0, 0, 0)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekStart.getDate() + 7)
      whereCondition.dueDate = {
        gte: weekStart,
        lt: weekEnd,
      }
    } else if (queryLower2.includes('overdue') || queryLower2.includes('past due')) {
      whereCondition.dueDate = {
        lt: new Date(),
      }
      whereCondition.status = {
        not: 'COMPLETED',
      }
    }

    // Fetch tasks
    let tasks: any[] = []
    try {
      tasks = await prisma.task.findMany({
        where: whereCondition,
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
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 100, // Limit to 100 tasks
      })

      // Filter out assignees with null users (orphaned records)
      tasks = tasks.map(task => ({
        ...task,
        assignees: task.assignees.filter((assignee: any) => assignee.user !== null && assignee.user !== undefined),
      }))
    } catch (queryError: any) {
      // If error is due to inconsistent relations, try fetching without user relations
      if (queryError.message?.includes('Inconsistent query result') || queryError.message?.includes('Field user is required')) {
        try {
          tasks = await prisma.task.findMany({
            where: whereCondition,
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
              priority: true,
              dueDate: true,
              brand: true,
              tags: true,
              recurring: true,
              createdAt: true,
              updatedAt: true,
              createdById: true,
              projectId: true,
              assignees: {
                select: {
                  id: true,
                  taskId: true,
                  userId: true,
                  assignedAt: true,
                },
              },
              project: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
            take: 100,
          })

          // Manually fetch users for assignees and createdBy
          tasks = await Promise.all(
            tasks.map(async (task) => {
              const assigneesWithUsers = await Promise.all(
                task.assignees.map(async (assignee: any) => {
                  try {
                    const user = await prisma.user.findUnique({
                      where: { id: assignee.userId },
                      select: {
                        id: true,
                        name: true,
                        email: true,
                      },
                    })
                    return {
                      ...assignee,
                      user: user || null,
                    }
                  } catch {
                    return null
                  }
                })
              )

              // Fetch createdBy user
              let createdBy = null
              try {
                createdBy = await prisma.user.findUnique({
                  where: { id: task.createdById },
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                })
              } catch {
                // Ignore error
              }

              return {
                ...task,
                assignees: assigneesWithUsers.filter((a: any) => a !== null && a.user !== null),
                createdBy: createdBy,
              }
            })
          )
        } catch (fallbackError) {
          console.error('Fallback query also failed:', fallbackError)
          throw queryError // Throw original error
        }
      } else {
        throw queryError
      }
    }

    // Filter out assignees with null users (orphaned records)
    const cleanedTasks = tasks.map((task: any) => ({
      ...task,
      assignees: task.assignees.filter((assignee: any) => assignee.user !== null && assignee.user !== undefined),
    }))

    return res.json({
      success: true,
      query: query,
      action: 'query',
      type: 'tasks',
      user: targetUserName,
      data: cleanedTasks,
      message: (() => {
        let msg = ''
        if (detectedStatus) {
          msg = `${detectedStatus.replace('_', ' ').toLowerCase()}`
        } else {
          msg = 'task'
        }
        return `Found ${cleanedTasks.length} ${msg}${cleanedTasks.length !== 1 ? 's' : ''}${targetUserName ? ` for ${targetUserName}` : ''}`
      })(),
    })
  } catch (error: any) {
    console.error('Error processing AI query:', error)
    const errorMessage = error.message || 'Internal server error'
    res.status(500).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
})

export default router

