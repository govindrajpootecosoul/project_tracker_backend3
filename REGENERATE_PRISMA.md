# Fix: Prisma Client Error - departmentConfigs

## Error Message:
```
Unknown field `departmentConfigs` for include statement on model `AutoEmailConfig`
```

## Solution:

**IMPORTANT: Stop the backend server first!**

1. **Stop the backend server** (Press Ctrl+C in the terminal)

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

## Why this happens:
The Prisma client is generated code that needs to be updated whenever the schema changes. After adding the new `AutoEmailDepartmentConfig` model and relation, the client must be regenerated.

## After fixing:
- The frontend should load without errors
- You'll be able to configure per-department schedules
- Each department will send separate emails at their configured times

