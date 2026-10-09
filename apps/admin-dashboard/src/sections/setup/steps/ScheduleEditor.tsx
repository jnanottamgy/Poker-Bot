import type { KeyboardEvent } from 'react';
import type { BlindLevel } from '@jpb/shared-types';
import { Icon, IconButton } from '@jpb/ui';
import type { ScheduleProjection } from '@jpb/validation';
import { useWizard } from '../components/context';
import { CellInput } from '../components/fields';
import { VirtualRows } from '../components/VirtualRows';
import { insertAfter, moveLevel, removeAt, setLevelField } from '../model/blinds';
import { bbText, durationLabel } from '../model/format';
import { fieldDomId } from '../model/issues';

const ROW_HEIGHT = 58;
const COLUMNS = '64px 54px minmax(96px, 1fr) minmax(96px, 1fr) minmax(96px, 1fr) minmax(88px, 0.8fr) 76px 72px minmax(96px, 0.9fr) 82px';
const LEVEL_FIELDS = ['smallBlind', 'bigBlind', 'ante', 'durationSeconds'] as const;
type LevelField = (typeof LEVEL_FIELDS)[number];

/** "1:04" (h:mm) from the start of level 1. */
function clockOffset(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Focus the same field of a level after a reorder (the row is re-rendered at its new index). */
function focusLater(path: string) {
  requestAnimationFrame(() => document.getElementById(fieldDomId(path))?.focus());
}

export interface ScheduleEditorProps {
  projection: ScheduleProjection | null;
}

/**
 * Blind schedule editor: one row per level with inline validation, reorder
 * (buttons or Alt+↑/↓), insert after, delete, projected start and depth.
 * Virtualized (up to 500 levels).
 */
export function ScheduleEditor({ projection }: ScheduleEditorProps) {
  const { config, update } = useWizard();
  const levels = config.blindSchedule;
  const set = (fn: (l: BlindLevel[]) => BlindLevel[]) => update((c) => ({ ...c, blindSchedule: fn(c.blindSchedule) }));

  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const delta = e.key === 'ArrowUp' ? -1 : 1;
    const to = index + delta;
    if (to < 0 || to >= levels.length) return;
    const last = (e.target as HTMLElement).id.split('-').pop() ?? '';
    const field = (LEVEL_FIELDS as readonly string[]).includes(last) ? last : 'bigBlind';
    set((l) => moveLevel(l, index, delta));
    focusLater(`blindSchedule[${to}].${field}`);
  };

  const header = (
    <>
      <span role="columnheader" className="acr-setup-vtable__th">
        <span className="jpb-sr-only">Reorder</span>
      </span>
      <span role="columnheader" className="acr-setup-vtable__th">
        Level
      </span>
      <span role="columnheader" className="acr-setup-vtable__th is-num">
        Small blind
      </span>
      <span role="columnheader" className="acr-setup-vtable__th is-num">
        Big blind
      </span>
      <span role="columnheader" className="acr-setup-vtable__th is-num">
        Ante
      </span>
      <span role="columnheader" className="acr-setup-vtable__th is-num" title="Minutes, m:ss or e.g. 45s">
        Duration
      </span>
      <span role="columnheader" className="acr-setup-vtable__th is-num" title="Projected clock time from the start of level 1 (h:mm), breaks included">
        Starts
      </span>
      <span role="columnheader" className="acr-setup-vtable__th is-num" title="Starting stack in big blinds of this level">
        Depth
      </span>
      <span role="columnheader" className="acr-setup-vtable__th">
        Break after
      </span>
      <span role="columnheader" className="acr-setup-vtable__th">
        <span className="jpb-sr-only">Actions</span>
      </span>
    </>
  );

  const renderRow = (i: number) => {
    const l = levels[i]!;
    const n = i + 1;
    const proj = projection?.levels[i];
    const cell = (field: LevelField, label: string, kind: 'int' | 'duration' = 'int') => (
      <span role="cell" className="acr-setup-vtable__td is-num">
        <CellInput path={`blindSchedule[${i}].${field}`} label={`Level ${n} ${label}`} kind={kind} value={l[field]} onChange={(v) => set((ls) => setLevelField(ls, i, field, v))} />
      </span>
    );
    return (
      <div className="acr-setup-vtable__cells" onKeyDown={(e) => onRowKey(e, i)}>
        <span role="cell" className="acr-setup-vtable__td acr-setup-reorder">
          <IconButton icon="chevron-up" size="sm" label={`Move level ${n} up`} disabled={i === 0} onClick={() => set((ls) => moveLevel(ls, i, -1))} />
          <IconButton icon="chevron-down" size="sm" label={`Move level ${n} down`} disabled={i === levels.length - 1} onClick={() => set((ls) => moveLevel(ls, i, 1))} />
        </span>
        <span role="cell" className="acr-setup-vtable__td acr-setup-levelno jpb-num" id={fieldDomId(`blindSchedule[${i}]`)} tabIndex={-1}>
          {n}
        </span>
        {cell('smallBlind', 'small blind')}
        {cell('bigBlind', 'big blind')}
        {cell('ante', 'ante')}
        {cell('durationSeconds', 'duration', 'duration')}
        <span role="cell" className="acr-setup-vtable__td is-num acr-setup-dim jpb-num">
          {proj ? clockOffset(proj.startsAtSeconds) : '—'}
        </span>
        <span role="cell" className="acr-setup-vtable__td is-num acr-setup-dim jpb-num">
          {bbText(config.startingStack, l.bigBlind)}
        </span>
        <span role="cell" className="acr-setup-vtable__td">
          {proj?.breakAfter && i < levels.length - 1 ? (
            <span className="acr-setup-breakchip" title={proj.breakAfter.message ?? undefined}>
              <Icon name="coffee" /> {durationLabel(proj.breakAfter.durationSeconds)}
            </span>
          ) : (
            <span className="acr-setup-dim">—</span>
          )}
        </span>
        <span role="cell" className="acr-setup-vtable__td acr-setup-rowactions">
          <IconButton icon="plus" size="sm" label={`Insert a level after level ${n}`} onClick={() => set((ls) => insertAfter(ls, i))} />
          <IconButton icon="x" size="sm" variant="ghost" label={`Delete level ${n}`} disabled={levels.length <= 1} onClick={() => set((ls) => removeAt(ls, i))} />
        </span>
      </div>
    );
  };

  return (
    <VirtualRows
      label="Blind schedule"
      arrayPath="blindSchedule"
      count={levels.length}
      rowHeight={ROW_HEIGHT}
      columns={COLUMNS}
      minWidth={900}
      header={header}
      renderRow={renderRow}
      empty={<p className="acr-setup-dim">No levels yet. Apply a preset above or add a level.</p>}
    />
  );
}
