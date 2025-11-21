import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { createNotification } from './notifications'

const router = Router()

// Helper function to calculate renewal date
const calculateRenewalDate = (startDate: Date, billingCycle: string): Date => {
  const renewal = new Date(startDate)
  switch (billingCycle) {
    case 'WEEKLY':
      renewal.setDate(renewal.getDate() + 7)
      break
    case 'MONTHLY':
      renewal.setMonth(renewal.getMonth() + 1)
      break
    case 'QUARTERLY':
      renewal.setMonth(renewal.getMonth() + 3)
      break
    case 'YEARLY':
      renewal.setFullYear(renewal.getFullYear() + 1)
      break
    default:
      renewal.setMonth(renewal.getMonth() + 1)
  }
  return renewal
}

// Get all subscriptions (user's own + shared)
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const subscriptions = await prisma.subscription.findMany({
      where: {
        OR: [
          { createdById: req.userId },
          { members: { some: { userId: req.userId } } },
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
      orderBy: {
        createdAt: 'desc',
      },
    })

    res.json(subscriptions)
  } catch (error: any) {
    console.error('Error fetching subscriptions:', error)
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message || 'Failed to fetch subscriptions',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
})

// Get single subscription
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        id: req.params.id,
        OR: [
          { createdById: req.userId },
          { members: { some: { userId: req.userId } } },
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
    })

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' })
    }

    res.json(subscription)
  } catch (error) {
    console.error('Error fetching subscription:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create subscription
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { name, url, amount, currency, status, billingCycle, startDate, description, notes } = req.body

    if (!name || !amount || !billingCycle || !startDate) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const start = new Date(startDate)
    const renewalDate = calculateRenewalDate(start, billingCycle)

    const subscription = await prisma.subscription.create({
      data: {
        name: name.trim(),
        url: url?.trim() || null,
        amount: parseFloat(amount),
        currency: currency || 'USD',
        status: status || 'ACTIVE',
        billingCycle,
        startDate: start,
        renewalDate,
        description: description?.trim() || null,
        notes: notes?.trim() || null,
        createdById: req.userId,
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
    })

    res.status(201).json(subscription)
  } catch (error) {
    console.error('Error creating subscription:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update subscription
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        id: req.params.id,
        OR: [
          { createdById: req.userId },
          { members: { some: { userId: req.userId, role: 'editor' } } },
        ],
      },
    })

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found or insufficient permissions' })
    }

    const { name, url, amount, currency, status, billingCycle, startDate, description, notes } = req.body

    let renewalDate = subscription.renewalDate
    if (startDate && billingCycle) {
      renewalDate = calculateRenewalDate(new Date(startDate), billingCycle)
    } else if (startDate) {
      renewalDate = calculateRenewalDate(new Date(startDate), subscription.billingCycle)
    } else if (billingCycle) {
      renewalDate = calculateRenewalDate(subscription.startDate, billingCycle)
    }

    const updated = await prisma.subscription.update({
      where: { id: req.params.id },
      data: {
        name: name?.trim() || subscription.name,
        url: url?.trim() !== undefined ? (url?.trim() || null) : subscription.url,
        amount: amount !== undefined ? parseFloat(amount) : subscription.amount,
        currency: currency || subscription.currency,
        status: status || subscription.status,
        billingCycle: billingCycle || subscription.billingCycle,
        startDate: startDate ? new Date(startDate) : subscription.startDate,
        renewalDate,
        description: description?.trim() !== undefined ? (description?.trim() || null) : subscription.description,
        notes: notes?.trim() !== undefined ? (notes?.trim() || null) : subscription.notes,
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
    })

    res.json(updated)
  } catch (error) {
    console.error('Error updating subscription:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete subscription
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        id: req.params.id,
        createdById: req.userId, // Only creator can delete
      },
    })

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found or insufficient permissions' })
    }

    await prisma.subscription.delete({
      where: { id: req.params.id },
    })

    res.json({ message: 'Subscription deleted successfully' })
  } catch (error) {
    console.error('Error deleting subscription:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Add member to subscription
router.post('/:id/members', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        id: req.params.id,
        OR: [
          { createdById: req.userId },
          { members: { some: { userId: req.userId, role: 'editor' } } },
        ],
      },
    })

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found or insufficient permissions' })
    }

    const { userId, role = 'viewer' } = req.body

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' })
    }

    const member = await prisma.subscriptionMember.create({
      data: {
        subscriptionId: req.params.id,
        userId,
        role,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    res.status(201).json(member)
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'User is already a member' })
    }
    console.error('Error adding member:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Remove member from subscription
router.delete('/:id/members/:memberId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        id: req.params.id,
        OR: [
          { createdById: req.userId },
          { members: { some: { userId: req.userId, role: 'editor' } } },
        ],
      },
    })

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found or insufficient permissions' })
    }

    await prisma.subscriptionMember.delete({
      where: { id: req.params.memberId },
    })

    res.json({ message: 'Member removed successfully' })
  } catch (error) {
    console.error('Error removing member:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Toggle member active status (admin only)
router.put('/:id/members/:memberId/active', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check if user is admin or super admin
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    if (!user || (user.role?.toLowerCase() !== 'admin' && user.role?.toLowerCase() !== 'superadmin')) {
      return res.status(403).json({ error: 'Insufficient permissions. Admin access required.' })
    }

    const { isActive } = req.body

    const member = await prisma.subscriptionMember.update({
      where: { id: req.params.memberId },
      data: { isActive: isActive !== undefined ? isActive : true },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    res.json(member)
  } catch (error) {
    console.error('Error updating member status:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Helper function to sanitize ID arrays
const sanitizeIdArray = (input: any): string[] => {
  if (!Array.isArray(input)) return []
  return input
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim())
}

// Bulk collaboration request for multiple subscriptions and members
router.post('/collaborations/request', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const subscriptionIds = sanitizeIdArray(req.body?.subscriptionIds)
    const memberIds = sanitizeIdArray(req.body?.memberIds)
    const requestedRole = typeof req.body?.role === 'string' ? req.body.role.toLowerCase() : 'viewer'
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : undefined

    if (subscriptionIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one subscription for collaboration.' })
    }

    if (memberIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one team member to collaborate with.' })
    }

    const validRoles = new Set(['viewer', 'editor'])
    if (!validRoles.has(requestedRole)) {
      return res.status(400).json({ error: 'Invalid collaboration role specified. Must be "viewer" or "editor".' })
    }

    const [requester, subscriptions, members] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.userId },
        select: { id: true, name: true, email: true },
      }),
      prisma.subscription.findMany({
        where: {
          id: { in: subscriptionIds },
          OR: [
            { createdById: req.userId },
            { members: { some: { userId: req.userId, role: 'editor' } } },
          ],
        },
        include: {
          members: {
            select: {
              userId: true,
            },
          },
        },
      }),
      prisma.user.findMany({
        where: {
          id: { in: memberIds },
          isActive: true,
        },
        select: { id: true, name: true, email: true },
      }),
    ])

    const memberLookup = new Map(members.map((member) => [member.id, member]))
    const inaccessibleSubscriptionCount = subscriptionIds.length - subscriptions.length

    if (subscriptions.length === 0) {
      return res.status(403).json({ error: 'No selected subscriptions are available for collaboration.' })
    }

    const results: {
      memberId: string
      memberName: string
      memberEmail: string
      action: 'created' | 'updated' | 'skipped'
      subscriptionCount: number
      note?: string
    }[] = []

    for (const memberId of memberIds) {
      const member = memberLookup.get(memberId)
      if (!member) {
        results.push({
          memberId,
          memberName: '',
          memberEmail: '',
          action: 'skipped',
          subscriptionCount: 0,
          note: 'User not found or inactive',
        })
        continue
      }

      if (memberId === req.userId) {
        results.push({
          memberId,
          memberName: member.name || '',
          memberEmail: member.email,
          action: 'skipped',
          subscriptionCount: 0,
          note: 'Cannot send collaboration request to yourself',
        })
        continue
      }

      const shareableSubscriptionIds = subscriptions
        .filter((subscription) => subscription.createdById !== memberId && !subscription.members.some((m) => m.userId === memberId))
        .map((subscription) => subscription.id)

      if (shareableSubscriptionIds.length === 0) {
        results.push({
          memberId,
          memberName: member.name || '',
          memberEmail: member.email,
          action: 'skipped',
          subscriptionCount: 0,
          note: 'Member already has access to all selected subscriptions',
        })
        continue
      }

      // Check for existing pending request
      const existingRequest = await prisma.subscriptionCollaborationRequest.findFirst({
        where: {
          requesterId: req.userId,
          inviteeId: memberId,
          status: 'PENDING',
        },
      })

      if (existingRequest) {
        const mergedSubscriptionIds = Array.from(
          new Set([...existingRequest.subscriptionIds, ...shareableSubscriptionIds]),
        )

        if (mergedSubscriptionIds.length === existingRequest.subscriptionIds.length) {
          results.push({
            memberId,
            memberName: member.name || '',
            memberEmail: member.email,
            action: 'skipped',
            subscriptionCount: shareableSubscriptionIds.length,
            note: 'There is already a pending collaboration request covering these subscriptions',
          })
          continue
        }

        const updatedRequest = await prisma.subscriptionCollaborationRequest.update({
          where: { id: existingRequest.id },
          data: {
            subscriptionIds: mergedSubscriptionIds,
            role: requestedRole,
            message: message ?? existingRequest.message,
          },
        })

        await createNotification(
          memberId,
          'INVITE',
          'Subscription Collaboration Request Updated',
          `${requester?.name || requester?.email || 'A teammate'} added more subscriptions (${shareableSubscriptionIds.length}) to your collaboration request.`,
          `/subscriptions?subscriptionCollabRequest=${updatedRequest.id}`,
        )

        results.push({
          memberId,
          memberName: member.name || '',
          memberEmail: member.email,
          action: 'updated',
          subscriptionCount: shareableSubscriptionIds.length,
        })
        continue
      }

      // Create new collaboration request
      const createdRequest = await prisma.subscriptionCollaborationRequest.create({
        data: {
          requesterId: req.userId,
          inviteeId: memberId,
          subscriptionIds: shareableSubscriptionIds,
          role: requestedRole,
          message,
        },
      })

      await createNotification(
        memberId,
        'INVITE',
        'Subscription Collaboration Request',
        `${requester?.name || requester?.email || 'A teammate'} invited you to collaborate on ${shareableSubscriptionIds.length} subscription${shareableSubscriptionIds.length > 1 ? 's' : ''}.`,
        `/subscriptions?subscriptionCollabRequest=${createdRequest.id}`,
      )

      results.push({
        memberId,
        memberName: member.name || '',
        memberEmail: member.email,
        action: 'created',
        subscriptionCount: shareableSubscriptionIds.length,
      })
    }

    const createdCount = results.filter((entry) => entry.action === 'created').length
    const skippedCount = results.filter((entry) => entry.action === 'skipped').length

    res.json({
      message: 'Collaboration requests processed',
      summary: {
        created: createdCount,
        updated: 0,
        skipped: skippedCount,
        inaccessibleSubscriptionCount,
        details: results,
      },
    })
  } catch (error) {
    console.error('Error creating collaboration requests:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get pending collaboration requests for current user
router.get('/collaborations/requests', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const requests = await prisma.subscriptionCollaborationRequest.findMany({
      where: {
        inviteeId: req.userId,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        requester: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    const subscriptionIdSet = new Set<string>()
    requests.forEach((request) => {
      request.subscriptionIds.forEach((id) => subscriptionIdSet.add(id))
    })

    const subscriptionList = subscriptionIdSet.size
      ? await prisma.subscription.findMany({
          where: { id: { in: Array.from(subscriptionIdSet) } },
          select: {
            id: true,
            name: true,
            currency: true,
            amount: true,
            billingCycle: true,
          },
        })
      : []

    const subscriptionLookup = new Map(subscriptionList.map((subscription) => [subscription.id, subscription]))

    const enrichedRequests = requests.map((request) => ({
      ...request,
      subscriptions: request.subscriptionIds.map((id) => subscriptionLookup.get(id)).filter(Boolean),
    }))

    res.json(enrichedRequests)
  } catch (error) {
    console.error('Error fetching subscription collaboration requests:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get collaboration requests sent by current user
router.get('/collaborations/requests/sent', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const requests = await prisma.subscriptionCollaborationRequest.findMany({
      where: {
        requesterId: req.userId,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        invitee: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    res.json(requests)
  } catch (error) {
    console.error('Error fetching sent subscription collaboration requests:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Respond to collaboration request
router.post('/collaborations/:requestId/respond', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { accept } = req.body
    if (typeof accept !== 'boolean') {
      return res.status(400).json({ error: 'Invalid response payload. Provide accept: true|false.' })
    }

    const request = await prisma.subscriptionCollaborationRequest.findUnique({
      where: { id: req.params.requestId },
      include: {
        requester: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    if (!request) {
      return res.status(404).json({ error: 'Collaboration request not found' })
    }

    if (request.inviteeId !== req.userId) {
      return res.status(403).json({ error: 'You do not have access to this collaboration request' })
    }

    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: 'This collaboration request has already been processed' })
    }

    const inviteeUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { name: true, email: true },
    })

    const formatUserName = (user: { name?: string; email: string } | null) => {
      return user?.name || user?.email || 'A teammate'
    }

    if (accept) {
      const subscriptions = await prisma.subscription.findMany({
        where: { id: { in: request.subscriptionIds } },
        include: {
          members: {
            select: { userId: true },
          },
        },
      })

      let addedCount = 0
      for (const subscription of subscriptions) {
        const alreadyMember = subscription.members.some((member) => member.userId === req.userId)
        if (alreadyMember) continue
        try {
          await prisma.subscriptionMember.create({
            data: {
              subscriptionId: subscription.id,
              userId: req.userId,
              role: request.role,
            },
          })
          addedCount++
        } catch (error) {
          console.error(`Failed adding user ${req.userId} to subscription ${subscription.id}:`, error)
        }
      }

      await prisma.subscriptionCollaborationRequest.update({
        where: { id: request.id },
        data: {
          status: 'ACCEPTED',
          respondedAt: new Date(),
        },
      })

      if (request.requesterId) {
        await createNotification(
          request.requesterId,
          'INVITE',
          'Subscription Collaboration Accepted',
          `${formatUserName(inviteeUser)} accepted your subscription collaboration request.`,
          '/subscriptions',
        )
      }

      res.json({ success: true, addedSubscriptions: addedCount })
    } else {
      await prisma.subscriptionCollaborationRequest.update({
        where: { id: request.id },
        data: {
          status: 'CANCELLED',
          respondedAt: new Date(),
        },
      })

      if (request.requesterId) {
        await createNotification(
          request.requesterId,
          'INVITE',
          'Subscription Collaboration Declined',
          `${formatUserName(inviteeUser)} declined your subscription collaboration request.`,
          '/subscriptions',
        )
      }

      res.json({ success: true, message: 'Collaboration request declined' })
    }
  } catch (error) {
    console.error('Error responding to subscription collaboration request:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router

