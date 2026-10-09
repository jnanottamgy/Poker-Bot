import { Button, Modal } from '@jpb/ui';
import type { RejoinCodeResponse } from '../../api/types';
import { CredentialCard } from '../players/CredentialCard';
import { PrintPortal, usePrint } from '../players/print';
import { joinUrlFor, useJoinQr } from '../players/qr';

export interface RejoinDialogProps {
  result: RejoinCodeResponse | null;
  onClose: () => void;
  tournamentId: string;
  tournamentName: string;
  joinCode: string;
  playerName: string;
  seat: string;
}

/**
 * Shows a freshly issued rejoin code ONCE (the server keeps only a hash):
 * code, public id, the direct rejoin link and the join QR, ready to print.
 * No QR helper exists in @jpb/ui or the client SDK, so the QR is the
 * tournament join QR from the server; the rejoin link itself is shown as text.
 */
export function RejoinDialog({ result, onClose, tournamentId, tournamentName, joinCode, playerName, seat }: RejoinDialogProps) {
  const qr = useJoinQr(tournamentId);
  const printer = usePrint();
  if (!result) return null;
  const card = (variant: 'screen' | 'print') => (
    <CredentialCard
      variant={variant}
      tournamentName={tournamentName}
      playerName={playerName}
      publicId={result.publicId}
      rejoinCode={result.rejoinCode}
      rejoinUrl={result.rejoinUrl}
      joinUrl={joinUrlFor(joinCode)}
      qrSrc={qr.src}
      qrLoading={qr.loading}
      seat={seat}
    />
  );
  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="New rejoin code"
        description="Shown only now. Print the card or show it to the player; the previous code no longer works."
        size="md"
        tone="gold"
        footer={
          <>
            <Button variant="secondary" icon="file" onClick={printer.print}>
              Print card
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        {card('screen')}
      </Modal>
      {printer.printing && <PrintPortal onDone={printer.done}>{card('print')}</PrintPortal>}
    </>
  );
}
