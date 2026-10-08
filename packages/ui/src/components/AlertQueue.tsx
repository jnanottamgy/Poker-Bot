import { useMemo, useState } from 'react';
import { cx } from '../cx';
import { formatCount } from '../format';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Menu } from './Menu';
import { Tabs } from './Tabs';

export type QueueSeverity = 'critical' | 'warning' | 'info';
export type AlertState = 'open' | 'acked' | 'snoozed';

export interface QueueAlert {
  id: string;
  severity: QueueSeverity;
  /** Machine code, e.g. "STALLED_TABLE". */
  code: string;
  title: string;
  /** Table / player / node the alert is about, e.g. "Table 37". */
  source?: string;
  detail?: string;
  /** Server epoch ms when the alert was raised. */
  raisedAt: number;
  state: AlertState;
  /** Staff member who owns it. */
  owner?: string | null;
  /** Server epoch ms when a snooze ends. */
  snoozedUntil?: number | null;
}

export interface AlertQueueProps {
  alerts: QueueAlert[];
  /** Current server time (ms) for ages; pass a ticking value from the app clock. */
  now: number;
  /** Staff the alert can be assigned to. */
  staff?: Array<{ id: string; name: string }>;
  onAck: (id: string) => void;
  onAssign?: (id: string, staffId: string) => void;
  onSnooze?: (id: string, minutes: number) => void;
  /** Jump to the source (opens the table inspector / player drawer). */
  onOpen?: (id: string) => void;
  /** Missing permission per action; disables it with the reason. */
  locked?: Partial<Record<'ack' | 'assign' | 'snooze', string>>;
  className?: string;
}

const SEVERITY: Readonly<Record<QueueSeverity, { label: string; icon: IconName; rank: number }>> = {
  critical: { label: 'Critical', icon: 'critical', rank: 0 },
  warning: { label: 'Warning', icon: 'warning', rank: 1 },
  info: { label: 'Info', icon: 'info', rank: 2 },
};

/** "45s", "3m 05s", "1h 12m". */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Most severe first, then oldest first. */
export function sortAlerts(alerts: QueueAlert[]): QueueAlert[] {
  return [...alerts].sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank || a.raisedAt - b.raisedAt);
}

const SNOOZE = [5, 15, 60] as const;

/**
 * The director's alert queue: severity (icon + text), age, source, owner and
 * per-alert Ack / Assign / Snooze. Open alerts sort most severe, then oldest,
 * first; tabs switch between open, acknowledged and snoozed.
 */
export function AlertQueue({ alerts, now, staff = [], onAck, onAssign, onSnooze, onOpen, locked = {}, className }: AlertQueueProps) {
  const [tab, setTab] = useState<AlertState>('open');
  const counts = useMemo(() => {
    const c: Record<AlertState, number> = { open: 0, acked: 0, snoozed: 0 };
    for (const a of alerts) c[a.state] += 1;
    return c;
  }, [alerts]);
  const list = useMemo(() => sortAlerts(alerts.filter((a) => a.state === tab)), [alerts, tab]);

  return (
    <div className={cx('jpb-aq', className)}>
      <Tabs
        label="Alert state"
        value={tab}
        onChange={(v) => setTab(v as AlertState)}
        tabs={[
          { id: 'open', label: 'Open', count: counts.open },
          { id: 'acked', label: 'Acknowledged', count: counts.acked },
          { id: 'snoozed', label: 'Snoozed', count: counts.snoozed },
        ]}
      />
      {list.length === 0 ? (
        <EmptyState compact icon="check-circle" title={tab === 'open' ? 'No open alerts' : 'Nothing here'} description={tab === 'open' ? 'Integrity and timing alerts appear here the moment they fire.' : undefined} />
      ) : (
        <ol className="jpb-aq__list" aria-label={`${tab} alerts`}>
          {list.map((a) => {
            const sev = SEVERITY[a.severity];
            const age = formatAge(now - a.raisedAt);
            return (
              <li key={a.id} className={cx('jpb-aq__item', `is-${a.severity}`, `is-${a.state}`)}>
                <span className="jpb-aq__sev">
                  <Icon name={sev.icon} />
                  {sev.label}
                </span>
                <div className="jpb-aq__body">
                  <p className="jpb-aq__title">{a.title}</p>
                  <p className="jpb-aq__meta">
                    <span className="jpb-mono">{a.code}</span>
                    {a.source && <span>{a.source}</span>}
                    <span>
                      <span className="jpb-sr-only">raised </span>
                      <span className="jpb-num">{age}</span> ago
                    </span>
                    <span className={cx('jpb-aq__owner', !a.owner && 'is-unowned')}>{a.owner ? `Owner: ${a.owner}` : 'Unassigned'}</span>
                    {a.state === 'snoozed' && a.snoozedUntil && <span>Back in {formatAge(a.snoozedUntil - now)}</span>}
                  </p>
                  {a.detail && <p className="jpb-aq__detail">{a.detail}</p>}
                </div>
                <div className="jpb-aq__actions" role="group" aria-label={`Actions for ${a.title}`}>
                  {onOpen && (
                    <Button size="sm" variant="ghost" icon="eye" onClick={() => onOpen(a.id)}>
                      Open
                    </Button>
                  )}
                  {a.state !== 'acked' && (
                    <Button size="sm" icon="check" disabled={Boolean(locked.ack)} title={locked.ack ? `Requires ${locked.ack}` : undefined} onClick={() => onAck(a.id)}>
                      Ack
                    </Button>
                  )}
                  {onAssign && staff.length > 0 && (
                    <Menu
                      label={`Assign ${a.title}`}
                      triggerText="Assign"
                      trigger={<Icon name="user" />}
                      items={staff.map((p) => ({ id: p.id, label: p.name, icon: 'user', disabled: Boolean(locked.assign), disabledReason: locked.assign ? `Requires ${locked.assign}` : undefined, onSelect: () => onAssign(a.id, p.id) }))}
                    />
                  )}
                  {onSnooze && a.state === 'open' && (
                    <Menu
                      label={`Snooze ${a.title}`}
                      triggerText="Snooze"
                      trigger={<Icon name="moon" />}
                      items={SNOOZE.map((m) => ({ id: String(m), label: `${m} minutes`, icon: 'clock', disabled: Boolean(locked.snooze), disabledReason: locked.snooze ? `Requires ${locked.snooze}` : undefined, onSelect: () => onSnooze(a.id, m) }))}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {counts.open > 0 && tab !== 'open' && (
        <p className="jpb-aq__note">
          <span className="jpb-num">{formatCount(counts.open)}</span> open alert{counts.open > 1 ? 's' : ''} still need attention.
        </p>
      )}
    </div>
  );
}
