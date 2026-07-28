export function createTypecheckScheduler({
  runFull,
  runAffected,
  onStart,
  onSuccess,
  onFailure,
  debounceMs = 350,
}) {
  const files = new Set();
  let full = false;
  let running = false;
  let closed = false;
  let timer = null;

  function schedule(delay = debounceMs) {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, delay);
  }

  async function drain() {
    if (closed || running || (!full && files.size === 0)) return;
    running = true;
    const runEverything = full;
    const changed = [...files].sort();
    full = false;
    files.clear();
    onStart(runEverything ? null : changed);
    try {
      if (runEverything) await runFull();
      else await runAffected(changed);
      onSuccess(runEverything ? null : changed);
    } catch (error) {
      onFailure(error);
    } finally {
      running = false;
      if (full || files.size > 0) schedule(0);
    }
  }

  return {
    requestFull() {
      full = true;
      files.clear();
      schedule(0);
    },
    requestFiles(changed) {
      if (!full) {
        for (const file of changed) files.add(file);
      }
      schedule();
    },
    close() {
      closed = true;
      clearTimeout(timer);
      timer = null;
      files.clear();
    },
  };
}
