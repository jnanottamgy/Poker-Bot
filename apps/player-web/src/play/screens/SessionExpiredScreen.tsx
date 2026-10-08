import { Icon } from '@jpb/ui';
import { Screen } from '../../components/Screen';
import { RejoinForm } from '../../join/RejoinForm';

/** The session cookie is gone or expired: recover the seat with the rejoin code. */
export function SessionExpiredScreen({ joinCode, onRejoined }: { joinCode: string | null; onRejoined: () => void }) {
  return (
    <Screen
      eyebrow="Session ended"
      title="Please rejoin"
      lede="Your session on this device has ended. Rejoin with your player ID and rejoin code — your chips and seat are safe on the server."
      icon={<Icon name="lock" />}
      tone="warning"
      className="pw-expired"
    >
      {joinCode ? (
        <RejoinForm joinCode={joinCode} onRejoined={onRejoined} />
      ) : (
        <p className="pw-muted">Scan the tournament QR code again, then choose “Rejoin”.</p>
      )}
    </Screen>
  );
}
