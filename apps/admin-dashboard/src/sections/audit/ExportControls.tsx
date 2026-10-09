import { useState } from 'react';
import { Button, formatCount, useToast } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import type { AuditQuery } from '../../api/types';
import { CSV_MIME, fileStamp, saveFile, saveJson } from '../reports/download';
import { auditCsv } from './model';
import type { AuditFilters, DateRange } from './model';
import { collectAll } from './useAuditPages';

export interface ExportControlsProps {
  query: AuditQuery;
  range: DateRange;
  filters: AuditFilters;
  slug: string;
}

/**
 * CSV and JSON exports of the filtered log. Without a date range the CSV is
 * the server's own audit.csv (admin / action / target filters, hash columns);
 * with a date range — which the API cannot filter — both files are built here
 * from the same paged entries, with the same columns.
 */
export function ExportControls({ query, range, filters, slug }: ExportControlsProps) {
  const api = useApi();
  const toast = useToast();
  const [busy, setBusy] = useState<'csv' | 'json' | null>(null);
  const [scanned, setScanned] = useState(0);
  const dated = range.from !== null || range.to !== null;
  const name = (ext: string) => `audit-${slug}-${fileStamp(Date.now())}.${ext}`;

  const run = async (kind: 'csv' | 'json') => {
    if (busy) return;
    setBusy(kind);
    setScanned(0);
    try {
      if (kind === 'csv' && !dated) {
        const text = await api.text('auditCsv', undefined, { tournamentId: query.tournamentId, adminId: query.adminId, action: query.action, target: query.target });
        if (!saveFile(name('csv'), text, CSV_MIME)) throw new Error('save');
        toast.push({ tone: 'success', title: 'Downloaded the audit log CSV', description: name('csv') });
        return;
      }
      const { entries, complete } = await collectAll((q, s) => api.audit.list(q, s), query, range, setScanned);
      const ok =
        kind === 'csv'
          ? saveFile(name('csv'), auditCsv(entries), CSV_MIME)
          : saveJson(name('json'), { exportedAt: new Date().toISOString(), filters: { ...query, from: filters.from || null, to: filters.to || null }, complete, count: entries.length, entries });
      if (!ok) throw new Error('save');
      toast.push({
        tone: complete ? 'success' : 'warning',
        title: `Downloaded ${formatCount(entries.length)} audit ${entries.length === 1 ? 'entry' : 'entries'} (${kind.toUpperCase()})`,
        description: complete ? name(kind) : 'The export stopped at 100,000 scanned entries; narrow the filters for the rest.',
      });
    } catch {
      toast.push({ tone: 'danger', title: 'Could not export the audit log', description: 'The server did not return the entries. Check your connection and permissions (EXPORT_DATA), then try again.' });
    } finally {
      setBusy(null);
    }
  };

  const label = (kind: 'csv' | 'json') => (busy === kind && scanned > 0 ? `Scanning… ${formatCount(scanned)}` : 'Preparing…');
  return (
    <span className="acr-audit-export" role="group" aria-label="Export the filtered audit log">
      <Button size="sm" variant="secondary" icon="download" loading={busy === 'csv'} loadingLabel={label('csv')} disabled={busy !== null && busy !== 'csv'} onClick={() => void run('csv')} title={dated ? 'Built from the entries in the date range' : 'Server export with the hash columns'}>
        Export CSV
      </Button>
      <Button size="sm" variant="secondary" icon="download" loading={busy === 'json'} loadingLabel={label('json')} disabled={busy !== null && busy !== 'json'} onClick={() => void run('json')}>
        Export JSON
      </Button>
    </span>
  );
}
