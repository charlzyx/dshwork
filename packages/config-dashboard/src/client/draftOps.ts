import type { SchemaNodeLike } from './SchemaForm';

/** One `settings.mutate` path operation (the official wire vocabulary). */
export interface MutateOp {
  op: 'set' | 'unset';
  path: string[];
  value?: unknown;
}

/** Deep equality for JSON-compatible values (draft values are JSON-only). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  return ja === jb;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Diff the original stored user layer against the edited draft into minimal
 * path ops: a `set` per changed/added leaf, an `unset` per removed branch.
 * Mirrors the official Models editor's "minimal settings.mutate" convention —
 * the page mutates only the fields it can see instead of rebuilding a section.
 */
export function diffOps(original: unknown, next: Record<string, unknown>): MutateOp[] {
  const ops: MutateOp[] = [];
  const walk = (orig: unknown, nxt: unknown, path: string[]): void => {
    if (isPlainObject(orig) && isPlainObject(nxt)) {
      const keys = new Set([...Object.keys(orig), ...Object.keys(nxt)]);
      for (const key of keys) {
        const childPath = [...path, key];
        if (Object.prototype.hasOwnProperty.call(nxt, key)) {
          walk(orig[key], nxt[key], childPath);
        } else {
          ops.push({ op: 'unset', path: childPath });
        }
      }
      return;
    }
    if (Array.isArray(orig) && Array.isArray(nxt)) {
      if (!deepEqual(orig, nxt)) ops.push({ op: 'set', path, value: nxt });
      return;
    }
    if (!deepEqual(orig, nxt)) ops.push({ op: 'set', path, value: nxt });
  };
  walk(original, next, []);
  return ops;
}

/** Clone an unknown value into a JSON-safe plain object (draft container). */
export function toRecord(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return structuredClone(value) as Record<string, unknown>;
  return {};
}

/** Default draft element for a newly added array/dict row of the given node. */
export function emptyOf(node: SchemaNodeLike | undefined): unknown {
  if (!node) return null;
  if (node.type === 'object') {
    // Prefill declared defaults so an added object row starts usable.
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node.dict ?? {})) {
      if (child.meta?.default !== undefined) out[key] = child.meta.default;
    }
    return out;
  }
  if (node.type === 'array') return [];
  if (node.type === 'dict') return {};
  if (node.type === 'boolean') return false;
  if (node.type === 'number') return 0;
  if (node.type === 'string') return '';
  return null;
}

const SUFFIX_MULT: Record<string, number> = { K: 1e3, M: 1e6 };

/** Parse "256", "256K", "1M" into a plain count; undefined when unreadable. */
export function parseCount(text: string): number | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kKmM])?\s*$/.exec(text);
  if (!m) return undefined;
  const value = Number.parseFloat(m[1]);
  const mult = m[2] ? SUFFIX_MULT[m[2].toUpperCase()] : 1;
  const count = value * mult;
  return Number.isFinite(count) ? count : undefined;
}

/** Spell a plain count back in its shortest round-tripping form (256K, 1M…). */
export function formatCount(count: number): string {
  if (Number.isInteger(count) && count >= 1e6 && count % 1e6 === 0) return `${count / 1e6}M`;
  if (Number.isInteger(count) && count >= 1e3 && count % 1e3 === 0) return `${count / 1e3}K`;
  return String(count);
}
