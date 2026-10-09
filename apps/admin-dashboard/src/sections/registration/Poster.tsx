import { formatChips } from '@jpb/ui';
import { formatDateTime } from '../../lib/time';

export interface PosterProps {
  tournamentName: string;
  joinUrl: string;
  accessCode: string | null;
  qrSrc: string | null;
  startTime: number | null;
  startingStack: number;
  requireApproval: boolean;
}

/** Printable A4 poster: name, giant QR, link, access code and the three steps (black on white). */
export function Poster({ tournamentName, joinUrl, accessCode, qrSrc, startTime, startingStack, requireApproval }: PosterProps) {
  return (
    <article className="acr-registration-poster" aria-label={`Poster for ${tournamentName}`}>
      <p className="acr-registration-poster__eyebrow">No-Limit Hold’em tournament</p>
      <h1 className="acr-registration-poster__name">{tournamentName}</h1>
      {startTime && <p className="acr-registration-poster__when">Starts {formatDateTime(startTime)}</p>}
      <p className="acr-registration-poster__cta">Scan to join</p>
      {qrSrc ? <img className="acr-registration-poster__qr" src={qrSrc} alt={`QR code: ${joinUrl}`} /> : <p className="acr-registration-poster__noqr">Open the link below</p>}
      <p className="acr-registration-poster__url">{joinUrl}</p>
      {accessCode && (
        <p className="acr-registration-poster__code">
          Access code: <strong>{accessCode}</strong>
        </p>
      )}
      <ol className="acr-registration-poster__steps">
        <li>Scan the code with your phone camera (or type the link).</li>
        <li>Enter your name{accessCode ? ' and the access code' : ''}.</li>
        <li>{requireApproval ? 'Wait for staff approval, then keep the page open for your seat.' : 'Keep the page open: your table and seat appear when play starts.'}</li>
      </ol>
      <p className="acr-registration-poster__foot">Starting stack {formatChips(startingStack)} chips · Save your rejoin code to get back to your seat on any device.</p>
    </article>
  );
}
