import {
  PORTS,
  remoteCellRoutePrefix,
  type TerminalRouteCell,
  type TerminalRouteSnapshot,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { ServeSpec } from "./mesh-client";

// TM-2 (thinking-terminal-mesh-cells.md §3 T, TM-D2) — THE TERMINAL ROUTES.
//
// One tailnet listener carrying one reverse-proxy route per live terminal
// cell: `/cell/<cellBootId>` → `127.0.0.1:<that cell's T1 door port>`, gated
// (ERRATA F-L6b, 2026-09-14: this line drew the route WITH a trailing slash,
// which `cellRoutesFor` below has never sent and the shipped sidecar never
// matches — see `remoteCellRoutePrefix`.)
// by the linked login. The sidecar splices the WebSocket upgrade straight into
// the cell, so neither fieldd nor the floor is in the byte path (EL2) and the
// cell's authority stays the grant it verifies in the first frame.
//
// This module is PURE POLICY over three live readings — the floor's route
// snapshot, the floor's `terminalMesh` word, and the link's login — plus the
// change detection that keeps a re-pair free. It owns no I/O: the declaration
// goes out through an injected bridge, exactly as ArtifactService's serves do.
//
// THREE GATES, and each is a refusal to publish rather than a degraded
// publish:
//
//   1. NO LINKED LOGIN, NO TERMINAL ROUTES, EVER. `allow` on a serve is the
//      sidecar's WhoIs gate, and an empty allow list means THE WHOLE TAILNET
//      (truffle RFC 023 §9.7). For the product door that is survivable — the
//      door behind it still checks scopes — but a cell door's only wall is the
//      grant, and a route with no allow-list would put every tailnet node one
//      unguessed grant away from a live PTY. So an unlinked or pre-capture
//      daemon publishes nothing at all.
//   2. THE FLOOR'S OWN WORD. `terminalMesh` false or absent ⇒ nothing is
//      published. The floor decides whether its doors belong on the tailnet;
//      fieldd only carries the decision to the sidecar.
//   3. A CELL WITHOUT DOORS IS NOT ROUTABLE. Keyless-bootstrap and pre-TP
//      cells carry no `doors`, and a route to nothing is worse than no route:
//      it answers a dial with a connection refused instead of a 404.
//
// WHY A SEPARATE SERVE, not routes added to the product serve (which is what
// TM-D2 and the slice brief both ask for): truffle's proxy API is `add` and
// `remove` with NO update (truffle-core 0.7.12 `src/proxy/mod.rs`), a same-id
// add answers `PROXY_EXISTS`, and `MeshClient`'s reconcile skips a serveId
// that is already live — so changing ANY serve's route list is a
// remove-then-add that drops every connection on that listener. Cell routes
// change on every cell birth and exit; the product door is what a dropped
// client must re-dial to get a replacement ticket. Bouncing it on cell churn
// would break the recovery path itself, so the churn is confined here, where
// it costs a terminal leg one reconnect that the routed client already knows
// how to make (`STALE_ROUTE` → re-ticket). Two listeners instead of one is the
// price of an API with no upsert; the day truffle grows one, this collapses
// back onto the product serve and `PORTS.TERMINAL_CELLS_SERVE` retires.

/** The engine identity and display name of the terminal listener. One
 * constant, because the driver declares it and the reconcile keys on it. */
export const TERMINAL_SERVE_ID = "terminal" as const;

/** One cell's route as the driver computes it, before it becomes a ServeSpec. */
export interface TerminalCellRoute {
  cellBootId: string;
  prefix: string;
  targetPort: number;
}

export interface TerminalServeDriverOptions {
  /** the floor's revisioned route snapshot (NativeLink.terminalRoutes) */
  routes: () => TerminalRouteSnapshot | undefined;
  /** the floor's own word that its doors are on the tailnet (MF-1l) */
  published: () => boolean;
  /** the WhoIs login this daemon is linked to, or null */
  linkedLogin: () => string | null;
  /**
   * Re-declare the desired serve set with this terminal spec, or without one.
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
  logger?: Logger;
}

/** Escape a LITERAL login for truffle's `allow` globs. The sidecar matches with
 * Go `path.Match`, lowercased on both sides, so a login's own glob
 * metacharacters have to be escaped or a `?` in an address would widen the
 * gate. Shared with the product serve's spec — one spelling of one rule. */
export function serveAllowGlob(login: string): string {
  return login.replace(/[\\*?[]/g, (c) => `\\${c}`);
}

/** The loopback port behind a cell's door pair, or `undefined` when the row
 * cannot be routed.
 *
 * BOTH doors must name the SAME port. One route can only carry one target, and
 * the cell serves `/control` and `/frames` on one listener by construction
 * (`field-native/src/tp/door.rs`) — so a row that disagrees is a floor this
 * build does not understand, and skipping it is the honest answer rather than
 * publishing a route that would silently send frames to the control port. */
export function cellDoorPort(cell: TerminalRouteCell): number | undefined {
  const control = portOf(cell.doors?.controlUrl);
  const frames = portOf(cell.doors?.framesUrl);
  if (control === undefined || frames === undefined || control !== frames) return undefined;
  return control;
}

function portOf(url: string | undefined): number | undefined {
  if (url === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const port = Number(parsed.port);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined;
}

/** The routes a snapshot calls for, in snapshot order. Cells without dialable
 * doors are DROPPED, not faked. */
export function cellRoutesFor(snapshot: TerminalRouteSnapshot | undefined): TerminalCellRoute[] {
  const out: TerminalCellRoute[] = [];
  for (const cell of snapshot?.cells ?? []) {
    const targetPort = cellDoorPort(cell);
    if (targetPort === undefined) continue;
    out.push({
      cellBootId: cell.cellBootId,
      // NO trailing slash — the shipped sidecar never matches one (TM-2b; the
      // rule and its evidence live on `remoteCellRoutePrefix`)
      prefix: remoteCellRoutePrefix(cell.cellBootId),
      targetPort,
    });
  }
  return out;
}

/** The serve the current state calls for, or `null` for "publish nothing".
 * Pure — the driver's whole policy, testable without a daemon. */
export function terminalServeSpec(input: {
  routes: TerminalRouteSnapshot | undefined;
  published: boolean;
  linkedLogin: string | null;
}): ServeSpec | null {
  if (!input.published) return null;
  if (input.linkedLogin === null) return null;
  const routes = cellRoutesFor(input.routes);
  if (routes.length === 0) return null;
  return {
    serveId: TERMINAL_SERVE_ID,
    name: TERMINAL_SERVE_ID,
    listenPort: PORTS.TERMINAL_CELLS_SERVE,
    target: { kind: "routes" },
    // plain HTTP inside WireGuard, the product serve's own choice: no
    // MagicDNS-cert dependency, and the ticket's URLs follow the serve's
    // scheme rather than asserting one (`remoteCellEndpointsFor`).
    tls: false,
    allow: [serveAllowGlob(input.linkedLogin)],
    routes: routes.map(({ prefix, targetPort }) => ({ prefix, targetPort })),
  };
}

/** A change key for a spec. Re-declaring a serve costs every live connection on
 * its listener, so the driver must be able to tell "the floor replayed its
 * snapshot" from "a cell was born". The route snapshot's own `revision` is NOT
 * that key: it moves on facts this serve does not carry (a token rotation, a
 * pid), and it resets across floor boots. */
export function terminalServeSignature(spec: ServeSpec | null): string {
  if (spec === null) return "none";
  return JSON.stringify([
    spec.listenPort,
    spec.allow ?? [],
    (spec.routes ?? []).map((r) => [r.prefix, r.targetPort]),
  ]);
}

/**
 * Drives the terminal serve from the floor's route rows.
 *
 * `refresh()` is idempotent BY SIGNATURE and serialized: a floor re-pair that
 * replays the identical snapshot declares nothing, and two changes arriving
 * together never race two declarations to the node.
 */
export class TerminalServeDriver {
  private readonly logger: Logger;
  /** what was last DECLARED — the signature, never the spec: two specs that
   * differ only in field order are the same serve.
   *
   * NULL until this driver has declared anything, and that is deliberately NOT
   * the same value as "none" (F-H1, 2026-09-14). A serve lives in the FLOOR,
   * which outlives fieldd: after a fieldd death the predecessor's terminal
   * listener is still up, still gated by whatever allow-list it carried, and
   * still aimed at loopback ports the OS has since recycled. If the first
   * reading of a NEW fieldd computes null — the last cell exited while we were
   * down, the login is not captured yet, the floor's flag is off — a driver
   * that started at "none" would recognise its own answer, declare nothing, and
   * leave that listener on the tailnet with nobody reconciling it:
   * `MeshClient`'s stray sweep removes only serveIds THIS process recorded, and
   * a fresh process has recorded none. So the first refresh ALWAYS declares,
   * and a null spec is a withdrawal. */
  private declared: string | null = null;
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly opts: TerminalServeDriverOptions) {
    this.logger = opts.logger ?? createNoopLogger();
  }

  /** The spec the current live readings call for. */
  desired(): ServeSpec | null {
    return terminalServeSpec({
      routes: this.opts.routes(),
      published: this.opts.published(),
      linkedLogin: this.opts.linkedLogin(),
    });
  }

  /** Reconcile the declaration with the current readings. Never throws: the
   * mesh being down is a normal state (MeshClient's own posture), and this
   * runs from link events with no caller to catch a rejection. */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const run = this.chain.then(async () => {
      if (this.disposed) return;
      const spec = this.desired();
      const signature = terminalServeSignature(spec);
      if (signature === this.declared) return;
      try {
        const landed = await this.opts.declare(spec);
        if (!landed) {
          // F-M5 — RESOLVED IS NOT LANDED. The bridge resolves for a mesh that
          // is not up (everything pending), for an add the node refused (an
          // error state), and for a removal that failed. None of those put the
          // routes on the tailnet, so none of them may be remembered: a
          // remembered signature is exactly what stops the next event from
          // retrying.
          this.logger.debug(
            "fieldd.terminal_serve.declare_deferred",
            "A terminal route declaration did not reach the node; the next change retries",
            { routes: spec?.routes?.length ?? 0 },
          );
          return;
        }
        this.declared = signature;
        this.logger.debug(
          "fieldd.terminal_serve.declared",
          spec === null
            ? "The terminal cell routes were withdrawn"
            : "The terminal cell routes were declared",
          { routes: spec?.routes?.length ?? 0, listenPort: spec?.listenPort ?? null },
        );
      } catch (error) {
        // Same law for a bridge that throws outright.
        this.logger.debug(
          "fieldd.terminal_serve.declare_deferred",
          "A terminal route declaration did not reach the node; the next change retries",
          { error: String(error) },
        );
      }
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return this.chain;
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
   * window, and a cell admits no one without a grant it verifies, so the
   * exposure ends on the grant clock rather than standing open. */
  dispose(): void {
    this.disposed = true;
  }
}
