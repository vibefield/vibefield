// CP-4a2b (§13a slice 1, D20) — a row's door into a REAL flow host's own reads. It is preloaded by a row's
// `directHost` arguments alone (`--require`), and nothing in src/ names it [CL-E7-10]. Its modes are a comma list in the
// host's environment as VF_HOST_STUB, the row's own environment, never fieldd's:
// - `stuck`: the worker's terminate never settles, the state one long builtin makes (O1, H30);
// - `missing`: the worker's count lacks `external_memory`, as a later Node that renamed it would (O2, H31);
// - `reject`: the worker's count is refused, so only the resident read is left (O3, H33);
// - `rss`: the resident size reads past any cap (O3, H33).
// It changes the host's own thread alone; in the script's worker it does nothing.
const { isMainThread, Worker } = require("node:worker_threads");

const modes = new Set(
  String(process.env.VF_HOST_STUB ?? "")
    .split(",")
    .filter((mode) => mode !== ""),
);

if (isMainThread) {
  if (modes.has("stuck")) Worker.prototype.terminate = () => new Promise(() => {});
  if (modes.has("missing"))
    Worker.prototype.getHeapStatistics = async () => ({ used_heap_size: 1 });
  if (modes.has("reject"))
    Worker.prototype.getHeapStatistics = () =>
      Promise.reject(new Error("the stub refuses the worker's count"));
  if (modes.has("rss")) process.memoryUsage.rss = () => 2 ** 40;
}
