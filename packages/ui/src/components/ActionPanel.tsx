import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LegalActions, PlayerActionIntent } from '@jpb/shared-types';
import {
  aggressiveKind,
  allInTotal,
  canSize,
  clampTo,
  intentForAmount,
  isCallAllIn,
  passiveLabel,
  raisePresets,
  sizedActionLabel,
  snapTo,
} from '../actionLogic';
import { cx } from '../cx';
import { formatChips, formatPercent } from '../format';
import { Button } from './Button';
import { IconButton } from './IconButton';

export interface ActionPanelProps {
  /** Server-computed legal actions. Null = not your turn (panel shows a quiet waiting state). */
  legal: LegalActions | null;
  /** Current big blind: base for unopened bet presets and slider/stepper increments. */
  bigBlind: number;
  /** Called once per decision. The panel locks itself until `legal` changes or `pending` goes true -> false. */
  onAction: (intent: PlayerActionIntent) => void;
  /** An action is in flight (awaiting the server). Everything is disabled and shows "Submitting…". */
  pending?: boolean;
  /** Require a second tap before any all-in. Default false. */
  confirmAllIn?: boolean;
  /** Listen for F / C / R / A (and Enter / Esc in the sizer) on the window. Default true. */
  keyboardShortcuts?: boolean;
  /** Show the key hints on buttons (hidden automatically on touch devices). Default true. */
  showShortcutHints?: boolean;
  className?: string;
}

type Mode = 'main' | 'sizing' | 'confirm-allin';
type Slot = 'fold' | 'passive' | 'aggressive' | 'sized' | 'allin';

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/**
 * The player's decision controls, driven ONLY by `legal`:
 *
 * - FOLD                       when canFold
 * - CHECK or "CALL 500"        canCheck / canCall (call that puts you all-in is labelled ALL-IN)
 * - BET / RAISE                opens the sizer (slider + number input + presets)
 *                              when a range exists (minTo < maxTo)
 * - ALL-IN 2,400               when all-in is the only aggressive option
 *
 * Presets: see `raisePresets` (base = current bet, or big blind when unopened;
 * every value clamped to [minTo, maxTo]). Picking the maximum sends ALL_IN.
 * Keyboard: F fold, C check/call, R bet/raise (Enter confirms, Esc cancels),
 * A all-in. Shortcuts never fire while typing in a field or with modifiers.
 */
export function ActionPanel({
  legal,
  bigBlind,
  onAction,
  pending = false,
  confirmAllIn = false,
  keyboardShortcuts = true,
  showShortcutHints = true,
  className,
}: ActionPanelProps) {
  const [mode, setMode] = useState<Mode>('main');
  const [amount, setAmount] = useState(legal?.minTo ?? 0);
  const [draft, setDraft] = useState(String(legal?.minTo ?? 0));
  const [submitted, setSubmitted] = useState<Slot | null>(null);
  const lockRef = useRef(false);
  const wasPending = useRef(pending);

  // New decision from the server: reset everything.
  useEffect(() => {
    lockRef.current = false;
    setSubmitted(null);
    setMode('main');
    setAmount(legal?.minTo ?? 0);
    setDraft(String(legal?.minTo ?? 0));
  }, [legal]);

  // Server answered (pending true -> false) without a new decision, e.g. a rejection: unlock.
  useEffect(() => {
    if (wasPending.current && !pending) {
      lockRef.current = false;
      setSubmitted(null);
    }
    wasPending.current = pending;
  }, [pending]);

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
  const allInOnly = legal ? !sizable && legal.canAllIn : false;

  const requestAllIn = useCallback(
    (slot: Slot) => {
      if (!legal || !legal.canAllIn) return;
      if (confirmAllIn && mode !== 'confirm-allin') {
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
      if (intent.type === 'ALL_IN') requestAllIn('sized');
      else send(intent, 'sized');
    },
    [legal, requestAllIn, send],
  );

  const doPassive = useCallback(() => {
    if (!legal) return;
    if (legal.canCheck) send({ type: 'CHECK' }, 'passive');
    else if (legal.canCall) send({ type: 'CALL' }, 'passive');
  }, [legal, send]);

  const openSizer = useCallback(() => {
    if (!legal) return;
    if (sizable) {
      setMode('sizing');
      setAmount(legal.minTo);
      setDraft(String(legal.minTo));
    } else if (legal.canAllIn) {
      requestAllIn('allin');
    }
  }, [legal, sizable, requestAllIn]);

  const setTo = useCallback(
    (to: number) => {
      if (!legal) return;
      const v = clampTo(to, legal);
      setAmount(v);
      setDraft(String(v));
    },
    [legal],
  );

  // Global keyboard shortcuts.
  useEffect(() => {
    if (!keyboardShortcuts || !legal) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (busy) return;
      const key = e.key.toLowerCase();
      if (mode === 'sizing') {
        if (key === 'enter') {
          e.preventDefault();
          submitSized(amount);
        } else if (key === 'escape') {
          e.preventDefault();
          setMode('main');
        }
        return;
      }
      if (mode === 'confirm-allin') {
        if (key === 'enter' || key === 'a') {
          e.preventDefault();
          send({ type: 'ALL_IN' }, 'allin');
        } else if (key === 'escape') {
          e.preventDefault();
          setMode('main');
        }
        return;
      }
      if (key === 'f' && legal.canFold) {
        e.preventDefault();
        send({ type: 'FOLD' }, 'fold');
      } else if (key === 'c' && (legal.canCheck || legal.canCall)) {
        e.preventDefault();
        doPassive();
      } else if ((key === 'r' || key === 'b') && (kind !== null || legal.canAllIn)) {
        e.preventDefault();
        openSizer();
      } else if (key === 'a' && legal.canAllIn) {
        e.preventDefault();
        requestAllIn('allin');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardShortcuts, legal, busy, mode, amount, kind, send, doPassive, openSizer, requestAllIn, submitSized]);

  if (!legal) {
    return (
      <div className={cx('jpb-actions', 'is-idle', className)} role="group" aria-label="Your actions">
        <p className="jpb-actions__idle">Waiting for your turn…</p>
      </div>
    );
  }

  const hint = (k: string): string | undefined => (showShortcutHints && keyboardShortcuts ? k : undefined);
  const presets = raisePresets(legal, bigBlind);
  const passive = passiveLabel(legal);
  const callAllIn = isCallAllIn(legal);
  const step = Math.max(1, bigBlind);
  const snap = Math.max(1, Math.floor(bigBlind / 2));
  const adds = Math.max(0, amount - legal.contributedThisStreet);
  const potPct = legal.pot > 0 ? formatPercent(adds / legal.pot) : null;
  const loading = (slot: Slot): boolean => submitted === slot;

  const commitDraft = (): number => {
    const parsed = Number(draft.replace(/[^\d]/g, ''));
    const v = clampTo(Number.isFinite(parsed) && draft.trim() !== '' ? parsed : amount, legal);
    setAmount(v);
    setDraft(String(v));
    return v;
  };

  const onDraftKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitSized(commitDraft());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setMode('main');
    }
  };

  return (
    <div className={cx('jpb-actions', busy && 'is-busy', `is-${mode}`, className)} role="group" aria-label="Your actions">
      {pending && submitted === null && (
        <p className="jpb-actions__status" role="status">
          Submitting…
        </p>
      )}

      {mode === 'sizing' && (
        <div className="jpb-sizer" role="group" aria-label={kind === 'RAISE' ? 'Raise amount' : 'Bet amount'}>
          <div className="jpb-sizer__head">
            <span className="jpb-sizer__kind">{amount >= legal.maxTo && legal.canAllIn ? 'ALL-IN' : kind === 'RAISE' ? 'RAISE TO' : 'BET'}</span>
            <output className="jpb-sizer__amount jpb-num" aria-live="polite">
              {formatChips(amount)}
            </output>
            <span className="jpb-sizer__meta">
              Adds <span className="jpb-num">{formatChips(adds)}</span>
              {potPct && <> · {potPct} of pot</>}
            </span>
          </div>
          <div className="jpb-sizer__presets">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                className={cx('jpb-preset', amount === p.to && 'is-active', p.id === 'allin' && 'jpb-preset--allin')}
                aria-pressed={amount === p.to}
                aria-label={`${p.label}: ${formatChips(p.to)}${p.clamped ? ' (limited by table rules)' : ''}`}
                disabled={busy}
                onClick={() => setTo(p.to)}
              >
                <span className="jpb-preset__label">{p.label}</span>
                <span className="jpb-preset__value jpb-num">{formatChips(p.to)}</span>
              </button>
            ))}
          </div>
          <div className="jpb-sizer__controls">
            <IconButton icon="minus" label={`Decrease by ${formatChips(step)}`} variant="secondary" size="lg" disabled={busy || amount <= legal.minTo} onClick={() => setTo(amount - step)} />
            <input
              type="range"
              className="jpb-slider"
              min={legal.minTo}
              max={legal.maxTo}
              step={1}
              value={amount}
              disabled={busy}
              aria-label={`${kind === 'RAISE' ? 'Raise to' : 'Bet'} amount`}
              aria-valuetext={`${formatChips(amount)} chips`}
              onChange={(e) => setTo(snapTo(Number(e.target.value), legal, snap))}
              style={{ '--jpb-fill': `${((amount - legal.minTo) / Math.max(1, legal.maxTo - legal.minTo)) * 100}%` } as CSSProperties}
            />
            <IconButton icon="plus" label={`Increase by ${formatChips(step)}`} variant="secondary" size="lg" disabled={busy || amount >= legal.maxTo} onClick={() => setTo(amount + step)} />
            <input
              type="text"
              inputMode="numeric"
              className="jpb-input jpb-sizer__input jpb-num"
              aria-label={`Exact amount, ${formatChips(legal.minTo)} to ${formatChips(legal.maxTo)}`}
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={onDraftKey}
            />
          </div>
          <p className="jpb-sizer__range">
            Min <span className="jpb-num">{formatChips(legal.minTo)}</span> · Max <span className="jpb-num">{formatChips(legal.maxTo)}</span>
          </p>
        </div>
      )}

      {mode === 'confirm-allin' && (
        <div className="jpb-actions__confirm" role="alertdialog" aria-label="Confirm all-in">
          <p>
            Go <strong>ALL-IN</strong> for <span className="jpb-num">{formatChips(allInTotal(legal))}</span>?
          </p>
        </div>
      )}

      <div className="jpb-actions__row">
        {mode === 'main' && (
          <>
            {legal.canFold && (
              <Button variant="secondary" size="lg" className="jpb-act jpb-act--fold" disabled={busy} loading={loading('fold')} shortcut={hint('F')} onClick={() => send({ type: 'FOLD' }, 'fold')}>
                FOLD
              </Button>
            )}
            {passive && (
              <Button variant="secondary" size="lg" className="jpb-act jpb-act--call" disabled={busy} loading={loading('passive')} shortcut={hint('C')} onClick={doPassive}>
                {passive}
                {callAllIn && <span className="jpb-act__sub"> ALL-IN</span>}
              </Button>
            )}
            {sizable && kind && (
              <Button variant="primary" size="lg" className="jpb-act jpb-act--raise" disabled={busy} shortcut={hint('R')} onClick={openSizer}>
                {kind}
              </Button>
            )}
            {allInOnly && (
              <Button variant="primary" size="lg" className="jpb-act jpb-act--allin" disabled={busy} loading={loading('allin')} shortcut={hint('A')} onClick={() => requestAllIn('allin')}>
                {`ALL-IN ${formatChips(allInTotal(legal))}`}
              </Button>
            )}
          </>
        )}
        {mode === 'sizing' && (
          <>
            <Button variant="ghost" size="lg" className="jpb-act jpb-act--back" disabled={busy} shortcut={hint('Esc')} onClick={() => setMode('main')}>
              Back
            </Button>
            <Button variant="primary" size="lg" className="jpb-act jpb-act--confirm" loading={loading('sized')} disabled={busy} shortcut={hint('↵')} onClick={() => submitSized(amount)}>
              {sizedActionLabel(legal, amount)}
            </Button>
          </>
        )}
        {mode === 'confirm-allin' && (
          <>
            <Button variant="ghost" size="lg" className="jpb-act jpb-act--back" disabled={busy} onClick={() => setMode('main')}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="jpb-act jpb-act--confirm"
              loading={loading('allin') || loading('sized')}
              disabled={busy}
              onClick={() => send({ type: 'ALL_IN' }, 'allin')}
            >
              CONFIRM ALL-IN
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
