import {
  type CallerContext,
  type DeviceInfo,
  DeviceRemoveParams,
  type DeviceRemoveResult,
  type KnownPhone,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { AuditMutation, AuditMutationOutcome } from "./audit-service";
import { freewayClientId } from "./freeway";
import { RpcCallError } from "./native-link";
import { clientIdFor } from "./terminal-grants";

// Item 406, S3 (track WI's Desktop slice; WI-W5b A; VF-PM's rulings of 2026-11-14 04:49Z) — REMOVE
// FOR A PHONE: the ask, the act and the sweep. The person presses Remove on a phone's row on any of
// their computers; that desktop writes the refusal into the settings document every desktop of the
// account shares (`devices.refused`, S2), through its ONE writer, whose call is the
// `device.remove` handler's own in daemon.ts (this module is handed the write, never the writer),
// and then sweeps what the phone holds here. Every other desktop sweeps the same as the merged
// list reaches it. The sweep is `revokeWindowToken`'s, in its order:
//   1. the audit row (`device.remove`, target the device by its durable id, never its name);
//   2. its transcript tickets and readers, under both of its client keys (`clientIdFor`, the
//      mint's own): `tailnet:<login>#<node>` when it asked this desktop directly, and
//      `peer-fieldd:<home>#phone:<device>` behind each desktop that may be its home;
//   3. its live product connections, by the node the sidecar named (`dropNodeConnections`);
//   4. its freeway keyrings and links, by the exact client id the host keys them by
//      (`FreewayFloor.revokeClient`).
// Revocation preserves safety: the effect runs even when the audit cannot be written, and the
// caller still hears the audit's failure. Before the sweep the roster passes once more, so the door
// refuses a phone that dials back mid-sweep (`isRefusedNode`), and the freeway's declaration drops
// it (4410). At boot (S3's fold), what stood is swept once the roster has passed: its sockets and
// freeway clients, with no audit row (`sweepSeeded`). What stays open is DESIGN.md §9's to say,
// never this module's to promise: a terminal on a product-door grant until the grant ends (S4 is
// the floor's wall, not built), an open History session (Q-PM3: no rosettad restart, a named gap),
// a transcript reader a third desktop relayed for the phone's home (the worker closes an exact key
// alone, transcripts/host/listener.ts `revokeClient`; a named gap), made apps and store delivery
// until the person removes the phone in Tailscale's admin console. Workspace tickets are a
// window's alone (`WorkspaceTickets.check`), so a phone holds none.

/** What Remove reads of the roster (`DeviceService`). */
export interface RemovalRoster {
  currentDeviceId(): string;
  get(deviceId: string): DeviceInfo | undefined;
  isDocHost(deviceId: string): boolean;
  /** the review's folds (5) — has this roster ever seen the device's slice say it is a desktop? */
  seenAsDesktop(deviceId: string): boolean;
  selfPeerDeviceIds(): readonly string[];
  /** a registry pass: after it, the doors' predicate holds every refusal the document does */
  sync(): Promise<void>;
}

/** What Remove reads of the account's settings document (`SettingsDocService`): the refusals by
 * durable id, with their node ids, and the known phones. Reads only: the write is the handler's. */
export interface RemovalDoc {
  refusedDevices(): Promise<ReadonlyMap<string, ReadonlySet<string>>>;
  knownPhones(): Promise<ReadonlyMap<string, KnownPhone>>;
}

/** The audit, as Remove writes it (`AuditService`): the act as its caller's, a merged sweep as
 * this desktop's own. */
export interface RemovalAudit {
  required<T>(
    ctx: CallerContext,
    mutation: AuditMutation,
    effect: () => Promise<T>,
    describeOutcome: (value: T) => AuditMutationOutcome,
  ): Promise<T>;
  requiredSystem<T>(
    mutation: AuditMutation,
    effect: () => Promise<T>,
    describeOutcome: (value: T) => AuditMutationOutcome,
  ): Promise<T>;
}

export interface DeviceRemovalOptions {
  roster: RemovalRoster;
  doc: RemovalDoc;
  audit: RemovalAudit;
  /** step 2 — a client's transcript tickets and sockets (`SparkTranscriptTickets.revokeClient`) */
  revokeTranscripts(clientId: string): Promise<void>;
  /** step 3 — the live product connections from these nodes (`ProductApi.dropNodeConnections`) */
  dropConnections(nodeIds: readonly string[]): number;
  /** step 4 — one phone's freeway links and keyrings, by its minted client id
   * (`FreewayFloor.revokeClient`); never throws */
  revokeFreeway(minted: string): Promise<number>;
  /** this desktop's linked login: the login a phone of this account speaks as */
  linkedLogin(): string | null;
  logger?: Logger;
}

/** A Remove the handler may write: the phone's durable id, and every node id this desktop knows
 * for it (its row's, and the account's record of it). */
export interface RemovalAsk {
  deviceId: string;
  tailscaleIds: string[];
}

/** Why a sweep ran, in its audit row: the act here, another desktop's merged, or a refused phone's
 * new node id carried into the refusals (on any desktop). */
type SweepCause = "remove" | "merge" | "append";

/** S3's fold — the boot sweep's diagnostics line, by its code: its attrs are exactly
 * `{connections, links}`, the product sockets and freeway links it closed for one refusal. */
const BOOT_SWEPT = "fieldd.devices.removal_swept_at_boot";

export class DeviceRemoval {
  private readonly logger: Logger;
  /** What this desktop has swept: each refused durable id, with the node ids swept under it. */
  private readonly swept = new Map<string, Set<string>>();
  /** What stood at boot, by durable id with its node ids: the boot sweep's (`sweepSeeded`). */
  private readonly seeded = new Map<string, Set<string>>();
  /** The act, the sweeps and the seed, one at a time, in the order they were asked. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: DeviceRemovalOptions) {
    this.logger = opts.logger ?? createNoopLogger();
  }

  /** `device.remove`'s ask, once every refusal has been said; null when the refusal already
   * stands (Remove is declarative: `{removed: false, closed: 0}`, and nothing is written). The
   * refusals, in the order a caller hears them:
   *  - a malformed ask: PRECONDITION_FAILED;
   *  - this desktop: PRECONDITION_FAILED — a desktop removes its phones, never itself;
   *  - a device this roster does not list: NOT_FOUND;
   *  - a desktop, or one this roster has EVER seen as a desktop (`seenAsDesktop`: its slice may
   *    be away, and a record may have been kept for it wrongly; the review's folds, (5)), or a
   *    row not KNOWN to be a phone (`DeviceInfo.phone`): PRECONDITION_FAILED. A refusal is never
   *    lifted, so it is never written on a guess: a desktop whose slice has not arrived says
   *    nothing of itself either. */
  async ask(params: unknown): Promise<RemovalAsk | null> {
    const parsed = DeviceRemoveParams.safeParse(params);
    if (!parsed.success)
      throw new RpcCallError("PRECONDITION_FAILED", "expected { deviceId: string }", false);
    const { deviceId } = parsed.data;
    if ((await this.opts.doc.refusedDevices()).has(deviceId)) return null;
    const roster = this.opts.roster;
    const row = roster.get(deviceId);
    if (deviceId === roster.currentDeviceId() || row?.self === true)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "a desktop removes its phones, never itself",
        false,
      );
    if (row === undefined)
      throw new RpcCallError("NOT_FOUND", "this desktop's roster lists no such device", false);
    if (roster.seenAsDesktop(deviceId) || row.phone === undefined)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "only a device known to be a phone can be removed",
        false,
      );
    const known = (await this.opts.doc.knownPhones()).get(deviceId);
    const tailscaleIds = [
      ...new Set([
        ...(row.tailscaleId !== undefined ? [row.tailscaleId] : []),
        ...(known?.tailscaleIds ?? []),
      ]),
    ];
    return { deviceId, tailscaleIds };
  }

  /** The act: `write` (the refusal's one writer, as the handler calls it), the roster's pass, then
   * the sweep, audited as the caller's (`device.remove`). `removed` is whether THIS call wrote the
   * refusal. The review's folds:
   *  - (6) the ask is made outside the act's turn, so a second press racing the first finds the
   *    refusal standing only here: re-read in the turn, it answers `{removed: false, closed: 0}`
   *    with NO audit row (ruling (3)), no write and no sweep. `cancelled` is left for a refusal
   *    another desktop's merge wrote between this read and this write.
   *  - (7) the effect runs again only when the AUDIT failed before it ran (revocation preserves
   *    safety, and the audit's failure is then the caller's to hear). An effect that threw has
   *    run: its failure is the caller's, once. */
  remove(
    ctx: CallerContext,
    ask: RemovalAsk,
    write: () => Promise<{ wrote: boolean }>,
  ): Promise<DeviceRemoveResult> {
    return this.serially(async () => {
      if ((await this.opts.doc.refusedDevices()).has(ask.deviceId))
        return { removed: false, closed: 0 };
      let ran = false;
      const effect = async (): Promise<DeviceRemoveResult> => {
        ran = true;
        const { wrote } = await write();
        // swept here: the merged sweep its write sets going finds nothing new
        this.mark(ask.deviceId, ask.tailscaleIds);
        // S2's hand-off: the doors' predicate lags one pass behind the document
        await this.opts.roster.sync();
        const closed = await this.close(ask.deviceId, ask.tailscaleIds);
        return { removed: wrote, closed };
      };
      try {
        return await this.opts.audit.required(
          ctx,
          this.mutation(ask.deviceId, "remove"),
          effect,
          (result) => ({
            outcome: result.removed ? "succeeded" : "cancelled",
            ...(result.removed ? {} : { reasonCode: "DEVICE_ALREADY_REMOVED" }),
            attrs: { closed: result.closed },
          }),
        );
      } catch (error) {
        // revocation preserves safety (`revokeWindowToken`): evidence that failed is surfaced,
        // and the phone is refused and closed all the same. Only an audit that failed BEFORE the
        // effect leaves it to run here (the review's folds, (7)).
        if (!ran) await effect();
        throw error;
      }
    });
  }

  /** The refusals moved (a merge, or a write here): sweep every refused durable id, and every node
   * id under one, this desktop has not swept yet, each as this desktop's own act. Never rejects. */
  sweep(): Promise<void> {
    return this.serially(async () => {
      try {
        await this.opts.roster.sync();
        for (const [deviceId, nodes] of await this.opts.doc.refusedDevices()) {
          const was = this.swept.get(deviceId);
          const fresh = [...nodes].filter((nodeId) => was?.has(nodeId) !== true);
          if (was !== undefined && fresh.length === 0) continue;
          this.mark(deviceId, fresh);
          await this.sweepAsSystem(deviceId, fresh, was === undefined ? "merge" : "append");
        }
      } catch (error) {
        this.logger.warn(
          "fieldd.devices.removal_sweep_failed",
          "The account's refusals could not be swept; the next change sweeps again",
          { error: String(error) },
        );
      }
    });
  }

  /** At boot, before the door listens: every refusal standing is taken as swept, so no merge or
   * append sweep audits it again at every boot, and is kept for the boot sweep (`sweepSeeded`),
   * which closes what the floor may still hold of it. Never rejects. */
  seed(): Promise<void> {
    return this.serially(async () => {
      try {
        for (const [deviceId, nodes] of await this.opts.doc.refusedDevices()) {
          this.mark(deviceId, [...nodes]);
          this.seeded.set(deviceId, new Set(nodes));
        }
      } catch (error) {
        this.logger.warn(
          "fieldd.devices.removal_seed_failed",
          "The account's refusals could not be read at boot; the first change sweeps them",
          { error: String(error) },
        );
      }
    });
  }

  /** S3's fold (VF-PM 06:18Z, (5b)) — the boot sweep, once, after the roster's first pass. The
   * seed took what stood at boot as swept, but field-native outlives fieldd: a daemon stopped
   * between a refusal's merge and its sweep (a crash, or a same-uid process killing it) left the
   * freeway host holding the phone's keyrings. So each refused phone's live product connections
   * close by node id, then its freeway client per node is revoked (idempotent: a client the host
   * does not hold closes nothing; owed to the first host the floor names when it has named none).
   * No audit row: nothing was decided here. ONE diagnostics line per refusal whose sweep closed
   * something: its code (`BOOT_SWEPT`) and its counts, never an id, token, address or host name.
   * Its transcripts are not asked: the worker is this boot's own and holds no ticket from before.
   * Never rejects. */
  sweepSeeded(): Promise<void> {
    return this.serially(async () => {
      const seeded = [...this.seeded.values()];
      this.seeded.clear();
      const login = this.opts.linkedLogin();
      for (const nodes of seeded) {
        try {
          const nodeIds = [...nodes];
          const connections = this.opts.dropConnections(nodeIds);
          let links = 0;
          if (login !== null) {
            for (const tailscaleId of nodeIds)
              links += await this.opts.revokeFreeway(freewayClientId(login, tailscaleId));
          }
          if (connections + links > 0)
            this.logger.info(
              BOOT_SWEPT,
              "A phone removed before this boot still held something here; it is closed",
              { connections, links },
            );
        } catch {
          // both seams answer and never throw; a throw is said by its code alone, as the line is
          this.logger.warn(
            "fieldd.devices.removal_boot_sweep_failed",
            "A phone removed before this boot could not be swept here at boot",
          );
        }
      }
    });
  }

  private async sweepAsSystem(
    deviceId: string,
    nodeIds: readonly string[],
    cause: SweepCause,
  ): Promise<void> {
    const effect = () => this.close(deviceId, nodeIds);
    try {
      await this.opts.audit.requiredSystem(this.mutation(deviceId, cause), effect, (closed) => ({
        outcome: "succeeded",
        attrs: { closed },
      }));
    } catch (error) {
      await effect();
      this.logger.warn(
        "fieldd.devices.removal_unaudited",
        "A removed phone was swept here, and its audit row could not be written",
        { deviceId, error: String(error) },
      );
    }
  }

  /** The audit's mutation: the device by its durable id, never by its name, and why it ran. */
  private mutation(deviceId: string, via: SweepCause): AuditMutation {
    return { action: "device.remove", target: { kind: "device", id: deviceId }, attrs: { via } };
  }

  /** Steps 2–4, in order. None stops the next: a step that cannot be taken is a line. Answers how
   * many connections it closed that it can count (step 3's, and the host's word for step 4). */
  private async close(deviceId: string, nodeIds: readonly string[]): Promise<number> {
    const login = this.opts.linkedLogin();
    for (const clientId of this.clientKeys(login, deviceId, nodeIds)) {
      try {
        await this.opts.revokeTranscripts(clientId);
      } catch (error) {
        this.logger.warn(
          "fieldd.devices.removal_transcripts_open",
          "A removed phone's transcript tickets and readers could not be revoked here",
          { deviceId, error: String(error) },
        );
      }
    }
    let closed = this.opts.dropConnections(nodeIds);
    if (login !== null) {
      for (const tailscaleId of nodeIds)
        closed += await this.opts.revokeFreeway(freewayClientId(login, tailscaleId));
    }
    return closed;
  }

  /** Step 2's keys, as the transcript mint keys a phone (`clientIdFor`): by its node when it asked
   * directly (with no linked login no phone of this account can), and by its device under each
   * desktop of the account that may be its home. A relay through a third desktop
   * (`peer-fieldd:<carrier>#<home>/phone:<device>`) is not named here, a named gap: its tickets
   * lapse within their minute, and a reader it already opened stays open until it closes. */
  private clientKeys(login: string | null, deviceId: string, nodeIds: readonly string[]): string[] {
    const keys: string[] = [];
    if (login !== null) {
      for (const tailscaleId of nodeIds)
        keys.push(clientIdFor({ kind: "tailnet", login, tailscaleId }));
    }
    const roster = this.opts.roster;
    for (const home of roster.selfPeerDeviceIds()) {
      if (!roster.isDocHost(home)) continue;
      const behind = { clientKind: "ios", deviceId: home, clientDeviceId: deviceId };
      keys.push(clientIdFor({ kind: "peer-fieldd", deviceId: home }, behind));
    }
    return keys;
  }

  private mark(deviceId: string, nodeIds: readonly string[]): void {
    const nodes = this.swept.get(deviceId) ?? new Set<string>();
    for (const nodeId of nodeIds) nodes.add(nodeId);
    this.swept.set(deviceId, nodes);
  }

  private serially<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
