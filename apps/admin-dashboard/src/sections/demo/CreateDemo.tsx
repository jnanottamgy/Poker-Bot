import { useId, useMemo, useState } from 'react';
import type { DemoStatusDto } from '@jpb/shared-types';
import { Button, Icon, Panel, TextField, Toggle, cx, formatCount, formatPercent, useToast } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useMutation } from '../../api/query/useMutation';
import { useDangerousAction } from '../../danger/DangerProvider';
import { DEFAULT_MIX, LARGE_DEMO, MAX_BOTS, MIN_BOTS, MIX_PRESETS, NAME_MAX, PLAYER_PRESETS, STRATEGIES, STRATEGY_META, WEIGHT_MAX, botsProblem, effectiveMix, projection, sameMix, strategyCounts, toRequest } from './model';
import type { Mix, Strategy } from './model';

/** "Create a demo" form: field size, strategy mix, speed mode — then start (L1 confirmation for large fields). */
export function CreateDemo({ onCreated, locked }: { onCreated: (d: DemoStatusDto) => void; locked: boolean }) {
  const api = useApi();
  const toast = useToast();
  const danger = useDangerousAction();
  const id = useId();
  const [players, setPlayers] = useState<number>(100);
  const [custom, setCustom] = useState('');
  const [name, setName] = useState('');
  const [mix, setMix] = useState<Mix>(DEFAULT_MIX);
  const [speed, setSpeed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation((body: ReturnType<typeof toRequest>) => api.demo.create(body), { errorToast: false, invalidate: [qk.tournamentsAll()] });

  const n = custom !== '' ? Number(custom) : players;
  const problem = botsProblem(n);
  const used = effectiveMix(mix);
  const counts = useMemo(() => (problem ? null : strategyCounts(n, used)), [n, used, problem]);
  const totalWeight = STRATEGIES.reduce((a, s) => a + used[s], 0);
  const proj = problem ? null : projection(n);
  const allZero = STRATEGIES.every((s) => mix[s] === 0);

  const start = async () => {
    if (problem || locked) return;
    setError(null);
    const body = toRequest(n, mix, speed, name);
    const label = name.trim() || `Demo · ${formatCount(n)} bots`;
    const done = (d: DemoStatusDto) => {
      toast.push({ tone: 'success', title: 'Demo started', description: `${label} · join code ${d.joinCode}` });
      onCreated(d);
    };
    if (n >= LARGE_DEMO) {
      const d = await danger({
        level: 1,
        endpoint: 'demoCreate',
        title: `Start a ${formatCount(n)}-bot demo`,
        summary: 'A real tournament is created and played by deterministic bots through the same runtime as a live event.',
        consequences: [
          `≈ ${formatCount(proj!.tables)} tables are dealt on this server — it carries the load of a real event`,
          speed ? 'Speed mode: 1-second levels and fast bots (only if the server allows it)' : 'Normal speed (HYPER structure)',
          'You can stop it at any time; stopping cancels the demo tournament',
        ],
        confirmLabel: 'Start demo',
        run: () => create.mutateAsync(body),
      });
      if (d) done(d);
      return;
    }
    try {
      done(await create.mutateAsync(body));
    } catch (err) {
      const f = friendlyError(err);
      setError(`${f.title}. ${f.description}`);
    }
  };

  const setWeight = (s: Strategy, w: number) => setMix((m) => ({ ...m, [s]: Math.max(0, Math.min(WEIGHT_MAX, Math.round(w))) }));

  return (
    <Panel title="New demo" icon="zap" description="Deterministic rule-based bots — no AI — play a real tournament you can watch like a live event." className="acr-demo-create">
      <fieldset className="acr-demo-fs" disabled={locked || create.pending}>
        <legend className="acr-demo-legend">Bots</legend>
        <div className="acr-demo-presets" role="group" aria-label="Number of bots">
          {PLAYER_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={cx('acr-demo-preset', custom === '' && players === p && 'is-on')}
              aria-pressed={custom === '' && players === p}
              onClick={() => {
                setPlayers(p);
                setCustom('');
              }}
            >
              {formatCount(p)}
            </button>
          ))}
          <TextField
            label="Custom number of bots"
            hideLabel
            className="acr-demo-custom"
            type="number"
            inputMode="numeric"
            min={MIN_BOTS}
            max={MAX_BOTS}
            step={1}
            placeholder="Custom"
            value={custom}
            error={custom !== '' && problem ? problem : undefined}
            onChange={(e) => setCustom(e.target.value)}
          />
        </div>
        {proj && (
          <p className="acr-demo-proj">
            <Icon name="grid" /> {formatCount(n)} bots → ≈ {formatCount(proj.tables)} tables of 8 · {formatCount(proj.paid)} paid places (15%)
          </p>
        )}
      </fieldset>

      <fieldset className="acr-demo-fs" disabled={locked || create.pending}>
        <legend className="acr-demo-legend">Strategy mix</legend>
        <div className="acr-demo-mixpresets" role="group" aria-label="Mix presets">
          {MIX_PRESETS.map((p) => (
            <button key={p.id} type="button" className={cx('acr-demo-chip', sameMix(mix, p.mix) && 'is-on')} aria-pressed={sameMix(mix, p.mix)} title={p.hint} onClick={() => setMix(p.mix)}>
              {p.label}
            </button>
          ))}
        </div>
        <ul className="acr-demo-mix" aria-label="Strategy weights">
          {STRATEGIES.map((s) => {
            const meta = STRATEGY_META[s];
            const share = totalWeight > 0 ? used[s] / totalWeight : 0;
            return (
              <li key={s} className={cx(mix[s] === 0 && 'is-off')}>
                <label className="acr-demo-mix__label" htmlFor={`${id}-${s}`}>
                  <Icon name={meta.icon} />
                  <span>
                    <span className="acr-demo-mix__name">{meta.label}</span>
                    <span className="acr-demo-dim">{meta.description}</span>
                  </span>
                </label>
                <input
                  id={`${id}-${s}`}
                  type="range"
                  min={0}
                  max={WEIGHT_MAX}
                  step={1}
                  value={mix[s]}
                  className="acr-demo-range"
                  aria-valuetext={`weight ${mix[s]}, ${formatPercent(share)} of bots`}
                  style={{ ['--acr-demo-fill' as string]: `${(mix[s] / WEIGHT_MAX) * 100}%` }}
                  onChange={(e) => setWeight(s, Number(e.target.value))}
                />
                <span className="acr-demo-mix__w jpb-num" aria-hidden="true">
                  {mix[s]}
                </span>
                <span className="acr-demo-mix__share jpb-num">
                  {formatPercent(share)}
                  {counts && <span className="acr-demo-dim"> · {formatCount(counts[s])} bots</span>}
                </span>
              </li>
            );
          })}
        </ul>
        {allZero && (
          <p className="acr-demo-note">
            <Icon name="info" /> Every weight is 0: the server uses its balanced default mix (shown above).
          </p>
        )}
      </fieldset>

      <fieldset className="acr-demo-fs" disabled={locked || create.pending}>
        <legend className="jpb-sr-only">Options</legend>
        <TextField label="Name (optional)" value={name} maxLength={NAME_MAX} placeholder={`Demo · ${problem ? '…' : formatCount(n)} bots`} onChange={(e) => setName(e.target.value)} />
        <Toggle
          checked={speed}
          onChange={setSpeed}
          label="Speed mode"
          description="1-second blind levels and quick bots. Only honoured when the server allows it (SPEED_MODE_ALLOWED); otherwise the demo runs at normal speed."
        />
      </fieldset>

      {error && (
        <p className="acr-demo-error" role="alert">
          <Icon name="warning" /> {error}
        </p>
      )}
      <div className="acr-demo-start">
        <Button variant="primary" icon="play" block loading={create.pending} loadingLabel={`Starting… seating ${problem ? '' : formatCount(n)} bots`} disabled={Boolean(problem) || locked} onClick={() => void start()}>
          Start demo{problem ? '' : ` with ${formatCount(n)} bots`}
        </Button>
        {locked && (
          <p className="acr-demo-dim">
            <Icon name="lock" /> Requires SIMULATION_RUN
          </p>
        )}
      </div>
    </Panel>
  );
}
