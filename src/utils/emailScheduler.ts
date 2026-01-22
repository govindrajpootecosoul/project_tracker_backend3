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
  try {
    const now = new Date()
    
    // Get current time in the specified timezone using Intl.DateTimeFormat
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    
    const parts = formatter.formatToParts(now)
    const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
    const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)
    
    // Get day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
    // Use a more reliable method: format the date in the timezone and parse the weekday
    const dayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
    })
    const weekdayName = dayFormatter.format(now)
    const weekdayMap: { [key: string]: number } = {
      'Sunday': 0,
      'Monday': 1,
      'Tuesday': 2,
      'Wednesday': 3,
      'Thursday': 4,
      'Friday': 5,
      'Saturday': 6,
    }
    const currentDay = weekdayMap[weekdayName]
    
    if (currentDay === undefined) {
      console.error(`[Auto Email] Could not determine day of week from: ${weekdayName}`)
      return false
    }
    
    // Check if current day is in daysOfWeek
    if (!daysOfWeek.includes(currentDay)) {
      return false
    }
    
    // Check if current time matches timeOfDay (match within the same minute)
    // This allows the cron job to trigger at any second within the target minute
    const [targetHour, targetMinute] = timeOfDay.split(':').map(Number)
    
    if (isNaN(targetHour) || isNaN(targetMinute)) {
      console.error(`[Auto Email] Invalid time format: ${timeOfDay}`)
      return false
    }
    
    if (currentHour !== targetHour || currentMinute !== targetMinute) {
      return false
    }
    
    return true
  } catch (error: any) {
    console.error(`[Auto Email] Error in shouldRunNow:`, error.message)
    return false
  }
}

// Run the automatic email job (with optional force flag to bypass time checks)
export async function runAutoEmailJob(force: boolean = false): Promise<void> {
  const jobStartTime = new Date()
  console.log(`[Auto Email] Job started at ${jobStartTime.toISOString()}`)
  
  try {
    let config: any
    try {
      config = await prisma.autoEmailConfig.findFirst({
        include: {
          departmentConfigs: true,
        },
      })
      console.log(`[Auto Email] Config fetched: ${config ? 'Found' : 'Not found'}`)
    } catch (error: any) {
      // Fallback if relation doesn't exist yet
      console.error('[Auto Email] Error fetching config:', error.message)
      console.warn('[Auto Email] DepartmentConfigs relation not available, skipping:', error.message)
      return
    }
    
    if (!config) {
      // Config not found - this is normal on first run, skip silently
      console.log('[Auto Email] No configuration found in database')
      return
    }
    
    console.log(`[Auto Email] Config status - Enabled: ${config.enabled}, Departments: ${config.departmentConfigs?.length || 0}`)
    
    if (!config.enabled) {
      // Config is disabled - log once per hour to help with debugging
      const now = new Date()
      if (now.getMinutes() === 0) {
        console.log('[Auto Email] Auto email is disabled in configuration')
      }
      return
    }
    
    if (!config.departmentConfigs || config.departmentConfigs.length === 0) {
      // No department configs - log once per hour to help with debugging
      const now = new Date()
      if (now.getMinutes() === 0) {
        console.log('[Auto Email] No department configurations found. Please configure departments in the admin panel.')
      }
      return
    }
    
    // Use configured recipients
    const toEmails = config.toEmails && config.toEmails.length > 0
      ? config.toEmails
      : ['priyanka.aeron@ecosoulhome.com', 'charu.anand@ecosoulhome.com'] // Fallback to defaults
    
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    
    // Check each department's schedule separately
    console.log(`[Auto Email] Checking ${config.departmentConfigs.length} department(s)`)
    
    for (const deptConfig of config.departmentConfigs) {
      console.log(`[Auto Email] Checking department: ${deptConfig.department}, Enabled: ${deptConfig.enabled}, Days: [${deptConfig.daysOfWeek?.join(',') || 'none'}], Time: ${deptConfig.timeOfDay}`)
      
      if (!deptConfig.enabled) {
        console.log(`[Auto Email] ${deptConfig.department}: Skipped - department disabled`)
        continue // Skip disabled departments
      }
      
      if (!deptConfig.daysOfWeek || deptConfig.daysOfWeek.length === 0) {
        console.log(`[Auto Email] ${deptConfig.department}: Skipped - no days configured`)
        continue // Skip departments without days configured
      }
      
      // Check if this department should run now (unless forced)
      let shouldRun = false
      if (force) {
        shouldRun = true
        console.log(`[Auto Email] ${deptConfig.department}: FORCE MODE - bypassing time check`)
      } else {
        shouldRun = shouldRunNow(deptConfig.daysOfWeek, deptConfig.timeOfDay, config.timezone)
      }
      
      // Always log the time check result for debugging
      const now = new Date()
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: config.timezone,
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      const currentTime = formatter.format(now)
      console.log(`[Auto Email] ${deptConfig.department}: Current time ${currentTime} (timezone: ${config.timezone}), Scheduled: ${deptConfig.timeOfDay} on days [${deptConfig.daysOfWeek.join(',')}], Should run: ${shouldRun}${force ? ' (FORCED)' : ''}`)
      
      if (!shouldRun) {
        continue // Not scheduled for this department at this time
      }
      
      console.log(`[Auto Email] ✓ Time match found for ${deptConfig.department} at ${deptConfig.timeOfDay}${force ? ' (FORCED)' : ''}`)
      
      // Check if we already ran at this scheduled time today (prevent duplicates for same time)
      // Skip this check if forced (for testing purposes)
      if (!force) {
        try {
          // Get the current config to check lastRunAt
          const currentDeptConfig = await prisma.autoEmailDepartmentConfig.findUnique({
            where: { id: deptConfig.id },
            select: { lastRunAt: true },
          })
          
          // Check if email was already sent at THIS scheduled time today
          // Each department has its own scheduled time, so we check if email was sent at the same scheduled time
          if (currentDeptConfig?.lastRunAt) {
            const lastRunAt = currentDeptConfig.lastRunAt
            
            // Check if lastRunAt is today
            if (lastRunAt >= todayStart) {
              // Get the scheduled time components
              const [scheduledHour, scheduledMinute] = deptConfig.timeOfDay.split(':').map(Number)
              
              // Get lastRunAt time in the configured timezone
              const lastRunFormatter = new Intl.DateTimeFormat('en-US', {
                timeZone: config.timezone,
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })
              const lastRunParts = lastRunFormatter.formatToParts(lastRunAt)
              const lastRunHour = parseInt(lastRunParts.find(p => p.type === 'hour')?.value || '0', 10)
              const lastRunMinute = parseInt(lastRunParts.find(p => p.type === 'minute')?.value || '0', 10)
              
              // Check if last send was at the same scheduled time (same hour and minute)
              if (lastRunHour === scheduledHour && lastRunMinute === scheduledMinute) {
                const timeSinceLastSend = (now.getTime() - lastRunAt.getTime()) / 1000 // seconds
                console.log(`[Auto Email] Skipping ${deptConfig.department} - already sent at scheduled time ${deptConfig.timeOfDay} today (${Math.round(timeSinceLastSend)} seconds ago)`)
                continue
              } else {
                // Last send was at a different time, allow sending at this scheduled time
                console.log(`[Auto Email] Allowing send for ${deptConfig.department} - last sent at ${lastRunHour}:${String(lastRunMinute).padStart(2, '0')}, scheduled time is ${deptConfig.timeOfDay}`)
              }
            } else {
              // Last send was before today, allow sending
              console.log(`[Auto Email] Allowing send for ${deptConfig.department} - last sent before today`)
            }
          } else {
            // Never sent before, allow sending
            console.log(`[Auto Email] Allowing send for ${deptConfig.department} - first time sending`)
          }
          
          // Update lastRunAt before sending to prevent race conditions
          await prisma.autoEmailDepartmentConfig.update({
            where: { id: deptConfig.id },
            data: { lastRunAt: now },
          })
        } catch (error: any) {
          console.error(`[Auto Email] Error checking lastRunAt for ${deptConfig.department}:`, error.message)
          // Continue anyway if forced
          if (!force) continue
        }
      } else {
        // In force mode, update lastRunAt but don't block
        try {
          await prisma.autoEmailDepartmentConfig.update({
            where: { id: deptConfig.id },
            data: { lastRunAt: now },
          })
        } catch (error: any) {
          console.warn(`[Auto Email] Could not update lastRunAt for ${deptConfig.department}:`, error.message)
        }
      }
      
      // Send email for this department
      try {
        console.log(`[Auto Email] Starting automatic email send for department: ${deptConfig.department}${force ? ' (FORCE MODE)' : ''}`)
        
        // Send email for this department only
        const result = await sendDepartmentWiseEmail(
          deptConfig.department,
          toEmails,
          [], // No on-leave members for automatic sends
          'system' // System user ID for automatic sends
        )
        
        if (result.success) {
          console.log(`[Auto Email] ✓ Successfully sent email for ${deptConfig.department}. Log ID: ${result.emailLogId}`)
        } else {
          // If email failed, reset lastRunAt to null so it can retry on next scheduled time (unless forced)
          if (!force) {
            try {
              await prisma.autoEmailDepartmentConfig.update({
                where: { id: deptConfig.id },
                data: { lastRunAt: null },
              })
            } catch (error: any) {
              console.warn(`[Auto Email] Could not reset lastRunAt:`, error.message)
            }
          }
          console.error(`[Auto Email] ✗ Failed to send email for ${deptConfig.department}: ${result.error}${force ? '' : '. Will retry on next scheduled time.'}`)
        }
      } catch (error: any) {
        console.error(`[Auto Email] Error processing department ${deptConfig.department}:`, error.message)
        // Continue with other departments even if one fails
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
    console.log('[Auto Email] Stopping existing scheduler')
    scheduledTask.stop()
    scheduledTask = null
  }
  
  // Run every minute to check if we should send emails
  scheduledTask = cron.schedule('* * * * *', async () => {
    await runAutoEmailJob()
  }, {
    timezone: 'UTC' // Cron runs in UTC, we handle timezone conversion in shouldRunNow
  })
  
  console.log('[Auto Email] ✓ Scheduler started successfully - checking every minute for scheduled emails')
  console.log('[Auto Email] Scheduler is running:', scheduledTask ? 'YES' : 'NO')
  
  // Run immediately to check current status
  setTimeout(() => {
    console.log('[Auto Email] Running initial check...')
    runAutoEmailJob().catch(err => {
      console.error('[Auto Email] Error in initial check:', err)
    })
  }, 2000) // Wait 2 seconds after server starts
}

// Stop the scheduler
export function stopEmailScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop()
    scheduledTask = null
    console.log('[Auto Email] Scheduler stopped')
  }
}

