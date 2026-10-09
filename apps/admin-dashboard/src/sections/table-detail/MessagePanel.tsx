import { useId, useState } from 'react';
import { Button, Panel } from '@jpb/ui';
import { MESSAGE_MAX_LENGTH } from './useTableControls';

/** Compose a message for the players of this table (sent through the level-1 confirmation). */
export function MessagePanel({ tableNumber, onSend }: { tableNumber: number; onSend: (text: string) => Promise<unknown> }) {
  const id = useId();
  const [text, setText] = useState('');
  const clean = text.trim();
  const left = MESSAGE_MAX_LENGTH - text.length;
  return (
    <Panel title={`Message table ${tableNumber}`} icon="message" className="acr-td-msg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!clean) return;
          void onSend(clean).then((r) => {
            if (r !== undefined) setText('');
          });
        }}
      >
        <label htmlFor={id} className="jpb-sr-only">
          Message to the players of table {tableNumber}
        </label>
        <textarea
          id={id}
          className="jpb-input jpb-textarea"
          rows={3}
          maxLength={MESSAGE_MAX_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Short break at this table while the floor checks the deck."
          aria-describedby={`${id}-count`}
        />
        <div className="acr-td-msg__foot">
          <span id={`${id}-count`} className="acr-td-muted jpb-num" aria-live="polite">
            {left} characters left
          </span>
          <Button type="submit" size="sm" icon="message" disabled={!clean}>
            Send to table…
          </Button>
        </div>
      </form>
    </Panel>
  );
}
