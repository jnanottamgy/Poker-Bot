import { useEffect, useState } from 'react';
import type { BlindLevel } from '@jpb/shared-types';
import { Button, Modal, Select, formatChips } from '@jpb/ui';

/** Step 1 of "Set level": choose the target. Step 2 is the level-2 confirmation (word + reason). */
export function SetLevelDialog({ open, schedule, currentIndex, onCancel, onPick }: { open: boolean; schedule: BlindLevel[]; currentIndex: number; onCancel: () => void; onPick: (index: number) => void }) {
  const [value, setValue] = useState(String(Math.min(schedule.length - 1, currentIndex + 1)));
  useEffect(() => {
    if (open) setValue(String(Math.min(schedule.length - 1, currentIndex + 1)));
  }, [open, currentIndex, schedule.length]);
  const target = Number(value);
  const kind = target < currentIndex ? 'Moves the clock BACKWARDS' : target > currentIndex + 1 ? `Skips ${target - currentIndex - 1} level(s)` : target === currentIndex ? 'Restarts the current level' : 'Same as “Advance level”';
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Set blind level"
      description="Tables pick up the new blinds from their next hand; a hand in progress is never interrupted."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => onPick(target)}>
            Review change…
          </Button>
        </>
      }
    >
      <Select
        label="New level"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        options={schedule.map((l, i) => ({
          value: String(i),
          label: `Level ${l.level} — ${formatChips(l.smallBlind)} / ${formatChips(l.bigBlind)}${l.ante ? ` · ante ${formatChips(l.ante)}` : ''}${i === currentIndex ? ' (current)' : ''}`,
        }))}
        hint={kind}
      />
    </Modal>
  );
}
