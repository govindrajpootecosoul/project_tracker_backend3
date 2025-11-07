import { Router, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

// Get all credentials (user's own + shared)
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const credentials = await prisma.credential.findMany({
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

    res.json(credentials)
  } catch (error) {
    console.error('Error fetching credentials:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get single credential
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const credential = await prisma.credential.findFirst({
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

    if (!credential) {
      return res.status(404).json({ error: 'Credential not found' })
    }

    res.json(credential)
  } catch (error) {
    console.error('Error fetching credential:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create credential
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { company, geography, platform, url, username, password, authenticator, notes, privacyLevel } = req.body

    if (!company || !geography || !platform || !username || !password) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const credential = await prisma.credential.create({
      data: {
        company: company.trim(),
        geography: geography.trim(),
        platform: platform.trim(),
        url: url?.trim() || null,
        username: username.trim(),
        password: password.trim(),
        authenticator: authenticator?.trim() || null,
        notes: notes?.trim() || null,
        privacyLevel: privacyLevel || 'PRIVATE',
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

    res.status(201).json(credential)
  } catch (error) {
    console.error('Error creating credential:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update credential
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const credential = await prisma.credential.findFirst({
      where: {
        id: req.params.id,
        OR: [
          { createdById: req.userId },
          { members: { some: { userId: req.userId, role: 'editor' } } },
        ],
      },
    })

    if (!credential) {
      return res.status(404).json({ error: 'Credential not found or insufficient permissions' })
    }

    const { company, geography, platform, url, username, password, authenticator, notes, privacyLevel } = req.body

    const updated = await prisma.credential.update({
      where: { id: req.params.id },
      data: {
        company: company?.trim() || credential.company,
        geography: geography?.trim() || credential.geography,
        platform: platform?.trim() || credential.platform,
        url: url?.trim() !== undefined ? (url?.trim() || null) : credential.url,
        username: username?.trim() || credential.username,
        password: password?.trim() || credential.password,
        authenticator: authenticator?.trim() !== undefined ? (authenticator?.trim() || null) : credential.authenticator,
        notes: notes?.trim() !== undefined ? (notes?.trim() || null) : credential.notes,
        privacyLevel: privacyLevel || credential.privacyLevel,
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
    console.error('Error updating credential:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete credential
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const credential = await prisma.credential.findFirst({
      where: {
        id: req.params.id,
        createdById: req.userId, // Only creator can delete
      },
    })

    if (!credential) {
      return res.status(404).json({ error: 'Credential not found or insufficient permissions' })
    }

    await prisma.credential.delete({
      where: { id: req.params.id },
    })

    res.json({ message: 'Credential deleted successfully' })
  } catch (error) {
    console.error('Error deleting credential:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Add member to credential
router.post('/:id/members', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const credential = await prisma.credential.findFirst({
      where: {
        id: req.params.id,
        OR: [
          { createdById: req.userId },
          { members: { some: { userId: req.userId, role: 'editor' } } },
        ],
      },
    })

    if (!credential) {
      return res.status(404).json({ error: 'Credential not found or insufficient permissions' })
    }

    // Check privacy level - only PUBLIC credentials can be shared
    if (credential.privacyLevel !== 'PUBLIC') {
      return res.status(403).json({ error: 'Only credentials with PUBLIC privacy level can be shared for collaboration' })
    }

    const { userId, role = 'viewer' } = req.body

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' })
    }

    const member = await prisma.credentialMember.create({
      data: {
        credentialId: req.params.id,
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

// Remove member from credential
router.delete('/:id/members/:memberId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const credential = await prisma.credential.findFirst({
      where: {
        id: req.params.id,
        OR: [
          { createdById: req.userId },
          { members: { some: { userId: req.userId, role: 'editor' } } },
        ],
      },
    })

    if (!credential) {
      return res.status(404).json({ error: 'Credential not found or insufficient permissions' })
    }

    await prisma.credentialMember.delete({
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

    const member = await prisma.credentialMember.update({
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

