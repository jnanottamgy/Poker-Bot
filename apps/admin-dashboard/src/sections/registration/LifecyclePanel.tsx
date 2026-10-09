import { useId, useState } from 'react';
import type { TournamentOverviewDto, TournamentStatus } from '@jpb/shared-types';
import { Button, ControlCard, Icon, Panel, cx, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { usePermission } from '../../auth/permissions';
import { useDangerousAction } from '../../danger/DangerProvider';
import { seatingPreview, seatingText } from './model';

/** The server keeps up to this many characters of admin entropy (strParam(adminEntropy, 256)). */
export const ENTROPY_MAX = 256;

interface Check {
  ok: boolean;
  warn?: boolean;
  text: string;
}

/**
 * Open / close / reopen registration and START TOURNAMENT (all level 1):
 * the seating preview (N players → T tables from config.tables), a
 * readiness checklist and the optional admin entropy.
 */
export function LifecyclePanel({ overview, status, registered, pending }: { overview: TournamentOverviewDto; status: TournamentStatus | null; registered: number; pending: number | null }) {
  const api = useApi();
  const danger = useDangerousAction();
  const canLifecycle = usePermission('TOURNAMENT_LIFECYCLE');
  const entropyId = useId();
  const [entropy, setEntropy] = useState('');
  const id = overview.id;
  const cfg = overview.config;
  const allowed = new Set(overview.allowedTransitions);
  const invalidate = [qk.tournament(id), qk.tournamentsAll()];
  const preview = seatingPreview(registered, cfg.tables, cfg.balancing.consolidateBy);
  const minNeeded = Math.max(2, cfg.minPlayers);

  const open = () =>
    void danger({
      level: 1,
      endpoint: 'registrationOpen',
      title: 'Open registration',
      summary: 'Players can register with the join link or the QR code.',
      consequences: [
        cfg.registration.accessCode ? `They need the access code ${cfg.registration.accessCode}` : 'No access code: anyone with the link can register',
        cfg.registration.requireApproval ? 'Each registration waits for staff approval' : 'Registrations are approved automatically',
        `Up to ${formatCount(cfg.maxPlayers)} players`,
      ],
      reason: 'optional',
      confirmLabel: 'Open registration',
      run: ({ reason }) => api.lifecycle.openRegistration(id, reason ? { reason } : {}),
      success: 'Registration is open',
      invalidate,
    });
  const close = () =>
    void danger({
      level: 1,
      endpoint: 'registrationClose',
      title: 'Close registration',
      summary: 'Nobody can register any more. You can reopen it until the tournament starts.',
      consequences: [`${formatCount(registered)} approved players are kept`, ...(pending ? [`${formatCount(pending)} pending registrations can still be approved or rejected`] : []), 'Players opening the join page see that registration is closed'],
      reason: 'optional',
      confirmLabel: 'Close registration',
      run: ({ reason }) => api.lifecycle.closeRegistration(id, reason ? { reason } : {}),
      success: 'Registration closed',
      invalidate,
    });
  const reopen = () =>
    void danger({
      level: 1,
      endpoint: 'registrationReopen',
      title: 'Reopen registration',
      summary: 'Players can register again with the join link or QR code.',
      reason: 'optional',
      confirmLabel: 'Reopen registration',
      run: ({ reason }) => api.lifecycle.reopenRegistration(id, reason ? { reason } : {}),
      success: 'Registration reopened',
      invalidate,
    });
  const start = () => {
    const ent = entropy.trim();
    void danger({
      level: 1,
      endpoint: 'tournamentStart',
      title: 'Start tournament',
      summary: seatingText(preview),
      consequences: [
        'Players are seated at random by a draw from the public entropy — reproducible and verifiable afterwards',
        ent ? 'Your admin entropy is mixed into the public entropy (it is published with it)' : 'No admin entropy: the public entropy comes from the players’ browser seeds and the server commitment',
        `The first hand is dealt after a ${formatCount(cfg.timing.startCountdownSeconds)}-second countdown`,
        'The configuration locks; only future levels, breaks, timers and display settings stay editable',
        ...(pending ? [`${formatCount(pending)} pending registration${pending === 1 ? ' is' : 's are'} NOT seated (approve them first, or later by late registration)`] : []),
      ],
      reason: 'optional',
      confirmLabel: 'Start tournament',
      run: ({ reason }) => api.lifecycle.start(id, { ...(ent ? { adminEntropy: ent } : {}), ...(reason ? { reason } : {}) }),
      success: 'Tournament starting — players are being seated',
      invalidate,
      onSuccess: () => setEntropy(''),
    });
  };

  const checks: Check[] = [
    { ok: status === 'REGISTRATION_CLOSED', text: status === 'REGISTRATION_CLOSED' ? 'Registration is closed' : status === 'REGISTRATION' ? 'Close registration first' : 'Registration must be closed' },
    { ok: registered >= minNeeded, text: registered >= minNeeded ? `${formatCount(registered)} approved players (minimum ${formatCount(minNeeded)})` : `${formatCount(minNeeded - registered)} more approved players needed (minimum ${formatCount(minNeeded)})` },
    { ok: true, warn: Boolean(pending), text: pending ? `${formatCount(pending)} pending registrations will not be seated` : 'No pending registrations' },
  ];
  const canStart = allowed.has('STARTING') && registered >= minNeeded;
  const started = status !== null && !['DRAFT', 'REGISTRATION', 'REGISTRATION_CLOSED'].includes(status);

  return (
    <Panel title="Registration & start" icon="play" className="acr-registration-lifecycle">
      <div className="acr-registration-stack">
        {canLifecycle && !started && status !== 'CANCELLED' && (
          <ControlCard
            title="Registration"
            icon="users"
            state={status === 'DRAFT' ? 'Not open yet' : status === 'REGISTRATION' ? 'Open — players can join' : status === 'REGISTRATION_CLOSED' ? 'Closed' : '—'}
          >
            {status === 'DRAFT' && (
              <Button size="sm" variant="primary" icon="play" disabled={!allowed.has('REGISTRATION')} onClick={open}>
                Open registration
              </Button>
            )}
            {status === 'REGISTRATION' && (
              <Button size="sm" icon="lock" disabled={!allowed.has('REGISTRATION_CLOSED')} onClick={close}>
                Close registration
              </Button>
            )}
            {status === 'REGISTRATION_CLOSED' && (
              <Button size="sm" icon="refresh" disabled={!allowed.has('REGISTRATION')} onClick={reopen}>
                Reopen registration
              </Button>
            )}
          </ControlCard>
        )}

        {!started && status !== 'CANCELLED' && (
          <ControlCard title="Start tournament" icon="play" tone={canStart ? 'gold' : 'default'} state={seatingText(preview)} description="Seats every approved player at random and starts the countdown to the first hand.">
            <div className="acr-registration-seating" aria-hidden="true">
              {preview.groups.map((g) => (
                <span key={g.size} className="acr-registration-seating__group">
                  <span className="acr-registration-seating__tables">
                    {Array.from({ length: Math.min(g.count, 24) }, (_, i) => (
                      <span key={i} className="acr-registration-seating__table" />
                    ))}
                    {g.count > 24 && <span className="acr-registration-seating__more">+{formatCount(g.count - 24)}</span>}
                  </span>
                  <span className="acr-registration-seating__label">
                    {formatCount(g.count)} table{g.count === 1 ? '' : 's'} of {g.size}
                  </span>
                </span>
              ))}
            </div>
            <ul className="acr-registration-checks" aria-label="Ready to start?">
              {checks.map((c) => (
                <li key={c.text} className={cx(!c.ok && 'is-bad', c.warn && 'is-warn')}>
                  <Icon name={!c.ok ? 'x-circle' : c.warn ? 'warning' : 'check-circle'} />
                  <span>
                    <span className="jpb-sr-only">{!c.ok ? 'Not ready: ' : c.warn ? 'Warning: ' : 'Ready: '}</span>
                    {c.text}
                  </span>
                </li>
              ))}
            </ul>
            {canLifecycle ? (
              <>
                <div className="jpb-field acr-registration-entropy">
                  <label htmlFor={entropyId} className="jpb-field__label">
                    Admin entropy (optional)
                  </label>
                  <input
                    id={entropyId}
                    className="jpb-input"
                    value={entropy}
                    maxLength={ENTROPY_MAX}
                    autoComplete="off"
                    onChange={(e) => setEntropy(e.target.value)}
                    placeholder="e.g. dice rolled on stage: 4-1-6-6-2-3"
                    aria-describedby={`${entropyId}-hint`}
                  />
                  <p id={`${entropyId}-hint`} className="jpb-field__hint">
                    Anything you choose right now — dice rolls, a phrase called out by the audience. It is mixed with every player’s browser seed into the public entropy, which together with the server seed committed in advance (its hash is already published) decides the seating and every deck. Nobody, not even the server, knows all inputs beforehand, so nobody can predict or steer the shuffle.
                  </p>
                </div>
                <Button variant="primary" icon="play" disabled={!canStart} onClick={start}>
                  Start tournament…
                </Button>
              </>
            ) : (
              <p className="acr-registration-note">
                <Icon name="lock" /> Requires TOURNAMENT_LIFECYCLE to open, close or start.
              </p>
            )}
          </ControlCard>
        )}

        {started && (
          <p className="acr-registration-note">
            <Icon name="check-circle" /> The tournament has started. Late registration and re-entry follow the rules above; manual registration stays available while late registration is open.
          </p>
        )}
        {status === 'CANCELLED' && (
          <p className="acr-registration-note">
            <Icon name="ban" /> This tournament was cancelled.
          </p>
        )}
      </div>
    </Panel>
  );
}
