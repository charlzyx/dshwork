import type { Context } from '@deepseek-ai/cordis';
import { mountDshworkRoutes } from './routes.js';
import type { DshworkHost } from './host';

export const name = 'dshwork';

/**
 * dshwork: the human side of dsh — hand-picked projects + best-practice
 * posts from dsh-plugin.work, browsable inside the harness.
 *
 * Mounts a small HTTP surface (data proxy + page) against the host's
 * webServer. A Settings entry (installSettingsSection) is the next step
 * once the page is settled; see README.
 */
export function apply(ctx: Context, _config?: unknown): void {
  ctx.inject(['webServer', 'loader'], (hostCtx: Context) => {
    const host = hostCtx as unknown as DshworkHost;
    host.effect(() => mountDshworkRoutes(host), 'dshwork: http routes');
  });
}
