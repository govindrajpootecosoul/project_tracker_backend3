# Fix Prisma Client Error

## Steps to Fix:

1. **Stop the backend server** (if it's running)
   - Press Ctrl+C in the terminal where the backend is running

2. **Regenerate Prisma Client:**
   ```bash
   cd backend
   npx prisma generate
   ```

3. **Push schema to database:**
   ```bash
   npx prisma db push
   ```

4. **Restart the backend server:**
   ```bash
   npm run dev
   ```

The error occurs because the Prisma client needs to be regenerated after adding the new `departmentConfigs` relation to the `AutoEmailConfig` model.

