# Regenerate Prisma Client for Request Model

## Issue
The Request model was added to the Prisma schema, but the Prisma client hasn't been regenerated yet. This causes the backend to fail when trying to access `prisma.request`.

## Solution

### Step 1: Stop the Backend Server
If the backend server is running, stop it first:
- Press `Ctrl+C` in the terminal where the backend is running
- Or close the terminal/process

### Step 2: Regenerate Prisma Client
```bash
cd backend
npx prisma generate
```

### Step 3: Push Schema to Database (if needed)
```bash
npx prisma db push
```

### Step 4: Restart the Backend Server
```bash
npm run dev
```

## Alternative: If File is Locked

If you get a "file is locked" error:

1. **Close all terminals/processes** that might be using Prisma
2. **Close VS Code/Cursor** if it has the Prisma extension running
3. **Wait a few seconds** for file locks to release
4. **Try again**: `npx prisma generate`

If it still doesn't work, restart your computer or try:
```bash
cd backend
rm -rf node_modules/.prisma
npx prisma generate
```

## Verification

After regenerating, the backend should start without errors and the RequestHub should work correctly.

