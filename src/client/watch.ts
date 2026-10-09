export function watchBoard(sessionId: string, onChange: () => void, onError: (key: string) => void, delay = 180, initialRetry = 1000): () => void {
  if (typeof EventSource !== 'function') return () => {};
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = initialRetry;
  let firstEventAt = 0;
  let source: EventSource | undefined;
  function schedule() {
    if (!active) return;
    const now = Date.now();
    if (!firstEventAt) firstEventAt = now;
    clearTimeout(timer);
    if (now - firstEventAt >= 1000) {
      firstEventAt = 0;
      onChange();
    } else timer = setTimeout(() => {
      firstEventAt = 0;
      if (active) onChange();
    }, delay);
  }
  function retry() {
    if (!active || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = undefined; connect(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
  }
  function connect() {
    if (!active) return;
    let next: EventSource;
    try { next = new EventSource('/api/openspec-dashboard/watch?sessionId=' + encodeURIComponent(sessionId),
      { withCredentials: true }); }
    catch { onError('watchError'); retry(); return; }
    source = next;
    next.addEventListener('ready', () => {
      if (active && source === next) { retryDelay = initialRetry; onError(''); schedule(); }
    });
    next.addEventListener('changed', () => { if (source === next) schedule(); });
    next.onerror = () => {
      if (!active || source !== next) return;
      onError('watchError');
      // EventSource retries network loss itself, but a refused HTTP response can close it permanently.
      if (next.readyState === 2) { next.close(); source = undefined; retry(); }
    };
  }
  connect();
  return () => { active = false; clearTimeout(timer); clearTimeout(retryTimer); source?.close(); };
}
