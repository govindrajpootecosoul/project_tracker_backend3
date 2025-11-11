import { prisma } from '../lib/prisma'

/**
 * Backfill script to assign tasks to their creators if they don't have any assignees
 * This handles manually inserted tasks that don't have TaskAssignee records
 */
async function backfillTaskAssignees() {
  try {
    console.log('Starting task assignee backfill...')

    // Find all tasks that don't have any assignees
    const tasksWithoutAssignees = await prisma.task.findMany({
      where: {
        assignees: {
          none: {},
        },
      },
      select: {
        id: true,
        createdById: true,
        title: true,
      },
    })

    console.log(`Found ${tasksWithoutAssignees.length} tasks without assignees`)

    if (tasksWithoutAssignees.length === 0) {
      console.log('No tasks need assignee backfill. Exiting.')
      return
    }

    // Create assignee records for each task, assigning to the creator
    let created = 0
    let skipped = 0
    let errors = 0

    for (const task of tasksWithoutAssignees) {
      try {
        // Check if creator exists
        const creator = await prisma.user.findUnique({
          where: { id: task.createdById },
          select: { id: true },
        })

        if (!creator) {
          console.warn(`Creator not found for task ${task.id} (${task.title}). Skipping.`)
          skipped++
          continue
        }

        // Check if assignee record already exists (safety check)
        const existingAssignee = await prisma.taskAssignee.findUnique({
          where: {
            taskId_userId: {
              taskId: task.id,
              userId: task.createdById,
            },
          },
        })

        if (existingAssignee) {
          console.log(`Assignee already exists for task ${task.id}. Skipping.`)
          skipped++
          continue
        }

        // Create assignee record
        await prisma.taskAssignee.create({
          data: {
            taskId: task.id,
            userId: task.createdById,
          },
        })

        created++
        console.log(`✓ Assigned task "${task.title}" (${task.id}) to creator ${task.createdById}`)
      } catch (error: any) {
        console.error(`Error assigning task ${task.id}:`, error.message)
        errors++
      }
    }

    console.log('\n=== Backfill Summary ===')
    console.log(`Total tasks processed: ${tasksWithoutAssignees.length}`)
    console.log(`Assignees created: ${created}`)
    console.log(`Skipped: ${skipped}`)
    console.log(`Errors: ${errors}`)
    console.log('Backfill completed!')
  } catch (error) {
    console.error('Error during backfill:', error)
    throw error
  }
}

// Run the script directly (not when imported)
if (require.main === module) {
  backfillTaskAssignees()
    .then(() => {
      console.log('Script completed successfully')
      prisma.$disconnect()
        .then(() => process.exit(0))
        .catch(() => process.exit(0))
    })
    .catch((error) => {
      console.error('Script failed:', error)
      prisma.$disconnect()
        .then(() => process.exit(1))
        .catch(() => process.exit(1))
    })
}

export { backfillTaskAssignees }

