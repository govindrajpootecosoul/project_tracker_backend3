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

dotenv.config();              

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
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
app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
  console.log(`CORS enabled for: ${process.env.CORS_ORIGIN || 'http://localhost:3000'}`);
});

