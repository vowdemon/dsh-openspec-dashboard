import { applyTaskResult, changeStatus, fileAddressFor, loadBoard, specStatus, taskDiagnostic, taskErrorKey, visibleChanges, type Change, type Task, type Board, type Remote } from './model';
import { watchBoard } from './watch';
import type { Translate } from './translations';
import type { ReactAPI } from './types';
import { createRows } from './rows';
export function createDashboard(React: ReactAPI, remote: Remote) {
const h = React.createElement;
const { ChangeRow, SpecRow } = createRows(React);
function Dashboard({ sessionId, useSessions, useTabInfo, t }: { sessionId: string; useSessions: (select: (sessions: { byId: Record<string, { cwd?: string }> }) => string | undefined) => string | undefined; useTabInfo: () => { tab: { actions: { openResource: (address: string) => void } } }; t: Translate }) {
  const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd);
  const { tab } = useTabInfo();
  const [revision, invalidate] = React.useState(0);
  const [view, setView] = React.useState('changes');
  const [mode, setMode] = React.useState('active');
  const [query, setQuery] = React.useState('');
  const [state, setState] = React.useState<{ loading?: boolean; noWorkspace?: boolean; sessionId?: string; cwd?: string; board?: Board; error?: string }>({ loading: true });
  const [openError, setOpenError] = React.useState(false);
  const [taskFeedback, setTaskFeedback] = React.useState<Record<string, { lineNumber: number; message: string } | null>>({});
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [pendingTasks, setPendingTasks] = React.useState<Record<string, { lineNumber: number; done: boolean } | null>>({});
  const pendingRef = React.useRef(new Set<string>());
  const taskAbort = React.useRef(new AbortController());
  React.useEffect(() => () => taskAbort.current.abort(), []);
  React.useEffect(() => {
    if (!cwd) { setState({ noWorkspace: true, sessionId, cwd }); return; }
    const controller = new AbortController();
    setState((current) => current.board && current.sessionId === sessionId && current.cwd === cwd
      ? current : { loading: true, sessionId, cwd });
    loadBoard(remote, sessionId, cwd, controller.signal).then((board) => {
      if (!controller.signal.aborted) setState({ board, sessionId, cwd });
    }, (error) => {
      if (!controller.signal.aborted) setState((current) =>
        current.board && current.sessionId === sessionId && current.cwd === cwd
          ? current : { error: String(error instanceof Error ? error.message : error), sessionId, cwd });
    });
    return () => controller.abort();
  }, [sessionId, cwd, revision]);
  React.useEffect(() => {
    if (!cwd) return;
    // Reconnect internally; a transient stream interruption does not displace the board.
    return watchBoard(sessionId, () => invalidate((n) => n + 1), () => {});
  }, [sessionId, cwd]);
  function openFile(path: string) {
    try { tab.actions.openResource(fileAddressFor(sessionId, cwd || '', path)); setOpenError(false); }
    catch { setOpenError(true); }
  }
  function toggleGroup(key: string, folded: boolean) {
    setCollapsed((current) => ({ ...current, [key]: !(current[key] ?? folded) }));
  }
  async function toggleTask(change: Change, task: Task) {
    if (change.archived || !change.tasksVersion || pendingRef.current.has(change.directory)) return;
    pendingRef.current.add(change.directory);
    setPendingTasks((current) => ({ ...current, [change.directory]: {
      lineNumber: task.lineNumber, done: !task.done } }));
    setTaskFeedback((current) => ({ ...current, [change.directory]: null }));
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
        if (!taskAbort.current.signal.aborted) {
          const key = taskErrorKey(response.status, result?.error);
          setTaskFeedback((current) => ({ ...current, [change.directory]: {
            lineNumber: task.lineNumber, message: t(key) + ' (' + taskDiagnostic(response.status, result) + ')',
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
      if (!taskAbort.current.signal.aborted) setState((current) =>
        current.board && current.sessionId === sessionId && current.cwd === cwd ? { ...current,
          board: { ...current.board, changes: current.board.changes.map((item) =>
            item.directory === change.directory ? applyTaskResult(item, writeResult) : item) } } : current);
    } catch (error) {
      if (!taskAbort.current.signal.aborted) setTaskFeedback((current) => ({ ...current,
        [change.directory]: { lineNumber: task.lineNumber,
          message: t('taskWriteError') + ' (' + (stage === 'request' ? 'network-error' : 'invalid-response') + ')' } }));
    } finally {
      pendingRef.current.delete(change.directory);
      if (!taskAbort.current.signal.aborted) setPendingTasks((current) => ({ ...current, [change.directory]: null }));
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
  return h('div', { className: 'osd', 'data-openspec-dashboard': true },
    h('div', { className: 'osd-controls' },
      h('header', { className: 'osd-head' }, h('h1', null, t('title'))),
      h('nav', { className: 'osd-view', 'aria-label': t('title') }, ['changes', 'specs'].map((name) =>
        h('button', { key: name, type: 'button', className: 'osd-control', 'aria-pressed': view === name,
          onClick: () => { setView(name); setQuery(''); } }, t(name === 'changes' ? 'changesView' : 'specsView')))),
      showControls && h('div', { className: 'osd-toolbar' },
        h('div', { className: 'osd-filter' }, view === 'changes'
          ? ['active', 'archive', 'all'].map((name) =>
            h('button', { key: name, className: 'osd-control', type: 'button', 'aria-pressed': mode === name,
              onClick: () => setMode(name) }, t(name)))
          : h('span', { className: 'osd-filter-label' }, t('all'))),
        countText ? h('span', { className: 'osd-count osd-muted' }, countText) : null),
      showControls && h('input', { type: 'search', className: 'osd-search', placeholder: t('search'),
        'aria-label': t('search'), value: query, onChange: (event: { target: { value: string } }) => setQuery(event.target.value) })),
    currentState.loading ? h('p', { className: 'osd-state', role: 'status' }, t('loading')) :
    currentState.noWorkspace ? h('p', { className: 'osd-state' }, t('noWorkspace')) :
    currentState.error ? h('p', { className: 'osd-state', role: 'alert' }, t('readError')) :
    board?.missing ? h('p', { className: 'osd-state' }, t('noOpenSpec')) :
    h(React.Fragment, null,
      openError && h('p', { className: 'osd-notice', role: 'alert' }, t('openError')),
      view === 'changes' ? (changes.length ? changes.map((change) =>
        h(ChangeRow, { key: change.directory, change, openFile, t, collapsed, toggleGroup,
          pendingTask: pendingTasks[change.directory], taskFeedback: taskFeedback[change.directory], toggleTask })) :
        h('p', { className: 'osd-state' }, query ? t('noMatches') : mode === 'archive' ? t('emptyArchive') : t('emptyChanges'))) :
        (specs.length ? specs.map((spec) => h(SpecRow, { key: spec.name, spec, openFile, t })) :
          h('p', { className: 'osd-state' }, query ? t('noMatches') : t('emptySpecs')))));
}
return { Dashboard, ChangeRow, SpecRow };
}
