import { Kbd, Modal } from '@jpb/ui';
import { SECTIONS } from '../app/sections';

/** `?` — every keyboard shortcut of the control room. */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const goKeys = SECTIONS.filter((s) => s.goKey);
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" description="Shortcuts are ignored while you type in a field. Every control is also reachable with Tab." size="md">
      <div className="acr-shortcuts">
        <section>
          <h3 className="acr-shortcuts__h">Anywhere</h3>
          <dl className="acr-shortcuts__list">
            <div>
              <dt>
                <Kbd>/</Kbd>
              </dt>
              <dd>Search players, public ids (JPN-…), table and hand numbers</dd>
            </div>
            <div>
              <dt>
                <Kbd>?</Kbd>
              </dt>
              <dd>Show this sheet</dd>
            </div>
            <div>
              <dt>
                <Kbd>Esc</Kbd>
              </dt>
              <dd>Close a dialog, menu or search</dd>
            </div>
          </dl>
        </section>
        <section>
          <h3 className="acr-shortcuts__h">Go to</h3>
          <dl className="acr-shortcuts__list">
            {goKeys.map((s) => (
              <div key={s.id}>
                <dt>
                  <Kbd>g</Kbd> <Kbd>{s.goKey}</Kbd>
                </dt>
                <dd>{s.label}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Modal>
  );
}
