import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { microsoftGraphClient } from '../lib/microsoft-graph'

const router = Router()
const generateResetCode = (): string => {
  return Math.floor(1000 + Math.random() * 9000).toString()
}


const normalizeEmail = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase()
}

router.post('/signin', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body
    const normalizedEmail = normalizeEmail(email)

    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
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
    const normalizedEmail = normalizeEmail(email)

    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
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

router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body
    const normalizedEmail = normalizeEmail(email)

    if (!normalizedEmail) {
      return res.status(400).json({ error: 'Email is required' })
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (!user) {
      return res.json({
        success: true,
        message: 'If an account exists for this email, a verification code has been sent.',
      })
    }

    const verificationCode = generateResetCode()
    const hashedCode = await bcrypt.hash(verificationCode, 10)
    const expiration = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: hashedCode,
        resetPasswordExpires: expiration,
      },
    })

    try {
      const subject = 'Your Project Hub Password Reset Code'
      const body = `
        <p>Hi ${user.name || ''},</p>
        <p>You requested to reset your Project Hub password.</p>
        <p>Your verification code is:</p>
        <h2 style="letter-spacing: 4px;">${verificationCode}</h2>
        <p>This code will expire in 15 minutes.</p>
        <p>If you did not request this, please ignore this email.</p>
      `
      await microsoftGraphClient.sendEmail([user.email], null, subject, body)
    } catch (emailError: any) {
      console.error('Failed to send password reset email:', emailError)
      return res.status(500).json({ error: 'Failed to send verification code email.' })
    }

    res.json({
      success: true,
      message: 'Verification code sent to your email.',
    })
  } catch (error: any) {
    console.error('Error initiating password reset:', error)
    res.status(500).json({ error: error.message || 'Internal server error' })
  }
})

router.post('/verify-reset-code', async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body
    const normalizedEmail = normalizeEmail(email)
    const trimmedCode = typeof code === 'string' ? code.trim() : ''

    if (!normalizedEmail || !trimmedCode) {
      return res.status(400).json({ error: 'Email and verification code are required' })
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (
      !user ||
      !user.resetPasswordToken ||
      !user.resetPasswordExpires ||
      user.resetPasswordExpires < new Date()
    ) {
      return res.status(400).json({ error: 'Invalid or expired verification code' })
    }

    const isValid = await bcrypt.compare(trimmedCode, user.resetPasswordToken)

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid verification code' })
    }

    res.json({ success: true, message: 'Verification code accepted.' })
  } catch (error: any) {
    console.error('Error verifying reset code:', error)
    res.status(500).json({ error: error.message || 'Internal server error' })
  }
})

router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { email, code, password } = req.body
    const normalizedEmail = normalizeEmail(email)
    const trimmedCode = typeof code === 'string' ? code.trim() : ''

    if (!normalizedEmail || !trimmedCode || !password) {
      return res.status(400).json({ error: 'Email, verification code, and new password are required' })
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' })
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (
      !user ||
      !user.resetPasswordToken ||
      !user.resetPasswordExpires ||
      user.resetPasswordExpires < new Date()
    ) {
      return res.status(400).json({ error: 'Invalid or expired verification code' })
    }

    const isValid = await bcrypt.compare(trimmedCode, user.resetPasswordToken)

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid verification code' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    })

    res.json({ success: true, message: 'Password updated successfully.' })
  } catch (error: any) {
    console.error('Error resetting password:', error)
    res.status(500).json({ error: error.message || 'Internal server error' })
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

