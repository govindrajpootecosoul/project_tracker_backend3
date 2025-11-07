import { prisma } from '../../lib/prisma'

export interface ActivityLogData {
  type: string
  action: string
  description: string
  entityType?: string
  entityId?: string
  metadata?: any
  userId: string
}

export async function logActivity(data: ActivityLogData) {
  try {
    console.log('Logging activity:', {
      type: data.type,
      action: data.action,
      description: data.description,
      entityType: data.entityType,
      entityId: data.entityId,
      userId: data.userId,
    })
    
    const activity = await prisma.activityLog.create({
      data: {
        type: data.type as any,
        action: data.action,
        description: data.description,
        entityType: data.entityType,
        entityId: data.entityId,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
        userId: data.userId,
      },
    })
    
    console.log('Activity logged successfully:', activity.id)
    return activity
  } catch (error: any) {
    console.error('Error logging activity:', error)
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      meta: error.meta,
    })
    // Don't throw error - activity logging should not break the main flow
    return null
  }
}

