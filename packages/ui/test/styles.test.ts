/**
 * Guards on the stylesheet (stands in for stylelint, which is not a dependency):
 * - no font-size below 12px (critical info is never tiny);
 * - WCAG contrast of the token pairs that carry text, in normal AND high contrast.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom gives import.meta.url an http: scheme, so locate the file from the working directory.
const cssPath = ['packages/ui/src/styles.css', 'src/styles.css', '../src/styles.css'].map((p) => resolvePath(process.cwd(), p)).find((p) => existsSync(p));
if (!cssPath) throw new Error('styles.css not found');
const css = readFileSync(cssPath, 'utf8');

/** Declarations of the first rule block whose selector starts exactly with `selector {`. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1] as string] = (m[2] as string).trim();
  return out;
}

function hex(c: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) throw new Error(`not a hex colour: ${c}`);
  const h = (m[1] as string).length === 3 ? [...(m[1] as string)].map((x) => x + x).join('') : (m[1] as string);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(hex(a)), luminance(hex(b))].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const root = block(':root');
const hc = { ...root, ...block("[data-contrast='high']") };
const resolve = (tokens: Record<string, string>, v: string): string => {
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  return m ? resolve(tokens, tokens[m[1] as string] as string) : v;
};

describe('styles: type scale floor', () => {
  it('has no literal font-size below 12px', () => {
    const tiny = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((m) => Number(m[1]) < 12).map((m) => m[0]);
    expect(tiny).toEqual([]);
  });
  it('the smallest token is 12px', () => {
    expect(root['--jpb-fs-xs']).toBe('12px');
  });
});

describe('styles: token contrast (WCAG AA 4.5:1 for text)', () => {
  const pairs: Array<[string, string, number]> = [
    ['--jpb-text', '--jpb-bg', 4.5],
    ['--jpb-text-2', '--jpb-surface', 4.5],
    ['--jpb-text-muted', '--jpb-surface', 4.5],
    ['--jpb-danger-ink', '--jpb-danger', 4.5],
    ['--jpb-danger-ink', '--jpb-danger-strong', 4.5],
    ['--jpb-accent-ink', '--jpb-accent', 4.5],
    ['--jpb-gold-ink', '--jpb-gold', 4.5],
    ['--jpb-text-inverse', '--jpb-text', 4.5],
    ['--jpb-warning', '--jpb-surface', 4.5],
    ['--jpb-danger', '--jpb-surface', 4.5],
    ['--jpb-info', '--jpb-surface', 4.5],
  ];
  for (const [theme, tokens] of [
    ['normal', root],
    ['high contrast', hc],
  ] as const) {
    it.each(pairs)(`${theme}: %s on %s`, (fg, bg, min) => {
      const ratio = contrast(resolve(tokens, tokens[fg] as string), resolve(tokens, tokens[bg] as string));
      expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
    });
  }
  it('warning (orange) and gold are distinguishable (not the same hue family at a glance)', () => {
    const [wr, wg] = hex(resolve(root, root['--jpb-warning'] as string));
    const [gr, gg] = hex(resolve(root, root['--jpb-gold'] as string));
    // gold is yellow-ish (green channel high), warning is orange (green channel clearly lower)
    expect(gg - wg).toBeGreaterThan(30);
    expect(Math.abs(wr - gr)).toBeLessThan(40);
  });
  it('the prefers-contrast block mirrors the high-contrast tokens', () => {
    expect(css).toMatch(/@media \(prefers-contrast: more\)/);
    expect(css).toContain("[data-contrast='normal']");
  });
});
