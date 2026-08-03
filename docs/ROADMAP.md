# VibeField — Roadmap

> **Status:** the living now/next file — the corpus's single answer to "where are we, what's
> next." REWRITTEN in place at each milestone (never appended); history goes to `LANDED.md`,
> decision status to `DECISIONS.md`, petition status to `draft/petitions/README.md`, law
> stays in the design docs + specs. Last rewritten: **2026-08-03** (GT caught up through
> GT-2e `a3babb7` + GT-3 `af316db` — the one-authority correction, then restore/kill/config;
> AH-0 ratified; T2 consumed in exact-pinned Truffle v0.7.12; AH-1a/1b serving
> implementation landed at `9f80f0c` with its physical two-client tailnet proof still owed;
> AH-2 global validated catalog landed at `9c17c46`).
>
> Lives in main-tracked `docs/` (moved from `draft/` 2026-08-02). Corpus citations here
> (`specs/…`, `thinking-…`, `predesign-…`, `research/…`, `petitions/…`) resolve under
> `draft/`, which stays dev-local-only.

## Where the project stands

The P0 exit criterion — *real daily agent work, sessions surviving app restarts* — is half
held: the board survives daemon restarts (B3), PTYs survive everything up to field-native (the
NF kill matrix), docs sync across the mesh (C6), and the plugin/settings/logging/distribution
rails are in. **The missing half is the agents themselves** — the AR track, running over the
landed native floor, watched from the GT deck.

The artifact serving foundation and global catalog are now real but are not yet the whole
product: AH-1 persists source-local Proxy/Folder intent, allocates stable HTTPS listeners,
reconciles exact configs, and packages Truffle's hardened static sidecar; AH-2 publishes
bounded safe self-slices and makes `artifact.list/subscribe` a validated union fused with
authenticated origin identity, boot, and liveness. The missing product half is presentation:
AH-3 is the desktop sheet and shell-provider bridge before preview capture and phone.

## Tracks

| Track | State | Law lives in | Next / gate |
|---|---|---|---|
| A — shell & spine | walking skeleton + ESR COMPLETE | design-03 · `specs/electron-shell-refactor.md` | follow-on slice: lazy widget factories + on-demand settings/diagnostics (§5.4.4-sanctioned) |
| B — canvas & docs | B1–B4 landed; persistence half of P0 holds since B3 | design-03 · 03·A | — |
| PLUG — plugins | P0–P7 COMPLETE for the prior surface set; spec remains governing | `specs/plugin-architecture.md` | AH-3 adds the earned `hud.sheet` fixed slot; other dogfood through AR/GT; public index repo = James's op |
| C — mesh | C1–C6 + T1 COMPLETE; the P2 mesh chapter closed | design-04 · `thinking-c6-meshdata.md` | doc-existence replication (named follow-up); artifact product work moved to AH |
| AH — Artifact Hub | **IN FLIGHT (implementation)** — AH-0 ratified; AH-1a/1b serving landed at `9f80f0c`; AH-2 global catalog landed at `9c17c46`; live AH-1 two-client field proof owed | `specs/artifact-hub.md` | **AH-3** sheet + shell provider → AH-4 preview capture → AH-5 phone |
| D — widgetlab port | COMPLETE (code) | `thinking-widgetlab-port.md` | visual fidelity pass = James's eyeball (§5 checklist) |
| LOG — logging/diagnostics/audit | L0–L6 + post-L6 hardening COMPLETE (§23: 31/32 accepted) | `specs/logging-and-diagnostics.md` | LOG-39 packaged multi-platform CI · LOG-V5/V7/V8 decisions |
| NF — native floor | NF-0…7 COMPLETE and hardened | `specs/native-floor.md` | NF-remote rides GT-4 |
| IOS — companion | IOS-0/2/2f + IOS-EL8 landed | `thinking-ios-app.md` · `research/ios-app-design.md` | daily-driver features gated on desktop tracks; attach = GT-5; artifact catalog/open = AH-5 |
| GT — Godview terminal | **IN FLIGHT** — GT-0…3 landed, incl. the **GT-2e one-authority correction** (spec v0.3) | `specs/godview-terminal.md` | **GT-4** remote floor (⌘⇧O desktop remote panes = its test row; carries NF-remote) → GT-5 iOS attach |
| EDP/ESP — distribution & packaging | specs ready (EDP v0.3 · ESP v0.2 · plan v0.2); WP3 icons + WP6 tray/single-window landed | the three `specs/electron-*.md` | WP ladder toward WP10 = first signed macOS beta (EDP §16.1); ops first: Immutable Releases toggle + Azure signing eligibility (`thinking-auto-update.md` §next-actions) |
| AR — agent runtime | **NOT STARTED** — the other half of the P0 exit | design-04 (D33/D37/D38) · predesign-04 | chopsticks-in-fieldd over the NF seam; consumes petition C7 (implemented upstream); correlator = fieldd-side ancestor walk (NF resolution) |

## In flight now

**GT.** The control room is open and corrected. v0.3 (GT-2e) dissolved the second session
authority James smelled behind an `sh-3.2$` pane: the workspace now owns pane births through
its own doors, main hands it the real login shell, and the FLOOR flips ownerless births to
keep-until-exit — the persistence law survives fieldd death. GT-3 landed restore (consent
before anything relaunches; `paneMeta` carries `{cwd, title}`; dead panes come back as shells
in their folders), the audited two-step kill chip, the `config.ghostty` surface (Settings →
Terminal raw editor; atomic write + live reload through the floor's own document API; the
user's real Ghostty config imported underneath), and paid both named test debts (deck-mount
fixture; `keystrokeEchoMs: 3` report-only). Next slice **GT-4**: `with_terminal_mesh` behind
config + `terminal.v1.hosts` + mirror-write v1 — the desktop deck's ⌘⇧O remote panes are the
test row, and NF-remote rides it.

**AH.** The serving seam and global catalog are landed. `9f80f0c` replaces C6's
`{name,target}` writer behind its one-window adapter, persists v2 source-local intent, assigns
stable nonzero ports, fingerprints the full two-route config, retries durable remove-before-add
work, separates source/listener health, enables public TLS, and consumes exact Truffle v0.7.12
in both Rust and the packaged platform sidecar. Folder + optional SPA fallback now ride the
same listener as an empty, T2-confined preview route. `9c17c46` makes the catalog one validated
global view: safe self-slices, transport-derived MagicDNS binding, boot/liveness folding,
narrow hostile-input projection, tick-coalesced subscription snapshots, and a bounded retained
public cache. The post-landing review debt is paid in-tree: DeviceSlice owner binding and narrow
trust projection, raw URL grammar, generated end-to-end transport budgets, bounded ProductAPI
backpressure, async/coalesced cache checkpoints, durable preview cleanup retries, isolated
legacy migration, and drainable ArtifactService shutdown all precede AH-3.
**AH-3** now adds the earned `hud.sheet` slot and turns Electron main's existing authenticated
loopback client into the static `shell.*` provider; no ProductAPI UDS or renderer relay is
added.

## Next up — the options on the table (James's call)

- **AH-3** — ship the desktop artifact sheet, Proxy/Folder flows, and static `shell.*`
  provider bridge. AH-4/5 then add preview capture and phone; the AH-1 physical two-client
  proof can run alongside this work.
- **AR** — the agent tracks; the reason everything else exists.
- **GT-4 → GT-5** — the remote floor, then the phone attaches.
- **Packaging WPs** — the ladder toward the signed macOS beta (WP10).
- **LOG-39 packaged CI** — also carries NF's 24h-soak gate.
- **ESR follow-on** bundle slice.

## Open debts (dated, sourced)

- **F-C6-21 audit-integration flake** — struck 3× under full-suite load, green in isolation;
  "the track's oldest debt" (C6-6, 2026-07-28). The mcp EPIPE flake is separate and PAID
  (`37cce3b`).
- **fleet-v3 gate** — delete the C5 hello-claim fallback once every sidecar speaks v3+
  (C6-T1, 2026-07-28).
- **Doc existence does not replicate** — the doc registry is a local JSON file, not a
  SyncedStore slice; a peer's unknown doc shows honest "not held here" (C6-4 corpus
  correction, 2026-07-28).
- **AH-1 live-tailnet field proof** — automated contracts/daemon/Rust/upstream-static and
  packaged-sidecar gates are green, but this workspace had no authenticated second tailnet
  client. Run real HTTP + HTTPS Proxy and Folder URLs from another desktop/phone before
  declaring the physical AH-1 exit fully witnessed (AH §10, 2026-08-02).
- **Artifact device-retirement GC** — AH-2 retains last-known validated public slices across
  Truffle peer removal (bounded to 256 origins) so transport departure cannot silently erase
  user objects. A future explicit device-retirement policy owns deletion; valid empty origin
  slices already remove immediately (AH-D6, 2026-08-03).
- **CAS blob store / deny-by-default pull root** — not an Artifact Hub v1 dependency. Its own
  contracts+Rust slice begins only when canvas blob refs, peer-CAS fetching, or an explicit
  offline/immutable artifact mode exists (AH-D10; C6-6).
- **ESR follow-on** — lazy widget factories, settings/diagnostics on-demand, open-doc-only
  preview reveal gating (ESR close, review finding 4).
- **Per-section undo, ⌘Z, timeline** — D29′ residue (P7, 2026-07-24).
- **Sideload** — post first-party publishing (P7).
- **R2 `host:"process"`** — the plugin process-isolation rung (P4/P6 deferral).
- **I1/I4 ICE input arbitration** — implementation gated on James reading ICE `design-007`.
- **I5 ICE in-band rename migration** — needed before replica-everywhere (C2, 2026-07-23).
- **`terminal.list` lags for readers** — GT-1 fixed create, not list; assertions poll past
  the window (GT-2 finding 6).
- **Terminal unit health self-report** — the unit publishes `starting / "binding terminal
  service"` while its service is serving and answering; `system.health` (and Settings →
  System) may show it perpetually starting. Pre-existing, reproduced on unmodified code
  (GT-3 finding 6, 2026-08-02); NF-owned.
- **G10 ghosttea petition candidate, unfiled** — two workspace props: `defaultPersistence`
  (deletes the sub-second persistence-flip window) + a login/default-args knob (panes are
  non-login interactive shells today; packaged-run PATH poverty is the risk) (GT-2e/GT-3,
  2026-08-02).

## Eyeballs owed (James's standing visual passes)

- Widgetlab visual fidelity vs the original (thinking-widgetlab-port §5) — the D-track
  acceptance.
- Open an old board once; watch the C2 id-migration log line.
- Settings Plugins section (P2) · toggle widgetlab → placeholders swap LIVE + tray thins (P3).
- Mesh sync rows + the file pill's standing-state dot, both themes (C6-4).
- Artifact Hub grid + Proxy/Folder add flows, both themes and reduced motion (AH-3).
- The Godview deck end-to-end (⌘G): the zsh first pane, the consent face after a session
  dies, the kill chip's two steps, Settings → Terminal editor with a live reload (GT-2e/3).

## Upstream / sibling pins (the EL8 watch)

truffle `=0.7.12` (exact crates-io + exact platform sidecar packages; T2 consumed at AH-1) ·
ghosttea `=0.8.0` on all planes · chopsticks 0.1.4 · strata 0.10.0 (via ICE) ·
`@vibecook/ice` 0.2.0 (registry pin). G7/G8/G9 consumed at NF-7; G10 candidate named at
GT-2e/3, unfiled; C7 implemented upstream, consumption rides AR. Full petition status:
`petitions/README.md`.
