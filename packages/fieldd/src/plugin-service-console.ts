/** Explicit LOG-L4 migration adapter. Service-worker plugin output remains
 * visibly pending without allowing host operational code to use console.
 * LOG-L4 replaces this file with the host-stamped plugins/service sink. */
export function emitPendingPluginServiceLog(record: {
  pluginId: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
}): void {
  const line = `[plugin:${record.pluginId}:service] ${record.message}`;
  if (record.level === "error") console.error(line);
  else if (record.level === "warn") console.warn(line);
  else if (record.level === "debug") console.debug(line);
  else console.info(line);
}
