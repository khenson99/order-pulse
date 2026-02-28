import rateLimit from 'express-rate-limit';
import { rateLimitConfig } from '../config.js';

export const defaultLimiter = rateLimit({
  windowMs: rateLimitConfig.windowMs,
  max: rateLimitConfig.max,
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many authentication attempts. Please try again later.',
});

export const scrapeLimiter = rateLimit({
  windowMs: rateLimitConfig.windowMs,
  max: Math.min(rateLimitConfig.max, 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many scrape requests. Please try again later.',
});
