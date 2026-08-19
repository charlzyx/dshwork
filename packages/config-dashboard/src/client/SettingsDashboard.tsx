import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { deletePath, rehydrateSchema, setPath, validateDraft } from '@deepseek-ai/dsh-client-schema-form';
import { Button, IconChevronDownOutline14, IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import YAML from 'yaml';
import { SchemaForm, type SchemaNodeLike } from './SchemaForm';
import { deepEqual, diffOps, toRecord } from './draftOps';
import { OTHER_GROUP_ID, groupIndexOf, orderedGroupIds } from './groups';
import type { ConfigDashboardApi, SettingsNamespaceView } from './index';

type T = (key: string) => string;

interface EditorState {
  ns: string;
  revision: number;
  original: Record<string, unknown>;
  draft: Record<string, unknown>;
  busy: boolean;
  error?: string;
}

type Tab = 'all' | 'host' | 'ui';

/** Alias design tokens used by the official GUI (see dshwork's PickList). */
const TOKENS = {
  labelPrimary: 'var(--dsw-alias-label-primary)',
  labelSecondary: 'var(--dsw-alias-label-secondary)',
  borderL2: 'var(--dsw-alias-border-l2)',
  bgLayer1: 'var(--dsw-alias-bg-layer-1)',
  bgLayer2: 'var(--dsw-alias-bg-layer-2)',
  primaryFill: 'var(--dsw-alias-button-primary-fill)',
  primaryForeground: 'var(--dsw-alias-label-primary-foreground)',
  labelTertiary: 'var(--dsw-alias-label-tertiary)',
  labelDimmed: 'var(--dsw-alias-label-dimmed)',
  bgLayer3: 'var(--dsw-alias-bg-layer-3)',
  bgModulePlatform: 'var(--dsw-alias-bg-module-platform)',
  borderL1: 'var(--dsw-alias-border-l1)',
  shadowLv1: 'var(--dsw-shadow-lv1)',
};

function rootNodeOf(ns: SettingsNamespaceView): SchemaNodeLike {
  return rehydrateSchema(ns.schema) as unknown as SchemaNodeLike;
}

function nodeTypeLabel(node: SchemaNodeLike): string {
  if (node.type === 'object') return 'object';
  if (node.type === 'dict') return `dict<${node.inner ? nodeTypeLabel(node.inner) : '?'}>`;
  if (node.type === 'array') return `array<${node.inner ? nodeTypeLabel(node.inner) : '?'}>`;
  if (node.type === 'tuple') return 'tuple';
  return node.type;
}

/**
 * Namespaces whose owning plugin ships its own client UI (has a bundle url in
 * the boot manifest), plus a curated fallback for GUI owned by the shell.
 * They are sorted last and default-collapsed — the dashboard is for the rest.
 */
function ownUiSet(): Set<string> {
  const set = new Set<string>();
  const boot = (window as unknown as {
    __DSH_BOOT__?: { entries?: Array<{ id?: string; url?: string }> };
  }).__DSH_BOOT__;
  for (const entry of boot?.entries ?? []) {
    if (!entry.url) continue; // host-only rows carry no client bundle
    const base = (entry.id ?? '').split('/').pop();
    if (base) set.add(base);
  }
  for (const ns of ['locale', 'ui-theme', 'ui-onboarding', 'skin-background', 'pet', 'remote-web-ui']) set.add(ns);
  return set;
}

const OWN_UI = ownUiSet();

const styles = {
  card: {
    borderRadius: 12,
    border: `1px solid ${TOKENS.borderL2}`,
    background: TOKENS.bgLayer3,
    overflow: 'hidden',
    marginBottom: 10,
    transition: 'border-color 0.16s, background 0.16s',
  },
  cardOpen: {
    borderRadius: 12,
    border: `1px solid ${TOKENS.borderL1}`,
    background: TOKENS.bgLayer2,
    boxShadow: TOKENS.shadowLv1,
    overflow: 'hidden',
    marginBottom: 10,
    transition: 'border-color 0.16s, background 0.16s',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    cursor: 'pointer',
  } as Record<string, unknown>,
  name: { fontWeight: 600, fontSize: 15, lineHeight: 1.4, color: TOKENS.labelPrimary },
  actions: { display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' },
  tag: {
    display: 'inline-block',
    whiteSpace: 'nowrap',
    background: TOKENS.bgModulePlatform,
    color: TOKENS.labelSecondary,
    borderRadius: 999,
    padding: '1px 8px',
    fontSize: 11,
    fontWeight: 500,
    lineHeight: '17px',
  },
  tabBar: {
    display: 'flex',
    gap: 6,
    padding: 3,
    border: `1px solid ${TOKENS.borderL2}`,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  tab: {
    padding: '5px 14px',
    borderRadius: 999,
    fontSize: 13,
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: TOKENS.labelSecondary,
  },
  tabActive: { background: TOKENS.primaryFill, color: TOKENS.primaryForeground },
  miniToggle: { display: 'inline-flex', gap: 2, padding: 2, border: `1px solid ${TOKENS.borderL2}`, borderRadius: 999 },
  miniTab: {
    border: 'none',
    background: 'transparent',
    borderRadius: 999,
    padding: '2px 10px',
    fontSize: 11,
    color: TOKENS.labelSecondary,
    cursor: 'pointer',
  },
  miniTabActive: { background: TOKENS.primaryFill, color: TOKENS.primaryForeground },
  groupHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 7,
    padding: '0 2px',
    margin: '2px 0 10px',
  },
  groupTitle: { fontSize: 13, fontWeight: 600, lineHeight: '20px', color: TOKENS.labelPrimary, margin: 0 },
  groupCount: {
    color: TOKENS.labelTertiary,
    fontVariantNumeric: 'tabular-nums',
    fontSize: 12,
    lineHeight: '18px',
  },
  sectionTitle: { fontWeight: 600, fontSize: 18, color: TOKENS.labelPrimary, margin: 0 },
  sectionSub: { fontSize: 13, color: TOKENS.labelTertiary, margin: 0 },
};

export function SettingsDashboard(props: { t: T; api: ConfigDashboardApi }): ReactNode {
  const { t, api } = props;
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error';
    namespaces: SettingsNamespaceView[];
    writable: boolean;
    error?: string;
  }>({ status: 'loading', namespaces: [], writable: false });
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('host');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<'form' | 'yaml'>('form');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const autoOpened = useRef(false);

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }));
    api.settings
      .describe({})
      .then((resp) => {
        if (resp.result.ok) {
          setState({
            status: 'ready',
            namespaces: resp.result.value.namespaces,
            writable: resp.result.value.writable,
          });
        } else {
          setState({
            status: 'error',
            namespaces: [],
            writable: false,
            error: resp.result.error?.message ?? 'describe failed',
          });
        }
      })
      .catch((err: unknown) => {
        setState({ status: 'error', namespaces: [], writable: false, error: String(err) });
      });
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  // Open an editor whenever the expanded target changes. Deliberately NOT keyed
  // on state.namespaces: a describe() refresh must not re-seed the editor (that
  // would wipe a conflict hint and discard the user's kept draft mid-edit).
  const namespacesRef = useRef(state.namespaces);
  namespacesRef.current = state.namespaces;
  useEffect(() => {
    if (expanded === null) {
      setEditor(null);
      return;
    }
    setEditMode('form');
    const ns = namespacesRef.current.find((n) => n.ns === expanded);
    if (!ns) return;
    const root = rootNodeOf(ns);
    if (root.type !== 'object') {
      setEditor(null);
      return;
    }
    const original = toRecord(ns.user);
    setEditor({ ns: ns.ns, revision: ns.revision, original, draft: structuredClone(original), busy: false, error: undefined });
  }, [expanded]);

  // Auto-open the first host-only, editable namespace once — own-UI ones stay collapsed.
  useEffect(() => {
    if (autoOpened.current || state.status !== 'ready' || state.namespaces.length === 0) return;
    const first = state.namespaces.find((n) => !OWN_UI.has(n.ns) && rootNodeOf(n).type === 'object');
    if (first) {
      autoOpened.current = true;
      setExpanded(first.ns);
    }
  }, [state]);

  const toggleCard = useCallback((ns: string) => {
    setExpanded((cur) => (cur === ns ? null : ns));
  }, []);

  const dirty = editor !== null && !deepEqual(editor.original, editor.draft);

  const setDraftAt = useCallback((path: string[], value: unknown) => {
    setEditor((ed) => (ed ? { ...ed, draft: setPath(ed.draft, path, value) as Record<string, unknown> } : ed));
  }, []);

  const resetDraftAt = useCallback((path: string[]) => {
    setEditor((ed) => (ed ? { ...ed, draft: deletePath(ed.draft, path) as Record<string, unknown> } : ed));
  }, []);

  const saveEditor = useCallback(async () => {
    if (!editor) return;
    const ns = state.namespaces.find((n) => n.ns === editor.ns);
    if (!ns) return;
    setEditor({ ...editor, busy: true, error: undefined });
    const schema = rehydrateSchema(ns.schema);
    const invalid = validateDraft(schema, editor.draft);
    if (invalid !== undefined) {
      setEditor({ ...editor, busy: false, error: `${t('validationFailed')}: ${invalid}` });
      return;
    }
    const ops = diffOps(editor.original, editor.draft);
    if (ops.length === 0) {
      setEditor({ ...editor, busy: false, original: structuredClone(editor.draft) });
      return;
    }
    try {
      const resp = await api.settings.mutate({ ns: ns.ns, ops, expectedRevision: editor.revision });
      if (!resp.result.ok) {
        if (resp.result.error?.code === 'settings-conflict') {
          await load();
          setEditor({ ...editor, busy: false, error: t('conflictHint') });
        } else {
          setEditor({
            ...editor,
            busy: false,
            error: `${t('saveFailed')}: ${resp.result.error?.message ?? resp.result.error?.code ?? '?'}`,
          });
        }
        return;
      }
      await load();
      const saved = structuredClone(editor.draft);
      setEditor({
        ...editor,
        busy: false,
        revision: resp.result.value?.revision ?? editor.revision,
        original: saved,
        error: undefined,
      });
      setFlash(t('saved'));
      window.setTimeout(() => setFlash(null), 2500);
    } catch (err: unknown) {
      setEditor({ ...editor, busy: false, error: String(err) });
    }
  }, [editor, state.namespaces, api, load, t]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    let list = state.namespaces;
    if (tab === 'host') list = list.filter((n) => !OWN_UI.has(n.ns));
    if (tab === 'ui') list = list.filter((n) => OWN_UI.has(n.ns));
    if (q) {
      list = list.filter((n) => {
        if (n.ns.toLowerCase().includes(q)) return true;
        const root = rootNodeOf(n);
        if (root.type === 'object' && root.dict) {
          return Object.keys(root.dict).some((k) => k.toLowerCase().includes(q));
        }
        return nodeTypeLabel(root).toLowerCase().includes(q);
      });
    }
    return list;
  }, [state.namespaces, tab, q]);

  // Group into curated buckets; within each group host-only first, own-UI last.
  const grouped = useMemo(() => {
    const buckets = new Map<string, SettingsNamespaceView[]>();
    for (const id of orderedGroupIds()) buckets.set(id, []);
    for (const ns of filtered) {
      const idx = groupIndexOf(ns.ns);
      const gid = idx < orderedGroupIds().length - 1 ? orderedGroupIds()[idx] : OTHER_GROUP_ID;
      buckets.get(gid)?.push(ns);
    }
    for (const arr of buckets.values()) {
      arr.sort((a, b) => Number(OWN_UI.has(a.ns)) - Number(OWN_UI.has(b.ns)) || a.ns.localeCompare(b.ns));
    }
    return buckets;
  }, [filtered]);

  // Keep the expanded card in view when the tab/search changes.
  useEffect(() => {
    if (expanded !== null && !filtered.some((n) => n.ns === expanded)) setExpanded(null);
  }, [filtered, expanded]);

  const card = (ns: SettingsNamespaceView): ReactNode => {
    const isOpen = expanded === ns.ns;
    const editing = isOpen && editor !== null && editor.ns === ns.ns;
    const miniToggle = h(
      'span',
      {
        onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
        style: styles.miniToggle,
      },
      h(
        'button',
        { type: 'button', style: { ...styles.miniTab, ...(editMode === 'form' ? styles.miniTabActive : {}) }, onClick: () => setEditMode('form') },
        t('form'),
      ),
      h(
        'button',
        { type: 'button', style: { ...styles.miniTab, ...(editMode === 'yaml' ? styles.miniTabActive : {}) }, onClick: () => setEditMode('yaml') },
        t('yaml'),
      ),
    );
    return h(
      'div',
      { key: ns.ns, style: isOpen ? styles.cardOpen : styles.card },
      h(
        'div',
        { onClick: () => toggleCard(ns.ns), style: styles.head },
        h('span', { style: styles.name }, ns.ns),
        h(
          'span',
          { style: styles.actions },
          ns.applies === 'restart' ? h('span', { style: styles.tag }, t('appliesRestart')) : null,
          isOpen && flash
            ? h('span', { style: { fontSize: 12, color: TOKENS.labelSecondary } }, flash)
            : null,
          isOpen ? miniToggle : null,
          h(
            'span',
            {
              style: {
                display: 'flex',
                color: TOKENS.labelTertiary,
                transform: isOpen ? 'rotate(180deg)' : undefined,
                transition: 'transform 0.16s',
              },
            },
            h(IconChevronDownOutline14, { size: 14 }),
          ),
        ),
      ),
      isOpen
        ? h(
            'div',
            { style: { borderTop: `1px solid ${TOKENS.borderL2}`, margin: '0 16px', paddingBottom: 8 } },
            editor?.error
              ? h('div', { style: { color: 'var(--dsw-alias-danger-foreground, #b91c1c)', fontSize: 12, marginBottom: 8 } }, editor.error)
              : null,
            editMode === 'form'
              ? rootNodeOf(ns).type === 'object' && editing
                ? h(SchemaForm, {
                    node: rootNodeOf(ns),
                    draft: editor.draft,
                    resolved: ns.value,
                    set: setDraftAt,
                    reset: resetDraftAt,
                    t,
                  })
                : h(
                    'div',
                    null,
                    h('div', { style: { fontSize: 13, color: TOKENS.labelSecondary, marginBottom: 6 } }, t('nonObjectNs')),
                    h(
                      'pre',
                      { style: { fontFamily: 'var(--dsw-font-mono, Menlo, monospace)', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, padding: 10, borderRadius: 8, background: TOKENS.bgLayer2, color: TOKENS.labelSecondary } },
                      JSON.stringify(ns.value, null, 2),
                    ),
                  )
              : h(
                  'div',
                  null,
                  h('div', { style: { fontSize: 12, fontWeight: 600, color: TOKENS.labelSecondary, marginBottom: 4 } }, t('yamlPreview')),
                  h(
                    'pre',
                    {
                      style: {
                        fontFamily: 'var(--dsw-font-mono, Menlo, monospace)',
                        fontSize: 13,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        margin: 0,
                        padding: 10,
                        borderRadius: 8,
                        maxHeight: 480,
                        overflow: 'auto',
                        background: TOKENS.bgLayer2,
                        color: TOKENS.labelSecondary,
                      },
                    },
                    editing ? YAML.stringify(editor.draft, { lineWidth: 0 }) : JSON.stringify(ns.value, null, 2),
                  ),
                ),
            editing
              ? h(
                  'div',
                  {
                    style: {
                      borderTop: `1px solid ${TOKENS.borderL2}`,
                      display: 'flex',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      gap: 8,
                      padding: '12px 0 4px',
                      marginTop: 10,
                    },
                  },
                  h(
                    Button,
                    {
                      variant: 'primary',
                      size: 'sm',
                      onClick: saveEditor,
                      disabled: editor.busy || !state.writable || !dirty,
                    },
                    editor.busy ? t('saveBusy') : t('save'),
                  ),
                  h(
                    Button,
                    { variant: 'outline', size: 'sm', onClick: () => setExpanded(null), disabled: editor.busy },
                    t('cancel'),
                  ),
                )
              : null,
          )
        : null,
    );
  };

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 12, minHeight: 560 } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
        h('span', { style: styles.sectionTitle }, t('title')),
        h('span', { style: styles.sectionSub }, t('subtitle')),
      ),
      h(Button, { variant: 'ghost', size: 'sm', onClick: load, style: { marginLeft: 'auto' } }, t('refresh')),
    ),
    h(
      'div',
      { style: styles.tabBar },
      h('button', { type: 'button', style: { ...styles.tab, ...(tab === 'all' ? styles.tabActive : {}) }, onClick: () => setTab('all') }, t('tabAll')),
      h('button', { type: 'button', style: { ...styles.tab, ...(tab === 'host' ? styles.tabActive : {}) }, onClick: () => setTab('host') }, t('tabHost')),
      h('button', { type: 'button', style: { ...styles.tab, ...(tab === 'ui' ? styles.tabActive : {}) }, onClick: () => setTab('ui') }, t('tabUi')),
    ),
    h(
      'div',
      { style: { position: 'relative', display: 'flex', alignItems: 'center' } },
      h(
        'span',
        { style: { position: 'absolute', left: 12, display: 'flex', color: TOKENS.labelTertiary, pointerEvents: 'none' } },
        h(IconSearchOutline16, { size: 16 }),
      ),
      h('input', {
        type: 'search',
        value: query,
        onChange: (e: { target: { value: string } }) => setQuery(e.target.value),
        placeholder: t('searchPlaceholder'),
        style: {
          boxSizing: 'border-box',
          border: '1px solid var(--dsw-alias-border-l2)',
          width: '100%',
          height: 36,
          background: 'var(--dsw-alias-bg-layer-1)',
          color: 'var(--dsw-alias-label-primary)',
          borderRadius: 8,
          outline: 'none',
          padding: '0 12px 0 36px',
          fontSize: 13,
        },
      }),
    ),
    state.status === 'loading'
      ? h('div', { style: { color: TOKENS.labelSecondary } }, t('loading'))
      : state.status === 'error'
        ? h('div', { style: { color: 'var(--dsw-alias-danger-foreground, #b91c1c)' } }, `${t('loadError')}: ${state.error}`)
        : filtered.length === 0
          ? h('div', { style: { color: TOKENS.labelSecondary } }, q ? t('searchNoMatch') : t('noNamespaces'))
          : h(
              'div',
              null,
              orderedGroupIds().map((gid) => {
                const items = grouped.get(gid) ?? [];
                if (items.length === 0) return null;
                const key = gid === OTHER_GROUP_ID ? 'groupOther' : `group${gid[0].toUpperCase()}${gid.slice(1)}`;
                return h(
                  'div',
                  { key: gid, style: { marginBottom: 14 } },
                  h(
                    'div',
                    { style: styles.groupHeader },
                    h('span', { style: styles.groupTitle }, t(key)),
                    h('span', { style: styles.groupCount }, String(items.length)),
                  ),
                  items.map(card),
                );
              }),
            ),
  );
}
