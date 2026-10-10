import test from 'node:test';
import assert from 'node:assert/strict';
import { createWatchHub } from '../dist/watch.js';

const delay = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeFs() {
  const nodes = new Map();
  const watchers = new Set();
  const closed = [];
  const watched = [];
  const listed = [];
  let deferClose = null;
  let deferWatch = null;
  let deferList = null;
  let serial = 0;
  const norm = (p) => p.replace(/\/$/, '') || '/';
  const target = (p) => ({ targetKey: norm(p), displayPath: norm(p) });
  const parent = (p) => norm(p).slice(0, norm(p).lastIndexOf('/')) || '/';
  const add = (p, type = 'directory', link = null) => nodes.set(norm(p), { type, link, ino: ++serial });
  const remove = (p) => {
    for (const key of [...nodes.keys()]) if (key === norm(p) || key.startsWith(norm(p) + '/')) nodes.delete(key);
  };
  const api = {
    nodes, watchers, closed, watched, listed, add, remove,
    setCloseGate(promise) { deferClose = promise; },
    setWatchGate(promise) { deferWatch = promise; },
    setListGate(promise) { deferList = promise; },
    async resolve(p, { signal } = {}) {
      if (signal?.aborted) throw new Error('aborted');
      const n = nodes.get(norm(p));
      return target(n?.link || p);
    },
    async stat(t) { const n = nodes.get(t.displayPath); return n && { type: n.type, dev: 1, ino: n.ino }; },
    async lstat(p) { const n = nodes.get(norm(p)); return n && { type: n.link ? 'symlink' : n.type }; },
    async listDir(t) {
      listed.push(t.displayPath);
      if (deferList) await deferList;
      return [...nodes].filter(([p]) => parent(p) === t.displayPath)
        .map(([p, n]) => ({ name: p.slice(p.lastIndexOf('/') + 1),
          type: n.link ? nodes.get(n.link)?.type || 'other' : n.type, target: target(n.link || p) }));
    },
    contains(a, b) { return b.displayPath === a.displayPath || b.displayPath.startsWith(a.displayPath + '/'); },
    async watch(t, changed, signal) {
      if (signal.aborted) throw new Error('aborted');
      const entry = { path: t.displayPath, changed, signal };
      watchers.add(entry);
      watched.push(entry.path);
      if (deferWatch) await deferWatch;
      return async () => {
        if (deferClose) await deferClose;
        watchers.delete(entry);
        closed.push(entry.path);
      };
    },
    fire(p, error) { for (const item of [...watchers]) if (item.path === p) item.changed(error); },
    paths() { return new Set([...watchers].map(({ path }) => path)); },
  };
  return api;
}

function fixture() {
  const fs = fakeFs();
  for (const p of ['/one', '/one/openspec', '/one/openspec/changes', '/one/openspec/specs',
    '/one/openspec/changes/archive', '/two', '/two/openspec']) fs.add(p);
  fs.add('/one/openspec/changes/a.md', 'file');
  return fs;
}

test('same workspace fans out through one group; other workspaces remain isolated', async () => {
  const fs = fixture(), hub = createWatchHub(fs, { debounceMs: 5 });
  const a = [], b = [], c = [];
  const ua = await hub.subscribe('/one', (event) => a.push(event));
  const count = fs.watchers.size;
  const ub = await hub.subscribe('/one', (event) => b.push(event));
  assert.equal(fs.watchers.size, count);
  const uc = await hub.subscribe('/two', (event) => c.push(event));
  assert.ok(!fs.paths().has('/one/openspec/changes/a.md'));
  fs.fire('/one/openspec/changes'); // Parent reports direct Markdown content changes.
  await delay();
  assert.deepEqual(a, ['changed']);
  assert.deepEqual(b, ['changed']);
  assert.deepEqual(c, []);
  await ua();
  assert.ok(fs.watchers.size > 0);
  fs.fire('/one/openspec/changes');
  await delay();
  assert.deepEqual(b, ['changed', 'changed']);
  await Promise.all([ub(), uc()]);
  assert.equal(fs.watchers.size, 0);
  await hub.close();
});

test('archive-heavy workspace watches directories, not hundreds of individual Markdown files', async () => {
  const fs = fixture();
  for (let i = 0; i < 300; i++) fs.add('/one/openspec/changes/archive/doc-' + i + '.md', 'file');
  const hub = createWatchHub(fs, { debounceMs: 5 });
  const events = [];
  const off = await hub.subscribe('/one', (event) => events.push(event));
  assert.equal(fs.watchers.size, 5);
  fs.fire('/one/openspec/changes/archive');
  await delay();
  assert.deepEqual(events, ['changed']);
  await off(); await hub.close();
});

test('root checks only openspec; file edits reuse watchers; directory changes touch only their branch', async () => {
  const fs = fakeFs(); fs.add('/work'); fs.add('/work/unrelated');
  const events = [], hub = createWatchHub(fs, { debounceMs: 5 });
  const off = await hub.subscribe('/work', (event) => events.push(event));
  assert.deepEqual([...fs.paths()], ['/work']);
  assert.deepEqual(fs.listed, []);
  fs.add('/work/openspec'); fs.add('/work/openspec/specs');
  fs.fire('/work'); await delay();
  assert.deepEqual(fs.listed, ['/work/openspec', '/work/openspec/specs']);
  fs.listed.length = 0;
  const before = fs.watched.length, closes = fs.closed.length;
  fs.add('/work/openspec/specs/spec.md', 'file');
  fs.fire('/work/openspec/specs'); await delay();
  assert.deepEqual(fs.listed, ['/work/openspec/specs']);
  assert.equal(fs.watched.length, before);
  assert.equal(fs.closed.length, closes);
  fs.listed.length = 0;
  fs.add('/work/openspec/specs/api'); fs.add('/work/openspec/specs/api/spec.md', 'file');
  fs.fire('/work/openspec/specs'); await delay();
  assert.deepEqual(fs.listed, ['/work/openspec/specs', '/work/openspec/specs/api']);
  assert.deepEqual(fs.watched.slice(before), ['/work/openspec/specs/api']);
  assert.equal(fs.closed.length, closes);
  fs.listed.length = 0;
  fs.remove('/work/openspec/specs/api'); fs.fire('/work/openspec/specs'); await delay();
  assert.deepEqual(fs.listed, ['/work/openspec/specs']);
  assert.deepEqual(fs.closed.slice(closes), ['/work/openspec/specs/api']);
  assert.equal(events.length, 4);
  await off(); await hub.close();
});

test('same-path directory replacement rebinds only affected subtree, not unchanged siblings', async () => {
  const fs = fixture(), hub = createWatchHub(fs, { debounceMs: 5 });
  fs.add('/one/openspec/specs/api'); fs.add('/one/openspec/specs/api/old');
  const off = await hub.subscribe('/one', () => {});
  fs.listed.length = 0;
  const before = fs.watched.length;
  fs.remove('/one/openspec/specs/api');
  fs.add('/one/openspec/specs/api'); fs.add('/one/openspec/specs/api/new');
  fs.fire('/one/openspec/specs'); await delay();
  assert.deepEqual(fs.listed, ['/one/openspec/specs', '/one/openspec/specs/api',
    '/one/openspec/specs/api/new']);
  assert.deepEqual(fs.watched.slice(before), ['/one/openspec/specs/api', '/one/openspec/specs/api/new']);
  assert.ok(fs.closed.includes('/one/openspec/specs/api/old'));
  assert.ok(!fs.closed.includes('/one/openspec/changes'));
  assert.ok(!fs.closed.includes('/one/openspec/specs'));
  await off(); await hub.close();
});

test('DSH Fs version metadata detects same-path replacement without inode fields', async () => {
  const fs = fixture();
  fs.add('/one/openspec/specs/api'); fs.add('/one/openspec/specs/api/old');
  const originalStat = fs.stat;
  fs.stat = async (target) => {
    const info = await originalStat(target);
    return info && { type: info.type, version: 'v' + info.ino };
  };
  const hub = createWatchHub(fs, { debounceMs: 5 });
  const off = await hub.subscribe('/one', () => {});
  const before = fs.watched.length;
  fs.fire('/one/openspec/specs'); await delay();
  assert.equal(fs.watched.length, before);
  assert.equal(fs.closed.length, 0);
  fs.remove('/one/openspec/specs/api');
  fs.add('/one/openspec/specs/api'); fs.add('/one/openspec/specs/api/new');
  fs.fire('/one/openspec/specs'); await delay();
  assert.deepEqual(fs.watched.slice(before), ['/one/openspec/specs/api', '/one/openspec/specs/api/new']);
  assert.ok(!fs.closed.includes('/one/openspec/changes'));
  await off(); await hub.close();
});

test('events arriving during a pending scan are reconciled afterwards', async () => {
  const fs = fixture(), hub = createWatchHub(fs, { debounceMs: 5 });
  const events = [];
  const off = await hub.subscribe('/one', (event) => events.push(event));
  let release;
  fs.setListGate(new Promise((resolve) => { release = resolve; }));
  fs.fire('/one/openspec/specs');
  await delay(12);
  fs.add('/one/openspec/changes/new');
  fs.fire('/one/openspec/changes');
  await delay(12);
  release();
  await delay(30);
  assert.ok(fs.paths().has('/one/openspec/changes/new'));
  assert.ok(fs.listed.includes('/one/openspec/changes'));
  assert.deepEqual(events, ['changed', 'changed']);
  await off(); await hub.close();
});

test('child watcher errors rebind its branch; root errors make group unavailable', async () => {
  const fs = fixture(), events = [], hub = createWatchHub(fs, { debounceMs: 5 });
  const off = await hub.subscribe('/one', (event) => events.push(event));
  fs.fire('/one/openspec/specs', new Error('replaced'));
  await delay();
  assert.deepEqual(events, ['changed']);
  assert.deepEqual(fs.closed, ['/one/openspec/specs']);
  assert.equal(fs.paths().has('/one/openspec/specs'), true);
  fs.fire('/one', new Error('root failed')); await delay();
  assert.deepEqual(events, ['changed', 'unavailable']);
  assert.equal(fs.watchers.size, 0);
  await off(); await hub.close();
});

test('symlink and outside-root children are never watched', async () => {
  const fs = fixture(); fs.add('/elsewhere'); fs.add('/elsewhere/external.md', 'file');
  fs.add('/one/openspec/specs/link', 'directory', '/elsewhere');
  fs.add('/one/openspec/specs/outside.md', 'file', '/elsewhere/external.md');
  const hub = createWatchHub(fs);
  const off = await hub.subscribe('/one', () => {});
  assert.ok(!fs.paths().has('/elsewhere'));
  assert.ok(!fs.paths().has('/elsewhere/external.md'));
  await off(); await hub.close();
});

test('paths, depth, roots and subscribers exceed old caps while sharing and releasing watchers', async () => {
  const fs = fixture();
  for (let i = 0; i < 9; i++) { fs.add('/extra-' + i); fs.add('/extra-' + i + '/openspec'); }
  for (let i = 0; i < 260; i++) fs.add('/one/openspec/specs/spec-' + i);
  let path = '/one/openspec/specs';
  for (let i = 0; i < 10; i++) { path += '/nested-' + i; fs.add(path); }
  const hub = createWatchHub(fs, { debounceMs: 5 });
  const events = [];
  const offs = [await hub.subscribe('/one', (event) => events.push(event))];
  for (let i = 0; i < 70; i++) offs.push(await hub.subscribe('/one', (event) => events.push(event)));
  for (let i = 0; i < 9; i++) offs.push(await hub.subscribe('/extra-' + i, (event) => events.push(event)));
  assert.ok(fs.paths().size > 256);
  assert.ok(fs.paths().has(path));
  assert.deepEqual(events, []);
  fs.fire(path); await delay();
  assert.equal(events.length, 71);
  assert.ok(events.every((event) => event === 'changed'));
  await Promise.all(offs.map((off) => off())); await hub.close();
  assert.equal(fs.watchers.size, 0);
});

test('runtime watcher allocation failure reports unavailable and releases all watchers', async () => {
  const fs = fakeFs(); fs.add('/work'); fs.add('/work/openspec');
  const watch = fs.watch;
  fs.watch = (target, ...rest) => target.displayPath === '/work/openspec/b'
    ? Promise.reject(new Error('OS watcher exhausted')) : watch(target, ...rest);
  const events = [], hub = createWatchHub(fs, { debounceMs: 5 });
  const off = await hub.subscribe('/work', (event) => events.push(event));
  fs.add('/work/openspec/a'); fs.fire('/work/openspec'); await delay();
  assert.equal(fs.watchers.size, 3);
  fs.add('/work/openspec/b'); fs.fire('/work/openspec'); await delay();
  assert.deepEqual(events, ['changed', 'changed', 'unavailable']);
  assert.equal(fs.watchers.size, 0);
  await off(); await hub.close();
});

test('watch callbacks during asynchronous initialization are queued and closed after abort', async () => {
  const fs = fakeFs(); fs.add('/work'); fs.add('/work/openspec');
  const hub = createWatchHub(fs, { debounceMs: 5 }), events = [];
  let release;
  fs.setWatchGate(new Promise((resolve) => { release = resolve; }));
  const subscription = hub.subscribe('/work', (event) => events.push(event));
  await delay(5);
  fs.fire('/work');
  fs.add('/work/openspec/changes');
  release();
  const off = await subscription;
  await delay();
  assert.ok(fs.paths().has('/work/openspec/changes'));
  assert.ok(events.includes('changed'));
  await off(); await hub.close();
  assert.equal(fs.watchers.size, 0);
});

test('watch errors report unavailable and release resources', async () => {
  const fs = fixture(), events = [], hub = createWatchHub(fs);
  const off = await hub.subscribe('/one', (event) => events.push(event));
  fs.fire('/one', new Error('watch failed')); await delay();
  assert.deepEqual(events, ['unavailable']);
  assert.equal(fs.watchers.size, 0);
  await off(); await hub.close();
});

test('unsubscribe and close await asynchronous watcher teardown; abort cleans up', async () => {
  const fs = fixture(), hub = createWatchHub(fs);
  const controller = new AbortController();
  const off = await hub.subscribe('/one', () => {}, controller.signal);
  let finish;
  fs.setCloseGate(new Promise((resolve) => { finish = resolve; }));
  let done = false;
  const closing = off().then(() => { done = true; });
  await delay(1); assert.equal(done, false);
  finish(); await closing;
  assert.equal(fs.watchers.size, 0);
  const shutdownEvents = [];
  const off2 = await hub.subscribe('/one', (event) => shutdownEvents.push(event));
  await hub.close(); assert.equal(fs.watchers.size, 0);
  assert.deepEqual(shutdownEvents, ['unavailable']);
  await off2();
  const aborted = new AbortController(); aborted.abort();
  const other = createWatchHub(fs);
  const noop = await other.subscribe('/one', () => {}, aborted.signal);
  assert.equal(fs.watchers.size, 0);
  await noop(); await other.close();
  const pending = createWatchHub(fs);
  let release;
  fs.setWatchGate(new Promise((resolve) => { release = resolve; }));
  const active = new AbortController();
  const subscription = pending.subscribe('/one', () => {}, active.signal);
  await delay(1);
  active.abort();
  release();
  const abortOff = await subscription;
  await abortOff(); await pending.close();
  assert.equal(fs.watchers.size, 0);
});
