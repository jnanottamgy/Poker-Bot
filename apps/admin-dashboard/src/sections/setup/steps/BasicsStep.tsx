import { Badge, Button, TextField, Toggle } from '@jpb/ui';
import { CONFIG_LIMITS, codePointLength } from '@jpb/validation';
import { formatDateTime, formatDuration } from '../../../lib/time';
import { useWizard } from '../components/context';
import { DateTimeField, useFieldIssue } from '../components/fields';
import { Group, Note } from '../components/Group';
import { deriveJoinCode, newJoinCodeSuffix } from '../model/draft';
import { isNum } from '../model/format';

/** Step 1 — name, join code (automatic, editable), scheduled start and auto-start. */
export function BasicsStep({ now }: { now: number }) {
  const { config, meta, update, setMeta, env, goToStep } = useWizard();
  const name = useFieldIssue('name');
  const code = useFieldIssue('joinCode');
  const nameLength = codePointLength(config.name.trim());
  const start = config.startTime;
  const startsIn = start !== null && isNum(start) ? start - now : null;
  const liveCodeDiffers = env.liveJoinCode !== null && env.liveJoinCode !== config.joinCode.trim().toUpperCase();

  const setName = (value: string) => update((c) => ({ ...c, name: value, joinCode: meta.joinCodeAuto ? deriveJoinCode(value, meta.joinCodeSuffix) : c.joinCode }));
  const regenerate = () => {
    const suffix = newJoinCodeSuffix();
    setMeta({ joinCodeAuto: true, joinCodeSuffix: suffix });
    update((c) => ({ ...c, joinCode: deriveJoinCode(c.name, suffix) }));
  };

  return (
    <>
      <Group title="Identity" icon="file" description="What players, the big screen and reports call this tournament.">
        <div className="acr-setup-grid acr-setup-grid--2">
          <TextField
            id={name.id}
            label="Tournament name"
            required
            value={config.name}
            error={name.error}
            hint={`${nameLength} / ${CONFIG_LIMITS.NAME_MAX_LENGTH} characters`}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
          <div className="acr-setup-joincode">
            <TextField
              id={code.id}
              label="Join code"
              required
              value={config.joinCode}
              error={code.error}
              className="acr-setup-joincode__field"
              hint={meta.joinCodeAuto ? 'Automatic: follows the name. Type to set your own.' : '4–12 letters A–Z or digits. Players type it or scan the QR.'}
              onChange={(e) => {
                setMeta({ joinCodeAuto: false });
                update((c) => ({ ...c, joinCode: e.target.value.toUpperCase().replace(/\s+/g, '') }));
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="acr-setup-joincode__side">
              {meta.joinCodeAuto ? <Badge tone="positive">AUTO</Badge> : <Badge>CUSTOM</Badge>}
              <Button size="sm" variant="ghost" icon="refresh" onClick={regenerate}>
                {meta.joinCodeAuto ? 'New code' : 'Automatic'}
              </Button>
            </div>
          </div>
        </div>
        <p className="acr-setup-joinurl">
          Join link: <span className="jpb-mono">…/join/{config.joinCode.trim().toUpperCase() || '—'}</span>
        </p>
        {liveCodeDiffers && (
          <Note tone="warning">
            Players currently join with <strong className="jpb-mono">{env.liveJoinCode}</strong> (the code the server assigned to this tournament). Changing the code here
            is saved in the configuration but does not change the QR code.
          </Note>
        )}
        <div className="acr-setup-readonly">
          <span className="acr-setup-readonly__label">Game</span>
          <span className="acr-setup-readonly__value">No-Limit Texas Hold’em</span>
          <Badge>NLH</Badge>
        </div>
      </Group>

      <Group title="Start" icon="clock" description="Optional. Without a scheduled start the director starts the tournament from the Registration screen.">
        <div className="acr-setup-grid acr-setup-grid--2">
          <DateTimeField path="startTime" label="Scheduled start" value={start} onChange={(v) => update((c) => ({ ...c, startTime: v, autoStart: v === null ? false : c.autoStart }))} />
          <div className="acr-setup-stack">
            <Toggle
              id="setup-f-autoStart"
              checked={config.autoStart}
              onChange={(v) => update((c) => ({ ...c, autoStart: v }))}
              label="Start automatically"
              description="At the scheduled time, once registration has closed."
            />
          </div>
        </div>
        {startsIn !== null && startsIn > 0 && (
          <Note icon="clock">
            Starts {formatDateTime(start!)} — in {formatDuration(startsIn)}.
          </Note>
        )}
        {startsIn !== null && startsIn <= 0 && <Note tone="warning">The scheduled start is in the past.</Note>}
        {config.autoStart && config.registrationDeadline === null && (
          <Note tone="warning">
            Auto-start waits for registration to close. Set a{' '}
            <button type="button" className="acr-setup-linkbtn" onClick={() => goToStep('registration')}>
              registration deadline
            </button>{' '}
            or close registration by hand before the start time.
          </Note>
        )}
      </Group>
    </>
  );
}
