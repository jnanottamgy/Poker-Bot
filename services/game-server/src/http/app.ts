import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { ZodError } from 'zod';
import { HttpError } from './errors';
import type { HttpContext } from './context';
import { registerAdminAuthRoutes } from './routes/admin-auth';
import { registerHealthRoutes } from './routes/health';

export interface BuildHttpOptions {
  logger?: boolean | { level: string };
  /** Extra route modules (gateway, player, admin, display...) registered after the core ones. */
  modules?: Array<(app: FastifyInstance, ctx: HttpContext) => void | Promise<void>>;
}

/**
 * HTTP application shell: security headers, cookies, consistent error
 * mapping (friendly messages, never stack traces), health and auth routes.
 */
export async function buildHttpApp(ctx: HttpContext, opts: BuildHttpOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: ctx.env.trustProxy,
    bodyLimit: 64 * 1024,
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: ctx.env.cookieSecure ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      if (err.status === 429 && err.details && typeof err.details === 'object' && 'retryAfterSeconds' in err.details) {
        reply.header('Retry-After', String((err.details as { retryAfterSeconds: number }).retryAfterSeconds));
      }
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details ?? null } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: { code: 'INVALID_INPUT', message: 'Some fields are invalid.', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: 'BAD_REQUEST', message: 'The request could not be processed.' } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Your chips are safe; please retry.' } });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });

  registerHealthRoutes(app, ctx);
  registerAdminAuthRoutes(app, ctx);
  for (const mod of opts.modules ?? []) await mod(app, ctx);
  return app;
}
