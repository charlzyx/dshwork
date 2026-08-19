import { createElement as h } from 'react';
import { SettingsDashboard } from './SettingsDashboard';
import { en, zh } from './locales';

const NS = 'config-dashboard';

/** One `settings.mutate` path operation (mirrors the official wire vocabulary). */
export interface WireMutateOp {
  op: 'set' | 'unset';
  path: string[];
  value?: unknown;
}

export interface SettingsMutateResponse {
  result: {
    ok: boolean;
    value?: { user?: unknown; revision: number };
    error?: { message?: string; code?: string };
  };
}

/** Structural subset of the host services the client half consumes. */
export interface ConfigDashboardApi {
  settings: {
    describe(options: unknown): Promise<SettingsDescribeResponse>;
    mutate(options: {
      ns: string;
      ops: WireMutateOp[];
      expectedRevision: number;
    }): Promise<SettingsMutateResponse>;
  };
}

export interface SettingsNamespaceView {
  ns: string;
  schema: unknown;
  value: unknown;
  revision: number;
  base?: unknown;
  user?: unknown;
  applies: string;
  secrets?: { path: string; set: boolean }[];
}

export interface SettingsDescribeResponse {
  result: {
    ok: boolean;
    value: { writable: boolean; namespaces: SettingsNamespaceView[] };
    error?: { message?: string; code?: string };
  };
}

/** Structural subset of the browser-side context (see dshwork client). */
interface ConfigDashboardClientContext {
  effect(callback: () => unknown, label?: string): void;
  get(id: string): unknown;
  locale: {
    register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown;
    bind(namespace: string): (key: string) => string;
  };
  slots: {
    inject(slot: string, register: () => unknown): void;
    register(meta: Record<string, unknown>, render: () => unknown): unknown;
  };
}

export const name = 'config-dashboard';
export const inject = ['slots', 'locale', 'connection'];

/**
 * Registers the top-level "配置看板" Settings section (`settings.section`,
 * alongside 精选 / 市场) rendering the VS Code-style dashboard: a grouped
 * namespace tree on the left, and a form + live YAML preview editor on the
 * right. Data comes from the loopback settings RPC — the same
 * `connection.api.settings.describe()` the Models page uses — so the
 * dashboard sees every registered namespace, including third-party ones the
 * official hand-written cards never render.
 */
export function apply(ctx: ConfigDashboardClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'config-dashboard: dictionaries');
  const t = ctx.locale.bind(NS);
  const connection = ctx.get('connection') as { api: ConfigDashboardApi };

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'config-dashboard',
        order: 40,
        label: () => t('title'),
        locale: NS,
        inject: () => ({ t, api: connection.api }),
      },
      () => h(SettingsDashboard, { t, api: connection.api }),
    ),
  );
}
