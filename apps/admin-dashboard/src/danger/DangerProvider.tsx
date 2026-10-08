import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ConfirmDialog, useToast } from '@jpb/ui';
import { useQueryClient } from '../api/ApiProvider';
import { CONFIRM_WORDS, ENDPOINTS } from '../api/endpoints';
import type { ConfirmWord } from '../api/endpoints';
import { friendlyError } from '../api/errors';
import { ConfirmActionDialog } from './ConfirmActionDialog';
import { MIN_REASON_LENGTH } from './types';
import type { DangerInput, DangerSpec } from './types';

type AnySpec = DangerSpec<unknown, ConfirmWord>;
type Runner = <R, W extends ConfirmWord = ConfirmWord>(spec: DangerSpec<R, W>) => Promise<R | undefined>;

interface Open {
  spec: AnySpec;
  resolve: (r: unknown) => void;
}

const DangerContext = createContext<Runner | null>(null);

function checkAgainstRegistry(spec: AnySpec): void {
  if (!spec.endpoint) return;
  const def = ENDPOINTS[spec.endpoint];
  if (spec.level < def.level || (def.level === 2 && spec.word !== def.word)) {
    // A developer mistake, not an operator error: the server would refuse anyway.
    console.error(`[danger] ${spec.endpoint} is level ${def.level}${def.word ? ` (${def.word})` : ''} in docs/API.md; the spec says level ${spec.level}${spec.word ? ` (${spec.word})` : ''}.`);
  }
}

/**
 * Hosts the one confirmation dialog of the app and runs dangerous actions
 * through it. Use `useDangerousAction()` — never call level-1/2 endpoints
 * straight from a click handler.
 */
export function DangerProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Open | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openRef = useRef<Open | null>(null);
  openRef.current = open;

  const finish = useCallback(
    async (spec: AnySpec, input: DangerInput, resolve: (r: unknown) => void, inDialog: boolean) => {
      setPending(true);
      setError(null);
      try {
        const result = await spec.run(input);
        for (const k of spec.invalidate ?? []) queryClient.invalidate(k);
        if (spec.success) toast.push({ tone: 'success', title: typeof spec.success === 'function' ? spec.success(result) : spec.success });
        spec.onSuccess?.(result);
        setOpen(null);
        resolve(result);
      } catch (err) {
        queryClient.reportError(err);
        const f = friendlyError(err);
        if (inDialog) setError(`${f.title}. ${f.description}`);
        else {
          toast.push({ tone: 'danger', title: f.title, description: f.description });
          resolve(undefined);
        }
      } finally {
        setPending(false);
      }
    },
    [queryClient, toast],
  );

  const run = useCallback<Runner>(
    (spec) =>
      new Promise((resolve) => {
        const s = spec as unknown as AnySpec;
        checkAgainstRegistry(s);
        if (openRef.current) {
          resolve(undefined);
          return;
        }
        if (s.level === 0) {
          void finish(s, { reason: '', confirm: s.word ?? ('' as ConfirmWord) }, resolve as (r: unknown) => void, false);
          return;
        }
        setError(null);
        setOpen({ spec: s, resolve: resolve as (r: unknown) => void });
      }),
    [finish],
  );

  const cancel = () => {
    if (pending || !open) return;
    open.resolve(undefined);
    setOpen(null);
    setError(null);
  };

  const spec = open?.spec;
  return (
    <DangerContext.Provider value={run}>
      {children}
      {spec && spec.level === 2 && (
        <ConfirmDialog
          open
          title={spec.title}
          summary={spec.summary}
          consequences={spec.consequences}
          preview={spec.preview}
          confirmWord={CONFIRM_WORDS[spec.word ?? 'EDIT']}
          minReasonLength={MIN_REASON_LENGTH}
          confirmLabel={spec.confirmLabel}
          pending={pending}
          error={error}
          onConfirm={({ reason }) => void finish(spec, { reason, confirm: CONFIRM_WORDS[spec.word ?? 'EDIT'] }, open!.resolve, true)}
          onCancel={cancel}
        />
      )}
      {spec && spec.level === 1 && (
        <ConfirmActionDialog
          open
          title={spec.title}
          summary={spec.summary}
          consequences={spec.consequences}
          reason={spec.reason ?? 'none'}
          confirmLabel={spec.confirmLabel}
          tone={spec.tone}
          pending={pending}
          error={error}
          onConfirm={(reason) => void finish(spec, { reason, confirm: '' as ConfirmWord }, open!.resolve, true)}
          onCancel={cancel}
        />
      )}
    </DangerContext.Provider>
  );
}

/**
 * The single pattern for state-changing admin actions:
 *
 *   const danger = useDangerousAction();
 *   danger({
 *     level: 2, endpoint: 'tournamentFreeze', word: 'FREEZE', title: 'Emergency freeze',
 *     consequences: [...], preview: [...],
 *     run: (d) => api.lifecycle.freeze(id, d),          // sends { reason, confirm }
 *     success: 'Tournament frozen', invalidate: [qk.tournament(id)],
 *   });
 *
 * Resolves with the API result, or undefined when cancelled / failed.
 */
export function useDangerousAction(): Runner {
  const ctx = useContext(DangerContext);
  if (!ctx) throw new Error('DangerProvider is missing');
  return useMemo(() => ctx, [ctx]);
}
