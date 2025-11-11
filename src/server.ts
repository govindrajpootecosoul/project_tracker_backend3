import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import taskRoutes from './routes/tasks';
import projectRoutes from './routes/projects';
import teamRoutes from './routes/team';
import emailRoutes from './routes/email';
import notificationRoutes from './routes/notifications';
import credentialRoutes from './routes/credentials';
import subscriptionRoutes from './routes/subscriptions';
import commentRoutes from './routes/comments';
import aiRoutes from './routes/ai';
import activityRoutes from './routes/activities';
import { backfillTaskAssignees } from './scripts/backfill-task-assignees';

dotenv.config();              

const app = express();
const PORT = process.env.PORT || 6000;

// Middleware
// Allow both local and production frontend origins
const allowedOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://project-tracker.thrivebrands.in',
      'https://project-backend.thrivebrands.in'
    ];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // In production, be strict; in development, allow all
      if (process.env.NODE_ENV === 'production') {
        callback(new Error('Not allowed by CORS'));
      } else {
        callback(null, true); // Allow all origins in development
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check route
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Backend server is running' });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/credentials', credentialRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api', commentRoutes);
app.use('/api', aiRoutes);
app.use('/api/activities', activityRoutes);

// Start server
app.listen(PORT, async () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
  console.log(`CORS enabled for: ${process.env.CORS_ORIGIN || allowedOrigins.join(', ')}`);
  
  // Automatically backfill task assignees on server startup
  // This ensures manually inserted tasks get assigned to their creators
  try {
    await backfillTaskAssignees();
  } catch (error) {
    console.error('Error during task assignee backfill on startup:', error);
    // Don't crash the server if backfill fails
  }
});

