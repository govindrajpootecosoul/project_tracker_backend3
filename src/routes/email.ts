import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { microsoftGraphClient } from '../lib/microsoft-graph'
import { logActivity } from '../utils/activityLogger'

const router = Router()

// Helper function to send department-wise task email for a SINGLE department (reusable for manual and automatic)
export async function sendDepartmentWiseEmail(
  departmentName: string,
  toEmails: string[],
  onLeaveMemberIds: string[] = [],
  userId?: string
): Promise<{ success: boolean; error?: string; emailLogId?: string }> {
  try {
    if (!departmentName || !departmentName.trim()) {
      return { success: false, error: 'Department name is required' }
    }

    // Get all users from the specified department
    const departmentUsers = await prisma.user.findMany({
      where: {
        department: departmentName,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
      },
    })

    const departmentUserIds = departmentUsers.map((u) => u.id)

    // Get start and end of current date for filtering completed tasks
    // Use UTC to avoid timezone issues
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)

    // Fetch IN_PROGRESS, RECURRING, and COMPLETED (from today) tasks from department members
    // Include completed tasks where statusUpdatedAt OR updatedAt is today (to catch all completed tasks)
    const tasks = await prisma.task.findMany({
      where: {
        OR: [
          {
            status: {
              in: ['IN_PROGRESS', 'RECURRING'],
            },
          },
          {
            AND: [
              {
                status: 'COMPLETED',
              },
              {
                OR: [
                  {
                    statusUpdatedAt: {
                      gte: today,
                      lt: tomorrow,
                    },
                  },
                  {
                    updatedAt: {
                      gte: today,
                      lt: tomorrow,
                    },
                  },
                ],
              },
            ],
          },
        ],
        assignees: {
          some: {
            userId: {
              in: departmentUserIds,
            },
          },
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
                department: true,
              },
            },
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            department: true,
          },
        },
      },
      orderBy: [
        { statusUpdatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    })

    // Helper function to escape HTML
    const escapeHtml = (text: string | null | undefined): string => {
      if (!text) return 'N/A'
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
    }

    // Format date
    const formatDate = (date: string | Date | null | undefined): string => {
      if (!date) return 'N/A'
      try {
        const d = new Date(date)
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      } catch {
        return 'N/A'
      }
    }

    // Format status: First letter capital, rest lowercase, replace underscores with spaces
    const formatStatus = (status: string | null | undefined): string => {
      if (!status) return 'N/A'
      return status
        .toLowerCase()
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    }

    // Format priority: First letter capital, rest lowercase
    const formatPriority = (priority: string | null | undefined): string => {
      if (!priority) return 'N/A'
      return priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase()
    }

    // Group tasks by employee
    const tasksByEmployee = new Map<string, { user: any; tasks: any[] }>()
    const isNewProductDesignDepartment = (value?: string | null) => {
      return value?.trim().toLowerCase() === 'new product design'
    }

    // Initialize all department members
    departmentUsers.forEach((member) => {
      tasksByEmployee.set(member.id, { user: member, tasks: [] })
    })

    // Add tasks to their respective employees
    tasks.forEach((task: any) => {
      task.assignees.forEach((assignee: any) => {
        const userId = assignee.user.id
        if (tasksByEmployee.has(userId)) {
          const employeeData = tasksByEmployee.get(userId)!
          if (!employeeData.tasks.find((t) => t.id === task.id)) {
            employeeData.tasks.push(task)
          }
        }
      })
    })

    // Check if department has media columns
    const includeMediaColumns =
      isNewProductDesignDepartment(departmentName) ||
      tasks.some((task: any) => isNewProductDesignDepartment(task.project?.department))

    // Generate report HTML
    let reportContent = ''
    const totalEmployees = departmentUsers.length
    const totalTasks = tasks.length

    // Sort employees by name
    const sortedEmployees = Array.from(tasksByEmployee.values()).sort((a, b) => {
      const nameA = (a.user.name || a.user.email || '').toLowerCase()
      const nameB = (b.user.name || b.user.email || '').toLowerCase()
      return nameA.localeCompare(nameB)
    })

    sortedEmployees.forEach((employeeData) => {
        const { user, tasks: employeeTasks } = employeeData
        const userName = user.name || 'Unknown'
        const userEmail = user.email || 'N/A'
        const isOnLeave = onLeaveMemberIds.includes(user.id)

        const taskRows =
          !isOnLeave && employeeTasks.length > 0
            ? employeeTasks.map((task: any, index: number) => {
                const rowColor = index % 2 === 0 ? '#f9f9f9' : '#ffffff'
                const brand = escapeHtml(task.brand || 'N/A')
                const projectName = escapeHtml(task.project?.name || 'N/A')
                const taskTitle = escapeHtml(task.title)
                const priority = escapeHtml(task.priority || 'N/A')
                const dueDate = formatDate(task.dueDate)
                const showMediaCounts =
                  includeMediaColumns &&
                  (isNewProductDesignDepartment(task.project?.department) ||
                    isNewProductDesignDepartment(user.department))
                const imageCount = showMediaCounts ? Number(task.imageCount ?? 0) : '-'
                const videoCount = showMediaCounts ? Number(task.videoCount ?? 0) : '-'
                const taskLink = task.link
                  ? `<a href="${escapeHtml(task.link)}" target="_blank" style="color: #006ba6; text-decoration: underline;">${escapeHtml(task.link)}</a>`
                  : '-'
                const taskStatus = formatStatus(task.status)
                const formattedPriority = formatPriority(task.priority)
                const isCompleted = task.status === 'COMPLETED'
                // Green background for entire row if task is completed
                const rowBackgroundColor = isCompleted ? '#d4edda' : rowColor
                const statusColor = isCompleted ? '#155724' : '#006ba6'
                const statusStyle = isCompleted ? `color: #155724; font-weight: bold;` : `color: ${statusColor};`

                return `
                  <tr style="background-color: ${rowBackgroundColor};">
                    <td style="padding: 8px; border: 1px solid #ddd; width: 15%; word-wrap: break-word;">${brand}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; width: 15%; word-wrap: break-word;">${projectName}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; width: 20%; word-wrap: break-word;">${taskTitle}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; width: 10%; word-wrap: break-word; ${statusStyle}">${taskStatus}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; width: 10%; word-wrap: break-word;">${formattedPriority}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; width: 10%; word-wrap: break-word;">${dueDate}</td>
                    ${includeMediaColumns ? `<td style="padding: 8px; border: 1px solid #ddd; width: 8%; word-wrap: break-word;">${imageCount}</td>` : ''}
                    ${includeMediaColumns ? `<td style="padding: 8px; border: 1px solid #ddd; width: 8%; word-wrap: break-word;">${videoCount}</td>` : ''}
                    <td style="padding: 8px; border: 1px solid #ddd; width: 12%; word-wrap: break-word;">${taskLink}</td>
                  </tr>
                `
              }).join('')
            : isOnLeave
            ? `<tr><td colspan="${includeMediaColumns ? 9 : 7}" style="padding: 8px; border: 1px solid #ddd; text-align: center; color: #ff0000; font-weight: bold;">On Leave</td></tr>`
            : `<tr><td colspan="${includeMediaColumns ? 9 : 7}" style="padding: 8px; border: 1px solid #ddd; text-align: center; color: #666; font-style: italic;">No tasks assigned</td></tr>`

      reportContent += `
        <div style="margin-bottom: 30px; border-left: 5px solid #006ba6; padding-left: 15px;">
          <h3 style="color: #b1740f; font-family: Arial, sans-serif; font-size: 16px; margin-bottom: 10px; font-weight: bold;">
            ${escapeHtml(userName)} (${escapeHtml(userEmail)})${isOnLeave ? ' - <span style="color: #ff0000;">On Leave</span>' : ''}
          </h3>
          ${!isOnLeave
            ? `<p style="color: #666; font-family: Arial, sans-serif; font-size: 14px; margin-bottom: 10px;">
            Total Tasks: ${employeeTasks.length}
          </p>`
            : `<p style="color: #ff0000; font-family: Arial, sans-serif; font-size: 14px; margin-bottom: 10px; font-weight: bold;">
            This team member is currently on leave.
          </p>`}
          <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 14px; table-layout: fixed;">
            <thead>
              <tr style="background-color: #006ba6; color: white;">
                <th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 15%;">Brand</th>
                <th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 15%;">Project</th>
                <th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 20%;">Task Title</th>
                <th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 10%;">Status</th>
                <th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 10%;">Priority</th>
                <th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 10%;">Due Date</th>
                ${includeMediaColumns ? '<th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 8%;">Images</th>' : ''}
                ${includeMediaColumns ? '<th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 8%;">Videos</th>' : ''}
                <th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 12%;">Link</th>
              </tr>
            </thead>
            <tbody>
              ${taskRows}
            </tbody>
          </table>
        </div>
      `
    })

    // Generate subject
    const finalSubject =
      totalTasks > 0
        ? `${departmentName} Tasks Report (In-Progress, Recurring & Today's Completed) - ${totalEmployees} Employee${totalEmployees !== 1 ? 's' : ''}, ${totalTasks} Task${totalTasks !== 1 ? 's' : ''}`
        : `${departmentName} Tasks Report (In-Progress, Recurring & Today's Completed) - 0 Employees, 0 Tasks`

    // Generate tasks report HTML
    let tasksReportHTML = ''
    if (tasks.length === 0) {
      tasksReportHTML = `
        <div style="background-color: #006ba6; color: white; padding: 20px; text-align: center; margin-bottom: 20px;">
          <h2 style="margin: 0; font-family: Arial, sans-serif; font-size: 24px;">Tasks Report (In-Progress, Recurring & Today's Completed)</h2>
        </div>
        <div style="margin-bottom: 20px; font-family: Arial, sans-serif;">
          <p style="font-size: 14px; color: #333;">
            <strong>Total Employees:</strong> ${totalEmployees}<br>
            <strong>Total Tasks:</strong> 0
          </p>
          <p style="font-size: 14px; color: #666; margin-top: 10px;">
            No in-progress, recurring, or today's completed tasks found for ${departmentName}.
          </p>
        </div>
      `
    } else {
      tasksReportHTML = `
        <div style="background-color: #006ba6; color: white; padding: 20px; text-align: center; margin-bottom: 20px;">
          <h2 style="margin: 0; font-family: Arial, sans-serif; font-size: 24px;">Tasks Report (In-Progress, Recurring & Today's Completed)</h2>
        </div>
        <div style="margin-bottom: 20px; font-family: Arial, sans-serif;">
          <p style="font-size: 14px; color: #333;">
            <strong>Total Employees:</strong> ${totalEmployees}<br>
            <strong>Total Tasks:</strong> ${totalTasks}
          </p>
        </div>
        ${reportContent}
      `
    }

    // Get CC emails from all department employees
    const ccEmails = departmentUsers
      .map((u) => u.email)
      .filter((email) => email && email.trim())
      .filter((email) => !toEmails.includes(email)) // Don't duplicate in CC if already in To

    // Send email
    try {
      await microsoftGraphClient.sendEmail(toEmails, ccEmails.length > 0 ? ccEmails : null, finalSubject, tasksReportHTML)
    } catch (emailError: any) {
      console.error('Error sending email via Microsoft Graph:', emailError)
      return { success: false, error: emailError.message || 'Failed to send email' }
    }

    // Store email log in database
    const emailLog = await prisma.emailLog.create({
      data: {
        to: JSON.stringify(toEmails),
        cc: ccEmails.length > 0 ? JSON.stringify(ccEmails) : null,
        subject: finalSubject,
        body: '', // Body is empty as tasks are in the email body
        userId: userId || 'system', // Use system if no userId provided (for automatic sends)
      },
    })

    // Log activity if userId is provided
    if (userId) {
      await logActivity({
        type: 'EMAIL_SENT',
        action: 'Email Sent',
        description: `Sent automatic department-wise email "${finalSubject}" to ${toEmails.join(', ')}${ccEmails.length > 0 ? ` (CC: ${ccEmails.length} recipients)` : ''}`,
        entityType: 'email',
        entityId: emailLog.id,
        metadata: {
          subject: finalSubject,
          to: toEmails,
          cc: ccEmails,
          department: departmentName,
          automatic: !userId || userId === 'system',
        },
        userId: userId,
      })
    }

    return { success: true, emailLogId: emailLog.id }
  } catch (error: any) {
    console.error('Error in sendDepartmentWiseEmail:', error)
    return { success: false, error: error.message || 'Internal server error' }
  }
}

// Send email via Microsoft Graph API
router.post('/send', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { to, cc, subject, body, includeDepartmentTasks, onLeaveMemberIds } = req.body

    // Get current user for department info
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { department: true, name: true, email: true },
    })

    // Validate required fields - check for empty strings as well
    if (!to || (typeof to === 'string' && !to.trim())) {
      return res.status(400).json({ error: 'To field is required' })
    }
    
    // Auto-generate subject if includeDepartmentTasks is true
    let finalSubject = subject
    if (includeDepartmentTasks && currentUser?.department) {
      // Subject will be generated after fetching tasks
      // Format: "{Department Name} In-Progress & Recurring Tasks Report - {X} Employees, {Y} Tasks"
      // Allow empty subject in this case - it will be auto-generated
    } else if (!subject || (typeof subject === 'string' && !subject.trim())) {
      return res.status(400).json({ error: 'Subject is required' })
    } else {
      finalSubject = subject.trim()
    }
    
    // Body is optional now - tasks will be added to email body automatically

    // Ensure to is an array and filter out empty strings
    const toArray = Array.isArray(to) 
      ? to.filter((email: string) => email && email.trim())
      : [to].filter((email: string) => email && email.trim())
    
    if (toArray.length === 0) {
      return res.status(400).json({ error: 'At least one valid recipient email is required' })
    }

    const ccArrayFiltered = cc 
      ? (Array.isArray(cc) 
          ? cc.filter((email: string) => email && email.trim())
          : [cc].filter((email: string) => email && email.trim()))
      : []
    const ccArray = ccArrayFiltered.length > 0 ? ccArrayFiltered : null

    // Fetch tasks based on option
    let tasks: any[] = []
    
    if (includeDepartmentTasks) {
      if (currentUser?.department) {
        // Get all users in the same department
        const departmentUsers = await prisma.user.findMany({
          where: {
            department: currentUser.department,
            isActive: true,
          },
          select: { 
            id: true,
            name: true,
            email: true,
          },
        })

        const departmentUserIds = departmentUsers.map((u: any) => u.id)

        // Get start and end of current date for filtering completed tasks
        // Use UTC to avoid timezone issues
        const today = new Date()
        today.setUTCHours(0, 0, 0, 0)
        const tomorrow = new Date(today)
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)

        // Fetch IN_PROGRESS, RECURRING, and COMPLETED (from today) tasks from department members
        // Include completed tasks where statusUpdatedAt OR updatedAt is today (to catch all completed tasks)
        tasks = await prisma.task.findMany({
          where: {
            OR: [
              {
                status: {
                  in: ['IN_PROGRESS', 'RECURRING'],
                },
              },
              {
                AND: [
                  {
                    status: 'COMPLETED',
                  },
                  {
                    OR: [
                      {
                        statusUpdatedAt: {
                          gte: today,
                          lt: tomorrow,
                        },
                      },
                      {
                        updatedAt: {
                          gte: today,
                          lt: tomorrow,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
            assignees: {
              some: {
                userId: {
                  in: departmentUserIds,
                },
              },
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
                    department: true,
                  },
                },
              },
            },
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          // brand is a scalar field, automatically included
      orderBy: [
        { statusUpdatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
        })
      }
    } else {
      // Get start and end of current date for filtering completed tasks
      // Use UTC to avoid timezone issues
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)

      // Fetch user's own IN_PROGRESS, RECURRING, and today's COMPLETED tasks
      // Include completed tasks where statusUpdatedAt OR updatedAt is today (to catch all completed tasks)
      tasks = await prisma.task.findMany({
        where: {
          OR: [
            {
              status: {
                in: ['IN_PROGRESS', 'RECURRING'],
              },
            },
            {
              AND: [
                {
                  status: 'COMPLETED',
                },
                {
                  OR: [
                    {
                      statusUpdatedAt: {
                        gte: today,
                        lt: tomorrow,
                      },
                    },
                    {
                      updatedAt: {
                        gte: today,
                        lt: tomorrow,
                      },
                    },
                  ],
                },
              ],
            },
          ],
          assignees: {
            some: {
              userId: req.userId,
            },
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
          project: {
            select: {
              id: true,
              name: true,
            },
          },
          // brand is a scalar field, automatically included
        },
        orderBy: [
          { statusUpdatedAt: 'desc' },
          { createdAt: 'desc' },
        ],
      })
    }

    // Helper function to escape HTML
    const escapeHtml = (text: string | null | undefined): string => {
      if (!text) return 'N/A'
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
    }

    // Format date
    const formatDate = (date: string | Date | null | undefined): string => {
      if (!date) return 'N/A'
      try {
        const d = new Date(date)
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      } catch {
        return 'N/A'
      }
    }

    // Format status: First letter capital, rest lowercase, replace underscores with spaces
    const formatStatus = (status: string | null | undefined): string => {
      if (!status) return 'N/A'
      return status
        .toLowerCase()
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    }

    // Format priority: First letter capital, rest lowercase
    const formatPriority = (priority: string | null | undefined): string => {
      if (!priority) return 'N/A'
      return priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase()
    }

    // Generate HTML for tasks report (same format for both department and non-department)
    let tasksReportHTML = ''
    
    // For department tasks, include ALL department members (even with 0 tasks)
    let allDepartmentMembers: any[] = []
    if (includeDepartmentTasks && currentUser?.department) {
      // Get all department members (already fetched earlier)
      allDepartmentMembers = await prisma.user.findMany({
        where: {
          department: currentUser.department,
          isActive: true,
        },
        select: { 
          id: true,
          name: true,
          email: true,
          department: true,
        },
      })
    }
    
    // Group tasks by employee for consistent format
    const tasksByEmployee = new Map<string, { user: any; tasks: any[] }>()
    const isNewProductDesignDepartment = (value?: string | null) => {
      return value?.trim().toLowerCase() === 'new product design'
    }

    const includeMediaColumns =
      isNewProductDesignDepartment(currentUser?.department) ||
      tasks.some((task: any) => isNewProductDesignDepartment(task.project?.department))
    
    // First, add all department members (if includeDepartmentTasks is true)
    if (includeDepartmentTasks && allDepartmentMembers.length > 0) {
      allDepartmentMembers.forEach((member: any) => {
        tasksByEmployee.set(member.id, {
          user: member,
          tasks: []
        })
      })
    }
    
    // Then, add tasks to their respective employees
    if (tasks.length > 0) {
      tasks.forEach((task: any) => {
        task.assignees.forEach((assignee: any) => {
          const userId = assignee.user.id
          
          if (!tasksByEmployee.has(userId)) {
            tasksByEmployee.set(userId, {
              user: assignee.user,
              tasks: []
            })
          }
          
          // Only add task once per employee (avoid duplicates if multiple assignees)
          const employeeData = tasksByEmployee.get(userId)!
          if (!employeeData.tasks.find(t => t.id === task.id)) {
            employeeData.tasks.push(task)
          }
        })
      })
    }

    // Total employees should be all department members (if includeDepartmentTasks), otherwise just those with tasks
    const totalEmployees = includeDepartmentTasks && allDepartmentMembers.length > 0 
      ? allDepartmentMembers.length 
      : tasksByEmployee.size
    const totalTasks = tasks.length

    // Generate subject based on includeDepartmentTasks
    if (includeDepartmentTasks && currentUser?.department) {
      // Department tasks - include employee count
      if (totalTasks > 0) {
        finalSubject = `${currentUser.department} In-Progress & Recurring Tasks Report - ${totalEmployees} Employee${totalEmployees !== 1 ? 's' : ''}, ${totalTasks} Task${totalTasks !== 1 ? 's' : ''}`
      } else {
        finalSubject = `${currentUser.department} In-Progress & Recurring Tasks Report - 0 Employees, 0 Tasks`
      }
    } else if (!includeDepartmentTasks && currentUser?.department) {
      // Non-department tasks - only task count (no employee count)
      finalSubject = `${currentUser.department} In-Progress & Recurring Tasks Report - ${totalTasks} Task${totalTasks !== 1 ? 's' : ''}`
    }

    // Generate report HTML (same format for both cases)
    if (tasks.length === 0) {
      // If no tasks, show empty report
      tasksReportHTML = `
        <div style="background-color: #006ba6; color: white; padding: 20px; text-align: center; margin-bottom: 20px;">
          <h2 style="margin: 0; font-family: Arial, sans-serif; font-size: 24px;">In-Progress & Recurring Tasks Report</h2>
        </div>
        <div style="margin-bottom: 20px; font-family: Arial, sans-serif;">
          <p style="font-size: 14px; color: #333;">
            ${includeDepartmentTasks ? `<strong>Total Employees:</strong> 0<br>` : ''}
            <strong>Total Tasks:</strong> 0
          </p>
          <p style="font-size: 14px; color: #666; margin-top: 10px;">
            No in-progress or recurring tasks found.
          </p>
        </div>
      `
    } else {
      // Generate report content for all employees (same format)
      let reportContent = ''
      
      // Sort employees by name for consistent ordering
      const sortedEmployees = Array.from(tasksByEmployee.values()).sort((a, b) => {
        const nameA = (a.user.name || a.user.email || '').toLowerCase()
        const nameB = (b.user.name || b.user.email || '').toLowerCase()
        return nameA.localeCompare(nameB)
      })
      
      sortedEmployees.forEach((employeeData) => {
        const { user, tasks: employeeTasks } = employeeData
        const userName = user.name || 'Unknown'
        const userEmail = user.email || 'N/A'
        
        // Check if this employee is on leave
        const isOnLeave = includeDepartmentTasks && onLeaveMemberIds && Array.isArray(onLeaveMemberIds) && onLeaveMemberIds.includes(user.id)
        
        const taskRows = !isOnLeave && employeeTasks.length > 0 ? employeeTasks.map((task: any, index: number) => {
          const baseRowColor = index % 2 === 0 ? '#f9f9f9' : '#ffffff'
          const isCompleted = task.status === 'COMPLETED'
          // Green background for entire row if task is completed
          const rowColor = isCompleted ? '#d4edda' : baseRowColor
          const brand = escapeHtml(task.brand || 'N/A')
          const projectName = escapeHtml(task.project?.name || 'N/A')
          const taskTitle = escapeHtml(task.title)
          const formattedPriority = formatPriority(task.priority)
          const dueDate = formatDate(task.dueDate)
          const taskStatus = formatStatus(task.status)
          const showMediaCounts =
            includeMediaColumns &&
            (isNewProductDesignDepartment(task.project?.department) || isNewProductDesignDepartment(currentUser?.department))
          const imageCount = showMediaCounts ? Number(task.imageCount ?? 0) : '-'
          const videoCount = showMediaCounts ? Number(task.videoCount ?? 0) : '-'
          const taskLink = task.link ? `<a href="${escapeHtml(task.link)}" target="_blank" style="color: #006ba6; text-decoration: underline;">${escapeHtml(task.link)}</a>` : '-'
          const statusColor = isCompleted ? '#155724' : '#006ba6'
          const statusStyle = isCompleted ? `color: #155724; font-weight: bold;` : `color: ${statusColor};`
          
          return `
            <tr style="background-color: ${rowColor};">
              <td style="padding: 8px; border: 1px solid #ddd; width: 15%; word-wrap: break-word;">${brand}</td>
              <td style="padding: 8px; border: 1px solid #ddd; width: 15%; word-wrap: break-word;">${projectName}</td>
              <td style="padding: 8px; border: 1px solid #ddd; width: 20%; word-wrap: break-word;">${taskTitle}</td>
              <td style="padding: 8px; border: 1px solid #ddd; width: 10%; word-wrap: break-word; ${statusStyle}">${taskStatus}</td>
              <td style="padding: 8px; border: 1px solid #ddd; width: 10%; word-wrap: break-word;">${formattedPriority}</td>
              <td style="padding: 8px; border: 1px solid #ddd; width: 10%; word-wrap: break-word;">${dueDate}</td>
              ${includeMediaColumns ? `<td style="padding: 8px; border: 1px solid #ddd; width: 8%; word-wrap: break-word;">${imageCount}</td>` : ''}
              ${includeMediaColumns ? `<td style="padding: 8px; border: 1px solid #ddd; width: 8%; word-wrap: break-word;">${videoCount}</td>` : ''}
              <td style="padding: 8px; border: 1px solid #ddd; width: 12%; word-wrap: break-word;">${taskLink}</td>
            </tr>
          `
        }).join('') : isOnLeave 
          ? `<tr><td colspan="${includeMediaColumns ? 9 : 7}" style="padding: 8px; border: 1px solid #ddd; text-align: center; color: #ff0000; font-weight: bold;">On Leave</td></tr>`
          : `<tr><td colspan="${includeMediaColumns ? 9 : 7}" style="padding: 8px; border: 1px solid #ddd; text-align: center; color: #666; font-style: italic;">No tasks assigned</td></tr>`

        reportContent += `
          <div style="margin-bottom: 30px; border-left: 5px solid #006ba6; padding-left: 15px;">
            <h3 style="color: #b1740f; font-family: Arial, sans-serif; font-size: 16px; margin-bottom: 10px; font-weight: bold;">
              ${escapeHtml(userName)} (${escapeHtml(userEmail)})${isOnLeave ? ' - <span style="color: #ff0000;">On Leave</span>' : ''}
            </h3>
            ${!isOnLeave ? `<p style="color: #666; font-family: Arial, sans-serif; font-size: 14px; margin-bottom: 10px;">
              Total Tasks: ${employeeTasks.length}
            </p>` : `<p style="color: #ff0000; font-family: Arial, sans-serif; font-size: 14px; margin-bottom: 10px; font-weight: bold;">
              This team member is currently on leave.
            </p>`}
            <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 14px; table-layout: fixed;">
              <thead>
                <tr style="background-color: #006ba6; color: white;">
                  <th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 15%;">Brand</th>
                  <th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 15%;">Project</th>
                  <th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 20%;">Task Title</th>
                  <th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 10%;">Status</th>
                  <th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 10%;">Priority</th>
                  <th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 10%;">Due Date</th>
                  ${includeMediaColumns ? '<th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 8%;">Images</th>' : ''}
                  ${includeMediaColumns ? '<th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 8%;">Videos</th>' : ''}
                  <th style="text-align: left; padding: 10px; border: 1px solid #ddd; width: 12%;">Link</th>
                </tr>
              </thead>
              <tbody>
                ${taskRows}
              </tbody>
            </table>
          </div>
        `
      })

      tasksReportHTML = `
        <div style="background-color: #006ba6; color: white; padding: 20px; text-align: center; margin-bottom: 20px;">
          <h2 style="margin: 0; font-family: Arial, sans-serif; font-size: 24px;">In-Progress & Recurring Tasks Report</h2>
        </div>
        <div style="margin-bottom: 20px; font-family: Arial, sans-serif;">
          <p style="font-size: 14px; color: #333;">
            ${includeDepartmentTasks ? `<strong>Total Employees:</strong> ${totalEmployees}<br>` : ''}
            <strong>Total Tasks:</strong> ${totalTasks}
          </p>
        </div>
        ${reportContent}
      `
    }

    // Combine original body with tasks report (tasks are part of body, not shown in UI)
    // If body is empty, just use tasks report
    const emailBody = (body && body.trim() ? body + tasksReportHTML : tasksReportHTML)

    // Send email via Microsoft Graph API
    try {
      await microsoftGraphClient.sendEmail(toArray, ccArray, finalSubject, emailBody)
    } catch (emailError: any) {
      console.error('Error sending email via Microsoft Graph:', emailError)
      // Log the error but still save to database
    }

    // Store email log in database
    const emailLog = await prisma.emailLog.create({
      data: {
        to: JSON.stringify(toArray),
        cc: ccArray ? JSON.stringify(ccArray) : null,
        subject: finalSubject,
        body: body, // Store original body without tasks (tasks are part of email body, not UI)
        userId: req.userId,
      },
    })

    // Log activity
    await logActivity({
      type: 'EMAIL_SENT',
      action: 'Email Sent',
      description: `Sent email "${finalSubject}" to ${toArray.join(', ')}${ccArray ? ` (CC: ${ccArray.join(', ')})` : ''}`,
      entityType: 'email',
      entityId: emailLog.id,
      metadata: {
        subject: finalSubject,
        to: toArray,
        cc: ccArray,
        includeDepartmentTasks,
      },
      userId: req.userId,
    })

    res.status(201).json({ message: 'Email sent successfully', emailLog })
  } catch (error: any) {
    console.error('Error sending email:', error)
    res.status(500).json({ error: error.message || 'Internal server error' })
  }
})

// Get auto-email config (Super Admin only)
router.get('/admin/auto-email-config', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check if user is super admin
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    if (!currentUser || currentUser.role?.toLowerCase() !== 'superadmin') {
      return res.status(403).json({ error: 'Only super admins can access auto-email config' })
    }

    // Get or create default config
    let config: any
    try {
      // Try to include departmentConfigs (if Prisma client is up to date)
      config = await prisma.autoEmailConfig.findFirst({
        include: {
          departmentConfigs: true,
        },
      })
    } catch (error: any) {
      // Fallback if relation doesn't exist yet (Prisma client not regenerated)
      console.warn('DepartmentConfigs relation not available, using fallback:', error.message)
      config = await prisma.autoEmailConfig.findFirst()
      if (config) {
        // Add empty departmentConfigs array for compatibility
        config.departmentConfigs = []
      }
    }
    
    if (!config) {
      try {
        config = await prisma.autoEmailConfig.create({
          data: {
            enabled: false,
            toEmails: ['priyanka.aeron@ecosoulhome.com', 'charu.anand@ecosoulhome.com'],
            timezone: 'Asia/Kolkata',
            sendWhenEmpty: false,
          },
          include: {
            departmentConfigs: true,
          },
        })
      } catch (error: any) {
        // Fallback if relation doesn't exist yet
        config = await prisma.autoEmailConfig.create({
          data: {
            enabled: false,
            toEmails: ['priyanka.aeron@ecosoulhome.com', 'charu.anand@ecosoulhome.com'],
            timezone: 'Asia/Kolkata',
            sendWhenEmpty: false,
          },
        })
        config.departmentConfigs = []
      }
    }

    // Ensure departmentConfigs exists (for backward compatibility)
    if (!config.departmentConfigs) {
      config.departmentConfigs = []
    }

    res.json(config)
  } catch (error: any) {
    console.error('Error fetching auto-email config:', error)
    res.status(500).json({ error: error.message || 'Internal server error' })
  }
})

// Create or update auto-email config (Super Admin only)
router.post('/admin/auto-email-config', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check if user is super admin
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    if (!currentUser || currentUser.role?.toLowerCase() !== 'superadmin') {
      return res.status(403).json({ error: 'Only super admins can update auto-email config' })
    }

    const { enabled, toEmails, timezone, sendWhenEmpty, departmentConfigs } = req.body

    // Validate required fields if enabled
    if (enabled) {
      if (!toEmails || !Array.isArray(toEmails) || toEmails.length === 0) {
        return res.status(400).json({ error: 'At least one recipient email is required when enabled' })
      }
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      const invalidEmails = toEmails.filter((email: string) => typeof email !== 'string' || !emailRegex.test(email.trim()))
      if (invalidEmails.length > 0) {
        return res.status(400).json({ error: `Invalid email format: ${invalidEmails.join(', ')}` })
      }
      if (!departmentConfigs || !Array.isArray(departmentConfigs) || departmentConfigs.length === 0) {
        return res.status(400).json({ error: 'At least one department configuration is required when enabled' })
      }
      
      // Validate each department config
      for (const deptConfig of departmentConfigs) {
        if (!deptConfig.department || typeof deptConfig.department !== 'string') {
          return res.status(400).json({ error: 'Each department config must have a department name' })
        }
        if (deptConfig.enabled) {
          if (!deptConfig.daysOfWeek || !Array.isArray(deptConfig.daysOfWeek) || deptConfig.daysOfWeek.length === 0) {
            return res.status(400).json({ error: `Department ${deptConfig.department}: At least one day of week is required when enabled` })
          }
          if (!deptConfig.timeOfDay || typeof deptConfig.timeOfDay !== 'string' || !/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(deptConfig.timeOfDay)) {
            return res.status(400).json({ error: `Department ${deptConfig.department}: Valid time of day (HH:MM) is required when enabled` })
          }
          // Validate daysOfWeek (0-6)
          const invalidDays = deptConfig.daysOfWeek.filter((day: any) => typeof day !== 'number' || day < 0 || day > 6)
          if (invalidDays.length > 0) {
            return res.status(400).json({ error: `Department ${deptConfig.department}: Days of week must be numbers between 0 (Sunday) and 6 (Saturday)` })
          }
        }
      }
    }

    // Get or create config
    let config = await prisma.autoEmailConfig.findFirst()
    if (config) {
      // Update existing config
      // Process toEmails: if provided, use it; otherwise keep existing
      let processedToEmails = config.toEmails
      if (toEmails !== undefined) {
        if (Array.isArray(toEmails)) {
          // Filter out empty strings and normalize emails
          processedToEmails = toEmails
            .filter((email: string) => email && typeof email === 'string' && email.trim())
            .map((email: string) => email.trim().toLowerCase())
          // Remove duplicates
          processedToEmails = [...new Set(processedToEmails)]
        }
      }
      
      config = await prisma.autoEmailConfig.update({
        where: { id: config.id },
        data: {
          enabled: enabled ?? config.enabled,
          toEmails: processedToEmails,
          timezone: timezone ?? config.timezone,
          sendWhenEmpty: sendWhenEmpty ?? config.sendWhenEmpty,
        },
      })
    } else {
      // Create new config
      const defaultToEmails = ['priyanka.aeron@ecosoulhome.com', 'charu.anand@ecosoulhome.com']
      let processedToEmails = defaultToEmails
      if (toEmails && Array.isArray(toEmails) && toEmails.length > 0) {
        // Filter out empty strings and normalize emails
        processedToEmails = toEmails
          .filter((email: string) => email && typeof email === 'string' && email.trim())
          .map((email: string) => email.trim().toLowerCase())
        // Remove duplicates
        processedToEmails = [...new Set(processedToEmails)]
        // If no valid emails after processing, use defaults
        if (processedToEmails.length === 0) {
          processedToEmails = defaultToEmails
        }
      }
      
      config = await prisma.autoEmailConfig.create({
        data: {
          enabled: enabled ?? false,
          toEmails: processedToEmails,
          timezone: timezone ?? 'Asia/Kolkata',
          sendWhenEmpty: sendWhenEmpty ?? false,
        },
      })
    }

    // Create/update department configs
    if (departmentConfigs && Array.isArray(departmentConfigs)) {
      try {
        // Delete all existing department configs
        await prisma.autoEmailDepartmentConfig.deleteMany({
          where: { configId: config.id },
        })
      } catch (error: any) {
        // If model doesn't exist yet, just continue
        console.warn('AutoEmailDepartmentConfig model not available:', error.message)
      }

      // Create new department configs
      for (const deptConfig of departmentConfigs) {
        try {
          await prisma.autoEmailDepartmentConfig.upsert({
            where: {
              configId_department: {
                configId: config.id,
                department: deptConfig.department,
              },
            },
            update: {
              enabled: deptConfig.enabled ?? true,
              daysOfWeek: deptConfig.daysOfWeek ?? [],
              timeOfDay: deptConfig.timeOfDay ?? '18:00',
            },
            create: {
              configId: config.id,
              department: deptConfig.department,
              enabled: deptConfig.enabled ?? true,
              daysOfWeek: deptConfig.daysOfWeek ?? [],
              timeOfDay: deptConfig.timeOfDay ?? '18:00',
            },
          })
        } catch (error: any) {
          console.error(`Error upserting department config for ${deptConfig.department}:`, error.message)
          // Continue with other departments even if one fails
        }
      }
    }

    // Return updated config with department configs
    let updatedConfig: any
    try {
      updatedConfig = await prisma.autoEmailConfig.findUnique({
        where: { id: config.id },
        include: {
          departmentConfigs: true,
        },
      })
    } catch (error: any) {
      // Fallback if relation doesn't exist
      updatedConfig = await prisma.autoEmailConfig.findUnique({
        where: { id: config.id },
      })
      updatedConfig.departmentConfigs = []
    }

    // Ensure departmentConfigs exists
    if (!updatedConfig.departmentConfigs) {
      updatedConfig.departmentConfigs = []
    }

    res.json(updatedConfig)
  } catch (error: any) {
    console.error('Error updating auto-email config:', error)
    res.status(500).json({ error: error.message || 'Internal server error' })
  }
})

export default router

