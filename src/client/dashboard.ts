import { applyTaskResult, changeStatus, fileAddressFor, loadBoard, specStatus, taskDiagnostic, taskErrorKey, visibleChanges, type Change, type Task, type Board, type Remote } from './model';
import { watchBoard } from './watch';
import type { Translate } from './translations';
import type { ReactAPI } from './types';
import { createRows, type ChangeBrowse } from './rows';
type View = 'changes' | 'specs';
type ChangeMode = 'active' | 'archive' | 'all';
interface BrowseState {
  view: View; mode: ChangeMode; queries: Record<View, string>;
  changes: Record<string, ChangeBrowse>; specs: Record<string, boolean>; folds: Record<string, boolean>;
  scrolls: Record<string, number>;
}
const initialBrowse = (): BrowseState => ({ view: 'changes', mode: 'active',
  queries: { changes: '', specs: '' }, changes: {}, specs: {}, folds: {}, scrolls: {} });
const initialChange = (): ChangeBrowse => ({ expanded: false, subview: 'files', incompleteOnly: false });
function reconcileBrowse(current: BrowseState, board: Board): BrowseState {
  const changes: Record<string, ChangeBrowse> = {};
  const specs: Record<string, boolean> = {};
  const folds: Record<string, boolean> = {};
  for (const change of board.changes) {
    if (current.changes[change.directory]) changes[change.directory] = current.changes[change.directory];
    for (const group of change.groups) {
      const key = change.directory + ':' + group.id;
      folds[key] = current.folds[key] ?? group.items.every((task) => task.done);
    }
  }
  for (const spec of board.specs) {
    if (Object.prototype.hasOwnProperty.call(current.specs, spec.name)) specs[spec.name] = current.specs[spec.name];
  }
  return { ...current, changes, specs, folds };
}
export function createDashboard(React: ReactAPI, remote: Remote) {
const h = React.createElement;
const { ChangeRow, SpecRow } = createRows(React);
function Dashboard({ sessionId, useSessions, useTabInfo, t }: { sessionId: string; useSessions: (select: (sessions: { byId: Record<string, { cwd?: string }> }) => string | undefined) => string | undefined; useTabInfo: () => { tab: { actions: { openResource: (address: string) => void } } }; t: Translate }) {
  const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd);
  const { tab } = useTabInfo();
  const [revision, invalidate] = React.useState(0);
  const [state, setState] = React.useState<{ loading?: boolean; noWorkspace?: boolean; sessionId?: string; cwd?: string; board?: Board; error?: string }>({ loading: true });
  const [openError, setOpenError] = React.useState<{ sessionId: string; cwd: string | undefined; generation: number } | null>(null);
  const [taskFeedback, setTaskFeedback] = React.useState<Record<string, { lineNumber: number; message: string } | null>>({});
  const [pendingTasks, setPendingTasks] = React.useState<Record<string, { lineNumber: number; done: boolean } | null>>({});
  const [watchState, setWatchState] = React.useState<{ sessionId: string; cwd: string; failed: boolean } | null>(null);
  const [, refreshBrowse] = React.useState(0);
  const browseBySession = React.useRef(new Map<string, BrowseState>());
  const browseKey = JSON.stringify([sessionId, cwd || '']);
  const activeSession = React.useRef(browseKey);
  const transientGeneration = React.useRef(0);
  if (activeSession.current !== browseKey) {
    activeSession.current = browseKey;
    transientGeneration.current++;
  }
  React.useEffect(() => {
    setPendingTasks({});
    setTaskFeedback({});
  }, [browseKey]);
  if (!browseBySession.current.has(browseKey)) browseBySession.current.set(browseKey, initialBrowse());
  const browse = browseBySession.current.get(browseKey)!;
  const view = browse.view;
  const mode = browse.mode;
  const query = browse.queries[view];
  const scrollKey = view === 'specs' ? 'specs' : 'changes:' + mode;
  const scrollRoot = React.useRef<HTMLElement | null>(null);
  function rememberScroll() {
    if (!scrollRoot.current) return;
    const current = browseBySession.current.get(browseKey)!;
    browseBySession.current.set(browseKey, { ...current,
      scrolls: { ...current.scrolls, [scrollKey]: scrollRoot.current.scrollTop } });
  }
  function updateBrowse(change: (current: BrowseState) => BrowseState) {
    browseBySession.current.set(browseKey, change(browseBySession.current.get(browseKey)!));
    refreshBrowse((n) => n + 1);
  }
  const pendingRef = React.useRef(new Set<string>());
  const taskAbort = React.useRef(new AbortController());
  React.useEffect(() => () => taskAbort.current.abort(), []);
  React.useEffect(() => {
    if (!cwd) { setState({ noWorkspace: true, sessionId, cwd }); return; }
    const controller = new AbortController();
    setState((current) => current.board && current.sessionId === sessionId && current.cwd === cwd
      ? current : { loading: true, sessionId, cwd });
    loadBoard(remote, sessionId, cwd, controller.signal).then((board) => {
      if (!controller.signal.aborted) {
        browseBySession.current.set(browseKey, reconcileBrowse(browseBySession.current.get(browseKey)!, board));
        setState({ board, sessionId, cwd });
      }
    }, (error) => {
      if (!controller.signal.aborted) setState((current) =>
        current.board && current.sessionId === sessionId && current.cwd === cwd
          ? current : { error: String(error instanceof Error ? error.message : error), sessionId, cwd });
    });
    return () => controller.abort();
  }, [sessionId, cwd, revision]);
  React.useEffect(() => {
    if (!cwd) return;
    setWatchState({ sessionId, cwd, failed: false });
    // Reconnect internally; a transient stream interruption does not displace the board.
    return watchBoard(sessionId, () => invalidate((n) => n + 1), (key) =>
      setWatchState({ sessionId, cwd, failed: !!key }));
  }, [sessionId, cwd]);
  function openFile(path: string) {
    try { tab.actions.openResource(fileAddressFor(sessionId, cwd || '', path)); setOpenError(null); }
    catch { setOpenError({ sessionId, cwd, generation: transientGeneration.current }); }
  }
  function toggleGroup(key: string, folded: boolean) {
    updateBrowse((current) => ({ ...current, folds: { ...current.folds, [key]: !folded } }));
  }
  function setChangeBrowse(directory: string, patch: Partial<ChangeBrowse>) {
    updateBrowse((current) => ({ ...current, changes: { ...current.changes,
      [directory]: { ...initialChange(), ...current.changes[directory], ...patch } } }));
  }
  const taskKey = (directory: string) => JSON.stringify([browseKey, transientGeneration.current, directory]);
  async function toggleTask(change: Change, task: Task) {
    const generation = transientGeneration.current;
    const key = taskKey(change.directory);
    const lockKey = JSON.stringify([sessionId, cwd, change.directory]);
    if (activeSession.current !== browseKey || change.archived || !change.tasksVersion || pendingRef.current.has(lockKey)) return;
    pendingRef.current.add(lockKey);
    setPendingTasks((current) => ({ ...current, [key]: {
      lineNumber: task.lineNumber, done: !task.done } }));
    setTaskFeedback((current) => ({ ...current, [key]: null }));
    let stage = 'request';
    try {
      const response = await fetch('/api/openspec-dashboard/task', {
        method: 'POST', credentials: 'same-origin', signal: taskAbort.current.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, slug: change.slug, lineNumber: task.lineNumber,
          expectedLine: task.originalLine, expectedVersion: change.tasksVersion, done: !task.done }),
      });
      stage = 'response';
      const payload: unknown = await response.json().catch(() => null);
      const result = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
      if (!response.ok) {
        if (!taskAbort.current.signal.aborted && transientGeneration.current === generation) {
          const errorKey = taskErrorKey(response.status, result?.error);
          setTaskFeedback((current) => ({ ...current, [key]: {
            lineNumber: task.lineNumber, message: t(errorKey) + ' (' + taskDiagnostic(response.status, result) + ')',
          } }));
        }
        return;
      }
      if (!result || result.lineNumber !== task.lineNumber ||
          typeof result.version !== 'string' || !result.version ||
          typeof result.line !== 'string' || result.done !== !task.done) {
        throw new Error('Invalid task write response');
      }
      const writeResult = { lineNumber: task.lineNumber, done: !task.done,
        version: result.version, line: result.line };
      if (!taskAbort.current.signal.aborted && transientGeneration.current === generation) setState((current) =>
        current.board && current.sessionId === sessionId && current.cwd === cwd ? { ...current,
          board: { ...current.board, changes: current.board.changes.map((item) =>
            item.directory === change.directory ? applyTaskResult(item, writeResult) : item) } } : current);
    } catch (error) {
      if (!taskAbort.current.signal.aborted && transientGeneration.current === generation) setTaskFeedback((current) => ({ ...current,
        [key]: { lineNumber: task.lineNumber,
          message: t('taskWriteError') + ' (' + (stage === 'request' ? 'network-error' : 'invalid-response') + ')' } }));
    } finally {
      pendingRef.current.delete(lockKey);
      if (!taskAbort.current.signal.aborted && transientGeneration.current === generation)
        setPendingTasks((current) => ({ ...current, [key]: null }));
    }
  }
  const currentState = !cwd ? { noWorkspace: true } :
    state.sessionId === sessionId && state.cwd === cwd ? state : { loading: true };
  const board = currentState.board;
  const matchingChanges = visibleChanges(board?.changes || [], 'all', query);
  const changes = mode === 'all' ? matchingChanges :
    matchingChanges.filter((change) => change.archived === (mode === 'archive'));
  const specs = (board?.specs || []).filter((spec) => spec.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const changeCounts = { preparing: 0, underway: 0, done: 0, archived: 0 };
  for (const change of matchingChanges) changeCounts[changeStatus(change)]++;
  const specCounts = { newSpec: 0, changedSpec: 0, confirmedSpec: 0 };
  for (const spec of specs) specCounts[specStatus(spec)]++;
  const counts = view === 'changes' ? changeCounts : specCounts;
  const countText = Object.entries(counts).filter(([, count]) => count > 0)
    .map(([key, count]) => count + t('countUnit') + t(key)).join(' / ');
  const showControls = Boolean(board && !board.missing && !currentState.loading && !currentState.noWorkspace && !currentState.error);
  React.useLayoutEffect(() => {
    const root = scrollRoot.current;
    if (!root || !showControls) return;
    const saved = browseBySession.current.get(browseKey)?.scrolls?.[scrollKey] ?? 0;
    root.scrollTop = Math.max(0, Math.min(saved, root.scrollHeight - root.clientHeight));
  }, [browseKey, scrollKey, board, query, showControls]);
  const watchFailed = !!cwd && watchState?.sessionId === sessionId && watchState.cwd === cwd && watchState.failed;
  return h('div', { className: 'osd', 'data-openspec-dashboard': true,
    ref: (node: HTMLElement | null) => { scrollRoot.current = node; }, onScroll: rememberScroll },
    h('div', { className: 'osd-controls' },
      h('header', { className: 'osd-head', 'data-watch-failed': watchFailed },
        h('h1', null, t('title')),
        watchFailed && h('span', { className: 'osd-watch-failed', role: 'status',
          'aria-label': t('watchFailed'), title: t('watchFailed') }, t('watchFailed'))),
      h('nav', { className: 'osd-view', 'aria-label': t('title') }, (['changes', 'specs'] as const).map((name) =>
        h('button', { key: name, type: 'button', className: 'osd-control', 'aria-pressed': view === name,
          onClick: () => { rememberScroll(); updateBrowse((current) => ({ ...current, view: name })); } },
          t(name === 'changes' ? 'changesView' : 'specsView')))),
      showControls && h('div', { className: 'osd-toolbar' },
        h('div', { className: 'osd-filter' }, view === 'changes'
          ? (['active', 'archive', 'all'] as const).map((name) =>
            h('button', { key: name, className: 'osd-control', type: 'button', 'aria-pressed': mode === name,
              onClick: () => { rememberScroll(); updateBrowse((current) => ({ ...current, mode: name })); } }, t(name)))
          : h('span', { className: 'osd-filter-label' }, t('all'))),
        countText ? h('span', { className: 'osd-count osd-muted' }, countText) : null),
      showControls && h('input', { type: 'search', className: 'osd-search', placeholder: t('search'),
        'aria-label': t('search'), value: query, onChange: (event: { target: { value: string } }) =>
          updateBrowse((current) => ({ ...current,
            queries: { ...current.queries, [current.view]: event.target.value } })) })),
    currentState.loading ? h('p', { className: 'osd-state', role: 'status' }, t('loading')) :
    currentState.noWorkspace ? h('p', { className: 'osd-state' }, t('noWorkspace')) :
    currentState.error ? h('p', { className: 'osd-state', role: 'alert' }, t('readError')) :
    board?.missing ? h('p', { className: 'osd-state' }, t('noOpenSpec')) :
    h(React.Fragment, null,
      openError?.sessionId === sessionId && openError.cwd === cwd &&
        openError.generation === transientGeneration.current &&
        h('p', { className: 'osd-notice', role: 'alert' }, t('openError')),
      view === 'changes' ? (changes.length ? changes.map((change) =>
        h(ChangeRow, { key: change.directory, change, openFile, t, collapsed: browse.folds, toggleGroup,
          browse: browse.changes[change.directory] ?? initialChange(),
          setBrowse: (patch: Partial<ChangeBrowse>) => setChangeBrowse(change.directory, patch),
          pendingTask: pendingTasks[taskKey(change.directory)],
          taskFeedback: taskFeedback[taskKey(change.directory)], toggleTask })) :
        h('p', { className: 'osd-state' }, query ? t('noMatches') : mode === 'archive' ? t('emptyArchive') : t('emptyChanges'))) :
        (specs.length ? specs.map((spec) => h(SpecRow, { key: spec.name, spec, openFile, t,
          expanded: browse.specs[spec.name] ?? false,
          onExpand: (value: boolean) => updateBrowse((current) => ({ ...current,
            specs: { ...current.specs, [spec.name]: value } })) })) :
          h('p', { className: 'osd-state' }, query ? t('noMatches') : t('emptySpecs')))));
}
return { Dashboard, ChangeRow, SpecRow };
}
