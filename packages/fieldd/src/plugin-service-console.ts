import { LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";

/** Explicit LOG-L4 migration adapter. Service-worker plugin output remains
 * visibly pending without allowing host operational code to use console.
 * LOG-L4 replaces this file with the host-stamped plugins/service sink. */
export function emitPendingPluginServiceLog(record: {
  pluginId: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
}): void {
  const candidate = record.message.slice(0, LOG_TRANSPORT_LIMITS.PLUGIN_PARTIAL_LINE_BYTES);
  const bytes = Buffer.from(candidate, "utf8");
  const truncated =
    candidate.length < record.message.length ||
    bytes.byteLength > LOG_TRANSPORT_LIMITS.PLUGIN_PARTIAL_LINE_BYTES;
  const message = bytes
    .subarray(0, LOG_TRANSPORT_LIMITS.PLUGIN_PARTIAL_LINE_BYTES)
    .toString("utf8")
    .replace(/[\r\n]+/g, " ↩ ");
  const line = `[plugin:${record.pluginId}:service] ${message}${truncated ? "…[truncated]" : ""}`;
  if (record.level === "error") console.error(line);
  else if (record.level === "warn") console.warn(line);
  else if (record.level === "debug") console.debug(line);
  else console.info(line);
}
