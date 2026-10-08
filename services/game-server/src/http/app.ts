import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { ZodError } from 'zod';
import { HttpError } from './errors';
import { isActorError } from '../runtime/errors';
import { GameError } from '../game/game-service';
import type { HttpContext } from './context';
import { registerAdminAuthRoutes } from './routes/admin-auth';
import { registerHealthRoutes } from './routes/health';
import { registerAdminUserRoutes } from './routes/admin-users';
import { registerAuditAndAlertRoutes } from './routes/admin-audit-alerts';

export interface BuildHttpOptions {
  logger?: boolean | { level: string };
  /** Extra route modules (gateway, player, admin, display...) registered after the core ones. */
  modules?: Array<(app: FastifyInstance, ctx: HttpContext) => void | Promise<void>>;
  /** Called for unknown non-API GET paths (single-page app fallback); returns true when it answered. */
  fallback?: (req: FastifyRequest, reply: FastifyReply) => Promise<boolean> | boolean;
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
    if (err instanceof GameError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: null } });
    }
    if (isActorError(err)) {
      // The runtime could not confirm the command (owner moving, database hiccup): safe to retry.
      reply.header('Retry-After', '1');
      return reply
        .status(err.code === 'FAULTED' || err.code === 'NONDETERMINISTIC' ? 500 : 503)
        .send({ error: { code: err.code === 'FAULTED' ? 'TABLE_HALTED' : 'UNAVAILABLE', message: err.code === 'FAULTED' ? 'This table is halted for an integrity check. Staff have been alerted.' : 'Server reconnecting. Please try again in a moment.', details: { processed: err.processed } } });
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

  app.setNotFoundHandler(async (req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    if (opts.fallback && (req.method === 'GET' || req.method === 'HEAD') && !path.startsWith('/api/') && path !== '/ws' && (await opts.fallback(req, reply))) return reply;
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });

  registerHealthRoutes(app, ctx);
  registerAdminAuthRoutes(app, ctx);
  registerAdminUserRoutes(app, ctx);
  registerAuditAndAlertRoutes(app, ctx);
  for (const mod of opts.modules ?? []) await mod(app, ctx);
  return app;
}
