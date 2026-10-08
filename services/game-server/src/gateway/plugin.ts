import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { HttpContext } from '../http/context';
import { clientIp, header, rateLimit } from '../http/context';
import { forbidden, tooManyRequests, unavailable } from '../http/errors';
import type { GatewayPrincipal } from './connection';
import type { Gateway } from './gateway';
import { isAllowedOrigin } from './origin';
import { resolvePrincipal } from './principal';

/** Upgrades per client IP. Generous because a venue's players often share one NAT address. */
export const WS_UPGRADE_LIMIT = { capacity: 200, refillPerSecond: 50 } as const;

/** Retry-After for an IP that holds too many anonymous sockets (sockets close on their own, so retry soon). */
const ANONYMOUS_LIMIT_RETRY_SECONDS = 10;

/**
 * Route module for `buildHttpApp({ modules: [gatewayModule(gateway)] })`:
 * registers @fastify/websocket and `GET /ws`.
 *
 * The upgrade is checked BEFORE the socket is accepted: draining nodes
 * answer 503, a foreign Origin 403 (cross-site WebSocket hijacking), floods
 * 429, a full node 503 and an IP holding too many anonymous sockets 429.
 * Cookies are resolved to a principal here (and again at hello); a missing,
 * forged or expired cookie simply yields no identity, so the socket can
 * still be used for public audiences while PLAYER/ADMIN hellos are refused (4401).
 */
export function gatewayModule(gateway: Gateway) {
  return async (app: FastifyInstance, ctx: HttpContext): Promise<void> => {
    const principals = new WeakMap<FastifyRequest, GatewayPrincipal>();

    await app.register(websocket, {
      options: { maxPayload: gateway.options.hardMaxPayloadBytes, perMessageDeflate: false },
      preClose: async () => {
        await gateway.shutdown();
        await new Promise<void>((resolve) => app.websocketServer.close(() => resolve()));
      },
    });

    app.get(
      '/ws',
      {
        websocket: true,
        preValidation: async (req) => {
          if (gateway.isDraining) throw unavailable();
          const origin = header(req, 'origin');
          if (!isAllowedOrigin(origin, { publicBaseUrl: ctx.env.publicBaseUrl, nodeEnv: ctx.env.nodeEnv, extraAllowedOrigins: gateway.options.extraAllowedOrigins })) {
            throw forbidden('This page is not allowed to open a game connection.');
          }
          const ip = clientIp(req);
          rateLimit(ctx, 'wsUpgrade', WS_UPGRADE_LIMIT, ip);
          const principal = await resolvePrincipal(ctx.sessions, req.cookies);
          const admission = gateway.admission(ip, principal);
          if (admission === 'NODE_FULL') throw unavailable();
          if (admission === 'IP_FULL') throw tooManyRequests(ANONYMOUS_LIMIT_RETRY_SECONDS);
          principals.set(req, principal);
        },
      },
      (socket, req) => {
        const principal = principals.get(req);
        if (!principal) {
          socket.close(1011, 'not authenticated');
          return;
        }
        gateway.accept(socket, principal, clientIp(req));
      },
    );
  };
}
