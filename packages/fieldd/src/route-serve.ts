import { createHash } from "node:crypto";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { ServeSpec, ServeState } from "./mesh-client";

// SP-3 (thinking-sync-planes.md §1.4, §6; design-06 §6) — THE ROUTE-PER-PROCESS
// DRIVER: the ticket template's serve half.
//
// TM-2 built the first one (terminal-serve.ts): a tailnet listener carrying one
// reverse-proxy route per live terminal cell, driven off live readings. SP-3
// lifts it so any SERVED PROCESS declares its listener and its loopback
// targets, and this module publishes the serve and reads it back. The cell is
// the first user; rosettad's serve on `PORTS.INDEX_SERVE` (index-serve.ts) the
// second. What a ticket names is read off the LIVE serve, never off what this
// daemon asked for (TM-2's F-H2): a URL is minted only for what is serving.
//
// THREE GATES, for every served process, each a refusal to publish rather than
// a degraded publish:
//
//   1. NO LINKED LOGIN, NO SERVE, EVER. `allow` is the sidecar's WhoIs gate,
//      and an empty allow list means THE WHOLE TAILNET (truffle RFC 023 §9.7).
//      A served process's door is only as strong as the credential it checks
//      itself, so an unlinked or pre-capture daemon publishes nothing at all.
//   2. THE OWNER'S WORD. Something other than this module decides whether the
//      process belongs on the tailnet: the floor's `terminalMesh` for the
//      cells, fieldd's `indexDirectPlane` for rosettad (OFF until DS-7).
//   3. NOTHING ROUTABLE, NOTHING PUBLISHED. A route to nothing answers a dial
//      with a refused connection instead of a 404.
//
// The RECONCILE is TM-2's, unchanged: idempotent BY SIGNATURE (re-declaring
// costs every live connection on the listener — truffle's proxy has `add` and
// `remove` and no update), serialized, the first refresh ALWAYS declares (F-H1:
// a serve lives in the floor and outlives fieldd), and a declaration that
// RESOLVED is not one that LANDED (F-M5).

/** A served process: the listener it is published on, under one engine
 * identity (also the serve's display name — the reconcile keys on it). */
export interface ServedProcess {
  serveId: string;
  /** the registry's fixed tailnet listener (`PORTS.*`) */
  listenPort: number;
}

/** One route: a path prefix onto one loopback port (the floor strips the
 * prefix — a cell's door matches `/control` and `/frames` exactly). */
export interface ServedRoute {
  prefix: string;
  targetPort: number;
}

/** What a served process asks its listener to carry: one route per INSTANCE
 * (the cells: `/cell/<boot>` each), or the WHOLE listener onto one loopback
 * port with nothing stripped (rosettad: a client dials rosetta's own routes at
 * the root). `null` = nothing routable right now. */
export type ServedTargets =
  | { kind: "routes"; routes: readonly ServedRoute[] }
  | { kind: "port"; port: number }
  /** F1 — the WHOLE listener onto one loopback port whose door checks a path secret its own
   * process was handed (the freeway host's `/f/<pathSecret>`, minted by the floor). The secret
   * rides the serve's TARGET (`secretDoor`), so a caller dials the bare root knowing nothing. */
  | { kind: "secret"; port: number; pathSecret: string; door: "freeway" };

/** Escape a LITERAL login for truffle's `allow` globs. The sidecar matches with
 * Go `path.Match`, lowercased on both sides, so a login's own glob
 * metacharacters have to be escaped or a `?` in an address would widen the
 * gate. Shared with the product serve's spec — one spelling of one rule. */
export function serveAllowGlob(login: string): string {
  return login.replace(/[\\*?[]/g, (c) => `\\${c}`);
}

/** The serve the readings call for, or `null` for "publish nothing". Pure —
 * the three gates and nothing else. */
export function routeServeSpec(
  process: ServedProcess,
  input: { published: boolean; linkedLogin: string | null; targets: ServedTargets | null },
): ServeSpec | null {
  if (!input.published) return null;
  if (input.linkedLogin === null) return null;
  const targets = input.targets;
  if (targets === null) return null;
  if (targets.kind === "routes") {
    if (targets.routes.length === 0) return null;
    return {
      serveId: process.serveId,
      name: process.serveId,
      listenPort: process.listenPort,
      target: { kind: "routes" },
      // plain HTTP inside WireGuard, the product serve's own choice: no
      // MagicDNS-cert dependency, and a ticket's URLs follow the serve's scheme
      // rather than asserting one (`composeRemoteEndpoints`)
      tls: false,
      allow: [serveAllowGlob(input.linkedLogin)],
      routes: targets.routes.map(({ prefix, targetPort }) => ({ prefix, targetPort })),
    };
  }
  if (targets.kind === "secret") {
    return {
      serveId: process.serveId,
      name: process.serveId,
      listenPort: process.listenPort,
      target: { kind: "port", port: targets.port },
      tls: false,
      allow: [serveAllowGlob(input.linkedLogin)],
      // the process's OWN door's proof, which it checks on every request
      pathSecret: targets.pathSecret,
      secretDoor: targets.door,
    };
  }
  return {
    serveId: process.serveId,
    name: process.serveId,
    listenPort: process.listenPort,
    // NO pathSecret: that is the product door's provenance proof, and the
    // process behind this serve knows nothing of it
    target: { kind: "port", port: targets.port },
    tls: false,
    allow: [serveAllowGlob(input.linkedLogin)],
  };
}

/** A change key for a spec. Re-declaring a serve costs every live connection
 * on its listener, so a driver must tell "the readings replayed" from "a route
 * moved". For a routes serve that is the listener, the gate and the routes —
 * byte for byte TM-2's key; a whole-listener serve's target IS its route, so
 * its port joins the key (a rosettad restart lands on a new one). A secret
 * target's secret joins it as a DIGEST (F1: a new floor boot is a new secret,
 * possibly on a recycled port), never the secret: a key is a value a reader
 * may print. The live view never carries a secret, so such a serve is matched
 * by declaring, never by reading it back. */
export function routeServeSignature(spec: ServeSpec | null): string {
  if (spec === null) return "none";
  const secret = spec.pathSecret === undefined ? [] : [secretDigest(spec.pathSecret)];
  return JSON.stringify([
    spec.listenPort,
    spec.allow ?? [],
    (spec.routes ?? []).map((r) => [r.prefix, r.targetPort]),
    ...(spec.target.kind === "port" ? [spec.target.port] : []),
    ...secret,
  ]);
}

function secretDigest(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 16);
}

/** The live serve of one process — `active` in the fused view, with a URL —
 * or `undefined`. THE reading a ticket mint asks before it names a URL.
 * `active` means "the node took it and has not since reported it stopped or
 * failed" (TM-2's F-L6c erratum): the strongest fact without a liveness
 * probe. */
export function publishedServe(
  serves: readonly ServeState[],
  serveId: string,
): (ServeState & { url: string }) | undefined {
  const serve = serves.find((s) => (s.serveId ?? s.name) === serveId);
  if (serve?.status !== "active" || serve.url === undefined) return undefined;
  return serve as ServeState & { url: string };
}

/** What a driver says in the log: its two events and three sentences. */
export interface RouteServeLog {
  declared: string;
  deferred: string;
  declaredMessage: string;
  withdrawnMessage: string;
  deferredMessage: string;
}

export interface RouteServeDriverOptions {
  /** the spec the current live readings call for (pure) */
  desired: () => ServeSpec | null;
  /**
   * Re-declare the desired serve set with this spec, or without it.
   *
   * ANSWERS WHETHER IT LANDED (F-M5, 2026-09-14), and that is the whole point
   * of the boolean: the injected closure goes through `MeshClient`, whose
   * posture is deliberately non-throwing — a mesh that is not up marks every
   * serve `pending` and resolves, and a per-serve add failure is recorded as an
   * `error` state and resolves. A driver that read RESOLUTION as success
   * recorded a signature nothing had reached the sidecar for, and then declined
   * to retry because the signature had not moved. So: true iff the node's state
   * now matches this declaration — the serve is ACTIVE for a spec, and really
   * gone for a withdrawal.
   */
  declare: (spec: ServeSpec | null) => Promise<boolean>;
  /** The mesh's fused serve view (`MeshClient.serves()`): what is LIVE, which
   * is how a declaration that did not land at once is found landed later. */
  serves?: () => readonly ServeState[];
  log: RouteServeLog;
  logger?: Logger;
}

/**
 * Drives one served process's serve from its readings.
 *
 * `refresh()` is idempotent BY SIGNATURE and serialized: readings replayed
 * unchanged declare nothing, and two changes arriving together never race two
 * declarations to the node.
 */
export class RouteServeDriver {
  private readonly logger: Logger;
  /** what was last DECLARED — the signature, never the spec: two specs that
   * differ only in field order are the same serve.
   *
   * NULL until this driver has declared anything, and that is deliberately NOT
   * the same value as "none" (F-H1, 2026-09-14). A serve lives in the FLOOR,
   * which outlives fieldd: after a fieldd death the predecessor's listener is
   * still up, still gated by whatever allow-list it carried, and still aimed
   * at loopback ports the OS has since recycled. If the first reading of a NEW
   * fieldd computes null, a driver that started at "none" would recognise its
   * own answer, declare nothing, and leave that listener on the tailnet with
   * nobody reconciling it: `MeshClient`'s stray sweep removes only serveIds
   * THIS process recorded, and a fresh process has recorded none. So the first
   * refresh ALWAYS declares, and a null spec is a withdrawal. */
  private declared: string | null = null;
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly driver: RouteServeDriverOptions) {
    this.logger = driver.logger ?? createNoopLogger();
  }

  /** The spec the current live readings call for. */
  desired(): ServeSpec | null {
    return this.driver.desired();
  }

  /** Reconcile the declaration with the current readings. Never throws: the
   * mesh being down is a normal state (MeshClient's own posture), and this
   * runs from link events with no caller to catch a rejection. */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const run = this.chain.then(async () => {
      if (this.disposed) return;
      const spec = this.desired();
      const signature = routeServeSignature(spec);
      if (signature === this.declared) return;
      // F-M5's other half (2026-10-17): a declaration that did not land at
      // once can land a moment later on the node's own news — the runtime's
      // `running` after a first subscription read `starting` — and a serve
      // already LIVE at exactly this signature needs no remove-then-add, which
      // would drop every connection on its listener. It is recorded, not
      // declared again. (A first refresh still always declares, F-H1: the live
      // view lists only what THIS daemon declared.)
      if (spec !== null && this.liveAt(spec, signature)) {
        this.declared = signature;
        return;
      }
      const { log } = this.driver;
      try {
        const landed = await this.driver.declare(spec);
        if (!landed) {
          // F-M5 — RESOLVED IS NOT LANDED. The bridge resolves for a mesh that
          // is not up (everything pending), for an add the node refused (an
          // error state), and for a removal that failed. None of those put the
          // serve on the tailnet, so none of them may be remembered: a
          // remembered signature is exactly what stops the next event from
          // retrying. Said at warn (2026-10-17): a declaration that silently
          // did not land is how the phone read "not publishing its terminal
          // doors" with nothing in the log.
          this.logger.warn(log.deferred, log.deferredMessage, {
            routes: spec?.routes?.length ?? 0,
          });
          return;
        }
        this.declared = signature;
        this.logger.debug(
          log.declared,
          spec === null ? log.withdrawnMessage : log.declaredMessage,
          {
            routes: spec?.routes?.length ?? 0,
            listenPort: spec?.listenPort ?? null,
          },
        );
      } catch (error) {
        // Same law for a bridge that throws outright.
        this.logger.warn(log.deferred, log.deferredMessage, { error: String(error) });
      }
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return this.chain;
  }

  /** Whether the serve is LIVE at this signature right now (`publishedServe`:
   * active, with a URL) — the node's word, not what this driver asked for. */
  private liveAt(spec: ServeSpec, signature: string): boolean {
    const live = publishedServe(this.driver.serves?.() ?? [], spec.serveId ?? spec.name);
    return live !== undefined && routeServeSignature(live) === signature;
  }

  /** Stop reconciling. Does NOT withdraw the serve — and the reason that used
   * to stand here, "the daemon's own stop ladder tears the whole serve set
   * down", was simply untrue (F-H1, 2026-09-14). NO ladder removes any serve:
   * the clean-stop, rollback and supersession ladders dispose this driver and
   * close the native link, while the serves live in the FLOOR, where only an
   * unlink-retire clears them (`field-native/src/services/mesh.rs`).
   *
   * So the listener really does outlive a stopped fieldd, which is the two-plane
   * law working as written rather than a leak to patch here — a withdrawal
   * raced against a dying link would only fail. What bounds it is the
   * SUCCESSOR: its first refresh always declares (see `declared`), so the next
   * boot withdraws a serve its own policy no longer calls for. While no fieldd
   * runs at all the listener stays up; nobody can mint a grant for it in that
   * window, and a door that admits no one without a grant it verifies stays
   * shut on the grant clock rather than standing open. (A door that verifies
   * NO grant is why the index serve is behind a flag: index-serve.ts.) */
  dispose(): void {
    this.disposed = true;
  }
}
