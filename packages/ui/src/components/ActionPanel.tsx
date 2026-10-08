import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import type { LegalActions, PlayerActionIntent } from '@jpb/shared-types';
import {
  aggressiveKind,
  allInIsJustACall,
  allInTotal,
  canSize,
  clampTo,
  duplicateOf,
  intentForAmount,
  isCallAllIn,
  passiveLabel,
  raisePresets,
  sizedActionLabel,
  snapTo,
} from '../actionLogic';
import { cx } from '../cx';
import { formatChips } from '../format';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Spinner } from './Spinner';

export interface ActionPanelProps {
  /** Server-computed legal actions. Null = not your turn (panel keeps its size and shows a waiting state). */
  legal: LegalActions | null;
  /** Current big blind: base for unopened bet presets and slider/stepper increments. */
  bigBlind: number;
  /** Called once per decision. The panel locks itself until the decision changes or `pending` goes true -> false. */
  onAction: (intent: PlayerActionIntent) => void;
  /**
   * Identity of the decision (pass `PublicHandView.turnVersion`). The panel resets
   * only when this changes. Without it the panel compares `legal` by content, so
   * an unrelated table_update that re-sends identical LegalActions never closes
   * the sizer or drops the chosen amount.
   */
  decisionKey?: string | number | null;
  /** An action is in flight (awaiting the server). Everything is disabled. */
  pending?: boolean;
  /** Require a second, explicit confirmation before any all-in (including a call that commits the whole stack). Default false. */
  confirmAllIn?: boolean;
  /** Listen for F / C / R / A (and Enter / Esc in the sizer) on the window. Default true. */
  keyboardShortcuts?: boolean;
  /** Show the key hints on buttons (hidden automatically when the panel is narrow). Default true. */
  showShortcutHints?: boolean;
  className?: string;
}

type Mode = 'main' | 'sizing' | 'confirm-allin';
type Slot = 'fold' | 'passive' | 'aggressive' | 'sized' | 'allin';

/** Verb over amount, so "CALL 1,250,000" never truncates on a phone. */
function ActLabel({ verb, amount, loading }: { verb: string; amount: ReactNode; loading?: boolean }) {
  return (
    <span className="jpb-act__stack" aria-hidden="true">
      <span className="jpb-act__verb">
        {loading && <Spinner size="sm" className="jpb-act__spin" />}
        {verb}
      </span>
      {amount !== null && <span className="jpb-act__amt jpb-num">{amount}</span>}
    </span>
  );
}

const NON_TEXT_INPUTS = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset'];

/** Only text-like fields swallow shortcuts; a range slider still gets Enter / Esc. */
function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.includes((t as HTMLInputElement).type);
  return tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

const CONTROL_SELECTOR = 'button, a[href], select, [role="button"], [role="switch"], [role="tab"]';
const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';

/** Parse a typed amount strictly: whole chips only ("1,500" ok; "1500.50", "2.5k", "-500" rejected). */
export function parseChipInput(text: string): number | null {
  const s = text.trim().replace(/[,\s_]/g, '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * The player's decision controls, driven ONLY by `legal`:
 *
 * - FOLD                       when canFold
 * - CHECK or "CALL 500"        canCheck / canCall
 * - CALL / ALL-IN 4,200        a call that commits the whole stack: the ONLY
 *                              aggressive-looking button (going all-in would be
 *                              the same action, so no duplicate ALL-IN button)
 * - BET / RAISE                opens the sizer (slider + number input + presets)
 *                              when a range exists (minTo < maxTo)
 * - ALL-IN 2,400               when all-in is the only aggressive option
 *
 * Keyboard: F fold, C check/call, R/B open the sizer (never shoves), A all-in.
 * In the sizer Enter submits and Esc goes back. Shortcuts never fire while
 * typing in a text field, with modifiers, on key auto-repeat, while another
 * dialog has focus, or when Enter/Space lands on a focused control (that
 * control activates itself).
 */
export function ActionPanel({
  legal,
  bigBlind,
  onAction,
  decisionKey,
  pending = false,
  confirmAllIn = false,
  keyboardShortcuts = true,
  showShortcutHints = true,
  className,
}: ActionPanelProps) {
  const uid = useId();
  const [mode, setMode] = useState<Mode>('main');
  const [amount, setAmount] = useState(legal?.minTo ?? 0);
  const [draft, setDraft] = useState(formatChips(legal?.minTo ?? 0));
  const [draftNote, setDraftNote] = useState<{ text: string; error: boolean } | null>(null);
  const [armed, setArmed] = useState(false);
  const [submitted, setSubmitted] = useState<Slot | null>(null);
  const [confirmIntent, setConfirmIntent] = useState<PlayerActionIntent>({ type: 'ALL_IN' });
  const lockRef = useRef(false);
  const wasPending = useRef(pending);
  const legalRef = useRef(legal);
  legalRef.current = legal;

  const rootRef = useRef<HTMLDivElement>(null);
  const idleRef = useRef<HTMLParagraphElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const raiseBtnRef = useRef<HTMLButtonElement>(null);
  const allInBtnRef = useRef<HTMLButtonElement>(null);
  const callBtnRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<RefObject<HTMLButtonElement | null> | null>(null);
  const prevMode = useRef<Mode>('main');
  const focusWithin = useRef(false);

  // A new decision from the server resets everything. Keyed on decision
  // identity, not object identity (every server frame is a new object).
  const key = decisionKey ?? (legal ? JSON.stringify(legal) : null);
  useEffect(() => {
    const l = legalRef.current;
    lockRef.current = false;
    setSubmitted(null);
    setMode('main');
    setArmed(false);
    setDraftNote(null);
    setAmount(l?.minTo ?? 0);
    setDraft(formatChips(l?.minTo ?? 0));
  }, [key]);

  // Server answered (pending true -> false) without a new decision, e.g. a rejection: unlock.
  useEffect(() => {
    if (wasPending.current && !pending) {
      lockRef.current = false;
      setSubmitted(null);
    }
    wasPending.current = pending;
  }, [pending]);

  // Focus follows the decision: into the sizer, onto CONFIRM, back to the opener.
  useEffect(() => {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const ours = active === null || active === document.body || (rootRef.current?.contains(active) ?? false);
    if (mode === 'sizing') sliderRef.current?.focus();
    else if (mode === 'confirm-allin') confirmBtnRef.current?.focus();
    else if (prevMode.current !== 'main' && ours) openerRef.current?.current?.focus();
    prevMode.current = mode;
  }, [mode]);

  // The turn ended while focus was in the panel: keep focus in the panel (idle status), not <body>.
  const isIdle = legal === null;
  useEffect(() => {
    if (!isIdle || !focusWithin.current) return;
    const active = document.activeElement;
    if (active === null || active === document.body || rootRef.current?.contains(active)) idleRef.current?.focus();
  }, [isIdle]);

  const busy = pending || submitted !== null;

  const send = useCallback(
    (intent: PlayerActionIntent, slot: Slot) => {
      if (lockRef.current || pending) return;
      lockRef.current = true;
      setSubmitted(slot);
      onAction(intent);
    },
    [onAction, pending],
  );

  const kind = legal ? aggressiveKind(legal) : null;
  const sizable = legal ? canSize(legal) : false;
  const callAllIn = legal ? isCallAllIn(legal) : false;
  /** Going all-in would only be a call: show ONE button (the call), never two. */
  const allInRedundant = legal ? allInIsJustACall(legal) : false;
  const allInOnly = legal ? !sizable && legal.canAllIn && !allInRedundant : false;

  const requestAllIn = useCallback(
    (slot: Slot, opener: RefObject<HTMLButtonElement | null> = allInBtnRef) => {
      if (!legal || !legal.canAllIn) return;
      if (confirmAllIn && mode !== 'confirm-allin') {
        openerRef.current = opener;
        setConfirmIntent({ type: 'ALL_IN' });
        setMode('confirm-allin');
        return;
      }
      send({ type: 'ALL_IN' }, slot);
    },
    [legal, confirmAllIn, mode, send],
  );

  const submitSized = useCallback(
    (to: number) => {
      if (!legal) return;
      const intent = intentForAmount(legal, to);
      if (intent === null) return;
      if (intent.type === 'ALL_IN') requestAllIn('sized', raiseBtnRef);
      else send(intent, 'sized');
    },
    [legal, requestAllIn, send],
  );

  const doPassive = useCallback(() => {
    if (!legal) return;
    if (legal.canCheck) {
      send({ type: 'CHECK' }, 'passive');
    } else if (legal.canCall) {
      if (callAllIn && confirmAllIn && mode !== 'confirm-allin') {
        openerRef.current = callBtnRef;
        setConfirmIntent({ type: 'CALL' });
        setMode('confirm-allin');
        return;
      }
      send({ type: 'CALL' }, 'passive');
    }
  }, [legal, callAllIn, confirmAllIn, mode, send]);

  /** R / B / tapping RAISE only ever opens the sizer; A is the explicit all-in key. */
  const openSizer = useCallback(() => {
    if (!legal || !sizable) return;
    openerRef.current = raiseBtnRef;
    setMode('sizing');
    setArmed(false);
    setDraftNote(null);
    setAmount(legal.minTo);
    setDraft(formatChips(legal.minTo));
  }, [legal, sizable]);

  const setTo = useCallback(
    (to: number) => {
      if (!legal) return;
      const v = clampTo(to, legal);
      setAmount(v);
      setDraft(formatChips(v));
      setDraftNote(null);
      setArmed(false);
    },
    [legal],
  );

  const backToMain = useCallback(() => setMode('main'), []);

  // Global keyboard shortcuts.
  useEffect(() => {
    if (!keyboardShortcuts || !legal) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      // A held key auto-repeats: never let the repeat confirm or send anything.
      if (e.repeat) return;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const root = rootRef.current;
      const t = e.target instanceof Element ? e.target : null;
      // Another dialog (settings, table move, admin modal) owns the keyboard.
      const dlg = t?.closest(DIALOG_SELECTOR);
      if (dlg && !root?.contains(dlg)) return;
      if (typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]') && !root?.contains(document.activeElement)) return;
      if (busy) return;
      const key = e.key.toLowerCase();
      // Enter / Space on a focused control activates THAT control (native behaviour).
      if ((key === 'enter' || key === ' ') && t?.closest(CONTROL_SELECTOR)) return;
      if (mode === 'sizing') {
        if (key === 'enter') {
          e.preventDefault();
          submitSized(amount);
        } else if (key === 'escape') {
          e.preventDefault();
          backToMain();
        }
        return;
      }
      if (mode === 'confirm-allin') {
        // Only an explicit activation of the focused CONFIRM button confirms.
        if (key === 'escape') {
          e.preventDefault();
          backToMain();
        }
        return;
      }
      if (key === 'f' && legal.canFold) {
        e.preventDefault();
        send({ type: 'FOLD' }, 'fold');
      } else if (key === 'c' && (legal.canCheck || legal.canCall)) {
        e.preventDefault();
        doPassive();
      } else if ((key === 'r' || key === 'b') && sizable) {
        e.preventDefault();
        openSizer();
      } else if (key === 'a' && legal.canAllIn) {
        e.preventDefault();
        if (allInRedundant) doPassive();
        else requestAllIn('allin');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardShortcuts, legal, busy, mode, amount, sizable, allInRedundant, send, doPassive, openSizer, requestAllIn, submitSized, backToMain]);

  const trackFocus = {
    onFocus: () => {
      focusWithin.current = true;
    },
    onBlur: (e: ReactFocusEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focusWithin.current = false;
    },
  };

  if (!legal) {
    // Same footprint as the live panel, so nothing jumps when the turn arrives.
    return (
      <div ref={rootRef} className={cx('jpb-actions', 'is-idle', className)} role="group" aria-label="Your actions" {...trackFocus}>
        <div className="jpb-actions__row jpb-actions__ghosts" aria-hidden="true">
          <span className="jpb-act-ghost" />
          <span className="jpb-act-ghost" />
          <span className="jpb-act-ghost" />
        </div>
        <p ref={idleRef} className="jpb-actions__idle" role="status" tabIndex={-1}>
          Waiting for your turn…
        </p>
      </div>
    );
  }

  const hint = (k: string): string | undefined => (showShortcutHints && keyboardShortcuts ? k : undefined);
  const presets = raisePresets(legal, bigBlind);
  const passive = passiveLabel(legal);
  const step = Math.max(1, bigBlind);
  const snap = Math.max(1, Math.floor(bigBlind / 2));
  const adds = Math.max(0, amount - legal.contributedThisStreet);
  const potPct = legal.pot > 0 ? `${Math.round((adds / legal.pot) * 100)}%` : null;
  const sent = (slot: Slot): boolean => submitted === slot;
  const goesAllIn = amount >= legal.maxTo && legal.canAllIn;
  const range = `${formatChips(legal.minTo)}–${formatChips(legal.maxTo)}`;

  /** Blur: normalise the field. Invalid text is rejected with a message, never reinterpreted. */
  const commitDraft = (): void => {
    const parsed = parseChipInput(draft);
    if (parsed === null) {
      setDraft(formatChips(amount));
      if (draft.trim() !== '' && draft.trim() !== formatChips(amount)) setDraftNote({ text: 'Whole chips only', error: true });
      return;
    }
    const v = clampTo(parsed, legal);
    setAmount(v);
    setDraft(formatChips(v));
    setArmed(false);
    setDraftNote(v !== parsed ? { text: `Limited to ${range}`, error: false } : null);
  };

  /**
   * Enter in the field. A value that had to be clamped, or one that means
   * ALL-IN, is shown first and needs a second Enter: a typo never becomes an
   * unseen shove.
   */
  const onDraftKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      const parsed = parseChipInput(draft);
      if (parsed === null) {
        setDraft(formatChips(amount));
        setDraftNote({ text: 'Whole chips only', error: true });
        return;
      }
      const v = clampTo(parsed, legal);
      const allIn = v >= legal.maxTo && legal.canAllIn;
      if (v !== parsed || (allIn && !armed)) {
        setAmount(v);
        setDraft(formatChips(v));
        setArmed(true);
        setDraftNote({ text: `${v !== parsed ? `Adjusted to ${formatChips(v)} (${range}). ` : ''}Press Enter again to ${sizedActionLabel(legal, v)}`, error: false });
        return;
      }
      setAmount(v);
      submitSized(v);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      backToMain();
    }
  };

  /** Direction-aware snapping: a keyboard step (value ± 1) always moves at least one snap step. */
  const onSlider = (raw: number): void => {
    let next = snapTo(raw, legal, snap);
    if (raw > amount && next <= amount) next = clampTo((Math.floor(amount / snap) + 1) * snap, legal);
    else if (raw < amount && next >= amount) next = clampTo((Math.ceil(amount / snap) - 1) * snap, legal);
    setTo(next);
  };

  const onSliderKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      setTo(amount + (e.key === 'PageUp' ? step : -step));
    }
  };

  const status = busy ? 'Submitting…' : '';
  const confirmIsCall = confirmIntent.type === 'CALL';

  return (
    <div
      ref={rootRef}
      className={cx('jpb-actions', busy && 'is-busy', `is-${mode}`, className)}
      role="group"
      aria-label="Your actions"
      {...trackFocus}
    >
      <p className="jpb-sr-only" role="status">
        {status}
      </p>

      {mode === 'sizing' && (
        <div className="jpb-sizer" role="group" aria-label={kind === 'RAISE' ? 'Raise amount' : 'Bet amount'}>
          <div className="jpb-sizer__head">
            <span className={cx('jpb-sizer__kind', goesAllIn && 'is-allin')}>{goesAllIn ? 'ALL-IN' : kind === 'RAISE' ? 'RAISE TO' : 'BET'}</span>
            <output className="jpb-sizer__amount jpb-num" aria-live="polite">
              {formatChips(amount)}
            </output>
            <span className="jpb-sizer__meta">
              Adds <span className="jpb-num">{formatChips(adds)}</span>
              {potPct && <> · {potPct} of pot</>}
            </span>
          </div>
          <div className="jpb-sizer__presets">
            {presets.map((p, i) => {
              const dup = duplicateOf(presets, i);
              const same = dup >= 0 ? presets[dup] : undefined;
              const active = amount === p.to && dup < 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={cx('jpb-preset', active && 'is-active', p.id === 'allin' && 'jpb-preset--allin', same && 'is-duplicate')}
                  aria-pressed={active}
                  aria-label={`${p.label}: ${formatChips(p.to)}${p.clamped ? ' (limited by table rules)' : ''}`}
                  title={same ? `Same as ${same.label}` : undefined}
                  disabled={busy || same !== undefined}
                  onClick={() => setTo(p.to)}
                >
                  <span className="jpb-preset__label">
                    {active && <span className="jpb-preset__check" aria-hidden="true">✓ </span>}
                    {p.label}
                  </span>
                  <span className="jpb-preset__value jpb-num">{same ? `= ${same.label}` : formatChips(p.to)}</span>
                </button>
              );
            })}
          </div>
          <div className="jpb-sizer__controls">
            <IconButton icon="minus" label={`Decrease by ${formatChips(step)}`} variant="secondary" size="lg" disabled={busy || amount <= legal.minTo} onClick={() => setTo(amount - step)} />
            <input
              ref={sliderRef}
              type="range"
              className="jpb-slider"
              min={legal.minTo}
              max={legal.maxTo}
              step={1}
              value={amount}
              disabled={busy}
              aria-label={`${kind === 'RAISE' ? 'Raise to' : 'Bet'} amount`}
              aria-valuetext={`${formatChips(amount)} chips${goesAllIn ? ', all-in' : ''}`}
              onChange={(e) => onSlider(Number(e.target.value))}
              onKeyDown={onSliderKey}
              style={{ '--jpb-fill': `${((amount - legal.minTo) / Math.max(1, legal.maxTo - legal.minTo)) * 100}%` } as CSSProperties}
            />
            <IconButton icon="plus" label={`Increase by ${formatChips(step)}`} variant="secondary" size="lg" disabled={busy || amount >= legal.maxTo} onClick={() => setTo(amount + step)} />
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="jpb-input jpb-sizer__input jpb-num"
              aria-label={`Exact amount, ${formatChips(legal.minTo)} to ${formatChips(legal.maxTo)}`}
              aria-invalid={draftNote?.error ? true : undefined}
              aria-describedby={draftNote ? `${uid}-note` : undefined}
              value={draft}
              disabled={busy}
              onChange={(e) => {
                setDraft(e.target.value);
                setArmed(false);
                setDraftNote(null);
              }}
              onBlur={commitDraft}
              onKeyDown={onDraftKey}
            />
          </div>
          <p id={`${uid}-note`} className={cx('jpb-sizer__range', draftNote?.error && 'is-error')} aria-live="polite">
            {draftNote ? (
              draftNote.text
            ) : (
              <>
                Min <span className="jpb-num">{formatChips(legal.minTo)}</span> · Max <span className="jpb-num">{formatChips(legal.maxTo)}</span>
              </>
            )}
          </p>
        </div>
      )}

      {mode === 'confirm-allin' ? (
        <div className="jpb-actions__confirm" role="alertdialog" aria-modal="false" aria-labelledby={`${uid}-ct`} aria-describedby={`${uid}-cd`}>
          <h3 id={`${uid}-ct`} className="jpb-sr-only">
            Confirm all-in
          </h3>
          <p id={`${uid}-cd`} className="jpb-actions__confirmtext">
            {confirmIsCall ? (
              <>
                Call <span className="jpb-num">{formatChips(legal.callAmount)}</span> — this puts you <strong>ALL-IN</strong>?
              </>
            ) : (
              <>
                Go <strong>ALL-IN</strong> for <span className="jpb-num">{formatChips(allInTotal(legal))}</span>?
              </>
            )}
          </p>
          <div className="jpb-actions__row">
            <Button variant="ghost" size="lg" className="jpb-act jpb-act--back" disabled={busy} shortcut={hint('Esc')} onClick={backToMain}>
              Cancel
            </Button>
            <Button
              ref={confirmBtnRef}
              variant="primary"
              size="lg"
              className={cx('jpb-act', 'jpb-act--confirm', (sent('allin') || sent('passive') || sent('sized')) && 'is-sent')}
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => send(confirmIntent, confirmIsCall ? 'passive' : 'allin')}
            >
              {(sent('allin') || sent('passive') || sent('sized')) && <Spinner size="sm" className="jpb-act__spin" />}
              {confirmIsCall ? 'CONFIRM CALL ALL-IN' : 'CONFIRM ALL-IN'}
            </Button>
          </div>
        </div>
      ) : (
        <div className={cx('jpb-actions__row', mode === 'main' && allInRedundant && 'is-pair')}>
          {mode === 'main' && (
            <>
              {legal.canFold && (
                <Button
                  variant="secondary"
                  size="lg"
                  className={cx('jpb-act', 'jpb-act--fold', sent('fold') && 'is-sent')}
                  disabled={busy}
                  aria-busy={sent('fold') || undefined}
                  shortcut={hint('F')}
                  onClick={() => send({ type: 'FOLD' }, 'fold')}
                >
                  <ActLabel verb="FOLD" amount={null} loading={sent('fold')} />
                  <span className="jpb-sr-only">FOLD</span>
                </Button>
              )}
              {passive && (
                <Button
                  ref={callBtnRef}
                  variant={callAllIn ? 'primary' : 'secondary'}
                  size="lg"
                  className={cx('jpb-act', 'jpb-act--call', callAllIn && 'is-allin', sent('passive') && 'is-sent')}
                  disabled={busy}
                  aria-busy={sent('passive') || undefined}
                  shortcut={hint('C')}
                  onClick={doPassive}
                  aria-label={callAllIn ? `${passive} ALL-IN` : passive}
                >
                  <ActLabel
                    verb={legal.canCheck ? 'CHECK' : 'CALL'}
                    amount={legal.canCheck ? null : callAllIn ? `ALL-IN ${formatChips(legal.callAmount)}` : formatChips(legal.callAmount)}
                    loading={sent('passive')}
                  />
                </Button>
              )}
              {sizable && kind && (
                <Button ref={raiseBtnRef} variant="primary" size="lg" className="jpb-act jpb-act--raise" disabled={busy} shortcut={hint('R')} onClick={openSizer}>
                  <ActLabel verb={kind} amount={null} />
                  <span className="jpb-sr-only">{kind}</span>
                </Button>
              )}
              {allInOnly && (
                <Button
                  ref={allInBtnRef}
                  variant="primary"
                  size="lg"
                  className={cx('jpb-act', 'jpb-act--allin', sent('allin') && 'is-sent')}
                  disabled={busy}
                  aria-busy={sent('allin') || undefined}
                  shortcut={hint('A')}
                  onClick={() => requestAllIn('allin')}
                  aria-label={`ALL-IN ${formatChips(allInTotal(legal))}`}
                >
                  <ActLabel verb="ALL-IN" amount={formatChips(allInTotal(legal))} loading={sent('allin')} />
                </Button>
              )}
            </>
          )}
          {mode === 'sizing' && (
            <>
              <Button variant="ghost" size="lg" className="jpb-act jpb-act--back" disabled={busy} shortcut={hint('Esc')} onClick={backToMain}>
                Back
              </Button>
              <Button
                variant="primary"
                size="lg"
                className={cx('jpb-act', 'jpb-act--confirm', sent('sized') && 'is-sent')}
                disabled={busy}
                aria-busy={sent('sized') || undefined}
                shortcut={hint('↵')}
                onClick={() => submitSized(amount)}
              >
                {sent('sized') && <Spinner size="sm" className="jpb-act__spin" />}
                {sizedActionLabel(legal, amount)}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
