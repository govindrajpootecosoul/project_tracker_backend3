import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

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

export default router

