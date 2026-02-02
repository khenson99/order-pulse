import pino from 'pino';
import pinoHttpPkg from 'pino-http';
import { env } from '../config.js';

// Handle ESM/CJS interop
const pinoHttp = (pinoHttpPkg as any).default || pinoHttpPkg;

const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
});

export const requestLogger = pinoHttp({
  logger,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
  autoLogging: {
    ignorePaths: ['/health', '/ready'],
  },
});

export const appLogger = logger;
