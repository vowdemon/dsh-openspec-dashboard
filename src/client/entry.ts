import { parseTasks, parseTaskGroups, changeStatus, specStatus, fileKind, taskErrorKey, applyTaskResult, summaryFrom, fileAddressFor, sortChanges, sortChangeFiles, visibleChanges, aggregateSpecs, loadBoard, type Remote } from './model';
import { watchBoard } from './watch';
import { css } from './styles';
import { copy, NS } from './translations';
import { createDashboard } from './dashboard';
import type { ReactAPI } from './types';

interface ClientContext {
  remote: Remote;
  locale: { bind(namespace: string): (key: string) => string; register(namespace: string, messages: typeof copy): () => void };
  sidebarRightTabs: { register(tab: { id: string; kind: string; keepMounted: boolean; title: () => string; guide: { id: string; order: number; title: () => string; description: () => string }[] }): () => void };
  slots: { inject(name: string, callback: () => unknown): () => void; register(meta: { name: string; key: string; locale: string }, component: unknown): unknown };
  effect(callback: () => void | (() => void), label: string): void;
}
interface ModuleLoader { load(definition: { id: string; factory(require: (name: string) => unknown): unknown }): void }
declare const window: Window & { __ModuleLoader__: ModuleLoader };
const ID = 'dsh-openspec-dashboard';
window.__ModuleLoader__.load({
  id: 'dsh-openspec-dashboard',
  factory(require) {
    const React = require('react') as ReactAPI;
    // The dashboard receives the runtime React instance; it never bundles another copy.
    let remote: Remote;
    const { Dashboard, ChangeRow, SpecRow } = createDashboard(React, {
      workspaceFiles: {
        list: (...args) => remote.workspaceFiles.list(...args),
        read: (...args) => remote.workspaceFiles.read(...args),
      },
    });
    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles'],
      apply(ctx: ClientContext) {
        remote = ctx.remote;
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, copy), 'openspec-dashboard: translations');
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: ID, kind: 'openspec-dashboard', keepMounted: true, title: () => t('title'),
          guide: [{ id: 'board', order: 35, title: () => t('guide'), description: () => t('description') }],
        }), 'openspec-dashboard: tab type');
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID, locale: NS }, Dashboard)),
        'openspec-dashboard: tab body');
        ctx.effect(() => {
          const element = document.createElement('style');
          element.textContent = css;
          document.head.appendChild(element);
          return () => element.remove();
        }, 'openspec-dashboard: styles');
      },
      model: { parseTasks, parseTaskGroups, changeStatus, specStatus, fileKind, taskErrorKey, applyTaskResult,
        summaryFrom, fileAddressFor, sortChanges, sortChangeFiles,
        visibleChanges, aggregateSpecs, loadBoard, watchBoard, ChangeRow, SpecRow },
    };
  },
});
