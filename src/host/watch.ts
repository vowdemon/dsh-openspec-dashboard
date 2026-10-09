import type { HostFs, FsInfo, FsTarget, StopWatching, WatchHub } from './types.js';

type WatchEvent = 'changed' | 'unavailable';
type Member = { notify: (event: WatchEvent) => void };
type Node = { target: FsTarget; parentKey: string | null; depth: number; children: Set<string>; close: StopWatching; version?: string };
type Group = { root: FsTarget; members: Set<Member>; controller: AbortController; nodes: Map<string, Node>; dirty: Set<string>; rebind: Set<string>; dead: boolean; failed: boolean; timer?: ReturnType<typeof setTimeout>; scanning?: Promise<void>; starting?: Promise<void>; stopping?: Promise<void> };
type Entry = { target: FsTarget; version?: string };
const errorCode = (error: unknown): string | undefined => error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
type Limits = { maxRoots: number; maxSubscribers: number; maxPaths: number; maxDepth: number; debounceMs: number };

/** Bounded, shared OpenSpec invalidation watchers. No file contents or paths reach subscribers. */
const DEFAULTS = { maxRoots: 8, maxSubscribers: 64, maxPaths: 256, maxDepth: 8, debounceMs: 120 };

export function createWatchHub(fs: HostFs, opts: Partial<Limits> = {}): WatchHub {
  const limits = { ...DEFAULTS, ...opts };
  const groups = new Map<string, Group>();
  let closed = false;
  let subscribers = 0;
  const append = (directory: FsTarget, name: string) => directory.displayPath.replace(/[/\\]+$/, '') + '/' + name;
  const validName = (name: string) => typeof name === 'string' && !!name && name !== '.' &&
    name !== '..' && !/[/\\\0]/.test(name);
  // The DSH Fs contract exposes version but not dev/ino. Parent events recheck direct
  // children only; a changed version safely rebinds that branch after atomic replacement.
  const identity = (info: FsInfo | null | undefined): string | undefined => info?.ino !== undefined && info?.dev !== undefined
    ? `inode:${info.dev}:${info.ino}` : typeof info?.version === 'string' ? `version:${info.version}` : undefined;

  function emit(group: Group, event: WatchEvent) {
    for (const member of group.members) {
      try { member.notify(event); } catch { /* An errant consumer cannot stop its peers. */ }
    }
  }

  async function stop(group: Group): Promise<void> {
    if (group.stopping) return group.stopping;
    group.dead = true;
    clearTimeout(group.timer);
    group.controller.abort();
    if (groups.get(group.root.targetKey) === group) groups.delete(group.root.targetKey);
    group.stopping = (async () => {
      // Initialization or reconciliation may still return a watcher after abort.
      if (group.starting) await group.starting.catch(() => {});
      if (group.scanning) await group.scanning.catch(() => {});
      const nodes = [...group.nodes.values()];
      group.nodes.clear();
      await Promise.allSettled(nodes.map(({ close }) => close()));
    })();
    return group.stopping;
  }

  function fail(group: Group): void {
    if (group.dead || group.failed) return;
    group.failed = true;
    emit(group, 'unavailable');
    void stop(group);
  }

  function queue(group: Group, key: string, error: { code?: string } | null | undefined, node: Node): void {
    if (group.dead || group.nodes.get(key) !== node) return;
    if (error) {
      if (node.parentKey === null) { fail(group); return; }
      // A removed/replaced child can no longer report changes. Its parent can
      // establish whether the path still exists and rebind just this subtree.
      group.rebind.add(key);
      group.dirty.add(node.parentKey);
    } else {
      group.dirty.add(key);
    }
    if (group.timer) return;
    group.timer = setTimeout(() => {
      group.timer = undefined;
      if (group.dead) return;
      emit(group, 'changed');
      drain(group);
    }, limits.debounceMs);
  }

  function drain(group: Group): void {
    if (group.dead || group.scanning || !group.dirty.size) return;
    group.scanning = (async () => {
      if (group.starting) await group.starting;
      while (group.dirty.size && !group.dead) {
        const keys = [...group.dirty];
        group.dirty.clear();
        for (const key of keys) {
          if (group.dead) break;
          const node = group.nodes.get(key);
          if (node) {
            try { await reconcile(group, node); }
            catch (error) {
              if (node.parentKey === null || !['ENOENT', 'ENOTDIR'].includes(errorCode(error) ?? '')) throw error;
              group.rebind.add(key);
              group.dirty.add(node.parentKey);
            }
          }
        }
      }
    })().catch(() => fail(group)).finally(() => {
      group.scanning = undefined;
      if (group.dirty.size && !group.dead) drain(group);
    });
  }

  async function remove(group: Group, key: string): Promise<void> {
    const node = group.nodes.get(key);
    if (!node) return;
    group.nodes.delete(key);
    group.dirty.delete(key);
    group.rebind.delete(key);
    if (node.parentKey !== null) group.nodes.get(node.parentKey)?.children.delete(key);
    for (const child of [...node.children]) await remove(group, child);
    await node.close();
  }

  async function add(group: Group, target: FsTarget, parentKey: string | null, depth: number, version?: string): Promise<void> {
    if (group.dead || group.nodes.has(target.targetKey)) return;
    if (group.nodes.size >= limits.maxPaths) throw new Error('Watch path limit exceeded');
    if (depth > limits.maxDepth) throw new Error('Watch depth limit exceeded');
    const node: Node = { target, parentKey, depth, children: new Set<string>(), close: async () => {}, version };
    let earlyEvent = false, earlyError: { code?: string } | null | undefined;
    const close = await fs.watch(target, (error) => {
      if (!group.nodes.has(target.targetKey)) {
        earlyEvent = true;
        earlyError ||= error;
      } else queue(group, target.targetKey, error, node);
    }, group.controller.signal);
    if (group.dead) { await close(); return; }
    node.close = close;
    group.nodes.set(target.targetKey, node);
    if (parentKey !== null) group.nodes.get(parentKey)?.children.add(target.targetKey);
    if (earlyEvent) queue(group, target.targetKey, earlyError, node);
    if (parentKey !== null) await reconcile(group, node);
  }

  async function directory(group: Group, parent: Node, name: string, proposed?: FsTarget): Promise<Entry | undefined> {
    if (!validName(name) || !proposed || !fs.contains(group.root, proposed)) return;
    const info = await fs.lstat(append(parent.target, name), undefined, group.controller.signal);
    if (info?.type !== 'directory') return;
    // Directory entries can go stale between listDir and lstat; avoid trusting
    // symlinks or targets which are no longer inside the canonical workspace.
    return { target: proposed, version: identity(await fs.stat(proposed, group.controller.signal)) };
  }

  async function reconcile(group: Group, node: Node): Promise<void> {
    if (group.dead || group.nodes.get(node.target.targetKey) !== node) return;
    if (node.parentKey === null) {
      // Root changes must never enumerate unrelated workspace directories.
      const path = append(node.target, 'openspec');
      const info = await fs.lstat(path, undefined, group.controller.signal);
      const target = info?.type === 'directory' ? await fs.resolve(path, { signal: group.controller.signal }) : undefined;
      const entry = target ? await directory(group, node, 'openspec', target) : undefined;
      await reconcileChildren(group, node, entry ? [entry] : []);
    } else {
      const entries = await fs.listDir(node.target, group.controller.signal);
      const wanted: Entry[] = [];
      for (const entry of entries) {
        if (entry.type !== 'directory') continue;
        const candidate = await directory(group, node, entry.name, entry.target);
        if (candidate) wanted.push(candidate);
      }
      await reconcileChildren(group, node, wanted);
    }
  }

  async function reconcileChildren(group: Group, parent: Node, entries: Entry[]): Promise<void> {
    if (group.dead) return;
    const wanted = new Map(entries.map((entry) => [entry.target.targetKey, entry]));
    for (const key of [...parent.children]) {
      const child = group.nodes.get(key);
      const replacement = wanted.get(key);
      if (!child || !replacement || group.rebind.has(key) ||
          (child.version !== undefined && replacement.version !== undefined && child.version !== replacement.version)) {
        await remove(group, key);
      }
    }
    for (const [key, entry] of wanted) {
      if (group.dead) return;
      if (!group.nodes.has(key)) await add(group, entry.target, parent.target.targetKey,
        parent.depth + 1, entry.version);
    }
  }

  async function subscribe(cwd: string, notify: (event: WatchEvent) => void, signal?: AbortSignal): Promise<() => Promise<void>> {
    if (closed) throw new Error('Watch hub closed');
    if (signal?.aborted) return async () => {};
    let root;
    try { root = await fs.resolve(cwd, { signal }); }
    catch (error) {
      if (signal?.aborted) return async () => {};
      notify('unavailable');
      return async () => {};
    }
    if (closed || signal?.aborted) return async () => {};
    let group = groups.get(root.targetKey);
    if (subscribers >= limits.maxSubscribers || (!group && groups.size >= limits.maxRoots)) {
      notify('unavailable');
      return async () => {};
    }
    if (!group) {
      group = { root, members: new Set(), controller: new AbortController(), nodes: new Map(),
        dirty: new Set(), rebind: new Set(), dead: false, failed: false,
        timer: undefined, scanning: undefined, starting: undefined };
      groups.set(root.targetKey, group);
    }
    const member = { notify };
    group.members.add(member);
    subscribers++;
    let removed = false;
    const unsubscribe = async () => {
      if (removed) return;
      removed = true;
      signal?.removeEventListener('abort', onAbort);
      group.members.delete(member);
      subscribers--;
      if (!group.members.size) await stop(group);
    };
    const onAbort = () => { void unsubscribe(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) await unsubscribe();
    if (!group.starting && !group.dead) {
      group.starting = (async () => {
        const info = await fs.stat(root, group.controller.signal);
        if (info?.type !== 'directory') throw new Error('Workspace unavailable');
        await add(group, root, null, -1, identity(info));
        const node = group.nodes.get(root.targetKey);
        if (node) await reconcile(group, node);
      })().catch(() => fail(group)).finally(() => { if (group.dirty.size) drain(group); });
    }
    if (group.starting) await group.starting;
    if (group.failed && group.stopping) await group.stopping;
    return unsubscribe;
  }

  async function close() {
    if (closed) return;
    closed = true;
    const pending: Promise<void>[] = [];
    for (const group of groups.values()) {
      emit(group, 'unavailable');
      pending.push(stop(group));
    }
    await Promise.allSettled(pending);
  }
  return { subscribe, close };
}
