import { createElement as h, useEffect, useState, type ReactNode } from 'react';
import { getPath, hasPath } from '@deepseek-ai/dsh-client-schema-form';
import { Button, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives';
import YAML from 'yaml';
import { emptyOf, formatCount, parseCount } from './draftOps';

type T = (key: string) => string;

/** Alias design tokens shared with the official GUI. */
const TOKENS = {
  labelPrimary: 'var(--dsw-alias-label-primary)',
  labelSecondary: 'var(--dsw-alias-label-secondary)',
  labelTertiary: 'var(--dsw-alias-label-tertiary)',
  borderL2: 'var(--dsw-alias-border-l2)',
  bgLayer3: 'var(--dsw-alias-bg-layer-3)',
  bgModulePlatform: 'var(--dsw-alias-bg-module-platform)',
  primaryFill: 'var(--dsw-alias-button-primary-fill)',
  primaryForeground: 'var(--dsw-alias-label-primary-foreground)',
};

/** Minimal structural view of a rehydrated schemastery node. */
export interface SchemaNodeLike {
  type: string;
  dict?: Record<string, SchemaNodeLike>;
  inner?: SchemaNodeLike;
  list?: SchemaNodeLike[];
  meta?: { role?: string; default?: unknown; required?: boolean; description?: string | Record<string, string> };
  /** `const` nodes carry their fixed value (used as union discriminators). */
  value?: unknown;
}

export interface SchemaFormProps {
  node: SchemaNodeLike;
  draft: Record<string, unknown>;
  resolved: unknown;
  set: (path: string[], value: unknown) => void;
  reset: (path: string[]) => void;
  t: T;
}

const ROW: Record<string, unknown> = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};
/** Field label, matching the official plugin-config fields (13px/500/primary). */
const LABEL: Record<string, unknown> = {
  minWidth: 0,
  flex: 1,
  fontSize: '13px',
  fontWeight: 500,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-primary)',
};
/** Control styling matching the official plugin-config input. */
const INPUT_STYLE: Record<string, unknown> = {
  boxSizing: 'border-box',
  border: '1px solid var(--dsw-alias-border-l2)',
  width: '100%',
  height: 34,
  background: 'var(--dsw-alias-bg-layer-3)',
  color: 'var(--dsw-alias-label-primary)',
  borderRadius: 8,
  padding: '0 12px',
  fontSize: 13,
  lineHeight: 1.5,
};
/** Borderless text reset button, matching the official plugin-config fields. */
const RESET_BTN: Record<string, unknown> = {
  font: 'inherit',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  padding: 0,
  fontSize: 12,
  lineHeight: 1.5,
};
const MONO: Record<string, unknown> = {
  fontFamily: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
};

function indent(depth: number): Record<string, unknown> {
  return depth > 0 ? { marginLeft: '18px' } : {};
}

/**
 * Resolve a schema `meta.description` (plain string or `{zh, en}` dict) to the
 * active-UI language. Returns `undefined` when the field has no description.
 */
function descriptionText(desc: string | Record<string, string> | undefined): string | undefined {
  if (typeof desc === 'string') return desc;
  if (desc === null || typeof desc !== 'object') return undefined;
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'en';
  const candidates = [lang, lang?.split('-')[0], 'en', 'zh'];
  for (const key of candidates) {
    const v = key !== undefined ? desc[key] : undefined;
    if (typeof v === 'string') return v;
  }
  const first = Object.values(desc).find((v) => typeof v === 'string');
  return first as string | undefined;
}

function FieldRow(props: {
  label: string;
  node: SchemaNodeLike;
  present: boolean;
  onReset: () => void;
  t: T;
  divider?: boolean;
  children: ReactNode;
}): ReactNode {
  return h(
    'div',
    {
      style: {
        padding: '12px 0',
        borderTop: props.divider ? '1px solid var(--dsw-alias-border-l2)' : undefined,
      },
    },
    h(
      'div',
      { style: ROW },
      h('span', { style: LABEL }, props.label),
      props.node.meta?.required
        ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', flexShrink: 0 } }, props.t('required'))
        : null,
      props.present
        ? h('span', {
            title: props.t('overridden'),
            style: {
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: TOKENS.primaryFill,
              flexShrink: 0,
            },
          })
        : null,
      props.present
        ? h(
            'button',
            { type: 'button', onClick: props.onReset, style: RESET_BTN },
            props.t('reset'),
          )
        : null,
    ),
    props.children,
    descriptionText(props.node.meta?.description)
      ? h(
          'div',
          { style: { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 } },
          descriptionText(props.node.meta?.description),
        )
      : null,
  );
}

function JsonFallback(props: { value: unknown; t: T }): ReactNode {
  const text = JSON.stringify(props.value, null, 2);
  return h(
    'div',
    null,
    h(
      'div',
      { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 4 } },
      props.t('readonlyJson'),
    ),
    h(
      'pre',
      { style: { ...MONO, fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, padding: '10px', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2)' } },
      text || '∅',
    ),
  );
}

function NumberField(props: {
  path: string[];
  value: number | undefined;
  set: (path: string[], value: unknown) => void;
  reset: (path: string[]) => void;
  t: T;
}): ReactNode {
  const [text, setText] = useState(props.value === undefined ? '' : formatCount(props.value));
  useEffect(() => {
    setText(props.value === undefined ? '' : formatCount(props.value));
  }, [props.path.join('\u0000')]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (): void => {
    if (text.trim() === '') {
      // Empty = not set: drop any override and fall back to the inherited state.
      props.reset(props.path);
      return;
    }
    const parsed = parseCount(text);
    if (parsed !== undefined) props.set(props.path, parsed);
    else setText(props.value === undefined ? '' : formatCount(props.value));
  };
  return h('input', {
    type: 'text',
    value: text,
    placeholder: props.t('unset'),
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: commit,
    onKeyDown: (e: { key: string }) => {
      if (e.key === 'Enter') commit();
    },
    style: INPUT_STYLE,
  });
}

/**
 * Recursive schema-driven field renderer (M2): renders object/dict/array/
 * tuple containers and scalar controls against the draft, marking
 * presence-based override state and resolving inherited display values from
 * the resolved layer. All edits are `set`/`reset` path ops on the draft.
 */
function Field(props: {
  node: SchemaNodeLike;
  path: string[];
  draftValue: unknown;
  resolvedValue: unknown;
  draft: Record<string, unknown>;
  set: (path: string[], value: unknown) => void;
  reset: (path: string[]) => void;
  t: T;
  depth: number;
}): ReactNode {
  const { node, path, draftValue, resolvedValue, draft, set, reset, t, depth } = props;
  const present = hasPath(draft, path);

  if (node.type === 'object') {
    const dict = node.dict ?? {};
    return h(
      'div',
      { style: indent(depth) },
      Object.entries(dict).map(([key, child], index) => {
        const divider = index > 0 ? '1px solid var(--dsw-alias-border-l2)' : undefined;
        if (child.type === 'const') {
          // Fixed values (e.g. a union discriminator left in a member) are
          // read-only plain text, no form row.
          return h(
            'div',
            {
              key: key,
              style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0', borderTop: divider },
            },
            h('span', { style: LABEL }, key),
            h('span', { style: { fontSize: '12px', color: TOKENS.labelSecondary } }, String(child.value)),
          );
        }
        const childPath = [...path, key];
        const childPresent = hasPath(draft, childPath);
        if (child.type === 'boolean') {
          // Settings-style toggle row: label left, switch right.
          const checked = childPresent
            ? Boolean(getPath(draft, childPath))
            : Boolean(getPath(resolvedValue, [key]));
          return h(
            'div',
            {
              key: key,
              style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 0', borderTop: divider },
            },
            h('span', { style: LABEL }, key),
            childPresent
              ? h('span', {
                  title: t('overridden'),
                  style: { width: 7, height: 7, borderRadius: '50%', background: TOKENS.primaryFill, flexShrink: 0 },
                })
              : null,
            h(
              'span',
              { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' } },
              h(SwitchField, { checked, onChange: (v) => set(childPath, v) }),
              childPresent
                ? h('button', { type: 'button', onClick: () => reset(childPath), style: RESET_BTN }, t('reset'))
                : null,
            ),
          );
        }
        return h(
          FieldRow,
          {
            key: key,
            label: key,
            node: child,
            present: childPresent,
            onReset: () => reset(childPath),
            divider: index > 0,
            t,
            children: h(Field, {
              node: child,
              path: childPath,
              draftValue: childPresent ? getPath(draft, childPath) : undefined,
              resolvedValue: getPath(resolvedValue, [key]),
              draft,
              set,
              reset,
              t,
              depth: depth + 1,
            }),
          },
        );
      }),
    );
  }

  if (node.type === 'array') {
    return h(ArrayField, { node, path, draftValue, resolvedValue, draft, set, reset, t, depth });
  }

  if (node.type === 'dict') {
    return h(DictField, { node, path, draftValue, resolvedValue, draft, set, reset, t, depth });
  }

  // scalar controls
  const value = present ? draftValue : resolvedValue;

  if (node.type === 'boolean') {
    const checked = Boolean(value);
    return h(SwitchField, { checked, onChange: (v) => set(path, v) });
  }

  if (node.type === 'number') {
    return h(NumberField, {
      path,
      value: typeof value === 'number' ? value : undefined,
      set,
      reset,
      t,
    });
  }

  if (node.type === 'string') {
    if (node.meta?.role === 'secret') {
      return h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('secretHint'));
    }
    return h('input', {
      type: 'text',
      value: typeof value === 'string' ? value : '',
      onChange: (e: { target: { value: string } }) => set(path, e.target.value),
      placeholder: node.meta?.description ?? '',
      style: INPUT_STYLE,
    });
  }

  if (node.type === 'const') {
    return h('span', { style: { fontSize: '12px', color: TOKENS.labelSecondary } }, String(node.value));
  }

  if (node.type === 'union') {
    const members = node.list ?? [];
    if (members.length === 0) return JsonFallback({ value: present ? draftValue : resolvedValue, t });
    return h(UnionField, { node, path, draftValue, resolvedValue, draft, set, reset, t, depth });
  }

  // intersect / transform / unknown → read-only JSON (v1)
  return JsonFallback({ value: present ? draftValue : resolvedValue, t });
}

/** A union member's const discriminator, e.g. `{ key: 'mode', value: 'always' }`. */
function unionDiscriminator(member: SchemaNodeLike): { key: string; value: unknown } | undefined {
  if (member.type !== 'object' || !member.dict) return undefined;
  for (const [key, child] of Object.entries(member.dict)) {
    if (child.type === 'const') return { key, value: child.value };
  }
  return undefined;
}

function unionBranchLabel(member: SchemaNodeLike, t: T): string {
  if (member.type === 'const') return String(member.value);
  const disc = unionDiscriminator(member);
  if (disc) return String(disc.value);
  return t('unionCustom');
}

/** The member without its const discriminator field (rendered by the selector). */
function memberWithoutDiscriminator(member: SchemaNodeLike): SchemaNodeLike {
  const disc = unionDiscriminator(member);
  if (!disc || !member.dict) return member;
  const dict = { ...member.dict };
  delete dict[disc.key];
  return { ...member, dict };
}

/** Branch selector + the selected member's fields, rendered in place. */
function UnionField(props: {
  node: SchemaNodeLike;
  path: string[];
  draftValue: unknown;
  resolvedValue: unknown;
  draft: Record<string, unknown>;
  set: (path: string[], value: unknown) => void;
  reset: (path: string[]) => void;
  t: T;
  depth: number;
}): ReactNode {
  const { node, path, draftValue, resolvedValue, draft, set, reset, t, depth } = props;
  const members = node.list ?? [];
  const present = draftValue !== undefined;
  const probe = (present ? draftValue : resolvedValue) as Record<string, unknown> | null | undefined;
  let current = 0;
  if (probe !== null && typeof probe === 'object' && !Array.isArray(probe)) {
    const found = members.findIndex((m) => {
      if (m.type === 'const') return probe === m.value;
      const disc = unionDiscriminator(m);
      return (
        disc !== undefined &&
        Object.prototype.hasOwnProperty.call(probe, disc.key) &&
        probe[disc.key] === disc.value
      );
    });
    if (found !== -1) current = found;
  } else if (typeof probe === 'string' || typeof probe === 'number') {
    const found = members.findIndex((m) => m.type === 'const' && m.value === probe);
    if (found !== -1) current = found;
  }
  const member = members[current] ?? members[0];
  return h(
    'div',
    { style: indent(depth) },
    h(
      'div',
      { style: { display: 'inline-flex', gap: 2, marginBottom: '6px', flexWrap: 'wrap' } },
      members.map((m, i) => {
          const active = i === current;
          return h(
            'button',
            {
              key: i,
              type: 'button',
              onClick: () => {
                if (m.type === 'const') {
                  set(path, m.value);
                  return;
                }
                const disc = unionDiscriminator(m);
                if (disc) set(path, { [disc.key]: disc.value });
                else if (present) set(path, {});
                else reset(path);
              },
              style: {
                border: 'none',
                background: active ? TOKENS.primaryFill : 'transparent',
                color: active ? TOKENS.primaryForeground : TOKENS.labelSecondary,
                borderRadius: 999,
                padding: '5px 14px',
                fontSize: 13,
                cursor: 'pointer',
              },
            },
            unionBranchLabel(m, t),
          );
        }),
      ),
    h(Field, {
      node: memberWithoutDiscriminator(member),
      path,
      draftValue: present ? draftValue : undefined,
      resolvedValue,
      draft,
      set,
      reset,
      t,
      depth: depth + 1,
    }),
  );
}

const MINI_BTN: Record<string, unknown> = {
  border: 'none',
  background: 'transparent',
  borderRadius: 999,
  padding: '2px 10px',
  fontSize: 11,
  color: TOKENS.labelSecondary,
  cursor: 'pointer',
};
const MINI_ACTIVE: Record<string, unknown> = { background: TOKENS.primaryFill, color: TOKENS.primaryForeground };

function miniToggle(mode: 'form' | 'json', current: 'form' | 'json', onPick: (m: 'form' | 'json') => void, t: T): ReactNode {
  return h(
    'div',
    { style: { display: 'inline-flex', gap: 2, padding: 2, border: `1px solid ${TOKENS.borderL2}`, borderRadius: 999, marginBottom: 6 } },
    h('button', { type: 'button', style: { ...MINI_BTN, ...(current === 'form' ? MINI_ACTIVE : {}) }, onClick: () => onPick('form') }, t('form')),
    h('button', { type: 'button', style: { ...MINI_BTN, ...(current === 'json' ? MINI_ACTIVE : {}) }, onClick: () => onPick('json') }, t('json')),
  );
}

/** One-line summary for a structured array item (used as its collapsed title). */
function itemSummary(inner: SchemaNodeLike, item: unknown, index: number, t: T): string {
  if (inner.type === 'object' && item !== null && typeof item === 'object' && !Array.isArray(item)) {
    const o = item as Record<string, unknown>;
    for (const key of ['id', 'name', 'model', 'displayName']) {
      const v = o[key];
      if ((typeof v === 'string' && v !== '') || typeof v === 'number') return `${key}: ${String(v)}`;
    }
    return `#${index}`;
  }
  if (inner.type === 'dict' && item !== null && typeof item === 'object' && !Array.isArray(item)) {
    return `${t('entries')} ${Object.keys(item as Record<string, unknown>).length}`;
  }
  return `#${index}`;
}

/** Array editor; structured items (object/dict) collapse to a summary row. */
function ArrayField(props: {
  node: SchemaNodeLike;
  path: string[];
  draftValue: unknown;
  resolvedValue: unknown;
  draft: Record<string, unknown>;
  set: (path: string[], value: unknown) => void;
  reset: (path: string[]) => void;
  t: T;
  depth: number;
}): ReactNode {
  const { node, path, draftValue, resolvedValue, draft, set, reset, t, depth } = props;
  const inner = node.inner;
  const [open, setOpen] = useState<number | null>(null);
  if (!inner) return JsonFallback({ value: draftValue !== undefined ? draftValue : resolvedValue, t });
  const present = draftValue !== undefined;
  const arr: unknown[] = present
    ? Array.isArray(draftValue)
      ? draftValue
      : []
    : Array.isArray(resolvedValue)
      ? resolvedValue
      : [];
  if (!present) {
    return h(
      'div',
      null,
      h('div', { style: { fontSize: 12, color: TOKENS.labelTertiary, marginBottom: 4 } }, t('editArrayNote')),
      h(Button, { variant: 'outline', size: 'sm', onClick: () => set(path, structuredClone(arr)) }, t('edit')),
    );
  }
  const structured = inner.type === 'object' || inner.type === 'dict';
  const addRow = (): void => {
    set(path, [...arr, emptyOf(inner)]);
    setOpen(arr.length);
  };
  return h(
    'div',
    { style: indent(depth) },
    arr.map((item, index) => {
      const itemPath = [...path, String(index)];
      const itemResolved = Array.isArray(resolvedValue) ? getPath(resolvedValue, [String(index)]) : undefined;
      if (!structured) {
        return h(
          'div',
          {
            key: String(index),
            style: { display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 4 },
          },
          h('span', { style: { fontSize: 12, paddingTop: 4, opacity: 0.7 } }, String(index)),
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h(Field, { node: inner, path: itemPath, draftValue: item, resolvedValue: itemResolved, draft, set, reset, t, depth: depth + 1 }),
          ),
          h(Button, { variant: 'ghost', size: 'sm', onClick: () => set(path, arr.filter((_, j) => j !== index)) }, '×'),
        );
      }
      const expanded = open === index;
      return h(
        'div',
        { key: String(index), style: { borderTop: index > 0 ? `1px solid ${TOKENS.borderL2}` : undefined } },
        h(
          'div',
          {
            onClick: () => setOpen(expanded ? null : index),
            style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 2px', cursor: 'pointer' },
          },
          h(
            'span',
            {
              style: {
                display: 'flex',
                color: TOKENS.labelTertiary,
                transform: expanded ? 'rotate(180deg)' : undefined,
                transition: 'transform 0.16s',
              },
            },
            h(IconChevronDownOutline14, { size: 14 }),
          ),
          h(
            'span',
            { style: { fontSize: 13, fontWeight: 500, color: TOKENS.labelPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 } },
            itemSummary(inner, item, index, t),
          ),
          h(
            'span',
            { style: { display: 'flex' } },
            h(Button, {
              variant: 'ghost',
              size: 'sm',
              onClick: (e: { stopPropagation(): void }) => {
                e.stopPropagation();
                set(path, arr.filter((_, j) => j !== index));
              },
            }, '×'),
          ),
        ),
        expanded
          ? h(
              'div',
              { style: { paddingLeft: 6 } },
              h(Field, { node: inner, path: itemPath, draftValue: item, resolvedValue: itemResolved, draft, set, reset, t, depth: depth + 1 }),
            )
          : null,
      );
    }),
    h(Button, { variant: 'outline', size: 'sm', onClick: addRow }, t('addRow')),
  );
}

/** Dict editor with a 表单 / JSON raw-edit toggle for custom structures. */
function DictField(props: {
  node: SchemaNodeLike;
  path: string[];
  draftValue: unknown;
  resolvedValue: unknown;
  draft: Record<string, unknown>;
  set: (path: string[], value: unknown) => void;
  reset: (path: string[]) => void;
  t: T;
  depth: number;
}): ReactNode {
  const { node, path, draftValue, resolvedValue, draft, set, reset, t, depth } = props;
  const inner = node.inner;
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [text, setText] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | undefined>();
  if (!inner) return JsonFallback({ value: draftValue !== undefined ? draftValue : resolvedValue, t });
  const present = draftValue !== undefined;
  const value = present ? draftValue : resolvedValue;

  useEffect(() => {
    if (mode === 'json') {
      setText((cur) => (cur !== null ? cur : YAML.stringify(value === undefined ? {} : value, { lineWidth: 0 })));
      setJsonError(undefined);
    } else {
      setText(null);
      setJsonError(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const commit = (): void => {
    if (text === null) return;
    const trimmed = text.trim();
    if (trimmed === '') {
      reset(path);
      setJsonError(undefined);
      return;
    }
    try {
      const parsed = YAML.parse(text);
      set(path, parsed);
      setJsonError(undefined);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
    }
  };

  if (mode === 'json') {
    return h(
      'div',
      { style: indent(depth) },
      miniToggle('form', mode, setMode, t),
      h('textarea', {
        value: text ?? '',
        spellCheck: false,
        onChange: (e: { target: { value: string } }) => setText(e.target.value),
        onBlur: commit,
        onKeyDown: (e: { key: string; ctrlKey: boolean; metaKey: boolean }) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') commit();
        },
        style: {
          boxSizing: 'border-box',
          width: '100%',
          minHeight: 120,
          resize: 'vertical',
          fontFamily: 'var(--dsw-font-mono, ui-monospace, Menlo, monospace)',
          fontSize: 13,
          lineHeight: 1.5,
          background: TOKENS.bgLayer3,
          color: TOKENS.labelPrimary,
          border: `1px solid ${TOKENS.borderL2}`,
          borderRadius: 8,
          padding: 10,
        },
      }),
      jsonError ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-error)', marginTop: 4 } }, jsonError) : null,
      h('div', { style: { fontSize: 12, color: TOKENS.labelTertiary, marginTop: 4 } }, t('jsonHint')),
    );
  }

  let presentValue: Record<string, unknown> | undefined;
  if (present && typeof draftValue === 'object' && draftValue !== null && !Array.isArray(draftValue)) {
    presentValue = draftValue as Record<string, unknown>;
  }
  if (!present || presentValue === undefined) {
    const inherited =
      resolvedValue !== null && typeof resolvedValue === 'object' && !Array.isArray(resolvedValue)
        ? (resolvedValue as Record<string, unknown>)
        : {};
    return h(
      'div',
      null,
      miniToggle('form', mode, setMode, t),
      h('div', { style: { fontSize: 12, color: TOKENS.labelTertiary, marginBottom: 4 } }, t('editArrayNote')),
      h(Button, { variant: 'outline', size: 'sm', onClick: () => set(path, structuredClone(inherited)) }, t('edit')),
    );
  }
  return h(
    'div',
    { style: indent(depth) },
    miniToggle('form', mode, setMode, t),
    Object.entries(presentValue).map(([key, item]) =>
      h(
        'div',
        {
          key: key,
          style: { display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 4 },
        },
        h('span', { style: { fontSize: 12, paddingTop: 4, opacity: 0.7 } }, key),
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h(Field, {
            node: inner,
            path: [...path, key],
            draftValue: item,
            resolvedValue: getPath(resolvedValue, [key]),
            draft,
            set,
            reset,
            t,
            depth: depth + 1,
          }),
        ),
        h(Button, { variant: 'ghost', size: 'sm', onClick: () => reset([...path, key]) }, '×'),
      ),
    ),
    h(DictAddRow, { path, present: presentValue, inner, set, t }),
  );
}

/** Inline "new dict entry" row: a key input plus an add button. */
function DictAddRow(props: {
  path: string[];
  present: Record<string, unknown>;
  inner: SchemaNodeLike;
  set: (path: string[], value: unknown) => void;
  t: T;
}): ReactNode {
  const [key, setKey] = useState('');
  const add = (): void => {
    const k = key.trim();
    if (!k) return;
    props.set([...props.path, k], emptyOf(props.inner));
    setKey('');
  };
  return h(
    'div',
    { style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' } },
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h('input', {
        type: 'text',
        value: key,
        placeholder: 'key',
        onChange: (e: { target: { value: string } }) => setKey(e.target.value),
        onKeyDown: (e: { key: string }) => {
          if (e.key === 'Enter') add();
        },
        style: INPUT_STYLE,
      }),
    ),
    h(Button, { variant: 'outline', size: 'sm', onClick: add }, props.t('addRow')),
  );
}

/** Minimal switch, styled with the alias design tokens. */
function SwitchField(props: { checked: boolean; onChange: (value: boolean) => void }): ReactNode {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': props.checked,
      onClick: () => props.onChange(!props.checked),
      style: {
        width: 36,
        height: 20,
        borderRadius: 999,
        border: 'none',
        background: props.checked ? TOKENS.primaryFill : 'var(--dsw-alias-border-l2)',
        padding: 0,
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.15s ease',
        flexShrink: 0,
      },
    },
    h('span', {
      style: {
        position: 'absolute',
        top: 2,
        left: props.checked ? 18 : 2,
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: '#ffffff',
        transition: 'left 0.15s ease',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
      },
    }),
  );
}

/** Root entry: renders the schema tree against a user-layer draft. */
export function SchemaForm(props: SchemaFormProps): ReactNode {
  const { node, draft, resolved, set, reset, t } = props;
  return h(
    'div',
    { style: { overflowX: 'auto', maxWidth: '100%' } },
    h(Field, {
      node,
      path: [],
      draftValue: draft,
      resolvedValue: resolved,
      draft,
      set,
      reset,
      t,
      depth: 0,
    }),
  );
}
