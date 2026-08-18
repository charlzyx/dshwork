import { createElement as h, useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';

type PickItem = {
  id: string;
  title: string;
  category: string;
  github: string;
  install: string;
  reason: { en: string; zh: string };
};

type Translate = (key: string) => string;

type Status = { kind: 'ok' | 'error'; text: string };

const styles = {
  container: { padding: 18, display: 'flex', flexDirection: 'column', gap: 14 },
  header: { display: 'flex', flexDirection: 'column', gap: 2 },
  title: { fontWeight: 650, fontSize: 16, color: 'var(--dsw-alias-label-primary)' },
  subtitle: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' },
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
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  } as CSSProperties,
  actions: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 'auto', paddingTop: 4 },
  github: { fontSize: 12, color: 'var(--dsw-alias-label-dimmed)', textDecoration: 'none' },
  status: { fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 },
  loading: { fontSize: 13, color: 'var(--dsw-alias-label-dimmed)' },
  footer: { marginTop: 4, fontSize: 12, color: 'var(--dsw-alias-label-dimmed)', textAlign: 'center' },
} satisfies Record<string, CSSProperties>;

export function PickList({ t }: { t: Translate }): ReactElement {
  const [picks, setPicks] = useState<PickItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch('/dshwork/picks.json')
      .then((r) => r.json())
      .then((d) => setPicks((d.picks as PickItem[]) ?? []))
      .catch(() => setStatus({ kind: 'error', text: t('loadFailed') }));
  }, []);

  const install = (pick: PickItem) => {
    setBusy(pick.id);
    setStatus(null);
    const target = pick.install.replace(/^dsh plugin add\s+/, '');
    fetch('/dshwork/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    })
      .then((r) => r.json())
      .then((d) => {
        setStatus(d.ok ? { kind: 'ok', text: `${pick.title} ${t('installed')}` } : { kind: 'error', text: t('failed') });
        setBusy(null);
      })
      .catch(() => {
        setStatus({ kind: 'error', text: t('failed') });
        setBusy(null);
      });
  };

  return h('div', { style: styles.container },
    h('div', { style: styles.header },
      h('div', { style: styles.title }, t('title')),
      h('div', { style: styles.subtitle }, t('subtitle')),
    ),
    picks.length === 0 && status === null
      ? h('div', { style: styles.loading }, t('loading'))
      : h('div', { style: styles.grid },
          picks.map((pick) =>
            h('div', { key: pick.id, style: styles.card },
              h('div', { style: styles.cardHeader },
                h('span', { style: styles.cardTitle, title: pick.title }, pick.title),
                h('span', { style: styles.category }, pick.category),
              ),
              h('div', { style: styles.reason, title: pick.reason.zh || pick.reason.en }, pick.reason.zh || pick.reason.en),
              h('div', { style: styles.actions },
                h(Button, {
                  variant: 'primary',
                  size: 'sm',
                  disabled: busy === pick.id,
                  onClick: () => install(pick),
                }, busy === pick.id ? t('installing') : t('install')),
                h('a', { href: `https://github.com/${pick.github}`, target: '_blank', rel: 'noreferrer', style: styles.github }, 'GitHub ↗'),
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
