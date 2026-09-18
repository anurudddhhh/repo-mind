// =============================================================================
// STEP 1: Load environment variables FIRST — before any other import.
// This MUST be the very first import — it runs dotenv.config() synchronously.
// =============================================================================
import './lib/env';

// =============================================================================
// STEP 2: Patch Express v4 to handle async/await errors properly.
// =============================================================================
import 'express-async-errors';

// PASSPORT — GitHub OAuth authentication
import passport from './lib/passport';

// =============================================================================
// ROUTE MODULES
// =============================================================================
import authRoutes from './routes/auth.routes';
import indexingRoutes from './routes/indexing.routes';
import searchRoutes from './routes/search.routes';
import chatRoutes from './routes/chat.routes';
import { repositoryRoutes } from './routes/repository.routes';
import analysisRoutes from './routes/analysis.routes';

// =============================================================================
// CORE FRAMEWORK & MIDDLEWARE IMPORTS
// =============================================================================
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { createServer } from 'http';

// =============================================================================
// ENVIRONMENT CONFIGURATION
// =============================================================================
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  console.error('FATAL ERROR: SESSION_SECRET environment variable is not set.');
  process.exit(1);
}

const app: Application = express();
app.set('trust proxy', 1);

// =============================================================================
// MIDDLEWARE STACK
// =============================================================================

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        FRONTEND_URL,
        'http://localhost:3000',
        'http://localhost:3001',
      ];

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS policy violation: Origin ${origin} is not allowed`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count'],
  })
);

app.use(compression());
app.use(morgan(NODE_ENV === 'development' ? 'dev' : 'combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Passport OAuth session store
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
        cookie: {
      secure: NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 10 * 60 * 1000,
      sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
    },
    name: 'repo-mind.sid',
  })
);

app.use(passport.initialize());
app.use(passport.session());

// =============================================================================
// HEALTH CHECK
// =============================================================================
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Repo-Mind API is running',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// =============================================================================
// API ROUTES
// =============================================================================
app.use('/api/auth', authRoutes);
app.use('/api/indexing', indexingRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/repositories', repositoryRoutes);
app.use('/api/analyze', analysisRoutes);

// API root discovery
app.get('/api', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Repo-Mind API v1.0.0',
    availableEndpoints: {
      health: 'GET /health',
      auth: {
        login: 'GET /api/auth/github',
        callback: 'GET /api/auth/github/callback',
        me: 'GET /api/auth/me',
        logout: 'POST /api/auth/logout',
      },
      repositories: 'GET|POST /api/repositories/*',
      indexing: {
        start: 'POST /api/indexing/start',
        status: 'GET /api/indexing/status/:repositoryId',
      },
      search: 'POST /api/search/:repositoryId',
      chat: 'POST /api/chat/:repositoryId',
      analyze: {
        architecture: 'GET /api/analyze/:repoId/architecture',
        bugs: 'POST /api/analyze/:repoId/bugs',
        docs: 'POST /api/analyze/:repoId/docs',
      },
    },
  });
});

// 404 Handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    message: `The endpoint ${_req.method} ${_req.originalUrl} does not exist on this server.`,
  });
});

// Global Error Handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { status?: number; statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
  if (NODE_ENV === 'development') {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('🔴 UNHANDLED ERROR:');
    console.error(err.stack);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  const statusCode = err.status || err.statusCode || 500;
  const message =
    NODE_ENV === 'production' && statusCode === 500
      ? 'An internal server error occurred. Please try again later.'
      : err.message || 'An unexpected error occurred';

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// =============================================================================
// HTTP SERVER & GRACEFUL SHUTDOWN
// =============================================================================
const server = createServer(app);

if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║     🚀 REPO-MIND API STARTED         ║');
    console.log('  ╠══════════════════════════════════════╣');
    console.log(`  ║  Environment : ${NODE_ENV.padEnd(22)}║`);
    console.log(`  ║  Port        : ${String(PORT).padEnd(22)}║`);
    console.log(`  ║  Frontend URL: ${FRONTEND_URL.padEnd(22)}║`);
    console.log('  ║  Health Check: GET /health            ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
  });
}

const gracefulShutdown = (signal: string) => {
  console.log(`\n⚠️  ${signal} received. Starting graceful shutdown...`);

  server.close((err) => {
    if (err) {
      console.error('❌ Error during server shutdown:', err);
      process.exit(1);
    }
    console.log('✅ HTTP server closed. All connections drained.');
    console.log('👋 Repo-Mind API shut down gracefully.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('⏰ Shutdown timeout exceeded (10s). Force-killing process.');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason: unknown) => {
  console.error('🔴 UNHANDLED PROMISE REJECTION:', reason);
  gracefulShutdown('unhandledRejection');
});

process.on('uncaughtException', (err: Error) => {
  console.error('🔴 UNCAUGHT EXCEPTION:', err.stack);
  process.exit(1);
});

export default app;