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

  function enqueue(change) {
    if (closed) return;
    if (retry.length > 0) {
      for (const failed of retry) add(failed);
      retry = [];
    }
    add(change);
    if (!running) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, debounceMs);
    }
  }

  function add(change) {
    if (change.kind === "contracts") pendingContracts = true;
    else if (change.kind === "native") pendingNative = true;
    else if (change.kind === "all-manifests") pendingAllManifests = true;
    else if (change.kind === "manifest") pendingManifests.add(change.project);
    else if (change.kind === "plugin-runtime") pendingRuntime = true;
  }

  function takeBatch() {
    if (closed) return null;
    if (
      !pendingContracts &&
      !pendingNative &&
      !pendingAllManifests &&
      !pendingRuntime &&
      pendingManifests.size === 0
    ) {
      return null;
    }
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
    }
  }

  return {
    enqueue,
    close() {
      closed = true;
      clearTimeout(timer);
      timer = null;
    },
    get busy() {
      return running;
    },
    get healthy() {
      return healthy;
    },
  };
}
