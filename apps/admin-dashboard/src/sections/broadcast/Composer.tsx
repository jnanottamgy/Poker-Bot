import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, Icon, Panel, cx, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import type { AnnounceScope } from '../../api/types';
import { useDangerousAction } from '../../danger/DangerProvider';
import { TargetPicker } from './TargetPicker';
import type { PickedPlayer, PickedTable } from './TargetPicker';
import { ANNOUNCE_MAX, SCOPES, SCOPE_META, TEMPLATES, TEMPLATE_GROUPS, fillTemplate, missingText } from './templates';
import type { TemplateContext } from './templates';

/** Characters left at which the counter turns into a warning. */
const COUNTER_WARN_AT = 30;

export interface SentRecord {
  id: number;
  at: number;
  scope: AnnounceScope;
  target: string | null;
  text: string;
}

export interface Prefill {
  text: string;
  scope: AnnounceScope;
  seq: number;
}

export interface ComposerProps {
  tournamentId: string;
  ctx: TemplateContext;
  /** Players currently holding a seat (for the recipients line). */
  activePlayers: number | null;
  canSend: boolean;
  prefill: Prefill | null;
  onSent: (r: Omit<SentRecord, 'id'>) => void;
  now: () => number;
}

const UNFILLED_RE = /\{[a-zA-Z]+\}/;

/**
 * §2.14 "Send an announcement (template or free text) to everyone / a table /
 * one player / the big screen" — max 280 characters, level-1 confirmation.
 */
export function Composer({ tournamentId, ctx, activePlayers, canSend, prefill, onSent, now }: ComposerProps) {
  const api = useApi();
  const danger = useDangerousAction();
  const id = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [scope, setScope] = useState<AnnounceScope>('ALL');
  const [table, setTable] = useState<PickedTable | null>(null);
  const [player, setPlayer] = useState<PickedPlayer | null>(null);
  const [text, setText] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [lastFill, setLastFill] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);

  const fullCtx = useMemo<TemplateContext>(() => ({ ...ctx, table: table?.tableNumber ?? null, player: player?.displayName ?? null }), [ctx, table, player]);

  // Re-fill the chosen template when its data (or the target) changes, unless the operator edited the text.
  useEffect(() => {
    const tpl = TEMPLATES.find((t) => t.id === templateId);
    if (!tpl || text !== lastFill) return;
    const next = fillTemplate(tpl.text, fullCtx).text;
    if (next !== text) {
      setText(next);
      setLastFill(next);
    }
  }, [fullCtx]);

  useEffect(() => {
    if (!prefill) return;
    setScope(prefill.scope);
    setText(prefill.text.slice(0, ANNOUNCE_MAX));
    setTemplateId('');
    setLastFill(null);
    setTouched(false);
    requestAnimationFrame(() => textRef.current?.focus());
  }, [prefill?.seq]);

  const applyTemplate = (tid: string) => {
    setTemplateId(tid);
    const tpl = TEMPLATES.find((t) => t.id === tid);
    if (!tpl) return;
    if (tpl.scope === 'TABLE' || tpl.scope === 'PLAYER') setScope(tpl.scope);
    else if (scope === 'TABLE' || scope === 'PLAYER') setScope('ALL');
    const filled = fillTemplate(tpl.text, { ...fullCtx }).text.slice(0, ANNOUNCE_MAX);
    setText(filled);
    setLastFill(filled);
    setTouched(false);
    requestAnimationFrame(() => textRef.current?.focus());
  };

  const trimmed = text.trim();
  const left = ANNOUNCE_MAX - text.length;
  const target = scope === 'TABLE' ? table : scope === 'PLAYER' ? player : null;
  const needsTarget = (scope === 'TABLE' || scope === 'PLAYER') && !target;
  const unfilled = UNFILLED_RE.exec(trimmed)?.[0] ?? null;
  const problem = trimmed === '' ? 'Write the announcement or pick a template.' : text.length > ANNOUNCE_MAX ? `Keep it under ${ANNOUNCE_MAX} characters.` : needsTarget ? (scope === 'TABLE' ? 'Choose the table.' : 'Choose the player.') : unfilled ? `Replace ${unfilled} with real text before sending.` : null;

  const recipients =
    scope === 'ALL'
      ? `Every player${activePlayers !== null ? ` (${formatCount(activePlayers)} still playing)` : ''}, spectators and the big screen`
      : scope === 'DISPLAY'
        ? 'The big screen — the server also shows it to players as a tournament announcement'
        : scope === 'TABLE'
          ? `Each player seated at ${table?.label ?? 'the table'}, as a private notice`
          : `${player?.label ?? 'The player'} only, as a private notice`;

  const send = async () => {
    setTouched(true);
    if (problem || !canSend || sending) return;
    setSending(true);
    const targetId = scope === 'TABLE' ? table?.id : scope === 'PLAYER' ? player?.id : undefined;
    const targetLabel = scope === 'TABLE' ? (table?.label ?? null) : scope === 'PLAYER' ? (player?.label ?? null) : null;
    const res = await danger({
      level: 1,
      endpoint: 'announce',
      title: scope === 'ALL' ? 'Send to everyone' : scope === 'DISPLAY' ? 'Show on the big screen' : `Send to ${targetLabel}`,
      summary: `“${trimmed}”`,
      consequences: [recipients, 'Delivered instantly — it cannot be recalled', 'Recorded in the audit log under your name'],
      confirmLabel: 'Send now',
      run: () => api.broadcast.announce(tournamentId, { text: trimmed, scope, ...(targetId ? { targetId } : {}) }),
      success: scope === 'DISPLAY' ? 'Shown on the big screen' : 'Announcement sent',
      invalidate: [qk.auditAll()],
    });
    setSending(false);
    if (res) {
      onSent({ at: now(), scope, target: targetLabel, text: trimmed });
      setText('');
      setTemplateId('');
      setLastFill(null);
      setTouched(false);
    }
  };

  return (
    <Panel title="Send an announcement" icon="message" description="Templates or free text, up to 280 characters. Deterministic templates only — no generated text." className="acr-broadcast-composer">
      <form
        className="acr-broadcast-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        noValidate
      >
        <fieldset className="acr-broadcast-scopes" disabled={!canSend}>
          <legend className="acr-broadcast-legend">Audience</legend>
          {SCOPES.map((s) => (
            <label key={s} className={cx('acr-broadcast-scope', scope === s && 'is-on')} title={SCOPE_META[s].hint}>
              <input type="radio" name={`${id}-scope`} value={s} checked={scope === s} onChange={() => setScope(s)} />
              <Icon name={SCOPE_META[s].icon} />
              <span>{SCOPE_META[s].label}</span>
            </label>
          ))}
        </fieldset>
        <p className="acr-broadcast-scopehint">
          <Icon name="info" /> {SCOPE_META[scope].hint}
        </p>

        {scope === 'TABLE' && <TargetPicker kind="table" tournamentId={tournamentId} value={table} onChange={setTable} label="Table" disabled={!canSend} />}
        {scope === 'PLAYER' && <TargetPicker kind="player" tournamentId={tournamentId} value={player} onChange={setPlayer} label="Player" disabled={!canSend} hint="Private notice: only this player sees it." />}

        <div className="jpb-field">
          <label className="jpb-field__label" htmlFor={`${id}-tpl`}>
            Template
          </label>
          <span className="jpb-select-wrap">
            <select id={`${id}-tpl`} className="jpb-input jpb-select" value={templateId} disabled={!canSend} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">Free text (no template)</option>
              {TEMPLATE_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {TEMPLATES.filter((t) => t.group === g).map((t) => {
                    const missing = fillTemplate(t.text, { ...fullCtx, table: fullCtx.table ?? 0, player: fullCtx.player ?? '-' }).missing;
                    return (
                      <option key={t.id} value={t.id} disabled={missing.length > 0}>
                        {t.label}
                        {missing.length > 0 ? ` — needs ${missingText(missing)}` : ''}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </select>
            <Icon name="chevron-down" className="jpb-select__chevron" />
          </span>
        </div>

        <div className={cx('jpb-field', touched && problem && 'is-invalid')}>
          <label className="jpb-field__label" htmlFor={`${id}-text`}>
            Message
          </label>
          <textarea
            ref={textRef}
            id={`${id}-text`}
            className="jpb-input jpb-textarea acr-broadcast-text"
            rows={4}
            maxLength={ANNOUNCE_MAX}
            value={text}
            disabled={!canSend}
            aria-invalid={touched && problem ? true : undefined}
            aria-describedby={`${id}-count${touched && problem ? ` ${id}-err` : ''}`}
            placeholder="e.g. Final table starts in 10 minutes at the main stage."
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="acr-broadcast-textfoot">
            {touched && problem ? (
              <p id={`${id}-err`} className="jpb-field__error">
                <Icon name="warning" /> {problem}
              </p>
            ) : (
              <span className="acr-broadcast-dim">Ctrl/⌘ + Enter to send</span>
            )}
            <span id={`${id}-count`} className={cx('acr-broadcast-count', left <= COUNTER_WARN_AT && 'is-warn', left < 0 && 'is-over')} aria-live={left <= COUNTER_WARN_AT ? 'polite' : 'off'}>
              {formatCount(text.length)} / {ANNOUNCE_MAX}
              <span className="jpb-sr-only"> characters</span>
            </span>
          </div>
        </div>

        <div className="acr-broadcast-preview" aria-label="Preview">
          <span className="acr-broadcast-preview__label">
            <Icon name="eye" /> Preview · {SCOPE_META[scope].label}
          </span>
          {scope === 'TABLE' || scope === 'PLAYER' ? (
            <div className="acr-broadcast-notice">
              <span className="acr-broadcast-notice__from">
                <Icon name="message" /> Message from the tournament staff
              </span>
              <p>{trimmed || <span className="acr-broadcast-dim">Your message appears here.</span>}</p>
            </div>
          ) : (
            <div className="acr-broadcast-banner">
              <span className="acr-broadcast-banner__from">Announcement</span>
              <p>{trimmed || <span className="acr-broadcast-dim">Your message appears here.</span>}</p>
            </div>
          )}
        </div>

        <div className="acr-broadcast-actions">
          <span className="acr-broadcast-dim acr-broadcast-recipients">
            <Icon name={SCOPE_META[scope].icon} /> {recipients}
          </span>
          <Button type="submit" variant="primary" icon="message" disabled={!canSend || (touched && problem !== null)} loading={sending} loadingLabel="Waiting for confirmation…">
            Send…
          </Button>
        </div>
      </form>
    </Panel>
  );
}
