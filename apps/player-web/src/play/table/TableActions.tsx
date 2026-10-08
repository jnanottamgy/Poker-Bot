import { useCallback, useEffect, useState } from 'react';
import type { JpbClient } from '@jpb/client-sdk';
import { useGameState } from '@jpb/client-sdk/react';
import type { PlayerActionIntent, PlayerTableView } from '@jpb/shared-types';
import { ActionPanel, Icon, Spinner } from '@jpb/ui';
import { useSettings } from '../../settings/SettingsContext';
import { actionErrorMessage } from './actionMessages';
import { heroTurn } from './tableModel';

const ERROR_VISIBLE_MS = 6_000;

/**
 * The hero's decision controls. Sends intentions only — the action carries
 * the server's turnVersion as tableStateVersion — and is never optimistic:
 * "Submitting…" stays until the server's action_result, and the table always
 * renders the latest server view.
 */
export function TableActions({ client, view, live }: { client: JpbClient; view: PlayerTableView; live: boolean }) {
  const pending = useGameState(client, (s) => s.pendingAction);
  const { vibrate } = useSettings();
  const [error, setError] = useState<string | null>(null);
  const turn = heroTurn(view);
  const turnVersion = turn?.turnVersion ?? null;
  const isPending = pending !== null && pending.tableId === view.tableId;

  useEffect(() => {
    if (!error) return undefined;
    const id = setTimeout(() => setError(null), ERROR_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [error]);

  const onAction = useCallback(
    (intent: PlayerActionIntent) => {
      if (turnVersion === null) return;
      setError(null);
      void client
        .act({
          tableId: view.tableId,
          type: intent.type,
          ...(intent.amount !== undefined ? { amount: intent.amount } : {}),
          tableStateVersion: turnVersion,
        })
        .then((outcome) => {
          const message = actionErrorMessage(outcome);
          if (message) {
            setError(message);
            vibrate('warning');
          }
        });
    },
    [client, view.tableId, turnVersion, vibrate],
  );

  return (
    <div className="pw-actions">
      <div className="pw-actions__float" aria-hidden={isPending ? true : undefined}>
        {isPending && (
          <p className="pw-pill pw-pill--info">
            <Spinner size="sm" /> Submitting…
          </p>
        )}
        {!isPending && error && (
          <p className="pw-pill pw-pill--warning" role="alert">
            <Icon name="warning" /> {error}
          </p>
        )}
      </div>
      {live ? (
        <ActionPanel legal={turn?.legal ?? null} bigBlind={view.blinds.bigBlind} onAction={onAction} decisionKey={turnVersion} pending={isPending} />
      ) : (
        <div className="jpb-actions is-idle pw-actions__offline">
          <p className="jpb-actions__idle" role="status">
            <Icon name="wifi-off" /> Not live — actions resume when you reconnect.
          </p>
        </div>
      )}
    </div>
  );
}
