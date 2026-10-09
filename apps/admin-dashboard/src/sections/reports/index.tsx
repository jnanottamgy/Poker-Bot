import { useEffect, useState } from 'react';
import { Alert, Button, EmptyState, ErrorState, Skeleton, cx, useToast } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useTournamentId } from '../../auth/scope';
import { ButtonLink } from '../../components/ButtonLink';
import { PageHeader } from '../../components/PageHeader';
import { formatTimeOfDay } from '../../lib/time';
import { DownloadButton } from './DownloadButton';
import { saveJson } from './download';
import { isFinal, reportFilename } from './model';
import { ReportDocument } from './ReportDocument';
import './reports.css';

/** A running tournament's report refreshes in the background; a finished one never changes. */
const LIVE_POLL_MS = 30_000;

/** §2.18 Reports — the tournament report, printable, with JSON and CSV exports. */
export default function ReportsSection() {
  const tournamentId = useTournamentId();
  const api = useApi();
  const toast = useToast();
  const canExport = usePermission('EXPORT_DATA');
  const [poll, setPoll] = useState(true);
  const report = useQuery(qk.report(tournamentId), (s) => api.reports.get(tournamentId, s), { enabled: canExport, pollMs: poll ? LIVE_POLL_MS : undefined });
  const r = report.data;
  const final = r ? isFinal(r.status) : false;
  useEffect(() => {
    if (final) setPoll(false);
  }, [final]);
  const [jsonBusy, setJsonBusy] = useState(false);

  const exportJson = async () => {
    setJsonBusy(true);
    try {
      // Always export what the server says now, not what this screen fetched earlier.
      const fresh = await report.refetch();
      const data = fresh ?? r;
      if (!data) throw new Error('no report');
      if (!saveJson(reportFilename(data, 'json'), data)) {
        toast.push({ tone: 'warning', title: 'This browser cannot save files', description: 'Try another browser.' });
        return;
      }
      toast.push({ tone: 'success', title: 'Downloaded report JSON', description: reportFilename(data, 'json') });
    } catch {
      toast.push({ tone: 'danger', title: 'Could not prepare the report JSON', description: 'The server did not return the report. Check your connection and try again.' });
    } finally {
      setJsonBusy(false);
    }
  };

  const header = (
    <PageHeader
      title="Reports"
      icon="download"
      eyebrow={r?.name ?? 'Tournament'}
      description="The tournament report: figures, final standings, prize structure and payout status. Print it (or save it as PDF from the print dialog) or export it as JSON or CSV."
      actions={
        canExport && r ? (
          <>
            <Button size="sm" variant="primary" icon="file" onClick={() => window.print()}>
              Print / save as PDF
            </Button>
            <Button size="sm" variant="secondary" icon="download" loading={jsonBusy} loadingLabel="Preparing…" onClick={() => void exportJson()}>
              Export JSON
            </Button>
            <DownloadButton load={() => api.text('reportCsv', { id: tournamentId })} filename={reportFilename(r, 'csv')} what="report CSV">
              Export CSV
            </DownloadButton>
          </>
        ) : undefined
      }
    />
  );

  if (!canExport) {
    return (
      <div className="acr-page acr-reports">
        {header}
        <EmptyState icon="lock" title="Reports are restricted" description="Viewing and exporting reports requires the EXPORT_DATA permission. Ask a super admin if you need access." />
      </div>
    );
  }
  if (report.isLoading) {
    return (
      <div className="acr-page acr-reports" aria-busy="true" aria-label="Loading the report">
        {header}
        <div className="acr-reports-doc acr-reports-doc--loading">
          <Skeleton shape="block" height={72} />
          <Skeleton shape="block" height={180} />
          <Skeleton shape="block" height={260} />
        </div>
      </div>
    );
  }
  if (!r) {
    return (
      <div className="acr-page acr-reports">
        {header}
        <ErrorState title="Could not build the report" description={friendlyError(report.error).description} onRetry={() => void report.refetch()} />
      </div>
    );
  }

  return (
    <div className="acr-page acr-reports">
      {header}
      <div className="acr-reports-bar acr-reports-noprint">
        <span className={cx('acr-reports-bar__time', report.isStale && 'is-stale')}>
          {report.isStale ? 'Not current — last report ' : 'Report built by the server at '}
          {formatTimeOfDay(r.generatedAt)}
          {!final && !report.isStale && ' · refreshes every 30 s while the tournament runs'}
        </span>
        <Button size="sm" variant="ghost" icon="refresh" onClick={() => void report.refetch()} loading={report.fetching} loadingLabel="Refreshing…">
          Refresh
        </Button>
        <ButtonLink to={sectionHref('payouts', tournamentId)} icon="trophy">
          Payouts
        </ButtonLink>
        <ButtonLink to={sectionHref('standings', tournamentId)} icon="award">
          Standings
        </ButtonLink>
      </div>
      {report.isStale && (
        <div className="acr-reports-noprint">
          <Alert severity="WARNING" title="Could not refresh the report" actions={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void report.refetch()}>Retry</Button>}>
            The report below is greyed: it is the last version received, not current.
          </Alert>
        </div>
      )}
      <div className={cx('acr-reports-paper', report.isStale && 'jpb-stale')}>
        <ReportDocument report={r} tournamentId={tournamentId} />
      </div>
    </div>
  );
}
