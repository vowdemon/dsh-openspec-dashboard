import type { HostContext, SandboxMode } from './types.js';

export interface TaskInput { sessionId: string; slug: string; lineNumber: number; expectedLine: string; expectedVersion: string; done: boolean }
export interface TaskResult { status: number; data: { error: string; stage?: string; code?: string } | { done: boolean; lineNumber: number; line: string; version: string } }
export function errorCode(error: unknown): string | undefined { return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined; }
const MAX_POLICY_EVENTS = 10000;
const TASK_LINE = /^(\s*(?:[-*+]\s+|\d+[.)]\s+)\[)([ xX])(\][^\r\n]*)(\r?)$/;

export function safeErrorCode(error: unknown): string | undefined {
  const code = errorCode(error);
  return typeof code === 'string' && /^(?:FS_[A-Z0-9_]+|E[A-Z0-9_]+)$/.test(code)
    ? code : undefined;
}

/** Recover a stored session's last explicit sandbox mode; never assume its deployment default overrides history. */
async function storedSessionPolicy(ctx: HostContext, sessionId: string): Promise<{ cwd: string; mode: SandboxMode | null } | null> {
  const snapshot = await ctx.sessionPersistence.stat(sessionId);
  if (!snapshot?.header.cwd) return null;
  const handle = await ctx.sessionPersistence.open(sessionId, 'read');
  let mode = ctx.sandboxPolicy.defaultMode;
  try {
    const { events } = await handle.read(0, MAX_POLICY_EVENTS + 1);
    if (events.length > MAX_POLICY_EVENTS) return { cwd: snapshot.header.cwd, mode: null };
    for (const event of events) if (event.type === 'sandbox/mode') {
      const candidate = event.data?.mode;
      if (candidate !== 'read-only' && candidate !== 'workspace-write' && candidate !== 'danger-full-access') {
        return { cwd: snapshot.header.cwd, mode: null };
      }
      mode = candidate;
    }
    return { cwd: snapshot.header.cwd, mode };
  } finally { await handle.close(); }
}

/**
 * Recheck the exact source line and its version at the Host before touching disk.
 * Only a task checkbox byte may change; other content is preserved verbatim.
 */
export async function updateTask(ctx: HostContext, input?: unknown): Promise<TaskResult> {
  const { sessionId, slug, lineNumber, expectedLine, expectedVersion, done } = (input && typeof input === 'object' ? input : {}) as Partial<TaskInput>;
  if (typeof sessionId !== 'string' || !sessionId || typeof slug !== 'string' ||
      slug.length > 160 || slug.toLowerCase() === 'archive' ||
      !/^[a-z0-9][a-z0-9._-]*$/i.test(slug) ||
      typeof lineNumber !== 'number' || !Number.isSafeInteger(lineNumber) || lineNumber < 1 ||
      typeof expectedLine !== 'string' ||
      typeof expectedVersion !== 'string' || !expectedVersion || typeof done !== 'boolean') {
    return { status: 400, data: { error: 'invalid-task' } };
  }
  const session = ctx.sessions.get(sessionId);
  const stored = session ? null : await storedSessionPolicy(ctx, sessionId);
  const cwd = session?.header.cwd ?? stored?.cwd;
  if (!cwd) return { status: 404, data: { error: 'session-unavailable' } };
  if (stored && !stored.mode) return { status: 403, data: { error: 'session-policy-unavailable' } };
  const policy = session ? ctx.sandboxPolicy.resolve({ session }) :
    ctx.sandboxPolicy.resolve({ mode: stored!.mode! });
  if (policy.mode === 'read-only') return { status: 403, data: { error: 'workspace-read-only' } };
  const root = await ctx.fs.resolve(cwd);
  const activePath = cwd.replace(/[/\\]+$/, '') + '/openspec/changes';
  const directory = activePath + '/' + slug;
  const path = directory + '/tasks.md';
  const [activeInfo, directoryInfo, pathInfo] = await Promise.all([
    ctx.fs.lstat(activePath), ctx.fs.lstat(directory), ctx.fs.lstat(path),
  ]);
  if (activeInfo?.type !== 'directory' || directoryInfo?.type !== 'directory' ||
      pathInfo?.type !== 'file') return { status: 404, data: { error: 'task-file-unavailable' } };
  const activeRoot = await ctx.fs.resolve(activePath);
  const target = await ctx.fs.resolve(path);
  if (!ctx.fs.contains(root, activeRoot) || !ctx.fs.contains(activeRoot, target)) {
    return { status: 403, data: { error: 'outside-workspace' } };
  }
  const info = await ctx.fs.stat(target);
  if (!info || info.type !== 'file') return { status: 404, data: { error: 'task-file-unavailable' } };
  if (info.version !== expectedVersion) return { status: 409, data: { error: 'task-file-changed' } };
  const content = await ctx.fs.readText(target);
  const lines = content.split('\n');
  const current = lines[lineNumber - 1];
  if (current !== expectedLine) return { status: 409, data: { error: 'task-line-changed' } };
  const match = TASK_LINE.exec(current);
  if (!match || (match[2].toLowerCase() === 'x') === done) return { status: 409, data: { error: 'task-line-changed' } };
  const replacement = match[1] + (done ? 'x' : ' ') + match[3] + match[4];
  lines[lineNumber - 1] = replacement;
  try {
    const result = await ctx.fs.writeText(target, lines.join('\n'),
      { kind: 'replaceIfVersion', version: info.version }, undefined,
      { ...policy, workspaceRoot: cwd, sessionId });
    return { status: 200, data: { done, lineNumber, line: replacement, version: result.version } };
  } catch (error) {
    if (errorCode(error) === 'FS_STALE_VERSION') return { status: 409, data: { error: 'task-file-changed' } };
    ctx.logger?.warn?.('OpenSpec task write failed: %s', String(error));
    return { status: 500, data: { error: 'write-failed', stage: 'write', code: safeErrorCode(error) } };
  }
}
