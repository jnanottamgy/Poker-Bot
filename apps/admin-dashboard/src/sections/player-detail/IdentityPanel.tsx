import { useEffect, useState } from 'react';
import type { PlayerDetailDto, PlayerPiiDto, RegistrationFieldKey } from '@jpb/shared-types';
import { Button, DescriptionList, Icon, IconButton, Panel, cx } from '@jpb/ui';
import type { DescriptionItem } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { usePermission } from '../../auth/permissions';
import { useCopy } from '../players/clipboard';

type PiiKey = Exclude<RegistrationFieldKey, 'name' | 'nickname'>;

const PII_LABEL: Readonly<Record<PiiKey, string>> = {
  email: 'Email',
  phone: 'Phone',
  participantId: 'Participant ID',
  collegeId: 'College ID',
};
const PII_KEYS = Object.keys(PII_LABEL) as PiiKey[];
const MASK = '•••• ••••';

export interface IdentityPanelProps {
  p: PlayerDetailDto;
  /** Registration fields configured for the tournament (personal fields not collected are labelled so). */
  collected: RegistrationFieldKey[] | null;
}

/**
 * §2.8 "Identity". Personal fields are masked; with PLAYER_VIEW_PII the
 * operator can reveal them — that read is audit-logged by the server
 * (VIEW_PII). Revealed data lives in this component only (never cached) and
 * is dropped when the operator hides it or leaves the page.
 */
export function IdentityPanel({ p, collected }: IdentityPanelProps) {
  const api = useApi();
  const copy = useCopy();
  const canPii = usePermission('PLAYER_VIEW_PII');
  const [pii, setPii] = useState<PlayerPiiDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPii(null);
    setError(null);
  }, [p.playerId]);

  const reveal = async () => {
    setLoading(true);
    setError(null);
    try {
      setPii(await api.players.pii(p.playerId));
    } catch (err) {
      const f = friendlyError(err);
      setError(`${f.title}. ${f.description}`);
    } finally {
      setLoading(false);
    }
  };

  const allowed = canPii && p.piiAvailable;
  const fields = PII_KEYS.filter((k) => collected === null || collected.includes(k));
  const items: DescriptionItem[] = [
    { label: 'Display name', value: p.displayName },
    { label: 'Nickname', value: p.nickname ?? '—' },
    {
      label: 'Public ID',
      value: (
        <span className="acr-player-detail-inline">
          <span className="jpb-mono">{p.publicId}</span>
          <IconButton icon="file" size="sm" label={`Copy public id ${p.publicId}`} onClick={() => void copy(p.publicId, 'Public ID')} />
        </span>
      ),
    },
    ...fields.map((k) => ({
      label: PII_LABEL[k],
      value: pii ? (pii[k] ?? <span className="acr-player-detail-muted">not given</span>) : <span className={cx('acr-player-detail-mask')} aria-label={`${PII_LABEL[k]} hidden`}>{MASK}</span>,
      mono: pii !== null,
    })),
  ];

  return (
    <Panel
      title="Identity"
      icon="user"
      description={pii ? 'Personal data visible — this view was recorded in the audit log.' : 'Personal fields are masked.'}
      actions={
        allowed ? (
          pii ? (
            <Button size="sm" variant="ghost" icon="eye" onClick={() => setPii(null)}>
              Hide personal data
            </Button>
          ) : (
            <Button size="sm" variant="secondary" icon="eye" loading={loading} loadingLabel="Loading…" onClick={() => void reveal()}>
              Show personal data
            </Button>
          )
        ) : undefined
      }
    >
      <DescriptionList items={items} columns={2} />
      {!allowed && (
        <p className="acr-player-detail-note">
          <Icon name="lock" /> {canPii ? 'Personal data is not available for this player.' : 'Requires PLAYER_VIEW_PII to show personal data.'}
        </p>
      )}
      {allowed && !pii && (
        <p className="acr-player-detail-note">
          <Icon name="shield" /> Showing personal data writes a VIEW_PII entry (your name, time and this player) to the audit log.
        </p>
      )}
      {error && (
        <p className="acr-player-detail-error" role="alert">
          <Icon name="warning" /> {error}
        </p>
      )}
    </Panel>
  );
}
