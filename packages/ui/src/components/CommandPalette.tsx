import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { cx } from '../cx';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Kbd } from './Kbd';

export interface Command {
  id: string;
  label: string;
  /** Section, e.g. "Tournament", "Tables", "Players". */
  group: string;
  icon?: IconName;
  /** Visual key hint, e.g. "P" or "⇧F". The app binds the key itself. */
  shortcut?: string;
  /** Extra search terms. */
  keywords?: string[];
  /** Destructive: shown in red with "Needs confirmation". */
  danger?: boolean;
  /** Unavailable (permission / state): listed but not runnable, with the reason. */
  disabledReason?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  placeholder?: string;
  className?: string;
}

/** Case-insensitive match of every word of the query against label, group and keywords. */
export function matchCommand(c: Command, query: string): boolean {
  const hay = [c.label, c.group, ...(c.keywords ?? [])].join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** Opens the palette on ⌘K / Ctrl+K (toggle). */
export function useCommandPaletteHotkey(setOpen: (fn: (open: boolean) => boolean) => void): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
}

/**
 * ⌘K command palette listing every director action with its key hint.
 * Combobox + listbox pattern: type to filter, ArrowUp/Down to move, Enter to
 * run, Esc to close. Destructive commands only OPEN their confirmation.
 */
export function CommandPalette({ open, onClose, commands, placeholder = 'Type a command or search…', className }: CommandPaletteProps) {
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  useFocusTrap(root, open, { initial: input, onEscape: onClose });

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const results = useMemo(() => commands.filter((c) => matchCommand(c, query)), [commands, query]);
  const groups = useMemo(() => {
    const out: Array<{ name: string; items: Array<{ c: Command; index: number }> }> = [];
    results.forEach((c, index) => {
      const g = out.find((x) => x.name === c.group);
      if (g) g.items.push({ c, index });
      else out.push({ name: c.group, items: [{ c, index }] });
    });
    return out;
  }, [results]);

  if (!open) return null;

  const run = (c: Command | undefined): void => {
    if (!c || c.disabledReason) return;
    onClose();
    c.run();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = results.length;
      if (n === 0) return;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[active]);
    }
  };

  const activeId = results[active] ? `${uid}-opt-${results[active].id}` : undefined;
  return (
    <div className="jpb-cmdk-wrap">
      <div className="jpb-cmdk-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={root} className={cx('jpb-cmdk', className)} role="dialog" aria-modal="true" aria-label="Command palette" tabIndex={-1}>
        <div className="jpb-cmdk__search">
          <Icon name="search" />
          <input
            ref={input}
            className="jpb-cmdk__input"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search commands"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div id={`${uid}-list`} className="jpb-cmdk__list" role="listbox" aria-label="Commands">
          {groups.length === 0 && <p className="jpb-cmdk__empty">No matching commands</p>}
          {groups.map((g) => (
            <div key={g.name} role="group" aria-label={g.name} className="jpb-cmdk__group">
              <p className="jpb-cmdk__grouplabel" aria-hidden="true">
                {g.name}
              </p>
              {g.items.map(({ c, index }) => (
                <div
                  key={c.id}
                  id={`${uid}-opt-${c.id}`}
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={c.disabledReason ? true : undefined}
                  className={cx('jpb-cmdk__item', index === active && 'is-active', c.danger && 'is-danger', c.disabledReason && 'is-disabled')}
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(c)}
                >
                  {c.icon ? <Icon name={c.icon} className="jpb-cmdk__icon" /> : <span className="jpb-cmdk__icon" />}
                  <span className="jpb-cmdk__label">
                    {c.label}
                    {c.disabledReason ? <span className="jpb-cmdk__why">{c.disabledReason}</span> : c.danger ? <span className="jpb-cmdk__why">Needs confirmation</span> : null}
                  </span>
                  {c.shortcut && (
                    <span className="jpb-cmdk__kbd" aria-label={`Shortcut ${c.shortcut}`}>
                      <Kbd>{c.shortcut}</Kbd>
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="jpb-cmdk__foot" aria-hidden="true">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move · <Kbd>↵</Kbd> run · <Kbd>⌘K</Kbd> toggle
        </p>
      </div>
    </div>
  );
}
