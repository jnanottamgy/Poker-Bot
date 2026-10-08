import { useState } from 'react';
import { Button, Icon } from '@jpb/ui';
import { Screen } from '../../components/Screen';

/** A second tab/phone opened the seat: ask before taking control (spec §70). */
export function AnotherDeviceScreen({ onTakeover }: { onTakeover: () => void }) {
  const [declined, setDeclined] = useState(false);
  if (declined) {
    return <Screen eyebrow="Playing elsewhere" title="You can close this tab" lede="Your seat stays on the other device. Open this page again any time to switch back." icon={<Icon name="phone" />} tone="info" />;
  }
  return (
    <Screen
      eyebrow="Another device is connected"
      title="Continue on this device?"
      lede="Your seat is open in another tab or on another phone. Only one device can play at a time — if you continue here, the other one stops updating."
      icon={<Icon name="phone" />}
      tone="info"
      role="alert"
      actions={
        <>
          <Button variant="primary" size="xl" block onClick={onTakeover}>
            Continue on this device
          </Button>
          <Button variant="ghost" size="lg" block onClick={() => setDeclined(true)}>
            Keep playing on the other device
          </Button>
        </>
      }
    />
  );
}

/** This socket lost control to another device. Nothing on screen is live. */
export function SessionReplacedScreen({ onUseThisDevice }: { onUseThisDevice: () => void }) {
  return (
    <Screen
      eyebrow="Open on another device"
      title="This screen is no longer live"
      lede="Your seat moved to another tab or device. Your chips are safe — the tournament continues on the server."
      icon={<Icon name="phone" />}
      tone="warning"
      role="alert"
      actions={
        <Button variant="primary" size="xl" block onClick={onUseThisDevice}>
          Use this device
        </Button>
      }
    />
  );
}
