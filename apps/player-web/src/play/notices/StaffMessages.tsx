import { useEffect, useRef } from 'react';
import type { JpbClient } from '@jpb/client-sdk';
import { useGameState } from '@jpb/client-sdk/react';
import type { PlayerNotice } from '@jpb/shared-types';
import { Alert, Button } from '@jpb/ui';
import { useSettings } from '../../settings/SettingsContext';

type MessageNotice = Extract<PlayerNotice, { kind: 'MESSAGE' }>;

export function staffMessageTitle(from: MessageNotice['from']): string {
  return from === 'DIRECTOR' ? 'Message from the tournament director' : 'Message from tournament staff';
}

/**
 * Private staff messages (PlayerNotice MESSAGE: an admin "notice" or a
 * player/table-scoped announcement). Shown in the banner area — never over
 * the action buttons — and kept until the player taps "Got it". The text is
 * rendered as plain text (React escapes it), never as HTML.
 */
export function StaffMessages({ client }: { client: JpbClient }) {
  const notices = useGameState(client, (s) => s.notices);
  const { vibrate } = useSettings();
  const cued = useRef<PlayerNotice | null>(null);
  const messages = notices.filter((n): n is MessageNotice => n.kind === 'MESSAGE');
  const latest = messages[messages.length - 1] ?? null;

  useEffect(() => {
    if (!latest || cued.current === latest) return;
    cued.current = latest;
    vibrate('warning');
  }, [latest, vibrate]);

  if (messages.length === 0) return null;
  const first = messages[0] as MessageNotice;
  const dismiss = () => {
    const i = client.store.getState().notices.indexOf(first);
    if (i >= 0) client.store.dismissNotice(i);
  };
  return (
    <div className="pw-banner pw-staffmsg">
      <Alert
        severity="INFO"
        title={staffMessageTitle(first.from)}
        meta={messages.length > 1 ? `${messages.length - 1} more message${messages.length > 2 ? 's' : ''}` : undefined}
        actions={
          <Button variant="secondary" size="sm" onClick={dismiss}>
            Got it
          </Button>
        }
      >
        <span className="pw-staffmsg__text">{first.text}</span>
      </Alert>
    </div>
  );
}
