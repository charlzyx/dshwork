import type { Context } from '@deepseek-ai/cordis';

export const name = 'config-dashboard';

/**
 * @dshwork/config-dashboard host half.
 *
 * M1 (namespace list + edits) is fully browser-side: the client reads every
 * registered settings namespace through `connection.api.settings.describe()`
 * and writes through the same loopback settings RPC the official Models page
 * uses — so the host half stays minimal until M4 (raw `settings.yaml`
 * view/edit) and M6 (market-data proxy), where it will inject `webServer`
 * and mount routes under /dshwork-config/*.
 */
export function apply(_ctx: Context, _config?: unknown): void {
  // intentionally minimal in M1
}
