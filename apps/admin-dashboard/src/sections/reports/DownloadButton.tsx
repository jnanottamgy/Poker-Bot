import { useState } from 'react';
import { Button, formatCount, useToast } from '@jpb/ui';
import type { ButtonProps } from '@jpb/ui';
import { CSV_MIME, csvRowCount, saveFile } from './download';

export interface DownloadButtonProps extends Omit<ButtonProps, 'onClick' | 'loading'> {
  /** Fetches the file content (CSV text from the API). */
  load: () => Promise<string>;
  filename: string;
  mime?: string;
  /** What the file is, for the toasts ("standings CSV"). */
  what: string;
}

/**
 * Export button: fetches the file through the API client, then saves it.
 * Shows "Preparing…" while the server builds the file and a friendly toast
 * if it fails (permission, network) — never a raw error page.
 */
export function DownloadButton({ load, filename, mime = CSV_MIME, what, children, icon = 'download', variant = 'secondary', size = 'sm', ...rest }: DownloadButtonProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const text = await load();
      const ok = saveFile(filename, text, mime);
      if (!ok) {
        toast.push({ tone: 'warning', title: 'This browser cannot save files', description: 'Try another browser, or use the server export from a workstation.' });
        return;
      }
      const rows = mime === CSV_MIME ? csvRowCount(text) : null;
      toast.push({ tone: 'success', title: `Downloaded ${what}`, description: rows === null ? filename : `${filename} · ${formatCount(rows)} ${rows === 1 ? 'row' : 'rows'}` });
    } catch {
      toast.push({ tone: 'danger', title: `Could not prepare the ${what}`, description: 'The server did not return the file. Check your connection and permissions, then try again.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button {...rest} variant={variant} size={size} icon={icon} loading={busy} loadingLabel="Preparing…" onClick={() => void run()}>
      {children}
    </Button>
  );
}
