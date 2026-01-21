const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const prismaCachePath = path.join(__dirname, '..', 'node_modules', '.prisma');
const shouldKillProcesses = process.env.PREBUILD_KILL_NODE === 'true';

function sleepSync(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Busy wait - simple synchronous sleep
  }
}

function killLingeringNodeProcesses() {
  if (!shouldKillProcesses) {
    console.info('[prebuild] Skipping node process cleanup (set PREBUILD_KILL_NODE=true to enable).');
    return;
  }

  if (process.platform !== 'win32') {
    return;
  }

  let taskListOutput;
  try {
    taskListOutput = execSync('tasklist /FI "IMAGENAME eq node.exe"', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    console.warn('[prebuild] Unable to inspect running node processes:', error.message);
    return;
  }

  const currentPid = process.pid;
  const parentPid = process.ppid;
  const lines = taskListOutput.split(/\r?\n/).slice(3);
  const pids = lines
    .map((line) => {
      const match = line.match(/\s(\d+)\s+(Console|Services)\s/);
      return match ? Number(match[1]) : undefined;
    })
    .filter((pid) => pid && pid !== currentPid && pid !== parentPid);

  if (pids.length === 0) {
    return;
  }

  console.info(`[prebuild] Current PID: ${currentPid}, parent PID: ${parentPid}`);
  console.info(`[prebuild] Candidate node process IDs: ${pids.join(', ') || 'none'}`);
  console.info(`[prebuild] Stopping ${pids.length} lingering node process(es) to release Prisma binaries.`);
  pids.forEach((pid) => {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    } catch (error) {
      console.warn(`[prebuild] Failed to stop node process ${pid}:`, error.message);
    }
  });
}

function clearPrismaCache() {
  try {
    if (fs.existsSync(prismaCachePath)) {
      fs.rmSync(prismaCachePath, { recursive: true, force: true });
      console.info('[prebuild] Prisma cache directory cleared successfully.');
    }
  } catch (error) {
    console.warn('[prebuild] Unable to remove Prisma cache directory:', error.message);
    console.info('[prebuild] Continuing anyway - Prisma generate will handle this.');
  }
}

try {
  killLingeringNodeProcesses();

  // Wait a bit for Windows to release file locks after killing processes
  if (shouldKillProcesses && process.platform === 'win32') {
    sleepSync(500);
  }

  clearPrismaCache();
} catch (error) {
  console.warn('[prebuild] Unexpected error during cleanup:', error.message);
  // Don't fail the build if cleanup has issues
}

// Always exit successfully to not block the build
process.exit(0);

