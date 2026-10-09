import { Button, Icon, Panel, Skeleton } from '@jpb/ui';
import { useCopy } from '../players/clipboard';

export interface QrPanelProps {
  joinUrl: string;
  joinCode: string;
  accessCode: string | null;
  qr: { src: string | null; loading: boolean; error: unknown; refetch: () => unknown };
  onProjector: () => void;
  onPoster: () => void;
}

/** The tournament QR (server SVG), the join link and the access code, with projector / poster / copy. */
export function QrPanel({ joinUrl, joinCode, accessCode, qr, onProjector, onPoster }: QrPanelProps) {
  const copy = useCopy();
  return (
    <Panel title="Join QR & link" icon="phone" description="Players scan this to open the join page on their phone.">
      <div className="acr-registration-qr">
        <div className="acr-registration-qr__img">
          {qr.src ? (
            <img src={qr.src} alt={`QR code of the join page ${joinUrl}`} width={200} height={200} />
          ) : qr.loading ? (
            <Skeleton shape="block" width={200} height={200} />
          ) : (
            <div className="acr-registration-qr__err" role="alert">
              <Icon name="warning" /> The QR code could not be loaded.
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => void qr.refetch()}>
                Retry
              </Button>
            </div>
          )}
        </div>
        <div className="acr-registration-qr__side">
          <div className="acr-registration-qr__field">
            <span className="acr-registration-qr__k">Join link</span>
            <a className="acr-link jpb-mono acr-registration-qr__url" href={joinUrl} target="_blank" rel="noreferrer">
              {joinUrl}
            </a>
          </div>
          <div className="acr-registration-qr__field">
            <span className="acr-registration-qr__k">Join code</span>
            <span className="jpb-mono acr-registration-qr__v">{joinCode}</span>
          </div>
          <div className="acr-registration-qr__field">
            <span className="acr-registration-qr__k">Access code</span>
            {accessCode ? (
              <span className="acr-registration-qr__access">
                <span className="jpb-mono acr-registration-qr__code">{accessCode}</span>
                <Button size="sm" variant="ghost" icon="key" onClick={() => void copy(accessCode, 'Access code')}>
                  Copy
                </Button>
              </span>
            ) : (
              <span className="acr-registration-dim">None — anyone with the link can register</span>
            )}
          </div>
        </div>
      </div>
      <div className="acr-registration-qr__actions">
        <Button size="sm" variant="secondary" icon="monitor" onClick={onProjector}>
          Projector view
        </Button>
        <Button size="sm" variant="secondary" icon="file" onClick={onPoster}>
          Print poster
        </Button>
        <Button size="sm" variant="secondary" icon="arrow-right" onClick={() => void copy(joinUrl, 'Join link')}>
          Copy join link
        </Button>
      </div>
    </Panel>
  );
}
