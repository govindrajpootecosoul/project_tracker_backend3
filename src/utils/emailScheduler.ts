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
    let config: any
    try {
      config = await prisma.autoEmailConfig.findFirst({
        include: {
          departmentConfigs: true,
        },
      })
    } catch (error: any) {
      // Fallback if relation doesn't exist yet
      console.warn('[Auto Email] DepartmentConfigs relation not available, skipping:', error.message)
      return
    }
    
    if (!config || !config.enabled) {
      return // Config not found or disabled, skip silently
    }
    
    if (!config.departmentConfigs || config.departmentConfigs.length === 0) {
      return // No department configs, skip silently
    }
    
    // Use configured recipients
    const toEmails = config.toEmails && config.toEmails.length > 0
      ? config.toEmails
      : ['priyanka.aeron@ecosoulhome.com', 'charu.anand@ecosoulhome.com'] // Fallback to defaults
    
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    
    // Check each department's schedule separately
    for (const deptConfig of config.departmentConfigs) {
      if (!deptConfig.enabled) {
        continue // Skip disabled departments
      }
      
      if (!deptConfig.daysOfWeek || deptConfig.daysOfWeek.length === 0) {
        continue // Skip departments without days configured
      }
      
      // Check if this department should run now
      if (!shouldRunNow(deptConfig.daysOfWeek, deptConfig.timeOfDay, config.timezone)) {
        continue // Not scheduled for this department at this time
      }
      
      // Check if we already ran today for this department (prevent duplicates)
      if (deptConfig.lastRunAt && new Date(deptConfig.lastRunAt) >= todayStart) {
        continue // Already ran today for this department
      }
      
      console.log(`[Auto Email] Starting automatic email send for department: ${deptConfig.department}`)
      
      // Send email for this department only
      const result = await sendDepartmentWiseEmail(
        deptConfig.department,
        toEmails,
        [], // No on-leave members for automatic sends
        'system' // System user ID for automatic sends
      )
      
      if (result.success) {
        // Update lastRunAt for this department
        await prisma.autoEmailDepartmentConfig.update({
          where: { id: deptConfig.id },
          data: { lastRunAt: now },
        })
        
        console.log(`[Auto Email] Successfully sent email for ${deptConfig.department}. Log ID: ${result.emailLogId}`)
      } else {
        console.error(`[Auto Email] Failed to send email for ${deptConfig.department}: ${result.error}`)
      }
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

