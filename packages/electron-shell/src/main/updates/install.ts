// WP12b — the ONE place electron-updater's singleton is touched: build the UpdateController over `autoUpdater`, with
// VibeField's custom provider (D3) as its feed. Called only for a packaged app with a staged identity.
// WP12c (L2b-ii) — and the ONE place Electron's own updater (Squirrel.Mac) is touched: the apply's port.

import { SystemShutdownResult, TerminalListResult } from "@vibefield/contracts";
import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";
import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import { dialog, autoUpdater as squirrel } from "electron";
import { autoUpdater, CancellationToken } from "electron-updater";
import type { QuitFlow } from "../quit-flow";
import {
  type ApplyPort,
  type BoxContent,
  CENSUS_BOUND_MS,
  type CensusSnapshot,
  NOTICE_AUTOCLOSE_MS,
  type StageOutcome,
  type StopOutcome,
} from "./apply";
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
  /** WP12c — the apply's port (`createElectronApplyPort`); absent, a staged update stays `apply-unbuilt` */
  readonly apply?: ApplyPort;
  readonly currentVersion?: string;
  readonly safeWindowContext?: UpdateControllerOptions["safeWindowContext"];
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
    ...(options.apply !== undefined ? { apply: options.apply } : {}),
    ...(options.currentVersion !== undefined ? { currentVersion: options.currentVersion } : {}),
    ...(options.safeWindowContext !== undefined
      ? { safeWindowContext: options.safeWindowContext }
      : {}),
    log: options.log,
  });
}

/** How long fieldd's consented stop may take to answer (its own stop waits up to 5 s for the floor, then a ladder). */
const STOP_DAEMONS_BOUND_MS = 20_000;

/** WP12c (L2b-ii, `build-wp12-updater.md` §10) — the apply's world, from Electron. macOS only (§10 S5). */
export function createElectronApplyPort(deps: {
  readonly platform: NodeJS.Platform;
  readonly fieldd: {
    /** the live handle (may spawn — only ever called BEFORE the stop) */
    ensure(): Promise<FielddHandle>;
    /** hold the coordinator (nothing may start fieldd from here) and return the current handle */
    holdForUpdate(): FielddHandle | null;
    releaseHold(): void;
  };
  readonly quitFlow: () => QuitFlow | null;
  readonly quitApp: () => void;
  readonly restore: () => void;
  readonly log: UpdateControllerOptions["log"];
}): ApplyPort {
  return {
    wired: deps.platform === "darwin",

    async census(): Promise<CensusSnapshot> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unknown: CensusSnapshot = { known: false };
      const read = (async (): Promise<CensusSnapshot> => {
        const handle = await deps.fieldd.ensure();
        const listed = TerminalListResult.safeParse(
          await handle.client.request("terminal.list", {}, { timeoutMs: CENSUS_BOUND_MS }),
        );
        if (!listed.success) return unknown;
        return {
          known: true,
          sessions: listed.data.terminals.map((terminal) => ({
            sessionId: terminal.sessionId,
            ...(terminal.title !== undefined ? { title: terminal.title } : {}),
            ...(terminal.cwd !== undefined ? { cwd: terminal.cwd } : {}),
          })),
        };
      })().catch(() => unknown);
      const answer = await Promise.race([
        read,
        new Promise<CensusSnapshot>((resolve) => {
          timer = setTimeout(() => resolve(unknown), CENSUS_BOUND_MS);
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
      return answer;
    },

    async confirm(content: BoxContent): Promise<boolean> {
      const answer = await dialog.showMessageBox({
        type: "warning",
        message: content.message,
        detail: content.detail,
        buttons: [...content.buttons],
        defaultId: content.defaultId,
        cancelId: content.cancelId,
        noLink: true,
      });
      return answer.response !== content.cancelId;
    },

    quitForUpdate(plan) {
      const flow = deps.quitFlow();
      if (flow === null || !flow.armUpdate(plan)) return false;
      deps.quitApp();
      return true;
    },

    async stopDaemons(sessions, version): Promise<StopOutcome> {
      // the hold FIRST: when fieldd goes, its client closes, and an unheld coordinator would start a new pair
      const handle = deps.fieldd.holdForUpdate();
      if (handle === null) {
        deps.fieldd.releaseHold();
        return { ok: false, reason: "fieldd is not attached" };
      }
      try {
        const answer = SystemShutdownResult.safeParse(
          await handle.client.request(
            "system.shutdown",
            { native: { stop: true, sessions: [...sessions], toVersion: version } },
            { timeoutMs: STOP_DAEMONS_BOUND_MS },
          ),
        );
        if (!answer.success || answer.data.stopping !== true) {
          deps.fieldd.releaseHold();
          return { ok: false, reason: "fieldd did not stop" };
        }
        deps.log.info("desktop.update.daemons_stopped", "The daemons stopped for the update", {
          native: answer.data.native ?? null,
          sessions: sessions.length,
        });
        return { ok: true };
      } catch (error) {
        // a refusal stops nothing (fieldd re-checked and said no): the coordinator may recover again
        deps.fieldd.releaseHold();
        const details = (error as { details?: { live?: unknown } } | null)?.details;
        const live = Array.isArray(details?.live)
          ? details.live.filter((id): id is string => typeof id === "string")
          : undefined;
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
          ...(live !== undefined ? { live } : {}),
        };
      }
    },

    stage(boundMs): Promise<StageOutcome> {
      return new Promise<StageOutcome>((resolve) => {
        let settled = false;
        const done = (outcome: StageOutcome): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          squirrel.removeListener("update-downloaded", onStaged);
          squirrel.removeListener("error", onRefused);
          resolve(outcome);
        };
        const onStaged = (): void => done({ kind: "staged" });
        const onRefused = (error: Error): void => {
          deps.log.warn("desktop.update.squirrel_refused", "Squirrel refused the update payload", {
            error: error.message,
          });
          done({ kind: "refused" });
        };
        const timer = setTimeout(() => done({ kind: "timeout" }), boundMs);
        squirrel.once("update-downloaded", onStaged);
        squirrel.once("error", onRefused);
        try {
          // MacUpdater set Squirrel's feed to its local proxy when the download finished; this is the first moment
          // Squirrel takes the payload — after the daemons stopped (an irreversible step after the last refusal)
          squirrel.checkForUpdates();
        } catch (error) {
          onRefused(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },

    install(): void {
      squirrel.once("error", (error: Error) => {
        deps.quitFlow()?.updateInstallFailed(error.message);
      });
      autoUpdater.quitAndInstall();
    },

    async notify(content: BoxContent): Promise<void> {
      const close = new AbortController();
      const timer = setTimeout(() => close.abort(), NOTICE_AUTOCLOSE_MS);
      try {
        await dialog.showMessageBox({
          type: "info",
          message: content.message,
          detail: content.detail,
          buttons: [...content.buttons],
          defaultId: content.defaultId,
          cancelId: content.cancelId,
          noLink: true,
          signal: close.signal,
        });
      } catch {
        // an aborted or failed box still lets the exit go on — the reason is recorded in `lastApply`
      } finally {
        clearTimeout(timer);
      }
    },

    restore(): void {
      deps.restore();
    },
  };
}
