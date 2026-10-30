import { EventEmitter } from "node:events";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  LAYOUT,
  type MeshFailure,
  MeshNotUpDetails,
  MeshRetireResult,
  MeshSelfIdentity,
  MeshStartResult,
  MeshStopResult,
  TailscaleLink,
  type UserLinkState,
  type UserLinkStatus,
} from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import { readUsersFile, rootAboveUserRoot } from "@vibefield/users";
import { isNativeUnresponsive, RpcCallError } from "./native-link";

// UA-3 — the link lifecycle (spec §7.1/§7.2): fieldd owns link.json, captures
// the S1 self-whois login once the node is Running (never during bring-up),
// and unlink retires the native identity. The stored login is UA-4's trust
// comparison value. Capture tolerates login-absent (a tagged or shy node) as
// a typed pre-capture state with retry — never an error, never synthesized.
//
// UA-P-0a (D1) — AND THIS SERVICE NOW OWNS THE MESH POSTURE, because the
// posture derives from the link and from nothing else. James's ruling:
//
//   "When unlinked, the user account is a default local account, and VibeField
//    desktop is therefore in OFFLINE mode with none of the mesh and network
//    features. Once linked, everything should be scoped under this user account
//    inside their tailnet."
//
// So there are three things a desktop can be doing, and this class is where
// each begins:
//
//   OFFLINE   — no link (or a refusal: corrupt file, tagged node, a login
//               another local user holds). No node is asked for. Nothing to
//               probe, so the timer does not even run.
//   CAPTURING — the user asked to link. The floor starts a node in `capture`
//               mode, the interactive login runs, and we probe for the login.
//               NOTHING is declared or published in this window.
//   LINKED    — the login is captured and IS the account. The floor is told, and
//               the slow re-verify cadence takes over.
//
// What this replaced: the node came up because `FIELD_NATIVE_MESH=1` said so,
// and "linking" was a side effect of the interactive login happening to run.
// That flag is a development override now (see config.rs), and the separate
// NF-8 mesh toggle that was owed collapsed into this ruling — the posture IS
// the link, and a second switch beside it could only disagree with the account
// boundary it is supposed to inherit.
//
// THE REFUSALS ARE LOUD, which is the other half of the ruling (P4 fail closed).
// Every state that is not `linked` names itself, and the three that need a
// sentence carry one: the corrupt file's PATH, the other user's NAME. Before
// this, a corrupt `link.json` paused capture forever while `status().link` read
// null — a LINKED desktop serving an open door under a UI that said "not
// linked". That state is offline now, and it says which file to move.
//
// TS-1 (track TS, 2026-10-27) — AND NO DEAD ENDS. The plumbing hid four states a
// person needs words for (gaps 11–15 of `thinking-tailscale-onboarding.md`):
//   - a capture the tailnet's device approval holds → `awaiting_approval`;
//   - a linked node signed out of the tailnet → `expired` (its key's time has
//     passed, or is unknown) or `removed` (its key still had time: the device
//     was removed in the console), both answered by `renew()`;
//   - a capture the person no longer wants → `cancel()`, offline again;
//   - success, which waited for a 15 s probe → the floor's mesh unit now moves
//     on the health stream and `noteFloorHealth` brings the probe forward.
// The floor no longer times a capture out (P3), so a capture outlives the
// fieldd that asked for it: one this daemon finds the floor holding at boot is
// carried on (`adoptFloorCapture`), never orphaned.

export interface LinkServiceOptions {
  dataDir: string;
  native: {
    request(method: string, params?: unknown, opts?: { deadlineMs?: number }): Promise<unknown>;
  };
  logger?: Logger;
  now?: () => number;
  /** cadence while capturing (default 15s) */
  probeMs?: number;
  /** cadence once linked & up — a slow re-verify, not a poll (default 5min) */
  verifyMs?: number;
  /** UA-P-0a — how many times a RUNNING node may answer without a login before
   * capture gives up as `login_unavailable`. The node answering at all means
   * the netmap loaded; a node that keeps answering without a user is a TAGGED
   * node, which has no login by construction and never will. Bounded because
   * the old loop retried forever, and a forever-retry is not a state a person
   * can act on. */
  captureAttempts?: number;
  /** UA-P-0b (D8) — the other local users' links, for the one-login-one-user
   * law. Injected so the enumeration stays testable and so this service never
   * has to know how the user directory is laid out. */
  otherUserLinks?: () => Array<{ label: string; login: string }>;
  /** TS-6 (TS-D13) — awaited when a NEW link lands, before link.json is written
   * and before the floor is told: what must hold before this Mac reaches its
   * tailnet (the sync question's keep, `sync-question.ts`). A stop between the
   * two leaves no link, so the next sign-in runs it again. A new link is one
   * with no login held: never a linked boot, a renewal, a re-verify or a login
   * that moved under a live link. A failure is logged; it never refuses the
   * link. */
  beforeLinked?: () => Promise<unknown>;
}

const PROBE_MS = 15_000;
const VERIFY_MS = 300_000;
const CAPTURE_ATTEMPTS = 8;
/** TS-1 (P2) — a bring-up says starting, then its address, then up, within a
 * beat; the probe a burst of health deltas brings forward runs once, after it. */
const PUSH_SETTLE_MS = 50;
/** TS-D14 — `native.mesh.retire` signs the node out first, and truffle bounds
 * that logout at 12 s (`LOGOUT_TIMEOUT`, which contains the sidecar's own
 * 10 s). The mgmt default (`NATIVE_SUPERVISION.REQUEST_DEADLINE_MS`, 10 s)
 * would give up on an offline Disconnect while the floor still waits, so the
 * retire asks for the floor's bound plus a margin. */
const RETIRE_DEADLINE_MS = 20_000;

/** TS-1 — the postures that hold a node, so the probe runs and `meshEnabled`
 * reads true: a capture (signing in, or held for approval) and a link that
 * stands (up, or signed out and waiting to be signed in again).
 *
 * TS-D16 — and a node the tailnet keeps down for sending no logs: the posture
 * is still held, and a probe that finds the floor restarted declares it again,
 * which builds the node again (up, if the tailnet's flow logs are off now). */
const LIVE: ReadonlySet<UserLinkState> = new Set<UserLinkState>([
  "capturing",
  "awaiting_approval",
  "linked",
  "expired",
  "removed",
  "logs_required",
]);
const isLive = (state: UserLinkState): boolean => LIVE.has(state);

export class LinkService extends EventEmitter {
  private readonly linkPath: string;
  private readonly logger: Logger;
  private readonly now: () => number;
  private link: TailscaleLink | null = null;
  private linkFileCorrupt = false;
  private state: UserLinkState = "offline";
  private detail: string | null = null;
  private captureMisses = 0;
  private nodeState: string | null = null;
  private authUrl: string | null = null;
  /** TS-1 — the sign-in facts the floor reports beside the node
   * (`MeshSelfIdentity`, `MeshNotUpDetails`): the name Tailscale shows, its
   * console, and when the key lapses (`null` = expiry disabled; `undefined` =
   * not known). */
  private machineName: string | null = null;
  private adminUrl: string | null = null;
  private keyExpiresAt: number | null | undefined = undefined;
  /** TS-1 — why the floor's last bring-up ended without a node, when one did. */
  private failure: MeshFailure | null = null;
  /** T11 — the Tailscale client the node embeds, kept while the node is down. */
  private tailscaleVersion: string | null = null;
  /** T11 — Tailnet Lock holds the node that is up: connected, not yet trusted. */
  private needsSignature = false;
  /** TS-D16 — the capture in flight asked to send logs ("Send logs on this
   * network", after a tailnet refused one that sent none). Capture keeps it in
   * the new link.json; a standing link's own `sendLogs` is read from there. */
  private captureSendLogs = false;
  /** TS-1 (P2) — the mesh unit's last word heard on the health stream, so a
   * delta about another unit, or one that says nothing new, brings nothing
   * forward. */
  private lastFloorWord = "";
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastEmitted = "";
  /** The posture ask in flight, if any. A probe that finds the floor holding no
   * posture restores it only when nothing is already asking: the boot's own
   * ask races the first probe, and a second `native.mesh.start` landing before
   * the first has installed a node ABORTS that bring-up and starts another
   * (services/mesh.rs `start`: no node present ⇒ teardown + build). */
  private declaring: Promise<void> | null = null;
  /** UA-P-0k — whether the posture this service holds has LANDED on the floor
   * behind the current mgmt link. The floor's `disabled` is evidence of a
   * forgotten posture only while it has not: the floor answers
   * `native.mesh.self` from its AGGREGATED health, which its own task refreshes
   * after `start` has already set the unit (field-native `lib.rs`
   * `health_refresh`, fed by `services/mesh.rs` `Shared::set`), so the boot
   * default can outlive the ask that ended it — and a second `start` then tears
   * down the bring-up the first began. Measured 2026-09-24 on the dev stack:
   * `fieldd.link.posture_restored` 8 ms after the first dial of a cold linked
   * boot whose ask had landed. A new ask clears it until it lands; so do a
   * re-dial (a respawned floor holds nothing) and this service's own stop. */
  private postureLanded = false;

  constructor(private readonly opts: LinkServiceOptions) {
    super();
    this.linkPath = join(opts.dataDir, ...LAYOUT.LINK_FILE);
    this.logger = opts.logger ?? createNoopLogger();
    this.now = opts.now ?? Date.now;
    this.loadLink();
    // TS-1 — a desktop whose node is down still knows its sign-in's date.
    if (this.link?.keyExpiresAt !== undefined) this.keyExpiresAt = this.link.keyExpiresAt;
  }

  status(): UserLinkStatus {
    return {
      link: this.link,
      // UA-P-0a — "have we asked the floor for a node?", which is a posture
      // question and not the floor's opinion. `nodeState` below is the floor's
      // own answer about the node it was asked for.
      meshEnabled: isLive(this.state),
      nodeState: this.nodeState,
      authUrl: this.authUrl,
      linkState: this.state,
      linkDetail: this.detail,
      machineName: this.machineName,
      adminUrl: this.adminUrl,
      ...(this.keyExpiresAt !== undefined ? { keyExpiresAt: this.keyExpiresAt } : {}),
      failure: this.failure,
      tailscaleVersion: this.tailscaleVersion,
      needsSignature: this.needsSignature,
      sendLogs: this.link?.sendLogs === true,
    };
  }

  /** UA-P-0a — the boot posture, derived from `link.json` and nothing else.
   * A linked desktop asks the floor for its node; an unlinked one asks for
   * nothing and runs no timer, because there is nothing to probe. */
  start(): void {
    if (this.linkFileCorrupt) {
      // P4 — LOUD and OFFLINE. The identity record is never overwritten by a
      // guess (that law is older than this one and stands), but the desktop
      // does not get to keep serving a tailnet under an identity it cannot
      // read. The sentence names the file so a human can move it aside.
      this.enter("link_corrupt", `link.json is present but unusable: ${this.linkPath}`);
      return;
    }
    const login = this.link?.login ?? null;
    if (login === null) {
      this.enter("offline", null);
      void this.adoptFloorCapture();
      return;
    }
    this.enter("linked", null);
    void this.declarePosture("linked", login);
    this.schedule(0);
  }

  /** TS-1 — a capture outlives the fieldd that asked for it: the floor
   * outlives fieldd (design-02), and since P3 a capture waits for the person,
   * never a timer. So a daemon that boots unlinked reads the floor once, and a
   * capture it still holds — a person mid-sign-in when fieldd restarted — is
   * carried on rather than left as a node nobody watches. It declares nothing:
   * the posture is already the floor's. */
  private async adoptFloorCapture(): Promise<void> {
    let mode: string | undefined;
    try {
      mode = MeshSelfIdentity.parse(await this.opts.native.request("native.mesh.self")).mode;
    } catch (error) {
      mode = notUpDetails(error)?.mode;
    }
    if (mode !== "capture" || this.state !== "offline" || this.stopped) return;
    this.logger.info(
      "fieldd.link.capture_adopted",
      "The floor still holds a capture a previous fieldd began; carrying it on",
      {},
    );
    this.captureMisses = 0;
    this.postureLanded = true;
    this.enter("capturing", null);
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** UA-P-0j — the mgmt link dialed the floor again: a reconnect, or the
   * supervisor's respawn after a crash or a wedge. A respawned floor boots
   * OFFLINE and holds no posture until it is asked (services/mesh.rs, the mesh
   * unit's `start`), and nothing else here would ever ask it again — measured
   * 2026-09-24: a wedge restart at 12:05:59 left a LINKED desktop with no
   * tailnet node until a new fieldd booted at 14:46:19. So the next probe is
   * brought forward; it reads the floor's own answer and restores the posture
   * only when the floor holds none. The re-dial is also what makes a `disabled`
   * answer evidence again once an ask has landed (UA-P-0k, `postureLanded`). */
  floorReconnected(): void {
    this.postureLanded = false;
    if (!isLive(this.state)) return;
    this.schedule(0);
  }

  /** TS-1 (P2) — the floor's mesh unit moved: its state, its sign-in address or
   * its words. Read the node now rather than at the next 15 s probe, so a
   * sign-in finished in the browser lands on the pane within a beat. The probe
   * stays the reader and the backstop; this only brings it forward. */
  noteFloorHealth(
    units:
      | ReadonlyArray<{
          unit: string;
          state: string;
          detail?: string | undefined;
          authUrl?: string | undefined;
        }>
      | undefined,
  ): void {
    // the tolerant reader: a health payload without units says nothing new
    const mesh = units?.find((unit) => unit.unit === "mesh-gateway");
    const word =
      mesh === undefined ? "" : [mesh.state, mesh.detail ?? "", mesh.authUrl ?? ""].join("\u0000");
    if (word === this.lastFloorWord) return;
    this.lastFloorWord = word;
    if (!isLive(this.state)) return;
    this.schedule(PUSH_SETTLE_MS);
  }

  /** UA-P-0a (D1) — THE LINK ACT. The floor brings a node up in `capture` mode,
   * truffle drives the interactive browser login, and the capture loop below
   * finishes the job. Nothing is declared and nothing is published until it
   * does: the account is not known yet, so nothing can be scoped to it.
   *
   * Idempotent while capturing (a second ask re-declares the same posture and
   * the floor answers `started: false`); refused once linked, because relinking
   * a different account is unlink-then-link and unlink is the act that retires
   * the tailnet identity.
   *
   * TS-1 (P7) — `authKey` signs the capture in with no browser: it rides this
   * one `native.mesh.start` and is never kept, logged or audited (the floor
   * holds it for the one bring-up). A link that stands but is signed out is
   * signed in again by `renew()`, not by a second link.
   *
   * TS-D16 — `sendLogs` begins the capture again with "Send logs on this
   * network", after the tailnet refused one that sent none (`logs_required`). */
  async begin(options: { authKey?: string; sendLogs?: boolean } = {}): Promise<UserLinkStatus> {
    if (this.state === "linked") {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "this user is already linked to a tailscale account; unlink first",
        false,
        { login: this.link?.login ?? null },
      );
    }
    if (this.hasStandingLink()) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        this.state === "logs_required"
          ? "this user's tailscale link stands and its network requires device logs; send logs on this network (user.link.logs)"
          : "this user's tailscale link stands and is waiting to be signed in again; renew it",
        false,
        { login: this.link?.login ?? null, linkState: this.state },
      );
    }
    if (this.linkFileCorrupt) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `link.json is present but unusable; move it aside to link again: ${this.linkPath}`,
        false,
      );
    }
    this.captureMisses = 0;
    this.captureSendLogs = options.sendLogs === true;
    this.enter("capturing", null);
    await this.declarePosture("capture", undefined, options.authKey);
    // The first probe is AWAITED rather than scheduled, so the answer this act
    // returns is a real posture and not an optimistic one: on a floor whose
    // node is already up (a relink after `login_unavailable`, a second user's
    // link on a machine where the node survived) the refusal — or the capture —
    // lands in the same call the user's click made.
    await this.probe();
    return this.status();
  }

  /** TS-1 (P6) — the person ends a capture: the node it asked for stops, its
   * identity stays (a stop never retires: a later link reuses the keys), and
   * the desktop is offline again. Only a capture is cancelled — a link that
   * stands is ended by unlink — so anything else answers its status as it is:
   * a capture that landed as the person clicked is a link, honestly.
   *
   * TS-D16 — a capture the tailnet refused for sending no logs is ended the
   * same way, when the person would rather not send them. */
  async cancel(): Promise<UserLinkStatus> {
    if (
      this.hasStandingLink() ||
      (this.state !== "capturing" &&
        this.state !== "awaiting_approval" &&
        this.state !== "logs_required")
    ) {
      return this.status();
    }
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    await this.stopNode();
    this.nodeState = null;
    this.captureMisses = 0;
    this.captureSendLogs = false;
    this.adminUrl = null;
    this.enter("offline", null);
    this.logger.info("fieldd.link.capture_cancelled", "The person cancelled the link capture", {});
    return this.status();
  }

  /** TS-1 — sign a linked node in again: its key lapsed, or it was removed in
   * the console. The record stands; the floor rebuilds the node on its own
   * state (the same identity and keys — Tailscale's re-auth keeps the node and
   * its IP), and the build's interactive login hands out the address the
   * person finishes in a browser. A sign-in already offered is the live one,
   * so asking again changes nothing. */
  async renew(): Promise<UserLinkStatus> {
    const login = this.link?.login ?? null;
    if (login === null || (this.state !== "expired" && this.state !== "removed")) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "nothing to renew: the link is not waiting to be signed in again",
        false,
        { linkState: this.state },
      );
    }
    if (this.authUrl === null) {
      this.logger.info("fieldd.link.renew", "Signing the linked node in again", {
        linkState: this.state,
      });
      await this.declarePosture("linked", login, undefined, true);
    }
    await this.probe();
    return this.status();
  }

  /** TS-1 — the link record stands (a captured login) and its node waits on a
   * sign-in: renewal's two states, and an approval that holds a renewal.
   * TS-D16 — or waits on the network's logs: "Send logs on this network". */
  private hasStandingLink(): boolean {
    return (
      this.link !== null &&
      this.link.login !== null &&
      (this.state === "expired" ||
        this.state === "removed" ||
        this.state === "awaiting_approval" ||
        this.state === "logs_required")
    );
  }

  /** TS-D16 (ruled A) — "Send logs on this network" for the link that stands,
   * on or off. It is kept in link.json (never an env var), and the node is
   * built again with it: truffle fixes the setting for a node's lifetime, and a
   * node the tailnet refused for sending none comes up only when built anew. A
   * capture asks through `begin({sendLogs})` instead, having no link yet. */
  async logs(send: boolean): Promise<UserLinkStatus> {
    const link = this.link;
    const login = link?.login ?? null;
    if (link === null || login === null || this.linkFileCorrupt) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "no tailscale link to send logs on; a capture asks with user.link.begin {sendLogs}",
        false,
        { linkState: this.state },
      );
    }
    if ((link.sendLogs === true) === send) return this.status();
    const next: TailscaleLink = { ...link, sendLogs: send };
    this.persistLink(next);
    this.link = next;
    this.logger.info("fieldd.link.logs", "Send logs on this network changed", { send });
    await this.declarePosture("linked", login);
    await this.probe();
    return this.status();
  }

  /** UA-3 unlink: native retire (node dropped, sidecar dead, state archived)
   * then the local record clears. Local product state is untouched — unlink
   * keeps every byte except the tailnet identity (UA-D8).
   *
   * TS-D14 — the floor signs the device out of its tailnet first, and the
   * answer says whether Tailscale took it (`signedOut`). */
  async unlink(): Promise<MeshRetireResult> {
    const result = MeshRetireResult.parse(
      await this.opts.native.request("native.mesh.retire", {}, { deadlineMs: RETIRE_DEADLINE_MS }),
    );
    try {
      rmSync(this.linkPath, { force: true });
    } catch (error) {
      this.logger.warn("fieldd.link.clear_failed", "link.json could not be removed", {
        error: String(error),
      });
    }
    this.link = null;
    this.linkFileCorrupt = false;
    this.captureMisses = 0;
    this.nodeState = "disabled";
    this.postureLanded = false;
    this.authUrl = null;
    // TS-1 — the facts belonged to the identity just retired.
    this.machineName = null;
    this.adminUrl = null;
    this.keyExpiresAt = undefined;
    this.tailscaleVersion = null;
    this.needsSignature = false;
    this.captureSendLogs = false;
    // UA-P-0a — unlink is the posture going offline, and the timer goes with
    // it: an unlinked desktop has no node and therefore nothing to probe.
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.state = "offline";
    this.detail = null;
    this.emitIfChanged();
    return result;
  }

  // ---- the posture, as asked of the floor ----

  private declarePosture(
    mode: "capture" | "linked",
    login?: string,
    authKey?: string,
    renew?: boolean,
  ): Promise<void> {
    this.postureLanded = false;
    const asking = this.askFloor(mode, login, authKey, renew).finally(() => {
      if (this.declaring === asking) this.declaring = null;
    });
    this.declaring = asking;
    return asking;
  }

  private async askFloor(
    mode: "capture" | "linked",
    login?: string,
    authKey?: string,
    renew?: boolean,
  ): Promise<void> {
    // TS-D15/D16 — the node sends no logs unless the person said to, for this
    // link (link.json) or for the capture in flight.
    const clientLogUpload = mode === "linked" ? this.link?.sendLogs === true : this.captureSendLogs;
    try {
      MeshStartResult.parse(
        await this.opts.native.request("native.mesh.start", {
          mode,
          ...(login !== undefined ? { login } : {}),
          // TS-1 — the key rides this one request and is never logged: the
          // warning below names the mode and the error, never the params.
          ...(authKey !== undefined ? { authKey } : {}),
          ...(renew === true ? { renew } : {}),
          ...(clientLogUpload ? { clientLogUpload } : {}),
        }),
      );
      this.postureLanded = true;
    } catch (error) {
      // The floor being unreachable is not a posture change: the link is still
      // the link, and the next probe that finds the floor holding no posture
      // re-declares it (UA-P-0j), as does the next boot. What must NOT happen is
      // a silent downgrade to something more open — and none is possible here,
      // because the door and the serve both read the stored login, not this
      // call's outcome.
      this.logger.warn(
        "fieldd.link.posture_declare_failed",
        "The mesh posture could not be declared to the floor",
        { mode, error: String(error) },
      );
    }
  }

  /** UA-P-0a — stop the node WITHOUT retiring the identity. A capture that
   * cannot finish (a tagged node; a login another local user holds) leaves the
   * tailnet keys exactly where they are — the user may resolve the reason and
   * link again — but it does not leave a node running for a desktop that is not
   * scoped to any account. */
  private async stopNode(): Promise<void> {
    this.postureLanded = false;
    try {
      MeshStopResult.parse(await this.opts.native.request("native.mesh.stop"));
    } catch (error) {
      this.logger.warn("fieldd.link.stop_failed", "The mesh node could not be stopped", {
        error: String(error),
      });
    }
  }

  private enter(state: UserLinkState, detail: string | null): void {
    this.state = state;
    this.detail = detail;
    if (!isLive(state)) this.authUrl = null;
    this.emitIfChanged();
  }

  // ---- capture loop ----

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.probe();
    }, ms);
    this.timer.unref?.();
  }

  private async probe(): Promise<void> {
    // UA-P-0a — the loop belongs to the live postures. Reaching it from an
    // offline one would be probing a node nobody asked for.
    if (!isLive(this.state)) return;
    try {
      const self = MeshSelfIdentity.parse(await this.opts.native.request("native.mesh.self"));
      this.nodeState = "up";
      this.authUrl = null;
      this.noteFacts(self);
      // T11 — Tailnet Lock: the node is up and reaches no one until it is signed
      this.needsSignature = self.needsSignature === true;
      // TS-1 — the node is installed and signed out of the tailnet (its key
      // lapsed, or it was removed in the console): nothing reaches this desktop,
      // and the link that stands waits to be signed in again (`renew`). Before
      // TS-1 this read as linked while every other device lost it (gap 14).
      if (self.needsLogin === true && this.link !== null && this.link.login !== null) {
        this.enter(this.signedOutWord(), null);
        this.schedule(this.opts.probeMs ?? PROBE_MS);
        return;
      }
      const login = self.login;
      if (login !== undefined && login.length > 0 && !this.linkFileCorrupt) {
        if (await this.capture(login, self.dnsName)) return;
      } else if (this.state === "capturing" || this.state === "awaiting_approval") {
        // A RUNNING node with no login: the netmap answered, the tailnet has no
        // user for us. Once is timing; repeatedly is a TAGGED node, which has
        // no login by construction. Capture ends rather than spinning forever.
        this.captureMisses += 1;
        if (this.captureMisses >= (this.opts.captureAttempts ?? CAPTURE_ATTEMPTS)) {
          this.logger.warn(
            "fieldd.link.login_unavailable",
            "The node is up but the tailnet never answered with a user for it; capture ended",
            { attempts: this.captureMisses },
          );
          await this.stopNode();
          this.nodeState = null;
          this.enter(
            "login_unavailable",
            "the tailnet has no user for this node (a tagged node cannot link)",
          );
          return;
        }
      }
      this.emitIfChanged();
      this.schedule(
        this.state === "linked"
          ? (this.opts.verifyMs ?? VERIFY_MS)
          : (this.opts.probeMs ?? PROBE_MS),
      );
    } catch (error) {
      // WG-D4 — the floor held unresponsive refused the ask before sending it:
      // that is no reading of its node, which keeps what it was last read as
      if (isNativeUnresponsive(error)) {
        this.schedule(this.opts.probeMs ?? PROBE_MS);
        return;
      }
      const details: MeshNotUpReading = notUpDetails(error) ?? {};
      this.nodeState = details.state ?? null;
      this.authUrl = details.authUrl ?? null;
      this.noteFacts(details);
      // T11 — no node up, so no lock holding one
      this.needsSignature = false;
      this.settleNotUp(details);
      // UA-P-0j — `disabled` is the floor's word for "no posture held": its boot
      // default, `stop` and `retire` set it and nothing else does
      // (services/mesh.rs). This service holding a posture while the floor holds
      // none means the floor restarted under us, so the posture is asked for
      // again. ONLY `disabled`: `starting` is a bring-up in flight that a second
      // ask would abort, and `degraded`/`crashed` are a posture the floor still
      // holds. An ask already in flight (the boot's own) is left to land.
      //
      // UA-P-0k (2026-09-24) — and an ask that HAS landed is left alone too,
      // until the link re-dials: right after `start`, the floor can still answer
      // its boot default `disabled` (`postureLanded` says why), and restoring
      // on that read doubled every cold linked boot and every link click — the
      // floor tore down the bring-up the first ask began and built another. The
      // UA-P-0j note that the boot's ask was "never doubled" held only against
      // a probe racing the ask, not against one reading the floor just after it.
      //
      // TS-1 — a floor that states its posture (`mode`) settles the question
      // outright: holding one, it has forgotten nothing, whatever its lagging
      // aggregated health says. The `disabled` reading stays the rule for a
      // floor from before TS-1, which states none.
      if (
        this.nodeState === "disabled" &&
        details.mode === undefined &&
        this.declaring === null &&
        !this.postureLanded
      ) {
        await this.restorePosture();
      }
      this.emitIfChanged();
      this.schedule(this.opts.probeMs ?? PROBE_MS);
    }
  }

  /** TS-1 — the word a not-up answer moves the posture to. A capture is held
   * by approval or is signing in. A link that stands is held by approval (its
   * renewal on a tailnet that asks again), or is asked to sign in again (an
   * address is on offer: the key lapsed, or the device was removed), or keeps
   * the word it had — a bring-up in flight, or a floor that lost the posture,
   * which the caller restores.
   *
   * TS-D16 — whatever the posture, a node the tailnet keeps down for sending
   * no logs is `logs_required`: a capture's, or a link's. */
  private settleNotUp(details: MeshNotUpReading): void {
    if (details.failure === "logging_required") {
      this.enter("logs_required", null);
      return;
    }
    const linkStands = this.link !== null && this.link.login !== null;
    if (!linkStands) {
      if (this.state === "capturing" || this.state === "awaiting_approval") {
        this.enter(details.needsApproval === true ? "awaiting_approval" : "capturing", null);
      }
      return;
    }
    if (details.needsApproval === true) {
      this.enter("awaiting_approval", null);
    } else if (this.authUrl !== null) {
      this.enter(this.signedOutWord(), null);
    }
  }

  /** TS-1 — a node asked to sign in again LAPSED when its key's time has
   * passed, or when that time is unknown (the honest guess: "Sign in to
   * Tailscale again" is true either way); it was REMOVED when its key still had
   * time, or never expires — someone took the device out in the console. */
  private signedOutWord(): "expired" | "removed" {
    const at = this.keyExpiresAt;
    if (at === null) return "removed";
    if (at !== undefined && at > this.now()) return "removed";
    return "expired";
  }

  /** TS-1 — keep what the floor said beside the node. Absent says nothing new:
   * an older floor, or a fact not known yet. */
  private noteFacts(facts: {
    machineName?: string | undefined;
    adminUrl?: string | undefined;
    keyExpiresAt?: number | undefined;
    keyExpiryDisabled?: boolean | undefined;
    failure?: MeshFailure | undefined;
    tailscaleVersion?: string | undefined;
  }): void {
    if (facts.machineName !== undefined) this.machineName = facts.machineName;
    if (facts.adminUrl !== undefined) this.adminUrl = facts.adminUrl;
    if (facts.tailscaleVersion !== undefined) this.tailscaleVersion = facts.tailscaleVersion;
    const expiry = facts.keyExpiryDisabled === true ? null : facts.keyExpiresAt;
    if (expiry !== undefined && expiry !== this.keyExpiresAt) {
      this.keyExpiresAt = expiry;
      this.rememberExpiry();
    }
    this.failure = facts.failure ?? null;
  }

  /** TS-1 — the expiry rides the record (display only, never a trust input),
   * so a boot whose node is down still says the date and tells a lapse from a
   * removal. Written only when it moves: a verify never churns the disk. */
  private rememberExpiry(): void {
    const link = this.link;
    if (link === null || this.linkFileCorrupt || this.keyExpiresAt === undefined) return;
    if (link.keyExpiresAt === this.keyExpiresAt) return;
    const next: TailscaleLink = { ...link, keyExpiresAt: this.keyExpiresAt };
    try {
      this.persistLink(next);
      this.link = next;
    } catch (error) {
      this.logger.warn(
        "fieldd.link.expiry_unrecorded",
        "The sign-in's expiry could not be recorded",
        {
          error: String(error),
        },
      );
    }
  }

  /** UA-P-0j — re-ask the floor for the posture this service holds. */
  private async restorePosture(): Promise<void> {
    const login = this.link?.login ?? null;
    // TS-D16 — a link the tailnet kept down for its logs stands too: declared
    // again, its node is built again (up, if the flow logs are off now). A
    // capture the tailnet refused is not: the person begins it again.
    const standing =
      this.state === "linked" ||
      this.state === "expired" ||
      this.state === "removed" ||
      this.state === "logs_required";
    const renewalHeld = this.state === "awaiting_approval" && login !== null;
    if ((standing || renewalHeld) && login !== null) {
      this.logger.warn(
        "fieldd.link.posture_restored",
        "The floor held no mesh posture while this desktop is linked; declared it again",
        { mode: "linked" },
      );
      await this.declarePosture("linked", login);
    } else if (this.state === "capturing" || this.state === "awaiting_approval") {
      this.logger.warn(
        "fieldd.link.posture_restored",
        "The floor held no mesh posture while a link was being captured; declared it again",
        { mode: "capture" },
      );
      await this.declarePosture("capture");
    }
  }

  /** The captured login becomes the account, unless another local user already
   * holds it (UA-P-0b). Returns true when this call ENDED the loop — the caller
   * must not schedule again. */
  private async capture(login: string, dnsName: string | undefined): Promise<boolean> {
    // UA-P-0b (D8) — ONE LOCAL USER PER TAILSCALE ACCOUNT, LAW. Two local users
    // holding one login would see each other as SELF at every door on this
    // machine, which is the account boundary inverted rather than enforced.
    // Checked here, at the only moment a login enters this user's tree.
    const held = this.opts
      .otherUserLinks?.()
      .find((other) => other.login.toLowerCase() === login.toLowerCase());
    if (held !== undefined) {
      this.logger.warn(
        "fieldd.link.login_already_linked",
        "Another local user already holds this tailscale account; one local user per account",
        { other: held.label },
      );
      await this.stopNode();
      this.nodeState = null;
      this.enter(
        "login_already_linked",
        `the local user "${held.label}" is already linked to this tailscale account; unlink it first`,
      );
      return true;
    }

    if ((this.link?.login ?? null) === null && this.opts.beforeLinked !== undefined) {
      try {
        await this.opts.beforeLinked();
      } catch (error) {
        this.logger.error(
          "fieldd.link.before_linked_failed",
          "What a new link waits for failed; the link lands anyway",
          error,
        );
      }
    }

    const at = new Date(this.now()).toISOString();
    if (this.link === null || this.link.login !== login) {
      // UA-4: a non-null stored login CHANGING means the trust root moved
      // under a live node (an account switch without unlink). The door
      // follows the stored value, so say it loudly — self/guest verdicts
      // re-scope from this moment. Unlink→relink is the deliberate path.
      const moved = this.link !== null && this.link.login !== null && this.link.login !== login;
      const next: TailscaleLink = {
        login,
        ...(tailnetOf(dnsName) !== undefined ? { tailnet: tailnetOf(dnsName) } : {}),
        linkedAt: this.link?.linkedAt ?? at,
        lastVerifiedAt: at,
        // TS-1 — the date the node reported with its login, if it did
        ...(this.keyExpiresAt !== undefined ? { keyExpiresAt: this.keyExpiresAt } : {}),
        // TS-D16 — the capture's "Send logs on this network" becomes the
        // link's; a login that moved under a live link keeps what its node
        // was built with
        ...(this.captureSendLogs || this.link?.sendLogs === true ? { sendLogs: true } : {}),
      };
      this.persistLink(next);
      this.link = next;
      this.captureSendLogs = false;
      if (moved) {
        this.logger.warn(
          "fieldd.link.login_changed",
          "The node's login changed under a live link — self/guest trust now follows the new login",
          { loginPresent: true },
        );
      } else {
        this.logger.info("fieldd.link.captured", "The tailnet login was captured", {
          loginPresent: true,
        });
      }
    } else {
      // verified, unchanged — memory-only freshness; no disk churn
      this.link = { ...this.link, lastVerifiedAt: at };
    }
    if (this.state !== "linked") {
      // The capture completed: the account is known, so the floor is told and
      // everything downstream (the serve's allow, the door's comparison, the
      // publishers) is free to scope itself to it.
      this.captureMisses = 0;
      this.enter("linked", null);
      await this.declarePosture("linked", login);
    }
    return false;
  }

  private emitIfChanged(): void {
    const snapshot = JSON.stringify(this.status());
    if (snapshot === this.lastEmitted) return;
    this.lastEmitted = snapshot;
    this.emit("changed", this.status());
  }

  // ---- persistence (tmp + fsync + rename; link.json is an identity record) ----

  private loadLink(): void {
    let raw: string;
    try {
      raw = readFileSync(this.linkPath, "utf8");
    } catch {
      return; // absent — unlinked
    }
    try {
      this.link = TailscaleLink.parse(JSON.parse(raw));
    } catch (error) {
      // present-but-unusable: surface honestly, never overwrite an identity
      // record by guessing. UA-P-0a made this OFFLINE as well as paused — a
      // desktop that cannot read its own link does not get to keep serving one.
      this.linkFileCorrupt = true;
      this.logger.error(
        "fieldd.link.corrupt",
        "link.json is present but unusable; the desktop is offline until it is moved aside",
        error,
      );
    }
  }

  private persistLink(link: TailscaleLink): void {
    mkdirSync(dirname(this.linkPath), { recursive: true });
    const tmp = `${this.linkPath}.tmp-${process.pid}`;
    const fd = openSync(tmp, "w", 0o600);
    try {
      const payload = `${JSON.stringify(link, null, 2)}\n`;
      const buffer = Buffer.from(payload, "utf8");
      let offset = 0;
      while (offset < buffer.length) {
        offset += writeSync(fd, buffer, offset);
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // WIN-10: the commit point, retried past a scanner's handle on win32.
    durableRenameSync(tmp, this.linkPath);
  }
}

/**
 * UA-P-0b (D8) — every OTHER local user's captured login, with a name to put in
 * a sentence. James's ruling: "one local user per tailscale account; a second
 * link is forbidden until the first unlinks."
 *
 * WHY IT IS ENFORCED HERE AND NOT IN `users.json`. `UserRecord` has no account
 * field — the one-to-one binding IS the containment of `link.json` inside
 * `users/<fuid>/`, and a login only ever enters a user's tree at capture. So
 * capture is the one moment the law can be checked, and this is the enumeration
 * it checks against. Two local users holding one login would see each other as
 * SELF at every door on this machine, which is the account boundary inverted
 * rather than enforced.
 *
 * Every read is best-effort and none of them can fail the caller: a data dir
 * that is not shaped `<root>/users/<fuid>` (an injected or embedded root — dev,
 * tests, a headless boot) has no siblings to enumerate and honestly answers
 * nothing. A `users.json` that will not parse costs the SENTENCE, not the
 * refusal — the user is named by fuid instead.
 *
 * KNOWN GAP, recorded rather than papered over: another user whose `link.json`
 * is CORRUPT holds a login this cannot read, so the refusal cannot fire for it.
 * That user's own desktop is offline for the same reason (UA-P-0a), so nothing
 * is serving under the collision while it lasts — but if they repair the file,
 * two users hold one account and neither capture saw the other. It is logged at
 * warn so the condition is visible rather than silent; fail-closed here would
 * mean refusing every link on the machine because of one unreadable file.
 */
export function otherUserLinks(
  dataDir: string,
  logger: Logger = createNoopLogger(),
): Array<{ label: string; login: string }> {
  const root = rootAboveUserRoot(dataDir);
  if (root === undefined) return [];
  const mine = basename(dataDir);
  const usersDir = join(root, ...LAYOUT.USERS_DIR);
  let fuids: string[];
  try {
    fuids = readdirSync(usersDir);
  } catch {
    return [];
  }
  const names = new Map<string, string>();
  try {
    const file = readUsersFile(root);
    for (const user of file?.users ?? []) names.set(String(user.fuid), user.name);
  } catch (error) {
    logger.warn(
      "fieldd.link.users_file_unreadable",
      "users.json could not be read; another user holding this login will be named by number",
      { error: String(error) },
    );
  }
  const out: Array<{ label: string; login: string }> = [];
  for (const fuid of fuids) {
    if (fuid === mine || !/^[1-9][0-9]*$/.test(fuid)) continue;
    const path = join(usersDir, fuid, ...LAYOUT.LINK_FILE);
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue; // unlinked, or a root we may not read — holds nothing we can see
    }
    let parsed: ReturnType<typeof TailscaleLink.safeParse>;
    try {
      parsed = TailscaleLink.safeParse(JSON.parse(raw));
    } catch {
      parsed = { success: false } as ReturnType<typeof TailscaleLink.safeParse>;
    }
    if (!parsed.success) {
      logger.warn(
        "fieldd.link.other_user_link_unreadable",
        "Another local user's link.json is unusable, so the one-account-per-user check cannot see it",
        { path },
      );
      continue;
    }
    const login = parsed.data.login;
    if (typeof login === "string" && login.length > 0) {
      out.push({ label: names.get(fuid) ?? `user ${fuid}`, login });
    }
  }
  return out;
}

/** TS-1 — the floor's not-up answer (`MeshNotUpDetails`), read tolerantly: a
 * floor before TS-1 sends `service`, `state` and `authUrl` alone, and a field
 * of the wrong type is no reading at all rather than a guess. */
function notUpDetails(error: unknown): MeshNotUpReading | null {
  if (!(error instanceof RpcCallError)) return null;
  if (typeof error.details !== "object" || error.details === null) return null;
  const parsed = MeshNotUpReading.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}

/** TS-1 — the not-up answer with every field optional: the tolerant read. */
const MeshNotUpReading = MeshNotUpDetails.partial();
type MeshNotUpReading = ReturnType<typeof MeshNotUpReading.parse>;

/** "host.tail1234.ts.net" → "tail1234.ts.net" — display only, never trust. */
function tailnetOf(dnsName: string | undefined): string | undefined {
  if (dnsName === undefined) return undefined;
  const trimmed = dnsName.replace(/\.$/, "");
  const dot = trimmed.indexOf(".");
  return dot > 0 && dot < trimmed.length - 1 ? trimmed.slice(dot + 1) : undefined;
}
