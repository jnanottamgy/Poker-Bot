import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './print.css';

const BODY_CLASS = 'acr-players-printing';

/**
 * Prints `children` alone: they are rendered into a body-level portal, the
 * body gets a class that hides everything else in print media, and the
 * browser print dialog opens. `onDone` runs when printing finished or was
 * cancelled.
 */
export function PrintPortal({ children, onDone }: { children: ReactNode; onDone: () => void }) {
  const [host] = useState(() => (typeof document === 'undefined' ? null : document.createElement('div')));
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!host) return undefined;
    host.className = 'acr-players-print';
    document.body.appendChild(host);
    document.body.classList.add(BODY_CLASS);
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      onDoneRef.current();
    };
    window.addEventListener('afterprint', done);
    // Let the portal paint (and the QR image decode) before the dialog opens.
    const timer = setTimeout(() => {
      try {
        if (typeof window.print === 'function') window.print();
      } catch {
        /* printing unavailable (embedded browser): nothing to do */
      }
      // Without `afterprint` support print() is the only signal (it returns once the dialog closes).
      if (!('onafterprint' in window)) setTimeout(done, 0);
    }, 120);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', done);
      document.body.classList.remove(BODY_CLASS);
      host.remove();
    };
  }, [host]);

  return host ? createPortal(children, host) : null;
}

/** Trigger + portal state: render `<PrintPortal onDone={done}>` while `printing`. */
export function usePrint() {
  const [printing, setPrinting] = useState(false);
  const print = useCallback(() => setPrinting(true), []);
  const done = useCallback(() => setPrinting(false), []);
  return { printing, print, done };
}
