import { homedir, tmpdir } from "node:os";
import { LOG_STREAMS } from "@vibefield/contracts";
import { createNodeLogging, type Logger, type NodeLogging } from "@vibefield/logging";

export interface ElectronLogging {
  readonly bootId: string;
  readonly logRoot: string;
  readonly desktop: NodeLogging;
  readonly renderer: NodeLogging;
  readonly utility: NodeLogging;
  readonly logger: Logger;
  close(): Promise<void>;
}

export async function createElectronLogging(options: {
  logRoot: string;
  dataRoot: string;
  bootId: string;
  emergency?: (message: string) => void;
}): Promise<ElectronLogging> {
  const aliases = {
    home: homedir(),
    temp: tmpdir(),
    logs: options.logRoot,
    data: options.dataRoot,
  };
  const common = {
    logRoot: options.logRoot,
    bootId: options.bootId,
    instanceId: options.bootId,
    aliases,
    ...(options.emergency !== undefined ? { emergency: options.emergency } : {}),
  };
  const [desktop, renderer, utility] = await Promise.all([
    createNodeLogging({
      ...common,
      stream: LOG_STREAMS.SYSTEM_DESKTOP,
      service: "desktop",
      role: "main",
      component: "lifecycle",
    }),
    createNodeLogging({
      ...common,
      stream: LOG_STREAMS.SYSTEM_RENDERER,
      service: "renderer",
      role: "renderer",
      component: "renderer.ingress",
    }),
    createNodeLogging({
      ...common,
      stream: LOG_STREAMS.SYSTEM_UTILITY,
      service: "utility",
      role: "utility",
      component: "utility.ingress",
    }),
  ]);
  let closePromise: Promise<void> | null = null;
  return {
    bootId: options.bootId,
    logRoot: options.logRoot,
    desktop,
    renderer,
    utility,
    logger: desktop.logger,
    close() {
      closePromise ??= (async () => {
        await Promise.all([renderer.close(), utility.close()]);
        desktop.logger.info(
          "desktop.lifecycle.logging_stopped",
          "Electron-owned logging streams stopped",
        );
        await desktop.close();
      })();
      return closePromise;
    },
  };
}
