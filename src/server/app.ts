import express, { Express } from 'express';
import { requestLogger } from './middleware/logger';
import { corsMiddleware } from './middleware/cors';
import { bridgeAuthMiddleware } from './middleware/auth';
import openaiRoutes from './routes/openai';
import anthropicRoutes from './routes/anthropic';
import geminiRoutes from './routes/gemini';
import healthRoutes from './routes/health';
import dashboardRoutes from './routes/dashboard';

export function createBridgeApp(): Express {
  const app = express();

  // Basic middleware
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use(corsMiddleware);
  app.use(requestLogger);
  app.use(bridgeAuthMiddleware);

  // Mount API routes
  app.use('/v1', openaiRoutes);
  app.use('/v1', anthropicRoutes);
  app.use('/', openaiRoutes);
  app.use('/', anthropicRoutes);
  app.use('/', geminiRoutes);
  app.use('/', healthRoutes);
  app.use('/', dashboardRoutes);

  // 404 Catch-all
  app.use((req, res) => {
    res.status(404).json({
      error: {
        message: `Endpoint ${req.method} ${req.path} not found on Gravity Bridge.`,
        type: 'invalid_request_error',
      },
    });
  });

  return app;
}
