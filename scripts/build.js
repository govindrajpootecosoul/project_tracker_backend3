const { execSync } = require('child_process');
const path = require('path');

const rootDir = path.join(__dirname, '..');

function runCommand(command, description) {
  console.log(`\n[build] ${description}...`);
  try {
    execSync(command, { 
      cwd: rootDir, 
      stdio: 'inherit',
      shell: true
    });
    console.log(`[build] ✓ ${description} completed successfully`);
    return true;
  } catch (error) {
    console.error(`[build] ✗ ${description} failed`);
    if (error.status !== undefined) {
      console.error(`[build] Exit code: ${error.status}`);
    }
    if (error.message) {
      console.error(`[build] Error: ${error.message}`);
    }
    process.exit(1);
  }
}

try {
  // Step 1: Prebuild cleanup - run directly instead of via execSync
  console.log('\n[build] Prebuild cleanup...');
  require('./prebuild-cleanup.js');
  console.log('[build] ✓ Prebuild cleanup completed successfully');
  
  // Step 2: Generate Prisma client
  runCommand('npx prisma generate', 'Prisma generate');
  
  // Step 3: TypeScript compilation
  runCommand('npx tsc', 'TypeScript compilation');
  
  console.log('\n[build] ✓ Build completed successfully!');
} catch (error) {
  console.error('[build] Build failed:', error.message);
  process.exit(1);
}

