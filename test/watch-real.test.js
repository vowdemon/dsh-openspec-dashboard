import test from 'node:test';
import assert from 'node:assert/strict';
import { watch as nodeWatch } from 'node:fs';
import * as files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWatchHub } from '../dist/watch.js';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message) {
  for (let n = 0; n < 120; n++) {
    if (predicate()) return;
    await pause(25);
  }
  assert.fail(message);
}
function localFixtureFs() {
  const active = new Set();
  const watched = [];
  const closed = [];
  const type = (info) => info.isSymbolicLink() ? 'symlink' :
    info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other';
  const api = {
    active, watched, closed,
    async resolve(filename) {
      const absolute = path.resolve(filename);
      const real = await files.realpath(absolute).catch(() => absolute);
      return { targetKey: real, displayPath: real };
    },
    contains(parent, child) { return child.targetKey.startsWith(parent.targetKey + path.sep); },
    async lstat(filename) {
      try { return { type: type(await files.lstat(filename)) }; }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    },
    async stat(target) {
      try { const info = await files.stat(target.displayPath);
        return { type: type(info), dev: info.dev, ino: info.ino }; }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    },
    async listDir(directory) {
      return Promise.all((await files.readdir(directory.displayPath, { withFileTypes: true }))
        .map(async (entry) => {
          const target = await api.resolve(path.join(directory.displayPath, entry.name));
          const info = await api.stat(target);
          return { name: entry.name, type: info?.type || 'other', target };
        }));
    },
    async watch(target, changed, signal) {
      if (signal.aborted) throw new Error('cancelled');
      const info = await api.stat(target);
      const isDirectory = info?.type === 'directory';
      const observed = isDirectory ? target.displayPath : path.dirname(target.displayPath);
      const watcher = nodeWatch(observed, { persistent: false }, (_event, filename) => {
        if (isDirectory || String(filename) === path.basename(target.displayPath)) changed();
      });
      const entry = { target: target.displayPath, watcher };
      active.add(entry);
      watched.push(entry.target);
      watcher.on('error', changed);
      return async () => { watcher.close(); active.delete(entry); closed.push(entry.target); };
    },
  };
  return api;
}

test('real temporary directory changes trigger event-only invalidation and watcher cleanup', async () => {
  const temp = await files.mkdtemp(path.join(tmpdir(), 'dsh-osd-watch-'));
  const root = await files.realpath(temp);
  const tempRoot = await files.realpath(tmpdir());
  assert.ok(root.startsWith(tempRoot + path.sep + 'dsh-osd-watch-'));
  const fs = localFixtureFs();
  const hub = createWatchHub(fs, { debounceMs: 40 });
  const events = [];
  let unsubscribe;
  try {
    unsubscribe = await hub.subscribe(root, (event) => events.push(event));
    const changes = path.join(root, 'openspec', 'changes', 'example');
    await files.mkdir(changes, { recursive: true });
    await until(() => [...fs.active].some(({ target }) => target === changes),
      'new OpenSpec directory was not discovered');
    const tasks = path.join(changes, 'tasks.md');
    let seen = events.length;
    const initialWatches = fs.watched.length, initialCloses = fs.closed.length;
    await files.writeFile(tasks, '- [ ] Example\n');
    await until(() => events.length > seen, 'new Markdown file was not detected by its parent');
    assert.ok(![...fs.active].some(({ target }) => target === tasks));
    seen = events.length;
    await files.writeFile(tasks, '- [x] Example\n');
    await until(() => events.length > seen, 'Markdown change was not delivered');
    const replacement = path.join(changes, 'tasks.tmp');
    assert.ok(path.resolve(replacement).startsWith(root + path.sep));
    assert.ok(path.resolve(tasks).startsWith(root + path.sep));
    seen = events.length;
    await files.writeFile(replacement, '- [ ] Replaced\n');
    await files.rename(replacement, tasks);
    await until(() => events.length > seen, 'atomic replacement was not delivered');
    await pause(100);
    assert.equal(fs.watched.length, initialWatches);
    assert.equal(fs.closed.length, initialCloses);
    const spec = path.join(root, 'openspec', 'specs', 'api', 'spec.md');
    await files.mkdir(path.dirname(spec), { recursive: true });
    await until(() => [...fs.active].some(({ target }) => target === path.dirname(spec)),
      'new current spec directory was not watched');
    seen = events.length;
    await files.writeFile(spec, '# API\n');
    await until(() => events.length > seen, 'new current spec Markdown was not detected');
    const archive = path.join(root, 'openspec', 'changes', 'archive', 'example');
    await files.mkdir(path.dirname(archive), { recursive: true });
    await until(() => [...fs.active].some(({ target }) => target === path.dirname(archive)),
      'new archive directory was not watched');
    assert.ok((await files.realpath(changes)).startsWith(root + path.sep));
    assert.ok(path.resolve(archive).startsWith(root + path.sep));
    await files.rename(changes, archive);
    await until(() => [...fs.active].some(({ target }) => target === archive),
      'moved archive directory was not rearmed');
    assert.ok((await files.realpath(archive)).startsWith(root + path.sep));
    await files.rm(archive, { recursive: true });
    await until(() => ![...fs.active].some(({ target }) => target === archive || target.startsWith(archive + path.sep)),
      'removed archive directory retained a watcher');
    assert.ok(fs.active.size > 1);
  } finally {
    await unsubscribe?.();
    await hub.close();
    assert.equal(fs.active.size, 0);
    // Verify the exact canonical temporary root before deleting the isolated fixture.
    assert.equal(await files.realpath(temp), root);
    assert.ok(root.startsWith(tempRoot + path.sep + 'dsh-osd-watch-'));
    await files.rm(root, { recursive: true, force: true });
  }
});
