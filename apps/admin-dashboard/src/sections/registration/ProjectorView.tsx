import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon, Skeleton, formatCount, useFocusTrap } from '@jpb/ui';

export interface ProjectorViewProps {
  open: boolean;
  onClose: () => void;
  tournamentName: string;
  joinUrl: string;
  accessCode: string | null;
  qrSrc: string | null;
  registered: number | null;
  maxPlayers: number;
  registrationOpen: boolean;
}

/**
 * Full-screen QR for a projector or a big TV: readable from the back of the
 * room, live registered count, Esc to leave. Uses the Fullscreen API when
 * the browser allows it (else it simply covers the window).
 */
export function ProjectorView({ open, onClose, tournamentName, joinUrl, accessCode, qrSrc, registered, maxPlayers, registrationOpen }: ProjectorViewProps) {
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [isFull, setIsFull] = useState(false);
  useFocusTrap(root, open, { initial: closeRef, onEscape: onClose });

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const onChange = () => setIsFull(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.body.style.overflow = prev;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  const canFull = typeof document.documentElement.requestFullscreen === 'function';
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void root.current?.requestFullscreen().catch(() => undefined);
  };

  return createPortal(
    <div ref={root} className="acr-registration-projector" role="dialog" aria-modal="true" aria-label={`Projector view: join ${tournamentName}`} tabIndex={-1}>
      <div className="acr-registration-projector__bar">
        {canFull && (
          <Button size="sm" variant="ghost" icon="monitor" onClick={toggleFull}>
            {isFull ? 'Exit full screen' : 'Full screen'}
          </Button>
        )}
        <Button ref={closeRef} size="sm" variant="secondary" icon="x" onClick={onClose}>
          Close (Esc)
        </Button>
      </div>
      <div className="acr-registration-projector__body">
        <div className="acr-registration-projector__text">
          <p className="acr-registration-projector__eyebrow">{registrationOpen ? 'Registration open' : 'Registration closed'}</p>
          <h2 className="acr-registration-projector__name">{tournamentName}</h2>
          <p className="acr-registration-projector__cta">
            <Icon name="phone" /> Scan with your phone camera to join
          </p>
          <p className="acr-registration-projector__url">{joinUrl.replace(/^https?:\/\//, '')}</p>
          {accessCode && (
            <p className="acr-registration-projector__code">
              Access code <strong>{accessCode}</strong>
            </p>
          )}
          {registered !== null && (
            <p className="acr-registration-projector__count" aria-live="polite">
              <span className="jpb-num">{formatCount(registered)}</span> / {formatCount(maxPlayers)} registered
            </p>
          )}
        </div>
        <div className="acr-registration-projector__qr">{qrSrc ? <img src={qrSrc} alt={`QR code: ${joinUrl}`} /> : <Skeleton shape="block" width="100%" height="100%" />}</div>
      </div>
    </div>,
    document.body,
  );
}
