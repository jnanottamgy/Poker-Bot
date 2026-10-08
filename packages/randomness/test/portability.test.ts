import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The main entry must run in browsers (public fairness verifier). Every
 * module reachable from src/index.ts must be free of Node built-ins and
 * Node-only globals; only src/node.ts may use them.
 */
const SRC = new URL('../src/', import.meta.url);
const NODE_ONLY = /from ['"]node:|require\(|\bBuffer\b|\bprocess\./;

function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(new URL(file, SRC), 'utf8');
    for (const m of source.matchAll(/from ['"]\.\/([\w-]+)['"]/g)) visit(`${m[1]}.ts`);
  };
  visit(entry);
  return seen;
}

describe('portable main entry', () => {
  it('index.ts reaches no Node-only module', () => {
    const files = reachableFrom('index.ts');
    expect(files.has('node.ts')).toBe(false);
    for (const file of files) expect(NODE_ONLY.test(readFileSync(new URL(file, SRC), 'utf8')), file).toBe(false);
  });

  it('every source file except node.ts is portable', () => {
    for (const file of readdirSync(SRC).filter((f) => f.endsWith('.ts') && f !== 'node.ts')) {
      expect(NODE_ONLY.test(readFileSync(new URL(file, SRC), 'utf8')), file).toBe(false);
    }
  });
});
