import { z } from "zod";
import { AgentKind, AgentProviderId } from "./agent-index";

// AC — the agent catalog (thinking-ar-agent-catalog.md; AC-D1…AC-D11 RULED
// 2026-09-22): the ONE hand-maintained list of the agents VibeField supports,
// verified against both pinned siblings by wall R23 (`scripts/check-agent-catalog.mjs`,
// run by `pnpm preflight` and required by `pnpm siblings:pin`). Each row is a
// DECISION — which agents are offered, under what name, with which capabilities,
// on which surfaces — never a mirror of what puppeteer composes or rosetta
// registers: a sibling may implement more than this table offers; this table may
// never claim more than the pins implement (AC-D5); and a sibling offering with
// no row here is a gate failure until a maintainer writes one — `declined` is a
// decision (AC-D3).
//
// The id (AC-D2) is puppeteer's provider id VERBATIM wherever a puppeteer seam
// exists: it is persisted in `profiles.json`, `distribution.json`, the
// continuation records and the mesh row, so VibeField never renames — an
// upstream rename is a new row, a `deprecated` old row and a migration. rosetta's
// kind is a SEAM COLUMN, translated by fieldd where the seam is crossed and shown
// by no surface. `layoutRoot` is the join fact both siblings must spell alike —
// rosetta's `data_root`, puppeteer's observation root of the native-default
// profile (PU-7) — in the `~/…` form.
//
// AR-L1 keeps its teeth: a table of names is not a licence to branch on one. No
// product code compares an id to a literal (R23b, beside the walls R20–R22); the
// table carries names, roots and booleans — nothing a vendor owns. The wire
// grammar (`AgentProviderId`, `AgentKind`) stays OPEN: a row from a newer peer
// carrying an id this build has no row for is carried and drawn with its letter
// (tolerant reader), never selectable.
//
// Maintaining it: `pnpm siblings:pin` moves a sibling and runs R23 — a red "no
// decision for `x`" is the moment to add a row. `supported` needs a live witness
// IN THIS REPO (AC-D6): a real spawn on the floor and, for `history`, the
// persona's root enrolled and joined on the real daemon — puppeteer's own
// promotion ledger (`support/agents.json`) is evidence, never the witness. Every
// status change is one LANDED line; `admitted` and `decision` carry the trail on
// the wire so a Settings surface can say "supported since …" without reading
// source. The rows are in DISPLAY ORDER — the order is a decision too.
//
// Regenerate the projections after any edit: `pnpm --filter @vibefield/contracts
// gen:schema` writes `gen/agent-catalog.json` (what preflight reads; under
// `pnpm gen:check`) and `fixtures/agent-catalog.valid.json` (the `agent.catalog`
// wire shape the phone's kit mirrors; test/agent-catalog.test.ts holds it equal).

/** AC-D3 — the decision a row records. `supported`: offered, witnessed live in
 * this repo. `preview`: offered, badged, not yet witnessed. `deprecated`: no new
 * sessions or personas; existing sessions resume; history stays; badged.
 * `declined`: looked at and not offered — the row exists so the gate can tell a
 * decision from an omission; it never leaves fieldd. */
export const AgentCatalogStatus = z.enum(["supported", "preview", "deprecated", "declined"]);
export type AgentCatalogStatus = z.infer<typeof AgentCatalogStatus>;

/** The index's state for an agent on a device (`AgentProviderSummary.history`):
 * `indexed` (the record consents to the kind or enrolls a root of it),
 * `unindexed` (daemon ready, nothing named), `unavailable` (daemon not ready,
 * or its registry disagrees with the catalog on the kind). Open on the wire. */
export const AGENT_HISTORY_STATES = ["indexed", "unindexed", "unavailable"] as const;
export type AgentHistoryState = (typeof AGENT_HISTORY_STATES)[number];

/** Statuses a surface may START a session or a persona under. */
export const AGENT_OFFERED_STATUSES = ["supported", "preview"] as const;
/** Statuses a surface SHOWS (a deprecated agent's sessions and history stay). */
export const AGENT_VISIBLE_STATUSES = ["supported", "preview", "deprecated"] as const;

/** AC-D5 — what VibeField OFFERS for the agent: a claim at most what the pins
 * implement (R23 fails a claim the pin cannot honour and warns on a capability
 * the pin implements that the row does not claim). `reattach` is AR-4's
 * re-attach across a fieldd restart (puppeteer `attachSession`); `resume` is a
 * continuation into a new run (the launch descriptor's `resume`); `history` is
 * rosetta's index over the agent's on-disk ledger; `usage` the account-usage
 * port; `distribution` installs and updates; `personas` puppeteer profiles.
 * `invoke` (AR-7a; narrowed by AR7-D15, ruled 2026-09-27) claims a LAUNCHER:
 * typing the agent's name in one of our panes' shells reaches fieldd's gateway
 * through puppeteer's spawn-through shim, and a session is prepared from the
 * agent's native CLI grammar and adopted, managed, in the terminal that holds
 * it (`prepareInvocation` → `adoptPrepared`). VibeField is STRICT in its own
 * panes (AR7-D1): a session the managed launch cannot carry is refused, never
 * run unmanaged. So the claim needs an adapter that CLASSIFIES what is typed
 * (`nativeInvocation.classifies`, which R23 reads from the pin): a version
 * query, a one-shot and an agent that lives elsewhere run as typed (a one-shot
 * is a regular command, AR7-D12), and only a session is managed or refused. A
 * grammar that does not classify cannot tell `--version` from a session, so
 * its row does not claim it; a row that does not claim it gets no launcher,
 * and its name runs as the shell would run it. */
export const AgentOffers = z.object({
  spawn: z.boolean(),
  resume: z.boolean(),
  reattach: z.boolean(),
  history: z.boolean(),
  usage: z.boolean(),
  distribution: z.boolean(),
  personas: z.boolean(),
  invoke: z.boolean(),
});
export type AgentOffers = z.infer<typeof AgentOffers>;
export type AgentCapability = keyof AgentOffers;
export const AGENT_CAPABILITIES = [
  "spawn",
  "resume",
  "reattach",
  "history",
  "usage",
  "distribution",
  "personas",
  "invoke",
] as const satisfies readonly AgentCapability[];

/** Which surfaces show the row. A protocol agent (ACP) is desktop-only. */
export const AgentSurfaces = z.object({ desktop: z.boolean(), phone: z.boolean() });
export type AgentSurfaces = z.infer<typeof AgentSurfaces>;
export type AgentSurface = keyof AgentSurfaces;

/** The `~/…` spelling both siblings use for a native layout root. */
export const AgentLayoutRoot = z
  .string()
  .min(1)
  .max(256)
  .regex(/^~(\/[^/]+)*$/, "a layout root is `~` or `~/segment(/segment)*`");

/** One row of the catalog — STRICT (an unknown key in the table is a typo; the
 * wire form below is the tolerant one). */
export const AgentCatalogEntry = z
  .object({
    /** VibeField's id for the agent (AC-D2: puppeteer's provider id, verbatim,
     * wherever a puppeteer seam exists) */
    id: AgentProviderId,
    /** the user-facing name on every VibeField surface (AC-D4: ours) */
    label: z.string().min(1).max(64),
    status: AgentCatalogStatus,
    /** the seams — a column per sibling, null where the sibling has no counterpart */
    seams: z.object({
      puppeteer: z.object({ provider: AgentProviderId }).nullable(),
      rosetta: z.object({ kind: AgentKind }).nullable(),
    }),
    /** the join fact both siblings must spell identically; null for an agent
     * with no on-disk history (a protocol, not a vendor) */
    layoutRoot: AgentLayoutRoot.nullable(),
    offers: AgentOffers,
    /** presentation key for the mark atlases; defaults to `id`; never selects
     * behaviour (the atlases' own rule) */
    mark: z.string().min(1).max(64).optional(),
    /** the decision trail: the date the row was written or last changed status,
     * and the reference a reader can follow (a slate id, a LANDED section) */
    admitted: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    decision: z.string().min(1).max(512),
    surfaces: AgentSurfaces,
  })
  .strict();
export type AgentCatalogEntry = z.infer<typeof AgentCatalogEntry>;

/** The wire form of a row (`agent.catalog`, the kit's fixture): tolerant AT
 * EVERY DEPTH — an unknown key rides through on the row and inside `offers`
 * and `surfaces`, a capability or surface this build never heard of is
 * carried and one it knows but the sender lacks reads as unclaimed, and
 * `status` is an OPEN string (a status this build never heard of, from a
 * newer desktop over the link, is carried and treated as not offered — never
 * a refusal of the whole list; AC-4's finding). */
export const AgentCatalogEntryWire = AgentCatalogEntry.extend({
  status: z.string().min(1).max(32),
  offers: AgentOffers.partial().passthrough(),
  surfaces: AgentSurfaces.partial().passthrough(),
}).passthrough();
export type AgentCatalogEntryWire = z.infer<typeof AgentCatalogEntryWire>;

// ── THE TABLE — one row per decision, in display order ──

const OFFERS_FULL: AgentOffers = {
  spawn: true,
  resume: true,
  reattach: false,
  history: true,
  usage: true,
  distribution: true,
  personas: true,
  invoke: false,
};
const OFFERS_NO_USAGE: AgentOffers = { ...OFFERS_FULL, usage: false };
// `invoke` is claimed a row at a time: a launcher goes only to an agent whose
// adapter classifies (AR7-D15), as R23 reads the pin.
const OFFERS_WITH_INVOKE: AgentOffers = { ...OFFERS_FULL, invoke: true };

export const AGENT_CATALOG = [
  {
    // 2026-09-22 AC-D6: `supported` on this repo's own witnesses — a real spawn
    // on the floor (LANDED §AR-3), the re-attach across a fieldd restart
    // (§AR-4, the pin's one `attachSession`), the persona's root enrolled and
    // joined on the real daemon (§AR-2's real-rosettad row). Upstream:
    // `legacy-verified` in puppeteer's ledger.
    // 2026-09-27 AR-7a: `invoke` added — the pin's launch provider declares its
    // native CLI grammar (`nativeInvocation`, puppeteer 524709b; R23 reads it).
    // Erratum 2026-09-28 (AR7-D15, ruled 2026-09-27): a grammar is not the
    // licence; the claim stands because the adapter classifies
    // (`nativeInvocation.classifies: true` at puppeteer 2b83e2c; R23 reads it).
    id: "claude",
    label: "Claude Code",
    status: "supported",
    seams: { puppeteer: { provider: "claude" }, rosetta: { kind: "claude-code" } },
    layoutRoot: "~/.claude",
    offers: { ...OFFERS_WITH_INVOKE, reattach: true },
    admitted: "2026-09-22",
    decision: "AC-D6 — supported: spawn, re-attach and the real-daemon history join witnessed here",
    surfaces: { desktop: true, phone: true },
  },
  {
    // 2026-09-22 AC-D6: `supported` — spawn rows since AR-3 and the scripted
    // daemon's join (`agent-runtime.test.ts`); upstream `legacy-verified`. The
    // real-daemon join row for codex is owed with AC-3 (the slate's note).
    // 2026-09-27 AR-7a: `invoke` added — the pin's launch provider declares its
    // native CLI grammar (`nativeInvocation`, puppeteer 524709b; R23 reads it).
    // Erratum 2026-09-28 (AR7-D15, ruled 2026-09-27): a grammar is not the
    // licence; the claim stands because the adapter classifies
    // (`nativeInvocation.classifies: true` at puppeteer 2b83e2c; R23 reads it).
    id: "codex",
    label: "Codex",
    status: "supported",
    seams: { puppeteer: { provider: "codex" }, rosetta: { kind: "codex" } },
    layoutRoot: "~/.codex",
    offers: OFFERS_WITH_INVOKE,
    admitted: "2026-09-22",
    decision:
      "AC-D6 — supported: spawn witnessed here, the join on the scripted daemon; real-daemon join owed",
    surfaces: { desktop: true, phone: true },
  },
  {
    // 2026-09-22 AC-D6: `preview` — both pins implement it (launch, usage,
    // distribution, profiles; the `grok` adapter), no live witness in this
    // repo yet; upstream `baseline-pending`.
    // 2026-09-27 AR-7a: `invoke` added — the pin's launch provider declares its
    // native CLI grammar (`nativeInvocation`, puppeteer 524709b; R23 reads it).
    // Erratum 2026-09-28 (AR7-D15, ruled 2026-09-27): `invoke` WITHDRAWN — a
    // grammar is not the licence, and this adapter does not classify (no
    // `nativeInvocation.classifies` at puppeteer 2b83e2c; R23 reads it). No
    // launcher: typed by name, it runs as the shell runs it.
    id: "grok",
    label: "Grok",
    status: "preview",
    seams: { puppeteer: { provider: "grok" }, rosetta: { kind: "grok" } },
    layoutRoot: "~/.grok",
    offers: OFFERS_FULL,
    admitted: "2026-09-22",
    decision: "AC-D6 — preview until a live spawn and history join are witnessed here",
    surfaces: { desktop: true, phone: true },
  },
  {
    // 2026-09-22 AC-D6: `preview`. The two siblings spell it differently
    // (`kimi` / `kimi-code`) — exactly the seam column's job.
    // 2026-09-27 AR-7a: `invoke` added — the pin's launch provider declares its
    // native CLI grammar (`nativeInvocation`, puppeteer 524709b; R23 reads it).
    // Erratum 2026-09-28 (AR7-D15, ruled 2026-09-27): `invoke` WITHDRAWN — a
    // grammar is not the licence, and this adapter does not classify (no
    // `nativeInvocation.classifies` at puppeteer 2b83e2c; R23 reads it). No
    // launcher: typed by name, it runs as the shell runs it.
    id: "kimi",
    label: "Kimi Code",
    status: "preview",
    seams: { puppeteer: { provider: "kimi" }, rosetta: { kind: "kimi-code" } },
    layoutRoot: "~/.kimi-code",
    offers: OFFERS_FULL,
    admitted: "2026-09-22",
    decision: "AC-D6 — preview until a live spawn and history join are witnessed here",
    surfaces: { desktop: true, phone: true },
  },
  {
    // 2026-09-22 AC-D6: `preview`; no account-usage port in the pin (AC-D5).
    // 2026-09-27 AR-7a: `invoke` added — the pin's launch provider declares its
    // native CLI grammar (`nativeInvocation`, puppeteer 524709b; R23 reads it).
    // Erratum 2026-09-28 (AR7-D15, ruled 2026-09-27): `invoke` WITHDRAWN — a
    // grammar is not the licence, and this adapter does not classify (no
    // `nativeInvocation.classifies` at puppeteer 2b83e2c; R23 reads it). No
    // launcher: typed by name, it runs as the shell runs it.
    id: "opencode",
    label: "OpenCode",
    status: "preview",
    seams: { puppeteer: { provider: "opencode" }, rosetta: { kind: "opencode" } },
    layoutRoot: "~/.local/share/opencode",
    offers: OFFERS_NO_USAGE,
    admitted: "2026-09-22",
    decision: "AC-D6 — preview until a live spawn and history join are witnessed here",
    surfaces: { desktop: true, phone: true },
  },
  {
    // 2026-09-22 AC-D6: `preview`; no account-usage port in the pin (AC-D5).
    // 2026-09-27 AR-7a: `invoke` added — the pin's launch provider declares its
    // native CLI grammar (`nativeInvocation`, puppeteer 524709b; R23 reads it).
    // Erratum 2026-09-28 (AR7-D15, ruled 2026-09-27): `invoke` WITHDRAWN — a
    // grammar is not the licence, and this adapter does not classify (no
    // `nativeInvocation.classifies` at puppeteer 2b83e2c; R23 reads it). No
    // launcher: typed by name, it runs as the shell runs it.
    id: "hermes",
    label: "Hermes",
    status: "preview",
    seams: { puppeteer: { provider: "hermes" }, rosetta: { kind: "hermes" } },
    layoutRoot: "~/.hermes",
    offers: OFFERS_NO_USAGE,
    admitted: "2026-09-22",
    decision: "AC-D6 — preview until a live spawn and history join are witnessed here",
    surfaces: { desktop: true, phone: true },
  },
  {
    // 2026-09-22 AC-D6: `preview`. Its layout root is not a dotdir of its own
    // name — the root column exists so nobody has to remember that.
    // Erratum 2026-09-22 (AC-2, wall R23's first run): NO `personas`. The pin's
    // profiles port declares `support.supported: false` — Antigravity ships no
    // login, so "a managed root can be allocated but never onboarded, so hosts
    // must not offer one" (puppeteer adapter-antigravity profiles.ts) — and
    // puppeteer's onboarding refuses createProfile for it. A profiles PORT is
    // not the capability; the table had read the port list. REVERSED 2026-09-25
    // at puppeteer 63bf175: the adapter's profiles port declares `supported:
    // true` again (RFC 006's profile sets gave Antigravity a place to sign in),
    // so `personas` is claimed once more — the row's decision text carries
    // both dates. `history` is not a persona's: rosetta discovers the native
    // root, and a user consents to the kind through `index.enroll` (fieldd's
    // enabled_kinds).
    // 2026-09-27 AR-7a: `invoke` added — the pin's launch provider declares its
    // native CLI grammar (`nativeInvocation`, puppeteer 524709b; R23 reads it).
    // Erratum 2026-09-28 (AR7-D15, ruled 2026-09-27): `invoke` WITHDRAWN — a
    // grammar is not the licence, and this adapter does not classify (no
    // `nativeInvocation.classifies` at puppeteer 2b83e2c; R23 reads it). No
    // launcher: typed by name, it runs as the shell runs it.
    id: "antigravity",
    label: "Antigravity",
    status: "preview",
    seams: { puppeteer: { provider: "antigravity" }, rosetta: { kind: "antigravity" } },
    layoutRoot: "~/.gemini/antigravity-cli",
    offers: OFFERS_FULL,
    admitted: "2026-09-22",
    decision:
      "AC-D6 — preview until a live spawn and history join are witnessed here; personas re-claimed 2026-09-25 at puppeteer 63bf175 (the adapter's profiles port declares supported again — the 2026-09-22 erratum that narrowed it is reversed)",
    surfaces: { desktop: true, phone: true },
  },
  {
    // 2026-09-22 AC-D6: `preview`; no account-usage port in the pin (AC-D5).
    // 2026-09-27 AR-7a: `invoke` added — the pin's launch provider declares its
    // native CLI grammar (`nativeInvocation`, puppeteer 524709b; R23 reads it).
    // Erratum 2026-09-28 (AR7-D15, ruled 2026-09-27): `invoke` WITHDRAWN — a
    // grammar is not the licence, and this adapter does not classify (no
    // `nativeInvocation.classifies` at puppeteer 2b83e2c; R23 reads it). No
    // launcher: typed by name, it runs as the shell runs it.
    id: "copilot",
    label: "GitHub Copilot",
    status: "preview",
    seams: { puppeteer: { provider: "copilot" }, rosetta: { kind: "copilot" } },
    layoutRoot: "~/.copilot",
    offers: OFFERS_NO_USAGE,
    admitted: "2026-09-22",
    decision: "AC-D6 — preview until a live spawn and history join are witnessed here",
    surfaces: { desktop: true, phone: true },
  },
  {
    // 2026-09-22 AC-D6: `preview`; no account-usage port in the pin (AC-D5).
    // The history join IS witnessed on the real daemon (§AR-2's pi persona:
    // `~/.pi` is the layout root, `~/.pi/agent` binds — PU-7); the spawn is not.
    // 2026-09-27 AR-7a: `invoke` added — the pin's launch provider declares its
    // native CLI grammar (`nativeInvocation`, puppeteer 524709b; R23 reads it).
    // Erratum 2026-09-28 (AR7-D15, ruled 2026-09-27): `invoke` WITHDRAWN — a
    // grammar is not the licence, and this adapter does not classify (no
    // `nativeInvocation.classifies` at puppeteer 2b83e2c; R23 reads it). No
    // launcher: typed by name, it runs as the shell runs it.
    id: "pi",
    label: "Pi",
    status: "preview",
    seams: { puppeteer: { provider: "pi" }, rosetta: { kind: "pi" } },
    layoutRoot: "~/.pi",
    offers: OFFERS_NO_USAGE,
    admitted: "2026-09-22",
    decision:
      "AC-D6 — preview: the real-daemon history join is witnessed here, a live spawn is not",
    surfaces: { desktop: true, phone: true },
  },
  {
    // 2026-09-22 AC-D7: `preview`, spawn and resume only, desktop only. ACP is a PROTOCOL,
    // not a vendor — how an unlisted agent attaches at all — with no on-disk
    // ledger for rosetta to index and no distribution or profiles port in the
    // pin. Alternative recorded in the slate: `declined`.
    // 2026-09-27 AR-7a: no `invoke` — the pin's ACP launch provider declares no
    // native CLI grammar (`nativeInvocation`, puppeteer 524709b; R23 reads it).
    id: "acp",
    label: "ACP",
    status: "preview",
    seams: { puppeteer: { provider: "acp" }, rosetta: null },
    layoutRoot: null,
    offers: {
      spawn: true,
      resume: true,
      reattach: false,
      history: false,
      usage: false,
      distribution: false,
      personas: false,
      invoke: false,
    },
    admitted: "2026-09-22",
    decision:
      "AC-D7 — preview, spawn and resume only: a protocol, not a vendor; no ledger, no personas",
    surfaces: { desktop: true, phone: false },
  },
] as const satisfies readonly AgentCatalogEntry[];

// ── readers (pure; the table is data) ──

/** The readers over ONE table. Production reads `AGENT_CATALOG`; a test seam
 * composes a table of its own beside a scripted provider (AC-3's
 * `AgentRuntimeServiceOptions.catalog`), which is how fieldd's catalog rules
 * are exercised without naming a vendor in a test's assertions. */
export interface AgentCatalogReaders {
  readonly table: readonly AgentCatalogEntry[];
  /** the row for an id, or undefined — an id never decided on */
  entry(id: string): AgentCatalogEntry | undefined;
  /** the catalog id rosetta's kind maps to (unique by the table's invariant),
   * or undefined — the kind is then shown by its wire spelling, never selectable */
  idForKind(kind: string): string | undefined;
  /** rosetta's kind for a catalog id, or undefined (no rosetta seam, or no row) */
  kindFor(id: string): string | undefined;
  /** whether a surface may START something as this agent — the status admits
   * it (`supported` | `preview`) and, when named, the row claims the capability */
  isOffered(id: string, capability?: AgentCapability): boolean;
  /** whether a surface may CONTINUE something as this agent: a deprecated row
   * still resumes its existing sessions (AC-D3) */
  isVisible(id: string): boolean;
  /** the rows a surface sees, in display order — `declined` never leaves
   * fieldd; `surface` applies the row's own visibility */
  visible(surface?: AgentSurface): AgentCatalogEntry[];
}

export function createAgentCatalogReaders(
  table: readonly AgentCatalogEntry[],
): AgentCatalogReaders {
  const offered = AGENT_OFFERED_STATUSES as readonly string[];
  const shown = AGENT_VISIBLE_STATUSES as readonly string[];
  const entry = (id: string) => table.find((row) => row.id === id);
  return {
    table,
    entry,
    idForKind: (kind) => table.find((row) => row.seams.rosetta?.kind === kind)?.id,
    kindFor: (id) => entry(id)?.seams.rosetta?.kind,
    isOffered: (id, capability) => {
      const row = entry(id);
      if (row === undefined || !offered.includes(row.status)) return false;
      return capability === undefined ? true : row.offers[capability];
    },
    isVisible: (id) => {
      const row = entry(id);
      return row !== undefined && shown.includes(row.status);
    },
    visible: (surface) =>
      table.filter(
        (row) => shown.includes(row.status) && (surface === undefined || row.surfaces[surface]),
      ),
  };
}

/** The readers over THE table — what product code imports. */
export const AGENT_CATALOG_READERS: AgentCatalogReaders = createAgentCatalogReaders(AGENT_CATALOG);

export const AGENT_CATALOG_IDS: readonly string[] = AGENT_CATALOG.map((row) => row.id);

/** The row for an id, or undefined — an id this build never decided on. */
export function catalogEntry(id: string): AgentCatalogEntry | undefined {
  return AGENT_CATALOG_READERS.entry(id);
}

/** The catalog id rosetta's kind maps to (unique by the table's invariant),
 * or undefined — the kind is then shown by its wire spelling, never selectable. */
export function catalogIdForKind(kind: string): string | undefined {
  return AGENT_CATALOG_READERS.idForKind(kind);
}

/** rosetta's kind for a catalog id, or undefined (no rosetta seam, or no row). */
export function kindForCatalogId(id: string): string | undefined {
  return AGENT_CATALOG_READERS.kindFor(id);
}

/** Whether a surface may START something as this agent — the status admits
 * it (`supported` | `preview`) and, when named, the row claims the capability. */
export function isOffered(id: string, capability?: AgentCapability): boolean {
  return AGENT_CATALOG_READERS.isOffered(id, capability);
}

/** Whether a surface may CONTINUE something as this agent: a deprecated row
 * still resumes its existing sessions (AC-D3). */
export function isVisible(id: string): boolean {
  return AGENT_CATALOG_READERS.isVisible(id);
}

/** The rows a surface sees, in display order — `declined` never leaves fieldd;
 * `surface` applies the row's own visibility (a protocol agent is desktop-only). */
export function visibleCatalog(surface?: AgentSurface): AgentCatalogEntry[] {
  return AGENT_CATALOG_READERS.visible(surface);
}

// ── the `agent.catalog` door ──

/** agent.catalog — the visible rows for the caller's surface (absent = all
 * visible rows). Read-only, content-free, `agent.observe`. */
export const AgentCatalogParams = z
  .object({
    /** OPEN on an inbound door (tolerant reader): a surface word this build
     * never heard of is answered with every visible row, never refused */
    surface: z.string().min(1).max(32).optional(),
  })
  .passthrough();
export type AgentCatalogParams = z.infer<typeof AgentCatalogParams>;

export const AgentCatalogResult = z
  .object({ catalog: z.array(AgentCatalogEntryWire) })
  .passthrough();
export type AgentCatalogResult = z.infer<typeof AgentCatalogResult>;
