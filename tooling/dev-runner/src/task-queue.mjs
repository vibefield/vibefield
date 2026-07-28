export function createCriticalTaskQueue({
  handlers,
  onBusyChange,
  onSuccess,
  onFailure,
  debounceMs = 80,
}) {
  let pendingContracts = false;
  let pendingNative = false;
  let pendingAllManifests = false;
  let pendingRuntime = false;
  const pendingManifests = new Set();
  let retry = [];
  let running = false;
  let healthy = true;
  let closed = false;
  let timer = null;
  const idleWaiters = new Set();

  function enqueue(change) {
    if (closed) return;
    mergeRetry();
    add(change);
    if (!running) {
      schedule(debounceMs);
    }
  }

  function schedule(delay) {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, delay);
  }

  function mergeRetry() {
    if (retry.length === 0) return;
    for (const failed of retry) add(failed);
    retry = [];
  }

  function add(change) {
    if (change.kind === "contracts") pendingContracts = true;
    else if (change.kind === "native") pendingNative = true;
    else if (change.kind === "all-manifests") pendingAllManifests = true;
    else if (change.kind === "manifest") pendingManifests.add(change.project);
    else if (change.kind === "plugin-runtime") pendingRuntime = true;
  }

  function hasPending() {
    return (
      pendingContracts ||
      pendingNative ||
      pendingAllManifests ||
      pendingRuntime ||
      pendingManifests.size > 0
    );
  }

  function takeBatch() {
    if (closed) return null;
    if (!hasPending()) return null;
    const batch = {
      contracts: pendingContracts,
      native: pendingNative,
      allManifests: pendingAllManifests,
      runtime: pendingRuntime,
      manifests: [...pendingManifests].sort(),
    };
    pendingContracts = false;
    pendingNative = false;
    pendingAllManifests = false;
    pendingRuntime = false;
    pendingManifests.clear();
    return batch;
  }

  async function drain() {
    if (running) return;
    running = true;
    onBusyChange(true);
    try {
      let batch = takeBatch();
      while (batch !== null) {
        const failedBatch = [];
        try {
          if (batch.allManifests) {
            await handlers.allManifests();
          } else {
            for (const project of batch.manifests) await handlers.manifest(project);
          }
          if (batch.contracts) await handlers.contracts();
          if (batch.contracts || batch.native) await handlers.native();
          if (batch.runtime) await handlers.pluginRuntime();
          healthy = true;
          onSuccess(batch);
        } catch (error) {
          if (batch.allManifests) failedBatch.push({ kind: "all-manifests" });
          for (const project of batch.manifests) {
            failedBatch.push({ kind: "manifest", project });
          }
          if (batch.contracts) failedBatch.push({ kind: "contracts" });
          if (batch.native) failedBatch.push({ kind: "native" });
          if (batch.runtime) failedBatch.push({ kind: "plugin-runtime" });
          retry = failedBatch;
          healthy = false;
          onFailure(error);
          break;
        }
        batch = takeBatch();
      }
    } finally {
      running = false;
      onBusyChange(false);
      // An edit can arrive while a handler is running. If that handler then
      // fails, enqueue() could not arm a timer because `running` was true.
      // Treat the already-arrived edit exactly like the next edit after a
      // failure: merge the failed batch and drain both without requiring a
      // third filesystem event.
      if (!closed && hasPending()) {
        mergeRetry();
        schedule(0);
      } else {
        notifyIdle();
      }
    }
  }

  function notifyIdle() {
    if (running || timer !== null || hasPending()) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  }

  return {
    enqueue,
    close() {
      closed = true;
      clearTimeout(timer);
      timer = null;
      pendingContracts = false;
      pendingNative = false;
      pendingAllManifests = false;
      pendingRuntime = false;
      pendingManifests.clear();
      retry = [];
      notifyIdle();
    },
    waitForIdle() {
      if (!running && timer === null && !hasPending()) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.add(resolve));
    },
    get busy() {
      return running || timer !== null || hasPending();
    },
    get healthy() {
      return healthy;
    },
  };
}
