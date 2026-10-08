import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The main entry runs in browsers (admin dashboard + public verify page).
 * Only src/node.ts may import Node built-ins or `@jpb/randomness/node`.
 */
const SRC = new URL('../src/', import.meta.url);
const NODE_ONLY = /from ['"]node:|from ['"]@jpb\/randomness\/node['"]|require\(|\bBuffer\b|\bprocess\./;

describe('portable main entry', () => {
  it('every source file except node.ts is portable, and index.ts does not import node.ts', () => {
    const files = readdirSync(SRC).filter((f) => f.endsWith('.ts') && f !== 'node.ts');
    expect(files).toContain('index.ts');
    for (const file of files) {
      const source = readFileSync(new URL(file, SRC), 'utf8');
      expect(NODE_ONLY.test(source), file).toBe(false);
      expect(/from ['"]\.\/node['"]/.test(source), file).toBe(false);
    }
  });
});
