import type { HostContext, HostRoute, WatchHub } from './types.js';

const WATCH_ROUTE = '/api/openspec-dashboard/watch';
export function reply(status: number, data: object): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function createWatchRoute(ctx: HostContext, hub: WatchHub): HostRoute {
  return {
    path: WATCH_ROUTE, methods: ['GET'], requestBody: 'buffered',
    async fetch(request: Request) {
      let sessionId;
      try { sessionId = new URL(request.url).searchParams.get('sessionId'); }
      catch { return reply(400, { error: 'invalid-request' }); }
      if (!sessionId || sessionId.length > 200) return reply(400, { error: 'invalid-request' });
      const session = ctx.sessions.get(sessionId);
      const stored = session ? null : await ctx.sessionPersistence.stat(sessionId);
      const cwd = session?.header.cwd ?? stored?.header.cwd;
      if (!cwd) return reply(404, { error: 'session-unavailable' });
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      let pendingChange = false;
      let pendingFailure = false;
      let ended = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: (() => Promise<void>) | undefined;
      function enqueue(message: string): void {
        if (ended || !controller) return;
        try { controller.enqueue(new TextEncoder().encode(message)); }
        catch { void stop(); }
      }
      async function stop(): Promise<void> {
        if (ended) return;
        ended = true;
        clearInterval(heartbeat);
        request.signal.removeEventListener('abort', onAbort);
        try { await unsubscribe?.(); } catch { /* resource teardown is best-effort */ }
        if (controller) { try { controller.close(); } catch { /* already cancelled */ } }
      }
      function onAbort(): void { void stop(); }
      function notify(event: 'changed' | 'unavailable'): void {
        if (ended) return;
        if (!controller) {
          if (event === 'unavailable') pendingFailure = true;
          else pendingChange = true;
          return;
        }
        if (event === 'unavailable') {
          enqueue('event: unavailable\ndata: 1\n\n');
          void stop();
        } else if ((controller?.desiredSize ?? 0) > 0) {
          enqueue('event: changed\ndata: 1\n\n');
        } else pendingChange = true;
      }
      try { unsubscribe = await hub.subscribe(cwd, notify, request.signal); }
      catch { return reply(503, { error: 'watch-unavailable' }); }
      if (request.signal.aborted || pendingFailure) {
        await unsubscribe();
        return reply(503, { error: 'watch-unavailable' });
      }
      const stream = new ReadableStream({
        start(sink) {
          controller = sink;
          request.signal.addEventListener('abort', onAbort, { once: true });
          enqueue('retry: 3000\nevent: ready\ndata: 1\n\n');
          heartbeat = setInterval(() => {
            if ((controller?.desiredSize ?? 0) > 0) enqueue(': heartbeat\n\n');
          }, 20000);
          (heartbeat as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
          if (pendingChange && (controller?.desiredSize ?? 0) > 0) {
            pendingChange = false;
            enqueue('event: changed\ndata: 1\n\n');
          }
          if (request.signal.aborted) void stop();
        },
        pull() {
          if (pendingChange && !ended && (controller?.desiredSize ?? 0) > 0) {
            pendingChange = false;
            enqueue('event: changed\ndata: 1\n\n');
          }
        },
        cancel() { return stop(); },
      });
      return new Response(stream, { headers: {
        'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store',
      } });
    },
  };
}
