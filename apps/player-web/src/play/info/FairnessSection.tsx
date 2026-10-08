import { DescriptionList, ErrorState, Icon, Skeleton, formatCount } from '@jpb/ui';
import { useBackend } from '../../app/backend';
import { useAsync } from '../../hooks/useAsync';

/** Commitment hash before play; after the reveal, a link to verify your hands in the browser. */
export function FairnessSection({ joinCode, refreshKey }: { joinCode: string; refreshKey: number }) {
  const { api } = useBackend();
  const f = useAsync((signal) => api.fairness(joinCode, signal), [joinCode, refreshKey]);
  if (f.error && !f.data) return <ErrorState title={f.error.title} description={f.error.message} onRetry={f.reload} />;
  if (!f.data) return <Skeleton lines={3} />;
  const d = f.data;
  return (
    <div className="pw-fair">
      <p className="pw-muted">
        The server committed to its secret seed before the first hand. Every deck comes from that seed plus public entropy
        {d.entropyInputs.clientSeedCount > 0 ? ` (including ${formatCount(d.entropyInputs.clientSeedCount)} player devices)` : ''}, so nobody — staff included — can change a deck after play starts.
      </p>
      <DescriptionList
        columns={1}
        items={[
          { label: 'Server seed hash (commitment)', value: <span className="pw-hash">{d.serverSeedHash}</span>, mono: true },
          { label: 'Shuffle method', value: d.method },
          { label: 'Seed status', value: d.seedRevealed ? 'Revealed' : 'Sealed until the tournament ends' },
        ]}
      />
      {d.seedRevealed ? (
        <a className="pw-link" href={d.documentationUrl} target="_blank" rel="noreferrer">
          <Icon name="shield" /> Verify my hands in the browser
        </a>
      ) : (
        <p className="pw-hint">
          <Icon name="lock" /> After the tournament you can verify every hand you played.
        </p>
      )}
    </div>
  );
}
