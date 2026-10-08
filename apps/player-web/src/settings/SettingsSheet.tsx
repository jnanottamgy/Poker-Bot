import { Modal, Toggle } from '@jpb/ui';
import { useSettings } from './SettingsContext';

/** Device preferences: stored on this device only. */
export function SettingsSheet() {
  const { settings, update, settingsOpen, setSettingsOpen, hapticsSupported, soundSupported } = useSettings();
  return (
    <Modal
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      title="Settings"
      description="Saved on this device only."
      placement="right"
      size="sm"
      className="pw-settings"
    >
      <div className="pw-settings__group">
        <p className="pw-eyebrow">Alerts</p>
        <Toggle
          checked={settings.sound}
          onChange={(v) => update({ sound: v })}
          label="Sound"
          description={soundSupported ? 'A short chime when it is your turn. Off by default.' : 'Sound is not available in this browser.'}
          disabled={!soundSupported}
        />
        <Toggle
          checked={settings.haptics}
          onChange={(v) => update({ haptics: v })}
          label="Vibration"
          description={hapticsSupported ? 'Buzz when it is your turn.' : 'This device does not support vibration.'}
          disabled={!hapticsSupported}
        />
      </div>
      <div className="pw-settings__group">
        <p className="pw-eyebrow">Display</p>
        <Toggle checked={settings.fourColorDeck} onChange={(v) => update({ fourColorDeck: v })} label="Four-colour deck" description="Clubs green, diamonds blue." />
        <Toggle checked={settings.highContrast} onChange={(v) => update({ highContrast: v })} label="High contrast" description="Pure black, brighter text and outlines." />
        <Toggle checked={settings.reducedMotion} onChange={(v) => update({ reducedMotion: v })} label="Reduce motion" description="No dealing or chip animations." />
      </div>
    </Modal>
  );
}
