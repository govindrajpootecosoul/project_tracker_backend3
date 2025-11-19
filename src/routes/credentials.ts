import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

const sanitizeIdArray = (input: unknown): string[] => {
  if (!Array.isArray(input)) return []
  return Array.from(
    new Set(
      input
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean),
    ),
  )
}

const COLLAB_ROLES = new Set(['viewer', 'editor'])

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

// Bulk collaboration request for multiple credentials and members
router.post('/collaborations/request', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const credentialIds = sanitizeIdArray(req.body?.credentialIds)
    const memberIds = sanitizeIdArray(req.body?.memberIds)
    const requestedRole = typeof req.body?.role === 'string' ? req.body.role.toLowerCase() : 'viewer'
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : undefined

    if (credentialIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one credential for collaboration.' })
    }

    if (memberIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one team member to collaborate with.' })
    }

    if (!COLLAB_ROLES.has(requestedRole)) {
      return res.status(400).json({ error: 'Invalid collaboration role specified.' })
    }

    const [requester, credentials, members] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.userId },
        select: { id: true, name: true, email: true },
      }),
      prisma.credential.findMany({
        where: {
          id: { in: credentialIds },
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
    const publicCredentials = credentials.filter((credential) => credential.privacyLevel === 'PUBLIC')
    const inaccessibleCredentialCount = credentialIds.length - credentials.length

    if (publicCredentials.length === 0) {
      return res.status(403).json({ error: 'No selected credentials are available or have PUBLIC privacy level for collaboration.' })
    }

    const results: {
      memberId: string
      memberName: string
      memberEmail: string
      action: 'created' | 'updated' | 'skipped'
      credentialCount: number
      note?: string
      requestId?: string
    }[] = []

    for (const memberId of memberIds) {
      const member = memberLookup.get(memberId)
      if (!member) {
        results.push({
          memberId,
          memberName: '',
          memberEmail: '',
          action: 'skipped',
          credentialCount: 0,
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
          credentialCount: 0,
          note: 'Cannot send collaboration request to yourself',
        })
        continue
      }

      const shareableCredentialIds = publicCredentials
        .filter((credential) => credential.createdById !== memberId && !credential.members.some((m) => m.userId === memberId))
        .map((credential) => credential.id)

      if (shareableCredentialIds.length === 0) {
        results.push({
          memberId,
          memberName: member.name || '',
          memberEmail: member.email,
          action: 'skipped',
          credentialCount: 0,
          note: 'Member already has access to all selected credentials',
        })
        continue
      }

      const existingRequest = await prisma.credentialCollaborationRequest.findFirst({
        where: {
          requesterId: req.userId,
          inviteeId: memberId,
          status: 'PENDING',
        },
      })

      if (existingRequest) {
        const mergedCredentialIds = Array.from(
          new Set([...existingRequest.credentialIds, ...shareableCredentialIds]),
        )

        if (mergedCredentialIds.length === existingRequest.credentialIds.length) {
          results.push({
            memberId,
            memberName: member.name || '',
            memberEmail: member.email,
            action: 'skipped',
            credentialCount: shareableCredentialIds.length,
            note: 'There is already a pending collaboration request covering these credentials',
          })
          continue
        }

        const updatedRequest = await prisma.credentialCollaborationRequest.update({
          where: { id: existingRequest.id },
          data: {
            credentialIds: mergedCredentialIds,
            role: requestedRole,
            message: message ?? existingRequest.message,
          },
        })

        await prisma.notification.create({
          data: {
            userId: memberId,
            type: 'INVITE',
            title: 'Credential Collaboration Request Updated',
            message: `${requester?.name || requester?.email || 'A teammate'} added more credentials (${shareableCredentialIds.length}) to your collaboration request.`,
            link: `/credentials?collabRequest=${updatedRequest.id}`,
          },
        })

        results.push({
          memberId,
          memberName: member.name || '',
          memberEmail: member.email,
          action: 'updated',
          credentialCount: shareableCredentialIds.length,
          requestId: updatedRequest.id,
        })
        continue
      }

      const createdRequest = await prisma.credentialCollaborationRequest.create({
        data: {
          requesterId: req.userId,
          inviteeId: memberId,
          credentialIds: shareableCredentialIds,
          role: requestedRole,
          message,
        },
      })

      await prisma.notification.create({
        data: {
          userId: memberId,
          type: 'INVITE',
          title: 'Credential Collaboration Request',
          message: `${requester?.name || requester?.email || 'A teammate'} invited you to collaborate on ${shareableCredentialIds.length} credential${shareableCredentialIds.length > 1 ? 's' : ''}.`,
          link: `/credentials?collabRequest=${createdRequest.id}`,
        },
      })

      results.push({
        memberId,
        memberName: member.name || '',
        memberEmail: member.email,
        action: 'created',
        credentialCount: shareableCredentialIds.length,
        requestId: createdRequest.id,
      })
    }

    const createdCount = results.filter((entry) => entry.action === 'created').length
    const updatedCount = results.filter((entry) => entry.action === 'updated').length
    const skippedCount = results.filter((entry) => entry.action === 'skipped').length

    res.json({
      message: 'Collaboration requests processed',
      summary: {
        created: createdCount,
        updated: updatedCount,
        skipped: skippedCount,
        inaccessibleCredentialCount,
        details: results,
      },
    })
  } catch (error) {
    console.error('Error creating collaboration requests:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get pending collaboration requests for the current user
router.get('/collaborations/requests', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const requests = await prisma.credentialCollaborationRequest.findMany({
      where: {
        inviteeId: req.userId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
      include: {
        requester: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    const credentialIdSet = new Set<string>()
    requests.forEach((request) => {
      request.credentialIds.forEach((id) => credentialIdSet.add(id))
    })

    const credentialList = credentialIdSet.size
      ? await prisma.credential.findMany({
          where: { id: { in: Array.from(credentialIdSet) } },
          select: {
            id: true,
            company: true,
            platform: true,
            geography: true,
            privacyLevel: true,
          },
        })
      : []

    const credentialLookup = new Map(credentialList.map((credential) => [credential.id, credential]))

    const enrichedRequests = requests.map((request) => ({
      ...request,
      credentials: request.credentialIds
        .map((id) => credentialLookup.get(id))
        .filter(Boolean),
    }))

    res.json(enrichedRequests)
  } catch (error) {
    console.error('Error fetching collaboration requests:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Accept or decline a collaboration request
router.post('/collaborations/:requestId/respond', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { accept } = req.body
    if (typeof accept !== 'boolean') {
      return res.status(400).json({ error: 'Invalid response payload. Provide accept: true|false.' })
    }

    const request = await prisma.credentialCollaborationRequest.findUnique({
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

    if (accept) {
      const credentials = await prisma.credential.findMany({
        where: { id: { in: request.credentialIds } },
        include: {
          members: {
            select: { userId: true },
          },
        },
      })

      const granted: string[] = []
      const skipped: { id: string; reason: string }[] = []

      for (const credential of credentials) {
        if (credential.privacyLevel !== 'PUBLIC') {
          skipped.push({ id: credential.id, reason: 'Credential is no longer public' })
          continue
        }

        if (credential.members.some((member) => member.userId === req.userId) || credential.createdById === req.userId) {
          skipped.push({ id: credential.id, reason: 'Already has access' })
          continue
        }

        try {
          await prisma.credentialMember.create({
            data: {
              credentialId: credential.id,
              userId: req.userId,
              role: request.role ?? 'viewer',
            },
          })
          granted.push(credential.id)
        } catch (error: any) {
          if (error.code === 'P2002') {
            skipped.push({ id: credential.id, reason: 'Already granted' })
          } else {
            console.error('Error granting credential access during collaboration accept:', error)
            skipped.push({ id: credential.id, reason: 'Unexpected error while granting access' })
          }
        }
      }

      await prisma.credentialCollaborationRequest.update({
        where: { id: request.id },
        data: {
          status: 'ACCEPTED',
          respondedAt: new Date(),
        },
      })

      if (request.requesterId) {
        await prisma.notification.create({
          data: {
            userId: request.requesterId,
            type: 'INVITE',
            title: 'Credential Collaboration Accepted',
            message: `${req.user?.name || req.user?.email || 'A teammate'} accepted your collaboration request.`,
            link: '/credentials',
          },
        })
      }

      return res.json({
        message: 'Collaboration request accepted',
        grantedCredentialIds: granted,
        skippedCredentialIds: skipped,
      })
    }

    await prisma.credentialCollaborationRequest.update({
      where: { id: request.id },
      data: {
        status: 'DECLINED',
        respondedAt: new Date(),
      },
    })

    if (request.requesterId) {
      await prisma.notification.create({
        data: {
          userId: request.requesterId,
          type: 'INVITE',
          title: 'Credential Collaboration Declined',
          message: `${req.user?.name || req.user?.email || 'A teammate'} declined your collaboration request.`,
          link: '/credentials',
        },
      })
    }

    res.json({ message: 'Collaboration request declined' })
  } catch (error) {
    console.error('Error responding to collaboration request:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router

