import { anchorIdForTask, findTaskByAnchor } from '@/utils/task-anchor';
import { useEffect } from 'react';
import { useExecutionDump } from './index';

/**
 * Keep the URL hash and the active sidebar task in sync:
 * - On load (and whenever the hash changes), select the task the hash points at
 *   and scroll its sidebar row into view, so reports are deep-linkable.
 * - When the active task changes, reflect it into the hash via `replaceState`
 *   (no extra history entries, and it does not re-trigger the hash listener).
 */
export function useTaskHashAnchor(
  options: { namespaced?: boolean } = {},
): void {
  const namespaced = options.namespaced ?? false;
  const dump = useExecutionDump((store) => store.dump);
  const activeTask = useExecutionDump((store) => store.activeTask);
  const replayAllMode = useExecutionDump((store) => store.replayAllMode);
  const setActiveTask = useExecutionDump((store) => store.setActiveTask);

  // The enclosing Studio report links its step list to this isolated viewer.
  useEffect(() => {
    if (!dump) return;
    const select = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.data?.type !== 'midscene-select-task' ||
        typeof event.data.taskId !== 'string'
      )
        return;
      const task = findTaskByAnchor(dump, `task-${event.data.taskId}`);
      if (task) setActiveTask(task);
    };
    window.addEventListener('message', select);
    if (window.parent !== window)
      window.parent.postMessage({ type: 'midscene-report-ready' }, '*');
    return () => window.removeEventListener('message', select);
  }, [dump, setActiveTask]);

  // Hash -> active task (initial deep-link + manual hash navigation).
  useEffect(() => {
    if (!dump) return;

    const applyHash = () => {
      const hash = namespaced
        ? new URLSearchParams(window.location.hash.slice(1)).get('task') || ''
        : window.location.hash;
      if (!hash || hash === '#') return;
      const task = findTaskByAnchor(dump, hash);
      if (!task) return;
      setActiveTask(task);
      // Scroll the matching row into view once it has been rendered.
      requestAnimationFrame(() => {
        document
          .getElementById(hash.replace(/^#/, ''))
          ?.scrollIntoView({ block: 'nearest' });
      });
    };

    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, [dump, namespaced, setActiveTask]);

  // Active task -> hash. Skip while replaying all so the play-all view keeps
  // whatever anchor was last shared.
  useEffect(() => {
    if (!dump || replayAllMode || !activeTask) return;
    // srcdoc inherits the host's base URL but has an opaque origin. Replacing
    // its history with that URL throws and unmounts the viewer. Selection is
    // driven by parent messages here; standalone reports still keep anchors.
    if (
      window.location.pathname === 'srcdoc' &&
      window.location.protocol === 'about:'
    )
      return;
    const anchor = anchorIdForTask(activeTask);
    const target = `#${anchor}`;
    if (namespaced) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      if (params.get('task') !== anchor) {
        params.set('task', anchor);
        window.history.replaceState(null, '', `#${params.toString()}`);
      }
    } else if (window.location.hash !== target) {
      window.history.replaceState(null, '', target);
    }
  }, [dump, activeTask, namespaced, replayAllMode]);
}
