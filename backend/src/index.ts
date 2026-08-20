// ============================================================
// STEP 1: Load environment variables FIRST — before any other import.
// If we import database/redis/etc. before this line runs, they
// won't have access to process.env values and will fail silently.
//
// IMPORTANT: Our .env file lives in the repository ROOT (D:\repo-mind\.env),
// NOT inside backend/. We use path.resolve() with __dirname to build an
// absolute path that works regardless of where `npm run dev` is executed.
//
// __dirname = D:\repo-mind\backend\src
// ../../   = D:\repo-mind
// Final    = D:\repo-mind\.env
// ============================================================

// ============================================================
// STEP 1: Load environment variables FIRST
// This MUST be the very first import — it runs dotenv.config()
// synchronously before any other module can access process.env.
// ============================================================
import '@/lib/env';



// ============================================================
// STEP 2: Patch Express v4 to handle async/await errors properly.
// Must be imported BEFORE express and any routes are loaded.
// Without this, a thrown error inside an async route handler
// would cause the request to hang forever with no response.
// ============================================================
import 'express-async-errors';

// PASSPORT — GitHub OAuth authentication
import passport from '@/lib/passport';

// ============================================================
// ROUTE MODULES
// Each route module handles a group of related endpoints.
// We import them here and mount them on their path prefix below.
// ============================================================
import authRoutes from '@/routes/auth.routes';
import indexingRoutes from '@/routes/indexing.routes';
import searchRoutes from '@/routes/search.routes';
import chatRoutes from '@/routes/chat.routes';
import { repositoryRoutes } from '@/routes/repository.routes';
// ============================================================
// CORE FRAMEWORK IMPORTS
// ============================================================
import express, { Application, Request, Response, NextFunction } from 'express';

// ============================================================
// SECURITY & UTILITY MIDDLEWARE IMPORTS
// cors       — allows our Next.js frontend to call this API
// helmet     — automatically sets 15+ secure HTTP response headers
// morgan     — HTTP request logger (shows method, path, status, time)
// compression — gzip-compresses responses for faster data transfer
// ============================================================
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';

// ============================================================
// REQUEST PARSING MIDDLEWARE
// cookie-parser  — makes req.cookies available (for JWT cookie reads)
// express-session — creates server-side sessions (Passport OAuth needs this)
// ============================================================
import cookieParser from 'cookie-parser';
import session from 'express-session';

// ============================================================
// NODE.JS BUILT-IN: HTTP MODULE
// We wrap our Express app in Node's http.Server so we have
// more control over the server lifecycle (e.g., graceful shutdown).
// ============================================================
import { createServer } from 'http';

// ============================================================
// ENVIRONMENT VARIABLE EXTRACTION & VALIDATION
// We extract these at module load time. If a critical variable
// is missing, we throw immediately so the bug is obvious at
// startup rather than mysteriously failing later at runtime.
// ============================================================
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  // Using console.error here intentionally — logger may not be initialized yet
  console.error('FATAL ERROR: SESSION_SECRET environment variable is not set.');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1); // Exit with failure code — do not start the server
}

// ============================================================
// EXPRESS APPLICATION INSTANCE
// express() creates the core application object. We can now
// call app.use() to add middleware and app.get/post/etc. for routes.
// ============================================================
const app: Application = express();

// ============================================================
// TRUST PROXY
// When running behind a reverse proxy (Nginx, cloud load balancer),
// the real client IP is in the X-Forwarded-For header.
// Setting this to 1 means "trust one proxy hop upstream."
// Required for IP-based rate limiting to work correctly in production.
// ============================================================
app.set('trust proxy', 1);

// ============================================================
// MIDDLEWARE STACK — ORDER MATTERS!
// Express executes middleware in the exact order they are registered.
// Think of it as a pipeline: request → middleware1 → middleware2 → route
// ============================================================

// --- SECURITY: Helmet sets secure HTTP headers ---
// Examples: X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security
// We configure it to allow our Mermaid.js diagrams to render inline scripts
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Needed for Mermaid.js
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow embedding content from other origins
  })
);

// --- CORS: Allow our Next.js frontend to make API calls ---
// The browser will block requests from localhost:3000 to localhost:5000
// unless the server explicitly says "I allow requests from that origin."
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        FRONTEND_URL,
        'http://localhost:3000',
        'http://localhost:3001', // Allow alternate frontend port during dev
      ];

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS policy violation: Origin ${origin} is not allowed`));
      }
    },
    credentials: true,    // Allow cookies and Authorization headers
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count'], // Headers the browser JS can read
  })
);

// --- COMPRESSION: Gzip all responses larger than 1KB ---
// Makes API responses significantly smaller, reducing transfer time.
// The threshold ensures tiny responses aren't wasted on compression overhead.
app.use(compression());

// --- MORGAN: HTTP Request Logger ---
// In development: use 'dev' format (colorized, concise: GET /api/health 200 5ms)
// In production: use 'combined' format (full Apache-style logs for log aggregators)
app.use(morgan(NODE_ENV === 'development' ? 'dev' : 'combined'));

// --- BODY PARSERS: Make req.body available ---
// Without these, req.body is undefined for POST/PUT requests.
// json()       — parses application/json request bodies
// urlencoded() — parses HTML form submissions (needed for some OAuth flows)
app.use(express.json({ limit: '10mb' }));       // 10MB limit for large code file uploads
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- COOKIE PARSER: Make req.cookies available ---
// Parses the 'Cookie' header into a key-value object.
// We use cookies to store our JWT token server-side for security.
app.use(cookieParser());

// --- SESSION: Server-side session store for Passport OAuth ---
// Passport's OAuth flow requires sessions to maintain state between
// the initial redirect to GitHub and the callback from GitHub.
// After OAuth completes, we immediately switch to JWT (stateless).
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,           // Don't save session if nothing changed
    saveUninitialized: false, // Don't create session until something is stored
    cookie: {
      secure: NODE_ENV === 'production', // HTTPS-only in production
      httpOnly: true,                    // Prevent JavaScript from reading the cookie
      maxAge: 10 * 60 * 1000,           // 10 minutes — only needed for OAuth flow duration
      sameSite: NODE_ENV === 'production' ? 'strict' : 'lax',
    },
    name: 'repo-mind.sid', // Custom name instead of default 'connect.sid'
  })
);
// Initialize Passport and enable session support
// MUST be registered AFTER express-session middleware
app.use(passport.initialize());
app.use(passport.session());
// ============================================================
// HEALTH CHECK ENDPOINT
// A simple GET /health route that returns 200 OK.
// Purpose:
//   - Confirms the server started successfully
//   - Used by load balancers and monitoring tools to check server health
//   - Lets us test CORS configuration immediately without needing a real route
// This is registered BEFORE our route modules so it always works,
// even if a route module fails to load.
// ============================================================
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Repo-Mind API is running',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});


// ============================================================
// API ROUTES
// Each route module is mounted on its URL prefix.
// Order doesn't matter here (unlike middleware), because Express
// matches routes by path, not by registration order.
// ============================================================
app.use('/api/auth', authRoutes);
app.use('/api/indexing', indexingRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/repositories', repositoryRoutes);

// Placeholder for future route modules (will be added in later steps)
// app.use('/api/repositories', repositoryRoutes);  // Phase 4
// app.use('/api/chat', chatRoutes);                 // Phase 5
// app.use('/api/search', searchRoutes);              // Phase 6

// API root — shows available endpoints for discoverability
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
      repositories: 'GET|POST /api/repositories/* (coming in Phase 4)',
      indexing: {
        start: 'POST /api/indexing/start',
        status: 'GET /api/indexing/status/:repositoryId',
      },
      search: 'POST /api/search/:repositoryId',
      chat: 'POST /api/chat/:repositoryId',
    },
  });
});

// ============================================================
// 404 HANDLER — Must come AFTER all valid routes
// If a request reaches this point, no route above matched it.
// We return 404 with a helpful error message.
// ============================================================
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    message: `The endpoint ${_req.method} ${_req.originalUrl} does not exist on this server.`,
  });
});

// ============================================================
// GLOBAL ERROR HANDLER — Must come LAST and have exactly 4 parameters
// Express identifies error handlers by the (err, req, res, next) signature.
// When any route calls next(error) or throws (via express-async-errors),
// Express skips all normal middleware and jumps directly here.
// ============================================================
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { status?: number; statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
  // Log the full error stack in development for debugging
  if (NODE_ENV === 'development') {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('🔴 UNHANDLED ERROR:');
    console.error(err.stack);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  // Determine HTTP status code
  // Some errors carry their own status code (e.g., CORS errors, validation errors)
  const statusCode = err.status || err.statusCode || 500;

  // In production, never leak internal error details to the client
  const message =
    NODE_ENV === 'production' && statusCode === 500
      ? 'An internal server error occurred. Please try again later.'
      : err.message || 'An unexpected error occurred';

  res.status(statusCode).json({
    success: false,
    error: message,
    // Only include stack trace in development responses
    ...(NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ============================================================
// HTTP SERVER CREATION
// We wrap the Express app in Node's http.Server.
// Benefit: We can gracefully close the server, which waits for
// in-flight requests to complete before shutting down.
// ============================================================
const server = createServer(app);

// ============================================================
// START LISTENING
// server.listen() tells Node.js to start accepting TCP connections on PORT.
// The callback fires once the port is successfully bound.
// ============================================================
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

// ============================================================
// GRACEFUL SHUTDOWN HANDLER
// When you press CTRL+C in the terminal, Node.js receives a SIGTERM signal.
// Without this handler, the process immediately kills itself, potentially:
//   - Cutting off in-progress database writes (data corruption)
//   - Leaving Redis keys in inconsistent state
//   - Dropping active SSE streaming connections
//
// With this handler:
//   1. We stop accepting NEW connections
//   2. We wait for EXISTING connections to finish (up to 10 seconds)
//   3. We then close cleanly
// ============================================================
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

  // Force-kill after 10 seconds if connections don't drain
  setTimeout(() => {
    console.error('⏰ Shutdown timeout exceeded (10s). Force-killing process.');
    process.exit(1);
  }, 10_000);
};

// Listen for termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // Kill signal (e.g., from cloud platforms)
process.on('SIGINT', () => gracefulShutdown('SIGINT'));   // CTRL+C in terminal

// ============================================================
// UNHANDLED PROMISE REJECTION GUARD
// If a Promise rejects and nobody catches it, Node.js would
// previously silently ignore it (in older versions) or crash (v15+).
// This handler logs the error and exits so we know what went wrong.
// ============================================================
process.on('unhandledRejection', (reason: unknown) => {
  console.error('🔴 UNHANDLED PROMISE REJECTION:');
  console.error(reason);
  // Initiate graceful shutdown — the server is in an unknown state
  gracefulShutdown('unhandledRejection');
});

// ============================================================
// UNCAUGHT EXCEPTION GUARD
// Synchronous errors that aren't caught by try/catch bubble up here.
// At this point the application is in an undefined state.
// The only safe response is to log and exit.
// ============================================================
process.on('uncaughtException', (err: Error) => {
  console.error('🔴 UNCAUGHT EXCEPTION:');
  console.error(err.stack);
  process.exit(1); // Hard exit — don't attempt graceful shutdown
});

// Export for testing purposes (allows test files to import the app)
export default app;