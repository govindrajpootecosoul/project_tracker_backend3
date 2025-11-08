import { Router, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { microsoftGraphClient } from '../../lib/microsoft-graph'
import { logActivity } from '../utils/activityLogger'

const router = Router()

// Send email via Microsoft Graph API
router.post('/send', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { to, cc, subject, body, includeDepartmentTasks } = req.body

    // Validate required fields - check for empty strings as well
    if (!to || (typeof to === 'string' && !to.trim())) {
      return res.status(400).json({ error: 'To field is required' })
    }
    if (!subject || (typeof subject === 'string' && !subject.trim())) {
      return res.status(400).json({ error: 'Subject is required' })
    }
    if (!body || (typeof body === 'string' && !body.trim())) {
      return res.status(400).json({ error: 'Body is required' })
    }

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
      // Get logged-in user's department
      const currentUser = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { department: true },
      })

      if (currentUser?.department) {
        // Get all users in the same department
        const departmentUsers = await prisma.user.findMany({
          where: {
            department: currentUser.department,
          },
          select: { id: true },
        })

        const departmentUserIds = departmentUsers.map(u => u.id)

        // Fetch tasks from department members with status "IN_PROGRESS" or recurring
        tasks = await prisma.task.findMany({
          where: {
            OR: [
              { status: 'IN_PROGRESS' },
              { recurring: { not: null } },
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
            createdBy: {
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
        })
      }
    } else {
      // Fetch only user's own tasks with status "IN_PROGRESS" or recurring
      tasks = await prisma.task.findMany({
        where: {
          OR: [
            { status: 'IN_PROGRESS' },
            { recurring: { not: null } },
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
          createdBy: {
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

    // Generate HTML table for tasks
    let tasksTableHTML = ''
    if (tasks.length > 0) {
      const tableRows = tasks.map((task: any, index: number) => {
        const assignees = task.assignees.map((a: any) => a.user.name || a.user.email).join(', ')
        const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'N/A'
        const recurring = task.recurring || 'N/A'
        const projectName = task.project?.name || 'N/A'
        const rowColor = index % 2 === 0 ? '#f9f9f9' : '#ffffff'
        
        return `
          <tr style="background-color: ${rowColor};">
            <td style="padding: 8px;">${escapeHtml(task.title)}</td>
            <td style="padding: 8px;">${escapeHtml(task.status)}</td>
            <td style="padding: 8px;">${escapeHtml(task.priority)}</td>
            <td style="padding: 8px;">${escapeHtml(recurring)}</td>
            <td style="padding: 8px;">${escapeHtml(projectName)}</td>
            <td style="padding: 8px;">${escapeHtml(dueDate)}</td>
            <td style="padding: 8px;">${escapeHtml(assignees)}</td>
          </tr>
        `
      }).join('')

      const tableTitle = includeDepartmentTasks 
        ? 'Department Tasks Summary (IN_PROGRESS & RECURRING)'
        : 'My Tasks Summary (IN_PROGRESS & RECURRING)'
      
      tasksTableHTML = `
        <br><br>
        <h3 style="color: #333; font-family: Arial, sans-serif;">${tableTitle}</h3>
        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 14px;">
          <thead>
            <tr style="background-color: #4CAF50; color: white;">
              <th style="text-align: left; padding: 10px;">Title</th>
              <th style="text-align: left; padding: 10px;">Status</th>
              <th style="text-align: left; padding: 10px;">Priority</th>
              <th style="text-align: left; padding: 10px;">Recurring</th>
              <th style="text-align: left; padding: 10px;">Project</th>
              <th style="text-align: left; padding: 10px;">Due Date</th>
              <th style="text-align: left; padding: 10px;">Assignees</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      `
    }

    // Combine original body with tasks table
    const emailBody = body + tasksTableHTML

    // Send email via Microsoft Graph API
    try {
      await microsoftGraphClient.sendEmail(toArray, ccArray, subject, emailBody)
    } catch (emailError: any) {
      console.error('Error sending email via Microsoft Graph:', emailError)
      // Log the error but still save to database
    }

    // Store email log in database
    const emailLog = await prisma.emailLog.create({
      data: {
        to: JSON.stringify(toArray),
        cc: ccArray ? JSON.stringify(ccArray) : null,
        subject,
        body: body,
        userId: req.userId,
      },
    })

    // Log activity
    await logActivity({
      type: 'EMAIL_SENT',
      action: 'Email Sent',
      description: `Sent email "${subject}" to ${toArray.join(', ')}${ccArray ? ` (CC: ${ccArray.join(', ')})` : ''}`,
      entityType: 'email',
      entityId: emailLog.id,
      metadata: {
        subject,
        to: toArray,
        cc: ccArray,
      },
      userId: req.userId,
    })

    res.status(201).json({ message: 'Email sent successfully', emailLog })
  } catch (error: any) {
    console.error('Error sending email:', error)
    res.status(500).json({ error: error.message || 'Internal server error' })
  }
})

export default router

