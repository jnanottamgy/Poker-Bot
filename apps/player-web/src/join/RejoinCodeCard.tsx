import { useEffect, useRef, useState } from 'react';
import type { RegisterResponse } from '@jpb/shared-types';
import { Button, Icon } from '@jpb/ui';

/**
 * Shown ONCE after registration: the player ID + rejoin code that recover the
 * seat on another device. Kept only in memory here — never stored by the app.
 */
export function RejoinCodeCard({ result, onContinue }: { result: RegisterResponse; onContinue: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = result.player.status === 'PENDING_APPROVAL';
  useEffect(() => heading.current?.focus(), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${result.player.publicId} ${result.rejoinCode}`);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <section className="pw-codecard" aria-labelledby="code-title">
      <p className="pw-eyebrow pw-codecard__eyebrow">
        <Icon name="check-circle" /> {pending ? 'Registration received' : "You're registered"}
      </p>
      <h1 id="code-title" ref={heading} tabIndex={-1} className="pw-codecard__title">
        Save your rejoin code
      </h1>
      <p className="pw-codecard__lede">
        This is the only time it is shown. <strong>Screenshot it</strong> or write it down — you need it to get back to your seat on another phone or if this browser forgets you.
      </p>
      <div className="pw-codecard__box" role="group" aria-label="Your rejoin details">
        <div className="pw-codecard__row">
          <span className="pw-codecard__k">Player ID</span>
          <span className="pw-codecard__v jpb-mono">{result.player.publicId}</span>
        </div>
        <div className="pw-codecard__row">
          <span className="pw-codecard__k">Rejoin code</span>
          <span className="pw-codecard__v pw-codecard__code jpb-mono" aria-label={result.rejoinCode.split('').join(' ')}>
            {result.rejoinCode}
          </span>
        </div>
        <div className="pw-codecard__row">
          <span className="pw-codecard__k">Name at the table</span>
          <span className="pw-codecard__name">{result.player.displayName}</span>
        </div>
      </div>
      <Button variant="secondary" icon={copied === 'done' ? 'check' : 'file'} onClick={copy} block>
        {copied === 'done' ? 'Copied' : 'Copy ID and code'}
      </Button>
      {copied === 'failed' && <p className="pw-hint">Copy is not available here — please take a screenshot instead.</p>}
      <label className="pw-check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I have saved my player ID and rejoin code</span>
      </label>
      <Button variant="primary" size="xl" block disabled={!saved} onClick={onContinue} iconRight="arrow-right">
        {pending ? 'Continue' : 'Go to my seat'}
      </Button>
      <p className="pw-hint">
        <Icon name="lock" /> Never share this code. Staff will never ask for it by message.
      </p>
    </section>
  );
}
