import { Link } from 'react-router';
import type { PlayerDetailDto } from '@jpb/shared-types';
import { Panel, StatusPill, formatMoneyMinor } from '@jpb/ui';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { PAYMENT_META, finishText } from '../players/model';

/** §2.8 "payout status (if prize)": prize, payment state and where to record the payment. */
export function PayoutPanel({ p, tournamentId, currency }: { p: PlayerDetailDto; tournamentId: string; currency: string }) {
  const canView = usePermission('PAYOUT_VIEW');
  const canManage = usePermission('PAYOUT_MANAGE');
  if (p.prizeMinor <= 0) return null;
  const m = PAYMENT_META[p.paymentStatus];
  return (
    <Panel title="Prize & payout" icon="trophy" tone="gold">
      <div className="acr-player-detail-payout">
        <div>
          <p className="acr-player-detail-payout__amount jpb-num">{formatMoneyMinor(p.prizeMinor, currency)}</p>
          <p className="acr-player-detail-muted">{finishText(p.finishPosition, p.tiedCount)} place</p>
        </div>
        <StatusPill tone={m.tone} icon={m.icon} label={m.label} title={m.hint} />
      </div>
      {canView && (
        <Link className="acr-link" to={sectionHref('payouts', tournamentId)}>
          {canManage ? 'Record the payment in Payouts' : 'Open Payouts'}
        </Link>
      )}
    </Panel>
  );
}
