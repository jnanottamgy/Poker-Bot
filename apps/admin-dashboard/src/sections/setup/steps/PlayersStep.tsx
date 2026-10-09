import type { TableSizeConfig } from '@jpb/shared-types';
import { Icon, cx, formatCount } from '@jpb/ui';
import { CONFIG_LIMITS } from '@jpb/validation';
import { useWizard } from '../components/context';
import { NumberField } from '../components/fields';
import { Fact, Group, Note } from '../components/Group';
import { RadioCards } from '../components/RadioCards';
import type { RadioCardOption } from '../components/RadioCards';
import { isNum } from '../model/format';
import { TABLE_PRESETS, applyTablePreset, matchingPreset, previewTables, sampleFieldSizes, seatingPreview, seatingText } from '../model/tables';
import type { ConsolidateBy } from '../model/tables';

/** Tables drawn in the live preview before "+ N more". */
const DRAWN_TABLES = 12;

function MiniTable({ players, seats }: { players: number; seats: number }) {
  return (
    <span className="acr-setup-minitable" aria-hidden="true">
      <span className="acr-setup-minitable__felt">{players}</span>
      {Array.from({ length: seats }, (_, i) => {
        const angle = (i / seats) * 2 * Math.PI - Math.PI / 2;
        return <span key={i} className={cx('acr-setup-minitable__seat', i < players && 'is-taken')} style={{ left: `${50 + 44 * Math.cos(angle)}%`, top: `${50 + 40 * Math.sin(angle)}%` }} />;
      })}
    </span>
  );
}

const CONSOLIDATION: ReadonlyArray<RadioCardOption<ConsolidateBy>> = [
  { value: 'TARGET', code: 'TARGET', title: 'Target size', text: 'Tables = ceil(players ÷ target). Breaks tables early so play stays at the target size.' },
  { value: 'MAX', code: 'MAX', title: 'Maximum size', text: 'Tables = ceil(players ÷ max seats). Fills tables completely before breaking one.' },
];

/** Step 2 — field size, table sizes (presets + fine control), consolidation and the live seating preview. */
export function PlayersStep() {
  const { config, meta, update, setMeta } = useWizard();
  const t = config.tables;
  const consolidateBy = config.balancing.consolidateBy;
  const preset = matchingPreset(t);
  const previewN = meta.previewPlayers ?? config.maxPlayers;
  const preview = isNum(previewN) ? seatingPreview(previewN, t, consolidateBy) : null;
  const drawn = preview ? previewTables(preview, DRAWN_TABLES) : [];
  const samples = sampleFieldSizes(config.minPlayers, config.maxPlayers);
  const setTables = (patch: Partial<TableSizeConfig>) => update((c) => ({ ...c, tables: { ...c.tables, ...patch } }));

  return (
    <>
      <Group title="Field size" icon="users" description="Registration closes automatically at the maximum; the tournament cannot start below the minimum.">
        <div className="acr-setup-grid acr-setup-grid--2">
          <NumberField path="minPlayers" label="Minimum players" required grouping value={config.minPlayers} onChange={(v) => update((c) => ({ ...c, minPlayers: v }))} hint={`At least ${CONFIG_LIMITS.MIN_PLAYERS}`} />
          <NumberField
            path="maxPlayers"
            label="Maximum players"
            required
            grouping
            value={config.maxPlayers}
            onChange={(v) => update((c) => ({ ...c, maxPlayers: v }))}
            hint={`Up to ${formatCount(CONFIG_LIMITS.MAX_PLAYERS)}`}
          />
        </div>
      </Group>

      <Group title="Table size" icon="grid" description="Pick a preset, then fine-tune. Balancing keeps tables within the imbalance tolerance (Balancing step).">
        <div className="acr-setup-presets" role="group" aria-label="Table size presets">
          {TABLE_PRESETS.map((p) => {
            const active = preset?.id === p.id;
            return (
              <button key={p.id} type="button" aria-pressed={active} className={cx('acr-setup-preset', active && 'is-active')} onClick={() => setTables(applyTablePreset(t, p))}>
                <span className="acr-setup-preset__title">
                  {active && <Icon name="check-circle" />}
                  {p.label}
                </span>
                <span className="acr-setup-preset__text">{p.caption}</span>
              </button>
            );
          })}
          <span className={cx('acr-setup-preset', 'is-static', !preset && 'is-active')}>
            <span className="acr-setup-preset__title">{!preset && <Icon name="check-circle" />}Custom</span>
            <span className="acr-setup-preset__text">{preset ? 'Edit any size below' : `${t.maxSize} seats · target ${t.targetSize} · final ${t.finalTableSize}`}</span>
          </span>
        </div>
        <div className="acr-setup-grid acr-setup-grid--4">
          <NumberField path="tables.maxSize" label="Max seats" required value={t.maxSize} onChange={(v) => setTables({ maxSize: v })} hint={`${CONFIG_LIMITS.MIN_TABLE_SIZE}–${CONFIG_LIMITS.MAX_TABLE_SIZE} seats`} />
          <NumberField path="tables.targetSize" label="Target players" required value={t.targetSize} onChange={(v) => setTables({ targetSize: v })} hint="Normal play" />
          <NumberField path="tables.minSize" label="Break below" required value={t.minSize} onChange={(v) => setTables({ minSize: v })} hint="Break-candidate size" />
          <NumberField path="tables.finalTableSize" label="Final table size" required value={t.finalTableSize} onChange={(v) => setTables({ finalTableSize: v })} hint="Players at consolidation" />
        </div>
      </Group>

      <Group title="Consolidation" icon="layers" description="How many tables Johnny keeps open as players bust (the documented seating-engine formula).">
        <RadioCards
          legend="Consolidation mode"
          id="setup-f-balancing-consolidateBy"
          value={consolidateBy}
          options={CONSOLIDATION}
          onChange={(v) => update((c) => ({ ...c, balancing: { ...c.balancing, consolidateBy: v } }))}
        />
      </Group>

      <Group title="Live seating preview" icon="activity" description="Display only — the director seats players on the server with the same formula.">
        <div className="acr-setup-preview">
          <div className="acr-setup-preview__controls">
            <NumberField
              path="__preview"
              label="Players"
              grouping
              value={previewN}
              onChange={(v) => setMeta({ previewPlayers: isNum(v) ? v : null })}
              hint={meta.previewPlayers === null ? 'Showing the maximum field' : 'Try any field size'}
            />
            <div className="acr-setup-preview__result" aria-live="polite">
              {preview ? (
                <>
                  <span className="acr-setup-preview__big jpb-num">{formatCount(preview.tables)}</span>
                  <span className="acr-setup-preview__unit">table{preview.tables === 1 ? '' : 's'}</span>
                  <span className="acr-setup-preview__text">{seatingText(preview)}</span>
                </>
              ) : (
                <span className="acr-setup-preview__text">Fix the table sizes to see the preview.</span>
              )}
            </div>
          </div>
          {preview && preview.tables > 0 && (
            <div className="acr-setup-preview__tables" aria-label={`Preview: ${seatingText(preview)}`} role="img">
              {drawn.map((n, i) => (
                <MiniTable key={i} players={n} seats={t.maxSize} />
              ))}
              {preview.tables > drawn.length && <span className="acr-setup-preview__more">+ {formatCount(preview.tables - drawn.length)} more</span>}
            </div>
          )}
          {samples.length > 0 && (
            <table className="acr-setup-mini" aria-label="Seating at other field sizes">
              <thead>
                <tr>
                  <th scope="col">Players</th>
                  <th scope="col">Tables</th>
                  <th scope="col">Table sizes</th>
                </tr>
              </thead>
              <tbody>
                {samples.map((n) => {
                  const p = seatingPreview(n, t, consolidateBy);
                  return (
                    <tr key={n}>
                      <td className="jpb-num">
                        <button type="button" className="acr-setup-linkbtn" onClick={() => setMeta({ previewPlayers: n })}>
                          {formatCount(n)}
                        </button>
                      </td>
                      <td className="jpb-num">{p ? formatCount(p.tables) : '—'}</td>
                      <td>{p ? p.groups.map((g) => `${formatCount(g.count)} × ${g.size}`).join(' + ') || '—' : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="acr-setup-facts">
          <Fact label="Final table" value={isNum(t.finalTableSize) ? `${t.finalTableSize} players` : '—'} sub="All tables consolidate into one" />
          <Fact label="Seats at maximum field" value={isNum(config.maxPlayers) && preview ? formatCount((seatingPreview(config.maxPlayers, t, consolidateBy)?.tables ?? 0) * t.maxSize) : '—'} sub="Tables × max seats" />
        </div>
        {isNum(config.maxPlayers) && config.maxPlayers > 100_000 && <Note>Large fields are fine: the table map and player lists are server-paginated.</Note>}
      </Group>
    </>
  );
}
