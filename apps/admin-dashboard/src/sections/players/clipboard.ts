import { useCallback } from 'react';
import { useToast } from '@jpb/ui';

/** Copies text with the async Clipboard API, falling back to a hidden textarea (older / insecure contexts). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok: boolean;
  try {
    ok = typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** `copy(text, what)` → toast "Join link copied" (or a friendly fallback telling the operator to copy by hand). */
export function useCopy() {
  const toast = useToast();
  return useCallback(
    async (text: string, what: string) => {
      const ok = await copyText(text);
      toast.push(ok ? { tone: 'success', title: `${what} copied` } : { tone: 'warning', title: `Could not copy the ${what.toLowerCase()}`, description: 'Select the text and copy it by hand.' });
    },
    [toast],
  );
}
