# VibeField — Roadmap

> **Status:** the living now/next file — the corpus's single answer to "where are we, what's
> next." REWRITTEN in place at each milestone (never appended); history goes to `LANDED.md`,
> decision status to `DECISIONS.md`, petition status to `draft/petitions/README.md`, law
> stays in the design docs + specs. Last rewritten: **2026-08-04** (GT-3v `440b04e` — the
> glass deck on ghosttea 0.9.0, appearance viewer-local; earlier: GT-2e `a3babb7` + GT-3
> `af316db` — the one-authority correction, then restore/kill/config;
> AH-0 ratified; T2 consumed in exact-pinned Truffle v0.7.12; AH-1a/1b serving
> implementation landed at `9f80f0c` with its physical two-client tailnet proof still owed;
> AH-2 global validated catalog landed at `9c17c46`; AH-3 desktop runtime landed at
> `8c07bf4`, with WP8 packaged-plugin discovery and the physical UI/native-picker closeout
> still explicit; AH-4's preview runtime is in implementation, with physical tailnet proof
> deliberately still open).
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

The artifact serving foundation, global catalog, and desktop runtime are now real but are not
yet the whole product: AH-1 owns durable Proxy/Folder serving; AH-2 owns the bounded validated
global view; AH-3 adds the browser-plugin catalog/add flows, spine-owned right-side panel, and
authenticated Electron-main shell-provider bridge. Its packaged-plugin staging and physical
UI/native-picker closeout remain visible. AH-4 preview capture is now in implementation;
its two-device/Tailscale acceptance witness remains open. AH-5 still owns the phone.

## Tracks

| Track | State | Law lives in | Next / gate |
|---|---|---|---|
| A — shell & spine | walking skeleton + ESR COMPLETE | design-03 · `specs/electron-shell-refactor.md` | follow-on slice: lazy widget factories + on-demand settings/diagnostics (§5.4.4-sanctioned) |
| B — canvas & docs | B1–B4 landed; persistence half of P0 holds since B3 | design-03 · 03·A | — |
| PLUG — plugins | P0–P7 COMPLETE for the prior surface set; AH-3 added `hud.side-panel` at `8c07bf4` | `specs/plugin-architecture.md` | WP8 stages/signs bundled manifests for packaged discovery; other dogfood through AR/GT; public index repo = James's op |
| C — mesh | C1–C6 + T1 COMPLETE; the P2 mesh chapter closed | design-04 · `thinking-c6-meshdata.md` | doc-existence replication (named follow-up); artifact product work moved to AH |
| AH — Artifact Hub | **IN FLIGHT** — AH-1 serving `9f80f0c`; AH-2 catalog `9c17c46`; AH-3 desktop runtime `8c07bf4`; AH-4 preview runtime in implementation; live AH-1 proof + AH-3/AH-4 physical closeout owed | `specs/artifact-hub.md` | land/review AH-4 + physical two-device witness → AH-5 phone |
| D — widgetlab port | COMPLETE (code) | `thinking-widgetlab-port.md` | visual fidelity pass = James's eyeball (§5 checklist) |
| LOG — logging/diagnostics/audit | L0–L6 + post-L6 hardening COMPLETE (§23: 31/32 accepted) | `specs/logging-and-diagnostics.md` | LOG-39 packaged multi-platform CI · LOG-V5/V7/V8 decisions |
| NF — native floor | NF-0…7 COMPLETE and hardened | `specs/native-floor.md` | NF-remote rides GT-4 |
| IOS — companion | IOS-0/2/2f + IOS-EL8 landed | `thinking-ios-app.md` · `research/ios-app-design.md` | daily-driver features gated on desktop tracks; attach = GT-5; artifact catalog/open = AH-5 |
| GT — Godview terminal | **IN FLIGHT** — GT-0…3 + **3v glass deck on 0.9.0** landed (spec v0.3, GT-D10…D12) | `specs/godview-terminal.md` | **GT-4** remote floor (⌘⇧O desktop remote panes = its test row; carries NF-remote) → GT-5 iOS attach |
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
fixture; `keystrokeEchoMs` report-only). GT-3v put the deck on ghosttea **0.9.0** and made it
glass: renderer-true semi-transparent panes over the blurred canvas (James's screen-composite
interim retired), appearance viewer-local per GT-D12 — 602 themes + shader catalog built from
upstream's exported data in our design system, persisted beside the layout, never in the
floor's config; the surface lab stays as the stage-tuning instrument. Next slice **GT-4**:
`with_terminal_mesh` behind config + `terminal.v1.hosts` + mirror-write v1 — the desktop
deck's ⌘⇧O remote panes are the test row, and NF-remote rides it.

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
legacy migration, and drainable ArtifactService shutdown underpin AH-3. `8c07bf4` now adds the
earned `hud.side-panel` slot, the visually canonical right-edge panel and top-right toggle, the
bundled browser-plugin catalog/Proxy/Folder flows, and the validated static `shell.*` broker on
Electron main's existing authenticated loopback client. No ProductAPI UDS, renderer relay,
artifact IPC, or renderer path textbox was added. Packaged discovery remains behind WP8's
signed bundled-plugin index; the final both-theme/reduced-motion/native-picker witness is owed.
AH-4's current implementation adds the internal-only bounded capture provider, a separately
serialized ArtifactService preview lane, one-shot permissionless same-origin Electron
WebContents, atomic 640×400 bounded JPEG replacement, monotonic revisions, explicit refresh,
placeholder fallback with a bounded thumbnail-read retry, and the image-only MagicDNS CSP
aperture. Refresh is non-idempotent and never replay-safe. Automated contracts/service/Electron/UI
coverage and production builds are green; the physical desktop-B fetch/refresh, Truffle
symlink/allow, and cross-origin witnesses
remain gates, so this work is not recorded in LANDED yet.

## Next up — the options on the table (James's call)

- **AH-4 closeout** — review and land the preview runtime, stage/sign the bundled browser
  plugin through WP8, then run the both-theme/native-picker plus desktop-B preview/refresh,
  Truffle symlink/allow, and cross-origin physical witnesses. AH-5 adds the phone list; the
  AH-1 physical two-client proof can run alongside this work.
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
- **AH-3 packaged-plugin discovery** — the renderer statically bundles `vibefield.browser`,
  but production fieldd deliberately receives an empty `plugins/bundled` root until WP8 builds
  the signed bundled-plugin index/stager. The panel reports provider absence honestly; do not
  call the packaged artifact path shipped before that distribution gate closes (2026-08-03).
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
- **G11 ghosttea petition candidate, unfiled** — `effects?: TerminalEffects` as `theme`'s
  sibling on `GhostteaWorkspaceProps` (0.9.0's viewer-local law is two-thirds implementable
  by a host without it; shaders ship honest-UNAVAILABLE meanwhile) + export
  `AppearanceSettings` or document data-only as the host contract (GT-3v, 2026-08-04).
- **`configEditor` bridge** — the 0.9.0 two-track editor seam needs `terminal.config.validate`
  (new product method) + three main-side file dialogs; GT-3's raw editor is the raw track
  meanwhile (GT-3v, 2026-08-04).
- **Surface lab is not dev-gated** — renders in production builds; field-app has no dev-gate
  idiom to borrow. James's call: gate it, keep it, or retire it after the visual pass
  (GT-3v, 2026-08-04).
- **`prefers-reduced-transparency` has no policy** — DESIGN.md has M6 for motion and no
  transparency stance; proposal in `440b04e`'s body (glass falls back to §5 tint at full
  opacity); the doc changes first (GT-3v, 2026-08-04).
- **Godview smoke reload rows are load-flaky** — 2/3 builder failures with a packaged app +
  dev session running, pass on retry with identical code; orchestrator passed under the same
  load. Pre-existing, not GT-3v's; watch it (2026-08-04).

## Eyeballs owed (James's standing visual passes)

- Widgetlab visual fidelity vs the original (thinking-widgetlab-port §5) — the D-track
  acceptance.
- Open an old board once; watch the C2 id-migration log line.
- Settings Plugins section (P2) · toggle widgetlab → placeholders swap LIVE + tray thins (P3).
- Mesh sync rows + the file pill's standing-state dot, both themes (C6-4).
- Artifact Hub list + Proxy/Folder native-picker/add/open flows, both themes and reduced motion
  (AH-3 closeout; runtime implementation `8c07bf4`).
- The Godview deck end-to-end (⌘G): the zsh first pane, the consent face after a session
  dies, the kill chip's two steps, Settings → Terminal editor with a live reload (GT-2e/3).
- **The glass pass (GT-3v)**: canvas ghosting through semi-transparent panes at the §5 SHEET
  tier · the surface lab's stage knobs · Settings → Terminal appearance section (theme
  catalog, shader cards incl. the honest UNAVAILABLE ports, opacity slider) · a theme +
  opacity change applying to an open deck live — then decide the lab's fate and the
  reduced-transparency stance.

## Upstream / sibling pins (the EL8 watch)

truffle `=0.7.12` (exact crates-io + exact platform sidecar packages; T2 consumed at AH-1) ·
ghosttea `=0.9.0` on all planes (GT-3v + IOS-EL8, 2026-08-04; preflight now also pins
`-electron`/`-react`) · chopsticks 0.1.4 · strata 0.10.0 (via ICE) · `@vibecook/ice` 0.2.0
(registry pin). G7/G8/G9 consumed at NF-7; G10 + G11 candidates named at GT-2e/3 and GT-3v,
unfiled; C7 implemented upstream, consumption rides AR. Full petition status:
`petitions/README.md`.
