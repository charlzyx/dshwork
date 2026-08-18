import { createElement as h, useEffect, useState, type ReactElement } from 'react';

type PickItem = {
  id: string;
  title: string;
  category: string;
  github: string;
  install: string;
  reason: { en: string; zh: string };
};

type Translate = (key: string) => string;

export function PickList({ t }: { t: Translate }): ReactElement {
  const [picks, setPicks] = useState<PickItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch('/dshwork/picks.json')
      .then((r) => r.json())
      .then((d) => setPicks((d.picks as PickItem[]) ?? []))
      .catch(() => setStatus(t('loadFailed')));
  }, []);

  const install = (pick: PickItem) => {
    setBusy(pick.id);
    setStatus(null);
    fetch('/dshwork/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github: pick.github }),
    })
      .then((r) => r.json())
      .then((d) => {
        setStatus(d.ok ? `${pick.title} ${t('installed')}` : t('failed'));
        setBusy(null);
      })
      .catch(() => {
        setStatus(t('failed'));
        setBusy(null);
      });
  };

  return h('div', { style: { padding: 18, display: 'flex', flexDirection: 'column', gap: 12 } },
    h('div', { style: { fontWeight: 650, fontSize: 16 } }, t('title')),
    h('div', { style: { fontSize: 13, color: '#687284' } }, t('subtitle')),
    picks.length === 0 && !status
      ? h('div', { style: { fontSize: 13, color: '#8a95a8' } }, '…')
      : picks.map((pick) =>
          h('div', {
            key: pick.id,
            style: { border: '1px solid rgba(0,0,0,.08)', borderRadius: 10, padding: 12, display: 'flex', alignItems: 'center', gap: 10 },
          },
            h('div', { style: { flex: 1 } },
              h('div', { style: { fontWeight: 600 } }, pick.title),
              h('div', { style: { fontSize: 12, color: '#687284', marginTop: 2 } }, pick.reason.zh || pick.reason.en),
            ),
            h('button', {
              onClick: () => install(pick),
              disabled: busy === pick.id,
              style: { flexShrink: 0 },
            }, busy === pick.id ? t('installing') : t('install')),
          ),
        ),
    status ? h('div', { style: { fontSize: 12, color: '#98600b' } }, status) : null,
    h('div', { style: { marginTop: 6, fontSize: 12, color: '#8a95a8', textAlign: 'center' } },
      t('builtBy'), ' · ',
      h('a', { href: 'https://dsh-plugin.work', target: '_blank', rel: 'noreferrer' }, 'dsh-plugin.work'),
    ),
  );
}
