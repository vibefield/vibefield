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
import { RpcCallError } from "./native-link";

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

export interface LinkServiceOptions {
  dataDir: string;
  native: { request(method: string, params?: unknown): Promise<unknown> };
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
}

const PROBE_MS = 15_000;
const VERIFY_MS = 300_000;
const CAPTURE_ATTEMPTS = 8;

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
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastEmitted = "";
  /** The posture ask in flight, if any. A probe that finds the floor holding no
   * posture restores it only when nothing is already asking: the boot's own
   * ask races the first probe, and a second `native.mesh.start` landing before
   * the first has installed a node ABORTS that bring-up and starts another
   * (services/mesh.rs `start`: no node present ⇒ teardown + build). */
  private declaring: Promise<void> | null = null;

  constructor(private readonly opts: LinkServiceOptions) {
    super();
    this.linkPath = join(opts.dataDir, ...LAYOUT.LINK_FILE);
    this.logger = opts.logger ?? createNoopLogger();
    this.now = opts.now ?? Date.now;
    this.loadLink();
  }

  status(): UserLinkStatus {
    return {
      link: this.link,
      // UA-P-0a — "have we asked the floor for a node?", which is a posture
      // question and not the floor's opinion. `nodeState` below is the floor's
      // own answer about the node it was asked for.
      meshEnabled: this.state === "capturing" || this.state === "linked",
      nodeState: this.nodeState,
      authUrl: this.authUrl,
      linkState: this.state,
      linkDetail: this.detail,
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
      return;
    }
    this.enter("linked", null);
    void this.declarePosture("linked", login);
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
   * only when the floor holds none. */
  floorReconnected(): void {
    if (this.state !== "linked" && this.state !== "capturing") return;
    this.schedule(0);
  }

  /** UA-P-0a (D1) — THE LINK ACT. The floor brings a node up in `capture` mode,
   * truffle drives the interactive browser login, and the capture loop below
   * finishes the job. Nothing is declared and nothing is published until it
   * does: the account is not known yet, so nothing can be scoped to it.
   *
   * Idempotent while capturing (a second ask re-declares the same posture and
   * the floor answers `started: false`); refused once linked, because relinking
   * a different account is unlink-then-link and unlink is the act that retires
   * the tailnet identity. */
  async begin(): Promise<UserLinkStatus> {
    if (this.state === "linked") {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "this user is already linked to a tailscale account; unlink first",
        false,
        { login: this.link?.login ?? null },
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
    this.enter("capturing", null);
    await this.declarePosture("capture");
    // The first probe is AWAITED rather than scheduled, so the answer this act
    // returns is a real posture and not an optimistic one: on a floor whose
    // node is already up (a relink after `login_unavailable`, a second user's
    // link on a machine where the node survived) the refusal — or the capture —
    // lands in the same call the user's click made.
    await this.probe();
    return this.status();
  }

  /** UA-3 unlink: native retire (node dropped, sidecar dead, state archived)
   * then the local record clears. Local product state is untouched — unlink
   * keeps every byte except the tailnet identity (UA-D8). */
  async unlink(): Promise<MeshRetireResult> {
    const result = MeshRetireResult.parse(await this.opts.native.request("native.mesh.retire"));
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
    this.authUrl = null;
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

  private declarePosture(mode: "capture" | "linked", login?: string): Promise<void> {
    const asking = this.askFloor(mode, login).finally(() => {
      if (this.declaring === asking) this.declaring = null;
    });
    this.declaring = asking;
    return asking;
  }

  private async askFloor(mode: "capture" | "linked", login?: string): Promise<void> {
    try {
      MeshStartResult.parse(
        await this.opts.native.request("native.mesh.start", {
          mode,
          ...(login !== undefined ? { login } : {}),
        }),
      );
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
    if (state !== "capturing" && state !== "linked") this.authUrl = null;
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
    // UA-P-0a — the loop belongs to the two live postures. Reaching it from an
    // offline one would be probing a node nobody asked for.
    if (this.state !== "capturing" && this.state !== "linked") return;
    try {
      const self = MeshSelfIdentity.parse(await this.opts.native.request("native.mesh.self"));
      this.nodeState = "up";
      this.authUrl = null;
      const login = self.login;
      if (login !== undefined && login.length > 0 && !this.linkFileCorrupt) {
        if (await this.capture(login, self.dnsName)) return;
      } else if (this.state === "capturing") {
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
      const details =
        error instanceof RpcCallError && typeof error.details === "object" && error.details !== null
          ? (error.details as { state?: unknown; authUrl?: unknown })
          : {};
      this.nodeState = typeof details.state === "string" ? details.state : null;
      this.authUrl = typeof details.authUrl === "string" ? details.authUrl : null;
      // UA-P-0j — `disabled` is the floor's word for "no posture held": its boot
      // default, `stop` and `retire` set it and nothing else does
      // (services/mesh.rs). This service holding a posture while the floor holds
      // none means the floor restarted under us, so the posture is asked for
      // again. ONLY `disabled`: `starting` is a bring-up in flight that a second
      // ask would abort, and `degraded`/`crashed` are a posture the floor still
      // holds. An ask already in flight (the boot's own) is left to land.
      if (this.nodeState === "disabled" && this.declaring === null) {
        await this.restorePosture();
      }
      this.emitIfChanged();
      this.schedule(this.opts.probeMs ?? PROBE_MS);
    }
  }

  /** UA-P-0j — re-ask the floor for the posture this service holds. */
  private async restorePosture(): Promise<void> {
    const login = this.link?.login ?? null;
    if (this.state === "linked" && login !== null) {
      this.logger.warn(
        "fieldd.link.posture_restored",
        "The floor held no mesh posture while this desktop is linked; declared it again",
        { mode: "linked" },
      );
      await this.declarePosture("linked", login);
    } else if (this.state === "capturing") {
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
      };
      this.persistLink(next);
      this.link = next;
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

/** "host.tail1234.ts.net" → "tail1234.ts.net" — display only, never trust. */
function tailnetOf(dnsName: string | undefined): string | undefined {
  if (dnsName === undefined) return undefined;
  const trimmed = dnsName.replace(/\.$/, "");
  const dot = trimmed.indexOf(".");
  return dot > 0 && dot < trimmed.length - 1 ? trimmed.slice(dot + 1) : undefined;
}
