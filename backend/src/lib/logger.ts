// ============================================================
// WINSTON LOGGER — Production-grade structured logging
// ============================================================
// Replaces scattered console.log/console.error calls with a
// centralized, configurable, filterable logging system.
//
// LOG LEVELS (from most severe to least):
//   error  → Critical failures (DB down, API crashes)
//   warn   → Something is wrong but recoverable
//   info   → Important events (user logged in, indexing done)
//   http   → HTTP requests (auto-populated via morgan)
//   debug  → Detailed dev-only diagnostics
//
// USAGE:
//   import { logger } from '@/lib/logger';
//   logger.info('User logged in', { userId: '123' });
//   logger.error('DB connection failed', { error: err.message });
// ============================================================

import winston from 'winston';
import path from 'path';

// ============================================================
// LOG LEVEL CONFIGURATION
// Custom level hierarchy — lower number = higher priority.
// Winston will log messages at the current level AND all
// higher-priority levels (e.g., 'info' level logs error+warn+info).
// ============================================================
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// ============================================================
// LOG COLORS — For beautiful colored console output in dev
// Each level gets a distinctive color for quick visual scanning
// ============================================================
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'cyan',
};

// Register the color scheme with winston
winston.addColors(colors);

// ============================================================
// DETERMINE ACTIVE LOG LEVEL BASED ON ENVIRONMENT
// - Development: log everything (debug and above)
// - Production: log only info and above (skip debug)
// - Test: log only errors (avoid test log spam)
// ============================================================
const getLogLevel = (): string => {
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production') return 'info';
  if (env === 'test') return 'error';
  return 'debug'; // development default
};

// ============================================================
// CONSOLE FORMAT — Pretty, colored, timestamped output
// Used for development terminal output.
//
// Example output:
//   2025-01-19 15:23:45 [INFO ]: User authenticated { userId: '123' }
// ============================================================
const consoleFormat = winston.format.combine(
  // Add timestamp
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  // Enable ANSI colors
  winston.format.colorize({ all: true }),
  // Format: "TIMESTAMP [LEVEL]: MESSAGE {metadata}"
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    // Serialize metadata objects (if any) as compact JSON
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    // Pad level to 5 chars for alignment (e.g., "info " vs "error")
    return `${timestamp} [${level}]:${message}${metaString}`;
  })
);

// ============================================================
// FILE FORMAT — Structured JSON for log aggregators
// Used for file-based log output (dev + production).
//
// JSON logs are machine-readable and can be:
//   - Ingested by services like Datadog, LogRocket, Grafana Loki
//   - Queried with tools like jq
//   - Searched by field (e.g., all logs where userId=123)
// ============================================================
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }), // Include stack traces for errors
  winston.format.json()                   // Output as JSON
);

// ============================================================
// TRANSPORTS — Where log messages are sent
// Winston supports many transport types. We use:
//   1. Console  — colored output for humans
//   2. File     — persistent structured logs for aggregators
// ============================================================

// Path to the logs directory (auto-created by winston if missing)
const logsDir = path.join(process.cwd(), 'logs');

const transports: winston.transport[] = [
  // Console transport — always active
  new winston.transports.Console({
    format: consoleFormat,
  }),
];

// File transports — only in non-test environments
// (we don't want tests writing log files)
if (process.env.NODE_ENV !== 'test') {
  transports.push(
    // General log file — captures all levels
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: fileFormat,
      maxsize: 5_242_880,  // 5 MB
      maxFiles: 5,         // Keep last 5 rotated files (25 MB total max)
    }),
    // Error-only log file — quick access to failures
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5_242_880,  // 5 MB
      maxFiles: 5,
    })
  );
}

// ============================================================
// CREATE THE LOGGER INSTANCE
// ============================================================
export const logger = winston.createLogger({
  level: getLogLevel(),
  levels,
  transports,

  // Prevent winston from crashing the app on logger errors
  // (e.g., disk full when writing files)
  exitOnError: false,
});

// ============================================================
// MORGAN INTEGRATION — Route HTTP request logs through Winston
// ============================================================
// Morgan (used in index.ts) normally logs HTTP requests to
// stdout. We create a stream adapter so Morgan writes to
// Winston at the 'http' level instead. This unifies all logs.
//
// USAGE (in index.ts):
//   import { morganStream } from '@/lib/logger';
//   app.use(morgan('dev', { stream: morganStream }));
// ============================================================
export const morganStream = {
  write: (message: string) => {
    // Morgan appends "\n" — remove it for cleaner logs
    logger.http(message.trim());
  },
};

// ============================================================
// STARTUP NOTIFICATION
// Log the current logger config so you can see it initialized.
// ============================================================
logger.debug('Logger initialized', {
  level: getLogLevel(),
  environment: process.env.NODE_ENV || 'development',
  transports: transports.map((t) => t.constructor.name),
});

// ============================================================
// DEFAULT EXPORT
// ============================================================
export default logger;