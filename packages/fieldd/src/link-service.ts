import { EventEmitter } from "node:events";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  LAYOUT,
  MeshRetireResult,
  MeshSelfIdentity,
  TailscaleLink,
  type UserLinkStatus,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError } from "./native-link";

// UA-3 — the link lifecycle (spec §7.1/§7.2): fieldd owns link.json, captures
// the S1 self-whois login once the node is Running (never during bring-up),
// and unlink retires the native identity. The stored login is UA-4's trust
// comparison value. Capture tolerates login-absent (a tagged or shy node) as
// a typed pre-capture state with retry — never an error, never synthesized.

export interface LinkServiceOptions {
  dataDir: string;
  native: { request(method: string, params?: unknown): Promise<unknown> };
  logger?: Logger;
  now?: () => number;
  /** cadence while unlinked / node not up (default 15s) */
  probeMs?: number;
  /** cadence once linked & up — a slow re-verify, not a poll (default 5min) */
  verifyMs?: number;
}

const PROBE_MS = 15_000;
const VERIFY_MS = 300_000;

export class LinkService extends EventEmitter {
  private readonly linkPath: string;
  private readonly logger: Logger;
  private readonly now: () => number;
  private link: TailscaleLink | null = null;
  private linkFileCorrupt = false;
  private meshEnabled = true; // honest after the first probe answers
  private nodeState: string | null = null;
  private authUrl: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastEmitted = "";

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
      meshEnabled: this.meshEnabled,
      nodeState: this.nodeState,
      authUrl: this.authUrl,
    };
  }

  start(): void {
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
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
    this.meshEnabled = false;
    this.nodeState = "disabled";
    this.authUrl = null;
    this.emitIfChanged();
    return result;
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
    try {
      const self = MeshSelfIdentity.parse(await this.opts.native.request("native.mesh.self"));
      this.meshEnabled = true;
      this.nodeState = "up";
      this.authUrl = null;
      const login = self.login;
      if (login !== undefined && login.length > 0 && !this.linkFileCorrupt) {
        const at = new Date(this.now()).toISOString();
        if (this.link === null || this.link.login !== login) {
          // UA-4: a non-null stored login CHANGING means the trust root moved
          // under a live node (an account switch without unlink). The door
          // follows the stored value, so say it loudly — self/guest verdicts
          // re-scope from this moment. Unlink→relink is the deliberate path.
          const moved = this.link !== null && this.link.login !== null && this.link.login !== login;
          const next: TailscaleLink = {
            login,
            ...(tailnetOf(self.dnsName) !== undefined ? { tailnet: tailnetOf(self.dnsName) } : {}),
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
      }
      // login absent = typed pre-capture (tagged node / netmap shy) — retry
      this.emitIfChanged();
      this.schedule(
        this.link?.login ? (this.opts.verifyMs ?? VERIFY_MS) : (this.opts.probeMs ?? PROBE_MS),
      );
    } catch (error) {
      const details =
        error instanceof RpcCallError && typeof error.details === "object" && error.details !== null
          ? (error.details as { state?: unknown; authUrl?: unknown })
          : {};
      this.nodeState = typeof details.state === "string" ? details.state : null;
      this.authUrl = typeof details.authUrl === "string" ? details.authUrl : null;
      this.meshEnabled = this.nodeState !== "disabled";
      this.emitIfChanged();
      this.schedule(this.opts.probeMs ?? PROBE_MS);
    }
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
      // record by guessing — capture is paused until a human moves it aside
      this.linkFileCorrupt = true;
      this.logger.error(
        "fieldd.link.corrupt",
        "link.json is present but unusable; capture is paused",
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
    renameSync(tmp, this.linkPath);
  }
}

/** "host.tail1234.ts.net" → "tail1234.ts.net" — display only, never trust. */
function tailnetOf(dnsName: string | undefined): string | undefined {
  if (dnsName === undefined) return undefined;
  const trimmed = dnsName.replace(/\.$/, "");
  const dot = trimmed.indexOf(".");
  return dot > 0 && dot < trimmed.length - 1 ? trimmed.slice(dot + 1) : undefined;
}
