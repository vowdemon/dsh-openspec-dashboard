import { changeStatus, fileKind, specStatus, type BoardFile, type Change, type Spec, type Task } from './model';
import type { Translate } from './translations';
import type { ReactAPI } from './types';
export interface ChangeBrowse { expanded: boolean; subview: 'files' | 'tasks'; incompleteOnly: boolean }
export function createRows(React: ReactAPI) {
const h = React.createElement;
function Tag({ kind, label }: { kind: string; label: string }) {
  return h('span', { className: 'osd-tag', 'data-kind': kind }, label);
}
function FileList({ files, openFile, t, isCurrentSpec = false }: { files: BoardFile[]; openFile: (path: string) => void; t: Translate; isCurrentSpec?: boolean }) {
  return files.length ? h('div', null, files.map((file) => {
    const kind = isCurrentSpec ? 'specTag' : fileKind(file.relative);
    return h('button', {
      key: file.path, type: 'button', className: 'osd-file',
      title: file.relative, 'aria-label': t('openFile') + ': ' + file.relative,
      onClick: () => openFile(file.path),
    }, h(Tag, { kind, label: t(kind) }), h('span', null, file.relative));
  })) : h('div', { className: 'osd-state' }, t('noFiles'));
}
function ChangeRow({ change, openFile, t, collapsed = {}, toggleGroup, pendingTask, taskFeedback, toggleTask, browse, setBrowse }: { change: Change; openFile: (path: string) => void; t: Translate; collapsed?: Record<string, boolean>; toggleGroup: (key: string, folded: boolean) => void; pendingTask?: { lineNumber: number; done: boolean } | null; taskFeedback?: { lineNumber: number; message: string } | null; toggleTask: (change: Change, task: Task) => void; browse?: ChangeBrowse; setBrowse?: (patch: Partial<ChangeBrowse>) => void }) {
  const [localExpanded, setLocalExpanded] = React.useState(false);
  const [localSubview, setLocalSubview] = React.useState<'files' | 'tasks'>('files');
  const [localIncompleteOnly, setLocalIncompleteOnly] = React.useState(false);
  const expanded = browse?.expanded ?? localExpanded;
  const subview = browse?.subview ?? localSubview;
  const incompleteOnly = browse?.incompleteOnly ?? localIncompleteOnly;
  const setExpanded = (value: boolean) => browse ? setBrowse?.({ expanded: value }) : setLocalExpanded(value);
  const setSubview = (value: 'files' | 'tasks') => browse ? setBrowse?.({ subview: value }) : setLocalSubview(value);
  const setIncompleteOnly = (value: boolean) => browse ? setBrowse?.({ incompleteOnly: value }) : setLocalIncompleteOnly(value);
  const initialFolds = React.useRef(new Map<string, boolean>());
  const status = changeStatus(change);
  const displayDone = (task: Task) => pendingTask?.lineNumber === task.lineNumber ? pendingTask.done : task.done;
  const visibleGroups = (change.groups || []).map((group) => ({ group,
    items: incompleteOnly ? group.items.filter((task) => !displayDone(task)) : group.items,
  })).filter(({ items }) => items.length > 0);
  return h('article', { className: 'osd-card', 'data-archived': String(change.archived) },
    h('button', { type: 'button', className: 'osd-row', 'aria-expanded': expanded,
      'aria-label': (expanded ? t('hide') : t('show')) + ': ' + change.title,
      onClick: () => setExpanded(!expanded) },
      h('span', { className: 'osd-row-head' },
        h('span', { className: 'osd-title' }, change.title), h(Tag, { kind: status, label: t(status) })),
      change.summary && h('span', { className: 'osd-description osd-muted' }, change.summary),
      change.tasks.length > 0 && h('span', { className: 'osd-status osd-muted' },
        h('span', null, change.done + '/' + change.tasks.length),
        h('span', { className: 'osd-track', role: 'progressbar', 'aria-label': change.title,
          'aria-valuemin': 0, 'aria-valuemax': change.tasks.length, 'aria-valuenow': change.done,
        }, h('span', { style: { width: (change.done / change.tasks.length * 100) + '%' } })))),
    expanded && h('div', { className: 'osd-children' },
      h('div', { className: 'osd-child-tabs' },
        h('div', { className: 'osd-child-tab-buttons' }, (['files', 'tasks'] as const).map((name) =>
          h('button', { key: name, className: 'osd-control', type: 'button', 'aria-pressed': subview === name,
            onClick: () => setSubview(name) }, t(name)))),
        subview === 'tasks' && h('label', { className: 'osd-incomplete-filter' },
          h('input', { type: 'checkbox', checked: incompleteOnly,
            onChange: (event: { currentTarget: { checked: boolean } }) => setIncompleteOnly(event.currentTarget.checked) }),
          h('span', null, t('incompleteOnly')))),
      subview === 'files' ? h(FileList, { files: change.files, openFile, t }) :
        change.tasks.length ? h('div', null,
          visibleGroups.length ? visibleGroups.map(({ group, items }) => {
            const groupKey = change.directory + ':' + group.id;
            const completed = group.items.filter((task) => task.done).length;
            const finished = completed === group.items.length;
            if (!initialFolds.current.has(groupKey)) initialFolds.current.set(groupKey, finished);
            const folded = collapsed[groupKey] ?? initialFolds.current.get(groupKey)!;
            return h('section', { key: group.id, className: 'osd-group' },
              h('button', { type: 'button', className: 'osd-group-button', 'aria-expanded': !folded,
                onClick: () => toggleGroup(groupKey, folded) },
                h('span', { className: 'osd-group-title' }, group.title || t('ungrouped'),
                  h('span', { className: 'osd-group-count' }, completed + '/' + group.items.length)),
                h(Tag, { kind: finished ? 'groupDone' : 'groupOngoing',
                  label: t(finished ? 'groupDone' : 'groupOngoing') }),
                h('span', { className: 'osd-chevron', 'aria-hidden': true }, folded ? '▸' : '▾')),
              !folded && h('div', null, items.map((task) =>
                h('div', { key: task.lineNumber, className: 'osd-task-row' },
                  h('div', { className: 'osd-task', 'data-done': String(displayDone(task)) },
                    h('input', { type: 'checkbox', checked: displayDone(task),
                      disabled: change.archived || !change.tasksVersion,
                      'aria-label': task.text,
                      onChange: (event: { currentTarget: { checked: boolean } }) => {
                        if (pendingTask) { event.currentTarget.checked = displayDone(task); return; }
                        toggleTask(change, task);
                      } }),
                    h('span', null, task.text)),
                  taskFeedback?.lineNumber === task.lineNumber && h('p', {
                    className: 'osd-task-feedback', role: 'alert' }, taskFeedback.message)))));
          }) : h('div', { className: 'osd-state' }, t('noIncompleteTasks')),
          change.tasksPath && h('button', { type: 'button', className: 'osd-file',
            onClick: () => openFile(change.tasksPath!) }, t('openTasks'))) :
          h('div', { className: 'osd-state' }, t('noTasks'))));
}
function SpecRow({ spec, openFile, t, expanded: savedExpanded, onExpand }: { spec: Spec; openFile: (path: string) => void; t: Translate; expanded?: boolean; onExpand?: (value: boolean) => void }) {
  const [localExpanded, setLocalExpanded] = React.useState(false);
  const expanded = savedExpanded ?? localExpanded;
  const setExpanded = (value: boolean) => onExpand ? onExpand(value) : setLocalExpanded(value);
  const kind = specStatus(spec);
  const changed = kind !== 'confirmedSpec';
  const singleFile = !changed && spec.files.length === 1 ? spec.files[0] : undefined;
  return h('article', { className: 'osd-card' },
    h('button', { className: 'osd-row', type: 'button',
      ...(singleFile ? { 'aria-label': t('openFile') + ': ' + spec.name,
        onClick: () => openFile(singleFile.path) } : {
        'aria-expanded': expanded,
        'aria-label': (expanded ? t('hide') : t('show')) + ': ' + spec.name,
        onClick: () => setExpanded(!expanded),
      }) },
      h('span', { className: 'osd-row-head' },
        h('span', { className: 'osd-title' }, spec.name), h(Tag, { kind, label: t(kind) })),
      spec.summary && h('span', { className: 'osd-description osd-muted' }, spec.summary),
      !changed && !singleFile && h('span', { className: 'osd-muted' }, spec.files.length + ' ' + t('files'))),
    !singleFile && expanded && h('div', { className: 'osd-children' },
      changed ? spec.changes.map((source) => h('section', { key: source.slug, className: 'osd-spec-source' },
        h('div', { className: 'osd-spec-source-title' }, t('changesView') + ' · ' + source.slug),
        h(FileList, { files: source.files.map((file) => ({ ...file,
          relative: file.relative.slice(('specs/' + spec.name + '/').length) })), openFile, t, isCurrentSpec: true }))) :
        h(FileList, { files: spec.files, openFile, t, isCurrentSpec: true }),
      changed && spec.files.length > 0 && h('section', { className: 'osd-spec-source' },
        h('div', { className: 'osd-spec-source-title' }, t('current')),
        h(FileList, { files: spec.files, openFile, t, isCurrentSpec: true }))));
}
return { ChangeRow, SpecRow };
}
