import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export interface AuthRequest extends Request {
  userId?: string
  user?: {
    id: string
    email: string
    name?: string | null
  }
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' })
    }

    const token = authHeader.substring(7)
    const secret = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'your-secret-key'

    try {
      const decoded = jwt.verify(token, secret) as { id: string; email: string; name?: string }
      req.userId = decoded.id
      req.user = {
        id: decoded.id,
        email: decoded.email,
        name: decoded.name || null,
      }
      next()
    } catch (error) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' })
    }
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
}



