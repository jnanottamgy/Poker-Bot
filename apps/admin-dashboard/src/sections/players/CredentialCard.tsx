import { Button, Icon, Skeleton, cx } from '@jpb/ui';
import { useCopy } from './clipboard';
import './cred.css';

export interface CredentialCardProps {
  tournamentName: string;
  playerName: string;
  publicId: string;
  rejoinCode: string;
  /** Opens the join page and fills the rejoin form (code in the URL fragment). */
  rejoinUrl: string | null;
  joinUrl: string;
  /** Tournament join QR (data URL) — there is no client-side QR generator for the personal rejoin link. */
  qrSrc: string | null;
  qrLoading?: boolean;
  /** "Table 12 · seat 4" or "Seat assigned when play starts". */
  seat: string;
  /** Paper version: black on white, no buttons. */
  variant?: 'screen' | 'print';
}

/**
 * The player's credentials, handed over by staff: public id + rejoin code
 * (shown once — the server only stores a hash), the rejoin link and the
 * join QR with the three steps to get back to the seat on any device.
 */
export function CredentialCard({ tournamentName, playerName, publicId, rejoinCode, rejoinUrl, joinUrl, qrSrc, qrLoading = false, seat, variant = 'screen' }: CredentialCardProps) {
  const copy = useCopy();
  const screen = variant === 'screen';
  return (
    <article className={cx('acr-players-cred', `is-${variant}`)} aria-label={`Seat card for ${playerName}`}>
      <header className="acr-players-cred__head">
        <span className="acr-players-cred__brand">
          <Icon name="key" /> {tournamentName}
        </span>
        <span className="acr-players-cred__seat">{seat}</span>
      </header>
      <div className="acr-players-cred__body">
        <div className="acr-players-cred__main">
          <p className="acr-players-cred__name">{playerName}</p>
          <dl className="acr-players-cred__facts">
            <div>
              <dt>Public ID</dt>
              <dd className="jpb-mono">{publicId}</dd>
            </div>
            <div className="acr-players-cred__code">
              <dt>Rejoin code</dt>
              <dd className="jpb-mono" aria-label={`Rejoin code ${rejoinCode.split('').join(' ')}`}>
                {rejoinCode}
              </dd>
            </div>
          </dl>
          <ol className="acr-players-cred__steps">
            <li>
              Scan the QR code or open <span className="jpb-mono acr-players-cred__url">{joinUrl}</span>
            </li>
            <li>Tap “Already registered? Rejoin” (or “Rejoin tournament”)</li>
            <li>Enter the player ID and the rejoin code above</li>
          </ol>
          {screen && rejoinUrl && (
            <div className="acr-players-cred__link">
              <span className="acr-players-cred__linklabel">Direct rejoin link (fills both fields)</span>
              <span className="jpb-mono acr-players-cred__url" title={rejoinUrl}>
                {rejoinUrl}
              </span>
            </div>
          )}
        </div>
        <figure className="acr-players-cred__qr">
          {qrSrc ? <img src={qrSrc} alt={`QR code of the join page ${joinUrl}`} width={168} height={168} /> : qrLoading ? <Skeleton shape="block" width={168} height={168} /> : <span className="acr-players-cred__noqr">QR unavailable — use the link</span>}
          <figcaption>Join page</figcaption>
        </figure>
      </div>
      {screen && (
        <footer className="acr-players-cred__actions">
          <Button size="sm" variant="secondary" icon="key" onClick={() => void copy(rejoinCode, 'Rejoin code')}>
            Copy code
          </Button>
          {rejoinUrl && (
            <Button size="sm" variant="secondary" icon="arrow-right" onClick={() => void copy(rejoinUrl, 'Rejoin link')}>
              Copy rejoin link
            </Button>
          )}
        </footer>
      )}
      <p className="acr-players-cred__warn">
        <Icon name="lock" /> Keep this card private: anyone with the code can take over the seat. A new code makes this one invalid.
      </p>
    </article>
  );
}
