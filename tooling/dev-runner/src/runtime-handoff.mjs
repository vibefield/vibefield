/**
 * Prepare an immutable candidate before touching the running desktop. Once a
 * snapshot exists, later source/build activity cannot invalidate the handoff.
 *
 * The daemon pair is bounced only when the DAEMON plane changed; a shell-only
 * change restarts Electron alone and the new shell adopts the running fieldd
 * through the buildId-gated probe.
 */
export async function handoffDesktopRuntime({
  electron,
  currentRuntime,
  prepareRuntime,
  isShuttingDown,
}) {
  const runtime = await prepareRuntime();
  if (runtime === null) return { status: "deferred" };
  if (electron.running && runtime.buildId === currentRuntime?.buildId) {
    return { status: "unchanged", runtime };
  }

  const daemonsChanged = runtime.daemonBuildId !== currentRuntime?.daemonBuildId;
  await electron.stop({ stopDaemons: daemonsChanged });
  if (isShuttingDown()) return { status: "stopped", runtime };
  const pid = await electron.start(runtime);
  return { status: "restarted", runtime, pid, daemonsChanged };
}
