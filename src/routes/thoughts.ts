import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

export const defaultThoughts: string[] = [
  'Be the employee who solves, not complains.',
  'Professionalism is your biggest asset.',
  'Smart work saves time; hard work builds character.',
  'Respect deadlines - they build trust.',
  'Stay curious; learning keeps you relevant.',
  'Your performance speaks louder than your position.',
  'Corporate success is a result of consistent effort.',
  'Choose progress over perfection.',
  'Work ethics define your career path.',
  'A good attitude is non-negotiable.',
  'Focus on goals, not gossip.',
  'Every task is an opportunity to prove reliability.',
  'Be accountable for your actions.',
  'Communication is the key to clarity.',
  'Small improvements lead to big achievements.',
  'Teamwork makes deadlines possible.',
  "Take ownership - champions don't wait for instructions.",
  "Your vibe impacts your team's energy.",
  'Be disciplined; it beats talent.',
  'Growth begins at the end of your comfort zone.',
  'Work with honesty; results will follow.',
  'Your mindset drives your career.',
  'Stay organized; it boosts productivity.',
  'Be adaptable - corporate change is constant.',
  'Stay calm; smart decisions need a calm mind.',
  'Deliver more than you promise.',
  'Mistakes are lessons; learn fast, move forward.',
  'Respect colleagues; relationships build workplaces.',
  "Lead by example, even if you're not the leader.",
  'Work with purpose, not pressure.',
]

const isSuperAdmin = (role?: string | null) => role?.toLowerCase() === 'superadmin'

const normalizeThoughtsInput = (input: unknown): string[] => {
  if (!Array.isArray(input)) return []
  return input
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length > 0)
}

export const ensureThoughtsSeed = async () => {
  const existing = await prisma.thought.findMany({
    orderBy: { order: 'asc' },
    select: { content: true },
  })

  const matchesDefault =
    existing.length === defaultThoughts.length &&
    existing.every((item, idx) => item.content === defaultThoughts[idx])

  if (matchesDefault) return

      await prisma.$transaction([
        prisma.thought.deleteMany({}),
        prisma.thought.createMany({
          data: defaultThoughts.map((content, index) => ({
            content,
            order: index,
            isActive: false, // Not needed for auto-rotation, but keep for schema compatibility
          })),
        }),
      ])
}

router.get('/', async (_req, res: Response) => {
  try {
    let thoughts = await prisma.thought.findMany({
      orderBy: { order: 'asc' },
    })

    if (!thoughts.length) {
      await ensureThoughtsSeed()
      thoughts = await prisma.thought.findMany({
        orderBy: { order: 'asc' },
      })
    }

    // Get today's date (start of day) in UTC
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const todayEnd = new Date(today)
    todayEnd.setUTCHours(23, 59, 59, 999)
    
    // Check if there's a manually selected thought for today
    const selectedThought = thoughts.find(t => {
      if (!t.selectedForDate) return false
      const selectedDate = new Date(t.selectedForDate)
      return selectedDate >= today && selectedDate <= todayEnd
    })

    let dailyThought = selectedThought

    // If no manual selection, use automatic rotation based on day index
    if (!dailyThought && thoughts.length > 0) {
      const dayIndex = Math.floor(Date.now() / (1000 * 60 * 60 * 24))
      const thoughtIndex = dayIndex % thoughts.length
      dailyThought = thoughts[thoughtIndex]
    }
    
    res.json({ 
      thoughts,
      dailyThought: dailyThought || null 
    })
  } catch (error) {
    console.error('Error fetching thoughts:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    console.log('PUT /thoughts - Request received')
    console.log('Request body:', JSON.stringify(req.body, null, 2))
    
    if (!req.userId) {
      console.log('No userId found in request')
      return res.status(401).json({ error: 'Unauthorized' })
    }

    console.log('Fetching user with id:', req.userId)
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    if (!currentUser) {
      console.log('User not found')
      return res.status(401).json({ error: 'Unauthorized' })
    }

    console.log('User role:', currentUser.role)
    if (!isSuperAdmin(currentUser.role)) {
      console.log('User is not super admin')
      return res.status(403).json({ error: 'Forbidden: superadmin only' })
    }

    const thoughtsInput = normalizeThoughtsInput(req.body.thoughts)
    console.log('Normalized thoughts input:', thoughtsInput)
    
    if (!thoughtsInput.length) {
      console.log('No thoughts input provided')
      return res.status(400).json({ error: 'Thoughts array is required' })
    }

    // Try transaction first (like ensureThoughtsSeed), fallback to sequential if it fails
    console.log('Starting transaction to update thoughts...')
    try {
      await prisma.$transaction([
        prisma.thought.deleteMany({}),
        prisma.thought.createMany({
          data: thoughtsInput.map((content, index) => ({
            content,
            order: index,
            updatedById: req.userId,
            isActive: false, // Not needed for auto-rotation, but keep for schema compatibility
          })),
        }),
      ])
      console.log('Transaction completed successfully')
    } catch (transactionError: any) {
      console.warn('Transaction failed, trying sequential approach:', transactionError?.message)
      // Fallback: delete and create sequentially
      await prisma.thought.deleteMany({})
      await prisma.thought.createMany({
        data: thoughtsInput.map((content, index) => ({
          content,
          order: index,
          updatedById: req.userId,
          isActive: false, // Not needed for auto-rotation, but keep for schema compatibility
        })),
      })
      console.log('Sequential approach completed successfully')
    }

    console.log('Successfully created all thoughts, fetching updated list...')
    const updated = await prisma.thought.findMany({
      orderBy: { order: 'asc' },
    })

    console.log('Returning', updated.length, 'thoughts')
    res.json({ thoughts: updated })
  } catch (error: any) {
    console.error('Error updating thoughts:', error)
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack,
      name: error?.name,
    })
    
    // Return more detailed error message for debugging
    const errorMessage = error?.message || 'Internal server error'
    const errorCode = error?.code || 'UNKNOWN_ERROR'
    
    res.status(500).json({ 
      error: 'Internal server error',
      details: errorMessage,
      code: errorCode,
    })
  }
})

// Manually select a thought for today (super admin only)
// This overrides the automatic daily rotation
router.patch('/:thoughtId/select', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    console.log('PATCH /thoughts/:thoughtId/select - Request received')
    console.log('Thought ID:', req.params.thoughtId)
    
    if (!req.userId) {
      console.log('No userId found in request')
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    })

    if (!currentUser) {
      console.log('User not found')
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (!isSuperAdmin(currentUser.role)) {
      console.log('User is not super admin')
      return res.status(403).json({ error: 'Forbidden: superadmin only' })
    }

    const thoughtId = req.params.thoughtId
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    console.log('Today date:', today.toISOString())

    // Get all thoughts first to find ones selected for today
    const allThoughts = await prisma.thought.findMany()
    
    // Clear any previous selections for today (simpler approach)
    const todayStart = new Date(today)
    const todayEnd = new Date(today)
    todayEnd.setUTCHours(23, 59, 59, 999)
    
    // Try to clear previous selections - handle case where field might not exist
    try {
      for (const thought of allThoughts) {
        if (thought.selectedForDate) {
          const selectedDate = new Date(thought.selectedForDate)
          if (selectedDate >= todayStart && selectedDate <= todayEnd) {
            await prisma.thought.update({
              where: { id: thought.id },
              data: { selectedForDate: null },
            })
          }
        }
      }
    } catch (clearError: any) {
      console.warn('Error clearing previous selections (field might not exist yet):', clearError?.message)
      // Continue anyway - might be first time using this feature
    }

    // Select the chosen thought for today
    console.log('Updating thought:', thoughtId, 'with date:', today)
    let updatedThought
    try {
      // Try to update with selectedForDate field
      updatedThought = await prisma.thought.update({
        where: { id: thoughtId },
        data: { selectedForDate: today } as any,
      })
    } catch (updateError: any) {
      // If the field doesn't exist in Prisma client, use raw MongoDB update
      if (updateError?.message?.includes('Unknown arg') || 
          updateError?.message?.includes('selectedForDate') ||
          updateError?.code === 'P2009') {
        console.warn('selectedForDate field not in Prisma client, using raw MongoDB update')
        try {
          // Use raw MongoDB update as fallback
          await (prisma as any).$runCommandRaw({
            update: 'thoughts',
            updates: [
              {
                q: { _id: { $oid: thoughtId } },
                u: { $set: { selectedForDate: today } },
              },
            ],
          })
          // Also clear other selections for today
          const todayStart = new Date(today)
          const todayEnd = new Date(today)
          todayEnd.setUTCHours(23, 59, 59, 999)
          await (prisma as any).$runCommandRaw({
            update: 'thoughts',
            updates: [
              {
                q: { 
                  selectedForDate: { 
                    $gte: todayStart,
                    $lte: todayEnd
                  },
                  _id: { $ne: { $oid: thoughtId } }
                },
                u: { $unset: { selectedForDate: '' } },
                multi: true,
              },
            ],
          })
          // Fetch the updated thought
          updatedThought = await prisma.thought.findUnique({
            where: { id: thoughtId },
          })
          if (!updatedThought) {
            throw new Error('Thought not found after update')
          }
          console.log('Successfully updated using raw MongoDB command')
        } catch (rawError: any) {
          console.error('Raw MongoDB update also failed:', rawError)
          throw new Error('Failed to update thought. Please stop the server, run: cd backend && npx prisma generate, then restart the server.')
        }
      } else {
        throw updateError
      }
    }

    console.log('Thought updated successfully')

    // Get all thoughts with updated order
    const updatedThoughts = await prisma.thought.findMany({
      orderBy: { order: 'asc' },
    })

    res.json({ 
      thoughts: updatedThoughts,
      dailyThought: updatedThought 
    })
  } catch (error: any) {
    console.error('Error selecting thought:', error)
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack,
      name: error?.name,
    })
    
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Thought not found' })
    }

    res.status(500).json({ 
      error: 'Internal server error',
      details: error?.message || 'Unknown error',
      code: error?.code || 'UNKNOWN_ERROR',
    })
  }
})

export default router

