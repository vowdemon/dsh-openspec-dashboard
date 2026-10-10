export interface Task { done: boolean; text: string; lineNumber: number; originalLine: string }
export interface TaskGroup { id: number; title: string | null; items: Task[] }
export interface BoardFile { relative: string; path: string }
export interface Change { slug: string; archived: boolean; directory: string; title: string; summary: string; groups: TaskGroup[]; tasks: Task[]; tasksPath: string | null; tasksVersion: string | null; tasksTruncated: boolean; done: number; files: BoardFile[] }
export interface SpecChangeSource { slug: string; files: BoardFile[] }
export interface Spec { name: string; summary?: string; files: BoardFile[]; changes: SpecChangeSource[] }
export interface Board { missing: boolean; changes: Change[]; specs: Spec[]; warnings: string[]; limited?: boolean }
interface RemoteError { code?: string; message?: string }
interface Listing { truncated: boolean; entries: { type: string; name: string }[] }
interface ReadValue { text: string; eof: boolean; version?: string | null }
type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: RemoteError };
export interface Remote { workspaceFiles: {
 list(sessionId: string, path: string, signal: AbortSignal): Promise<RemoteResult<Listing>>;
 read(sessionId: string, path: string, range: { offset: number; limit: number }, signal: AbortSignal): Promise<RemoteResult<ReadValue>>;
} }
export interface TaskWriteResult { lineNumber: number; done: boolean; line: string; version: string }
const MAX_SPEC_SUMMARY_READS = 4;
const READ_PAGE_LINES = 500;
const CHANGE_READ_CONCURRENCY = 4;
export function parseTaskGroups(text: string): TaskGroup[] {
  const groups: TaskGroup[] = [];
  let current: TaskGroup | null = null;
  for (const [index, line] of text.split('\n').entries()) {
    const heading = /^##\s+(.+?)\s*\r?$/.exec(line);
    if (heading) {
      current = { id: index + 1, title: heading[1], items: [] };
      groups.push(current);
      continue;
    }
    const match = /^\s*(?:[-*+]\s+|\d+[.)]\s+)\[([ xX])\]\s*(.*?)\s*\r?$/.exec(line);
    if (!match) continue;
    if (!current) {
      current = { id: 0, title: null, items: [] };
      groups.push(current);
    }
    current.items.push({ done: match[1].toLowerCase() === 'x', text: match[2],
      lineNumber: index + 1, originalLine: line });
  }
  return groups.filter((group) => group.items.length > 0);
}
export function parseTasks(text: string): Task[] { return parseTaskGroups(text).flatMap((group) => group.items); }
export function changeStatus(change: Pick<Change, "archived" | "tasks" | "tasksTruncated" | "done">): 'archived' | 'done' | 'underway' | 'preparing' {
  if (change.archived) return 'archived';
  if (change.tasks.length && !change.tasksTruncated && change.done === change.tasks.length) return 'done';
  return change.done > 0 ? 'underway' : 'preparing';
}
export function specStatus(spec: Pick<Spec, 'files' | 'changes'>): 'newSpec' | 'changedSpec' | 'confirmedSpec' {
  if (!spec.changes.length) return 'confirmedSpec';
  return spec.files.length ? 'changedSpec' : 'newSpec';
}
export function fileKind(relative: string): string {
  const name = relative.toLowerCase();
  if (name.startsWith('specs/')) return 'specTag';
  if (name === 'proposal.md') return 'goalTag';
  if (name === 'design.md') return 'designTag';
  if (name === 'tasks.md') return 'tasksTag';
  return 'otherTag';
}
export function taskErrorKey(status: number, code: unknown): string {
  if (status === 409) return 'taskConflict';
  if (status === 401) return 'taskAuthError';
  if (status === 403 && code === 'workspace-read-only') return 'taskReadOnly';
  if (status === 403 && code === 'session-policy-unavailable') return 'taskPolicyUnknown';
  if (status === 404 && code === 'session-unavailable') return 'taskSessionMissing';
  return 'taskWriteError';
}
export function taskDiagnostic(status: number, result: { error?: unknown; code?: unknown; stage?: unknown } | null): string {
  const code = typeof result?.error === 'string' && /^[a-z][a-z0-9-]{1,60}$/.test(result.error)
    ? result.error : 'unexpected-response';
  const detail = typeof result?.code === 'string' && /^(?:FS_[A-Z0-9_]+|E[A-Z0-9_]+)$/.test(result.code)
    ? '/' + result.code : '';
  const stage = (result?.stage === 'write' || result?.stage === 'request') ? ' · ' + result.stage : '';
  return 'HTTP ' + status + ' · ' + code + detail + stage;
}
export function applyTaskResult<T extends Pick<Change, "groups" | "tasks" | "tasksVersion" | "done">>(change: T, result: TaskWriteResult): T {
  const groups = change.groups.map((group) => ({ ...group, items: group.items.map((task) =>
    task.lineNumber === result.lineNumber ? { ...task, done: result.done, originalLine: result.line } : task) }));
  const tasks = groups.flatMap((group) => group.items);
  return { ...change, groups, tasks, tasksVersion: result.version,
    done: tasks.filter((task) => task.done).length };
}
export function summaryFrom(text: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+(Why|Summary|Motivation|Purpose|概述|背景|为什么|目的)(?:\s|$)/i.test(line));
  const source = (start >= 0 ? lines.slice(start + 1) : lines).filter((line) =>
    line.trim() && !/^\s*(#|[-*]\s|>|```|\|)/.test(line));
  return (source[0] || '').trim().slice(0, 160);
}
export function join(base: string, child: string): string { return base.replace(/[/\\]+$/, '') + '/' + child; }
export function fileAddressFor(sessionId: string, cwd: string, path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const relative = normalized.startsWith(root + '/') ? normalized.slice(root.length + 1) : normalized;
  const segment = (part: string) => encodeURIComponent(part).replace(/%3A/gi, ':');
  return 'dsh-resource://file/session/' + segment(sessionId) + '/' + relative.split('/').map(segment).join('/');
}
export function sortChangeFiles<T extends { relative: string }>(files: T[]): T[] {
  return files.slice().sort((a, b) =>
    Number(a.relative.startsWith('specs/')) - Number(b.relative.startsWith('specs/')) ||
    a.relative.localeCompare(b.relative, undefined, { numeric: true, sensitivity: 'base' }));
}
export function sortChanges<T extends { slug: string; archived: boolean }>(changes: T[]): T[] {
  return changes.slice().sort((a, b) =>
    Number(a.archived) - Number(b.archived) || (a.archived
      ? b.slug.localeCompare(a.slug, undefined, { numeric: true })
      : a.slug.localeCompare(b.slug, undefined, { numeric: true })));
}
export function aggregateSpecs(current: Spec[], changes: Pick<Change, 'slug' | 'archived' | 'files'>[]): Spec[] {
  const byName = new Map<string, Spec>(current.map((spec) => [spec.name, { ...spec, changes: [] }]));
  for (const change of sortChanges(changes.filter((item) => !item.archived))) {
    const filesBySpec = new Map<string, BoardFile[]>();
    for (const file of change.files) {
      const match = /^specs\/(.+)\/[^/]+\.md$/i.exec(file.relative);
      if (!match) continue;
      const name = match[1];
      const files = filesBySpec.get(name) || [];
      files.push(file);
      filesBySpec.set(name, files);
    }
    for (const [name, files] of filesBySpec) {
      let spec = byName.get(name);
      if (!spec) {
        spec = { name, files: [], changes: [] };
        byName.set(name, spec);
      }
      spec.changes.push({ slug: change.slug, files: sortChangeFiles(files) });
    }
  }
  const priority = { newSpec: 0, changedSpec: 1, confirmedSpec: 2 };
  return [...byName.values()].sort((a, b) =>
    priority[specStatus(a)] - priority[specStatus(b)] ||
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}
export function visibleChanges<T extends Pick<Change, 'slug' | 'archived' | 'title' | 'summary'> &
  Partial<Pick<Change, 'tasks' | 'tasksTruncated' | 'done'>>>(changes: T[], mode: string, search: string): T[] {
  const needle = search.trim().toLocaleLowerCase();
  const priority = { preparing: 0, underway: 1, done: 2, archived: 3 };
  const rank = (change: T) => priority[changeStatus({ archived: change.archived,
    tasks: change.tasks || [], tasksTruncated: change.tasksTruncated || false, done: change.done || 0 })];
  return sortChanges(changes).filter((change) =>
    (mode === 'all' || (mode === 'archive') === change.archived) &&
    (!needle || (change.slug + ' ' + change.title + ' ' + change.summary).toLocaleLowerCase().includes(needle)))
    .sort((a, b) => rank(a) - rank(b));
}
export function failure(result: { error?: RemoteError }): string { return result.error?.message || result.error?.code || 'Remote read failed'; }
export function isMissing(error: RemoteError | undefined): boolean { return /not.found|enoent|does not exist|no such file|missing/i.test(String(error?.code || '') + ' ' + String(error?.message || '')); }
export async function loadBoard(remote: Remote, sessionId: string, cwd: string, signal: AbortSignal): Promise<Board> {
  const warnings: string[] = [];
  const root = join(cwd, 'openspec');
  const changesPath = join(root, 'changes');
  async function list(path: string, optional = false): Promise<Listing | null> {
    const result = await remote.workspaceFiles.list(sessionId, path, signal);
    if (result.ok) return result.value;
    if (optional && isMissing(result.error)) return null;
    throw new Error(failure(result));
  }
  async function read(path: string, allLines = false): Promise<{ text: string; exists: boolean; version: string | null; eof: boolean }> {
    let offset = 1;
    let text = '';
    let version: string | null = null;
    for (;;) {
      if (signal.aborted) throw new Error('Aborted');
      const result = await remote.workspaceFiles.read(sessionId, path, { offset, limit: READ_PAGE_LINES }, signal);
      if (!result.ok) {
        if (offset > 1) throw new Error('File changed during read');
        if (!isMissing(result.error)) warnings.push(path);
        return { text: '', exists: false, version: null, eof: true };
      }
      const page = result.value;
      const currentVersion = page.version || null;
      if (offset > 1 && currentVersion !== version) throw new Error('File changed during read');
      version = currentVersion;
      if (offset > 1 && text && !text.endsWith('\n')) text += '\n';
      text += page.text;
      if (page.eof || !allLines) return { text, exists: true, version, eof: page.eof };
      const lines = page.text.split('\n').length - Number(page.text.endsWith('\n'));
      if (!page.text || lines < 1) throw new Error('Empty page during read');
      offset += lines;
    }
  }
  async function markdownFiles(directory: string, prefix: string): Promise<BoardFile[]> {
    if (signal.aborted) throw new Error('Aborted');
    let listing;
    try { listing = await list(directory, true); }
    catch (error) { warnings.push(directory); return []; }
    if (!listing) return [];
    if (listing.truncated) warnings.push(directory);
    let files = listing.entries.filter((entry) => entry.type === 'file' && /\.md$/i.test(entry.name))
      .map((entry) => ({ relative: prefix + entry.name, path: join(directory, entry.name) }));
    for (const entry of listing.entries) {
      if (entry.type === 'directory') files = files.concat(await markdownFiles(join(directory, entry.name), prefix + entry.name + '/'));
    }
    return files;
  }
  const [changeListing, specListing] = await Promise.all([list(changesPath, true), list(join(root, 'specs'), true)]);
  if (!changeListing && !specListing) return { missing: true, changes: [], specs: [], warnings };
  const archivePath = join(changesPath, 'archive');
  const archived = changeListing?.entries.find((entry) => entry.type === 'directory' && entry.name === 'archive');
  const archiveListing = archived ? await list(archivePath, true).catch((error) => { warnings.push(String(error)); return null; }) : null;
  const directories: { slug: string; archived: boolean; base: string }[] = [
    ...(changeListing?.entries || []).filter((entry) => entry.type === 'directory' && entry.name !== 'archive')
      .map((entry) => ({ slug: entry.name, archived: false, base: changesPath })),
    ...(archiveListing?.entries || []).filter((entry) => entry.type === 'directory')
      .map((entry) => ({ slug: entry.name, archived: true, base: archivePath })),
  ];
  const limited = !!changeListing?.truncated || !!archiveListing?.truncated || !!specListing?.truncated;
  const selected = sortChanges(directories);
  const changes: Change[] = new Array(selected.length);
  let nextChange = 0;
  async function readChanges(): Promise<void> {
    while (nextChange < selected.length) {
      if (signal.aborted) throw new Error('Aborted');
      const index = nextChange++;
      const { slug, archived: isArchived, base } = selected[index];
      const directory = join(base, slug);
      const [proposal, tasks, files] = await Promise.all([
        read(join(directory, 'proposal.md')), read(join(directory, 'tasks.md'), true),
        markdownFiles(directory, ''),
      ]);
      const groups = parseTaskGroups(tasks.text);
      const taskItems = groups.flatMap((group) => group.items);
      changes[index] = { slug, archived: isArchived, directory,
        title: slug, summary: summaryFrom(proposal.text), groups,
        tasks: taskItems, tasksPath: tasks.exists ? join(directory, 'tasks.md') : null,
        tasksVersion: tasks.version, tasksTruncated: tasks.exists && !tasks.eof,
        done: taskItems.filter((item) => item.done).length, files: sortChangeFiles(files) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(CHANGE_READ_CONCURRENCY, selected.length) }, () => readChanges()));
  const specs: Spec[] = [];
  async function collectSpecs(directory: string, prefix: string): Promise<void> {
    if (signal.aborted) throw new Error('Aborted');
    const listing = await list(directory, true).catch((error) => { warnings.push(String(error)); return null; });
    if (!listing) return;
    if (listing.truncated) warnings.push(directory);
    const files = listing.entries.filter((entry) => entry.type === 'file' && /\.md$/i.test(entry.name))
      .map((entry) => ({ relative: entry.name, path: join(directory, entry.name) }));
    if (files.length && prefix) {
      const primary = files.find((file) => file.relative.toLowerCase() === 'spec.md');
      const text = primary ? await read(primary.path) : { text: '' };
      specs.push({ name: prefix, summary: summaryFrom(text.text), files: sortChangeFiles(files), changes: [] });
    }
    for (const entry of listing.entries) {
      if (entry.type === 'directory')
        await collectSpecs(join(directory, entry.name), prefix ? prefix + '/' + entry.name : entry.name);
    }
  }
  if (specListing) {
    const rootFiles = specListing.entries.filter((entry) => entry.type === 'file' && /\.md$/i.test(entry.name))
      .map((entry) => ({ relative: entry.name, path: join(root, 'specs/' + entry.name) }));
    if (rootFiles.length) specs.push({ name: 'specs', files: rootFiles, changes: [] });
    for (const entry of specListing.entries) if (entry.type === 'directory')
      await collectSpecs(join(root, 'specs/' + entry.name), entry.name);
  }
  const aggregated = aggregateSpecs(specs, changes);
  const visibleSpecs = aggregated;
  for (const spec of visibleSpecs) {
    if (spec.files.length || !spec.changes.length) continue;
    const files = spec.changes.flatMap((source) => source.files);
    const primary = ('specs/' + spec.name + '/spec.md').toLowerCase();
    const candidates = [
      ...files.filter((file) => file.relative.toLowerCase() === primary),
      ...files.filter((file) => file.relative.toLowerCase() !== primary),
    ];
    for (const file of candidates.slice(0, MAX_SPEC_SUMMARY_READS)) {
      if (signal.aborted) throw new Error('Aborted');
      const summary = summaryFrom((await read(file.path)).text);
      if (summary) { spec.summary = summary; break; }
    }
  }
  return { missing: false, changes, specs: visibleSpecs, warnings,
    limited };
}
