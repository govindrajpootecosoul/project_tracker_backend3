import cron from 'node-cron'
import { prisma } from '../lib/prisma'
import { sendDepartmentWiseEmail } from '../routes/email'

let scheduledTask: ReturnType<typeof cron.schedule> | null = null

// Convert timezone-aware time to cron schedule
function getCronSchedule(daysOfWeek: number[], timeOfDay: string, timezone: string): string {
  // Parse time (HH:MM)
  const [hours, minutes] = timeOfDay.split(':').map(Number)
  
  // Convert daysOfWeek from 0-6 (Sun-Sat) to cron format (0-6, but 0=Sunday, 6=Saturday)
  // Cron uses 0-6 where 0=Sunday, 1=Monday, ..., 6=Saturday (same as our format)
  const cronDays = daysOfWeek.sort().join(',')
  
  // Cron format: minute hour day-of-month month day-of-week
  // We want to run on specific days of week at specific time
  return `${minutes} ${hours} * * ${cronDays}`
}

// Check if current time matches the schedule
function shouldRunNow(daysOfWeek: number[], timeOfDay: string, timezone: string): boolean {
  const now = new Date()
  
  // Convert to the specified timezone
  const timezoneDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
  const currentDay = timezoneDate.getDay() // 0=Sunday, 1=Monday, ..., 6=Saturday
  const currentHour = timezoneDate.getHours()
  const currentMinute = timezoneDate.getMinutes()
  
  // Check if current day is in daysOfWeek
  if (!daysOfWeek.includes(currentDay)) {
    return false
  }
  
  // Check if current time matches timeOfDay (within 1 minute tolerance)
  const [targetHour, targetMinute] = timeOfDay.split(':').map(Number)
  if (currentHour !== targetHour || Math.abs(currentMinute - targetMinute) > 1) {
    return false
  }
  
  return true
}

// Run the automatic email job
export async function runAutoEmailJob(): Promise<void> {
  try {
    const config = await prisma.autoEmailConfig.findFirst()
    
    if (!config || !config.enabled) {
      console.log('[Auto Email] Config not found or disabled, skipping...')
      return
    }
    
    if (!config.departments || config.departments.length === 0) {
      console.log('[Auto Email] No departments configured, skipping...')
      return
    }
    
    if (!config.daysOfWeek || config.daysOfWeek.length === 0) {
      console.log('[Auto Email] No days of week configured, skipping...')
      return
    }
    
    // Check if we should run now
    if (!shouldRunNow(config.daysOfWeek, config.timeOfDay, config.timezone)) {
      console.log('[Auto Email] Not scheduled to run at this time, skipping...')
      return
    }
    
    // Check if we already ran today (prevent duplicates)
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    
    if (config.lastRunAt && new Date(config.lastRunAt) >= todayStart) {
      console.log('[Auto Email] Already ran today, skipping to prevent duplicates...')
      return
    }
    
    console.log(`[Auto Email] Starting automatic email send for departments: ${config.departments.join(', ')}`)
    
    // Use configured recipients
    const toEmails = config.toEmails && config.toEmails.length > 0
      ? config.toEmails
      : ['priyanka.aeron@ecosoulhome.com', 'charu.anand@ecosoulhome.com'] // Fallback to defaults
    
    // Send email
    const result = await sendDepartmentWiseEmail(
      config.departments,
      toEmails,
      [], // No on-leave members for automatic sends
      'system' // System user ID for automatic sends
    )
    
    if (result.success) {
      // Update lastRunAt
      await prisma.autoEmailConfig.update({
        where: { id: config.id },
        data: { lastRunAt: now },
      })
      
      console.log(`[Auto Email] Successfully sent email. Log ID: ${result.emailLogId}`)
    } else {
      console.error(`[Auto Email] Failed to send email: ${result.error}`)
    }
  } catch (error: any) {
    console.error('[Auto Email] Error in auto email job:', error)
  }
}

// Initialize and start the scheduler
export function startEmailScheduler(): void {
  // Stop existing scheduler if any
  if (scheduledTask) {
    scheduledTask.stop()
    scheduledTask = null
  }
  
  // Run every minute to check if we should send emails
  scheduledTask = cron.schedule('* * * * *', async () => {
    await runAutoEmailJob()
  })
  
  console.log('[Auto Email] Scheduler started - checking every minute for scheduled emails')
}

// Stop the scheduler
export function stopEmailScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop()
    scheduledTask = null
    console.log('[Auto Email] Scheduler stopped')
  }
}

