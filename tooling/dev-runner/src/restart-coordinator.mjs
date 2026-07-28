export function createRestartCoordinator({ canRestart, restart, onError, debounceMs = 180 }) {
  const reasons = new Set();
  let timer = null;
  let running = false;
  let closed = false;

  function schedule(delay = debounceMs) {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
  }

  async function flush() {
    if (closed || reasons.size === 0) return;
    if (running || !canRestart()) {
      schedule();
      return;
    }

    running = true;
    const batch = [...reasons].sort();
    reasons.clear();
    try {
      await restart(batch);
    } catch (error) {
      onError(error);
    } finally {
      running = false;
      if (reasons.size > 0) schedule();
    }
  }

  return {
    request(reason) {
      reasons.add(reason);
      schedule();
    },
    wake() {
      if (reasons.size > 0) schedule(0);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      timer = null;
      reasons.clear();
    },
  };
}
