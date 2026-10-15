// WP12b — the ONE place electron-updater's singleton is touched: build the UpdateController over `autoUpdater`, with
// VibeField's custom provider (D3) as its feed. Called only for a packaged app with a staged identity.

import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";
import { autoUpdater, CancellationToken } from "electron-updater";
import { UpdateController, type UpdateControllerOptions, type UpdaterPort } from "./controller";
import type { UpdateIdentity } from "./identity";
import { VibeFieldUpdateProvider } from "./provider";
import { UpdateStateStore } from "./state-store";
import { feedFileFor } from "./verify-chain";

export function installUpdateController(options: {
  readonly identity: UpdateIdentity;
  /** `<userData>/updates/state.json` */
  readonly statePath: string;
  readonly appendAudit?: (record: AuditAppendV1) => Promise<void>;
  readonly log: UpdateControllerOptions["log"];
  readonly platform?: NodeJS.Platform;
}): UpdateController {
  return new UpdateController({
    updater: autoUpdater as unknown as UpdaterPort,
    feedOptions: (context) => ({
      provider: "custom",
      updateProvider: VibeFieldUpdateProvider,
      vibefield: context,
    }),
    newCancellationToken: () => new CancellationToken(),
    origin: options.identity.origin,
    rootKeys: options.identity.rootKeys,
    floors: options.identity.floors,
    buildChannel: options.identity.channel,
    feedFile: feedFileFor(options.platform ?? process.platform),
    store: new UpdateStateStore(options.statePath),
    ...(options.appendAudit !== undefined ? { appendAudit: options.appendAudit } : {}),
    log: options.log,
  });
}
