import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TournamentConfig } from '@jpb/shared-types';
import { ApiError } from '@jpb/client-sdk';
import { jsonEqual } from '@jpb/validation';
import type { ValidationIssue } from '@jpb/validation';
import type { UpdateOptions, WizardContextValue, WizardEnv } from './components/context';
import { configChanges } from './model/diff';
import type { ConfigChange } from './model/diff';
import type { DraftMeta, WizardDraft } from './model/draft';
import { ancestorPaths, fieldDomId, serverIssue, toWizardIssues, validateDraft } from './model/issues';
import type { WizardIssue } from './model/issues';
import type { StepId } from './model/steps';
import { clearDraft, saveDraft } from './model/storage';

/** Debounce of sessionStorage writes while typing. */
const PERSIST_DELAY_MS = 300;
/** Attempts (one per frame-ish tick) to find a field after switching step / scrolling a virtual list. */
const FOCUS_ATTEMPTS = 12;
const FOCUS_RETRY_MS = 25;
/** Arrays edited in virtualized lists: only visible rows exist in the DOM. */
const VIRTUAL_ARRAYS = ['blindSchedule', 'prizeStructure.places'] as const;

const EMPTY: WizardIssue[] = [];

export interface UndoEntry {
  label: string;
  config: TournamentConfig;
}

/** Problems the server reported on save, attached to their fields (cleared on the next edit). */
export function issuesFromError(err: unknown, config: TournamentConfig): WizardIssue[] {
  if (!(err instanceof ApiError)) return [];
  if (err.code === 'JOIN_CODE_TAKEN') return [serverIssue(['joinCode'], err.message || 'Another tournament already uses that join code.')];
  if ((err.code === 'INVALID_CONFIG' || err.code === 'INVALID_INPUT') && Array.isArray(err.details)) {
    const raw = (err.details as Array<Partial<ValidationIssue>>).filter((d) => typeof d === 'object' && d !== null && typeof d.message === 'string');
    return toWizardIssues(
      raw.map((d) => ({ path: d.path ?? '', segments: d.segments ?? [], code: d.code ?? 'custom', message: d.message!, text: d.text ?? d.message! })),
      'server',
      config,
    );
  }
  return [];
}

function focusField(path: string, segments: WizardIssue['segments'], attempt = 0): void {
  const candidates = [path, ...ancestorPaths(segments)];
  const exact = document.getElementById(fieldDomId(path));
  if (!exact && attempt < FOCUS_ATTEMPTS) {
    setTimeout(() => focusField(path, segments, attempt + 1), FOCUS_RETRY_MS);
    return;
  }
  const el = exact ?? candidates.map((p) => document.getElementById(fieldDomId(p))).find((x) => x !== null) ?? document.getElementById('setup-step-title');
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

export interface WizardStateInit {
  draft: WizardDraft;
  /** Edit mode: the configuration saved on the server when editing started. */
  base: TournamentConfig | null;
  storageKey: string;
  env: WizardEnv;
  readOnly?: boolean;
}

/**
 * The wizard's state machine: the draft (config + UI meta + step), server
 * issues from the last save, a one-level undo for bulk changes, session
 * persistence and field focusing for issue links.
 */
export function useWizardState({ draft: initialDraft, base: initialBase, storageKey, env, readOnly = false }: WizardStateInit) {
  const [draft, setDraft] = useState(initialDraft);
  const [base, setBase] = useState(initialBase);
  const [serverIssues, setServerIssues] = useState<WizardIssue[]>(EMPTY);
  const [undo, setUndo] = useState<UndoEntry | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const draftRef = useRef(draft);
  /** Set once the draft has been created on the server: nothing may be written back afterwards. */
  const persistOff = useRef(false);
  const scrollers = useRef(new Map<string, (index: number) => void>());

  const commit = useCallback((next: WizardDraft) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const update = useCallback(
    (fn: (c: TournamentConfig) => TournamentConfig, opts?: UpdateOptions) => {
      const prev = draftRef.current;
      const config = fn(prev.config);
      if (config === prev.config) return;
      commit({ ...prev, config });
      setServerIssues(EMPTY);
      setUndo(opts?.undoLabel ? { label: opts.undoLabel, config: prev.config } : null);
    },
    [commit],
  );

  const setMeta = useCallback((patch: Partial<DraftMeta>) => commit({ ...draftRef.current, meta: { ...draftRef.current.meta, ...patch } }), [commit]);

  const goToStep = useCallback(
    (step: StepId) => {
      if (draftRef.current.step !== step) commit({ ...draftRef.current, step });
      setTimeout(() => document.getElementById('setup-step-title')?.focus({ preventScroll: false }), 0);
    },
    [commit],
  );

  const goToIssue = useCallback(
    (issue: Pick<WizardIssue, 'path' | 'segments' | 'step'>) => {
      if (draftRef.current.step !== issue.step) commit({ ...draftRef.current, step: issue.step });
      setTimeout(() => {
        for (const arrayPath of VIRTUAL_ARRAYS) {
          const depth = arrayPath.split('.').length;
          const index = issue.segments[depth];
          if (issue.path.startsWith(`${arrayPath}[`) && typeof index === 'number') scrollers.current.get(arrayPath)?.(index);
        }
        focusField(issue.path, issue.segments);
      }, 0);
    },
    [commit],
  );

  const registerScroller = useCallback((arrayPath: string, scroll: (index: number) => void) => {
    scrollers.current.set(arrayPath, scroll);
    return () => {
      if (scrollers.current.get(arrayPath) === scroll) scrollers.current.delete(arrayPath);
    };
  }, []);

  const validation = useMemo(() => validateDraft(draft.config, serverIssues), [draft.config, serverIssues]);
  const changes: ConfigChange[] | null = useMemo(() => (base ? configChanges(base, draft.config) : null), [base, draft.config]);
  const changedSteps = useMemo(() => new Set((changes ?? []).map((c) => c.step)), [changes]);
  const dirty = changes === null ? true : changes.length > 0;

  // Keep the in-progress draft in this tab (create: always; edit: only while it differs from the server).
  useEffect(() => {
    if (readOnly) return undefined;
    const t = setTimeout(() => {
      if (persistOff.current) return;
      if (!dirty) {
        clearDraft(storageKey);
        setStorageOk(true);
        return;
      }
      setStorageOk(saveDraft(storageKey, draft, base, Date.now()));
    }, PERSIST_DELAY_MS);
    return () => clearTimeout(t);
  }, [draft, base, dirty, storageKey, readOnly]);

  const issuesAt = useCallback((path: string) => validation.byPath.get(path) ?? EMPTY, [validation]);

  const context: WizardContextValue = useMemo(
    () => ({ draft, config: draft.config, meta: draft.meta, readOnly, env, validation, update, setMeta, issuesAt, goToIssue, goToStep, registerScroller }),
    [draft, readOnly, env, validation, update, setMeta, issuesAt, goToIssue, goToStep, registerScroller],
  );

  return {
    context,
    draft,
    base,
    validation,
    changes,
    changedSteps,
    dirty,
    undo,
    storageOk,
    /** Replaces the whole draft (start over, copy from another tournament, discard). */
    replaceDraft: (next: WizardDraft, undoLabel?: string) => {
      const prev = draftRef.current;
      commit({ ...next, step: next.step });
      setServerIssues(EMPTY);
      setUndo(undoLabel ? { label: undoLabel, config: prev.config } : null);
    },
    applyUndo: () => {
      if (!undo) return;
      commit({ ...draftRef.current, config: undo.config });
      setUndo(null);
    },
    dismissUndo: () => setUndo(null),
    /** The draft now lives on the server (create): forget the session copy for good. */
    forgetStoredDraft: () => {
      persistOff.current = true;
      clearDraft(storageKey);
    },
    /** After a successful save in edit mode: the saved config becomes the new base. */
    markSaved: (saved: TournamentConfig) => {
      setBase(saved);
      clearDraft(storageKey);
    },
    /** Server configuration changed meanwhile (edit mode). */
    syncBase: (server: TournamentConfig, adoptServer: boolean) => {
      setBase(server);
      if (adoptServer) commit({ ...draftRef.current, config: structuredClone(server) });
    },
    reportSaveError: (err: unknown) => setServerIssues(issuesFromError(err, draftRef.current.config)),
    sameAsBase: (server: TournamentConfig) => base !== null && jsonEqual(server, base),
  };
}

export type WizardState = ReturnType<typeof useWizardState>;
