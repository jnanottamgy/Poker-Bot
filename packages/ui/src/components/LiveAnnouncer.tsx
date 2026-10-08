import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type Politeness = 'polite' | 'assertive';

interface AnnouncerApi {
  /** Speak `text` through the always-mounted live region (same text twice is spoken twice). */
  announce: (text: string, politeness?: Politeness) => void;
}

const AnnouncerContext = createContext<AnnouncerApi | null>(null);

/**
 * Two empty, always-mounted live regions (polite + assertive). Live regions
 * that are inserted already populated are announced unreliably (often not at
 * all on NVDA / JAWS), so the critical cues ("Your turn") go through these
 * persistent regions instead. Mount once at the app root.
 */
export function LiveAnnouncerProvider({ children }: { children: ReactNode }) {
  const [msgs, setMsgs] = useState<Record<Politeness, string>>({ polite: '', assertive: '' });
  const flip = useRef(false);
  const announce = useCallback((text: string, politeness: Politeness = 'polite') => {
    // A trailing zero-width toggle makes a repeated identical message a new string.
    flip.current = !flip.current;
    setMsgs((m) => ({ ...m, [politeness]: `${text}${flip.current ? '\u200b' : ''}` }));
  }, []);
  const api = useMemo(() => ({ announce }), [announce]);
  return (
    <AnnouncerContext.Provider value={api}>
      {children}
      <div className="jpb-sr-only" aria-live="polite" aria-atomic="true" data-jpb-announcer="polite">
        {msgs.polite}
      </div>
      <div className="jpb-sr-only" aria-live="assertive" aria-atomic="true" data-jpb-announcer="assertive">
        {msgs.assertive}
      </div>
    </AnnouncerContext.Provider>
  );
}

/** The app's announcer, or null when no provider is mounted (components then fall back to role="status"). */
export function useAnnouncer(): AnnouncerApi | null {
  return useContext(AnnouncerContext);
}
