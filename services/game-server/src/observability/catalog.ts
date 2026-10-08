import { LatencyWindow, MetricsRegistry, RateWindow } from './metrics';

/**
 * The complete set of server metrics (spec §105). Names are referenced by
 * infra/monitoring/alerts.yml — rename both together.
 */
export function createMetricsCatalog(registry = new MetricsRegistry()) {
  return {
    registry,
    // gameplay
    activePlayers: registry.gauge('jpb_active_players', 'Players still in the tournament (per tournament)'),
    activeTables: registry.gauge('jpb_active_tables', 'Open tables (per tournament)'),
    tablesStalled: registry.gauge('jpb_tables_stalled', 'Tables without progress beyond the stall threshold'),
    handsCompleted: registry.counter('jpb_hands_completed_total', 'Hands completed'),
    actions: registry.counter('jpb_actions_total', 'Player actions processed, by result (accepted|rejected|duplicate|timeout)'),
    actionLatency: registry.histogram('jpb_action_latency_ms', 'Time from action receipt to durable acknowledgement (ms)'),
    commandLatency: registry.histogram('jpb_command_latency_ms', 'Table/director command processing time incl. persistence (ms)'),
    integrityViolations: registry.counter('jpb_integrity_violations_total', 'Invariant violations, by code'),
    // connectivity
    wsConnections: registry.gauge('jpb_ws_connections', 'Open WebSocket connections, by audience'),
    wsConnects: registry.counter('jpb_ws_connects_total', 'WebSocket connections opened'),
    wsDisconnects: registry.counter('jpb_ws_disconnects_total', 'WebSocket connections closed'),
    reconnects: registry.counter('jpb_reconnects_total', 'Client reconnects (resume with a cursor)'),
    wsMessagesOut: registry.counter('jpb_ws_messages_out_total', 'Frames sent to clients'),
    wsMessagesIn: registry.counter('jpb_ws_messages_in_total', 'Frames received from clients'),
    // dependencies
    dbLatency: registry.histogram('jpb_db_latency_ms', 'Database transaction latency (ms)'),
    dbErrors: registry.counter('jpb_db_errors_total', 'Database errors'),
    redisLatency: registry.histogram('jpb_redis_latency_ms', 'Redis round-trip latency (ms)'),
    errors: registry.counter('jpb_errors_total', 'Server errors, by area'),
    httpRequests: registry.counter('jpb_http_requests_total', 'HTTP requests, by route group and status class'),
    // live windows for the admin control room (exact recent percentiles / rates)
    windows: {
      actionLatency: new LatencyWindow(4096),
      dbLatency: new LatencyWindow(2048),
      actionsPerSecond: new RateWindow(120),
      handsPerMinute: new RateWindow(600),
      disconnectsPerSecond: new RateWindow(120),
      reconnectsPerSecond: new RateWindow(120),
    },
  };
}

export type MetricsCatalog = ReturnType<typeof createMetricsCatalog>;
