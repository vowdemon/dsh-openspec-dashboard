/** Minimal structural host contracts; no dependency on a particular Cordis package version. */
export interface FsTarget { targetKey: string; displayPath: string }
export interface FsInfo { type?: string; size?: number; version?: string; dev?: number | string; ino?: number | string }
export interface DirectoryEntry { name: string; type: string; target: FsTarget }
export type StopWatching = () => void | Promise<void>;
export interface HostFs {
  resolve(path: string, options?: { signal?: AbortSignal }): Promise<FsTarget>;
  contains(parent: FsTarget, target: FsTarget): boolean;
  lstat(path: string, options?: unknown, signal?: AbortSignal): Promise<FsInfo | null | undefined>;
  stat(path: FsTarget, signal?: AbortSignal): Promise<FsInfo | null | undefined>;
  listDir(path: FsTarget, signal?: AbortSignal): Promise<DirectoryEntry[]>;
  watch(path: FsTarget, changed: (error?: { code?: string } | null) => void, signal?: AbortSignal): Promise<StopWatching>;
  readText(path: FsTarget): Promise<string>;
  writeText(path: FsTarget, content: string, intent: { kind: 'replaceIfVersion'; version: string }, signal: undefined, policy: SandboxResolution): Promise<{ version: string }>;
}
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export interface Session { header: { cwd?: string } }
export interface SandboxResolution { mode: SandboxMode; workspaceRoot?: string; sessionId?: string; [key: string]: unknown }
export interface SessionSnapshot { header: { cwd?: string } }
export interface SessionEvent { type: string; data?: { mode?: string } }
export interface SessionReadHandle {
  read(position: number, count: number): Promise<{ events: SessionEvent[] }>;
  close(): Promise<void>;
}
export interface HostRoute {
  path: string;
  methods: string[];
  requestBody: 'buffered';
  fetch(request: Request): Promise<Response>;
}
export interface HostContext {
  fs: HostFs;
  sessions: { get(id: string): Session | undefined };
  sessionPersistence: {
    stat(id: string): Promise<SessionSnapshot | null | undefined>;
    open(id: string, access: 'read'): Promise<SessionReadHandle>;
  };
  sandboxPolicy: {
    defaultMode: SandboxMode;
    resolve(input: { session: Session } | { mode: SandboxMode }): SandboxResolution;
  };
  connection: { fetch: { register(route: HostRoute): (() => void | Promise<void>) } };
  effect(callback: () => (() => void | Promise<void>), label: string): void;
  logger?: { warn?: (message: string, ...args: unknown[]) => void };
}
export interface WatchHub {
  subscribe(cwd: string, notify: (event: 'changed' | 'unavailable') => void, signal?: AbortSignal): Promise<() => Promise<void>>;
  close(): Promise<void>;
}
