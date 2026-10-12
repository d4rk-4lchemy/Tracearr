/**
 * Simple logger utility for services.
 *
 * Provides a consistent logging interface that can be enhanced later
 * with structured logging, log levels, or integration with external
 * logging services.
 */

/** Applied to every Fastify request log, so a credential in a request never reaches a log line. */
export const REQUEST_LOG_REDACT = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-emby-authorization"]',
    'req.headers["x-emby-token"]',
    'req.body.password',
    'req.body.Pw',
    'req.body.token',
    'req.body.secret',
    'req.body.accessToken',
  ],
  censor: '[redacted]',
};

export interface Logger {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Create a logger instance with optional namespace prefix.
 */
export function createLogger(namespace?: string): Logger {
  const prefix = namespace ? `[${namespace}] ` : '';

  return {
    debug: (message: string, context?: Record<string, unknown>) => {
      if (process.env.LOG_LEVEL === 'debug') {
        console.debug(prefix + message, context ?? '');
      }
    },
    info: (message: string, context?: Record<string, unknown>) => {
      console.info(prefix + message, context ?? '');
    },
    warn: (message: string, context?: Record<string, unknown>) => {
      console.warn(prefix + message, context ?? '');
    },
    error: (message: string, context?: Record<string, unknown>) => {
      console.error(prefix + message, context ?? '');
    },
  };
}

// Default logger for the automations engine
export const automationsLogger = createLogger('automations');
