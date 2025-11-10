import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

router.post('/signin', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const user = await prisma.user.findUnique({
      where: { email },
    })

    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    // Check if user is active
    if (user.isActive === false) {
      return res.status(403).json({ error: 'Your account has been deactivated. Please contact administrator.' })
    }

    const isPasswordValid = await bcrypt.compare(password, user.password)

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const secret = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'your-secret-key'
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      secret,
      { expiresIn: '7d' }
    )

    // Map role from database (user/admin/superadmin) to enum (USER/ADMIN/SUPER_ADMIN)
    const roleMapping: Record<string, string> = {
      'user': 'USER',
      'admin': 'ADMIN',
      'superadmin': 'SUPER_ADMIN',
    }
    const mappedRole = roleMapping[user.role.toLowerCase()] || user.role

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: mappedRole,
        employeeId: user.employeeId,
        department: user.department,
        company: user.company,
        avatar: user.image,
        isActive: user.isActive,
      },
    })
  } catch (error) {
    console.error('Error signing in:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || null,
      },
    })

    const secret = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'your-secret-key'
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      secret,
      { expiresIn: '7d' }
    )

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    })
  } catch (error) {
    console.error('Error signing up:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get current user info
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        department: true,
        employeeId: true,
        company: true,
        image: true,
        isActive: true,
        emailVerified: true,
        invitedBy: true,
        accessibleProjects: true,
        createdAt: true,
        updatedAt: true,
        hasCredentialAccess: true,
        hasSubscriptionAccess: true,
      },
    })

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Map role from database to enum format
    const roleMapping: Record<string, string> = {
      'user': 'USER',
      'admin': 'ADMIN',
      'superadmin': 'SUPER_ADMIN',
    }
    const mappedRole = roleMapping[user.role.toLowerCase()] || user.role

    res.json({
      ...user,
      role: mappedRole,
      avatar: user.image,
    })
  } catch (error) {
    console.error('Error fetching user:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router

