import { useEffect, useState } from 'react';
import type { BlindLevel } from '@jpb/shared-types';
import { Button, Icon, Modal, Select, formatChips } from '@jpb/ui';

/** What moving from `current` to `target` means, in words (shown before the level-2 confirmation). */
export function setLevelKind(current: number, target: number): { text: string; warn: boolean } {
  if (target < current) return { text: `Moves the clock BACKWARDS by ${current - target} level${current - target === 1 ? '' : 's'}`, warn: true };
  if (target === current) return { text: 'Restarts the current level with a full clock', warn: true };
  if (target === current + 1) return { text: 'Same as “Advance level”', warn: false };
  return { text: `Skips ${target - current - 1} level${target - current - 1 === 1 ? '' : 's'}`, warn: true };
}

/**
 * Step 1 of "Set level": choose the target level. Step 2 is the level-2
 * confirmation (type LEVEL + reason, before → after preview), run by the caller.
 */
export function SetLevelDialog({ open, schedule, currentIndex, onCancel, onPick }: { open: boolean; schedule: readonly BlindLevel[]; currentIndex: number; onCancel: () => void; onPick: (index: number) => void }) {
  const initial = () => String(Math.min(schedule.length - 1, currentIndex + 1));
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial());
    // Reset only when the dialog opens (not when the live level changes underneath it).
  }, [open]);
  const target = Number(value);
  const kind = setLevelKind(currentIndex, target);
  const t = schedule[target];
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Set blind level"
      description="Tables pick up the new blinds from their next hand; a hand in progress is never interrupted. You confirm with the word LEVEL and a reason on the next step."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" icon="arrow-right" onClick={() => onPick(target)} disabled={!t}>
            Review change…
          </Button>
        </>
      }
    >
      <div className="acr-clock-setlevel">
        <Select
          label="New level"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          options={schedule.map((l, i) => ({
            value: String(i),
            label: `Level ${l.level} — ${formatChips(l.smallBlind)} / ${formatChips(l.bigBlind)}${l.ante ? ` · ante ${formatChips(l.ante)}` : ''}${i === currentIndex ? ' (current)' : i < currentIndex ? ' (played)' : ''}`,
          }))}
        />
        <p className={`acr-clock-setlevel__kind${kind.warn ? ' is-warn' : ''}`} role="status">
          <Icon name={kind.warn ? 'warning' : 'info'} /> {kind.text}
        </p>
        {t && (
          <p className="acr-clock-setlevel__target jpb-num">
            Level {t.level}: {formatChips(t.smallBlind)} / {formatChips(t.bigBlind)}
            {t.ante ? ` · ante ${formatChips(t.ante)}` : ''} · {Math.round((t.durationSeconds / 60) * 100) / 100} min
          </p>
        )}
      </div>
    </Modal>
  );
}
