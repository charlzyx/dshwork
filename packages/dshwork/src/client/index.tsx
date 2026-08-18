import { createElement as h } from 'react';
import { PickList } from './PickList';
import { en, zh } from './locales';

const NS = 'dshwork';

/** Browser-side client context (structural subset of the host services). */
interface DshworkClientContext {
  effect(callback: () => unknown, label?: string): void;
  locale: {
    register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown;
    bind(namespace: string): (key: string) => string;
  };
  slots: {
    inject(slot: string, register: () => unknown): void;
    register(meta: Record<string, unknown>, render: () => unknown): unknown;
  };
}

export const name = 'dshwork';
export const inject = ['slots', 'locale'];

/**
 * Registers a "settings.section" nav entry (like dsh-market's 插件市场)
 * that renders the curated picks list, with bilingual labels and an
 * install action per pick.
 */
export function apply(ctx: DshworkClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dshwork: dictionaries');
  const t = ctx.locale.bind(NS);

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: NS,
        order: 50,
        label: () => t('title'),
        inject: () => ({ t }),
      },
      () => h(PickList, { t }),
    ),
  );
}
