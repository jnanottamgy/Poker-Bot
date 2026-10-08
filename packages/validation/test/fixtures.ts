import { expect } from 'vitest';
import type { TournamentConfig } from '@jpb/shared-types';
import { defaultTournamentConfig } from '../src';
import type { TournamentConfigOverrides, ValidationResult } from '../src';

/** A fresh valid config with deep overrides. */
export function config(overrides: TournamentConfigOverrides = {}): TournamentConfig {
  return defaultTournamentConfig(overrides);
}

/** Paths of every issue of a failed result (empty when ok). */
export function issuePaths<T>(result: ValidationResult<T>): string[] {
  return result.ok ? [] : result.error.issues.map((i) => i.path);
}

/** Asserts failure with an issue at `path` (optionally whose message contains `text`). */
export function expectIssue<T>(result: ValidationResult<T>, path: string, text?: string): void {
  expect(result.ok, `expected failure at ${path}`).toBe(false);
  if (result.ok) return;
  const atPath = result.error.issues.filter((i) => i.path === path);
  expect(atPath.length, `no issue at "${path}"; got ${JSON.stringify(result.error.issues.map((i) => `${i.path}: ${i.message}`))}`).toBeGreaterThan(0);
  if (text !== undefined) {
    expect(atPath.some((i) => i.message.includes(text)), `messages at ${path}: ${JSON.stringify(atPath.map((i) => i.message))}`).toBe(true);
  }
}

/** Asserts success and returns the value. */
export function expectOk<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error.issues.map((i) => `${i.path}: ${i.message}`))}`);
  return result.value;
}

/** A copy of `obj` with `path` set to `value`; missing or non-object intermediates become {} / []. */
export function withPath(obj: unknown, path: ReadonlyArray<string | number>, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path as [string | number, ...Array<string | number>];
  const container: unknown = typeof obj === 'object' && obj !== null ? obj : typeof head === 'number' ? [] : {};
  const copy: Record<string | number, unknown> = Array.isArray(container)
    ? ([...container] as unknown as Record<number, unknown>)
    : { ...(container as Record<string, unknown>) };
  copy[head] = withPath((container as Record<string | number, unknown>)[head], rest, value);
  return copy;
}
