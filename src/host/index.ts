/** Authenticated OpenSpec watch stream and one guarded, user-initiated checkbox edit. */
import { createWatchHub } from './watch.js';
import { createWatchRoute, reply } from './route.js';
import { updateTask, safeErrorCode } from './task.js';
import type { HostContext } from './types.js';
export { createWatchRoute } from './route.js';
export { updateTask } from './task.js';
const ROUTE = '/api/openspec-dashboard/task';
const MAX_BODY = 4096;
export const inject = ['connection', 'fs', 'sessions', 'sessionPersistence', 'sandboxPolicy'];

export function apply(ctx: HostContext): void {
  const watchHub = createWatchHub(ctx.fs);
  ctx.effect(() => {
    const unregister = ctx.connection.fetch.register(createWatchRoute(ctx, watchHub));
    return async () => { await unregister(); await watchHub.close(); };
  }, 'openspec-dashboard: shared workspace event stream');
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE, methods: ['POST'], requestBody: 'buffered',
    async fetch(request: Request) {
      try {
        if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json' ||
            Number(request.headers.get('content-length') || 0) > MAX_BODY) {
          return reply(400, { error: 'invalid-request' });
        }
        const text = await request.text();
        if (text.length > MAX_BODY) return reply(413, { error: 'invalid-request' });
        const result = await updateTask(ctx, JSON.parse(text));
        return reply(result.status, result.data);
      } catch (error) {
        if (error instanceof SyntaxError) return reply(400, { error: 'invalid-request' });
        ctx.logger?.warn?.('OpenSpec task update failed: %s', String(error));
        return reply(500, { error: 'write-failed', stage: 'request', code: safeErrorCode(error) });
      }
    },
  }), 'openspec-dashboard: authenticated task edits');
}

// Conventional default export for consumers; Cordis also accepts the named apply/inject exports.
export default { name: 'dsh-openspec-dashboard', inject, apply };
