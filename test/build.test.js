import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

test('package exports point to built Host and Client entries', () => {
  assert.equal(manifest.exports['.'], './dist/index.js');
  assert.equal(manifest.exports['./client'], './dist/client.js');
  assert.ok(manifest.files.includes('dist/index.js'));
  assert.ok(manifest.files.includes('dist/client.js'));
  assert.ok(!manifest.files.includes('dist/*.js'));
  assert.ok(!manifest.files.includes('dist/watch.js'));
  assert.equal(manifest.scripts.prepack, undefined); // Git installs must not require build-script approval.
  for (const filename of ['index.js', 'watch.js', 'client.js']) {
    assert.ok(statSync(new URL(`dist/${filename}`, root)).size > 0);
  }
});

test('published Host and Client bundles stay compact; watcher bundle remains test-only', () => {
  assert.ok(statSync(new URL('dist/index.js', root)).size < 17_000);
  assert.ok(statSync(new URL('dist/client.js', root)).size < 40_000);
  assert.ok(statSync(new URL('dist/watch.js', root)).size > 0);
});

test('plugin exposes its Client to independently launched Web profiles', () => {
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.dsh.client.immediately, true);
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'));
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
});

test('Client output registers the runtime module instead of bundling React', () => {
  const source = readFileSync(new URL('dist/client.js', root), 'utf8');
  let definition;
  const loader = { load(value) { definition = value; } };
  // The module registration is evaluated by the application; React is supplied by its factory.
  const sandbox = { window: { __ModuleLoader__: loader }, document: {}, AbortController,
    setTimeout, clearTimeout };
  runInNewContext(source, sandbox);
  assert.equal(definition?.id, 'dsh-openspec-dashboard');
  assert.equal(typeof definition.factory, 'function');
  const names = [];
  const react = { createElement() { return {}; }, Fragment: Symbol('Fragment') };
  const value = definition.factory((name) => { names.push(name); return react; });
  assert.deepEqual(names, ['react']);
  assert.equal(typeof value.apply, 'function');
  assert.ok(value.model.parseTasks);
});
