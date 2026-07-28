/**
 * Prepare an immutable candidate before touching the running desktop. Once a
 * snapshot exists, later source/build activity cannot invalidate the handoff.
 */
export async function handoffDesktopRuntime({
  electron,
  currentBuildId,
  prepareRuntime,
  isShuttingDown,
}) {
  const runtime = await prepareRuntime();
  if (runtime === null) return { status: "deferred" };
  if (electron.running && runtime.buildId === currentBuildId) {
    return { status: "unchanged", runtime };
  }

  await electron.stop();
  if (isShuttingDown()) return { status: "stopped", runtime };
  const pid = await electron.start(runtime);
  return { status: "restarted", runtime, pid };
}
