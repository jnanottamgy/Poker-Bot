import { Icon, Skeleton, Spinner } from '@jpb/ui';
import { Screen } from '../../components/Screen';

export function ConnectingScreen() {
  return (
    <Screen eyebrow="Connecting" title="Finding your seat…" lede="Getting the latest table state from the tournament server." icon={<Spinner size="lg" label="Connecting" />} role="status">
      <div className="pw-skel" aria-hidden="true">
        <Skeleton height={220} shape="block" />
        <Skeleton lines={2} />
      </div>
    </Screen>
  );
}

export function PendingScreen({ publicId }: { publicId: string }) {
  return (
    <Screen
      eyebrow="Registration received"
      title="Waiting for approval"
      lede="A tournament official will approve your entry shortly. Keep this page open — it updates by itself."
      icon={<Spinner size="lg" />}
      tone="info"
      role="status"
    >
      <p className="pw-chipline">
        Your player ID <strong className="jpb-mono">{publicId}</strong>
      </p>
    </Screen>
  );
}

export function SuspendedScreen() {
  return (
    <Screen
      eyebrow="Seat suspended"
      title="Please see a tournament official"
      lede="Your seat is on hold while staff take a look. Your chips are safe and nothing is lost while you wait."
      icon={<Icon name="pause" />}
      tone="warning"
      role="alert"
    />
  );
}

export function RemovedScreen() {
  return (
    <Screen
      eyebrow="Entry closed"
      title="You are no longer in this tournament"
      lede="If you think this is a mistake, please speak to a tournament official."
      icon={<Icon name="ban" />}
      tone="danger"
      role="alert"
    />
  );
}

export function MovingScreen() {
  return (
    <Screen eyebrow="Table change" title="Taking you to your seat…" lede="Your chips travel with you. This takes a moment." icon={<Spinner size="lg" />} role="status" />
  );
}
