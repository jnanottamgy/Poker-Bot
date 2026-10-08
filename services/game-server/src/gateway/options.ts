import { RATE_LIMITS } from '../security/rate-limit';
import type { RateLimitRule } from '../security/rate-limit';

/**
 * WebSocket close codes used by the gateway. 4xxx codes are application
 * codes; clients reconnect on 1012/1013/4002 and must re-authenticate on
 * 4401, and never auto-reconnect on 4409 (another device took over).
 */
export const CLOSE_CODES = {
  /** Graceful shutdown / deploy: reconnect (possibly to another node). */
  SERVICE_RESTART: 1012,
  /** The client could not keep up with the frame rate (send buffer overflow). */
  SLOW_CONSUMER: 1013,
  /** Sustained protocol abuse (rate limits). */
  POLICY_VIOLATION: 1008,
  /** No frame and no pong within the idle timeout. */
  IDLE_TIMEOUT: 4002,
  /** First frame was not a valid hello, or the protocol version is unsupported. */
  BAD_HELLO: 4400,
  /** No valid session for the requested audience, or the session was revoked. */
  UNAUTHORIZED: 4401,
  /** Authenticated but not allowed for this audience/tournament. */
  FORBIDDEN: 4403,
  /** Unknown tournament. */
  NOT_FOUND: 4404,
  /** No hello within the hello timeout. */
  HELLO_TIMEOUT: 4408,
  /** Another device of the same player took control (session_replaced). */
  SESSION_REPLACED: 4409,
} as const;

export interface GatewayOptions {
  /** The first frame must be `hello` within this time. */
  helloTimeoutMs: number;
  /** Largest accepted client frame (bytes). Larger frames get an error frame and are ignored. */
  maxFrameBytes: number;
  /** Hard ws-level limit: frames above it make `ws` close the socket with 1009. */
  hardMaxPayloadBytes: number;
  /** How often the server pings and checks for silent sockets. */
  heartbeatIntervalMs: number;
  /** Sockets silent (no frame, no pong) for longer than this are closed. */
  idleTimeoutMs: number;
  /** TTL of the controller key in the presence store; refreshed every `controllerRefreshMs`. */
  controllerTtlMs: number;
  controllerRefreshMs: number;
  /** A controller disconnect is reported to the table only if no controller reappears within this window. */
  disconnectDebounceMs: number;
  /** Above this many buffered bytes table updates are skipped and the socket is marked stale. */
  staleBufferBytes: number;
  /** A stale socket is considered drained (and resynced with a snapshot) at or below this many bytes. */
  drainedBufferBytes: number;
  /** Above this many buffered bytes the socket is closed as a slow consumer. */
  closeBufferBytes: number;
  /** While stale, how often to check whether the buffer drained. */
  drainCheckMs: number;
  /** Sessions are re-validated this often (revocation, disabled admins, role changes). */
  sessionRecheckMs: number;
  /** How long the per-tournament spectator delay value is cached. */
  delayCacheMs: number;
  /** Rate-limited frames beyond this count close the socket (1008). */
  maxRateLimitViolations: number;
  /** Additional browser origins allowed besides PUBLIC_BASE_URL (e.g. a dev server). */
  extraAllowedOrigins: string[];
  limits: {
    message: RateLimitRule;
    action: RateLimitRule;
    snapshot: RateLimitRule;
  };
}

export const DEFAULT_GATEWAY_OPTIONS: GatewayOptions = {
  helloTimeoutMs: 10_000,
  maxFrameBytes: 4 * 1024,
  hardMaxPayloadBytes: 16 * 1024,
  heartbeatIntervalMs: 10_000,
  idleTimeoutMs: 30_000,
  controllerTtlMs: 20_000,
  controllerRefreshMs: 5_000,
  disconnectDebounceMs: 3_000,
  staleBufferBytes: 1024 * 1024,
  drainedBufferBytes: 64 * 1024,
  closeBufferBytes: 8 * 1024 * 1024,
  drainCheckMs: 250,
  sessionRecheckMs: 60_000,
  delayCacheMs: 5_000,
  maxRateLimitViolations: 50,
  extraAllowedOrigins: [],
  limits: {
    message: RATE_LIMITS.wsMessage,
    action: RATE_LIMITS.playerAction,
    snapshot: { capacity: 3, refillPerSecond: 0.5 },
  },
};

export function resolveGatewayOptions(partial: Partial<GatewayOptions> = {}): GatewayOptions {
  return {
    ...DEFAULT_GATEWAY_OPTIONS,
    ...partial,
    limits: { ...DEFAULT_GATEWAY_OPTIONS.limits, ...partial.limits },
  };
}
