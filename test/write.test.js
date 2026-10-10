import test from 'node:test';
import assert from 'node:assert/strict';
import plugin, { apply, updateTask, createWatchRoute } from '../dist/index.js';

const initial = '# Tasks\r\n## Group\r\n- [ ] 1.1 First task\r\n- [x] 1.2 Second task\r\n';
const valid = { sessionId: 's1', slug: 'change-a', lineNumber: 3,
  expectedLine: '- [ ] 1.1 First task\r', expectedVersion: 'v1', done: true };
function fixture(content = initial) {
  const record = { content, version: 'v1', writes: 0 };
  const fs = {
    async resolve(path) { return { targetKey: path, displayPath: path }; },
    async lstat(path) { return { type: path.endsWith('/tasks.md') ? 'file' : 'directory' }; },
    contains(parent, child) { return child.targetKey.startsWith(parent.targetKey + '/'); },
    async stat() { return { type: 'file', size: Buffer.byteLength(record.content), version: record.version }; },
    async readText() { return record.content; },
    async writeText(_target, next, intent, _signal, policy) {
      assert.equal(intent.kind, 'replaceIfVersion');
      assert.equal(policy.mode, 'workspace-write');
      assert.equal(policy.workspaceRoot, '/repo');
      assert.equal(policy.sessionId, 's1');
      if (record.version !== intent.version) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' });
      record.content = next; record.version = 'v2'; record.writes++;
      return { version: record.version };
    },
  };
  return { ctx: { fs, sessions: { get: (id) => id === 's1' ? { header: { cwd: '/repo' } } : undefined },
    sessionPersistence: { stat: async () => undefined },
    sandboxPolicy: { defaultMode: 'workspace-write', resolve: ({ mode } = {}) =>
      ({ mode: mode || 'workspace-write', workspaceRoot: '/repo', sessionId: 's1' }) } }, record };
}

test('Host entry exposes both named and default plugin exports', () => {
  assert.equal(plugin.name, 'dsh-openspec-dashboard');
  assert.equal(plugin.apply, apply);
  assert.ok(plugin.inject.includes('connection'));
});

test('one checkbox change preserves the rest of tasks.md including CRLF', async () => {
  const { ctx, record } = fixture();
  const result = await updateTask(ctx, valid);
  assert.equal(result.status, 200);
  assert.equal(result.data.version, 'v2');
  assert.equal(record.content, initial.replace('- [ ] 1.1', '- [x] 1.1'));
  assert.equal(record.writes, 1);
});

test('large task files and lines beyond 500 remain safely editable', async () => {
  const longTask = '- [ ] ' + 'A'.repeat(5000);
  const lines = ['# Tasks', ...Array.from({ length: 500 }, (_, i) => 'Background ' + i), longTask,
    'Footer ' + 'z'.repeat(1024 * 1024)];
  const original = lines.join('\n');
  const { ctx, record } = fixture(original);
  const input = { ...valid, lineNumber: 502, expectedLine: longTask };
  const result = await updateTask(ctx, input);
  assert.equal(result.status, 200);
  assert.equal(record.content, original.replace(longTask, '- [x] ' + 'A'.repeat(5000)));
  assert.equal(record.writes, 1);
  assert.equal((await updateTask(ctx, { ...input, lineNumber: 2 })).status, 409);
});

test('stale version or changed task line never overwrites external edits', async () => {
  const { ctx, record } = fixture();
  record.version = 'v2';
  assert.equal((await updateTask(ctx, valid)).status, 409);
  record.version = 'v1';
  record.content = record.content.replace('First task', 'Changed by another editor');
  assert.equal((await updateTask(ctx, valid)).status, 409);
  assert.equal(record.writes, 0);
});

test('concurrent stale write refuses publication', async () => {
  const { ctx, record } = fixture();
  ctx.fs.writeText = async () => { throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' }); };
  assert.equal((await updateTask(ctx, valid)).status, 409);
  assert.equal(record.writes, 0);
});

test('respects a read-only session sandbox even when the checkbox was shown', async () => {
  const { ctx, record } = fixture();
  ctx.sandboxPolicy.resolve = () => ({ mode: 'read-only', workspaceRoot: '/repo', sessionId: 's1' });
  assert.equal((await updateTask(ctx, valid)).status, 403);
  assert.equal(record.writes, 0);
});

test('saved session checkbox works only after replaying its effective write permission', async () => {
  const { ctx, record } = fixture();
  ctx.sessions.get = () => undefined;
  ctx.sandboxPolicy.defaultMode = 'read-only';
  ctx.sessionPersistence.stat = async () => ({ header: { cwd: '/repo' } });
  let closed = 0;
  let events = [{ type: 'sandbox/mode', data: { mode: 'workspace-write' } }];
  ctx.sessionPersistence.open = async (id, access) => {
    assert.equal(id, 's1'); assert.equal(access, 'read');
    return { read: async (start, limit) => {
      assert.equal(start, 0); assert.equal(limit, 10001);
      return { events };
    }, close: async () => { closed++; } };
  };
  assert.equal((await updateTask(ctx, valid)).status, 200);
  assert.equal(record.writes, 1);
  assert.equal(closed, 1);
  record.content = initial; record.version = 'v1';
  events = [{ type: 'sandbox/mode', data: { mode: 'workspace-write' } },
    { type: 'sandbox/mode', data: { mode: 'read-only' } }];
  assert.equal((await updateTask(ctx, valid)).status, 403);
  assert.equal(record.writes, 1);
  assert.equal(closed, 2);
  events = [];
  assert.equal((await updateTask(ctx, valid)).status, 403);
  assert.equal(record.writes, 1);
});

test('saved session with an oversized or invalid permission log fails closed', async () => {
  const { ctx, record } = fixture();
  ctx.sessions.get = () => undefined;
  ctx.sessionPersistence.stat = async () => ({ header: { cwd: '/repo' } });
  let events = Array.from({ length: 10001 }, () => ({ type: 'other' }));
  ctx.sessionPersistence.open = async () => ({ read: async () => ({ events }), close: async () => {} });
  assert.deepEqual(await updateTask(ctx, valid), { status: 403, data: { error: 'session-policy-unavailable' } });
  events = [{ type: 'sandbox/mode', data: { mode: 'unknown' } }];
  assert.deepEqual(await updateTask(ctx, valid), { status: 403, data: { error: 'session-policy-unavailable' } });
  assert.equal(record.writes, 0);
});

test('rejects arbitrary paths, missing sessions, and symlinked task file', async () => {
  const { ctx, record } = fixture();
  assert.equal((await updateTask(ctx, { ...valid, slug: '../archive/change-a' })).status, 400);
  assert.equal((await updateTask(ctx, { ...valid, sessionId: 'absent' })).status, 404);
  ctx.fs.lstat = async (path) => ({ type: path.endsWith('/change-a') ? 'symlink' : path.endsWith('/tasks.md') ? 'file' : 'directory' });
  assert.equal((await updateTask(ctx, valid)).status, 404);
  assert.equal(record.writes, 0);
});

test('write errors reveal a safe code and stage but never the filename or private message', async () => {
  const { ctx } = fixture();
  ctx.fs.writeText = async () => { throw Object.assign(new Error('private path /repo/openspec/changes/change-a/tasks.md'),
    { code: 'FS_PERMISSION_DENIED' }); };
  assert.deepEqual(await updateTask(ctx, valid), { status: 500,
    data: { error: 'write-failed', stage: 'write', code: 'FS_PERMISSION_DENIED' } });
});

test('watch route streams only invalidations and closes its subscriber on disconnect', async () => {
  const { ctx } = fixture();
  let notify;
  let stopped = 0;
  const hub = { async subscribe(cwd, callback) {
    assert.equal(cwd, '/repo');
    notify = callback;
    return async () => { stopped++; };
  } };
  const route = createWatchRoute(ctx, hub);
  assert.equal(route.path, '/api/openspec-dashboard/watch');
  assert.deepEqual(Array.from(route.methods), ['GET']);
  const abort = new AbortController();
  const request = new Request('http://localhost/api/openspec-dashboard/watch?sessionId=s1', { signal: abort.signal });
  const response = await route.fetch(request);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'retry: 3000\nevent: ready\ndata: 1\n\n');
  notify('changed');
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'event: changed\ndata: 1\n\n');
  abort.abort();
  await new Promise(setImmediate);
  assert.equal(stopped, 1);
  assert.equal((await reader.read()).done, true);
  assert.equal((await route.fetch(new Request('http://localhost/api/openspec-dashboard/watch?sessionId=nope'))).status, 404);
});

test('watch startup failure returns no misleading ready event; shutdown ends the stream', async () => {
  const { ctx } = fixture();
  const url = 'http://localhost/api/openspec-dashboard/watch?sessionId=s1';
  const failed = createWatchRoute(ctx, {
    async subscribe(_cwd, notify) { notify('unavailable'); return async () => {}; },
  });
  const errorResponse = await failed.fetch(new Request(url));
  assert.equal(errorResponse.status, 503);
  assert.equal(errorResponse.headers.get('content-type'), 'application/json');
  let notify;
  let closes = 0;
  const route = createWatchRoute(ctx, { async subscribe(_cwd, callback) {
    notify = callback;
    return async () => { closes++; };
  } });
  const response = await route.fetch(new Request(url));
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/);
  notify('unavailable');
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: unavailable/);
  assert.equal((await reader.read()).done, true);
  assert.equal(closes, 1);
});

test('registers a buffered POST route on authenticated DSH connection', async () => {
  let route;
  const { ctx } = fixture();
  ctx.connection = { fetch: { register: (entry) => { route = entry; return async () => {}; } } };
  ctx.effect = (callback) => callback();
  apply(ctx);
  assert.equal(route.path, '/api/openspec-dashboard/task');
  assert.deepEqual(Array.from(route.methods), ['POST']);
  const request = new Request('http://localhost/api/openspec-dashboard/task', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(valid),
  });
  const response = await route.fetch(request);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, 'v2');
});
