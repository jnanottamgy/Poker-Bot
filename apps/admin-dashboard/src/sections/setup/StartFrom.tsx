import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Icon, Select, TOURNAMENT_STATUS_META, useToast } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useDangerousAction } from '../../danger/DangerProvider';
import { copiedDraft } from './model/draft';
import type { WizardDraft } from './model/draft';

export interface StartFromProps {
  /** Replace the form with a copy of another tournament's configuration (undoable). */
  onCopy: (draft: WizardDraft, from: string) => void;
}

/**
 * "Start from" bar of the create wizard: the spec defaults (what the form
 * starts with), a local copy of another tournament's configuration, or a
 * server-side clone (tournamentClone) that becomes a new draft at once.
 */
export function StartFrom({ onCopy }: StartFromProps) {
  const api = useApi();
  const toast = useToast();
  const navigate = useNavigate();
  const danger = useDangerousAction();
  const canView = usePermission('PLAYER_VIEW', null);
  const list = useQuery(qk.tournaments({}), (s) => api.tournaments.list({}, s), { enabled: canView });
  const [sourceId, setSourceId] = useState('');
  const [copying, setCopying] = useState(false);
  const rows = list.data?.tournaments ?? [];
  const source = rows.find((t) => t.id === sourceId) ?? null;

  const copy = async () => {
    if (!source) return;
    setCopying(true);
    try {
      const o = await api.tournaments.overview(source.id);
      onCopy(copiedDraft(o.config), source.name);
    } catch (err) {
      const f = friendlyError(err);
      toast.push({ tone: 'danger', title: f.title, description: f.description });
    } finally {
      setCopying(false);
    }
  };

  const clone = () => {
    if (!source) return;
    void danger({
      level: 0,
      endpoint: 'tournamentClone',
      title: 'Clone tournament',
      run: () => api.tournaments.clone(source.id),
      success: (r) => `Draft “${r.tournament.name}” created from “${source.name}”`,
      invalidate: [qk.tournamentsAll()],
      onSuccess: (r) => navigate(sectionHref('setup', r.tournament.id)),
    });
  };

  return (
    <section className="acr-setup-startfrom" aria-label="Start from">
      <div className="acr-setup-startfrom__text">
        <p className="acr-setup-startfrom__title">
          <Icon name="layers" /> Start from
        </p>
        <p className="acr-setup-dim">The form starts with Johnny’s recommended defaults. Or reuse an earlier tournament’s configuration:</p>
      </div>
      <Select
        label="Existing tournament"
        hideLabel
        className="acr-setup-startfrom__select"
        value={sourceId}
        placeholder={list.isLoading ? 'Loading tournaments…' : rows.length ? 'Choose a tournament…' : 'No tournaments yet'}
        options={rows.map((t) => ({ value: t.id, label: `${t.name} · ${TOURNAMENT_STATUS_META[t.status].label}` }))}
        onChange={(e) => setSourceId(e.target.value)}
        disabled={rows.length === 0}
      />
      <Button size="sm" icon="download" disabled={!source} loading={copying} loadingLabel="Copying…" onClick={() => void copy()}>
        Copy into this form
      </Button>
      <Button size="sm" variant="ghost" icon="layers" disabled={!source} onClick={clone} title="Creates a new draft on the server right away (new join code and seed)">
        Clone as new draft
      </Button>
    </section>
  );
}
