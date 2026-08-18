import { createElement as h, useCallback, useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';

type PickItem = {
  id: string;
  title: string;
  category: string;
  github: string;
  install: string;
  /** 是否可在 DSH 内一键安装；false = 独立 CLI / 桌面应用 / 资源列表，站内装不了。 */
  installable?: boolean;
  /** installable=false 时的替代安装说明。 */
  installHint?: { en: string; zh: string };
  reason: { en: string; zh: string };
};

type PopularItem = {
  fullName: string;
  name: string;
  summary: string;
  stars: number;
  kind: string | null;
  installCommand: string | null;
};

type Translate = (key: string) => string;

type Status = { kind: 'ok' | 'error'; text: string };

const PAGE = 8;
const KIND_TAGS = ['', 'plugin', 'webui', 'desktop_app', 'collection', 'other'] as const;

const styles = {
  container: { padding: 18, display: 'flex', flexDirection: 'column', gap: 14 },
  header: { display: 'flex', flexDirection: 'column', gap: 2 },
  title: { fontWeight: 650, fontSize: 16, color: 'var(--dsw-alias-label-primary)' },
  subtitle: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' },
  tabs: { display: 'flex', gap: 6, padding: 3, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 999, alignSelf: 'flex-start' },
  tab: {
    padding: '5px 14px',
    borderRadius: 999,
    fontSize: 13,
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
  },
  tabActive: { background: 'var(--dsw-alias-button-primary-fill)', color: 'var(--dsw-alias-label-primary-foreground)' },
  tags: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  tag: {
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 12,
    cursor: 'pointer',
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
  },
  tagActive: { background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-primary)', borderColor: 'transparent' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 12,
  } as CSSProperties,
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-1)',
  } as CSSProperties,
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: {
    fontWeight: 600,
    fontSize: 14,
    color: 'var(--dsw-alias-label-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  category: {
    flexShrink: 0,
    fontSize: 11,
    lineHeight: 1,
    padding: '4px 8px',
    borderRadius: 999,
    color: 'var(--dsw-alias-label-secondary)',
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-2)',
  },
  reason: {
    fontSize: 12,
    lineHeight: 1.55,
    color: 'var(--dsw-alias-label-secondary)',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  } as CSSProperties,
  actions: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 'auto', paddingTop: 4 },
  github: { fontSize: 12, color: 'var(--dsw-alias-label-dimmed)', textDecoration: 'none' },
  stars: { fontSize: 12, color: 'var(--dsw-alias-label-dimmed)', whiteSpace: 'nowrap' },
  notInstallable: {
    flexShrink: 0,
    fontSize: 11,
    lineHeight: 1,
    padding: '5px 9px',
    borderRadius: 999,
    color: 'var(--dsw-alias-label-secondary)',
    border: '1px dashed var(--dsw-alias-border-l2)',
  },
  pager: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 },
  pagerInfo: { fontSize: 12, color: 'var(--dsw-alias-label-dimmed)' },
  status: { fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 },
  loading: { fontSize: 13, color: 'var(--dsw-alias-label-dimmed)' },
  footer: { marginTop: 4, fontSize: 12, color: 'var(--dsw-alias-label-dimmed)', textAlign: 'center' },
} satisfies Record<string, CSSProperties>;

const KIND_LABEL_KEY: Record<string, string> = {
  plugin: 'kindPlugin',
  desktop_app: 'kindDesktopApp',
  collection: 'kindCollection',
  library: 'kindLibrary',
  docs: 'kindDocs',
  other: 'kindOther',
};

export function PickList({ t }: { t: Translate }): ReactElement {
  const [tab, setTab] = useState<'picks' | 'popular'>('picks');
  const [picks, setPicks] = useState<PickItem[]>([]);
  const [popular, setPopular] = useState<PopularItem[]>([]);
  const [kind, setKind] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch('/dshwork/picks.json')
      .then((r) => r.json())
      .then((d) => setPicks((d.picks as PickItem[]) ?? []))
      .catch(() => setStatus({ kind: 'error', text: t('loadFailed') }));
  }, []);

  const loadPopular = useCallback(() => {
    setStatus(null);
    const qs = `sort=stars&min_stars=100${query ? `&q=${encodeURIComponent(query.trim())}` : ''}${kind ? `&kind=${kind}` : ''}&limit=${PAGE}&offset=${offset}`;
    fetch(`/dshwork/explore?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        setPopular((d.data as PopularItem[]) ?? []);
        setTotal(d.page?.total ?? 0);
      })
      .catch(() => setStatus({ kind: 'error', text: t('loadFailed') }));
  }, [kind, offset, query, t]);

  useEffect(() => {
    if (tab === 'popular') loadPopular();
  }, [tab, kind, offset, loadPopular]);

  const install = (title: string, installCmd: string) => {
    const target = installCmd.replace(/^dsh plugin(?:\s+--profile\s+\S+)?\s+add\s+/, '').trim();
    setBusy(title);
    setStatus(null);
    fetch('/dshwork/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    })
      .then((r) => r.json())
      .then((d) => {
        setStatus(d.ok ? { kind: 'ok', text: `${title} ${t('installed')}` } : { kind: 'error', text: t('failed') });
        setBusy(null);
      })
      .catch(() => {
        setStatus({ kind: 'error', text: t('failed') });
        setBusy(null);
      });
  };

  const pages = Math.max(Math.ceil(total / PAGE), 1);
  const pageNo = Math.floor(offset / PAGE) + 1;
  const switchKind = (value: string) => {
    setKind(value);
    setOffset(0);
  };
  const switchQuery = (value: string) => {
    setQuery(value);
    setOffset(0);
  };
  const q = query.trim().toLowerCase();
  const filteredPicks = q
    ? picks.filter((pick) => `${pick.title} ${pick.reason.zh} ${pick.reason.en}`.toLowerCase().includes(q))
    : picks;

  return h('div', { style: styles.container },
    h('div', { style: styles.header },
      h('div', { style: styles.title }, t('title')),
      h('div', { style: styles.subtitle }, t(tab === 'picks' ? 'subtitle' : 'popularSubtitle')),
    ),
    h('div', { style: styles.tabs },
      h('button', { type: 'button', style: { ...styles.tab, ...(tab === 'picks' ? styles.tabActive : {}) }, onClick: () => { setTab('picks'); setStatus(null); } }, t('tabPicks')),
      h('button', { type: 'button', style: { ...styles.tab, ...(tab === 'popular' ? styles.tabActive : {}) }, onClick: () => { setTab('popular'); setStatus(null); } }, t('tabPopular')),
    ),
    h('input', {
      type: 'search',
      value: query,
      placeholder: t('searchPlaceholder'),
      style: {
        width: '100%',
        minHeight: 32,
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        padding: '6px 12px',
        fontSize: 13,
        outline: 'none',
      } as CSSProperties,
      onInput: (event) => switchQuery((event.target as HTMLInputElement).value),
    }),
    tab === 'popular'
      ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { style: styles.tags },
            KIND_TAGS.map((value) =>
              h('button', {
                type: 'button',
                key: value || 'all',
                style: { ...styles.tag, ...(kind === value ? styles.tagActive : {}) },
                onClick: () => switchKind(value),
              }, value === '' ? t('kindAll') : t(KIND_LABEL_KEY[value] ?? 'kindOther')),
            ),
          ),
          popular.length === 0 && status === null
            ? h('div', { style: styles.loading }, t('loading'))
            : h('div', { style: styles.grid },
                popular.map((item) =>
                  h('div', { key: item.fullName, style: styles.card },
                    h('div', { style: styles.cardHeader },
                      h('span', { style: styles.cardTitle, title: item.fullName }, item.name),
                      h('span', { style: styles.category }, item.kind ? t(KIND_LABEL_KEY[item.kind] ?? 'kindOther') : ''),
                    ),
                    h('div', { style: styles.reason, title: item.summary }, item.summary || '\u00A0'),
                    h('div', { style: styles.actions },
                      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
                        h('a', { href: `https://github.com/${item.fullName}`, target: '_blank', rel: 'noreferrer', style: styles.github }, 'GitHub ↗'),
                        h('span', { style: styles.stars }, `☆ ${item.stars.toLocaleString()}`),
                      ),
                      item.installCommand
                        ? h(Button, {
                            variant: 'primary',
                            size: 'sm',
                            disabled: busy === item.fullName,
                            onClick: () => install(item.name, item.installCommand ?? ''),
                          }, busy === item.fullName ? t('installing') : t('install'))
                        : null,
                    ),
                  ),
                ),
              ),
          h('div', { style: styles.pager },
            h(Button, { variant: 'ghost', size: 'sm', disabled: pageNo <= 1, onClick: () => setOffset(Math.max(offset - PAGE, 0)) }, `‹ ${t('prevPage')}`),
            h('span', { style: styles.pagerInfo }, `${pageNo} / ${pages}`),
            h(Button, { variant: 'ghost', size: 'sm', disabled: pageNo >= pages, onClick: () => setOffset(offset + PAGE) }, `${t('nextPage')} ›`),
          ),
        )
      : h('div', { style: styles.grid },
          filteredPicks.length === 0 && status === null
            ? h('div', { style: styles.loading }, t('loading'))
            : filteredPicks.map((pick) =>
                h('div', { key: pick.id, style: styles.card },
                  h('div', { style: styles.cardHeader },
                    h('span', { style: styles.cardTitle, title: pick.title }, pick.title),
                    h('span', { style: styles.category }, pick.category ? t(KIND_LABEL_KEY[pick.category] ?? 'kindOther') : ''),
                  ),
                  h('div', { style: styles.reason, title: pick.reason.zh || pick.reason.en }, pick.reason.zh || pick.reason.en),
                  h('div', { style: styles.actions },
                    h('a', { href: `https://github.com/${pick.github}`, target: '_blank', rel: 'noreferrer', style: styles.github }, 'GitHub ↗'),
                    pick.installable === false
                      ? h('span', { style: styles.notInstallable, title: (pick.installHint?.zh ?? pick.installHint?.en) || '' }, t('notInstallable'))
                      : h(Button, {
                          variant: 'primary',
                          size: 'sm',
                          disabled: busy === pick.title,
                          onClick: () => install(pick.title, pick.install),
                        }, busy === pick.title ? t('installing') : t('install')),
                  ),
                ),
              ),
        ),
    status
      ? h('div', {
          style: {
            ...styles.status,
            color: status.kind === 'ok' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-label)',
          },
        }, status.text)
      : null,
    h('div', { style: styles.footer },
      t('builtBy'), ' · ',
      h('a', { href: 'https://dsh-plugin.work', target: '_blank', rel: 'noreferrer', style: styles.github }, 'dsh-plugin.work'),
    ),
  );
}
