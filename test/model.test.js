import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8');
let definition;
const sandbox = { window: { __ModuleLoader__: { load: (value) => { definition = value; } } },
  AbortController, setTimeout, clearTimeout };
const React = {
  Fragment: 'fragment',
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (initial) => [initial === false ? true : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
};
runInNewContext(source, sandbox);
const { model } = definition.factory((name) => { assert.equal(name, 'react'); return React; });
const { parseTasks, parseTaskGroups, changeStatus, fileKind, taskErrorKey, applyTaskResult,
  summaryFrom, sortChanges, sortChangeFiles, visibleChanges, aggregateSpecs, specStatus,
  fileAddressFor, loadBoard, watchBoard, ChangeRow, SpecRow } = model;
const missing = { ok: false, error: { code: 'ENOENT', message: 'No such file' } };
test('neutral archive and other tags retain readable contrast in light and dark themes', () => {
  const rule = source.match(/\.osd-tag\[data-kind="archived"\],\.osd-tag\[data-kind="otherTag"\] \{([^}]*)\}/)?.[1];
  assert.ok(rule);
  const confirmed = source.match(/\.osd-tag\[data-kind="confirmedSpec"\] \{([^}]*)\}/)?.[1];
  assert.equal(confirmed, rule);
  assert.match(source, /data-kind="newSpec"[^\n]*--osd-hue:#0c86ad[^\n]*--dsw-alias-label-primary/);
  assert.doesNotMatch(source, /data-kind="newSpec"[^\n]*--osd-hue:#4075d2/);
  assert.doesNotMatch(rule, /state-idle-primary/);
  const text = Number(rule.match(/color:color-mix\(in srgb,var\(--dsw-alias-label-primary\) (\d+)%,var\(--dsw-alias-bg-layer-1\)\)/)?.[1]);
  const background = Number(rule.match(/background:color-mix\(in srgb,var\(--dsw-alias-label-primary\) (\d+)%,var\(--dsw-alias-bg-layer-1\)\)/)?.[1]);
  assert.ok(Number.isFinite(text) && Number.isFinite(background));
  const luminance = (value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  for (const [primary, surface] of [[20, 250], [235, 32]]) {
    const foreground = luminance(primary * text / 100 + surface * (1 - text / 100));
    const chip = luminance(primary * background / 100 + surface * (1 - background / 100));
    assert.ok((Math.max(foreground, chip) + 0.05) / (Math.min(foreground, chip) + 0.05) >= 4.5);
  }
});
function fakeRemote(listings, files) {
  return { workspaceFiles: {
    async list(id, path) {
      assert.equal(id, 'session');
      return path in listings ? { ok: true, value: { entries: listings[path], truncated: false } } : missing;
    },
    async read(id, path, range) {
      assert.equal(id, 'session');
      if (range.offset !== 1) return { ok: false, error: { code: 'gateway/bad-request', message: 'offset must be at least 1' } };
      if (!(path in files)) return missing;
      const value = files[path];
      return { ok: true, value: typeof value === 'string' ? { text: value, eof: true, version: 'v1' } : value };
    },
  } };
}

test('switching sidebar tabs retains the visited dashboard body', () => {
  let registration;
  const plugin = definition.factory(() => React);
  plugin.apply({
    remote: {},
    locale: { bind: () => (key) => key, register: () => () => {} },
    sidebarRightTabs: { register: (value) => { registration = value; return () => {}; } },
    slots: { inject: () => () => {} },
    effect: (callback, label) => label.includes('styles') ? () => {} : callback(),
  });
  assert.equal(registration.kind, 'openspec-dashboard');
  assert.equal(registration.keepMounted, true);
  assert.match(source, /data-kind="goalTag"[^\n]*--osd-hue:#4075d2/);
  assert.match(source, /data-kind="specTag"[^\n]*--osd-hue:#7955c3/);
});

test('Chinese views use localized names without a manual refresh control', () => {
  let translations;
  const plugin = definition.factory(() => React);
  plugin.apply({
    remote: {},
    locale: { bind: () => (key) => key, register: (_namespace, copy) => { translations = copy; return () => {}; } },
    sidebarRightTabs: { register: () => () => {} },
    slots: { inject: () => () => {} },
    effect: (callback, label) => label.includes('styles') ? () => {} : callback(),
  });
  assert.equal(translations.zh.changesView, '变更');
  assert.equal(translations.zh.specsView, '规格');
  assert.equal(translations.zh.changedSpec, '变更');
  assert.equal(translations.zh.newSpec, '新增');
  assert.equal(translations.zh.confirmedSpec, '确认');
  assert.equal(translations.zh.countUnit, '个');
  assert.equal(translations.zh.incompleteOnly, '仅看未完成');
  assert.equal(translations.en.incompleteOnly, 'Incomplete only');
  assert.equal(translations.en.countUnit, ' ');
  assert.equal(translations.zh.preparing, '筹划');
  assert.equal(translations.zh.underway, '进行');
  assert.equal(translations.zh.done, '完成');
  assert.equal(translations.zh.archived, '归档');
  assert.equal(translations.en.changesView, 'Change');
  assert.equal(translations.en.specsView, 'Spec');
  assert.doesNotMatch(source, /onClick:\s*\(\)\s*=>\s*refresh\(\(n\)\s*=>\s*n\s*\+\s*1\)\s*\}\s*,\s*t\(['"]refresh['"]\)/);
});

test('both views preserve toolbar and search positions without passive notices', () => {
  const render = (view, mode = 'active', t = (key) => key, variant = 'full', search = '') => {
    let Dashboard;
    const mockReact = {
      Fragment: 'fragment',
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
      useState: (initial) => [initial === 'changes' ? view : initial === 'active' ? mode : initial === '' ? search :
        initial && typeof initial === 'object' && 'loading' in initial
          ? { board: { missing: false, changes: variant === 'empty' ? [] : variant === 'sparse' ? [
              { slug: 'complete', archived: false, tasks: [{ done: true }], tasksTruncated: false, done: 1 },
              { slug: 'old', archived: true, tasks: [{ done: true }], tasksTruncated: false, done: 1 },
            ] : [
              { slug: 'planning', archived: false, tasks: [], tasksTruncated: false, done: 0 },
              { slug: 'progress', archived: false, tasks: [{ done: true }, { done: false }], tasksTruncated: false, done: 1 },
              { slug: 'complete', archived: false, tasks: [{ done: true }], tasksTruncated: false, done: 1 },
              { slug: 'old', archived: true, tasks: [{ done: true }], tasksTruncated: false, done: 1 },
            ], specs: variant === 'empty' ? [] : variant === 'sparse' ? [
              { name: 'confirmed', files: [{ relative: 'spec.md', path: '/repo/spec.md' }], changes: [] },
            ] : [
              { name: 'new', files: [], changes: [{ slug: 'change', files: [] }] },
              { name: 'changed', files: [{ relative: 'spec.md', path: '/repo/spec.md' }],
                changes: [{ slug: 'change', files: [] }] },
              { name: 'confirmed', files: [{ relative: 'spec.md', path: '/repo/spec.md' }], changes: [] },
            ], warnings: ['transient'], limited: true },
              sessionId: 'session', cwd: '/repo', refreshError: 'transient' } : initial, () => {}],
      useRef: (initial) => ({ current: initial }),
      useEffect: () => {},
    };
    const plugin = definition.factory(() => mockReact);
    plugin.apply({
      remote: {},
      locale: { bind: () => (key) => key, register: () => () => {} },
      sidebarRightTabs: { register: () => () => {} },
      slots: { inject: (_name, register) => { register(); return () => {}; },
        register: (_meta, component) => { Dashboard = component; return () => {}; } },
      effect: (callback, label) => label.includes('styles') ? () => {} : callback(),
    });
    return Dashboard({ sessionId: 'session', useSessions: () => '/repo',
      useTabInfo: () => ({ tab: { actions: { openResource() {} } } }), t });
  };
  const nodes = (tree) => tree && typeof tree === 'object'
    ? Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...tree.children.flatMap(nodes)] : [];
  for (const view of ['changes', 'specs']) {
    const tree = render(view);
    const elements = nodes(tree);
    const header = elements.find((node) => node.props.className === 'osd-head');
    const toolbar = elements.find((node) => node.props.className === 'osd-toolbar');
    const search = elements.find((node) => node.props.className === 'osd-search');
    const controls = elements.find((node) => node.props.className === 'osd-controls');
    assert.equal(tree.children[0], controls);
    assert.deepEqual(controls.children.map((node) => node?.props.className),
      ['osd-head', 'osd-view', 'osd-toolbar', 'osd-search']);
    assert.equal(header.children.filter((node) => node?.type === 'button').length, 0);
    assert.equal(toolbar.children[0].props.className, 'osd-filter');
    assert.equal(toolbar.children[1].props.className, 'osd-count osd-muted');
    assert.ok(elements.indexOf(toolbar) < elements.indexOf(search));
    assert.ok(!elements.some((node) => ['osd-refresh-error', 'osd-notice'].includes(node.props.className)));
    if (view === 'specs') {
      assert.equal(toolbar.children[0].children[0].props.className, 'osd-filter-label');
      assert.equal(toolbar.children[0].children[0].children[0], 'all');
      assert.equal(toolbar.children[1].children[0], '1countUnitnewSpec / 1countUnitchangedSpec / 1countUnitconfirmedSpec');
    } else assert.equal(toolbar.children[1].children[0],
      '1countUnitpreparing / 1countUnitunderway / 1countUnitdone / 1countUnitarchived');
  }
  const zh = { countUnit: '个', newSpec: '新增', changedSpec: '变更', confirmedSpec: '确认',
    preparing: '筹划', underway: '进行', done: '完成', archived: '归档' };
  const count = (view, mode) => render(view, mode, (key) => zh[key] || key).children[0].children[2].children[1].children[0];
  assert.equal(count('specs', 'active'), '1个新增 / 1个变更 / 1个确认');
  assert.equal(count('changes', 'active'), '1个筹划 / 1个进行 / 1个完成 / 1个归档');
  assert.equal(count('changes', 'archive'), count('changes', 'active'));
  const sparse = (view, variant) => render(view, 'all', (key) => zh[key] || key, variant)
    .children[0].children[2].children[1];
  assert.equal(sparse('changes', 'sparse').children[0], '1个完成 / 1个归档');
  assert.equal(sparse('specs', 'sparse').children[0], '1个确认');
  assert.equal(sparse('changes', 'empty'), null);
  assert.equal(sparse('specs', 'empty'), null);
  const searched = (view, search, mode = 'active') => render(view, mode, (key) => zh[key] || key, 'full', search)
    .children[0].children[2].children[1];
  assert.equal(searched('changes', '  PROGRESS  ').children[0], '1个进行');
  assert.equal(searched('changes', 'old').children[0], '1个归档');
  assert.equal(searched('changes', 'missing'), null);
  assert.equal(searched('specs', 'new').children[0], '1个新增');
  assert.equal(searched('specs', 'conf').children[0], '1个确认');
  assert.equal(searched('specs', 'missing'), null);
  assert.equal(searched('changes', '').children[0], count('changes', 'active'));
  assert.match(source, /\.osd-toolbar\s*\{[^}]*flex-wrap:wrap;[^}]*justify-content:space-between/);
  assert.match(source, /\.osd-count\s*\{[^}]*margin-left:auto;[^}]*text-align:right;[^}]*max-width:100%/);
  assert.match(source, /\.osd-filter\s*\{[^}]*flex-shrink:0;[^}]*min-height:28px/);
  assert.match(source, /\.osd-controls\s*\{[^}]*position:sticky;[^}]*top:0;[^}]*z-index:[1-9]/);
  assert.match(source, /\.osd-controls\s*\{[^}]*background:var\(--dsw-alias-bg-base\)/);
  assert.match(source, /\.osd\s*\{[^}]*overflow:auto/);
});

test('tasks.md regex extracts unordered and numbered checkboxes in source order', () => {
  const tasks = parseTasks('- [ ] Draft\n  - [x] Define\n1. [X] Test\n* [ ] Release\n- [not] invalid');
  assert.equal(tasks.length, 4);
  assert.equal(tasks[0].text, 'Draft');
  assert.equal(tasks[1].done, true);
  assert.equal(tasks[2].text, 'Test');
  assert.equal(tasks[3].done, false);
});

test('photoart tasks use numbered text after ordinary markdown checkboxes', () => {
  const tasks = parseTasks('## 1. 构建入口与资源边界\n\n- [ ] 1.1 在现有单一 app target 增加 FakeDebug 配置\n- [ ] 1.2 将假运行时代码放入独立文件');
  assert.deepEqual(Array.from(tasks, (item) => item.text), [
    '1.1 在现有单一 app target 增加 FakeDebug 配置',
    '1.2 将假运行时代码放入独立文件',
  ]);
  assert.equal(tasks.filter((task) => task.done).length, 0);
});

test('task groups retain heading order, original line identity and CRLF', () => {
  const groups = parseTaskGroups('# Tasks\r\n## 1. 基础工作\r\n- [x] 1.1 完成\r\n- [ ] 1.2 待做\r\n\r\n## 2. 后续工作\r\n- [ ] 2.1 待做\r\n');
  assert.deepEqual(Array.from(groups, (group) => group.title), ['1. 基础工作', '2. 后续工作']);
  assert.deepEqual(Array.from(groups[0].items, (task) => task.lineNumber), [3, 4]);
  assert.equal(groups[0].items[0].originalLine, '- [x] 1.1 完成\r');
  assert.equal(groups[1].items[0].lineNumber, 7);
});

test('change and document tags follow status and standard file identity', () => {
  const change = { archived: false, tasks: [{ done: false }, { done: false }], done: 0 };
  assert.equal(changeStatus(change), 'preparing');
  assert.equal(changeStatus({ ...change, done: 1 }), 'underway');
  assert.equal(changeStatus({ ...change, done: 2 }), 'done');
  assert.equal(changeStatus({ ...change, done: 2, tasksTruncated: true }), 'underway');
  assert.equal(changeStatus({ ...change, archived: true, done: 2 }), 'archived');
  assert.equal(changeStatus({ ...change, tasks: [] }), 'preparing');
  assert.deepEqual(['proposal.md', 'design.md', 'tasks.md', 'specs/new/spec.md', 'notes.md'].map(fileKind),
    ['goalTag', 'designTag', 'tasksTag', 'specTag', 'otherTag']);
});

test('task write failures map to actionable in-place notices', () => {
  assert.equal(taskErrorKey(409, 'task-file-changed'), 'taskConflict');
  assert.equal(taskErrorKey(403, 'workspace-read-only'), 'taskReadOnly');
  assert.equal(taskErrorKey(403, 'session-policy-unavailable'), 'taskPolicyUnknown');
  assert.equal(taskErrorKey(404, 'session-unavailable'), 'taskSessionMissing');
  assert.equal(taskErrorKey(401, 'bad-response'), 'taskAuthError');
  assert.equal(taskErrorKey(500, 'write-failed'), 'taskWriteError');
});

test('successful checkbox result updates group, count, and future write version', () => {
  const groups = parseTaskGroups('## Build\n- [ ] First\n- [x] Second');
  const change = { groups, tasks: groups[0].items, done: 1, tasksVersion: 'v1' };
  const updated = applyTaskResult(change, { lineNumber: 2, done: true, line: '- [x] First', version: 'v2' });
  assert.equal(updated.done, 2);
  assert.equal(updated.tasksVersion, 'v2');
  assert.equal(updated.groups[0].items[0].originalLine, '- [x] First');
  assert.equal(updated.tasks[0].done, true);
  assert.equal(change.tasks[0].done, false);
});

test('change order pins active ahead of newest-first archived in all mode', () => {
  const changes = [
    { slug: '2024-01-01-old', archived: true, title: 'Old', summary: '' },
    { slug: 'zeta', archived: false, title: 'Z', summary: '' },
    { slug: '2025-03-02-new', archived: true, title: 'New', summary: '' },
    { slug: 'alpha', archived: false, title: 'A', summary: '' },
  ];
  assert.deepEqual(Array.from(visibleChanges(changes, 'all', ''), (item) => item.slug),
    ['alpha', 'zeta', '2025-03-02-new', '2024-01-01-old']);
  assert.deepEqual(Array.from(visibleChanges(changes, 'archive', ''), (item) => item.slug),
    ['2025-03-02-new', '2024-01-01-old']);
  assert.deepEqual(Array.from(visibleChanges(changes, 'active', 'zeta'), (item) => item.slug), ['zeta']);
});

test('change list follows status order, then names; archives remain newest first', () => {
  const change = (slug, done, taskCount, archived = false) => ({ slug, title: slug, summary: '', archived,
    done, tasks: Array.from({ length: taskCount }, (_, index) => ({ done: index < done })), tasksTruncated: false });
  const changes = [
    change('2024-12-30-old', 0, 0, true), change('z-done', 1, 1),
    change('z-progress', 1, 2), change('z-plan', 0, 1),
    change('2025-01-01-new', 1, 1, true), change('a-done', 1, 1),
    change('a-progress', 1, 2), change('a-plan', 0, 0),
    change('plan-10', 0, 0), change('plan-2', 0, 0),
  ];
  const ordered = ['a-plan', 'plan-2', 'plan-10', 'z-plan', 'a-progress', 'z-progress', 'a-done', 'z-done',
    '2025-01-01-new', '2024-12-30-old'];
  assert.deepEqual(Array.from(visibleChanges(changes, 'all', ''), (item) => item.slug), ordered);
  assert.deepEqual(Array.from(visibleChanges(changes, 'active', ''), (item) => item.slug), ordered.slice(0, 8));
  assert.deepEqual(Array.from(visibleChanges(changes, 'archive', ''), (item) => item.slug), ordered.slice(8));
  assert.deepEqual(Array.from(visibleChanges(changes, 'all', 'a-'), (item) => item.slug),
    ['a-plan', 'a-progress', 'a-done']);
});

test('regular markdown precedes delta specs, sorting within each class', () => {
  const files = ['specs/b/spec.md', 'tasks.md', 'specs/a/spec.md', 'proposal.md', 'design.md']
    .map((relative) => ({ relative }));
  assert.deepEqual(Array.from(sortChangeFiles(files), (item) => item.relative),
    ['design.md', 'proposal.md', 'tasks.md', 'specs/a/spec.md', 'specs/b/spec.md']);
});

test('spec status distinguishes new, changed and confirmed files', () => {
  const changes = [{ slug: 'change', files: [] }];
  assert.equal(specStatus({ files: [], changes }), 'newSpec');
  assert.equal(specStatus({ files: [{ relative: 'spec.md', path: '/repo/spec.md' }], changes }), 'changedSpec');
  assert.equal(specStatus({ files: [{ relative: 'spec.md', path: '/repo/spec.md' }], changes: [] }), 'confirmedSpec');
});

test('aggregates active delta specs by name while retaining every change source', () => {
  const current = ['shared', 'confirmed', 'archive-only'].map((name) => ({ name, summary: name,
    files: [{ relative: 'spec.md', path: '/repo/openspec/specs/' + name + '/spec.md' }] }));
  const changes = [
    { slug: 'zeta', archived: false, files: [
      { relative: 'specs/shared/spec.md', path: '/repo/changes/zeta/specs/shared/spec.md' },
      { relative: 'specs/new/spec.md', path: '/repo/changes/zeta/specs/new/spec.md' },
      { relative: 'specs/new/notes.md', path: '/repo/changes/zeta/specs/new/notes.md' },
      { relative: 'proposal.md', path: '/repo/changes/zeta/proposal.md' },
    ] },
    { slug: 'alpha', archived: false, files: [
      { relative: 'specs/shared/spec.md', path: '/repo/changes/alpha/specs/shared/spec.md' },
      { relative: 'specs/nested/deep/spec.md', path: '/repo/changes/alpha/specs/nested/deep/spec.md' },
    ] },
    { slug: 'archived', archived: true, files: [
      { relative: 'specs/archive-only/spec.md', path: '/repo/changes/archive/archived/specs/archive-only/spec.md' },
      { relative: 'specs/old/spec.md', path: '/repo/changes/archive/archived/specs/old/spec.md' },
    ] },
  ];
  const specs = aggregateSpecs(current, changes);
  assert.deepEqual(Array.from(specs, (spec) => spec.name),
    ['nested/deep', 'new', 'shared', 'archive-only', 'confirmed']);
  assert.equal(specs.filter((spec) => spec.changes.length).length, 3);
  assert.equal(specs.filter((spec) => !spec.changes.length).length, 2);
  assert.deepEqual(Array.from(specs[2].changes, (source) => source.slug), ['alpha', 'zeta']);
  assert.deepEqual(Array.from(specs[1].changes[0].files, (file) => file.relative),
    ['specs/new/notes.md', 'specs/new/spec.md']);
  assert.equal(specs[2].files[0].path, '/repo/openspec/specs/shared/spec.md');
  assert.equal(specs[2].summary, 'shared');
  assert.deepEqual(Array.from(specs[1].files), []);
});

test('spec list follows new, changed, confirmed priority with natural names inside each', () => {
  const names = ['z-modified', 'a-modified', 'confirmed-10', 'confirmed-2'];
  const current = names.map((name) => ({ name, changes: [], files: [
    { relative: 'spec.md', path: '/repo/openspec/specs/' + name + '/spec.md' },
  ] }));
  const change = { slug: 'update', archived: false, files: [
    'z-modified', 'a-modified', 'new-10', 'new-2',
  ].map((name) => ({ relative: 'specs/' + name + '/spec.md', path: '/repo/changes/update/specs/' + name + '/spec.md' })) };
  const specs = aggregateSpecs(current, [change]);
  assert.deepEqual(Array.from(specs, (spec) => spec.name),
    ['new-2', 'new-10', 'a-modified', 'z-modified', 'confirmed-2', 'confirmed-10']);
  assert.deepEqual(Array.from(specs, specStatus),
    ['newSpec', 'newSpec', 'changedSpec', 'changedSpec', 'confirmedSpec', 'confirmedSpec']);
});

test('file navigation uses DSH session resource addresses, not browser file URLs', () => {
  assert.equal(fileAddressFor('session id', '/repo', '/repo/openspec/changes/c/specs/用户/spec.md'),
    'dsh-resource://file/session/session%20id/openspec/changes/c/specs/%E7%94%A8%E6%88%B7/spec.md');
  assert.equal(fileAddressFor('s', 'C:\\project', 'C:\\project\\openspec\\specs\\a\\spec.md'),
    'dsh-resource://file/session/s/openspec/specs/a/spec.md');
});

test('loads current specs alongside active deltas but excludes archived deltas', async () => {
  const listings = {
    '/repo/openspec/changes': [
      { name: 'beta', type: 'directory' }, { name: 'archive', type: 'directory' },
    ],
    '/repo/openspec/changes/archive': [{ name: '2025-01-01-old', type: 'directory' }],
    '/repo/openspec/changes/beta': [
      { name: 'proposal.md', type: 'file' }, { name: 'tasks.md', type: 'file' },
      { name: 'design.md', type: 'file' }, { name: 'specs', type: 'directory' },
    ],
    '/repo/openspec/changes/beta/specs': [{ name: 'beta', type: 'directory' }],
    '/repo/openspec/changes/beta/specs/beta': [{ name: 'spec.md', type: 'file' }],
    '/repo/openspec/changes/archive/2025-01-01-old': [{ name: 'proposal.md', type: 'file' }],
    '/repo/openspec/specs': [{ name: 'current', type: 'directory' }],
    '/repo/openspec/specs/current': [{ name: 'spec.md', type: 'file' }],
  };
  const files = {
    '/repo/openspec/changes/beta/proposal.md': '# Better UX\n## Why\nClear progress.',
    '/repo/openspec/changes/beta/tasks.md': '- [x] Design\n- [ ] Implement',
    '/repo/openspec/changes/beta/specs/beta/spec.md': '# Beta\n## Purpose\nMake the beta capability available.',
  };
  const board = await loadBoard(fakeRemote(listings, files), 'session', '/repo', new AbortController().signal);
  assert.equal(board.changes.length, 2);
  assert.equal(board.changes[0].title, 'beta');
  assert.equal(board.changes[1].title, '2025-01-01-old');
  assert.equal(board.changes[0].done, 1);
  assert.equal(board.changes[0].tasksVersion, 'v1');
  assert.deepEqual(Array.from(board.changes[0].files, (file) => file.relative),
    ['design.md', 'proposal.md', 'tasks.md', 'specs/beta/spec.md']);
  assert.equal(board.changes[1].archived, true);
  assert.deepEqual(Array.from(board.specs, (spec) => spec.name), ['beta', 'current']);
  assert.equal(board.specs[0].changes[0].slug, 'beta');
  assert.equal(board.specs[0].changes[0].files[0].path, '/repo/openspec/changes/beta/specs/beta/spec.md');
  assert.equal(board.specs[0].summary, 'Make the beta capability available.');
  assert.deepEqual(Array.from(board.specs[0].files), []);
  assert.deepEqual(Array.from(board.specs[1].changes), []);
  assert.equal(board.specs[1].files[0].path, '/repo/openspec/specs/current/spec.md');
  assert.deepEqual(Array.from(board.warnings), []);
});

test('task file pagination reads beyond 500 lines with stable line numbers', async () => {
  const lines = ['## Long', ...Array.from({ length: 499 }, (_, index) => 'Background ' + index), '- [ ] Later', '- [x] Last'];
  const offsets = [];
  const remote = fakeRemote({ '/repo/openspec/changes': [{ name: 'long', type: 'directory' }],
    '/repo/openspec/changes/long': [{ name: 'tasks.md', type: 'file' }] }, {});
  remote.workspaceFiles.read = async (_id, path, range) => {
    if (path.endsWith('/proposal.md')) return missing;
    assert.equal(path, '/repo/openspec/changes/long/tasks.md');
    offsets.push(range.offset);
    const start = range.offset - 1;
    return { ok: true, value: { text: lines.slice(start, start + range.limit).join('\n'),
      eof: start + range.limit >= lines.length, version: 'stable' } };
  };
  const board = await loadBoard(remote, 'session', '/repo', new AbortController().signal);
  assert.deepEqual(offsets, [1, 501]);
  assert.deepEqual(Array.from(board.changes[0].tasks, ({ lineNumber }) => lineNumber), [501, 502]);
  assert.equal(board.changes[0].tasksVersion, 'stable');
  assert.equal(board.changes[0].tasksTruncated, false);
  assert.equal(board.changes[0].done, 1);
});

test('task pagination fails closed on empty continuation and changing file version', async () => {
  const remote = fakeRemote({ '/repo/openspec/changes': [{ name: 'long', type: 'directory' }],
    '/repo/openspec/changes/long': [{ name: 'tasks.md', type: 'file' }] }, {});
  let continuation = { text: '', eof: false, version: 'v1' };
  remote.workspaceFiles.read = async (_id, path, range) => path.endsWith('/proposal.md') ? missing : { ok: true,
    value: range.offset === 1 ? { text: '## Build\n- [ ] First', eof: false, version: 'v1' } : continuation };
  const load = () => loadBoard(remote, 'session', '/repo', new AbortController().signal);
  await assert.rejects(load(), /Empty page during read/);
  continuation = { text: '- [ ] Second', eof: true, version: 'v2' };
  await assert.rejects(load(), /File changed during read/);
  continuation = { text: '- [ ] Second', eof: true, version: 'v1' };
  assert.equal((await load()).changes[0].tasks.length, 2);
});

test('new spec summary prefers spec.md and falls through empty earlier changes', async () => {
  const listings = {
    '/repo/openspec/changes': [
      { name: 'alpha', type: 'directory' }, { name: 'zeta', type: 'directory' },
    ],
    '/repo/openspec/changes/alpha': [{ name: 'specs', type: 'directory' }],
    '/repo/openspec/changes/alpha/specs': [{ name: 'new', type: 'directory' }],
    '/repo/openspec/changes/alpha/specs/new': [{ name: 'spec.md', type: 'file' }],
    '/repo/openspec/changes/zeta': [{ name: 'specs', type: 'directory' }],
    '/repo/openspec/changes/zeta/specs': [{ name: 'new', type: 'directory' }],
    '/repo/openspec/changes/zeta/specs/new': [
      { name: 'notes.md', type: 'file' }, { name: 'spec.md', type: 'file' },
    ],
  };
  const files = {
    '/repo/openspec/changes/alpha/specs/new/spec.md': '# New\n## Purpose\n',
    '/repo/openspec/changes/zeta/specs/new/notes.md': '# Notes\nIgnore this summary.',
    '/repo/openspec/changes/zeta/specs/new/spec.md': '# New\n## Purpose\nA new capability for visitors.',
  };
  const board = await loadBoard(fakeRemote(listings, files), 'session', '/repo', new AbortController().signal);
  assert.deepEqual(Array.from(board.specs, (spec) => spec.name), ['new']);
  assert.deepEqual(Array.from(board.specs[0].changes, (source) => source.slug), ['alpha', 'zeta']);
  assert.equal(board.specs[0].summary, 'A new capability for visitors.');
  assert.deepEqual(Array.from(board.warnings), []);
});

test('new spec without spec.md can summarize another Markdown source', async () => {
  const listings = {
    '/repo/openspec/changes': [{ name: 'alpha', type: 'directory' }],
    '/repo/openspec/changes/alpha': [{ name: 'specs', type: 'directory' }],
    '/repo/openspec/changes/alpha/specs': [{ name: 'new', type: 'directory' }],
    '/repo/openspec/changes/alpha/specs/new': [{ name: 'notes.md', type: 'file' }],
  };
  const files = {
    '/repo/openspec/changes/alpha/specs/new/notes.md': '# New\n## Purpose\nExplain the new capability.',
  };
  const board = await loadBoard(fakeRemote(listings, files), 'session', '/repo', new AbortController().signal);
  assert.equal(board.specs[0].summary, 'Explain the new capability.');
});

test('long current spec summary does not report a broken project', async () => {
  const listings = {
    '/repo/openspec/changes': [],
    '/repo/openspec/specs': [{ name: 'enhance', type: 'directory' }],
    '/repo/openspec/specs/enhance': [{ name: 'spec.md', type: 'file' }],
  };
  const files = {
    '/repo/openspec/specs/enhance/spec.md': { text: '# Enhance\n## Purpose\nImprove photographs.', eof: false },
  };
  const board = await loadBoard(fakeRemote(listings, files), 'session', '/repo', new AbortController().signal);
  assert.equal(board.specs[0].summary, 'Improve photographs.');
  assert.deepEqual(Array.from(board.warnings), []);
});

test('all active and archived changes remain visible beyond former cap', async () => {
  const active = Array.from({ length: 81 }, (_, i) => ({ name: 'change-' + String(i).padStart(3, '0'), type: 'directory' }));
  const listings = {
    '/repo/openspec/changes': [...active, { name: 'archive', type: 'directory' }],
    '/repo/openspec/changes/archive': [{ name: '2026-01-01-done', type: 'directory' }],
  };
  const board = await loadBoard(fakeRemote(listings, {}), 'session', '/repo', new AbortController().signal);
  assert.equal(board.limited, false);
  assert.equal(board.changes.filter((change) => !change.archived).length, 81);
  assert.equal(board.changes.filter((change) => change.archived).length, 1);
});

test('more than 120 Markdown files and 100 specs remain visible through deep directories', async () => {
  const listings = {
    '/repo/openspec/changes': [{ name: 'many', type: 'directory' }],
    '/repo/openspec/changes/many': [
      ...Array.from({ length: 121 }, (_, i) => ({ name: 'note-' + i + '.md', type: 'file' })),
      { name: 'a', type: 'directory' },
    ],
    '/repo/openspec/specs': Array.from({ length: 101 }, (_, i) => ({ name: 'spec-' + i, type: 'directory' })),
  };
  let location = '/repo/openspec/changes/many';
  for (const name of ['a', 'b', 'c', 'd']) {
    listings[location + '/' + name] = name === 'd' ? [{ name: 'deep.md', type: 'file' }] :
      [{ name: String.fromCharCode(name.charCodeAt(0) + 1), type: 'directory' }];
    location += '/' + name;
  }
  for (let i = 0; i < 101; i++) listings['/repo/openspec/specs/spec-' + i] = [{ name: 'spec.md', type: 'file' }];
  const board = await loadBoard(fakeRemote(listings, {}), 'session', '/repo', new AbortController().signal);
  assert.equal(board.changes[0].files.length, 122);
  assert.ok(board.changes[0].files.some((file) => file.relative === 'a/b/c/d/deep.md'));
  assert.equal(board.specs.length, 101);
  assert.equal(board.limited, false);
});

test('bounded concurrent change reads keep sorted results', async () => {
  const entries = Array.from({ length: 14 }, (_, i) => ({ name: 'change-' + String(i).padStart(2, '0'), type: 'directory' }));
  const listings = { '/repo/openspec/changes': entries };
  for (const entry of entries) listings['/repo/openspec/changes/' + entry.name] = [];
  const remote = fakeRemote(listings, {});
  const base = remote.workspaceFiles.list;
  let inFlight = 0;
  let peak = 0;
  remote.workspaceFiles.list = async (...args) => {
    if (args[1].startsWith('/repo/openspec/changes/change-')) {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
    }
    return base(...args);
  };
  const board = await loadBoard(remote, 'session', '/repo', new AbortController().signal);
  assert.equal(board.changes.length, entries.length);
  assert.ok(peak > 1 && peak <= 4, 'expected finite concurrent reads, got ' + peak);
  assert.deepEqual(Array.from(board.changes, (change) => change.slug), entries.map((entry) => entry.name));
});

test('single-file specs navigate directly; multiple files still expand for selection', () => {
  const opened = [];
  const props = { openFile: (path) => opened.push(path), t: (key) => key };
  const single = SpecRow({ ...props, spec: { name: 'ai-filter-catalog', summary: 'Current spec', changes: [],
    files: [{ path: '/repo/openspec/specs/ai-filter-catalog/spec.md', relative: 'spec.md' }] } });
  const singleButton = single.children[0];
  assert.equal(singleButton.props['aria-expanded'], undefined);
  assert.equal(singleButton.props['aria-label'], 'openFile: ai-filter-catalog');
  assert.equal(singleButton.children[0].children[1].props.kind, 'confirmedSpec');
  assert.equal(single.children.some((node) => node?.props?.className === 'osd-children'), false);
  assert.equal(singleButton.children.some((node) => node?.children?.includes('1 files')), false);
  singleButton.props.onClick();
  assert.deepEqual(opened, ['/repo/openspec/specs/ai-filter-catalog/spec.md']);

  const multiple = SpecRow({ ...props, spec: { name: 'multiple', changes: [], files: [
    { path: '/repo/specs/multiple/spec.md', relative: 'spec.md' },
    { path: '/repo/specs/multiple/notes.md', relative: 'notes.md' },
  ] } });
  assert.equal(multiple.children[0].props['aria-expanded'], true);
  assert.equal(multiple.children[1].props.className, 'osd-children');
  multiple.children[0].props.onClick();
  assert.equal(opened.length, 1);

  const empty = SpecRow({ ...props, spec: { name: 'empty', changes: [], files: [] } });
  assert.equal(empty.children[0].props['aria-expanded'], true);
  empty.children[0].props.onClick();
  assert.equal(opened.length, 1);
});

test('changed spec stays expandable and lists every change plus the current file', () => {
  const opened = [];
  const file = (path, relative = 'spec.md') => ({ path, relative });
  const row = SpecRow({ spec: { name: 'shared', summary: 'Current',
    files: [file('/repo/openspec/specs/shared/spec.md')], changes: [
      { slug: 'alpha', files: [file('/repo/openspec/changes/alpha/specs/shared/spec.md', 'specs/shared/spec.md')] },
      { slug: 'zeta', files: [file('/repo/openspec/changes/zeta/specs/shared/spec.md', 'specs/shared/spec.md')] },
    ] }, openFile: (path) => opened.push(path), t: (key) => key });
  const button = row.children[0];
  assert.equal(button.props['aria-expanded'], true);
  assert.equal(button.children[0].children[1].props.kind, 'changedSpec');
  button.props.onClick();
  assert.deepEqual(opened, []);
  const sources = [...row.children[1].children[0], row.children[1].children[1]];
  assert.deepEqual(sources.map((section) => section.children[0].children[0]),
    ['changesView · alpha', 'changesView · zeta', 'current']);
  for (const [index, section] of sources.entries()) {
    const component = section.children[1];
    const list = component.type(component.props);
    assert.equal(list.children[0][0].children[1].children[0], 'spec.md');
    list.children[0][0].props.onClick();
    assert.equal(opened[index], index === 2 ? '/repo/openspec/specs/shared/spec.md' :
      '/repo/openspec/changes/' + (index === 0 ? 'alpha' : 'zeta') + '/specs/shared/spec.md');
  }
  const newOnly = SpecRow({ spec: { name: 'new', files: [], changes: [
    { slug: 'alpha', files: [file('/repo/openspec/changes/alpha/specs/new/spec.md', 'specs/new/spec.md')] },
  ] }, openFile: (path) => opened.push(path), t: (key) => key });
  assert.equal(newOnly.children[0].props['aria-expanded'], true);
  assert.equal(newOnly.children[0].children[0].children[1].props.kind, 'newSpec');
  assert.equal(newOnly.children[1].children[1], false);
});

test('file-row action hands the selected file to DSH navigation', () => {
  const opened = [];
  const change = { title: 'Demo', summary: '', archived: false, slug: 'demo', tasks: [], done: 0,
    files: [{ path: '/repo/openspec/changes/demo/proposal.md', relative: 'proposal.md' }] };
  const row = ChangeRow({ change, openFile: (path) => opened.push(path),
    t: (key) => ({ goalTag: '目标', preparing: '筹划' })[key] || key });
  const children = row.children[1];
  const fileComponent = children.children[1];
  const fileList = fileComponent.type(fileComponent.props);
  fileList.children[0][0].props.onClick();
  assert.deepEqual(opened, ['/repo/openspec/changes/demo/proposal.md']);
  const fileTag = fileList.children[0][0].children[0];
  assert.equal(fileTag.type(fileTag.props).children[0], '目标');
  const statusTag = row.children[0].children[0].children[1];
  assert.equal(statusTag.type(statusTag.props).children[0], '筹划');
});

test('each change has its own accessible incomplete-only checkbox beside the task tab', () => {
  const original = React.useState;
  const instances = new Map();
  let active;
  let cursor;
  React.useState = (initial) => {
    const index = cursor++;
    const slots = instances.get(active);
    if (!(index in slots)) slots[index] = index === 0 ? true : index === 1 ? 'tasks' : initial;
    return [slots[index], (value) => { slots[index] = value; }];
  };
  const visit = (node, predicate, result = []) => {
    if (Array.isArray(node)) { node.forEach((child) => visit(child, predicate, result)); return result; }
    if (!node || typeof node !== 'object') return result;
    if (predicate(node)) result.push(node);
    (node.children || []).forEach((child) => visit(child, predicate, result));
    return result;
  };
  try {
    const groups = parseTaskGroups('## Build\n- [ ] First');
    const render = (directory) => {
      active = directory;
      cursor = 0;
      if (!instances.has(directory)) instances.set(directory, []);
      return ChangeRow({ change: { title: directory, directory, archived: false, groups,
        tasks: groups[0].items, done: 0, tasksVersion: 'v1' },
        openFile() {}, toggleGroup() {}, toggleTask() {}, t: (value) => value });
    };
    const filter = (directory) => visit(render(directory), (node) => node.props.className === 'osd-incomplete-filter')[0];
    const first = filter('/repo/first');
    const second = filter('/repo/second');
    assert.equal(first.type, 'label');
    assert.equal(first.children[1].children[0], 'incompleteOnly');
    assert.equal(first.children[0].props.checked, false);
    assert.equal(second.children[0].props.checked, false);
    first.children[0].props.onChange({ currentTarget: { checked: true } });
    assert.equal(filter('/repo/first').children[0].props.checked, true);
    assert.equal(filter('/repo/second').children[0].props.checked, false);
    const tabs = visit(render('/repo/first'), (node) => node.props.className === 'osd-child-tabs')[0];
    assert.equal(tabs.children[0].children[0][1].children[0], 'tasks');
    assert.match(source, /\.osd-child-tabs \{[^}]*flex-wrap:wrap/);
    assert.match(source, /\.osd-incomplete-filter \{[^}]*margin-left:auto/);
  } finally { React.useState = original; }
});

test('incomplete filter hides completed tasks and empty groups without changing progress', () => {
  const original = React.useState;
  const slots = [true, 'tasks', false];
  let cursor = 0;
  React.useState = (initial) => {
    const index = cursor++;
    return [slots[index] ?? initial, (value) => { slots[index] = value; }];
  };
  const visit = (node, predicate, result = []) => {
    if (Array.isArray(node)) { node.forEach((child) => visit(child, predicate, result)); return result; }
    if (!node || typeof node !== 'object') return result;
    if (predicate(node)) result.push(node);
    (node.children || []).forEach((child) => visit(child, predicate, result));
    return result;
  };
  try {
    const groups = parseTaskGroups('## Done\n- [x] Finished\n## Build\n- [x] Built\n- [ ] Next');
    const change = { title: 'demo', directory: '/repo/demo', archived: false, groups,
      tasks: groups.flatMap((group) => group.items), done: 2, tasksVersion: 'v1' };
    const collapsed = { '/repo/demo:1': false, '/repo/demo:3': false };
    const render = () => { cursor = 0; return ChangeRow({ change, collapsed,
      openFile() {}, toggleTask() {}, toggleGroup() {}, t: (key) => key }); };
    const filter = (row) => visit(row, (node) => node.props.className === 'osd-incomplete-filter')[0].children[0];
    const groupsIn = (row) => visit(row, (node) => node.props.className === 'osd-group');
    const tasksIn = (row) => visit(row, (node) => node.props.className === 'osd-task-row');
    const initial = render();
    assert.equal(groupsIn(initial).length, 2);
    assert.equal(tasksIn(initial).length, 3);
    assert.equal(filter(initial).props.checked, false);
    filter(initial).props.onChange({ currentTarget: { checked: true } });
    const filtered = render();
    assert.equal(groupsIn(filtered).length, 1);
    assert.equal(tasksIn(filtered).length, 1);
    assert.equal(tasksIn(filtered)[0].children[0].children[1].children[0], 'Next');
    assert.equal(visit(filtered, (node) => node.props.className === 'osd-group-count')[0].children[0], '1/2');
    assert.equal(visit(filtered, (node) => node.props.role === 'progressbar')[0].props['aria-valuenow'], 2);
    assert.equal(visit(filtered, (node) => node.props.className === 'osd-status osd-muted')[0].children[0].children[0], '2/3');
    assert.equal(collapsed['/repo/demo:1'], false);
    change.groups[1].items[1].done = true;
    change.done = 3;
    const empty = render();
    assert.equal(groupsIn(empty).length, 0);
    assert.equal(visit(empty, (node) => node.props.className === 'osd-state')[0].children[0], 'noIncompleteTasks');
    filter(empty).props.onChange({ currentTarget: { checked: false } });
    assert.equal(groupsIn(render()).length, 2);
    assert.equal(tasksIn(render()).length, 3);
  } finally { React.useState = original; }
});

test('finished task groups start folded without collapsing an opened group after completion', () => {
  const originals = { useState: React.useState, useRef: React.useRef };
  const defaults = { current: new Map() };
  let hook = 0;
  React.useState = (value) => [hook++ % 3 === 2 ? false : value === false ? true : value === 'files' ? 'tasks' : value, () => {}];
  React.useRef = () => defaults;
  try {
    const groups = parseTaskGroups('## Done\n- [x] First\n## Next\n- [ ] Second');
    const change = { title: 'demo', summary: '', archived: false, directory: '/repo/demo',
      groups, tasks: groups.flatMap((group) => group.items), done: 1, tasksVersion: 'v1' };
    const collapsed = {};
    const toggles = [];
    const props = { change, collapsed, t: (value) => value, openFile() {}, toggleTask() {},
      toggleGroup: (key, folded) => { toggles.push([key, folded]); collapsed[key] = !folded; } };
    const visit = (node, predicate, result = []) => {
      if (Array.isArray(node)) { node.forEach((child) => visit(child, predicate, result)); return result; }
      if (!node || typeof node !== 'object') return result;
      if (predicate(node)) result.push(node);
      (node.children || []).forEach((child) => visit(child, predicate, result));
      return result;
    };
    const buttons = () => visit(ChangeRow(props), (node) => node.props.className === 'osd-group-button');
    const initial = buttons();
    assert.deepEqual(initial.map((node) => node.props['aria-expanded']), [false, true]);
    initial[0].props.onClick();
    assert.deepEqual(toggles, [['/repo/demo:1', true]]);
    assert.deepEqual(buttons().map((node) => node.props['aria-expanded']), [true, true]);
    groups[1].items[0].done = true;
    change.done = 2;
    assert.deepEqual(buttons().map((node) => node.props['aria-expanded']), [true, true]);
    buttons()[1].props.onClick();
    assert.deepEqual(toggles[1], ['/repo/demo:3', false]);
    assert.deepEqual(buttons().map((node) => node.props['aria-expanded']), [true, false]);
  } finally { React.useState = originals.useState; React.useRef = originals.useRef; }
});

test('task subview exposes only checkbox edits, and archived tasks are disabled', () => {
  const original = React.useState;
  let hook = 0;
  React.useState = (value) => [hook++ % 3 === 2 ? false : value === false ? true : value === 'files' ? 'tasks' : value, () => {}];
  try {
    const groups = parseTaskGroups('## Build\n- [ ] First');
    const change = { title: 'demo', summary: '', archived: false, directory: '/repo/demo',
      tasks: groups[0].items, groups, done: 0, tasksVersion: 'v1', tasksPath: '/repo/demo/tasks.md' };
    const calls = [];
    const visit = (node, predicate, result = []) => {
      if (Array.isArray(node)) { node.forEach((child) => visit(child, predicate, result)); return result; }
      if (!node || typeof node !== 'object') return result;
      if (predicate(node)) result.push(node);
      (node.children || []).forEach((child) => visit(child, predicate, result));
      return result;
    };
    const props = { change, t: (value) => value, openFile() {}, collapsed: {},
      toggleGroup: (key) => calls.push(key), toggleTask: (_, task) => calls.push(task.lineNumber) };
    const row = ChangeRow(props);
    const inputs = visit(row, (node) => node.type === 'input' && node.props['aria-label'] === 'First');
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].props.disabled, false);
    inputs[0].props.onChange();
    assert.deepEqual(calls, [2]);
    const title = visit(row, (node) => node.type === 'span' && node.children.includes('First'))[0];
    assert.equal(title.props.onClick, undefined);
    const groupButton = visit(row, (node) => node.props.className === 'osd-group-button')[0];
    const groupCount = visit(groupButton, (node) => node.props.className === 'osd-group-count')[0];
    assert.equal(groupCount.children[0], '0/1');
    const mixedGroups = parseTaskGroups('## Build\n- [x] One\n- [x] Two\n- [ ] Three\n- [ ] Four\n- [ ] Five');
    const mixedRow = ChangeRow({ ...props, change: { ...change, groups: mixedGroups,
      tasks: mixedGroups[0].items, done: 2 } });
    assert.equal(visit(mixedRow, (node) => node.props.className === 'osd-group-count')[0].children[0], '2/5');
    groupButton.props.onClick();
    assert.deepEqual(calls, [2, '/repo/demo:1']);
    const pending = ChangeRow({ ...props, pendingTask: { lineNumber: 2, done: true } });
    const pendingInput = visit(pending, (node) => node.type === 'input' && node.props['aria-label'] === 'First')[0];
    assert.equal(pendingInput.props.checked, true);
    const event = { currentTarget: { checked: false } };
    pendingInput.props.onChange(event);
    assert.equal(event.currentTarget.checked, true);
    assert.deepEqual(calls, [2, '/repo/demo:1']);
    assert.equal(visit(pending, (node) => node.props.role === 'status').length, 0);
    assert.equal(visit(pending, (node) => node.props.className === 'osd-task-feedback').length, 0);
    const undo = ChangeRow({ ...props, change: { ...change, tasks: [{ ...change.tasks[0], done: true }],
      groups: [{ ...groups[0], items: [{ ...groups[0].items[0], done: true }] }] },
      collapsed: { '/repo/demo:1': false }, pendingTask: { lineNumber: 2, done: false } });
    assert.equal(visit(undo, (node) => node.type === 'input' && node.props['aria-label'] === 'First')[0].props.checked, false);
    const failed = ChangeRow({ ...props, taskFeedback: { lineNumber: 2, message: 'Cannot write' } });
    assert.equal(visit(failed, (node) => node.props.role === 'alert')[0].children[0], 'Cannot write');
    const archived = ChangeRow({ ...props, change: { ...change, archived: true } });
    assert.equal(visit(archived, (node) => node.type === 'input' && node.props['aria-label'] === 'First')[0].props.disabled, true);
  } finally { React.useState = original; }
});

test('filter never edits tasks; optimistic completion and failed writes remain visible correctly', () => {
  const original = React.useState;
  const slots = [true, 'tasks', false];
  let cursor = 0;
  React.useState = (initial) => {
    const index = cursor++;
    return [slots[index] ?? initial, (value) => { slots[index] = value; }];
  };
  const visit = (node, predicate, result = []) => {
    if (Array.isArray(node)) { node.forEach((child) => visit(child, predicate, result)); return result; }
    if (!node || typeof node !== 'object') return result;
    if (predicate(node)) result.push(node);
    (node.children || []).forEach((child) => visit(child, predicate, result));
    return result;
  };
  try {
    const groups = parseTaskGroups('## Build\n- [ ] First');
    const change = { title: 'demo', directory: '/repo/demo', archived: false, groups,
      tasks: groups[0].items, done: 0, tasksVersion: 'v1' };
    const writes = [];
    const render = (extra = {}) => { cursor = 0; return ChangeRow({ change, collapsed: { '/repo/demo:1': false },
      openFile() {}, toggleGroup() {}, toggleTask: (_, task) => writes.push(task.lineNumber),
      t: (key) => key, ...extra }); };
    const filter = (row) => visit(row, (node) => node.props.className === 'osd-incomplete-filter')[0].children[0];
    const task = (row) => visit(row, (node) => node.type === 'input' && node.props['aria-label'] === 'First')[0];
    filter(render()).props.onChange({ currentTarget: { checked: true } });
    assert.deepEqual(writes, []);
    task(render()).props.onChange({ currentTarget: { checked: true } });
    assert.deepEqual(writes, [2]);
    const optimistic = render({ pendingTask: { lineNumber: 2, done: true } });
    assert.equal(task(optimistic), undefined);
    assert.equal(visit(optimistic, (node) => node.props.className === 'osd-state')[0].children[0], 'noIncompleteTasks');
    const rejected = render({ taskFeedback: { lineNumber: 2, message: 'Cannot write' } });
    assert.equal(task(rejected).props.checked, false);
    assert.equal(visit(rejected, (node) => node.props.role === 'alert')[0].children[0], 'Cannot write');
    const archived = render({ change: { ...change, archived: true } });
    assert.equal(task(archived).props.disabled, true);
    assert.equal(filter(archived).props.disabled, undefined);
    filter(archived).props.onChange({ currentTarget: { checked: false } });
    assert.deepEqual(writes, [2]);
  } finally { React.useState = original; }
});

test('dashboard checkbox sends guarded request, updates count, and reports auth failure beside task', async () => {
  const originals = { useState: React.useState, useRef: React.useRef, useEffect: React.useEffect };
  const slots = [];
  let cursor = 0;
  React.useState = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  };
  React.useRef = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  };
  React.useEffect = (effect) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = effect();
  };
  let Dashboard;
  const remote = fakeRemote({
    '/repo/openspec/changes': [{ name: 'demo', type: 'directory' }],
    '/repo/openspec/changes/demo': [{ name: 'tasks.md', type: 'file' }],
  }, { '/repo/openspec/changes/demo/tasks.md': '## Build\n- [ ] First' });
  let sent;
  sandbox.fetch = async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) };
    return Response.json({ lineNumber: 2, done: true, line: '- [x] First', version: 'v2' });
  };
  try {
    const plugin = definition.factory(() => React);
    const rowType = plugin.model.ChangeRow;
    plugin.apply({
      remote, locale: { bind: () => (key) => key, register: () => () => {} },
      sidebarRightTabs: { register: () => () => {} },
      slots: { inject: (_key, factory) => factory(), register: (_meta, component) => { Dashboard = component; } },
      effect: (callback, label) => label.includes('styles') ? () => {} : callback(),
    });
    const render = () => { cursor = 0; return Dashboard({ sessionId: 'session',
      useSessions: (select) => select({ byId: { session: { cwd: '/repo' } } }),
      useTabInfo: () => ({ tab: { actions: { openResource() {} } } }), t: (key) => key }); };
    const findNode = (node, predicate) => {
      if (Array.isArray(node)) for (const child of node) { const match = findNode(child, predicate); if (match) return match; }
      else if (node && typeof node === 'object') {
        if (predicate(node)) return node;
        return findNode(node.children, predicate);
      }
      return null;
    };
    render();
    await new Promise(setImmediate);
    const view = render();
    let row = findNode(view, (node) => node.type === rowType);
    assert.ok(row, JSON.stringify(view).slice(0, 900));
    assert.equal(row.props.change.tasksVersion, 'v1');
    const operation = row.props.toggleTask(row.props.change, row.props.change.tasks[0]);
    row = findNode(render(), (node) => node.type === rowType);
    assert.deepEqual(JSON.parse(JSON.stringify(row.props.pendingTask)), { lineNumber: 2, done: true });
    await operation;
    row = findNode(render(), (node) => node.type === rowType);
    assert.equal(row.props.change.done, 1);
    assert.equal(row.props.change.tasksVersion, 'v2');
    assert.equal(sent.url, '/api/openspec-dashboard/task');
    assert.deepEqual(JSON.parse(JSON.stringify(sent.body)), { sessionId: 'session', slug: 'demo', lineNumber: 2,
      expectedLine: '- [ ] First', expectedVersion: 'v1', done: true });
    sandbox.fetch = async () => new Response('unauthorized', { status: 401 });
    const failedOperation = row.props.toggleTask(row.props.change, row.props.change.tasks[0]);
    row = findNode(render(), (node) => node.type === rowType);
    assert.equal(row.props.change.done, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(row.props.pendingTask)), { lineNumber: 2, done: false });
    await failedOperation;
    row = findNode(render(), (node) => node.type === rowType);
    assert.equal(row.props.change.done, 1);
    assert.equal(row.props.pendingTask, null);
    assert.deepEqual(JSON.parse(JSON.stringify(row.props.taskFeedback)), {
      lineNumber: 2, message: 'taskAuthError (HTTP 401 · unexpected-response)',
    });
    sandbox.fetch = async () => Response.json({ error: 'invalid-task' }, { status: 400 });
    await row.props.toggleTask(row.props.change, row.props.change.tasks[0]);
    row = findNode(render(), (node) => node.type === rowType);
    assert.deepEqual(JSON.parse(JSON.stringify(row.props.taskFeedback)), {
      lineNumber: 2, message: 'taskWriteError (HTTP 400 · invalid-task)',
    });
  } finally {
    Object.assign(React, originals);
    delete sandbox.fetch;
  }
});

test('background invalidations retain the board; failures and workspace switches do not displace it', async () => {
  const originals = { useState: React.useState, useRef: React.useRef, useEffect: React.useEffect };
  const slots = [];
  let cursor = 0;
  React.useState = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  };
  React.useRef = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  };
  React.useEffect = (effect, deps) => {
    const index = cursor++;
    if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) {
      slots[index]?.cleanup?.();
      slots[index] = { deps, cleanup: effect() };
    }
  };
  const listings = {
    '/repo/openspec/changes': [{ name: 'demo', type: 'directory' }],
    '/repo/openspec/changes/demo': [],
    '/repo/openspec/changes/next': [],
  };
  const remote = fakeRemote(listings, {});
  const originalList = remote.workspaceFiles.list;
  let blocker = null;
  remote.workspaceFiles.list = async (...args) => {
    if (args[1] === '/repo/openspec/changes' && blocker) await blocker;
    return originalList(...args);
  };
  let Dashboard;
  const findNode = (node, predicate) => {
    if (Array.isArray(node)) for (const child of node) { const found = findNode(child, predicate); if (found) return found; }
    else if (node && typeof node === 'object') {
      if (predicate(node)) return node;
      return findNode(node.children, predicate);
    }
    return null;
  };
  try {
    const plugin = definition.factory(() => React);
    const rowType = plugin.model.ChangeRow;
    plugin.apply({
      remote, locale: { bind: () => (key) => key, register: () => () => {} },
      sidebarRightTabs: { register: () => () => {} },
      slots: { inject: (_key, factory) => factory(), register: (_meta, component) => { Dashboard = component; } },
      effect: (callback, label) => label.includes('styles') ? () => {} : callback(),
    });
    let cwd = '/repo';
    const render = () => { cursor = 0; return Dashboard({ sessionId: 'session',
      useSessions: (select) => select({ byId: { session: { cwd } } }),
      useTabInfo: () => ({ tab: { actions: { openResource() {} } } }), t: (key) => key }); };
    render();
    await new Promise(setImmediate);
    let view = render();
    assert.equal(findNode(view, (node) => node.type === rowType).props.change.slug, 'demo');
    // The first hook holds the internal invalidation revision advanced by the event stream.
    const invalidate = () => { slots[0] += 1; };
    let release;
    blocker = new Promise((resolve) => { release = resolve; });
    listings['/repo/openspec/changes'] = [{ name: 'next', type: 'directory' }];
    invalidate();
    view = render();
    assert.equal(findNode(view, (node) => node.type === rowType).props.change.slug, 'demo');
    assert.equal(findNode(view, (node) => node.props.role === 'status' && node.children.includes('loading')), null);
    release(); blocker = null;
    await new Promise(setImmediate);
    view = render();
    assert.equal(findNode(view, (node) => node.type === rowType).props.change.slug, 'next');
    blocker = Promise.reject(new Error('temporary read failure'));
    invalidate();
    render();
    await new Promise(setImmediate);
    view = render();
    assert.equal(findNode(view, (node) => node.type === rowType).props.change.slug, 'next');
    assert.equal(findNode(view, (node) => node.props.className === 'osd-refresh-error'), null);
    blocker = null;
    cwd = '/other';
    view = render();
    assert.equal(findNode(view, (node) => node.type === rowType), null);
  } finally { Object.assign(React, originals); }
});

test('watch failure state follows the current session instead of leaking between sessions', () => {
  const original = { useState: React.useState, useRef: React.useRef, useEffect: React.useEffect };
  const slots = [];
  let cursor = 0;
  React.useState = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  };
  React.useRef = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  };
  React.useEffect = (effect, deps) => {
    const index = cursor++;
    if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) {
      slots[index]?.cleanup?.();
      slots[index] = { deps, cleanup: effect() };
    }
  };
  const streams = [];
  sandbox.EventSource = class {
    constructor(url) { this.url = url; this.listeners = {}; streams.push(this); }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    emit(name) { this.listeners[name]?.(); }
    close() { this.closed = true; }
  };
  try {
    let Dashboard;
    const plugin = definition.factory(() => React);
    plugin.apply({ remote: fakeRemote({}, {}), locale: { bind: () => (key) => key, register: () => () => {} },
      sidebarRightTabs: { register: () => () => {} },
      slots: { inject: (_key, factory) => factory(), register: (_meta, component) => { Dashboard = component; } },
      effect: (callback, label) => label.includes('styles') ? () => {} : callback() });
    let sessionId = 'first';
    const render = () => { cursor = 0; return Dashboard({ sessionId,
      useSessions: (select) => select({ byId: { first: { cwd: '/repo' }, second: { cwd: '/repo2' } } }),
      useTabInfo: () => ({ tab: { actions: { openResource() {} } } }), t: (key) => key }); };
    const header = () => render().children[0].children[0];
    const failed = () => header().props['data-watch-failed'];
    assert.equal(failed(), false);
    streams[0].emit('ready'); streams[0].emit('unavailable');
    assert.equal(failed(), true);
    assert.equal(header().children[1].props.className, 'osd-watch-failed');
    assert.equal(header().children[1].props.role, 'status');
    assert.equal(header().children[1].props['aria-label'], 'watchFailed');
    assert.equal(header().children[1].children[0], 'watchFailed');
    sessionId = 'second';
    assert.equal(failed(), false);
    assert.equal(header().children[1], false);
    assert.equal(streams[0].closed, true);
    assert.match(streams[1].url, /sessionId=second$/);
    streams[1].emit('ready');
    assert.equal(failed(), false);
    streams[1].onerror();
    assert.equal(failed(), true);
    streams[1].emit('ready');
    assert.equal(failed(), false);
    assert.equal(header().children[1], false);
  } finally { Object.assign(React, original); delete sandbox.EventSource; }
});

test('dashboard integration renders large change lists while keeping watcher failure in the title', async () => {
  const originals = { useState: React.useState, useRef: React.useRef, useEffect: React.useEffect };
  const slots = [];
  let cursor = 0;
  React.useState = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  };
  React.useRef = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  };
  React.useEffect = (effect, deps) => {
    const index = cursor++;
    if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) {
      slots[index]?.cleanup?.();
      slots[index] = { deps, cleanup: effect() };
    }
  };
  const streams = [];
  sandbox.EventSource = class {
    constructor() { this.listeners = {}; streams.push(this); }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    emit(name) { this.listeners[name]?.(); }
    close() { this.closed = true; }
  };
  const entries = Array.from({ length: 81 }, (_, i) => ({ name: 'large-' + i, type: 'directory' }));
  const listings = { '/repo/openspec/changes': entries };
  for (const entry of entries) listings['/repo/openspec/changes/' + entry.name] = [];
  try {
    let Dashboard;
    const plugin = definition.factory(() => React);
    const rowType = plugin.model.ChangeRow;
    plugin.apply({ remote: fakeRemote(listings, {}),
      locale: { bind: () => (key) => key, register: () => () => {} },
      sidebarRightTabs: { register: () => () => {} },
      slots: { inject: (_key, factory) => factory(), register: (_meta, component) => { Dashboard = component; } },
      effect: (callback, label) => label.includes('styles') ? () => {} : callback() });
    const render = () => { cursor = 0; return Dashboard({ sessionId: 'session',
      useSessions: (select) => select({ byId: { session: { cwd: '/repo' } } }),
      useTabInfo: () => ({ tab: { actions: { openResource() {} } } }), t: (key) => key }); };
    const nodes = (node) => node && typeof node === 'object'
      ? Array.isArray(node) ? node.flatMap(nodes) : [node, ...node.children.flatMap(nodes)] : [];
    render();
    await new Promise(setImmediate);
    let tree = render();
    assert.equal(nodes(tree).filter((node) => node.type === rowType).length, 81);
    const header = () => nodes(render()).find((node) => node.props.className === 'osd-head');
    assert.equal(header().children[1], false);
    streams[0].emit('unavailable');
    tree = render();
    assert.equal(nodes(tree).filter((node) => node.type === rowType).length, 81);
    assert.equal(header().children[1].props['aria-label'], 'watchFailed');
    streams[0].emit('ready'); // A closed unavailable stream cannot clear a newer failure.
    assert.equal(header().children[1].props['aria-label'], 'watchFailed');
    await new Promise((resolve) => setTimeout(resolve, 1020));
    streams[1].emit('ready');
    assert.equal(header().children[1], false);
  } finally {
    for (const slot of slots) slot?.cleanup?.();
    Object.assign(React, originals); delete sandbox.EventSource;
  }
});

test('compact accessible watcher notice remains inside a single title row', () => {
  assert.match(source, /\.osd-head \{[^}]*flex-wrap:nowrap; white-space:nowrap;[^}]*\}/);
  assert.match(source, /\.osd-head h1 \{[^}]*overflow:hidden; text-overflow:ellipsis; white-space:nowrap;[^}]*\}/);
  assert.match(source, /\.osd-watch-failed \{[^}]*max-width:60%;[^}]*text-overflow:ellipsis; white-space:nowrap;[^}]*\}/);
  assert.match(source, /watchFailed:"更新失效"/);
  assert.match(source, /watchFailed:"Updates unavailable"/);
});

test('event subscriptions coalesce changes, reconnect safely, and isolate tabs', async () => {
  const streams = [];
  sandbox.EventSource = class {
    constructor(url, opts) {
      this.url = url; this.opts = opts; this.listeners = {};
      this.closed = false; streams.push(this);
    }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    emit(name) { this.listeners[name]?.(); }
    close() { this.closed = true; }
  };
  const a = [], b = [], failures = [];
  try {
    const offA = watchBoard('session-a', () => a.push('updated'), (key) => failures.push(key), 5, 5);
    const offB = watchBoard('session-b', () => b.push('updated'), () => {}, 5, 5);
    assert.equal(streams.length, 2);
    assert.match(streams[0].url, /sessionId=session-a$/);
    assert.match(streams[1].url, /sessionId=session-b$/);
    assert.equal(streams[0].opts.withCredentials, true);
    streams[0].emit('ready'); streams[0].emit('changed'); streams[0].emit('changed');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(a, ['updated']);
    assert.deepEqual(b, []);
    streams[0].onerror();
    streams[0].emit('ready'); // Reconnection closes the error and catches up on missed events.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(a, ['updated', 'updated']);
    streams[0].readyState = 2; streams[0].onerror();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(streams.length, 3); // Permanently closed HTTP stream is explicitly reopened.
    assert.match(streams[2].url, /sessionId=session-a$/);
    streams[2].emit('ready');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(a, ['updated', 'updated', 'updated']);
    assert.deepEqual(failures, ['', 'watchError', '', 'watchError', '']);
    streams[2].emit('unavailable');
    assert.equal(streams[2].closed, true);
    assert.equal(failures.at(-1), 'watchError');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(streams.length, 4);
    streams[3].emit('ready');
    assert.equal(failures.at(-1), '');
    await new Promise((resolve) => setTimeout(resolve, 20));
    offA(); streams[3].emit('changed');
    streams[1].emit('changed');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(a, ['updated', 'updated', 'updated', 'updated']);
    assert.deepEqual(b, ['updated']);
    assert.equal(streams[0].closed, true);
    assert.equal(streams[3].closed, true);
    offB(); assert.equal(streams[1].closed, true);
  } finally { delete sandbox.EventSource; }
});

test('missing EventSource reports a failed watcher instead of silently doing nothing', () => {
  const errors = [];
  const stop = watchBoard('no-stream', () => {}, (key) => errors.push(key));
  assert.deepEqual(errors, ['watchError']);
  stop();
});

test('summary extraction plus missing OpenSpec empty state', async () => {
  assert.equal(summaryFrom('# Heading\n\n## Why\n\nWe need this.\n'), 'We need this.');
  const board = await loadBoard(fakeRemote({}, {}), 'session', '/repo', new AbortController().signal);
  assert.equal(board.missing, true);
});
