import { createHash } from 'node:crypto';
import { canonicalJson } from '../util/canonical-json';

/**
 * Tamper-evident audit chain (spec §57). Each entry's hash covers the
 * previous entry's hash plus the canonical JSON of its own content, so any
 * edit, deletion or reordering breaks verification from that point on.
 */
export const AUDIT_GENESIS_HASH = '0'.repeat(64);

export interface AuditContent {
  id: string;
  at: number;
  tournamentId: string | null;
  adminId: string | null;
  adminUsername: string;
  action: string;
  target: string;
  reason: string | null;
  beforeState: unknown;
  afterState: unknown;
  ip: string | null;
}

export function auditHash(prevHash: string, content: AuditContent): string {
  return createHash('sha256').update(prevHash).update('\n').update(canonicalJson(content)).digest('hex');
}

export interface ChainedAuditEntry extends AuditContent {
  prevHash: string;
  hash: string;
}

export function chainEntry(prevHash: string, content: AuditContent): ChainedAuditEntry {
  return { ...content, prevHash, hash: auditHash(prevHash, content) };
}

/** Verifies an ordered list of entries. Returns the index of the first broken entry, or -1 if intact. */
export function verifyAuditChain(entries: readonly ChainedAuditEntry[], startPrevHash = AUDIT_GENESIS_HASH): number {
  let prev = startPrevHash;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const { prevHash, hash, ...content } = e;
    if (prevHash !== prev || auditHash(prev, content) !== hash) return i;
    prev = hash;
  }
  return -1;
}
