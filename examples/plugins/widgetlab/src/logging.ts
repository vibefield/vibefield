import type { PluginLogger } from "@vibefield/plugin-sdk";

const noop: PluginLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

let logger: PluginLogger = noop;

/** Widget components mount after activation but do not receive the whole
 * capability context as props. This module retains only the narrow logger
 * capability for the lifetime of this one renderer-plugin activation. */
export function setWidgetlabLogger(next: PluginLogger | null): void {
  logger = next ?? noop;
}

export function getWidgetlabLogger(): PluginLogger {
  return logger;
}
