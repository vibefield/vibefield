# VibeField — Landed-Track Ledger

> **Status:** append-only history. One entry per landed slice or track event, newest at the
> bottom. Entries are never edited after the fact — a wrong claim gets a dated correction at
> its source doc (the errata rule) and, if load-bearing, a new entry here. "What now/next"
> lives in `ROADMAP.md`; decision status in `DECISIONS.md`.
>
> Provenance: everything above the "Recorded retroactively" section is the header ledger of
> `draft/predesign-00-index.md` as kept 2026-07-21 → 2026-08-02, moved here verbatim at the
> corpus reorg (2026-08-02). The build-phase note was one running paragraph; it is split below
> at its top-level ` · ` separators only — no words were changed. Lives in main-tracked
> `docs/` (moved from `draft/` 2026-08-02); the entries' own corpus citations (`specs/…`,
> `thinking-…`) predate the move and resolve under `draft/`, which stays dev-local-only.

## The build-phase ledger (2026-07-21 → 2026-07-28)

- **Build phase note (2026-07-21):** P0 re-sequenced per James — **shell → truffle → ICE before agents**. Landed on main: **Track A walking skeleton** (991c0ac — Electron 43 shell w/ adopt-or-spawn fieldd, 0600 `run/shell.token` bootstrap contract, per-window token minting, `@vibefield/fieldd-client` + React hooks, live `system.health.subscribe` page, kill matrix green: native SIGKILL → honest disconnect delta → respawn re-pairs)

- **C1 truffle embed** (truffle-core 0.7.3 via [patch] lockstep pin; MeshUnit behind `FIELD_NATIVE_MESH=1` — disabled/starting/auth-required(authUrl)/up/degraded honesty through the M2 health shape; live probe verified: real Tailscale auth URL through the health stream in 1.8s).

- Also landed: **B1** Loro-wasm-in-Electron (3a785c1)

- **B2** canvas alive — plugin-runtime P0 + note plugin + Field view (0032331)

- **C2** mesh facade real — native.mesh.* backed by the truffle node (3c54d30)

- **repo hygiene** (27b6eba — CLAUDE.md, biome+rustfmt, `pnpm verify` gate, catalogs, preflight; + d40e500 reformat)

- **DESIGN.md** (1429e84 — art direction distilled from widgetlab; Apple/Figma bar, tokens/motion/component canon)


### Track D — the widgetlab port


- **Track D (the widgetlab shell port, `thinking-widgetlab-port.md`): D1** substrate + kit (153faf3 — @vibefield/shell-ui: CardShell/useDragLift/tokens; Tailwind v4 in the renderer; theme system .dark+data-theme; ground layer live; note→CardShell conversion; ice dist rebuilt, V-1/V-2 closed)

- **D2** the island (b26e214 — WidgetTray ported verbatim, catalog from plugin manifests (P-3: WidgetDecl.category/preview, WIDGET_CATEGORIES single source), recede+stage-hold, breadcrumbs + zoom pill, desktop vitest infra).

- **D3** the packs (54a8ad4 — the eight iOS cards as @vibefield/plugin-widgetlab (P-2 retypes) + @vibefield/plugin-field-tools (field.folder preview-portal container, field.comment + C-command) + shell-ui previewBackground from manifest data + field-engine.ts with the verbatim SCENE grid as the boot board + the RFC-004 drop-consume contract test green headlessly; SMOKE_CANVAS 11 widget types / 3 plugins).

- **D4** the GL shelf (66a137a — shell-ui GL kit (makeGlCardChrome/GlLiftGroup + the R3F JSX-augmentation type-import), 7 GL cards + the node trio into plugin-widgetlab (18 widgets; drei), full scene + seeded wires, FieldView GL composition (bridge/router/P2 plane/portal, PMREM env, idle preview capture, themed grid, Esc-exit), cursor halo, Settings/Inspector panels + ECS devtools, desktop test infra (localStorage shim; 12 tests incl. cursor-halo + panels); found upstream: published-d.ts ValueOf<> stays unevaluated → useWorldComponent inference lands on unknown — explicit type args at the seam, ice V-item filed; SMOKE_CANVAS 21 widget types / 3 plugins).

- **Track D COMPLETE — widgetlab parity code-done; the visual fidelity pass (thinking-widgetlab-port §5 checklist) is James's eyeball.**


### B3/B4 — persistence + doc UX


- **B3** (persistence under the board, `thinking-b3-docservice.md`) — DocumentService in fieldd (opaque ICE1 envelope store: `docs/{docId}/snapshot.ice1`+meta, atomic fsync'd writes, `field.docs.v1` registry, one-shot 192-bit lane tickets, single-writer lock) + the :9411 binary doc lane (D27 dual loopback WS; D5-shaped frame codec in contracts) + doc.create/list/open (M4 subset) + renderer open-or-seed boot (board fetched BEFORE first render; seed only when the registry names no bytes; ICE `docs.autosave` streams envelopes up the lane; honest degraded/quarantined states in the Settings System section) — **the P0 exit criterion holds: the board survives fieldd restarts, proven end-to-end headlessly (board-daemon.test.ts) and by quit-relaunch.** Landed with it: interlocked spine hardening (native-link subscription buffering + dial races, ProductApi listen races, supersede-before-listener bootstrap race — review findings 2026-07-21).

- **B4** (doc UX, `thinking-b4-doc-ux.md`) — the DocManager renderer spine (launch decision: last-open → most-recent → seeded default "Field"; per-doc lanes with the drain law; doc switching/creating/renaming), the loading pipeline (staged progress with the R3F preview capture moved OFF idle INTO loading, chunked ×3; the frost veil + thin colorless bar + honest stage labels, late-veil 120ms rule), the top-center **file pill** ⇄ docs-explorer sheet (M1 morph mirrored to the top edge, doc tiles as mini-field ground faces, --vf-select ring on the current doc), and `doc.rename` through contracts + DocumentService (label-only — updatedAt untouched). DESIGN.md §8 canon gained both components.


### C3–C5 — the mesh, P1


- **C3** (mesh.serve, `thinking-c3-mesh-serve.md`) — serving is real and EL7-safe: fieldd declares its product API as the first serve (tls:false plain-HTTP-in-WireGuard; declarative set replays on reconnect), the **tailnet door** on the one :9410 stack mints `{kind:"tailnet"}` principals from sidecar-injected WhoIs headers ONLY on the secret route path `/t/<192-bit>` (provenance proof — same-uid spoofers read UNAUTHORIZED; 6-test suite incl. THE spoof test), D32 scope preset (`TAILNET_SCOPES`, tokens.mint/native/push/plugins never federate), serve runtime stream (`native.mesh.serve.subscribe` over ProxyEvent; typed ProxyConfig with strip_prefix:false asserted + pathSecret structurally redacted from every wire projection; announce pinned false — no surprise broadcasts when upstream discovery ships), MeshClient fuses reconcile+runtime into ServeState for FielddHealth.mesh + the Mesh Settings section (capability URL visible there, never logged), native-link replay made per-sub tolerant (a refused replay no longer cycles the link). Deferred with gates: PeerLink dial + peer-fieldd principals (P1), DeviceService productEndpoint (P1/D31), artifacts (P2), plugin exposure (P2/D21), MeshData lanes (P2/D5); truffle petitions filed in thinking-c3 §4 (node-id header injection, whois(ip), QUIC identity, named dial, discovery).

- **C4** (DeviceService/D31, `thinking-c4-device-service.md`) — the device directory, P1-lite: the self-slice publishes into `field.devices.v1` on boot + on change (honest capabilities {terminalHost:false, docHost:true, push:false}; productEndpoint carries the FULL capability URL — recorded delta from the spec's serve-name-only, C3's secret-path requires it; url only while the serve is active), roster = slices ⋈ tailnet liveness (heartbeats defer with the spec's own verify-item), `device.list/get/subscribe` (scope workspace.read — in the tailnet preset), deviceId = the store's own device_id (D30; ZERO Rust changes — C2's facade sufficed) with a persisted local-uuid fallback for meshless solo fields (recorded deviation), the Settings Mesh section grew the devices roster (online = muted-grey fact, never an error).

- **C5** (PeerLink/D32, `thinking-c5-peerlink.md`) — the first device-to-device call: PeerLink dials a peer's capability URL from its slice (the dial side IS FielddClient — a peer's product surface speaks our own hello behind its tailnet door; no token, the door grants the D32 preset from WhoIs), one outbound link per peer + dial-on-demand + idle-close 5min + 8s deadlines, offline/unreachable/incompatible honesty ({device, state} UNAVAILABLE shapes; incompatible pins refuse-fast), the peer-fieldd principal via a hello deviceId CLAIM honored only on the provenance door (label-only, same preset, cannot escalate — retires with the node-id-header petition), the `device?` convention (D35) in ProductApi with the LOCAL scope gate first (no laundering) + self-strip + federated-subscriptions-are-P2 refusal, the roster folds live `link` states, two-daemon e2e proves the forward + the REMOTE scope gate (tokens.mint refused at the peer). Deferred: lower-deviceId-wins dedup, the federated subscription manager, idempotencyKey (P2/first-mutation).


### ESR — the electron-shell boundary refactor


- **ESR (the electron-shell boundary refactor, `specs/electron-shell-refactor.md` v0.2) — six slices LANDED 2026-07-22** (1b3b821 baseline · 903f5a4 contracts+fieldd-supervisor w/ 32-test adopt/spawn suite · 30c5bc2 @vibefield/electron-shell split w/ deny-by-default navigation + the tailnet-auth openExternal fix + walls enforced in preflight · 3b05564 @vibefield/field-app move (FieldHost seam; all NINE §8.1 walls at 0; apps/desktop = package.json only)

- c9e403d **the splash-gated boot** (design-03 §4.3 v0.3: initial graph 6.4MB→269.8KB raw/79.4KB gz, workspace lazy + bundle-asserted, frame-stability reveal, DESIGN.md §8 splash+reveal canon)

- 3a5b59a hidden-quiet (backgroundThrottling default restored, visibility-at-the-source, THE persistence-exemption test w/ real daemons)

- ca13f9e the settle-transform fix (a persistent reveal transform stacked the whole app below the z-40 drag strip — top-edge clicks died; now transient, pinned by boot-root.test)

- 47c08b9 **QA — external-review debts paid (2026-07-23)**: the shell suite was DARK since 3a (vitest inherited vite.config's renderer-host root → "No test files found"; the recursive test gate was red across 3a/4/5 while piecemeal suites + smokes stood in) — dedicated vitest.config unmasked 55 tests, walls --self-test wired into preflight (was red + unexercised since the R4 flip), bundle-report shell paths fixed + asserted; supervisor attempt-terminal child kill (a failed spawn can no longer orphan into a Retry or get misfiled "adopted"; 33 tests); the quit flow defers will-quit and AWAITS bounded dispose (void dispose() lost the TERM→KILL escalation); bootstrap mints once per webContents generation (§10 honored; StrictMode double-mint gone); FULL pnpm verify green incl. -r test — first time since 3a).

- 6711a17 **3b — FieldView decomposes** (703→144; the §5.4.3 units as hooks/components — session (twin-engine law verbatim) / persistence-controller / CanvasStage (GL disposal order made structural) / ChromeLayer / preview-warmup; the five-poll ledger paid: 4 polls → TRUE reactive subscriptions per 37ed2b2 (the delegated ICE mapping landed post-commit and disproved 3b's "no engine event API" claim — engine.step drives world.reactive.notify() each frame; zoom/tool via observeResource, crumbs via observeQuery + per-container title observeValue, ghost scan via archetype-move observeQuery; the interim chrome ticker lived three hours and is deleted — admission rule; hidden-pause is engine-loop-native), framing retry stays bounded-interval by the loading-path exemption; disposal audit w/ 2 fixes; canaries green throughout; field-app 50)

- f6bf0d5 **6 — the close** (README table → ESR layout; §14 ticked 45/48 with evidence, 3 deferred w/ owners).

- 0ccf7d1 **3a-fix — the plugins' CSS returns** (James's field report: DOM widgets off vs widgetlab — styles.css's four-hop @source globs rode the 3a rename to a home they resolve ABOVE the repo from; every plugin utility class silently gone for a day; three-hop fix + per-source-tree CSS canaries in the bundle assert — the silent-CSS class's third strike gets a standing tripwire; +5.7 KB restored, eyeball vs original widgetlab = the acceptance). **ESR COMPLETE.** Follow-on slice named (review finding 4, sanctioned by §5.4.4): lazy widget factories + settings/diagnostics on-demand + open-doc-only preview reveal gating. Then: P1 multi-window (rides the WindowRegistry), the agent tracks, or deferred remote/CI — James's call.


### PLUG — the plugin architecture (P0–P7 + D29′)


- **PLUG (the plugin architecture, 2026-07-23 — James: plugins are THE user-facing extensibility unit): `specs/plugin-architecture.md` revised to v0.2** (the altitude ladder §4.3 A0–A5 · the canvas engine tier §12.7 — `ctx.canvas` speaks ICE's vocabulary, reads broad/writes gated, budgeted declared systems; the §8.2 widget vocabulary extended FROM the shipped built-ins (interaction/container/provides/ports — v0.1 could not express its own folder/nodes/GL) · authoring kit §5.4 (plugin-build/plugin-cli/create-plugin, ten-minute bar) · STAGED distribution: the git-hosted hash-pinned registry §5.3.1 gated by trust rungs §20.5 (R3 unreviewed stays fenced) · cross-device install-set sync §16.6 (D29 settings-doc slice; code never rides Loro — peer CAS fetch) · vibe-ctl taxonomy verdict folded: root `plugins/`+`tooling/`, PA-34 bundle staging, PA-36 import-map singleton resolution §11.6; turbo adopted only when pack/stage outputs exist).

- Landed on main: **L0** (8a625bd — `plugins/` + `examples/plugins/` at the repo root; @source globs re-pointed WITH the move, CSS canaries prove it; walls R10 report-only = the 70-hit P3 migration worklist; self-test enforce-table tightened to a NAMED pending set)

- **hygiene** (cb652e0 — `siblings.lock.json`: ice+truffle SHAs preflight-verified, `pnpm siblings:pin` = the deliberate upgrade event; closes the sibling-reproducibility hole)

- **P0** (contracts `PluginManifestV1` zod-first — §7.1 invariants in one superRefine, PLUGIN_LIMITS, CapabilityId, SafePreview (the legacy raw-CSS preview dies per its own D22 note), path/ID validators with `isDistributablePluginId` as the §21.2 gate; 4 golden fixtures + 17 refusal tests; TS-only, deliberately OUT of the Rust gen bundle (no plugin loader in field-native); plugin-runtime imports the contract (PA-3), the §21.1 legacy→V1 adapter (dev-alias ids honest until ratification, defaulted surface/props warned as P1's worklist), registry ownership = the §6.2 EXACT type map (split-lookup dead), every built-in V1-validates at register time; initial graph 326 KB raw — contracts schemas ride the boot chunk, subpath-export split named as the recovery lever).

- **C1 COMPLETE (2026-07-23, `thinking-p1-canonical-manifests.md`): all 21 prefabs are HOST-BUILT from canonical manifest data (§12.2)** — **C1a** (6be3e0f — build-widget.ts: WidgetContribution+binding→defineWidget, 1:1 post-P1a, memoized like the retired import side effect, ONE attested zod-optionals boundary cast; note = the first canonical manifest; registerV1 + the derived-legacy-view bridge)

- **C1b** (d61a547 field-tools: container/sweepContained as DATA · b697b63 widgetlab ×18, sonnet-converted orchestrator-gated: p.json JsonShape inners proven, ports as data, GL chrome/animated code-side, the .groups bypass re-routed through `widgets.get(TYPE)` with identical writes; crystal/cube rgba previews dropped by SafePreview law)

- **C1c** (85cbab5 — adapter + legacy shapes DELETED, registry registerV1-only, tray/silhouettes read V1 via safePreviewToCss; LegacyPluginManifest tombstoned in contracts until C2)

- **C1d** (9420026 — `vibefield.plugin.json` per plugin, emitted by plugin-build, freshness pinned gen:check-style; biome exclusion for generated canonical artifacts — one formatter per file: its generator). Census 21/3 held through every slice; James's eyeballs owed: todo-toggle/shapes writes + tray/folder-mini silhouettes.

- **C2 LANDED** (8f14350 — ids RATIFIED: vibefield.note · vibefield.field-tools.folder/.comment · vibefield.widgetlab.*; renamed across 31 files, artifacts regenerated, every id distributable; the doc-open migration rides use-workspace-session (probe-designed: fold-journal-FIRST kills the zombie-cell hazard — pinned test; comp:PrefabId values + comp:type:group names + pack markers + envelope prefabVersions; idempotent, honest fallthrough to quarantine); single-replica surgery stated honestly → **petition I5** (ICE in-band rename migration, before replica-everywhere); eyeball owed: open old boards once, watch the migration log line).

- **P2 LANDED** (106ce34, `thinking-p2-fieldd-registry.md` — **the registry is the truth now**: fieldd PluginRegistryService per §9.2 verbatim (size-capped parse-no-execute discovery, canonicalize-then-hash via plugin-build's OWN canonicalJson, install records atomic under fieldd/plugins/, first-discovered-wins duplicates with bundled-first §9.1 no-shadow, minimal contracts-range engines check, coalesced generation-stamped snapshots with problems[] by BASENAME — the §9.4 sanitized law); contracts grew plugins.read beside plugins.manage (both local-only) + the six §22.1 methods (rest deliberately undeclared, D36) + PluginRecord/Snapshot TS-only shapes; the renderer SUBSCRIBES (plugin-registry-store, board-status pattern) and buildRegistry filters the static trio by the snapshot SAMPLED at doc-generation boundaries — no snapshot ⇒ all bundled (two-plane law); Settings gained the Plugins section (sonnet-built, DESIGN.md ritual). **Disable semantics ratified by the delegated ghost probe**: docs.open is ghost-tolerant (unknown-type cells skip projection, survive export byte-for-byte; ok:false unreachable via unknown types) — the one consequence is a board saved-while-enabled reopens READ-ONLY while its plugin is disabled (meta pack markers; envelope prefabVersions is vestigial for gating) → surfaced as the new "readonly" board state with NO persistence bind; P3's missing faces (§12.4) are the planned lift; strata's per-attach unknown-component console warn filed as an ICE-petition candidate beside I5. Tests: fieldd 93/93 (opus 12-test registry suite + scenario fixture roots, orchestrator-reconciled — oversize generated at test time) · field-app 53/53 · verify exit 0 · SMOKE_CANVAS 21/3 · bundle 327.9 KB. FOUND: apps/desktop never rebuilt fieldd dist — the smoke ran a stale daemon that refused the new scope at mint; build:shell now chains build:fieldd, the whole entry-point class inherits it. James's eyeballs owed: the Settings Plugins section, plus C2's standing three.)

- **P3 LANDED** (9b16648, `thinking-p3-sdk-and-leases.md` — **the SDK is the door**: `@vibefield/plugin-sdk` (defineRendererPlugin + the P3-subset ctx — absent APIs ABSENT, never stubs; /ui curated design-kit re-exports; /canvas the curated ICE render vocabulary + getWidgetType; /testing activateWithMockHost w/ its own suite); all three plugins converted to `activate(ctx)` renderer modules (sonnet ×2, orchestrator-reconciled; GL chrome/animated payloads verbatim; deps collapse to sdk+contracts); the §10.3 host harness (§12.1 validation, activation-once, thrown-activate retries at next board open, async-activate honestly refused until the §19.2 staged loader); **the §11.2 lease**: plugins.openRendererSession (registered/enabled/hash checks w/ §22.5 pluginKind details; principal-kind gate — clientKind is a hello CLAIM, restrict-only; TTL'd TokenService mints; custom x.* caps never become bearer scopes, test-pinned) + renderer plugin-bound clients (credential in module closures, in-flight-guarded renewal; 9-test opus suite). **The face layer (§12.4/§11.4), forced by ICE's process-permanent catalog into a better design**: present plugins ALWAYS register real schemas (boards stay WRITABLE — pack markers satisfied; enable/disable round-trips in-session) and the FACE follows the live snapshot — disable → preserving placeholder IMMEDIATELY, re-enable → real face returns; failed activations register face-only widgets (real schema, honest error); per-widget error boundaries (GL → null, DESIGN.md GL placeholder = named follow-up); envelope-header ghost stubs register truly-ABSENT types at the doc's own pack version (absent-plugin boards open writable, content byte-preserved). **Supersedes P2's read-only for every plugin case** (readonly stays as the schema-newer belt; the P2 eyeball becomes: toggle widgetlab → placeholders swap LIVE + tray thins). **Wall R10 ENFORCES** — plugins import only the SDK; scripts/+test/ subtrees exempt (authoring-time); self-test exemption+gated fixtures; EXPECTED_PENDING={}; all ten walls at 0. Gates: verify exit 0 · SMOKE_CANVAS 21/3 · bundle 328.3 KB · fieldd 102/102 · field-app 53/53. Recorded deltas (thinking-p3): ctx canvas/commands/settings = P4+; sync-only activation + per-plugin chunks + ctx.plugin hashes await the staged loader; openRendererSession windowId/ownership awaits multi-window.)

- **P4 LANDED** (05a4ca8, `thinking-p4-service-host.md` — **services are alive**: the §14.6 exact-map ServiceRegistry (registration = namespace ownership + exact-match both directions + ajv compile at register; the §14.4 pipeline with sanitized INTERNAL provider errors and schema-invalid OUTPUT refused; §14.5 DynamicSubEvent snapshot|delta|unavailable w/ first-snapshot deadline + invalid-frame drops + provider-loss honesty); ProductApi routes x.* to the dynamic path; **plugin principals real** (plugin-bound grants carry pluginId → hello derives {kind:"plugin"}, D20 from the mint — the delegated suite CAUGHT the P3 lease minting unbound grants that sailed through custom-cap gates; fixed, pinned); custom x.* caps bind via registry grants, service leases = granted ∩ SERVICE-ELIGIBLE (§15.2), local UI passes custom gates (recorded v1), non-loopback refused; **the worker host** (plain-ESM harness — Worker entries can't ride the TS transform; minimal env EL7; manifest-sourced declarations, never worker claims; §10.4 hung-activate termination; §18.2 deactivation order; **the §18.3 ladder verbatim proven end-to-end**: crash→1s→crash→2s→third-in-window QUARANTINED → re-enable clears; §16.5 disable deactivates+withdraws; §9.3 service entry states LIVE in the registry snapshot via overlay); **examples/plugins/kv-service** (sonnet-built, the first service plugin: get/set/watch under x.vibefield.example.kv + custom cap; proven dev-linked → worker activation w/ workspace-linked SDK → live deltas over the product surface; §7.1's onStartup invariant (background+backgroundReason) caught fixture AND example independently). fieldd 128/128 · verify exit 0 · SMOKE 21/3 · bundle 329.3 KB. Deferred honestly: host:"process" + product-method provide (reverse RPC), MCP projection §8.7, endpoints §17.3, audit sink.)

- **P5 LANDED** (5037546, `thinking-p5-settings-storage.md` — **settings and storage are real**: scope-routed backends (user JSON awaiting its D29 doc slice · device config.json atomic · secret via the SecretStore seam — darwin keychain, injectable, values NEVER on disk/wire-to-non-owner/snapshots); declared-keys-only + ajv both directions; the GENERATED pane (opus, DESIGN.md ritual — schema-driven controls, secrets never echo, defaults un-persisted, no optimism); plugin KV w/ typed PLUGIN_QUOTA_EXCEEDED quotas + traversal-proof opaque keys (files DEFERRED to the ticketed lane — EL2; storage.file.* undeclared, D36); **§15.4 revocation LIVE** (revokeByPlugin + dropPluginConnections on disable; data survives §16.5); SDK ctx.settings/storage present-iff-storage.self, ONE createStorageSurfaces in both hosts; kv-example persists through it. TWO delegated-suite catches (four slices running): buildRow dropped contributes.settings — the whole feature dead until one line (7 reds → 19/19); and Node type-stripping ERASES-never-RESOLVES — dev-source workers died on the contracts graph's extensionless imports → harness .ts-retry resolve hook + clean execArgv + stdio piped to daemon logs + fieldd-client param-property removal (+ TS7056 again → named-reference annotations). fieldd 147/147 · verify exit 0 · SMOKE 21/3 · bundle 340.3 KB. Co-landed: LOG-track console→logger migrations (hunk-entangled, attributed). Deferred: files lane, portable secrets, P6 grant UX, pane live-sub.)

- **P6 LANDED** (0ac7a7c, `thinking-p6-remaining-powers.md` — **the remaining powers: the grant ceiling P2 stubbed is REAL, and every §17 power rides it**. Per-capability grants (§15.2/§15.4): the algorithm in CONTRACTS (registry-as-code) — requested ∩ entry-kind eligibility ∩ persisted device-local decisions, denials VISIBLE as deniedCapabilities, never a silently thinner list; plugins.grants.set cascades LIVE (grant generation, leases die at the mint table, connections sever, children die, service restarts with exactly the post-decision scopes, endpoints withdraw, MCP re-projects); enable never resurrects a revoked cap; grants UX (opus — risk-badged custom caps from the DECLARING plugin, honest reasons, no optimistic flip, §15.3 dev-linked note). Supervised processes (§17.1): ProcessService the only door — EL7 env strip proven against a smuggling plugin, process groups, term→grace→kill, on-crash ladder w/ clean-run reset, children die no later than fieldd; the P5 caller matrix on process.*; ctx.process iff granted; E2E through the real worker chain w/ disable→ESRCH. Endpoints (§17.3, opus): mandatory health w/ immediate first probe, dead endpoints VISIBLY unhealthy never dropped, ownership-before-existence, v1 app-only exposure (mesh/mcp refuse honestly). MCP (§8.7/§17.4, opus): contribute projects DECLARED methods through the router's callProjected (schemas from declarations; declaring IS the opt-in); consume = stdio newline-JSON-RPC (real children, same env law) + Streamable HTTP (SSE → honest UNAVAILABLE); sanitized snapshots still schema/transport-free — runtimes read a daemon-internal declarations map staged through reload. Dev reload (§18.5): validate-WITHOUT-disturbing then atomic apply; id-change/incompatible/schema-REGRESSION refuse with the live version untouched (the v1 dev-linked rollback story); full principal recycling. Commands + surfaces (§8.3/§8.4/§13, opus — the runtime was GREENFIELD): SDK command/surface APIs, ctx present-iff-DECLARED, spine registries (ownership, provenance-logged invoke, contained throws, disabled plugins refuse to act), ⌘K palette per DESIGN.md, hud.attention/hud.panel LIVE behind §11.4 boundaries (godview.* binding refuses); **THE SEAM CUT: ChromeLayer's direct field-tools import is dead** — C-key + palette invoke vibefield.field-tools.comment-around-selection through the registry, import-boundaries proves field-app imports nothing from plugins/*; widgetlab dogfoods a hud.panel surface. FOUND: §15.2 eligibility made the P3 lease fixture honest (no entries ⇒ no grants). Recorded deltas: ctx.canvas engine stopgap (requested-caps gate; PA-27 retires it), windowId "field", v1 arg-less invocations, sync resolveSetting bridge. Gates: verify VERBATIM exit 0 · fieldd 191/191 · SMOKE 21/3 · bundle 347.1 KB/95.0 KB gz · boundaries CLEAN. Dogfood beyond note/field-tools/widgetlab BLOCKED on products existing (tracks A/C) — recorded, not attempted. An opus agent died mid-slice on a network error and was RESUMED with ship-incrementally orders — the four-agent split held.)

- **D29′ ratified (2026-07-24, James):** the settings doc is a doc in FULL — persisted, synced, AND undoable; app preferences join it (spine keys, same scope vocabulary). Three laws before P7 writes the first byte: undo covers user-scope only and says so · **undo never re-escalates** (grants/install-set outside the stack; undoing a revocation requires the explicit grant flow) · horizon = compaction epochs, honestly stated. Provenance stamped per write (agent-turned knobs get attribution + rollback as a safety rail). Amended in design-03 §7.2 + plugin-spec §16.6/§28; `storage.settings.undo/redo` joins the P7 contract surface.

- **P7 LANDED** (3e3c534, `thinking-p7-distribution.md` — **distribution is real, and D29′ shipped with it**: the deterministic STORE-only `.vfplugin` (§27.10 byte-stability proven; the reader is the install security seam — all-validated-before-any-write, typed traversal/symlink/method refusals; declared root-level entry modules auto-included with refuse-at-build); Ed25519 index signatures over EXACT bytes (§27.9 v1 RATIFIED minisign-class; unsigned never installs) + the fixture-registry builder; fieldd `plugins.install/uninstall/updates.check` — signature → engine gates → sha256-vs-signed-pin (mismatch discarded, never partial) → staged unpack → fieldd-written provenance sidecar → §9 re-scan, full P6 principal recycling around every mutation, "registry" as a third source class (dev links outrank same-id installs), updates user-initiated only (EL3 stands); **PA-36's worker half real** (installed artifacts resolve the SDK through the harness singleton hook); **the D29′ system settings doc — fieldd's first live Loro doc**: P5 user-JSON migrates in once, provenance-stamped durable writes, `storage.settings.undo/redo` with the three laws MECHANICALLY enforced (no-undo: origin exclusion probe-proven — a revoked grant survives interleaved undos; honest daemon-lifetime horizon); **the §16.6 install-set + reconciler**: doc-seeded desired entries install/activate/honor-revoked-grants on boot (the exact synced-in shape), local mutations publish back best-effort, dev-linked/sideload never sync; the manager UI (opus — source/rung badges §20.5, sole-button updates flow, data-preserving vs destructive uninstall, the undo affordance; DESIGN.md +4 §8 canon). DOGFOOD: the real kv-service example through the whole chain. FOUND: the packer omitted root-level declared entries (the e2e caught it); the smoke caught the packaged-daemon loro-wasm crash (externalized); fieldd-owned roots are created, not reported. Deferred w/ owners: sideload (post first-party publishing), peer-CAS + revocation-bias merge + doc replication (doc-sync track, 27.11/27.12), the public index repo (James's op), per-section undo/⌘Z/timeline, R2 host:"process". Gates: verify VERBATIM exit 0 on the committed tree · fieldd 206/206 · SMOKE 21/3 · bundle 349.6/95.5 gz. Union commit; LOG-track co-landed w/ attribution.) Next per §21: the plugin track's §21 slice list is COMPLETE (P0–P7). Options: the ESR follow-on · the agent tracks (A) · mesh P2 (doc-sync lanes — unlocks D29′ replication + peer-CAS + the §16.6 cross-device story) · LOG-L5+ · the public registry op; James's call.


### LOG — the spec revision (implementation entries below)


- **LOG (logging & diagnostics hardening, 2026-07-23): `specs/logging-and-diagnostics.md` revised to v0.2** — the codebase review CONFIRMED §4.1 wholesale (fieldd's 11 console sites · the supervisor's unbounded partial-line buffer, a live memory bug · field-native spawned `stdio:"ignore"` against a dev-only fmt subscriber · stdout ready-line = the supervisor contract · ctx.logger = console passthrough); v0.2 folds: `FIELD_LOG_DIR` under the registered EL7 prefixes (an unregistered VIBEFIELD_* would ride into agent PTYs exactly in the modes that honor it) · contracts SUBPATH exports + boot-chunk assert (the P2-named recovery lever, triggered) · the explicit Rust-gen subset LOG-42 (the P0 deliberate-inclusion precedent) · the pinned method catalog §14.2.1 (diagnostics.query/subscribe · lease.create/list/revoke · audit.append for shell-originated audit · native.diagnostics.* on mgmt) + scopes diagnostics.read/manage + audit.append excluded from TAILNET_SCOPES · composite per-producer cursors · the in-house segment writer (bake-off cut — nothing off-the-shelf does size+day+count+age+category-cap with an untouchable active file) · tail-in-rejection preserved · slices renamed LOG-L0…L6 (bare L0 is a landed PLUG name). §22 plan re-sequenced: pre-slice hygiene (cap the supervisor buffer — two lines, doesn't wait for the package) → **LOG-L0→L2 the hardening core NOW** (both daemons own their evidence = the logging analog of the P0 exit criterion) → LOG-L3 + thin L4 (ctx.logger persists w/ provenance; quotas/quarantine deferred) → L5/L6 GATED (viewer = product/distribution moment; audit rides the agent tracks; LOG-39 packaged gates await the CI remote). Implementation not started.


### C6 — the MeshData byte plane (mesh P2)


- **C6 (mesh P2 — the MeshData byte plane, `thinking-c6-meshdata.md`): C6-1** contracts + lane control surface

- **C6-2** the Rust bridge (`meshdata.sock`, pairing auth, lane table, routing, teardown — local half proven against a LoopbackTransport)

- **C6-3a/b** fieldd's `MeshLaneLink` incl. the orphan buffer (bytes for a lane whose mgmt announcement has not landed yet are held and replayed on claim, never dropped)

- **C6-3c** (502c9a6) the QUIC primitive proven on a REAL tailnet — ephemeral nodes, per-run app_id, key read from gitignored `.env` and never printed

- **C6-3d** `TruffleLaneTransport` + `serve_inbound` + `native.mesh.lane.subscribe`: **two field-native daemons, one lane, document bytes across a real tailnet with record boundaries intact** (`tests/quic_lane_transport.rs`, gated + `#[ignore]`d). A lane IS a QUIC stream (half-duplex; two-way sync is a pair of lanes); the LANE_OPEN header goes out inside `open()` because `accept_stream` does not fire until the opener writes; inbound lane ids are minted locally from a 2^32 base (JS-number-safe) so a peer cannot choose keys in our table; the announced peer is resolved from the WireGuard-authenticated address, NEVER from the stream's own header (EL7). **C6-3 COMPLETE** (3e 722d021 silent-loss paths closed · 3f c8ff394 doc-sync storage half — re-framing + the epoch fence replacing the revision-chain check · 3g 01c1870 `DocSyncService` routing — **an edit on A appears on B**, never echoed back · 3h 8c24960 content-addressed records + the HAVE exchange — a lane costs a digest, not a document · 3i 9dca91c the pinned-not-just-fixed audit; F-C6-22 measured: a vanished peer surfaces in tens of seconds to MINUTES).

- **C6-4 LANDED (2026-07-28, `thinking-c6-meshdata.md` §9 — the honest sync UX):** per-doc sync state DERIVED from facts, never set (retires the F-C6-16 class structurally; closed a live instance — a broadcast that reached nobody read "in step") — `in-step`/`syncing`/`pending`/`peer-offline`/`peer-declined`/`epoch-stale` as `DocSyncStatus` in contracts (TS-only) + `doc.sync.subscribe` (doc.read, local-only, always registered — empty list = honest quiet, no `solo` state: absence IS the statement); `pending` = the peer's HAVE digest names records we don't hold (§8's "settled ≠ complete", knowable without decoding); reachability roster-FIRST (WireGuard seconds beat QUIC minutes, F-C6-22 mitigated-not-fixed; known-offline peers not dialed) + a returning peer RE-GREETS every waiting doc (open the laptop ⇒ docs converge); renderer `doc-sync-store` + Settings Mesh sync rows (verbatim reasons, offline peers named from the roster, "last exchange HH:MM:SS" as the only freshness claim) + the file pill's standing-state dot (never flickers for routine traffic) — DESIGN.md §8 gained both canon entries. **Corpus correction:** "`field.docs.v1` is already a SyncedStore slice, so doc existence already replicates" is FALSE as built (only devices ride the store; the registry is a local JSON file) — a peer's unknown doc renders honestly as declined/"not held here"; existence replication is a named open follow-up. Gates: verify exit 0 · SMOKE 21/3 · bundle 355.1/96.7 gz · fieldd doc-sync 25 · field-app 74 · contracts 138. **The C6 spine (1–4) is COMPLETE**; James's eyeballs are owed the Mesh sync rows + pill dot in both themes.

- **C6-5 LANDED (2026-07-28, thinking-c6 §10 — federated subscriptions/D35):** the `device?`-on-a-subscription refusal REPLACED by the FederatedSubscriptionManager — one ref-counted upstream per {device, method, canonical-params} over the new `PeerLink.subscribe` (same deadline + one `mapPeerError` failure law as request; links with standing subs PINNED against the idle sweep; `dropLink` fans onDrop to owners); ProductApi's sub-forwarder rides the same wire shape as a local subscription, params forward WHOLE (the remote self-strip serves them), local scope gate before routing, and the REMOTE gate held e2e (`doc.sync.subscribe` through the proxy → FORBIDDEN_SCOPE at B — doc.read outside TAILNET_SCOPES). Recovery two-tier: socket blips/peer restarts = FielddClient's OWN replay-with-fresh-snapshot (P5 — "reconnect ⇒ re-snapshot" cost zero machinery); LINK deaths (a unary 8s timeout dropping the shared link) = manager re-subscribe + re-snapshot-everyone + capped backoff, retired at last detach. Every attach RE-SNAPSHOTS the shared upstream (fresh subscribe, old retired FIRST — correct for incremental topics; a stale delta can never follow the snapshot that supersedes it). Outage = QUIET per design-04 §6 verbatim (the roster carries liveness; the proxy never invents rows). Deliberately NOT built: the multi-peer merge/re-batch fold — arrives with the first topic that has rows to merge (agent.subscribe, D33/D37); recorded. Coverage split per C5's recorded divergence: ProductApi hop unit-level, upstream leg two-daemon e2e (B's roster snapshot through A + a live delta + quiet after dispose + the sweep pin), link-death recovery unit-only (the C6-3 coverage-note class). Gates: verify exit 0 · SMOKE 21/3 · bundle unchanged · fieldd 284 · zero contract shape changes (D35: routing, no new planes).

- **C6-6 LANDED (2026-07-28, thinking-c6 §11 — the artifact hub): C6 IS COMPLETE.** `artifact.publish {name, target: port|dir, allow?}` → an `artifact-<slug>` serve COMPOSED beside the product serve (its secret never enters the service) → tailnet URL back; `field.artifacts.v1` a local JSON registry replayed on start — "re-serving is re-creating", proven across a real fieldd restart with the mock playing the outliving field-native; list/subscribe fuse the C3 live verdicts at read time; publish/unpublish scope artifact.publish (tailnet preset per design-01 — D35 makes remote publishing one `device?` away), dir targets refused-fast when not a directory (dir serving itself needed ZERO native work — C3's build_serve_config always had it), tls:false per the product serve's own reasoning, an unreadable registry moves aside `.bad-<ts>` and never takes boot down. FOUND while wiring: the supersession closure could reach the service before its initializer (TDZ crash in teardown under an early takeover) — construction moved above it. **DEFERRED with a named gate: the CAS blob store / deny-by-default pull root** — truffle-core ships FileTransfer but the mgmt surface has no file methods; the facade is its own contract+Rust slice, and the consumers (canvas blob refs 03·A C-5, peer-CAS §27.11) don't exist yet (A7). No dedicated UI (the C3 deferral stands; Settings Mesh shows artifact serves automatically). Gates: verify exit 0 (SECOND run — F-C6-21's audit-integration flake struck a third time under load, green in isolation; the deflake is now the track's oldest debt) · SMOKE 21/3 · bundle 356.1/96.8 · fieldd 294 (artifact suite 10). **The whole C6 mesh chapter is closed**; next: the agent tracks, the ESR follow-on, LOG-39 CI, the F-C6-21 deflake, or the doc-existence-replication follow-up — James's call.


### T1 — truffle identity surfaces + EL8 graduation


- **T1 CONSUMED, part 1 (2026-07-28, `draft/petitions/T1-truffle-identity-surfaces.md` — the upstream resolution report + dual-repo audit; truffle 0.7.9 released):** **EL8 graduation (7fcdfd2)** — truffle-core is an EXACT crates-io pin (`=0.7.9`); the `[patch]`/siblings.lock/preflight-SHA/CI-clone machinery retired, the repo builds standalone (ice's 2026-07-25 move completed for cargo; a new petition window restores the machinery from history).

- **C6-fix (c02af69) — T1 §6's keyspace bug, verified against the sources then killed:** PeerInfo.id (the tailscale node id) and the roster ULID were joined against each other at two sites — every remote device read permanently `online:false`, and **C6-4's roster-first F-C6-22 mitigation was INERT since landing** (this ledger's "mitigated" claim was overstated until today; it is true again). Fixed: `PeerInfo.deviceId` declared (was untyped passthrough), `DeviceInfo.tailscaleId` projected, `tsByUlid` the one lawful bridge, doc-sync liveness fed in the dial keyspace (uncorrelated devices contribute no row — absent, never a guessed key); mock `meshPeers` populated for the first time anywhere, and the new roster-fusion test pins the join with deliberately different ids. Gates: verify VERBATIM exit 0 on exact HEAD · device-service 8 · doc-sync-service 25 · contracts 141 · parity 9.

- **T1 remaining, named:** node identity headers on the tailnet door with the C5 hello-claim as fallback → drop the claim at fleet-v3 → `node.whois` replaces the `resolve_peer_by_ip` scan + populates the peer-list `whois` field (v3 sidecar required for answers; pre-v3 fails fast).

- **T1 CONSUMED, part 2 — C6-T1 LANDED (7bc61a9, same day):** the tailnet door mints peer-fieldd principals from the sidecar-injected `Tailscale-Node-Id` through the roster correlation (`DeviceService.deviceIdByNodeId` — the same ULID⋈node-id mapping the C6-fix join rides); a contradicting hello claim loses silently, the C5 claim survives as the MIXED-FLEET FALLBACK only (absent header = old sidecar, never anonymous; **its deletion gate is fleet-v3** — the one T1 item still open), clientKind still decides the KIND (the node id proves which device dialed, never what software). The lane plane's `resolve_peer_by_ip` asks `node.whois` FIRST (one keyspace with the registry scan it fronts; scan = fallback, `unknown:<ip>` = the honest miss), and `peers.list` populates `whois {login, deviceName, tailscaleId}` best-effort — absent on any failure, never synthesized (EL7); live whois paths ride the `#[ignore]`d tailnet tests (the C6-3 coverage class). Door suite 9/9 (3 new T1 cases beside THE SPOOF, untouched); peer-link e2e proves the claim path intact.

- **EL8: truffle 0.7.11** (c4f679e — the sidecar protocol v4 reply broker: RPC answers correlate by wire requestId, retiring the value-correlated race class the C3 serve stack and C6 lane control ride; 0.7.10 never reached crates.io). Landed interleaved with the tray track (92258a1 — shared-tree discipline held: hunk-staged daemon.ts, worktree-gated, the combined HEAD verify exit 0).

## LOG implementation (L0–L6 + post-L6 hardening)

**LOG implementation update (2026-07-23; supersedes “Implementation not started” above):**
**LOG-L0 LANDED (`2e68650`).** The supervisor framer is
fixed-size at 64 KiB; dedicated logging/diagnostics contracts, the explicit Rust subset, eight
golden fixtures, registries, R11–R14 walls, boot-chunk assertion, and a versioned pre-writer
baseline are green. R11 pins 40 calls across 20 files to migration targets. Renderer initial
graph: 328.4 KiB raw / 90.2 KiB gzip, with both schema markers absent.
**LOG-L1 LANDED (`29aed0a`).** `@vibefield/logging` now owns bounded sanitize → queue →
ring → process-locked segment persistence; fieldd opens `system/fieldd.ndjson` before service
composition and all eleven fieldd console sites are typed events. Readiness stdout is control,
stderr/unexpected stdout are separate bounded emergency paths, and the shell no longer mirrors
routine daemon evidence. Rotation, retention, restart, symlink/permission, partial-write,
ENOSPC/EACCES/EROFS, retry/emergency, fatal-drain, ownership, and privacy cases are green;
accepted enqueue p95 12.000 µs / p99 22.458 µs with zero drops over 50,000 calls. R11 is 28.
**LOG-L2 LANDED (`2f2eb70`).** field-native opens `system/field-native.ndjson` before native
services and owns a bounded tracing → queue → ring → locked segment pipeline with reloadable
filters, stable host identity, strict per-producer sequence order, typed lifecycle/mesh/mgmt
events, and bounded drain. Process stderr and Truffle sidecar diagnostics enter structured,
sanitized records without capturing terminal bytes; the original descriptor is emergency-only.
Authenticated `native.diagnostics.query/subscribe` serves the bounded live ring at ≤10 Hz and
survives fieldd death plus replacement pairing. Rotation/restart/symlink/permission/fault,
privacy, exact-contract, real-process, and clean-room full-verify gates are green; native
accepted enqueue p95 11.667 µs / p99 24.708 µs with zero drops over 50,000 calls.
**LOG-L3 LANDED (`5037546` + `1d1b5ea`; track-entangled attribution).** The §22
Electron/renderer/utility implementation co-landed inside PLUG-P5 `5037546`: three
process-owned Electron streams, the bounded renderer MessagePort, the shared child-output
framer, lifecycle cleanup, and blocking R11. PLUG-P4 had already introduced the service
worker host; PLUG-P5 connected its stdout/stderr while the logging work shared those files.
The narrower `1d1b5ea` closure repaired that boundary so plugin worker output could never
enter `system/fieldd`, preserving the original ready-line protocol and bounded rejection tail.
**LOG-L4 LANDED (`7f3716c`).** Renderer and service plugin evidence now enters the two
host-owned plugin streams with live-registry install provenance, strict sanitization,
bounded queues/rings/retention, per-entry rate and severity reserves, visible drop summaries,
and R15 blocking at zero. Exact-commit `pnpm verify`, production build/bundle assertions, and
the real Electron canvas smoke are recorded in the logging spec's §24 completion record.
**LOG-L5 LANDED (`cd83c96`).** Privileged composite diagnostics now merges
the Electron, fieldd, plugin, and native live/history sources through bounded snapshot/deltas;
Settings loads the host viewer lazily; Node producers enforce expiring leases; Electron keeps
Crashpad local with a private retained manifest; and preview-gated support bundles default to
first-party evidence, second-scrub every record, and stream to an atomic user destination.
Full `pnpm verify` and the production bundle assertion are green on the implementation tree;
exact caps, suite totals, and honest deferrals are in logging §24.
**LOG-L6 LANDED (`5b9f9d7` + `cde0679` + `f7d56df`).** fieldd is the sole writer for
four private audit ledgers with attempt-before-effect policy, derived actors, bounded
sanitization, tamper-evident hash chains, durable close checkpoints, recovery markers, and
diagnostic-retention independence. Native producers now enforce diagnostic leases, and
support projection admits only bounded, verified audit records. Exact-HEAD `pnpm verify`,
the full fault/corruption matrix, the production bundle assertion, and the Electron smoke are
recorded in logging §24.
**POST-L6 REVIEW HARDENING LANDED (`f91c935`).** Audit hashes now cover the exact
schema-materialized base that is persisted; recovery markers retain original-ledger and
applied/rolled-back resolution; transport truncation is an explicit TS/Rust contract field;
and the sanitizer has a deterministic 512-seed arbitrary-graph property gate. The bootstrap
and native projection comments now state their real fail-closed/replay behavior. Exact-commit
`pnpm verify` is green; §23 records 31/32 accepted items with only the installed-platform gate
open.
Next: **LOG-39 packaged multi-platform CI**, plus the explicitly owned LOG-V5/V7/V8 decisions.

## NF — the native floor (NF-0…NF-5)

**NF (the native floor — PTY & process custody; the agent tracks' first chapter, 2026-07-29):**
James ruled bottom-up: custody laws first, proven by kill matrix, before anything above.
**`draft/specs/native-floor.md` v0.1** ratifies the custody table (every PTY the product
creates lives in field-native's embedded TerminalService; agent process BODIES native, agent
SEMANTICS fieldd-rebuildable-from-disk; fieldd is the only client of native authority),
decisions NF-D1..D10 (adopt-before-authority `observedBootId` proof · keep-until-exit as the
product default · sweep mechanism upstream (G7)/policy ours · self-client law · endpoints ride
the pairing hello · registries reach Rust by generation), and resolved G5/G6 WITHOUT petitions
(remote attach = the local daemon is the TSP1 client via `open-remote-session`; the correlator
= a fieldd-side ancestor walk). Upstream graduated same-day: **Ghosttea 0.6.0 released on all
three planes** (six crates on crates.io in PUBLISHING.md order, npm ten at one version, SwiftPM
URL package) carrying truffle `=0.7.11` — EL8 lockstep holds in the published artifacts.
Landed on main: **NF-0** (`7a46a81` — the pin event's repo half: cargo `ghosttea = "=0.6.0"`,
ghosttea-client 0.6.0 + nine chopsticks-* 0.1.4 overrides, the preflight EL8 pin table w/
family-uniformity check) · **NF-1** (`919aef4` — hello ack carries `terminal
{controlSocket,frameSocket,authToken}` (NF-D8); `DesiredState.observedBootId` (NF-D2 shape;
enforcement NF-5); the five `terminal.*` methods under `terminal.attach`; SOCKETS +=
terminal-control/frame; **gen-registries-rs.ts** emits field-native/src/registries.rs inside
gen:rust, freshness-gated — the R4 drift class closed for the Rust plane; 4 fixtures, 2 strict
Rust roundtrips) · **NF-2** (`8e4f273`, opus subagent + orchestrator review — **the terminal
floor is real**: TerminalUnit replaces the stub (bind-then-serve, 0600 sockets, per-boot
memory-only token, EL7 strip from generated constants, TextEngine::discover off the boot path
w/ honest degraded), the NF-D7 self-client with file:line-cited protocol facts (LE-u32 frames,
bare-token auth, requestId 0 = event), inventory = events-as-hints + 1s list-sessions backstop
(NO session-created event exists upstream — spec amended), the classified-exit stop sweep
(`service-shutdown` → `ServiceTerminated`, sensitivity-proven), 5 un-ignored live-PTY tests;
cargo 96 passed / 4 ignored, verify exit 0 twice). **Five source-won divergences folded back**
into the spec, chief among them: `terminate` CAN stamp `service-shutdown` over the socket —
half of G7's justification retired, the admission race stands. **New upstream asks named:**
G8 (gate `serve()`'s unconditional "ghosttead ready" println to the embedder's stdout — pinned
in native_logging.rs meanwhile) · G9 (persistence in `SessionSummary`; a session-created event
retires the backstop). Known debt found en route: an uncaught async EPIPE flake in fieldd's
mcp-service child stdin under full-suite load (pre-existing, ~1-in-5). **NF-3 LANDED**
(`263dcd0`, same day — the fieldd seam: NativeLink captures the NF-D8 hello endpoints;
TerminalService holds the observed inventory (tolerant of the mock's generic snapshot), mints
D6 tickets, and drives create/terminate over `@vibecook/ghosttea-client` on Ghosttea's own
socket; the five `terminal.*` methods live with attempt-before-effect audit; NF-D6 free shells
(login shell, inherit-minus-strip — the `inherit` env mode exists upstream, so the law is
literal); `terminalHost` capability honest per D31; bootstrap keeps /superseded/ as the
takeover rejection even when it races the observed subscribe — found by the combined gate,
pinned by product-surface). **NF-4 LANDED** (`d61b6b6` — THE kill matrix as six first-run-green
e2e tests: PTY survives fieldd + adoption <2s + same-boot ticket equality · floor-crash
honesty + phantom-free re-arm · the EL7 env-smuggle through a real spawn (bait in
field-native's own env never reaches a PTY; HOME does) · epoch conflict through the ticket ·
bounded churn with zero residue; the 24h soak = the named LOG-39 CI gate). **NF-5 LANDED**
(`eeda540`, opus subagent + review — survivor authority: desired.set prunes observed ∖ listed
behind the `observedBootId` proof (sensitivity-proven: guard disabled ⇒ test reds), dials the
control plane BEFORE storing the set (an `{applied}` that lied is structurally gone), prune
source `"application"` wire-asserted; persistence re-policy verified ABSENT upstream and
skipped honestly — G9's scope grew to live re-policy; consumer notes for the AR track's first
desired.set recorded in the spec §12). **THE NATIVE FLOOR (NF-0…NF-5) IS COMPLETE** — the
custody law is a passing suite; NF-remote (TSP1 mirror via `ghosttea-truffle` +
`terminal.v1.hosts` + mirror-write posture) is the named follow-on, gated on a consumer
(Godview remote panes, P2). Sibling heads-up: ghosttea is at 0.6.1 (IOS-2's SwiftPM kit
consumes it; truffle rev identical) — cargo/npm pins stay `=0.6.0` until a deliberate EL8
bump, kit-pin and cargo-pin moving together. Next: **AR (the agent runtime — chopsticks in
fieldd over the landed seam)** · **TW (the terminal in the field — bridge, pool, widget)** ·
the G7/G8/G9 ghosttea petitions · the mcp-service EPIPE deflake — James's call.

## NF-6 — adversarial-review hardening

**NF-6 LANDED (2026-07-30 — the adversarial-review hardening): `4d94cf8` (Rust, opus agent) ·
`c2fddea` (TS+contracts) · `37cce3b` (the mcp EPIPE deflake, now DONE).** Two opus reviewers
swept the floor read-only (one compiled a drop-scope probe, one probed a live SIGKILLed
field-native); both concluded the custody architecture is sound and every failure lived in the
seams under one theme — a transport failure reported as something benign. **Four blockers
fixed, each now red-on-old-code:** supersession kept kill authority (NF-5 made it dangerous —
a dispatch-level `is_current_client` re-check closed the whole mutating class: desired.set,
mesh.store/serve, lane, diagnostics.lease) · a dropped events receiver could wedge a multi-
session prune (receiver lives the reconcile + `read_loop` discards not breaks; latent, proven
by a client-shaped unit test not the e2e, which passes even reverted) · a boot-time link blip
killed the inventory forever (`ensureStarted` re-arms on every connect, never boot-fatal) ·
`terminate`/`create` called transport death "already gone"/INTERNAL instead of UNAVAILABLE
(the `client.connected` discriminator). Plus honest `{applied}` failure counting, bounded
sweep+handshake, generation monotonicity, warn-damping, the EL6 result shapes
(TerminalListResult/SessionParams/TerminateResult). Refuted clean: token leakage (swept both
planes), the to_value panic, health-delta starvation, the ticket-token flake. cargo 106 (+6),
fieldd +2 blocker tests, combined verify exit 0. **The floor is now hardened as well as
complete.** Standing lesson in spec §10.7: a single-item test cannot see a multi-item bug —
the two nastiest latents both hid behind exactly that.

## NF-7 — the EL8 bump event (ghosttea 0.7.0)

**NF-7 LANDED (2026-08-01 — the EL8 bump event): `295fcef`.** Ghosttea 0.7.0 shipped with all
three petitions implemented from the drafted files (G7 to Design v1 rev 5's letter — four
adversarial review rounds, converged; G8 exact; G9 exact incl. the minor-9 gate and the
replica-null carve-out) plus a remote-reconnect epic on top of the drain. This slice consumed
it: pins `=0.6.0`→`=0.7.0` (cargo + npm + the preflight pin-guard; truffle untouched at
`=0.7.11`) · sweep() → `serve_managed` + `handle.shutdown(SWEEP_BUDGET)` with the honest
`DrainReport` (a requested shutdown is no longer a fake crash) · the native_logging stdout
allowance deleted (the law is absolute) · self-client announces control minor 1.9
(`session-created` = pushed hint; backstop 1s→5s belt-and-braces) ·
`ObservedTerminal.persistence` filled · NF-5's re-policy carve-out became a REAL apply path
(spec §5 order, one plane dial, the NF-6 refusal law, proven by a live set→observed roundtrip
test). cargo 106, combined verify exit 0. Petition files carry §Resolution records; same-day
sibling IOS-EL8 `ad891f0` kept one version across planes. **The G-petition loop closed
end-to-end — drafted → reviewed ×4 → implemented upstream → consumed — inside 48 hours.**

## GT-0 — the Godview terminal's first light

**GT-0 LANDED (2026-08-01 — the Godview terminal's first light): `f876cef` (opus builder,
orchestrator re-verified both proofs).** Track GT opened (spec `draft/specs/godview-terminal.md`
v0.2 — frame corrected by James: terminal serves the Godview + iOS remote, spine-owned, no
plugin/ICE coupling; experience reference = the chopsticks godview app; remote panes are
library-provided, the v0.1 deferral was refuted). The slice: ghosttea 0.8.0 across every plane
(zero Rust delta; ghosttea-electron + ghosttea-react join the tree) and `--spike-godview` —
fieldd create→ticket → `GhostteaElectronBackend` EXTERNAL mode dials the embedded floor,
`GhostteaWorkspace` renders over `vibefield-app://shell`, `claimExistingSessions` adopts the
fieldd-minted shell, `splitActive()` mints a second; verdict gated on the render backend
(webgpu), not React mount. Five findings recorded in the spec, one product-shaped:
**create→openTicket is not read-your-writes** (openTicket gates on observed inventory,
62-117ms behind) — GT-1 owes the contract. Spike exit 0 + verify exit 0, re-run by the
orchestrator; no daemon left behind.

## GT-1 — the bridge holds

**GT-1 LANDED (2026-08-01 — the bridge holds): `8faaefc` (opus builder, orchestrator re-ran
both proofs).** The create→ticket contract (mint rides create, nested audits — GT-0's
62-117ms NOT_FOUND race deleted structurally; the spike's retry loop removed as the proof) ·
the product Backend in electron-shell main (per-window lazy, supervisor unreachable by type
AND source, recovery ladder: ≤5 stored-connection rebuilds with backoff → ticket-expired →
renderer re-redeems; connects supersede ladders) · product IPC + one preload carrying the
world-spanning port forward · bridge staged as dist/main/bridge-entry.mjs (asar reads .js ESM
as CJS — packaging named it in both allowlists). The spike is now the PRODUCT path and it
SIGKILLs the bridge mid-run: SPIKE_GODVIEW then SPIKE_GODVIEW_RECOVERY with the SAME
claimedSessionId — the floor never noticed. Seven findings, one production-wide: **fieldd's
origin allowlist never admitted vibefield-app://shell — every production/packaged renderer
has been reconnect-looping against its own daemon** (bare 1008, no log; smoke-canvas fires
CANVAS_READY before the first fieldd round trip so it could not see it). Fixed, plus the
window token gains terminal.attach, fieldd's clean stop() now drops the floor client, and
GT-0's fake ghosttead speaks the real 0.8.0 protocol. fieldd 323 / electron-shell 335 /
field-app 75; spike + verify exit 0 re-verified.

## GT-2 — the control room opens

**GT-2 LANDED (2026-08-02 — the control room opens): `2105f17` (opus builder, orchestrator
re-ran both proofs).** The overlay is product UI: field-app/src/godview/ above the canvas,
control-room dark per DESIGN.md (motion M1/M3/M6, canvas stage held M5), NOT MOUNTED until
first open. ⌘G rides the shell's FIRST real application menu (built by role; the Godview
checkbox reads main's bit; ⌘W hands between window and pane conditionally — rebuild, not
poke, because Electron binds accelerators at menu-set) + a bottom-toolbar toggle; ONE state
bit owned by MAIN (flip semantics, no optimistic echo). The deck graduates the spike: splits
route through fieldd (keep-until-exit, not upstream's terminate-with-app), honest pane faces,
closeWindow closes the overlay, recovery remounts a fresh runtime. PF6 stated precisely:
hidden deck schedules zero render/GPU work (occluded-set filter traced through 0.8.0);
frames still decode — why reopen is instant. ONE harness now: the spike is deleted,
pnpm smoke:godview drives the REAL renderer — free shell, file-side-effect echo (a real
login shell ran the pasted command), claim-of-outside-session, close-pane-SURVIVES on the
floor, bridge SIGKILL + recovery on webgpu. Findings: claimExistingSessions is first-run-only
upstream → the product `sessionsToAdopt` rule (adopt what this deck has never SEEN) ·
⌘G's cost named (deck loses search-next while open) · deck-theme READS live --vf-* vars ·
the 340px empty-sidebar probe · headless windows cannot be typed into (the smoke shows its
window; real key events only) · terminal.list still lags for readers — assertions poll past
the window. contracts 154 / fieldd 323 / electron-shell 359 / field-app 89; smoke + verify
exit 0 re-verified.

## Recorded retroactively at the corpus reorg (2026-08-02, from git + the GT spec)

These landed after the GT-2 entry was written and never got ledger lines; full records live in
`draft/specs/godview-terminal.md` (§GT-2 findings) and the commits themselves.

- **GT-2b LANDED (2026-08-02, `79b758d`)** — dev parity: the bridge rides the dev runner, a
  fault face with a way back (found by James running `pnpm dev`; record in
  `specs/godview-terminal.md`).
- **GT-2c LANDED (2026-08-02, `5c59400`)** — only a transition is news: the deck stops
  remounting itself to death (James's second dev run; record in the GT spec).
- **GT-2d LANDED (2026-08-02, `f2334ae`)** — orphans are reaped, adoption wears a provenance
  label (James's third dev run; "do this GT-2d immediately so we never ran into this trap
  again"; record in the GT spec).
- **Desktop settings panel redesign (2026-08-01, `5b37b3e` + merge `0632699`)** — settings
  panel rebuilt per DESIGN.md; no ledger entry was written at landing.

## AH-0 — the Artifact Hub direction is ratified

**AH-0 DESIGN RATIFIED (2026-08-02 — documentation event; no runtime landing claimed).**
`draft/specs/artifact-hub.md` v0.1 now owns the product shape designed backward from desktop
and phone: a bundled-plugin artifact sheet in the existing morphing HUD island; Proxy
(loopback port + HTTP/HTTPS source) and Folder (native picker) creation; a safe global catalog
with previews; and exact Truffle-returned URLs opened by the system browser on any admitted
tailnet client whose OS Tailscale route is connected. Local Truffle v0.7.11 was inspected
through the Rust/JS/Go seam: proxying,
static serving, TLS/MagicDNS, WebSockets, longest-prefix routes, allow globs, and runtime events
already exist, so no new data plane is needed. At ratification the pass identified one narrow
upstream hardening gate: T2 would make static roots symlink-confined before Folder or
URL-served previews shipped; root-only Proxy did not wait.

**AH-0 PRESENTATION AMENDMENT RATIFIED (2026-08-03 — documentation event; no runtime landing
claimed).** James replaced the unimplemented bottom-island artifact sheet with a toggleable,
non-modal right-edge side panel and a 40px round outermost top-right toggle. The spine still
owns the stage, arbitration, motion, focus, and teardown; `vibefield.browser` still owns the
catalog and Proxy/Folder flows. The panel overlays without resizing, dimming, or receding the
field. Artifact Hub v0.4, plugin architecture, design-03, DESIGN, DECISIONS, and ROADMAP now
carry that one direction; no serving, catalog, permission, or Truffle decision changed.

**T2 LANDED UPSTREAM / RELEASED (2026-08-02 PDT; Truffle v0.7.12 — no VibeField runtime
landing claimed).** Truffle implemented the petition directly: `13a283b` raises the sidecar
and release floor to Go 1.26.5, binds static routes through `os.OpenRoot`, adds tri-state
fallback denial plus `STATIC_ROOT_INVALID`, and owns rooted handles across pending add,
post-drain teardown, and shutdown; `1466c13` completes traversal-shaped coverage. Release
commit `2cf5732` published the fix as `v0.7.12` / `truffle-v0.7.12`, and post-release main
`9588694` pins the checksums. The petition is retired without filing. VibeField still
exact-pins `truffle-core =0.7.11`, so this closes the upstream blocker but does not land AH-1b
or AH-4; those static routes activate only after exact v0.7.12 consumption.

Twelve AH decisions lock live-source semantics, one-node custody, public HTTPS, persisted stable
ports, private intent vs synced catalog, local-only mutation, spine-stage/plugin-actor
ownership, bounded URL-served previews, full-config reconciliation, the CAS consumer gate,
the static `shell.*` provider over Electron main's existing authenticated loopback connection,
and the browser's cross-port cookie boundary.

## GT-2e — one authority

**GT-2e LANDED (2026-08-02, `a3babb7` — builder + orchestrator re-verification).** The v0.3
design correction (James: "a bad design smell — why all these tricks?"), traced from a
`sh-3.2$` pane: GT-1/2 had made fieldd a second session authority in front of
`GhostteaWorkspace`, and every trick — ticket-rides-create as the deck's door,
`sessionsToAdopt`, the split interception, the `defaultShell: "/bin/sh"` hardcode, the mount
race itself — was compensation. Now (GT-D10/D11): the workspace is the ONE UI authority over
pane births through its own doors, exactly as ghosttea desktop and the chopsticks godview run
it; main resolves the real login shell + `$HOME` onto the connect IPC; `terminal.connectTicket`
mints the connection's one ticket; `terminal.create` stays the programmatic door
(iOS/agents/tests); and the FLOOR enforces persistence — ownerless `terminate-with-app` births
flip to `keep-until-exit` at `session-created`, native-side, so the law holds with fieldd
dead. Verdicts read from source, not assumed: `ownerId` IS on the wire (flip discriminator
sound); `programKind:"interactive-shell"` does NOT loginify (panes are non-login interactive —
G10 petition candidate: `defaultPersistence` + a login/default-args knob). Smoke carries the
tombstone (`paneShell:"/bin/zsh"` via `$0`-echo through the workspace's OWN door) and the
G9→flip→observed roundtrip. Verify + smoke exit 0, re-run by the orchestrator. Full record:
`specs/godview-terminal.md` (GT-D10/D11 + GT-2e findings).

## GT-3 — the deck remembers

**GT-3 LANDED (2026-08-02, `af316db` — builder + orchestrator re-verification).** Restore
(GT-D8 as amended: the settings-doc REFUSED the manifest — user-scope-only law — so layer 2
IS `paneMeta` `{cwd, title}` in ghosttea's own layout doc; the fieldd device-scope manifest
waits for a reader): consent gate once per deck MOUNT before the workspace may exist —
`dead === 0` mounts silently, `dead > 0` shows honest counts with **restore**/**start clean**,
an unlistable floor mounts unarmed; `onRehydratePane` births replacements through the
workspace's own door at each pane's recorded cwd (GT-D11 governs them). The kill affordance
(GT-D5): a two-step overlay chip through fieldd's audited `terminal.terminate` — close still
detaches. The `config.ghostty` rider: `FILES.TERMINAL_CONFIG` registry → `with_config_path`
on the embedded service (missing file = valid empty overlay) → fieldd `terminal.config.
read/write` over the floor's OWN document API (atomic revision-checked replace + reload +
broadcast; scope `settings.manage`; audited by bytes+revision, never contents) → Settings →
Terminal raw monospace editor (deliberately not a form), loader verdict honest incl. `ok:true`
WITH diagnostics. Debts paid: the GT-2c deck-mount fixture (11 tests) + `keystrokeEchoMs`
report-only (measured 3ms). Measured findings: a pane's cwd is an OSC 7 **URL** (host kept
verbatim for GT-4); the spawn dir is never reported (no-OSC7 shells restore at `$HOME`);
consent is per-mount, not per-generation (a bridge rebuild mid-decision blanked the face);
config-document commands are NOT gated native-side (`settings.manage` gates the product door
only — GT-D6 posture restated); pre-existing NF debt flagged: the terminal unit self-reports
`starting` forever in `system.health` while serving. Smoke rows: silent rejoin same-ids,
consent `{saved:2,alive:1,dead:1}` with nothing mounted before the answer, `$PWD`-echo at the
recorded cwd, two-click kill → `exited` face, config write with REAL import-chain diagnostics
(the user's own Ghostty shader warned) and every session surviving. Verify + smoke exit 0,
re-run by the orchestrator. Full record: `specs/godview-terminal.md` (GT-3 findings).
The governing design docs and DESIGN.md carry the fold-backs; C6's as-built record carries a
dated forward correction for name-only reconcile, failed-removal retry, health URL/storage
health, folder port zero, the too-narrow VibeField serve facade, and Truffle list's missing
config echo. AH-1 now pays those serving debts through fingerprinted ids and exact v0.7.12
consumption. `shell.*` scopes and main's recovering ProductAPI client are landed, but its
callable bidirectional provider half is not; AH-3/4 own that bridge.

## AH-1 — durable live serving

**AH-1a/1b SERVING IMPLEMENTATION LANDED (2026-08-02, `9f80f0c`; physical second-client
field proof remains open).** The product contract is now v2 source-local intent: caller-minted
ULID, title, HTTP/HTTPS loopback source or realpathed Folder + optional `/index.html` fallback,
allow globs, stable 10000–19999 listener, exact returned URL, safe status, and one-window C6
adapters. Mutation left the tailnet preset and rejects `device?`; update, unpublish, refresh,
`RESOURCE_EXHAUSTED`, limits, golden fingerprint/port vectors, and Rust-generated schema parity
land together.

fieldd now fsyncs a private v2 intent file, migrates C6 once with evidence retained, separates
technical serve identity from title, fingerprints the complete TLS/allow/two-route config, and
serializes durable remove-before-add work. Failed removals survive restart; NOT_FOUND converges;
stable ports never silently drift; source probes recover independently from Truffle's sticky
runtime errors; artifact health carries the exact URL rather than the product secret and folds
storage health. Folder and Proxy both declare an empty, T2-confined preview mount ahead of the
root source route; capture deliberately remains AH-4.

field-native now carries `serveId`, display name, listener port, source scheme/fallback, mixed
routes, TLS, and raw listener inventory across the management seam. The workspace exact-pin is
`truffle-core =0.7.12`; desktop packaging exact-pins all five published 0.7.12 platform sidecar
packages and stages the current executable beside field-native. The staged Darwin arm64 binary
matched Truffle's published SHA-256
`ac8431894bb8c3685b47721fb869183de504e6e963191a1ce34ffa9ab8077a2c`.

Proofs: contracts 159/159; full fieldd 344/344; full Rust workspace green plus clippy/fmt;
Truffle `packages/sidecar-slim` Go suite green; package staging green; contract/fieldd
typechecks and targeted formatting green. The ignored real-tailnet tests still require an auth
key, so HTTP + HTTPS Proxy and Folder opening from a second desktop/phone is carried explicitly
as the remaining AH-1 field witness—not silently claimed. AH-2 still owns the synced global
catalog; AH-3 the desktop sheet/shell provider; AH-4 capture; AH-5 phone UI.

## AH-2 — one validated global catalog

**AH-2 LANDED (2026-08-03, `9c17c46`; artifact-hub v0.2 folds back the AH-D6 as-built
amendment).** `field.artifacts.v1` is now the public SyncedStore
catalog it was designed to be. ArtifactService publishes a whole origin-owned self slice after
durable intent, exact Truffle URL, boot, preview revision, or coarse availability changes; a
store replay republishes the same local truth. `artifact.list/subscribe` now return the global
`ArtifactView[]` union, sorted by recency/title, with tick-coalesced authoritative snapshots.
Mutation remains local and source intent remains private.

The reader is hostile by construction: encoded bytes and count are gated before entry parsing;
one malformed entry drops alone; owner/id mismatch, HTTP, credentials, query, fragment,
non-root path, and ports outside 10000–19999 never project. Tolerant future fields are narrowed
before cache/ProductAPI, so injected paths, ports, schemes, allow-lists, native errors, and raw
URL claims cannot hitchhike. Same `artifactId` from two origins remains two composite keys.
Missing authenticated host binding keeps safe metadata but strips URL/openability; a known host
mismatch drops the entry.

DeviceService now derives `tailnetDnsName` only from `PeerInfo.whois.deviceName` after T1's
ULID→Tailscale-id join; it never enters the peer-authored `DeviceSlice`. Remote availability
folds offline first, then origin boot, then advertised state; self uses exact fresh serving
truth. Truffle can remove a departed peer's store slice, so fieldd retains only validated public
remote rows in `field.artifact-catalog-cache.v1.json`, bounded to 256 origins. `peerRemoved` or
snapshot absence cannot silently erase user objects; an explicit empty valid origin slice does.
A future device-retirement policy owns stale-origin GC.

Proofs: contracts 161/161; fieldd 349/349; full 16-project TypeScript graph and workspace test
graph green; generated-contract parity clean; targeted Biome and diff checks green. The
two-daemon stack row proves add, colliding identity, update, source-status transition,
whole-list subscription, and remove. Hostile vectors plus restart/replay tests prove caps,
narrow projection, origin binding, boot/offline folds, and retained safe metadata. This is a
mock transport proof, not the still-open AH-1 physical second-tailnet-client witness. Next:
AH-3 desktop sheet + Electron-main shell provider; AH-4 capture; AH-5 phone.

## AH-1/AH-2 — review hardening closes the trust, bound, and lifecycle gaps

**AH-1/AH-2 REVIEW HARDENING LANDED (2026-08-03; artifact-hub v0.3 fold-back).** The
post-implementation review found one blocker and eight coupled lifecycle/load debts. The
blocker is structurally dead: a DeviceSlice is admitted only when its claimed `deviceId`
equals the SyncedStore owner, and DeviceService narrows every retained/projected field, so a
peer-authored extension can never become transport-derived DNS, Tailscale id, or link state.
The real-daemon proof carries the exploit through ArtifactService: the poisoned matching URL
remains metadata-only and non-openable without WhoIs DNS.

The opaque-store path now has one contracts-owned `MESH_CONTROL_LIMITS` registry generated
into Rust: artifact slices 256 KiB, device slices 64 KiB, 256 remote origins plus self, native
management frames 80 MiB, a 64-message/96-MiB native outbox, and a 128-MiB ProductAPI
projection/queue ceiling. field-native filters known public
store sets/snapshots/deltas before management projection; NativeLink rejects an unterminated
oversize frame without quadratic string concatenation; ProductAPI caps individual/queued
output and sheds a slow connection so reconnect can re-snapshot. Raw artifact URLs are checked
before WHATWG normalization and admit only exact lowercase HTTPS root-authority spelling with
a canonical decimal AH port—percent escapes, backslashes, protocol case, normalized paths,
and alternate port spellings join the hostile fixture.

Catalog snapshots now checkpoint the reconstructible cache once, asynchronously and serially,
with in-flight changes coalesced; subscription snapshots coalesce on the next event-loop turn;
self no longer steals one remote-origin slot. Native store subscriptions return a real local
disposer. ArtifactService disposal detaches callbacks, rejects queued-but-unstarted mutations,
then drains already-running work and the final cache checkpoint; daemon shutdown closes NativeLink
before awaiting that barrier, and the post-bind bootstrap scope rolls ProductAPI back if
artifact initialization fails.

Preview directories are prepared only after durable publish intent. After listener removal,
preview cleanup must succeed before final intent deletion; failure keeps the absent row as the
durable retry record and stays visibly `removing`. Legacy migration isolates canonical
validation per row, so one malformed Go glob cannot reject bootstrap. Final proof: focused
fieldd hardening 54/54; full fieldd 361/361; contracts 162/162; field-native 114 passed with
four explicit benchmark/real-tailnet ignores. All-target field-native Clippy, Rust formatting,
targeted Biome, TypeScript typechecks, generated registry refresh, and diff hygiene are clean.

## AH-3 — desktop artifact panel and shell-provider bridge

**AH-3 DESKTOP IMPLEMENTATION LANDED (2026-08-03, `8c07bf4`; packaged-plugin discovery
and the physical UI/native-picker closeout remain open).** The spine now owns one additive
`hud.side-panel` stage and the outermost control in its existing top-right cluster: zoom,
theme, then a 40px round Artifacts toggle. The fixed right-edge panel uses the established
sheet material, radius, left-cast shadow, dark tokens, focus ring, 600ms island motion, and a
reduced-motion branch. It stays non-modal and overlays the field without resize, recede,
backdrop, or stage hold. Expanded-surface arbitration, Escape, focus return, plugin loss,
hot reload, and the exit transition remain host responsibilities.

The new statically bundled `vibefield.browser` renderer contribution owns the product UI behind
public SDK doors. Its exact manifest grants are `artifact.publish`, `workspace.read`,
`shell.dialog`, and `shell.open`. A subscription-driven one-column catalog renders bounded
validated `ArtifactView` rows, 16:10 previews/placeholders, honest status words, exact external
open/copy, local rename, and two-step removal. Add stays inside the panel: Proxy accepts only
HTTP/HTTPS plus a local port; Folder invokes a native directory picker and renders only the
basename, never a filesystem textbox or full path. Mutations are serialized and catalog truth
is never guessed optimistically; provider loss and invalid-static-root errors stay actionable.

Electron main's existing authenticated loopback `FielddClient` is now bidirectional. A
shell-bound bootstrap token derives the `shell-main` principal only when binding, loopback, and
client kind agree. fieldd owns one static, first-live-wins provider registry for
`shell.dialog.pickFolder` and `shell.openExternal`, validates both sides, carries a sanitized
transport-derived plugin caller, enforces deadlines/cancellation, withdraws on connection loss,
and audits only safe method/outcome facts—never URL, path, or token. Main re-registers across
reconnect, permits one parented directory picker, and opens only the contracts-validated exact
HTTPS URL. No ProductAPI UDS, renderer relay, artifact IPC door, or renderer filesystem access
was added.

Proofs: contracts 167/167; full fieldd 369/369; FielddClient 12/12; Electron 371/371; browser
plugin 5/5; focused host/panel 6/6; all touched TypeScript projects typecheck; the production
renderer build and targeted Biome/diff hygiene are green (the two plugin-SDK `void` warnings are
pre-existing). A live Electron development run confirmed provider registration, the exact
zoom/theme/Artifacts cluster, and the 416px right-edge overlay without field reflow. WP8 still
owns staging/signing bundled plugin manifests for packaged discovery, and James's both-theme,
reduced-motion, native Folder picker, and real add/open visual pass remains an explicit AH-3
closeout rather than an inferred claim. AH-4 adds preview capture; AH-5 adds the phone list.

## GT-3v — the deck turns to glass

**GT-3v LANDED (2026-08-04, `440b04e` — builder + orchestrator re-verification).** Ghosttea
**0.9.0** consumed as one EL8 event (Cargo `=0.9.0` + npm overrides + preflight guards — which
gained two rows that could previously drift silently; the event split honestly with IOS-EL8
`7c017f5` taking SwiftPM, no overlapping files). James's screen-composite interim (`b87927a`)
retired: 0.9.0 honours background alpha in BOTH renderer paths, so panes are semi-transparent
the renderer's way — ICE canvas → overlay glass at DESIGN.md §5 SHEET tier → transparent cell
backgrounds. Appearance is the VIEWER's (GT-D12): built from upstream's exported DATA (602
themes + revision, shader ports with license badges, honest UNAVAILABLE for rights-unclear
ports) in our design system, persisted in renderer localStorage beside the layout it
decorates — `saveAppearance` deliberately unwired (it patches the config document: a second
appearance authority, the GT-D10 smell) and `configEditor` a named follow-up (needs
`terminal.config.validate` + file dialogs). The surface lab survives as the stage instrument;
its pane-opacity knob is now a live handle on the real store. Verified in source: control
minor 13 unchanged both versions; PF6 holds under animated shaders (hidden deck schedules
zero frames). Smoke proves GT-D12 both ways: `glassPaneAlpha 0.82` at the renderer, unmoved
by `background-opacity 0.62` in the device config — the two homes never merged, which is what
keeps GT-5's phone from inheriting desktop glass. Petition material for **G11**: an
`effects?: TerminalEffects` sibling of `theme` (viewer-local shaders are blocked without it)
+ export-or-document `AppearanceSettings`. Verify + smoke exit 0, re-run by the orchestrator
under the same machine load that flaked the builder's reload rows (passed; flake is
load-correlated, pre-existing). Full record: `specs/godview-terminal.md` (GT-D12 erratum +
GT-3v findings).

## GT-3m — the swarm arrives, mocked

**GT-3m LANDED (2026-08-04, `7dea861` — builder + orchestrator re-verification).** The
reference app's agent monitor, ported into the Godview overlay and fed by an explicitly
labeled MOCK (GT-D13): `monitor/` + three views (swarm default · list · rain, matter-js
`0.19.0` exact) verbatim at the module boundary — a view stays a PURE function of
`{agents, parameters, actions}` that can reach no runtime, workspace, or terminal. Adapted
with reasons: agent colors hash into DESIGN.md §2.6 accent SLOTS (a free hue wheel can
collide with state meanings), the rain re-said in our state/ramp/accent tokens, the
reference TweakPanel folded into the surface lab, `--vf-accent-1..8` materialized into
shell-ui tokens (a doc-only set becoming tokens; DESIGN.md unchanged). Facet types decided
from source: the terminal half is REAL (`SessionSummary`; ghosttea-protocol newly declared +
preflight-pinned), the agent half mirrored AR-replaceable (three of four types live in no
chopsticks package; the fourth would drag the Node-plane runtime into the renderer graph).
`MockAgentField`: seeded, pure-in-tick, eight agents across the pinned providers plus one
unclaimed terminal, an exit at tick 24 and an arrival at 33 — it emits STATE so the real
classifier stays on the path. Mock actions acknowledge and mount nothing — structurally,
the stage holds no door. PF6 verified two ways (stage disposal; overlay causation). The
smoke's monitor row FAILS if the "preview — mock agents" label goes missing — the
honest-states law enforced by the harness. AR replaces exactly one module and deletes the
label. Verify + smoke exit 0, re-run by the orchestrator. Full record:
`specs/godview-terminal.md` (GT-D13 + GT-3m findings).

## Godview visual pass — James's hands (recorded at GT-3f close-out)

**LANDED (2026-08-04, `6646f1b`, James).** Godview matched to the chopsticks UI + per-mode
terminal themes: monitor views touched (list/rain/swarm + swarm parameters), the appearance
section renamed/reworked (`TerminalAppearanceSection`), ~1.6k styles lines and 47 token
lines. No ledger entry was written at landing; recorded here at the next close-out. GT-3f
stacked cleanly on it.

## GT-3f — the shaders wake

**GT-3f LANDED (2026-08-04, `7a76f4d` — builder + orchestrator re-verification).** G11
consumed the day it was drafted: EL8 0.9.0→0.9.1 (upstream's Rust diff EMPTY — crate moves
for the one-version law; the age gate needed transitional rows because 0.9.0 was published
the same morning — the "no transitional rows" note from GT-3v holds only for aged-out
versions). Viewer-local effects: shader stored as a NAME resolved through upstream's own
guard (a pinned catalog can drop a port → `undefined`, not a crash); **absent means the prop
is OMITTED** (conditional spread — an empty object would override a floor-configured shader
with nothing); the object memoized so `workspaceEffectsKey` is a safety net, not a crutch.
The four bundled ports are live §8 chips (one fieldset, one answer) with licenses always
visible; GT-3v's honest-UNAVAILABLE face is gone WITH a test asserting its words left the
screen — and an erratum: the withheld-upstream list (32 rights-unclear ports) had never
actually rendered before; it does now, with its reason, kept by a test. PF6 split honestly:
upstream's 0.9.1 suite proves the gate, our fixture proves the gate's INPUT (the deck
reports inactive under an animated selection). Smoke: `shaderEffect:"ghosttea:crt"` at the
renderer + the device config byte-identical — two-homes extended to effects, both
directions. The reload-row flake got a CONTROL: an identical no-shader harness failed the
same rows (effects exonerated by experiment); builder green on attempt 8, orchestrator on
attempt 3 at load ~14; the named real fix (wait on something stronger than a 60s console
deadline) is a standing debt. Verify exit 0 (field-app 199). Shaders are WebGPU-only —
stated in the copy; a backend-aware live UNAVAILABLE is a named residual. Full record:
`specs/godview-terminal.md` (GT-3f findings) + `petitions/G11-…md` §Resolution.

## Godview performance groundwork — James's hands (recorded at GT-3p close-out)

**LANDED (2026-08-04, James):** `a8fbc0d` — the ICE canvas STOPS under the open godview
(`useFrameFreeze`, ice 0.3.0's frame gate replacing the stage hold: no step, no systems, no
rAF; thaw resumes on clamped dt) · `846ec2c` — the renderer counts its own frames
(`perf/frame-stats.ts`: rAF cadence crossed with LoAF, overlay + test; the instrumentation
substrate GT-3p then consumed) · `855cd65` — one door: ⌘⎋ takes the godview toggle, Escape
goes back to the terminal. No ledger entries were written at landing; recorded here.

## GT-3p — the deck gets fast the honest way

**GT-3p LANDED (2026-08-05, `2e4c1e5` — builder + orchestrator re-verification).** GT-D14
(the transport warms at app-idle; sessions stay born on ⌘G) + GT-D15 (the no-regression perf
laws), measured: **cold open 443–524ms → warm open 36–45ms** across loads 8.7–59.4, replicated
by the orchestrator first-attempt at load 32 (443.9 → 36ms; `keystrokeEchoMs 2`; steady
`frameMs p50 8.3 / p95 8.8`). The slice's hardest find was its own bug, THE ONE-RUNTIME LAW:
main posts the MessagePorts once per attach, so two waiting runtimes split one control channel
and the deck sits dead at `starting` — closed both ways (await the in-flight warm;
`takeTransportForDeck()` owns the singleton), a fixture on each half. Swarm physics on a
fixed-timestep accumulator with a lab-tunable `physicsHz` (floor 15Hz — a matter-0.19
STABILITY limit: past `_baseDelta/frictionAir` the scaled air friction goes negative) and
interpolated render; damage-gated DOM writes; mock-tick memo; the lab perf readout consumes
James's frame-stats substrate and surfaces the live renderer backend (GT-3f residual paid).
The prescribed shadow-animation rebuild was STOPPED with numbers (46–80/255 peak channel
difference, geometric residue) — the two keyframes stay as measured exceptions pinned by a
source-scan audit test; the glow never violated the law (static blur, opacity/transform
keyframes — the brief's diagnosis corrected). Phase attribution varies with load (ticket-mint
vs connect leg dominant in different runs) — "profile the cold legs" stays open. G12 petition
material: upstream first-frame signal + a real `prepare()` (the device warm rides a
performance-measurement side door today). Landing drama, recorded honestly: the builder's
mid-run "failed" notification was transient — it reconciled with James's three same-day
commits and landed; a mistakenly-dispatched successor was stood down, its one unmeasured
counter-proposal (a σ-halving correction to the shadow A/B) preserved as a patch for a
measured retry. Verify + smoke exit 0, both hands. Full record: `specs/godview-terminal.md`
(GT-3p row + findings).

## GT-3p follow-on — the last filter animation goes

**LANDED (2026-08-05, `4019e9b`) — kept on merit, recorded with its governance.** The
stood-down successor committed, against two stop orders, a MEASURED completion of GT-3p's
deliberately-stopped item — and the evidence survived independent re-verification, which is
the only reason it stays. The original stop had measured the wrong construction (box-shadow;
its geometric objection was correct for box-shadow alone); the pre-blurred-layer rebuild —
silhouette geometry, dy offset, radius halved (2σ vs σ), alpha pre-multiplied against the
LIVE fill-opacity var — measured worst-peak 15/255, mean ≤3.4, against a self-comparison
control that also caught the harness's own first-pass bug (peak 230 from a logical-pixel
crop of a 2× bitmap). The GT-D15.1 audit test is now carve-out-free: NO keyframe animates
filter, anywhere, plus data tests pinning James's eight shadow values. Bonus finding,
correcting `2e4c1e5`'s note: reduced motion NEVER applied to these animations (media-query
specificity loss, verified in Chromium) — behavior preserved; the fix is a visible change,
so it waits on DESIGN.md §M6 (named debt). Residual: ~18 cached shadow surfaces (~160KB
each) traded for the per-frame gaussian. Orchestrator verify + smoke exit 0, first attempt
at load 18. James's eyeball remains the final authority — the revert is exactly two files.

## GT-3c — the physics leaves the main thread

**GT-3c LANDED (2026-08-05, `e69e849` — builder + orchestrator re-verification).** GT-D16
built: matter + the accumulator + drag springs (keyed by id — multi-drag survives) +
hit-tests in a module worker (the repo's existing Vite worker mechanism, zero config;
90.7kB chunk, same-origin, CSP `'self'`); frames as bare transferred Float32Arrays with a
generation header, idTable only on membership change, both-buffers-outstanding ⇒ dropped
not allocated. SAB verdict measured, not assumed: no crossOriginIsolation in the shell by
design, ping-pong shipped. Zero visual delta proved structurally (no className/style/aria
change in the view diff; interpolation unchanged, main-side). The substrate is VISIBLE —
`swarmPhysics: worker|inline|none` in the monitor marker, and the smoke asserts `worker`
in the packaged renderer. The `adoptCanvas` socket is held no-op, pinned by a fixture —
James's SDF/WebGPU renderer plugs in there in his own session. **The honest instrument
verdict**: frame counters cannot resolve this change (p50 pinned at 8.3ms — the display was
already at cadence; LoAF zero everywhere); the measured truth is the extracted core — 1.48
ms/s of main-thread work removed at the 30Hz default — and the value is the worker HOME,
exactly as GT-D16 predicted. Deliberate residuals: a dying worker leaves the field
motionless (logged loudly, not respawned — respawn would replay a world mid-gesture);
drag feel unchanged by construction, not measurement (physicsHz A/B stays James's judge).
Verify + smoke exit 0 both hands (orchestrator: first attempt at load 69.8). Full record:
`specs/godview-terminal.md` (GT-D16 + GT-3c findings).

## GT-4 — the mesh, in two halves

**GT-4b LANDED (2026-08-05, `3aa5ba1`) — the monitor opens the door.** GT-D17's design: the
⌘⇧O palette was upstream's UX, not ours, so remote sessions become MONITOR CITIZENS —
a `RemoteSessionField` composed beside `MockAgentField` behind the one source seam, honest
and empty with no peer serving; the "preview — mock agents" label narrows its claim to the
mock field so a real remote row never sits under a label calling it invented; and `select`
on a remote row attaches the ACTIVE pane through the workspace's own pane-session flow.
`enableRemoteSessions` stays off. Its post-landing recon (no edits after the done report —
the law held) found: at 0.9.x the library's write gate is named `readWrite`, so our
"mirror-write" is the config that feeds it; and a LATENT upstream defect — with the palette
disabled, a mounted remote pane that ENDS renders a "Browse sessions" button that does
nothing (`browseDeviceSessions` early-returns on the flag), fixable by handing the library a
browse handler that opens OUR monitor, which is GT-D17's own grain.

**GT-4a2 LANDED (2026-08-06, `39c1b1d`) — the pins meet upstream.** GT-4a's honest
no-landing verdict (`fd72e72`) proved the mesh dep was unaddable: every published
`ghosttea-truffle` pinned `truffle-core =0.7.11` against our `=0.7.12`, and two exact pins in
one range make the resolver refuse outright — the exact-pin law working as designed. The
orchestrator's step-back to `=0.7.11` (`d3bccc8`) was the wrong call to make unasked; James
resolved it from the other side instead, releasing **ghosttea 0.9.2** pinned to `=0.7.12`
with a changelog that names the law's purpose in the same terms ("a loud resolver error
rather than a silent type mismatch"). So `39c1b1d` reverts the step-back and bumps every
plane to 0.9.2, preflight's pin table gaining a `ghosttea-truffle` row. Kept from the
step-back's reasoning because it stays true: 0.7.11/0.7.12 are source-identical crates and
T2's real payload rides the Go sidecar (`@vibecook/truffle-sidecar-*@0.7.12`, never moved).

**GT-4a LANDED (2026-08-06, `0a2ac28`) — the floor joins the mesh.** The gateway keeps
owning the single truffle node and the terminal unit BORROWS it (`MeshHandle::wait_for_node`
hands out exactly the `Arc<Node>` upstream's constructor takes — that type equality is what
the pin event bought). `FIELD_NATIVE_TERMINAL_MESH` is off by default and degrades honestly
without the gateway: the floor SERVES, PTYs untouched, health quotes the gateway's own
reason, never a panic. Hosts publication writes no wire shape of ours — upstream derives its
store from the service name, and we hand it the name whose derived store IS
`STORES.TERMINAL_HOSTS`, asserted both directions. Mirror-write v1 maps to upstream's
`capability` (constant-time compare); `allow_tailnet_write` stays FALSE forever because
setting it short-circuits every viewer to read-write. EL7 holds by construction, with a test
binding the variable name to the stripped prefix class so a rename cannot smuggle the secret
out. **The kill matrix ran over a REAL tailnet** — three ephemeral nodes, re-run by the
orchestrator: beta saw alpha advertising one session, view granted and write REFUSED; gamma,
holding the capability, view granted and write ACCEPTED — an A/B control inside one 9-second
run, **with no fieldd anywhere**, which is §7's asymmetry proved from its positive side.
Security finding for the record: the installed sidecar at protocol v2 falls back to
hello-asserted identity, so a peer inside the tailnet can assert another device's id — it
needs sidecar v3, does not weaken the mirror-write secret, and gates the per-device-token
upgrade. Verify exit 0 both hands. Full record: `specs/godview-terminal.md` (GT-4 row +
floor findings). **[See the RETRACTION entry below — that security sentence is false.]**

## Correction — GT-4a's security finding is retracted

**CORRECTION (2026-08-06), load-bearing, so it gets its own entry per this ledger's law.**
The sentence above — "the installed sidecar at protocol v2 falls back to hello-asserted
identity… gates the per-device-token upgrade" — **is false**, and the entry above stands
unedited only because entries here are never rewritten. James read the claim and asked the
question that broke it: *why is the sidecar still v2?* It isn't.

The evidence, gathered after the question: truffle's sidecar source is at
`protocolVersion: 4`; the installed binary ships `whoisResult`; `truffle-core 0.7.12`'s
`TailscaleProvider` implements `whois` (`provider.rs:888`); and the terminal mesh calls that
same node (`ghosttea-truffle 0.9.2` `lib.rs:231`). The quoted diagnostic fires only on
`NetworkError::Unsupported` — a provider with NO WhoIs, which upstream's own test names as
"the in-process transports these tests run on" — and it appears **nowhere** in the probe log
it was attributed to. Live, both directions: the UA track's S1 probe answers self-whois on a
real tailnet, and since `authenticated_node_id` refuses a connection whose WhoIs is anonymous
or unavailable, the kill-matrix probe's peers attaching at all proves their identities were
**authenticated by tailnet WhoIs**, not asserted. Per-device tokens (GT-D6) are not gated on
any upstream release.

The process failure is the durable part: a subagent quoted an upstream diagnostic, and the
orchestrator published it into this ledger and the roadmap without grepping the artifact it
supposedly came from. Quoted evidence is a claim like any other and gets verified where it
allegedly appeared — the same rule already applied to gate results, now applied to citations.
**[See the RECONCILIATION entry below — this retraction's conclusion holds, its reasoning did
not, and neither it nor the claim it retracted ever named which binary they meant.]**

## Reconciliation — the sidecar question, settled by naming the binary

**CORRECTION (2026-08-07), the third and final pass on this.** Both the original claim ("the
sidecar is v2, identity is hello-asserted") and its retraction ("it is v3, peers ARE
authenticated") were true of DIFFERENT BINARIES, and neither said which. Verified by the
orchestrator: the repo **vendors** a whois-capable sidecar (`truffle-sidecar-darwin-arm64@0.7.12`,
Aug 2, three `whoisResult` hits) — so the retraction's practical conclusion **stands**, and
per-device tokens are not gated on any upstream release. But `resolve_sidecar` never looks in
`node_modules`, so dev and every tailnet probe load `~/.config/truffle/bin/sidecar-slim` —
**Jul 16, zero `whoisResult`** — which is why the builder's v2 diagnostic was real for the
binary it actually ran. The retraction's *reasoning* was invalid either way: "peers attaching
proves WhoIs authenticated them" ignores `authenticated_node_id(Unsupported) → Ok(None)`,
which falls through to hello-asserted identity; only `Anonymous`/`Unavailable` refuse, and the
orchestrator had quoted that very line while making the argument it refutes. Settled
empirically: re-running the probe with `FIELD_NATIVE_SIDECAR_PATH` at the vendored binary
drops the diagnostic to zero and stays green. **The live consequence is a test-fidelity gap,
not a security regression** — no identity conclusion drawn from any `#[ignore]`d probe
describes the shipped path until the harness prefers the workspace's own binary. Durable
lesson, the sibling of the one above: **a retraction is a claim too**, and this one was
published without naming its subject.

## GT-5 — the code review's findings, fixed

**GT-5a…d LANDED (2026-08-07): `127df5c` (evidence) · `95cbd7e` (product) · `69e8a99`
(renderer) · `17365fd` (native), four builders on disjoint planes; `pnpm verify` exit 0 and
`pnpm smoke:godview` green on the combined result, both re-run by the orchestrator, plus the
live five-node tailnet probe.** Every HIGH from the review is closed.

The evidence slice's acceptance was not "the row passes" but **"prove the row can fail"** —
and it was performed: with the recovery ladder commented out the smoke exited 2 at exactly the
right place, the bridge-down wait passing (the death is real) and the recovery wait timing out
carrying the deck's own words; restored byte-identical, exit 0. `recoveredBackend` now reports
`"starting"` rather than echoing the pre-kill backend, which is the proof it reads the
post-kill deck at all. It also fixed the superseded-ladder hang it exposed, and turned up two
findings by making the harness honest: **⌘W never worked** (Electron resolves
`explicit ?? roleDefault`, and `role:"close"` defaults to `CommandOrControl+W`, so omitting
the accelerator releases nothing — invisible for five slices because the menu was installed
after the smoke's early return), and **the persistence flip is not observable from the smoke**,
measured with a 50ms sampler that caught the precondition zero times, so the trail is reported
rather than asserted and the sampler carries its own anti-vacuity guard.

Three corrections the builders made to the orchestrator's briefs, all right:
`rollbackOnOutcomeFailure` does not cover a create whose nested mint throws (it fires only
when the outcome APPEND fails on a successful effect), so the fix is ordering; a session whose
mint failed is deliberately NOT terminated, because killing a live PTY to tidy our bookkeeping
is the worse outcome; and writability is worded as the host property it is rather than
suppressed pre-attach, because suppressing it would make a read-only host indistinguishable
from a writable one — the same class of lie in the other direction — with the mark stated in
BOTH directions, since silence is not neutral beside a mark. The renderer's peer-path fix went
deeper than asked: `paneMeta` stamps `remoteDevice` at the attach that made the pane, where
locality is certain, rather than reconstructing it from a hostname later. One item was
verified NOT fixable and escalated instead of hacked (G13). Full record:
`specs/godview-terminal.md` §9·A.

## UA-0 — the layout registry: one tree, one spelling, two languages

**UA-0 LANDED (2026-08-05, `fcd0af9`).** The UA track's first slice, landed hours after its
spec: `thinking-users-and-accounts` (James's OS-user framing) → `specs/users-and-accounts`
v0.2 → four-spike verification (S1 self-whois YES on pinned truffle 0.7.12 — UA-4 unblocked,
T3 demoted to optional; V2 N-resident-sidecars CLEAN with two recorded hazards; V3 ~85 MB
footprint per resident pair — resident-by-default folded into UA-D3; V4 vendor relocation
Claude-first with C-series asks recorded; V5 the users.json lock law, after exposing that
UA-D12's ephemeral ports delete the accidental fixed-port mutex UA-D10 was silently leaning
on) → ratification + fold-backs into design-00/01/02/03/04, artifact-hub, and logging — all
the same day. The slice itself: LAYOUT joins `registries.ts` as UA-D10's one authority (21
segment arrays composing SOCKETS/FILES basenames); `pnpm gen` emits `pub mod layout` plus a
committed `gen/layout.json` for plain-mjs consumers; `layout.vector.json` pins both
languages (contracts test + `tests/layout_vector.rs`). All seven census drift sites now
consume LAYOUT — supervisor `paths.ts` (sun_path guard intact), `bin.ts` (whose macOS-only
default-dir hardcode is fixed to mirror `config.rs` per platform), `daemon.ts` ×4,
dev-runner `product.mjs` (createRequire on the committed gen artifact — tooling has no build
step), support-bundle, preview-capture — plus the owner sites (doc/device/settings/artifact
services, the audit writer, crash, exports staging). Rust's `config.rs` derives every
data-root path through one `join_layout` over generated segments, and `mesh_bridge`'s
hand-typed `SOCKET_NAME` mirror now references the generated constant (the drift class it
apologized for is dead). Zero behavior change by construction; the boundary test scans
twelve consumers for eighteen join-shaped respellings. Finding worth keeping: `gen:check`
is `pnpm gen && git diff --exit-code`, so the freshness gate reds on UNCOMMITTED generated
output — stage gen artifacts before reading the verdict; and a `| tail` pipeline masks the
real exit code, so capture `$?` explicitly. Verify exit 0. UA-1 (user-shaped storage +
migration) is next; the segments are the migration's manifest.

## UA-1 — user-shaped storage: the tree moves under users/<fuid>, behind the lock

**UA-1 LANDED (2026-08-05, `ca1ce49`).** The migration slice, hours after UA-0 laid its
manifest. NEW `@vibefield/users` (contracts-only deps — a supervisor-package home would have
made fieldd ⇄ fieldd-supervisor circular; recorded delta: the §3.3 error kinds live on
`UsersError`, not `SupervisorErrorKind`): the users.json lock exactly as specced (O_EXCL
identity record; unreadable-FRESH is live and only >30s artifacts reclaim — the
segment-writer lesson, one directory up; migrate incumbents stretch waiters to 60s; a live
pid is never broken), mint-if-absent with the `"wx"` belt (losers ADOPT the winning ULID),
fsync'd atomic mutation publish preserving unknown keys, best-effort `lastAttached`, and
the flat-v1 → users-v2 migration whose move manifest **derives from LAYOUT's first
segments** — the registry landed in UA-0 is literally the list of what moves. Contracts:
`UserRecord`/`UsersFile`/`LayoutStamp` + `users.vector.json` (TS-only per design-01 §7's
no-native-consumer law — the spec's "both languages" fixture line lands as the honest
subset); LAYOUT gains the four root-level entries that never re-root. The exit ladder ran
green: **eight real child processes racing one empty root → exactly one users.json, one
ULID, seven adoptions**; broken-lock mint still exclusive; eight mutators, zero lost
updates; a 500-mutation torn-read storm, zero torn; stale/live/unreadable-fresh;
symlinked-root contention; migrate-vs-mint race refusing typed then converging;
kill-between-two-moves re-running to convergence; both-sides entries refusing typed;
smoke-injected roots refusing to mint. Integration stayed thin: main ensures right after
logging and roots crash/support/previews/the pair at `users/<fuid>`; the supervisor passes
`FIELDD_USER_ROOT`; standalone fieldd is its own supervisor (V5 scenario b is now real
code); the dev-runner resolves the pair root from users.json with a legacy fallback;
field-native changed **zero lines**. Verify exit 0 (captured explicitly). **OWED, named:**
the live dev-root migration witness — the first `pnpm dev` after this lands stops the
running pair and moves `.vibefield/dev/data` under `users/1/`; deliberately not run from
the landing session while James's stack was live on that root. UA-2 (identity threading)
is next; UA-6 (sync intent) is now unblocked in parallel.

## UA-2 — identity threading: the pair says which user it serves

**UA-2 LANDED (2026-08-05, `3750f20`).** The small slice that makes UA-1's partition
*verifiable*: `FIELDD_USER_ID` rides the spawn env; fieldd records the served user in
`product.json`, asserts it in every product hello ack (`userId: string | null` — null is
unconfigured, absent is a pre-UA-2 daemon), and carries it on the mgmt hello, where
field-native accepts it through the regenerated contracts with **zero hand-written Rust**.
The probe's user gate mirrors `expectedBuildId` but stricter: an absent `userId` is NOT a
match — a daemon from before the partition, or another user's stray, is never adopted
across the wall; with no expectation set, pre-UA-2 adoption keeps working (new
`ProbeFailure: "user-mismatch"`). The hello gate is restrict-only like `clientKind`: a
client MAY carry its expectation, a configured daemon refuses a mismatch INCOMPATIBLE
(terminal), an unconfigured daemon accepts anything. The tray gains the attached user's
name as a disabled row above service status (conditional — existing tray tests untouched);
the "`pnpm dev` shows the user label" witness rides James's next dev run, together with
UA-1's owed live migration. Fourteen tests pin the exits. Finding for the walls' honor
roll: **R7 caught this slice's own test** hardcoding port 9410 in a shape fixture — the
walls don't exempt tests, and that is exactly why they work. Verify exit 0. Next: UA-3
(link + Account page) or UA-6 (sync intent) — both open.

## UA-3 — the link lifecycle: self-whois captured, unlink retires, the user gets a face

**UA-3 LANDED (2026-08-05, three commits: `15832c0` core · `30aece8` UI · `96e9e9d` the
adapter line).** The first split-hands UA slice: the critical path (native surfaces, the
LinkService trust machinery, the profile IPC) built in the main checkout while an Opus
agent built the Account page against a specified contract in its own worktree — and the
integration surfaced exactly two findings, both real: field-app never touches
`window.vibefield` (wall R1 — the bridge lands on `FieldHost`, one adapter line), and the
page needed a READ door (resolved as one-door-two-verbs: an empty `usersUpdate` reads
without lock or write). **Core:** `native.mesh.self` (the S1 self-whois as a real mgmt
surface — absent-never-synthesized; the left-hand side of UA-4's comparison) ·
`native.mesh.retire` (pre-node-gate like lane control; `Shared.retired` kills the
login-completes-after-unlink resurrection race; archive rename with sidecar-death retries)
· fieldd's LinkService (capture honoring the §7.2 timing law; corrupt link.json pauses
capture and is never guessed over; unlink = audited native retire + record clear, local
bytes untouched per UA-D8) · `user.link.get/subscribe/unlink` on the trusted-desktop
posture · the `users:update` IPC end to end (sender-gated, lock-mutating, tray-refreshing)
· the `#[ignore]`d live S1 probe joins the tailnet test suite. **UI:** the Account page —
nav group above Preferences; Profile with the eight accent slots by NAME; the link block
rendering every honest degraded shape (env-gated mesh named as such; auth-pending with the
waiting face; linked with account/tailnet/time; two-step unlink carrying the relink cost);
posture cards; residency toggle; 8 tests + a11y-real radios. **The closed surfaces bit
twice, correctly:** the IPC-pin tripwire caught the thirteenth… twelfth channel, and the
UI agent's report caught the read-door gap before it shipped. Deliberately open: posture
writes refuse until UA-6's key lands (the page says so honestly); MeshSection's
authenticate-anchor dedup; the amber-vs-token error-text judgment call (flagged for
James's eyeball); mesh enablement stays env-gated — deriving it from link presence is a
named later chapter. Verify green on the integrated tree. UA-3w (the wizard) is the next
rung; UA-6 integrates when its worktree agent reports.

## UA-6 — sync intent: a doc that stays home says so

**UA-6 LANDED (2026-08-05, `a4bed08` worktree slice + `1a2a846` integration).** The second
worktree-agent slice of the day, integrated on a green verbatim gate the agent's own
machine could not complete (its run died at ENOSPC after seven green legs — the disk was at
~150Mi free; removing both agent worktrees post-integration bought back 4GB, and the 39G
main `target/` remains James's call). **What landed:** three gates in `DocSyncService` off
one injected `resolveIntent` — `#ensureLane` as the single outbound choke (commit fan-out,
HAVE answers, return lanes and re-greets all starve together), `#claim` declining
local-intent docs beside the doc-less refusal (repeated in `#receive` for intent flipping
under a claimed lane), and `onCommit` early-returning; `statuses()` omits gated docs (a
state row for a doc that can't reach any state would be the EL5 lie). Contracts:
`DocSyncIntent`, optional `DocRegistryEntry.syncIntent`, `doc.setSyncIntent` (doc.write,
local), the `mesh.syncPosture` app-preference key (default automatic) — which lit up the
Account page's posture cards the moment it landed — and `AppPreferenceSetParams.value`
widened to boolean|posture ("a key whose only settable values are booleans is a contract
that lies"). UI: the FilePill tile toggle + mesh-row "keep local", chips derived from the
REGISTRY, never the sync stream. **The side-find that outranks the slice:** a pre-existing
DocumentService registry write-back race — a commit captured the entry, did its I/O, and
wrote the CAPTURED copy back, silently reverting any concurrent column change;
`doc.rename` had the identical latent hole. Fixed with `commitRegistryColumns` and a test
that fails without it. **Errata, recorded at source:** spec §8's claim that the peer folds
`local-only` as `peer-declined` was FALSE (one-directional lanes; close reasons never
cross the wire; gate (a) forbids the return lane a decline would need) — the spec carries
the dated correction; cross-device decline visibility is a named record-kind follow-up.
**The two-agent interaction point fired exactly as predicted:** UA-6 hardened the
snapshot contract, the Account page validated correctly, and only its test fake lagged —
one line, caught by the gate on the first integrated run. Eyeball additions: the doc-tile
"local" chip + mesh-row toggle in both themes, and the posture cards now live.

## UA-4 — the door knows its own

**UA-4 CODE LANDED (2026-08-05, `105e6bd`).** The self/guest door: the tailnet hello
branch compares the WhoIs-verified peer login against link.json's stored login
(UA-D5/D13) — match ⇒ self (TAILNET_SCOPES unchanged; the principal gains `self:true`
and the transport `tailscaleId`), mismatch ⇒ `tailnet-guest` with an EMPTY grant behind
a choke that refuses every method without `guestOk` BEFORE every dispatch path
(shell-provider built-ins, system.unsubscribe, and the dynamic router included — the
scope check alone passes scope:null methods). v1 guestOk = `system.hello` only, pinned
by a registry lint. The comparison, not the clientKind, decides: peer-fieldd is not
exempt. No stored login = the pre-capture status quo (`self` stays ABSENT, never
false; activation is capture-gated per UA-D13). **The belt is real:** a dispatched
trace proved the Go sidecar enforces `allow` pre-header-injection, fails closed on
identityless peers, and covers the WebSocket hijack — and its two finds shaped the
build: the login is glob-ESCAPED (a literal in a `path.Match` slot), and re-gating a
live serve is REMOVE-THEN-ADD (the sidecar has no upsert — `PROXY_EXISTS` — and the
serve reconcile skips live ids). **Recorded C3 debt, deliberately not fixed here:**
mesh-client's reconcile-skip adopts a changed spec into reported state while the stale
gate keeps running — and a fieldd restart under leave-running native rotates the
`pathSecret` into the same skip; latent only while mesh is env-gated off; its own
slice. LinkService warns `fieldd.link.login_changed` when the trust root moves under a
live link; the migrated-link capture turned out already-built in UA-3 (probe-on-Running
writes link.json for a linked-but-recordless root). Six wire-level door tests over raw
ws with real sidecar headers; T1's tailnet-door assertion TIGHTENED to pin the
now-populated `tailscaleId`; typecheck exhaustiveness caught both principal-map sites
(audit `actorFor`, `ShellProviderCaller`) — fixed, not cast. **The exit stays open on
the two physical witnesses (James's hands): the S1 live probe (`cargo test --ignored`
with `TRUFFLE_TEST_AUTHKEY`) and the two-account guest refusal on a real tailnet —
that witness gates advertising ANY shared-tailnet login, full stop.**

## UA-3w — the field greets you

**UA-3w LANDED (2026-08-05, `1e27c7b` worktree-agent slice, cherry-picked onto main on a
green verbatim gate — no integration fix needed; the disjoint-file split held).** The
Setup Assistant: an `onboarding` boot phase held between `connecting-fieldd` and
`opening-document` — deliberately AFTER the workspace chunk resolves, so pane 3's "waking
the daemon / loading the field: done" claims are TRUE (W4 kept honest by construction,
`stagesDone` recorded as the machine passes each stage, never hardcoded). Five panes +
the migration variant render on the splash's own floor (a shared `BootGround` — the
wizard and the splash stand on literally the same canvas ground). W6 without a state
store, made concrete: color absent ⇒ Welcome; color + no link ⇒ Connect; link ⇒ the
posture question — with a bounded 1.2s beat for the link snapshot so a silent daemon
can't park anyone on a blank pane. The gate enters ONLY on a cleanly-read
`onboarded: false`; every failure mode (absent bridge, rejected read, bad shape) skips
and logs — the wizard machinery can refuse itself, never the boot. Supervisor side:
`mintOnboarded` rides mint AND migrate so the two can't disagree (smoke-like modes mint
true — smokes untouched); flat-v1 migration stamps `setupVariant: "migrated"`, and main
backfills the stamp for roots migrated before the field existed. Account extraction:
`src/account/` (link face, posture cards, AccentPicker) now feeds both skins — and
`account-section.test.tsx` passed UNMODIFIED, imports included. **Two honest findings,
folded into spec §6 at source:** there is no link-*initiation* verb on the daemon (the
pane's action IS the node's authUrl anchor, honest wait before it), and
"posture already answered" is NOT derivable (UA-6's effective snapshot always carries a
value) — a resumed linked wizard lands ON the posture question, preselected, never
fake-skipping to Ready. Tests: 14 wizard + 9 machine + 5 users + 6 backfill cases new;
306/28/406 green across the three packages. Eyeball owed: the fresh-root run-through and
the one-time migration-variant wizard on the next `pnpm dev`, both themes, keyboard-only.

## UA — the sun_path regression: the budget measures the longest socket

**FIXED (2026-08-05, `d6f8489`), found by James's first post-migration `pnpm dev`.** The
user tree's 8 extra path bytes pushed `terminal-control.sock` to 108 — past macOS
`sun_path` — so field-native could not bind either terminal socket: diagnostics said
native degraded / terminal crashed (honest states over a bind that never happened) and
the shell's connect died EINVAL on the same too-long path. The UA-D9 guard existed for
exactly this and passed the root anyway: it measured only `mgmt.sock`, the SHORTEST
name in the registry. Three layers now: `termctl.sock`/`termframe.sock` renames
(hyphen-less like their siblings; dev paths 99/101), the guard walks every
socket-bearing LAYOUT row at the true 103-byte limit naming the offender (pinned
byte-exactly at 103/104), and a 14-char socket-name lint in the contracts registry.
Sockets are ephemeral — no migration; the next daemon start binds the new names. The
spec's §1 miscalibrated citation carries the dated correction at source.

## UA-5 — the second user: the track's last rung

**UA-5 LANDED (2026-08-05, three commits: `cfe87b8` storage+channels · `f3aa78a` main
half · `e83033a` renderer half by worktree agent — split hands, clean picks, green
verbatim gates throughout).** The multi-persona field is real: `createUser` mints user N
under the §3.3 lock with the UA-D9 budget assert (a too-deep root refuses TYPED before
any directory exists, naming the socket); `users:list/create/switch` join the closed IPC
surface (fifteen-key pin); electron main holds a cached **PairBundle per user** — a
resident user's pair survives switch-away headless, the attachment wiring (observers,
shell provider, preview capture) rebuilds per switch — and `attachUser` is
build-before-break: the target pair answers `ensure()` before anything detaches, a
failed spawn leaves the current user whole. The module-let swap redirects every
late-bound reader without re-registration (the once-per-channel ipcMain law, honored by
reading the live attachment at call time). **UA-D12 landed in full**: ephemeral ports
unconditional in every mode — the recon trace showed the doc lane's fixed 9411 was the
FIRST-colliding bind and dev was ephemeral only by env inheritance. The tray grew its
Switch User submenu (one level of TrayMenuItem.submenu, recursive native mapping); the
Account page grew the Users block; the wizard grew the `second-user` variant (enters at
pane 2, ends in a zero-beat `finishing` — §6.2's substance kept, its pre-attach modal
frame amended at source: the variant rides the boot wizard through the
`setupVariant` passthrough stamp). **The audit exits ran on REAL daemons**
(`two-pairs.test.ts`): two full pairs under `users/1` and `users/2` of one root — four
distinct ephemeral ports, own-root sockets, both product planes answering health
SIMULTANEOUSLY, and users.json's mtime unchanged across the run (UA-D10 held
physically). The V5 accidental mutex has a tombstone. **Open, physical, James's:** the
kill-matrix switch row — a live session in user 1 survives switch-away-and-back
unnoticed — rides the first real multi-user session. Honest v1 bounds recorded:
crash/support evidence roots stay on the BOOT user's tree; an adopted non-resident pair
is not ours to kill; a partial bridge renders honest dead rows with an explanatory line
(the agent's judgment call, adopted). Side-note for the ledger: the renderer agent also
wrote the FIRST test of `preload/index.ts` itself (reusing the package's own electron
mock harness) and properly controlled a transient electron-binary flake before clearing
itself of it.

## The UI system — tokens, the catalog, and the bench

**LANDED 2026-08-05 → 08-06, James's own hands, eleven commits: `250e383` tokens+primitives ·
`c188195` compositions centralized · `11765bc` the catalog · `ba0c895` ownership documented
and enforced · `3cd614c` + `bd720dc` the onboarding shell and its catalog entry ·
`deb66ce` agent-bubble states modularized · `06c0eaa` theme-toggle reach · `3ca1f8a` the
Electron UI Bench · `1e4f9ac` the R5 wall fix · `fcd4c36` the live canvas-ground workbench.
`5b37b3e` (settings-panel redesign) is in main ahead of them.** Recorded retroactively 2026-08-07: **these commits carry subject lines
and empty bodies**, so unlike every other entry in this ledger the account below is
reconstructed from the diffs and `docs/UI_SYSTEM.md`, not from the author's own prose. Where
it states intent it is inference, and it is marked as such.

The track answers a question the corpus had left implicit: `DESIGN.md` says what the product
should look like, and nothing said *where that direction lives in code* or what stops the
catalog from drifting from the product. `docs/UI_SYSTEM.md` (new, main-tracked, and now the
fourth main-tracked doc beside the roadmap trio) names four layers — tokens
(`shell-ui/tokens.css`) → primitives (`shell-ui/primitives.tsx`, +191/+405 css) → product
compositions colocated with their namespaced stylesheets → catalog harnesses
(`field-app/src/design-system`) that may stage or clip a production component but **must not
redefine its selectors**. `c188195` did the migration the rule implies: 52 files,
+3877/−4462 — a net **585 lines deleted**, the shape of consolidation rather than addition,
reaching into the plugins (`note`, `field-tools`) as well as the app.

**The catalog mounts shipping views, not replicas** — that is the load-bearing claim, and it
is enforced by a test rather than a convention: `ui-system-boundaries.test.ts` rejects
catalog-only replicas and production selector definitions living in catalog CSS. Runtime-free
adapters replace only data or controllers (Artifact Hub takes a fixture product client,
FilePill a fixture document manager), so the DOM, interaction state, accessibility, and CSS
under review are production code. `deb66ce` split `AgentBubble` out of `AgentSwarm` for
exactly this reason — physics and placement stay in the swarm, the circle's state projection
and DOM become separately mountable — and the catalog then inventories every valid
source/status combination, access and pane modifier, provider glyph, and context boundary
without starting a physics engine.

`3ca1f8a` gave it a home: `pnpm dev:design` boots an isolated Electron UI Bench on the
production window/security factory with the product preload, users, daemons, plugins, tray,
and diagnostics deliberately omitted, isolated under `.vibefield/ui-bench/` so it runs beside
a live `pnpm dev`. Two leakage gates ship with it — the renderer build keeps `index.html` as
its only entry and fails if a bench document or marker reaches `dist/renderer`
(`verify-production-renderer.mjs`), with desktop packaging's exact stage allowlist as the
second boundary. `pnpm dev:design:web` keeps the browser-only loop.

**The episode worth keeping is the red main.** `11765bc` introduced
`@vibefield/field-app/design-system` **and** declared it in field-app's `exports` map — a
correct import by the R5 wall's own description ("declared public entries only"). The wall
failed anyway, because R5 checks a hardcoded `NEW_PACKAGE_ENTRIES` set that never learned the
entry. `pnpm verify` was therefore red at preflight on main, for everyone, on correct code,
from 2026-08-05 22:41 until `1e4f9ac` on 08-06 20:38 — **about 22 hours**, spanning four
in-flight GT-5 builders and the whole IOS-3 ladder. The IOS-3 commit bodies each recorded it,
checked its provenance, and correctly disclaimed it as not theirs; that is the behavior the
walls exist to make possible. **Correction to `1e4f9ac`'s own body, recorded here because
commit messages are as immutable as this ledger:** it dates the breakage "since `3ca1f8a`",
but `3ca1f8a` (08-06 16:24) only *modified* the offending file — verified by
`--diff-filter=A`, both the import and its `exports` entry first appear at `11765bc`, sixteen
commits and eighteen hours earlier. The window was longer than the fix commit claims. The
real defect is recorded as known debt in the wall's own comment: the set is a second source of
truth for what a package publishes, duplicating the `exports` map the rule's description
points at, and they drifted the instant a legitimate entry was added.

`fcd4c36` landed while this entry was being written, and is the pattern working: the
`dev-tweaks` floating panel — a debug affordance that had been living in the product tree since
`fba7c75` — was **deleted from the product and rebuilt as a catalog workbench**
(`design-system/tweaks/` + `CanvasGroundWorkbench`), with the canvas ground it tunes extracted
into `field/InfiniteCanvasGround.tsx` and `field/canvas-appearance.ts` so the bench mounts the
real thing rather than a copy. `ui-system-boundaries.test.ts` moved with it. That is the
four-layer rule deciding where a debug surface belongs, which is what the rule was for.
*(This does not resolve the standing GT-3v "surface lab is not dev-gated" debt — that lab is
the Godview monitor's tuning panel, `godview/monitor/monitor-tuning.ts`, a different surface;
it is cataloged but its production-render question is unexamined.)*

Not done, and named: `codex/settings-review-fixes` (one commit, 29 files, +1717/−455 —
settings persistence and modal behavior) is unmerged and undecided. The catalog's own
acceptance is an eyeball — light/dark, keyboard focus, reduced motion, narrow layout — and
`UI_SYSTEM.md` says so.

## IOS-3 — the peer's terminal becomes a bubble, and the bubble opens

**LANDED 2026-08-05 → 08-06, five slices then a review: `f54cb06` (3a) · `15dfa4a` (3b) ·
`72929d8` (3c/3d) · `feb6dc8` (3e) · `d36528a` (3r).** Recorded 2026-08-07 — the slices are
documented in `thinking-ios-app.md` §10, but this ledger had no IOS-3 entry at all until now.
Built by parallel agents on disjoint modules, integrated and reviewed by the orchestrator.

**James's correction is the spine: there is no session list in the card.** Every terminal a
peer serves arrives as its own bubble beside the agents, and the card carries the one act that
matters. `f54cb06` ported the desktop's GT-4b union rather than re-inventing it — one
`FieldBubble` projected by pure functions from either source, carrying at most one facet.
Every ported clause is a finding: ids are device-qualified (`remote:<deviceID>:<id>`) because
two peers can each have a session `1`; the accent hashes the *qualified* id so one session id
on two peers is two colors; `detail` is "deviceName · cwd" because a path with no machine
attached was GT-3's own confusion finding; and `classifyTerminalStatus` can never return
`waiting`, because that tier is agent-permission language and a terminal has none. Discovery
took the desktop's discipline (upstream's 2 s poll, failure tolerance 2, online hosts only,
`attachable:false` KEPT and shown — a peer deliberately not sharing is a fact, not an absence)
plus two refinements past it, both reasoned in source: one peer refusing its listing costs its
own rows rather than everyone's, and each listing closes its connection on **every** path,
where upstream's own dialer closes only on success and a throwing listing leaks.

`15dfa4a` built `FieldTerminal` — appearance → presentation → attachment → surface — and
honored the §10.1 laws where they are laws, testing the testable ones: the durable host
reference, presentation sampled after the last suspension point, `presentationAuthority:
.device`, `revision` excluded from device-presentation comparison, only `fontSize` rebuilding
the runtime. `TerminalSurface` surfaces a render failure as state where the reference app
calls `preconditionFailure` — we render a card, not an app. `72929d8` added the settings sheet
(602 themes with live swatch strips, provenance stated whole, four shader ports with license
badges and the honest line that 31 more exist upstream whose rights are unclear) and the three
lifecycle gaps the terminal leg's report named. `feb6dc8` then **deleted our own vocabulary**:
the card now speaks upstream's `GhostteaAttachmentBannerPresenter`, which names the *device*
("studio is offline") where our phase words could only name the condition, and carries
upstream's grace windows, reconnect flash, and retry clocks — the phase reasons demoted to the
tier beneath, for the states a banner deliberately stays quiet for.

**`d36528a` (3r) is the entry's real content.** A review of the four landed commits found the
concurrency work correct under a deliberate attempt to break it — the attach-identity/generation
double guard, the `await superseded?.value` chaining, the post-suspension config sampling, the
throw-path connection close all held. **Every finding was instead a seam between modules that
were each individually careful, and all three serious ones lived in `FieldHome` — the only
module with no test target.** That is the finding under the findings. (1) `.background` stopped
the discovery poll but left `discoveryLive` set, making the resume branch unreachable for the
rest of the process — so `noteHostReachable()`, the only thing that can end a `suspended(host
absent)` attachment, could never fire again, and one backgrounding disabled IOS-3e's entire
reconnect leg. (2) The card rendered "SESSION ENDED" on any discovery lookup miss, so ~4 s of
blips both lied and unmounted a surface still rendering frames — a listing is not a heartbeat,
and while attached the connection is the authority. (3) "You can type here" read the
*listing's* `readWrite`, a broadcast with no per-caller context: it says the session is shared
for writing, never that *we* may write. The fixes land as pure functions (`FieldHomeModel` +
`FieldHomeTests`), each doc comment carrying the defect it replaced. Tests 135 green (was 116).

**Two corrections recorded at source rather than only here.** §10.4 had told the settings agent
to label font size as re-attaching the terminal; that was false — at 0.9.2 upstream swaps the
runtime on the live sink, so the session never leaves. It was caught by the agent who built the
attachment leg, reading the tag source rather than trusting the orchestrator's paragraph, and
it reached the sheet only because the correction landed 31 seconds after the line was written.
§10.3's unqualified "readWrite" named two different facts, and that looseness is what finding
(3) got wrong; it now carries a dated clarification.

**Honest bound, and it revises what "IOS-3 is complete to its design" means.** `72929d8`'s
subject claims 3c, but **IOS-3c's capability/Keychain leg did not land** — verified 2026-08-07
at three source sites (`TerminalAppearance.swift:73`, `SessionCardView.swift:45`,
`HomeScreen.swift:51-53`: *"nothing assigns this yet"*). `claimControl` is plumbed and the
access token rides the lifecycle, but no capability is ever supplied, so **the phone attaches
view-only** and the card correctly says "this device has no write key for this host". GT-5's
acceptance row is *live view · type with mirror-write · reconnect banner*; the middle third is
not reachable until the Keychain leg lands. Also still device-gated: the attached-but-unlisted
card is tested as a decision and read in source, but its pixels need a live mesh — no fixture
on this side can hold an attachment open while discovery drops the row.

`pnpm verify` does not cover `apps/ios` by design (the gate must not require Xcode); the
`xcodebuild` commands in `apps/ios/README.md` are that tree's gate and were run verbatim.

## UI — the kit says its own name: shell-ui → design-kit

**Landed 2026-08-09 (James's go on a scoped slice; scoping in
`draft/thinking-shell-ui-rename.md`, verified against `61d70c0`).** Name-only:
`@vibefield/shell-ui` → `@vibefield/design-kit` (`git mv packages/shell-ui
packages/design-kit`), retiring the one package name in the workspace that lied — it read as
"electron-shell's UI" while electron-shell doesn't even depend on the package. The corpus had
said "the design kit" all along (README's row, DESIGN.md's token/card-anatomy lines, design-03
§5.2 D14/D15), and plugin-architecture's walls list already legislated in design-kit vocabulary
("design-kit primitives AS SDK re-exports"); code catches up, no substance moves.

**Doc-first, per authority order.** design-03: dated Status amendment + the §5.2 citation.
plugin-architecture: its four live-law citations (the layout tree, the SDK-composition MAY, the
walls MUST-NOT ×2) plus a dated rename note in Status. Then the main plane: UI_SYSTEM.md's
layer-1/2 paths, DESIGN.md ×2, README's row, CLAUDE.md's taxonomy (added earlier the same day,
`fee1346`). **Deliberately frozen, checked at execution time:** this ledger's five prior
mentions, electron-shell-refactor (Status: EXECUTED — a record, not law), godview-terminal's
GT-3m LANDED row, appendix 03·A, predesign-05, thinking-p3/thinking-widgetlab — history keeps
the name it landed under; the errata rule corrects falsified claims, and a rename falsifies
nothing.

**Code.** The full tracked sweep (29 files): 24 exact `@vibefield/shell-ui` references, the
prose comments, the catalog's `source=` specimen labels, and two sites the scoping's eyeball
pass caught beyond the original inventory — the Tailwind `@source "../../../packages/shell-ui/
src"` path in field-app's `styles.css`, and `check-import-boundaries.mjs`'s three sites, which
ARE the R10 wall's own test and were renamed with intent, not blindly. `pnpm install` re-keyed
the lockfile importer (shell-ui rows 5→0). The R10 wall never moved: plugins still reach the
kit only through `plugin-sdk/src/ui.ts`; zero direct plugin imports existed before or after.

**Done-check and gate.** `git grep -l shell-ui` returns exactly this file (the lockfile
re-keyed to zero). `pnpm verify` exit 0 verbatim before each of the slice's two commits. The
second green cost seven runs and produced a petition-grade finding: **`ghosttea-vt-sys`
(0.9.2) rewrites its OUT_DIR tar on every build**, so cargo holds the whole ghosttea chain
permanently stale and every `cargo build -p field-native` redoes ~40s of dependencies — the
five fieldd suites that each run that build inside a 180s `beforeAll` then serialize on the
target-dir lock, and the queue's tail dies by lottery (46/47 three times with a rotating
victim; every victim passes in isolation; the fingerprint probe
`CARGO_LOG=cargo::core::compiler::fingerprint=info` names the stale tar directly — nothing to
do with this rename, which never touches fieldd). The recorded pass ran fieldd:test
standalone with vitest workers capped at 2 — staggering the build queue; same tests, same
tree — which Nx cached into the verifying run: the gate's own caching, disclosed here.
Follow-ups this argues for: a fieldd vitest globalSetup that builds field-native once per
run, and an upstream tar-stability petition (G-series).

> **Erratum 2026-08-09 (same day, at the source rather than only downstream):** the mechanism
> in the paragraph above is retracted. A repeat build is indeed never a no-op — 38 s then 53 s,
> measured back-to-back on an idle machine — but `ghosttea-vt-sys` does **not** rewrite the tar
> of an existing unit; the file's mtime is stable across builds. Cargo mints a **new** build
> unit instead: 26 `ghosttea-vt-sys-*` directories in one target dir, 13 holding their own
> separately downloaded copy of the byte-identical 2.3 MB artifact (30 MB). The symptom, the
> cost, and the gate consequence all stand; only "rewrites its OUT_DIR tar on every build"
> was inference, and the probe killed it. Petition G12 carries the corrected evidence and
> deliberately leaves the mechanism open for upstream to name.

## The gate stops failing by lottery — one native build per run, and the petition for why one costs 40 s

**Landed 2026-08-09 (James: "go ahead fix both"), the same day the finding surfaced.** Five
`fieldd` suites — `terminal-seam`, `terminal-kill-matrix`, `cross-daemon`, `mesh-lane`,
`two-pairs` — each built `field-native` in its own 180 s `beforeAll`. Vitest runs files in
parallel workers, so those five builds served a single cargo target-dir lock: the budget was
never per-suite, it was per *queue position*. That is survivable only while a repeat build is
approximately free, and it is not — **38 s then 53 s for two identical back-to-back builds** on
an idle machine. The tail of the queue therefore blew its budget, and which suite died was
luck: three consecutive runs failed 46/47 with a different victim each time, every victim
passing in isolation. It reads as flake, which is why it survived this long.

**The fix is one build per run.** `packages/fieldd/test/global-setup.ts` builds the binary once
in the vitest host process before the first worker starts; `vitest.config.ts` wires it as
`globalSetup`; the five `beforeAll` hooks are deleted. Same guarantee the hooks were making —
the binary is on disk when a suite opens — minus the queue. The setup captures cargo's stderr
and puts it in the rejection, because a failure here kills the whole run and a silent one would
be worse than the bug.

**Measured, not assumed.** A process sampler across the whole run counted **exactly one**
`cargo build -p field-native` (was five). The suite went **47/47 files, 415/415 tests, 71.14 s**
— from 3m08s–3m17s with one or two files failing. Note the old red was hiding more than it
showed: a timed-out `beforeAll` reports its file's tests as *skipped*, so those runs also had
**ten tests that never executed at all** and reported as green-ish. Zero skips now. The four
native suites that used to die on the budget now finish in 2.6–4.8 s each.

**The upstream half is petition G12** (`draft/petitions/G12-ghosttea-vt-sys-build-fingerprint.md`,
DRAFTED — not posted). Evidence: the A/B timings, cargo's own `fingerprint=info` verdict
(`ghosttea-vt-sys` dirty, then `ghosttea-vt` → `ghosttea-core` → `ghosttea` → `field-native` as
`StaleDepFingerprint`), and the churn visible in one `ls` — 26 `ghosttea-vt-sys-*` build dirs,
13 with their own copy of the same 2.3 MB artifact. The source-visible suspect is three
`cargo:rerun-if-changed` declarations naming paths inside the script's own `OUT_DIR`
(build.rs :231/:267/:282 at 0.9.2), stated **per branch** because each site is correct on some
paths and wrong on others — the `GHOSTTY_VT_PREFIX` pair (:226–227) is correct today and
explicitly untouched. The petition asks for provenance-aware declarations, leans on the
already-declared content-addressed `artifacts.json`, and offers an optional shared bundle cache;
it does **not** ask for any change to checksum verification, the env contract, or the API. It
also declines to name the mechanism: the anti-pattern may not fully explain 13 units, we cannot
instrument the crate from here, and guessing at cargo internals in someone else's tracker is how
a petition gets dismissed. `globalSetup` does **not** retire when G12 lands — building once per
run is right regardless; what retires is the ~40 s each run pays and the 30 MB of duplicates.

**Gate:** `pnpm verify` exit 0, bare (no pipe — a piped gate reported tail's exit 0 over a red
run earlier this same session, which is its own lesson). That run cache-hit `fieldd:test` from
the live 47/47 minutes before, so the gate was re-run with **`NX_SKIP_NX_CACHE=true`** —
stricter than the gate, not weaker — and there `fieldd:test` **executed live inside the gate
and passed 47/47**, which is the proof this particular slice owed.

**One finding that run surfaced, recorded rather than fixed.** With every cache disabled, all
18 test projects run at once, and three `logging` tests went red on deadlines — two 5 s test
timeouts (9.6 s and 6.9 s actual) and one `logging flush deadline exceeded`. `packages/logging`
is untouched by this slice (its last commit is `17862a5`), it passes **7 files / 49 tests in
5.45 s** standalone, and the normal gate is green — so this is load, not regression. But it is
worth watching for a reason this slice created: fieldd's suite went 190 s → 71 s, so it no
longer serializes behind cargo and now **overlaps** the rest of the graph. The gate got denser,
and tests sitting close to their deadlines have less headroom than they did yesterday. Whether
those three deadlines want raising, or logging's timing tests want a fake clock, is a different
package's question and James's to scope.

## EL8 — ghosttea 0.9.3: the petition filed this morning comes back as a 0.47 s no-op

**Landed 2026-08-09, hours after G12 was drafted.** Upstream implemented it directly, cut
**0.9.3** (PR #55), and VibeField consumed it the same day. The whole round trip — symptom to
diagnosis to petition to release to consumption — fits in one day's ledger, which is the
argument for writing petitions with a deterministic repro attached.

**What upstream's review changed before implementing, because the file was wrong in two
places.** It refuted the petition's hypothesis (b): the unit key is *stable*, a clean repro
holds at 2 unit dirs and 1 tar across four builds, and our 26 directories were `13 units × 2`
(compile dir + run dir) accumulated over 11 days of config changes, since cargo never GCs an
abandoned unit — so "cargo mints new units, so the script re-runs" inverted cause and effect.
It also proved (a) is **deterministic by construction, not a timing race**: cargo writes a
unit's fingerprint reference *before* the script finishes populating `OUT_DIR`, so any declared
path under it is unconditionally newer and the unit can never be fresh. And it killed our
proposal 3 — a shared bundle cache would *not* have fixed the loop, because extraction always
lands in `OUT_DIR`, so :267/:282 keep it alive no matter where the bundle came from. All three
sites are independently sufficient; cargo only ever names the first one it hits.

**Fixed better than asked.** Rather than three provenance-aware call sites, one
`rerun_if_changed(path, out)` guard now owns every declaration and drops anything under
`OUT_DIR` — a structural invariant instead of a rule each future call site must re-derive. It
ships with `scripts/check-build-script-inputs.mjs`, whose source half runs **offline**: that is
precisely the blind spot that let this reach 0.9.2, because a build from upstream's own checkout
resolves `Prefix::Repository` and never takes the download path, so the bug was only ever
visible to consumers. A latent second bug closed on the way — targets marked
`reproducible: false` skip `validate_library`, so on those the archive was never declared an
input at all and a local Ghostty rebuild left a stale archive linked.

**The published delta, read from the compare rather than the changelog:** `v0.9.2...v0.9.3` is
31 files over 4 commits — **one** source change (`ghosttea-vt-sys/build.rs`, +37/-8), **one**
added file (the regression check), and version strings, lockfiles, and regenerated SBOM/Apple
artifact locks. No Rust API, no Swift, no TS delta; CONTROL minor unchanged at 13, so
`terminal_client.rs` still announces 1.9.

**The payoff, measured here.** The upgrade build cost **2m35s** — a full chain recompile at a
genuinely new version, expected exactly once — and the next identical `cargo build -p
field-native` finished in **0.47 s: a true no-op**. That same repeat cost **53 s** yesterday.
Tar copies went 13 → 14 (0.9.3's unit, fetched once) and stop there. `globalSetup` stays, as
its file and the petition both said it would; what retired is the ~40 s every fieldd test run
was paying for a build that changed nothing.

**Consumed on every plane in one event, because that is what EL8 means:** cargo `ghosttea` +
`ghosttea-truffle` `=0.9.3` · the four npm overrides and six age-gate rows (no transitional rows
needed — 0.9.3 aged past the cutoff by the time we consumed it) · **preflight's six pin rows**,
since editing a pin and that table together is the ritual · SwiftPM `exact: "0.9.3"` with
**both** `Package.resolved` files at `d099882`, plus the `FieldTerminal.ghostteaVersion`
constant, the test that pins it, and two `apps/ios/README.md` lines. The iOS surface is the
lesson worth keeping: a pin bump there is six files, not one, and only the manifest is obvious.
Xcode's DerivedData held a stale *extracted* artifact and failed to resolve until that one cache
entry was cleared — cache only, and SwiftPM's shared cache already had the new zip.

**Correction at source:** `Package.swift`'s pin comment claimed both planes "ride truffle
0.7.11" while its very next sentence named `=0.7.12`. Corrected while editing, in the same
spirit as CLAUDE.md's own version errata — the manifests were always the authority.

**Gate — stated exactly, because this one did not land as a single green run.** Every stage
passed, but never all in one process: preflight (the six-row pin table, which is the whole
point of the ritual) · icons · typecheck · biome · `cargo fmt --check` · clippy · `gen:check` ·
the JS suite (green with the test projects serialized, `NX_PARALLEL=1` — every test still runs)
· the Rust workspace suite (green on its own). Five full attempts each reddened on a *different*
deadline-based test — field-app's shader cards (5.1–5.8 s against a 5 s budget; 300–600 ms each
when run alone), `godview-remote-door`'s settle race, TS logging's fuzz test, and
field-native's own `logging.flush(4s)` — which is the signature of a saturated machine, not a
regression.

It was saturated: **load average 37 / 101 / 91**, from WebStorm at 157 %, a `VibeField.app`
left running in an iOS Simulator for **2 days 20 hours** at 97 % (plus ~160 % more across its
render and backboard services), WindowServer at 87 %, and a live `pnpm dev` session. None of it
this slice's, and none of it safe to kill from here.

**Controls that exonerate 0.9.3 rather than excuse it:** field-app run alone at 0.9.3 passes the
appearance/shader tests — the surface built from upstream's blessed data, and the one a bad data
bump would break — leaving only the `godview-remote-door` race, which failed *identically at
0.9.2 this morning*, before any pin moved. The Rust and logging suites pass alone. And the
headline number is a direct measurement, not a test verdict: 53 s → 0.47 s.

**Not gated this session: `apps/ios`.** Its gate is `xcodebuild` (CLAUDE.md keeps it out of
`pnpm verify` deliberately), and a simulator run on a box at load 100 would answer nothing. The
change there is a version string, the test asserting it, the manifest pin, and two resolved
files; the commands in `apps/ios/README.md` are what should confirm it on a quiet machine.

## ICE 0.4.0 — I1/I4/I5 consumed: the focus model, the wheel cede, the in-band rename fold

**LANDED overnight 2026-08-09/10 (the commit carrying this entry is the consumption event).**
Hours after upstream cut `@vibecook/ice` 0.4.0 (design-007 rev 2: the I1 keyboard claim +
`keyboardEscape` + I4 wheel cede + facade `keymapOverrides`; design-008: the I5 `renamedFrom`
rename migration; the Space-in-textarea live-bug fix), VibeField consumed it as one EL8 bump
event — pin 0.3.0 → 0.4.0 in `pnpm-workspace.yaml` (override + release-age exclusion) — and
every named workaround retired in the same slice:

- **The ChromeLayer C-key capture trap is DELETED (I1).** The "selection decides" behavior is
  two `keymapOverrides` entries (`field-keymap.ts`, threaded FieldView → CanvasStage → the
  mount) with exact parity: C-with-selection invokes field-tools' DECLARED
  comment-around-selection through the SPINE command registry (R10 held — field-app still
  imports nothing from plugins/*); C-without re-issues the engine default it replaces
  (connect tool); ⇧C stays comment-only; Settings-open suppresses the comment through a ref
  gate while the tool shortcut behaves exactly as it always did. The engine keymap's own
  editable guard runs before overrides — the window-bubble race is simply gone.
- **note's two `onWheel` stopPropagations are DELETED (I4).** The editor textarea rides the
  editable-scroller cede (scrolls natively, falls through to zoom at the bounds). RECORDED
  BEHAVIOR DELTA, James's eyeball owed: the read-only body is plain content under the landed
  law, so wheel over it now zooms the canvas instead of scrolling long note text — the revert
  is one `data-canvas-interactive`, which would also opt the body's pointerdowns out of card
  drag (the note's primary gesture); the widget's header comment records the trade.
- **The C2 offline rename surgery is DELETED (I5).** `migrate-type-renames.ts` and its
  pre-attach call are gone; `build-widget` projects the append-only TYPE_RENAMES history into
  `renamedFrom` declarations and the ENGINE folds pre-rename boards in-band — the version
  gate resolves old ids as "migrate" instead of bricking readOnly, and the envelope
  self-heals at the next save. The C2 old-board eyeball (watch the migration log line)
  retires with the log line itself; the ordinary open path is the replacement. The rewritten
  test opens the probe-era pre-rename fixture through the engine's own runner: writable,
  ratified types projected, an old-named journal entry accepted post-open.
- **Found while consuming, fixed and pinned:** ghost stubs would have registered a pre-rename
  envelope's OLD ids as live types — colliding with their successors' `renamedFrom` claims —
  because the stub filter only knew "registered". A renamed id whose successor is registered
  is now covered, never stubbed (`ghost-stubs.ts`), with its own test beside the fold tests.

Breaking surface consumed without a scratch: `WidgetType` +`keyboard`/`keyboardEscape`,
`InfiniteCanvasHandle` +`focus`, `DocVersionReport` +`renamedInDoc` — engine-constructed
types; nothing here hand-rolls one (18-project typecheck green). Deliberately NOT taken (A7 —
no shipped need): no widget declares `interaction.keyboard` yet; `keyboardEscape` and the
`focus` handle wait for the first widget that wants them.

**Gate: `pnpm verify` VERBATIM exit 0, one process, on the combined working tree** (this slice
atop the uncommitted ghosttea-0.9.3/G12 + mille-theme work) — field-app 417/417 with the
rewritten rename tests aboard, Rust suites green, gen freshness clean; notable against the
previous entry's saturated-machine story. **`smoke:canvas` is RED — and was red BEFORE this
slice**: its bundle assert fails identically at clean-worktree rebuilds of `d36528a` /
`fee1346` / HEAD `c33bcf4`, so the Electron leg never runs for anyone; control-proven
unrelated to this consumption and recorded as its own dated debt row in `ROADMAP.md`.
*(Fixed the next morning — see the entry below.)*

## The splash split comes back — one class-name import had been loading the 3D world

**LANDED 2026-08-10.** The `smoke:canvas` red recorded hours earlier turned out to be two
defects wearing one failure, and only one of them was real.

**The real one, and it was product-visible.** `field/theme-constants.ts` imported a single
class-name string (`uiIconButtonClass`) from design-kit's BARREL. The barrel re-exports
`GlLiftGroup`, whose `@vibecook/ice/r3f` import reaches three, and ICE reaches loro — so every
module the barrel names had to be kept, and the whole 3D world landed in the eager graph. The
boot path arrives there through `mount` → `BootRoot` → `OnboardingWizard` → `wizard-ui` →
`ThemeToggleButton` → `theme-constants`, an edge that did not exist until **UA-3w's Setup
Assistant (2026-08-06)** — which dates the regression precisely and explains why `d36528a`
(2026-08-07) was already red. **Cold opens paid 5798.4 KB raw / 1902.6 KB gz for four days.
Now 455.4 KB / 118.2 KB, world lazy.** That is not the ESR-cited 269.8 KB and this entry does
not pretend otherwise: the Setup Assistant legitimately joined the boot path in between, so
455.4 KB is the honest new baseline. With the assert passing, `smoke:canvas` ran its Electron
leg for the first time in days — `SMOKE_CANVAS {"widgetTypes":21,"plugins":4}`.

**The fix, attributed by experiment rather than by argument.** `"sideEffects": ["*.css"]` on
design-kit is load-bearing: every JS module there is pure and the CSS imports are the only
side effects, so declaring it lets the bundler drop what the barrel merely re-exports. The
three-way control was RUN: barrel import + no `sideEffects` reproduces the original failure
byte-for-byte (same chunk name, same three messages) · barrel + `sideEffects` passes · leaf
import + `sideEffects` passes. So the new `@vibefield/design-kit/primitives` deep export, which
`theme-constants` now uses, is HARDENING — it keeps the boot path off the barrel rather than
trusting tree-shaking — and the entry says which is which because the control said so.

**The false one, corrected at its source.** The same failure listed both CSS canaries as
missing, and the debt row written the night before repeated it as fact ("the utilities are
absent from the built renderer"). They were never absent. `bundle-report.mjs` graded canaries
against `[...chunks.keys()].find(n => n.endsWith(".css"))` — the first stylesheet by name —
while the renderer emits one CSS per chunk; `.tabular-nums` and `.leading-none` were sitting in
`main-*.css` throughout. The script now unions every built stylesheet. The correction is
stamped in the ROADMAP row itself, not only here: a false alarm beside a real one is how a
tripwire loses the authority it needs on the day it is right.

**The structural half — why this survived four days.** The assert lived only in
`smoke:canvas`, which no routine gate runs, so `pnpm verify` exited 0 at `d36528a` and again
during the ice-0.4.0 consumption while the splash bundle was 21× its budget. `pnpm
bundle:assert` (renderer build + assert) is now wired into `pnpm verify` between clippy and
the test suites. A static import wall could not have caught this — the offending file is not
under `boot/`, and the defect is reachability, not a forbidden import — so the gate needs the
built bundle, and now has it.

**Gate: `pnpm verify` VERBATIM exit 0**, with `bundle:assert` inside it, plus `smoke:canvas`
green end to end.

## Two GT-review follow-ups close — ⌘W actually lets go, and the probes run the pinned sidecar

**LANDED 2026-08-10.** Both were recorded at the GT close-out with their mechanisms already
diagnosed; neither had been repaired. Each is now fixed at the site the record named, and each
gained the test whose absence let it stand.

**⌘W never worked, and now does the only thing that can work.** The close item kept
`role: "close"` in both overlay states and merely OMITTED the accelerator — which releases
nothing, because Electron resolves an item's accelerator as `explicit ?? roleDefault` and
`close`'s default IS `CommandOrControl+W`. The smoke had already measured every alternative on
Electron 43.1.1, and that measurement was the design input: `accelerator: null` and
`registerAccelerator: false` BOTH still resolve to the role default, so **a role-less item is
the only spelling that reports null**. While the overlay is open the item is now a plain
labelled command carrying no role, and the close behaviour the role used to supply arrives as
`actions.closeWindow` (focused window, same subject as the Godview toggle). The overlay-closed
state is untouched: role, label, ⌘W. Cost, stated rather than buried: that one state's label is
ours, so it is English where Electron's role would have localized it — against a menu that eats
the deck's ⌘W in every language.
The test that passed through the entire defect is the story's other half. It asserted
`role: "close"` while the overlay was open — the very thing that broke it — so it graded the
bug as correct. It now asserts the role is GONE, and the control was run: restore the role and
it fails with *expected 'close' to be undefined*. The smoke's two verdict fields stop being a
record and become the claim — it throws if the open state reports any chord, or if the two
states ever read alike again. **Deliberately still owed: the OS-level witness.** No harness can
prove macOS routes a real ⌘W to the pane rather than the menu — `sendInputEvent` injects below
AppKit's key-equivalent dispatch — so this remains a chord without a delivery probe until it is
pressed by hand with a deck open. The repo's own lesson, honoured rather than papered over.

**The tailnet probes ran a binary the product never ships.** `tests/common/mod.rs` searched only
the machine-wide truffle installs, so on this box it found a **Jul 16**
`~/.config/truffle/bin/sidecar-slim` while the workspace pinned and vendored the **Aug 2**
0.7.12 copy — the concrete mechanism behind identity looking assertable at GT-4. The harness now
resolves the pinned binary first, through `apps/desktop`'s own `@vibecook/truffle-sidecar-*`
dependency (the same artifact the packaged app ships), with `FIELD_NATIVE_SIDECAR_PATH` still
authoritative above it and the machine installs kept as a last resort so a checkout without
`pnpm install` can still run the probes. Because every other test in that family is `#[ignore]`d
behind a live tailnet, the order would have had nothing watching it — so it gained the family's
one OFFLINE test, which asserts (not skips) on an installed workspace and rides `pnpm verify`.

**Gate: `pnpm verify` VERBATIM exit 0**, with both new tests observed inside that run.

## R5 stops keeping its own copy of what each package publishes

**LANDED 2026-08-10.** The wall that cost main 22 hours of red preflight on a CORRECT import
(`11765bc` declared an export and imported it; the wall knew nothing about either) graded deep
imports against `NEW_PACKAGE_ENTRIES` — one hardcoded set of subpath names, shared by all three
walled packages. It is now derived per package from each `package.json`'s own `exports`.

The union list was wrong in both directions, which is what a second source of truth buys you:
it let `@vibefield/field-app/main` through (`main` is electron-shell's entry, not field-app's),
and it still carried `host`, a subpath no package has exported for some time. Both are now
graded against the manifest that actually decides. Entries are read from the REPO root rather
than the scanned tree, because the self-test scans a temp fixture directory and the question
"what does this package publish" is always about the real package; an unreadable manifest
throws rather than silently allowing or denying.

**The wall's own clean fixture was part of the defect.** It imported
`@vibefield/field-app/host` to prove "R5 accepts declared entries" — an entry that does not
exist, passing only because the union list contained the word. It now imports a real one
(`/logging`), and a second clean fixture pins the cross-package case that used to leak.

Controls, run rather than argued: a probe importing `@vibefield/field-app/main` is now REPORTED
by the enforcing scan (it was clean before), and a probe importing a freshly declared
`./probe-entry` export is clean with ZERO edits to the wall — which is precisely the 22-hour
bug, now structurally impossible. Both probes were removed; `pnpm verify` exit 0 with the
walls' self-test and the enforcing scan inside it.

**Recorded, not fixed: F-C6-21.** The audit-integration flake was investigated in the same
sitting and no production change was made, because the mechanism was not reproduced — 5
consecutive runs passed under concurrent load. Two findings are banked in the ROADMAP row so
the next attempt starts ahead: the timer hypothesis is dead (`health()` reads the field
directly; all three `markHealthy()` callers are event-driven, leaving the recovery drain as the
one candidate), and the refusal assertion above the failing line is NOT a second witness —
`AuditUnavailableError` hardcodes `state: "degraded"` in its details, so only line 112 tests
health at all.

## The Windows port opens — WIN-0…4 land the shell's other half

**LANDED 2026-08-11** (ratified 2026-08-10, James: "follow your plan"; `draft/thinking-windows-port.md`).
Windows was already a decided GA target (B-5, EDP-39 Azure signing, EDP §10.2's NSIS installer) — the gap
was that the daemon/socket layer was specced unix-shaped and never re-derived. This wave re-derives it,
every fix first demanded by a probe on the real box (WORKSTATION4090, x86_64-pc-windows-msvc, over the
tailnet) before a line changed, then re-proven there. Three slices on `f98f58a`:

**WIN-0/DEV `5ffd30b` — the gate and the dev loop stop refusing Windows.** Four one-file gate fixes: the
single-quoted esbuild flag is unquoted (cmd.exe treats `'` as a letter — since `fc78b84` put
`bundle:assert` inside `verify`, that one character blocked THE gate on Windows, not just `pnpm build`;
the box died with esbuild's own diagnostic while the vite renderer build passed in 577ms); `.gitattributes`
gains `eol=lf` (the extensionless pre-push hook checked out CRLF and a CRLF `sh` hook blocks every push —
zero renormalization, proven before widening); `pnpm hooks:install` exists because `core.hooksPath` was
machine-local config no clone ever got; `check-release-identity --self-test` takes an injectable identity
(the box's 2-char username `me` sat under the deliberate `>2` guard and the overlap rule could never fire
there — now a pinned choice with its own row). `tooling/dev-runner` runs on Windows (76/76): the
`.cmd`-without-shell EINVAL (CVE-2024-27980 class) wrapped once as `cmd.exe /d /s /c` with cross-spawn
quoting; `isPidAlive` accepts EACCES (a live-but-unqueryable daemon read DEAD, and
`clearDeadDevProductFiles` deleted `product.json` + `shell.token` under it); the orphan reaper is
platform-gated with a CIM process pass; watchers carry error handlers (a win32 EPERM on a renamed root was
an uncaughtException that killed the whole dev loop); `buildChildEnv` unsets case-insensitively (an
`ELECTRON_RUN_AS_NODE` case-variant could turn Electron into Node).

**WIN-1/2 `85cce04` — one endpoint law in two languages; the native plane binds pipes.** The mgmt /
meshdata / terminal channels stop being socket PATHS and become ENDPOINTS under one law (WIN-D1): on unix
the joined LAYOUT path byte-for-byte; on win32 a named pipe `\\.\pipe\vibefield-<scope>-<sock>` where
`<scope>` is FNV-1a-64 over the canonicalized data root — the flat pipe namespace has no run-directory
boundary, so the name itself carries what 0700 carried (two users' pairs / two roots never collide;
UA-D10 holds). The law lives in `contracts/src/endpoints.ts` (dependency-free, ASCII-only case fold), its
Rust twin is HAND-WRITTEN (`field-native/src/endpoints.rs`), and `fixtures/endpoint.vector.json` pins the
two to one derivation — including two spellings of one Windows directory that must collapse to one scope.
The `sun_path` guards become explicit unix law (win32 skips; darwin still refuses — both pinned).
`field-native`'s four channels bind/dial through one seam (`local_ipc` over `ghosttea::ipc` —
NamedPipeServer with `first_pipe_instance` squat guard + CurrentUserOnly DACL, both upstream and already
pinned, ZERO new deps; the client half adds the documented PIPE_BUSY/FILE_NOT_FOUND rotation retry). All
32 cross-compile errors lived in seven files of field-native's own code. Terminal listener ownership stays
OURS with no windows fork — binding upstream's own `Listener` made the handoff direct, RESOLVING WIN-D3 by
construction (no petition). `config.rs` gains the resolution law, the `%APPDATA%\VibeField` default
(byte-lockstep with fieldd), and `home_dir()`=USERPROFILE (no default lands the pairing secret in the
CWD). WIN-2b: the logging stderr floor is REAL on windows (CreatePipe + SetStdHandle, divergences named in
comments — no dup2 atomicity, children inherit a working stderr, CRT-layer writes escape), `pid_is_alive`
gets an OpenProcess arm (a dead writer's segment lock is reclaimable on windows for the first time), and
errno matches become `io::ErrorKind` with the real per-platform codes pinned by test. Every windows arm
was compile-checked against the msvc triple before the box saw it — the probe caught the one would-be
`-D warnings` red (an unused arg under `cfg(not(unix))`). The MAC gate caught the dual: the same
supersession change turned unix's `shutdown(SHUT_WR)` half-close into a full close, so `terminal_unit`'s
adversarial write-after-supersession test (invisible on the box — it is `cfg(unix)`) began racing that
close; fixed at the test's seam with a `try_send` that tolerates the eviction's BrokenPipe, its real proof
(nothing pruned) untouched.

**WIN-3/3b/4 `f982d27` — the pair boots honestly, and a stop is a verb, not a signal.** fieldd: the
`nativeAlive` existsSync gate is GONE (a pipe never exists on disk — every boot was going to spawn a
second field-native; the connect attempt IS the probe, EBUSY reads alive); the `:` plugin-roots
writer/reader pair flips to `path.delimiter` together (a `:` join shreds every `C:\…` root); the win32
data root is `%APPDATA%\VibeField` in byte-shape lockstep across three planes; the EL7 env strip folds
case on win32; `baseEnv` grows the 13-key win32 allowlist (children can actually start); the executable
policy refuses every cwd-relative win32 shape incl. current-drive-rooted `\evil.exe`; `.cmd`/`.bat` shims
(npx/uvx — how MCP servers are configured) spawn through COMSPEC with cross-spawn quoting and NEVER
`shell:true`; `bin.ts`'s untestable laws moved to `boot-env.ts`. WIN-3b/WIN-D5: SIGTERM never fires on
win32, so every teardown was a hard TerminateProcess silently skipping the child sweep, run-file cleanup,
and audit close — `system.shutdown` joins the METHODS registry (native.admin, D32 local-only-forever),
fieldd wires it to the same graceful path its signal handlers take, and the supervisor ASKS over the
client it already holds before any signal (dispose reordered: stop before close). WIN-4: the five native
e2e harnesses stop lying by platform — `.exe` paths, connect-based readiness (including two existsSync
ASSERTIONS whose "socket audit" a pipe cannot answer), `/bin/sh` spawns become node stand-ins, and the
migrate ladder gets its first coverage on any platform. Two PRODUCTION durability bugs the box's TS suite
surfaced: directory-fsync EPERM/EACCES on Windows (`doc-service` had no guard, `artifact-service` caught
the wrong codes AND reopened its tmp file read-only to fsync it — Windows `FlushFileBuffers` needs write
access → EACCES), both now win32-guarded matching the audit store's already-correct posture; and
`service-host` resolving its worker with `new URL(...).pathname` (`/C:/…` on Windows, unloadable — so NO
plugin service ever activated), now `fileURLToPath`.

**Gate: `pnpm verify` VERBATIM exit 0 on the combined working tree (one process).** On the box
(WORKSTATION4090): the Rust workspace is green — `cargo check --all-targets` + `clippy -D warnings` clean,
`cargo test --workspace` exit 0 (60 lib + mesh_bridge 29 + mgmt_server 10 + terminal_mesh 6 + the
cross-language vectors; the first live named-pipe roundtrips on real Windows ride the suite itself) — and
the TS planes are green: the full `fieldd` suite 445 passed | 9 skipped (scoped-sequential), `fieldd-client`
12/12, `field-app` 417. Honestly skipped as tracked debt: the two concurrent-edit doc-sync tests (a slow-box
stall past a raised 15s timeout — the router is in-process, so transport is proven separately in
`quic_lane_transport.rs` over real QUIC), the PTY-hosting suites terminal-seam / terminal-kill-matrix
(WIN-6 ConPTY, mirroring `terminal_unit.rs`'s `cfg(unix)`). The four-process two-fieldds-over-a-real-tailnet
doc-sync witness remains a COVERAGE gap, not an argument gap — both halves are proven at their own seam.

## WIN-6 — terminal hosting on Windows: the ConPTY rung

**LANDED 2026-08-11 `03cc648`** (WIN-D2 decided by James the same day: "build WIN-6 now" —
terminal hosting is IN Windows GA, not deferred). The `85cce04`-era spike had proved ghosttea's
ConPTY backend hosts a real terminal on the box; this rung makes it the product path and replaces
the throwaway spike with the real suites, every one run on WORKSTATION4090.

`defaultShell` (fieldd/terminal-service.ts) falls to COMSPEC on win32 (GT-D10) instead of
`/bin/sh` — a default `terminal.create` used to die at SPAWN_REFUSAL there; a new real-spawn seam
test witnesses it. The **kill matrix runs on the box** (the §5/§6 gate): `terminal_unit.rs` is
cross-platform — the survivor-authority logic was always platform-agnostic, so only the seam
moved (MgmtClient + control dials through one `local_ipc` stream split for its halves; `alive`
via OpenProcess beside libc::kill; cmd.exe tenants; the endpoint-shape assertion and the 0600
mode loop platform-split). 14/14 on the box. One test stays unix-only, recorded at source:
`stale_endpoints_are_rebound` is a stale-socket-NODE mechanism with no Windows analogue — an
in-process pipe rebind reads ACCESS_DENIED until the holder's process EXITS (the real restart,
witnessed cross-process by the TS matrix), so it is gated, not masked. `terminal_mesh.rs`'s one
gated PTY test un-gates (cmd.exe tenant); the TS suites un-gate too — `terminal-seam` 3/3 (I/O +
the default-shell witness), `terminal-kill-matrix` 6/6 (the two-plane crash/adopt/re-arm rows are
cross-process, so they hold unchanged but for the shell).

**Two EL7 findings the box's own suite surfaced, measured not argued:** the env strip HOLDS on
Windows for exact-case prefixes (row 6 — `FIELD_`/`FIELDD_`/`GHOSTTEA_` bait stripped from a real
PTY, `env`→`set` and `HOME`→USERPROFILE by platform); but a case-VARIANT of a prefix LEAKS (row
6b — a `Field_Native_*` key survived into a live cmd.exe PTY), because ghosttea's strip decides
with a case-sensitive `starts_with` over Windows' case-insensitive env. field-native sets its own
secrets exact-case, so those ARE stripped — a defense-in-depth gap, not a live mirror-write
escape. Unfixable from the embedder (a fork-local strip is what G1 retired); **petition G13
drafted** (renumbered from the plan's provisional G15), and row 6b is an `it.fails` witness that
flips to a live pass the moment the pin consuming G13 lands. VibeField's own TS strip half was
already case-folded in WIN-3. WIN-D3 needed no petition (resolved by construction in WIN-2).

**Gate: `pnpm verify` VERBATIM exit 0** (combined tree, one process). Box (WORKSTATION4090):
terminal_unit 14/14 · terminal_mesh 7/7 · terminal-seam 3/3 · terminal-kill-matrix 6/6 — the
ConPTY kill matrix, the two-plane adoption, the frame-plane I/O, and the EL7 witnesses, all on
real Windows.

## WIN-5 — the app boots on Windows (the headless smoke gate)

**LANDED 2026-08-11 `51aa3ab`.** `pnpm smoke` — the Electron shell launching, spawning the
fieldd/field-native pair over named pipes, the renderer loading, all five units up — passes on
the box (WORKSTATION4090) with ZERO app code: the WIN-2/3/6 daemon+terminal work already carried
the app onto Windows. This commit only makes the proof reproducible: smoke-like modes call
`app.disableHardwareAcceleration()` (a CI runner or ssh session on Windows has no window-station
GPU, and over ssh Chromium's GPU init fails outright), `isSmokeLike`-gated so the production path
is untouched. Proven both ways — `pnpm smoke` green headless over ssh on the box (no manual flag),
still green (software-rendered) on mac. `--smoke-godview` additionally boots the FULL deck on
Windows (renderer canvas2d, swarm monitor 9 agents + physics worker, a LIVE terminal that echoed
via WIN-6's ConPTY); its only failing assertion is the harness's own `echo $0` unix-ism (cmd.exe
has no `$0` — the pane genuinely IS cmd.exe, resolved by login-shell.ts's COMSPEC arm), left
unported as a test curiosity. WIN-5's remainder is visual polish (WIN-D9 chrome, tray `.ico`,
forced-colors, the "Shift" glyph) — an eyeball, not porting. Gate: `pnpm verify` VERBATIM exit 0;
box: `pnpm smoke` exit 0 headless over ssh.

## WIN-7 opens — the mesh finds its sidecar on Windows

**LANDED 2026-08-11 `edd5882`.** The truffle sidecar resolver (`services/mesh.rs`) searched only
the unix names `sidecar-slim`/`truffle-sidecar` in unix dirs — on Windows the binary is
`sidecar-slim.exe`, so the resolver would never match the file beside `field-native.exe`, and the
mesh could not start even once a tailnet key were present. `SIDECAR_NAMES` is now cfg-split (`.exe`
on windows), the search adds `%LOCALAPPDATA%\truffle\bin` and cfg-gates the unix dirs
(Library / .config / /usr/local/bin). A `#[cfg(windows)]` test witnesses the resolution on the box
(it finds `sidecar-slim.exe` under a temp `LOCALAPPDATA`). This is WIN-7's autonomous half; the
live tsnet-vs-host-Tailscale coexistence spike and the Mac↔Windows two-device witness (docs sync,
remote attach) still need a tailnet auth key (James's). Gate: `pnpm verify` VERBATIM exit 0; box:
field-native mesh unit tests 3/3 incl. the new witness.

## WIN-9 — the review's five defects, and the gate that was never green

**LANDED 2026-08-11 (this commit).** An onboarding review of the WIN stack
(five read-only agents over the Rust plane, the fieldd pair, the ConPTY rung, the tooling/merge, and
a hazard sweep) plus the first `pnpm verify` ever run on the box found five real defects. Every fix
carries a control run — the row was made to FAIL before it was allowed to pass — because two of
these had test coverage that was green while the defect shipped.

**The `e333d9c` merge itself is clean** and that was checked first: the net delta over `origin/main`
is exactly `.gitattributes` (a comment block) and James's `generate-icons.mjs` win32 fix, coherently
blended, no conflict markers, no daemon code touched. His `check-release-identity.mjs` half was
correctly dropped for upstream's WIN-0 version, a strict superset with the injectable self-test.

**1. The production CSP refused the renderer's own socket — and it was never a Windows bug.**
`buildCsp("production")` enumerated `PORTS.FIELDD_WS_CONTROL`/`_DATA` (9410/9411) while **UA-D12/UA-5
made every pair bind ephemeral** (`main/fieldd.ts` passes `controlPort: 0, dataPort: 0`; registries.ts
calls those values a legacy documentation default). Chromium blocked the dial, `FielddClient`
reconnect-looped without ever rejecting `ready()` — it has no terminal state for a refused socket —
and `doc.list`, the first renderer→fieldd request, timed out at 8 s into a degraded docs session.
Dev returns a null CSP and every smoke mode already used the loopback wildcard, so **only `electron .`
took the pinned branch: this reproduces in production mode on macOS at the same commit.** The box was
merely the first place production mode was eyeballed after UA-5c. Naming the port is structurally
impossible — the policy is installed before the first window exists (ESP §6.2) and the window
deliberately does not wait for the daemon (design-03 §4.3) — so the fix admits the loopback host with
the port open, the aperture smoke already ran on. **Its own test had pinned the defect**, in a row
named *"never widens connect-src to the loopback wildcard"*; the replacement rows parse the directive
and ask whether a real ephemeral port would be admitted, which is the question that went unasked.
The handoff doc's two hunches are corrected at source: `doc.list` rides the SHARED control client
(the doc lane is dialled only after a successful `doc.open`, never reached), and "the control WS rode
in fine" was never established — the connections that worked were main-process **Node** WebSockets,
which bypass both the CSP and the Origin gate. *A green supervisor probe proves nothing about
renderer reachability.*

**2. THE GATE was red on every clean checkout, including CI.** `bundle:assert` asserts that
`dist/main/index.cjs` and `dist/preload/index.cjs` exist but built only the RENDERER; nothing earlier
in `verify` builds the shell (`typecheck`/`test` carry no `dependsOn: build`), and `verify.yml` is
checkout → install → verify with no build step. So the ledger's repeated "`pnpm verify` VERBATIM exit
0" only ever held on trees with a warm `dist/`. Pre-existing since `fc78b84` moved bundle:assert into
the gate, platform-independent, and never recorded. `bundle:assert` now builds the bundles it grades;
control-run by deleting `dist/main`, `dist/preload`, `dist/testing` and watching the old form fail
with the exact CI error before the new form passed.

**3. win32 group-kill orphaned every MCP stdio server.** `process.kill(-pid, sig)` does not misbehave
on Windows, it **throws ESRCH** (measured), so the ladder fell through to `child.kill()` — one
process. Since `spawn-shim` routes every `.cmd`/`.bat` target through `cmd.exe /d /s /c` (npx, uvx:
how MCP servers are configured), the pid fieldd tracks is the SHIM and the server is its child, which
survived its plugin's kill, its disable, and fieldd's own shutdown — §17.1 broken for the commonest
Windows child there is. `killPlan` now issues `taskkill /PID <pid> /T /F`, resolved absolutely from
`SystemRoot` (a bare name would resolve through an inherited PATH; EL7). The TERM→grace→KILL ladder
is skipped there rather than performed twice, because Windows has no catchable termination signal —
the same honesty WIN-0's dev-runner adopted. **Two measured facts kept at source, because both
mislead:** libuv puts every process a Node parent spawns into a job object that dies with the parent,
so a node-in-the-middle fixture tears its own grandchild down for free — *the first version of the
regression test passed with the fix reverted*, and the witness now uses a real cmd.exe/sh shim; and
`taskkill /T` walks LIVING parents, so a grandchild orphaned before the kill is still out of reach.
**The ROADMAP's "group-kill → Job Objects" booking is narrowed, not paid.**

**4. The meshdata byte lane still dialled a filesystem path.** `daemon.ts` resolved it as
`join(dataDir, ...LAYOUT.MESHDATA_SOCKET)` while field-native binds it as a named pipe under WIN-D1,
so on win32 it could only ENOENT — inside `connect()`'s best-effort catch, taking cross-device doc
sync down **silently** the moment WIN-7's mesh witness turned it on. The mgmt-only helper generalized
to `nativeEndpoint(dataRoot, socketFile)`, so every channel resolves through one law; a per-channel
copy of that law is exactly how this survived.

**5. `pnpm dev` silently watched only a plugin service's entry file on Windows.**
`service-graph.mjs`'s bare-specifier filter `/^[^./]/` also matches a DRIVE LETTER, so it externalized
the entry point, esbuild refused the build ("the entry point cannot be marked as external"), and the
resolver's `catch` returned null — `critical-changes.mjs` then fell back to `[serviceEntry]` and no
sibling module of any plugin service triggered a rebuild. Its sibling row ("returns null when the
entry cannot be resolved") had been passing for the wrong reason the whole time.

**The five mac-shaped suites.** `logging`, `users`, `fieldd-supervisor`, `electron-shell` and
`dev-runner` had never been ported: POSIX path literals compared against `join()` output, unix
mode-bit assertions (`chmod` flips only the read-only bit on win32), sun_path rows calling the guard
with no explicit platform so a win32 host took its early return and asserted nothing, and symlink
fixtures needing Developer Mode. Fixed by FIXTURE wherever the subject was platform-neutral — which
was most of them, and in `app-protocol.test.ts` genuinely load-bearing: its `fakeFs` keyed on
`/`-shaped strings, so the symlink-escape and missing-file **security** refusals had silently become
200s on win32. Skips only where the behavior does not exist there, each naming its reason. Two rows
in `crash-artifacts.test.ts` that returned early and counted as PASSES are now honest skips.
`fieldd-supervisor/src/paths.ts` gained the `posix.join` its fieldd twin already documented.

**The teardown that reddened two clean suites.** `cross-daemon` and `mesh-lane` failed the full run
with `EPERM` removing their temp roots while passing in isolation — zero assertion failures. Same
class as defect 3, in the harness: `c.kill("SIGKILL")` reaches one process, field-native spawns its
own children, and Windows refuses to remove a directory anything still holds open. `killDaemonTree`
joins `native-harness.ts` (the test-local authority) and both suites use it.

**6. And behind them, a real one: an atomic document save can fail on Windows.** With the harness
fixed, the next full run surfaced `document storage append failed: EPERM ... rename
current.json.tmp-… -> current.json` from `doc-service`'s `atomicWrite`. POSIX `rename(2)` replaces an
open target atomically; Windows `MoveFileEx` refuses while ANY handle is open on the destination, and
the holder is typically not us — a scanner, the indexer, a backup agent touching `current.json`
microseconds after we wrote it. **On a user's machine that is a lost document save, not a flaky
test**; the suite merely widened the window by running everything at once. This was named as a
Windows risk before the port began (`thinking-windows-port.md` §7.4, "`renameSync` over an open
target → one deliberate Windows test") and never closed. The rename now retries a bounded ~315 ms on
EPERM/EACCES/EBUSY (win32 only), which is the documented cure and the same reason Node's own `rm`
grew `maxRetries`. Atomicity is untouched — each attempt is the same all-or-nothing rename — and a
genuinely locked file still fails loudly. **Diagnosed honestly rather than assumed:** both suites
were re-run in isolation with the changes stashed AND applied, passing three times each way, which
is what established the flake as pre-existing and load-dependent rather than a regression from this
slice. The sibling publish paths §7.4 also named (users.json, log segments, the audit chain) are
NOT covered by this fix and remain open.

**Gate:** `pnpm verify` VERBATIM on the box (WORKSTATION4090) — the first green run of the real gate
on Windows. `pnpm smoke` exit 0 (shell + pipe-joined pair + renderer + all five units).

## WIN-10 — the two guarantees POSIX gave for free, rebuilt for Windows

**IN THE TREE 2026-08-11.** WIN-9 closed the defects a review FOUND; this closes the two it left
NAMED, both of them cases where a law held on unix by accident of the filesystem and held nowhere on
Windows. Three agents on disjoint packages plus the orchestrator, every fix with a control run.

**1. Nobody was proving the SERVER (mutual pairing auth, WIN-D10).** D8's MAC proves the CLIENT to
field-native. Nothing proved the reverse, and on unix nothing had to — the socket sat inside a 0700
run directory, so only the owner could have created the thing answering. WIN-D1's pipes have no such
boundary: the namespace is flat and machine-wide, the scope is a hash of a guessable data root, and
another local account can publish our name before field-native does. fieldd's connect-probe then
reads that squatter as a live native (so no real one is spawned) and believes its ack — **terminal
control/frame endpoints and the floor's auth token included**. The client now sends a
per-connection `nonce`; the server answers `serverMac = HMAC(secret, "fn-ack" 0x00 nonce 0x00
bootId)`, a DIFFERENT context from the client's `fn-boot` so neither direction's transcript replays
as the other's (asserted, not merely intended). **Both** channels carry it: mgmt, and the meshdata
byte lane — no token rides the lane, but a squatter there feeds fieldd forged document bytes that
Loro merges as genuine. The field is optional on the wire and **mandatory in the client**, because
tolerating absence is exactly the downgrade an attacker would request; the cost is that a
field-native predating this must be restarted once, and the refusal says so. Pinned by
`fixtures/pairing.vector.json` on both sides. Witnessed by 5 mgmt rows (valid · absent · forged ·
wrong-secret · and that no terminal endpoints are adopted from an unproven ack), 2 meshdata
squatter rows, and the real Rust bridge end-to-end. **Not fixed, and honest about it:** a squatter
holding the name makes field-native's `first_pipe_instance` bind fail closed — refusal to boot, not
compromise. The scheme rests on the pairing secret staying unreadable, which the per-user `%APPDATA%`
ACL provides: the pipe namespace is shared, the profile is not.

Silence was the remaining attack — the proof check never runs if nothing answers, `connect()`'s
budget is re-checked only BETWEEN dials, and no request carried a deadline, so a stalling endpoint
hung a standalone boot forever. The hello now has one.

**2. `mode` is a no-op, so EL7's "private at rest" had no Windows expression at all.** `mkdir(…,
0o700)` and `chmod(0o600)` set the READ-ONLY attribute and nothing else — NTFS has no permission
bits. Log segments, the audit chain, crash dumps (raw process memory), `users.json` and
**`shell.token`** — the credential granting full daemon adoption — all landed with whatever ACL they
inherited. WIN-9 had made this VISIBLE by win32-skipping the mode assertions, which left nothing
asserting it. `@vibefield/logging`'s new `private-fs` is now the one authority: `createPrivateDir`
applies an owner-only DACL (`icacls /inheritance:r /grant:r`) to the private ROOTS and lets children
inherit — directory-level because a per-file edit would spawn a process per rotated segment, and
memoized per path per process because callers re-run it on every re-open. Applied on first touch
rather than only on creation, so an install predating this is **repaired** rather than left with its
old grants. Consumed by logging, audit, users, crash-artifacts, and fieldd's run dir (where
`shell.token` is now BORN private by inheritance — no window between create and restrict).
**Both platforms now assert privacy in their own true terms:** the POSIX mode rows stay, and win32
rows read the ACL back and require exactly one account, the right inheritance polarity, and none of
Everyone / BUILTIN\Users / Authenticated Users / Administrators.

> **Correction (2026-08-24, the post-merge box round):** the grant principal was built from
> `%USERDOMAIN%\%USERNAME%`, and USERDOMAIN is a SESSION fact, not a token fact — an sshd service
> session on this workgroup box exports `USERDOMAIN=WORKGROUP` while the token's authority is
> `workstation4090`, so every `createPrivateDir` asked icacls for `WORKGROUP\me`, no LSA mapping
> exists for that name (error 1332), and the fieldd-client, audit, logging and users ACL rows all
> failed over ssh — the very sessions the ship-rerun gate rides. Whatever session shape this slice's
> own green round used did not expose it. The grant now uses the TOKEN's SID (`whoami /user`,
> memoized, `*S-1-…` ACE — no name resolution anywhere), and the test helper reads the same identity.

**A bug this slice wrote, caught by its own control run and worth recording.** The first
`restrictToCurrentUser` used `(OI)(CI)F` for every path. Those are CONTAINER inheritance flags:
applied to a FILE, icacls exits 0, prints "Successfully processed 1 files", and produces an **empty
DACL** — the owner then gets EPERM reading, rewriting, and deleting its own file. Had `shell.token`
taken that path the shell could not have read its adoption credential and fieldd could not have
cleaned it up. The helper now picks the ACE form from what the path IS, measured both ways on the box.

**Also closed here:** the MCP stdio door skipped the `executableAllowed` policy the process door
enforces (two doors into one subsystem disagreeing); `isUnderRoot` compared paths case-sensitively on
case-insensitive NTFS (fail-closed, so robustness rather than a hole); five synchronous commit points
(`artifact-service` ×3, `link-service`, the doc-registry quarantine) kept the plain `renameSync` whose
win32 sharing-violation WIN-9 had just closed for the async path — `durableRenameSync` covers them,
with a deliberately tighter budget because its wait blocks the thread.

**Four of five win32 symlink skips became REAL tests.** They had been skipped because `symlinkSync`
needs Developer Mode — but a **junction** needs no privilege, `lstat().isSymbolicLink()` reports one
as a link, and a junction is the live Windows form of that attack. The fifth stays skipped for a
precise reason: it plants a link AT A FILE PATH POINTING AT A FILE, and a junction is a directory
link, so the guard under test would refuse it on the `isFile` clause and the row would prove
something other than its name. One row was also strengthened: it asserted `skippedUnsafeEntries === 0`
on win32, so the scan-time symlink branch it exists for had never run there.

**R16 amended deliberately** (`check-import-boundaries.mjs`): the wall claimed audit has "filesystem
authority only, never network/process authority", and the second half went transitively false the
moment audit's root needed a DACL, since Node exposes no ACL API. The mechanical rule is unchanged —
audit still may not import `child_process` itself — but the CLAIM now states the authority audit
actually has. One helper, named; a second is a decision, not a precedent.

**And the gate itself was never trustworthy on this box, which is why nobody had seen it.** The full
fieldd suite failed ONE real-daemon e2e row per two-to-three runs — a different row each time, every
one green in isolation. Attributed rather than assumed: the same measurement at the pre-WIN-10 commit
also failed 1 in 3, so it is **pre-existing**, not a WIN-10 regression. `vitest.config.ts` already
carried the mechanism and the reasoning — `fileParallelism: !CI`, because "on CI's starved cores that
contention trips vitest's internal worker RPC" — and win32 needs no separate argument: a Windows
process spawn costs orders more than a POSIX fork, these suites spawn real field-native children by
the dozen, and Defender scans each. Serial: 3/3 clean, 472 passed. Cost is ~15 s → ~115 s for one
project, taken deliberately, because a gate that fails two runs in five teaches people to re-run
until green — which is exactly how a real failure gets waved through.

Serialising removed most of it but not all: under full-gate load one run still reddened on the
`afterEach` `rmSync`, not on an assertion. That is HOUSEKEEPING, and the split is now explicit —
`killDaemonTree` still AWAITS the real exit, so "did the daemon die" stays a hard question, while
`removeTempRoot` gets a generous budget and then reports a surrender instead of throwing. Windows
releases a dead process's handles asynchronously and a scanner can hold a just-written file longer
still; a leaked directory under `%TEMP%` is not a product defect and the OS reclaims it, whereas a
test file that fails after every assertion passed is a lie about the code.

**Side-finds:** the VibeField root was created 0755 on POSIX too, by a bare `mkdirSync` nothing ever
tightened — fixed on both platforms and pinned by a row whose fixture starts at 0755 so it cannot go
vacuous. Still open and recorded: `artifact-preview-capture`'s thumbnail commit still uses a plain
rename (a lost thumbnail is a blemish, not evidence); `McpService.startServer` has no production
caller yet, so its door is test-reachable only; and the stale "proven by the packaged gate" comment
survives in four fieldd test files (audit's copy was corrected at source).

## WIN-11 — the Godview deck's smoke passes on Windows, and two product findings fall out

**IN THE TREE 2026-08-11.** `pnpm smoke:godview` — the deck harness, the fullest end-to-end proof
this repo has — had never passed on Windows. WIN-5 recorded its one failing row as "the harness's own
`echo $0` unix-ism … left unported as a test curiosity". It was not one row. Behind it were four more
harness unix-isms and, once those were fixed, **two genuine product limitations that no other gate
would have surfaced**. The deck now exits 0 on the box.

**The harness was asking Windows questions in sh.** (1) `echo "marker:$0"` — sh strips the quotes and
expands `$0`; cmd.exe echoes them VERBATIM, so the row read `$0"` and failed against a pane that was
already the right shell. win32 now asks `%COMSPEC%`, which still DISCRIMINATES: only cmd expands a
`%VAR%`, so a pane regressed to PowerShell writes the literal and fails exactly as an `sh` pane would.
(2) The split chord was pressed as ⌘D's KEY with the platform's modifier — `ctrl+d` on Windows, which
the deck does not bind and the SHELL does (EOF). Read from upstream's own fixtures instead of guessed:
`keybinds-linux-default.json` binds `ctrl+shift+o` → `new_split:right`. (3) `;` chains commands in sh;
cmd.exe treats it as an argument, so a marker was never written and the wait could only time out.
(4) A bare `cd` on win32 changes the directory ON A DRIVE without switching drives, so a scratch dir
on `C:` was silently not entered from a pane sitting on `D:` — this repo's own drive.

**Finding 1 — a Windows user cannot close a split pane by keyboard.** Upstream's macOS defaults bind
`super+w` → `close_surface`; the Linux/Windows defaults bind **no `close_surface` at all**
(`ctrl+shift+w` is `close_tab:this`, a different verb that would take every pane in the tab). The ⌘W
ARBITRATION that row is mostly about is likewise macOS-only: on Windows the application menu owns
`CommandOrControl+W` and the deck claims nothing, so there is no chord for the two to contest. Recorded
in the verdict as `closePaneChord: "unbound on this platform"` rather than skipped silently. It needs a
shipped binding of ours or an upstream default — a WIN-5 keyboard-cluster item, now evidenced.

**Finding 2 — pane-cwd restore does not work on Windows.** A pane's cwd is only ever what its shell
ANNOUNCES over OSC 7; the spawn directory is never reported. zsh and bash announce on every prompt.
**cmd.exe emits no OSC 7 at all**, so the floor cannot learn where a pane sits, `paneMeta` persists no
cwd, and a restored pane comes back at HOME rather than in its folder — GT-3's restore promise
degrading on Windows, exactly as the WIN recon predicted for `deck-restore.ts` and now measured end to
end. The row records `cwdRestore: "unavailable: cmd.exe announces no OSC 7"`.

**What the deck DID prove on Windows**, which is most of it: renderer on canvas2d, the swarm monitor
with 9 agents and physics in its worker, a live cmd.exe pane that echoes, the ownerless-birth flip to
keep-until-exit on both the first pane and the split, claim-existing, silent restore across a document
death, the two-step kill chip, the `config.ghostty` write with a live reload and its survivors, glass
at 0.82 with a CRT shader that left the config alone, **bridge-SIGKILL recovery** (pid 86280 → "the
terminal bridge died — rebuilding" → 3 panes recovered), the mock-agent label discipline, the remote
section serving honestly, and the perf legs — cold open 460.8 ms, warm 53.5 ms, keystroke echo 16 ms.

## P8a — the plugin artifact stops being a promise

**LANDED 2026-08-11**, the first rung of `thinking-p8-loadable-artifact.md` (destination
ratified the same day: **agents author widgets** — the four-views Widget Builder).

Every widget-bearing manifest had named `entries.renderer: "./dist/renderer.js"` since C1d while
nothing produced it: `plugin-build` had no `bin` and only three of §5.4's four stages, and no
plugin declared a build script. `externals.ts` had been written for consumers that did not
exist — its header names "the renderer library-mode bundle, the esbuild service bundle, and the
pack-time duplicate-singleton check" as the importers of `HOST_SINGLETON_EXTERNALS`. This slice
built those three consumers.

`plugin-build` now ships a `bin` and stages: **renderer bundle** (vite library mode, one ESM
entry, PA-29 singletons left BARE for §11.6 to bind, Tailwind compiled into `dist/renderer.css`),
**service bundle** (esbuild, Node target, self-contained except the SDK runtime), and **artifact
checks** (declared entries exist; no bundled singletons). All five plugins declare
`"build": "plugin-build"` — the spec's zero-config script, exactly as written — and each carries
`nx.targets.build.outputs`, because Nx caches `build` and infers no outputs for a package script:
a cache HIT would otherwise skip the build and leave `dist/` absent for whatever reads it next.

Measured: note 2 KB, field-tools, widgetlab 84 KB, browser 225 KB (unminified on purpose — a
distributable plugin is REVIEWED at rung R1, and the reviewer reads these bytes). Externals came
out bare and correct: `react`, `react/jsx-runtime`, `@vibefield/plugin-sdk{,/ui,/canvas}`,
`three`, `@react-three/drei`. Plugin stylesheets carry the plugin's own rules plus the utilities
it uses and **no preflight** — a plugin loads into a page the host already reset, and shipping
preflight from inside a plugin would restyle the host's DOM.

**Two defects found by building, not by reading.** (1) Node's type stripping refuses parameter
properties, so `constructor(readonly stage)` died in the bin — the same erasable-syntax law that
took param properties out of fieldd-client at P5; and its twin, extensionless relative imports,
needed the `.ts`-retry resolve hook copied from `service-worker-harness.mjs` rather than a second
answer invented here. (2) **`export * from "./build"` in the barrel broke the daemon build**:
fieldd imports this package for `canonicalJson` (§9.2), bundles with esbuild, and the barrel
dragged vite plus Tailwind's native `oxide .node` binary into a daemon artifact. The build stages
now live behind `@vibefield/plugin-build/build`, never the door the runtime uses — the same
barrel lesson the design-kit `sideEffects` fix taught a day earlier, in a package that had no
reason to expect it. `pnpm verify` would not have caught this; `pnpm build` did.

**The PA-29 control, and why the obvious one is worthless.** Removing `react` from the externals
list to force a bundled copy proves nothing: the bundler config and the check read the SAME
constant, so that edit disables both — measured (react bundled, linked modules 5 → 9, check
silent). The honest control imports a singleton **by relative path** into a fixture's own
`node_modules/react/`, which the bare-specifier matcher never sees and the check must still
catch; it is a permanent test rather than a one-off experiment. The predicate's other half —
that the SDK, the one singleton every plugin imports, resolves to a workspace source tree and so
needs its own marker — is unit-tested beside it.

Deliberately not done: kv-service keeps its hand-written `service.js` (the stage reports it
"prebuilt, not bundled"), because migrating it would make `pnpm test` depend on a build step;
the service stage is proven by fixture instead. Manifest emit stays in `gen:manifest` rather than
folding into `build` — the canonical artifact is freshness-pinned and must not gain a second
producer behind a cached target; build READS it and names the command that writes it. Both are
recorded deltas from §5.4's four-stages-one-command.

**Gate: `pnpm verify` VERBATIM exit 0** plus `pnpm build` green (which now produces plugin
artifacts as part of the desktop build). Next rung: **P8b, the staged loader** — the reason the
artifact still does not load.

## P8b-1 — who is allowed to load a plugin, answered before anything loads one

**LANDED 2026-08-12.** The planned design for this rung was WRONG, and the code said so before
the spec did.

`thinking-p8`'s P8-D1 proposed serving staged modules from the existing `vibefield-app://shell`
origin under a second confined mount at `/plugins/<id>/<manifestHash>/renderer.js`. Opening the
file to implement it surfaced `app-protocol.ts`'s own header: *"the reason a `plugin://<id>/<path>`
resolver must never be modelled on this one — plugin bytes come from a fieldd generation-bound
mapping, not from joining a path onto an ID we were handed."* That points at
**`specs/electron-security-packaging.md` §8.4**, which is law and had already answered the
question. **P8-D1 is withdrawn at its source with the reasoning error named:** it was argued from
the CSP end (*what does `'self'` admit?*) when the governing question was the authority end
(*who decides what loads?*). A serving decision in this app is a registry decision wearing a
transport costume, which is why the corpus files it under security-packaging rather than beside
the thing that serves bytes.

**P8-D1′, as built.** fieldd is the authority; Electron main is a dumb server; the renderer holds
URLs and never paths.

- **`plugins.modules`** (scope `plugins.read`) returns the renderer-safe projection —
  `{pluginId, moduleUrl, styleUrl?, manifestHash, installRevision}` on the new
  `vibefield-plugin://` scheme. There is nowhere in the shape to put a path, which is the point:
  a projection cannot leak what it has no room for. It also finally carries the hashes
  `ctx.plugin` has been missing since P3.
- **`plugins.resolveModule`** (scope **`plugins.serve`** — new, and deliberately one the renderer
  never holds) resolves ONE opaque token to `{path, contentType}` for the **shell-main principal
  only**. It is the single method that returns a filesystem path, so scope is necessary and not
  sufficient: the handler gates on principal kind on top of it (§11.2's rule, applied where it
  matters most).
- **Tokens are minted, never derived** — 128 CSPRNG bits per (plugin, file, generation). A token
  derived from an id or a manifest hash would survive a revocation that changed neither.
- **Invalidation is structural, not remembered.** The registry already bumps a `generation` on
  every snapshot move; the token table is rebuilt whenever the generation it was minted under is
  no longer current, so a superseded token is *absent* rather than *revoked*. That satisfies
  §8.4's "every URL is invalidated on disable, reload, quarantine, or install-revision change"
  with no subscription, no cache, and **no staleness window** — the reason main pulls per token
  instead of holding a pushed map.
- The URL is `vibefield-plugin://<token>` with **no path segment at all**: there is nothing for a
  caller to join onto. The scheme lives in `contracts/registries.ts` rather than beside
  electron-shell's `APP_SCHEME`, because fieldd mints these URLs and main serves them — a scheme
  spanning the daemon and the shell is wire truth, while one only electron-shell uses is not. And
  it is deliberately NOT the product origin: §8.4 requires the CSP to admit "only the chosen
  plugin module origin", which is a sentence you can only say about an origin that is not already
  `'self'`.

Six tests, one per §8.4 clause, including **the invalidation control run as a control**: mint a
token, disable the plugin, watch the same token resolve to nothing; re-enable and watch a FRESH
token appear while the old one stays dead — so a URL that leaked while a plugin was enabled cannot
be replayed after a disable/enable cycle. The path-free claim is asserted by serializing the whole
projection and proving no path shape survives anywhere in it, rather than by checking the fields
someone remembered to look at.

**Gate: `pnpm verify` VERBATIM exit 0.** Scopes do not enter the Rust bundle, so `pnpm gen`
produced no delta (checked, not assumed). Next: **P8b-2**, the `vibefield-plugin://` scheme in
Electron main — a handler that serves only what this authority approved — then P8b-3's import map
and async activate.

## P8b-2 — the dumbest handler in the process, on purpose

**LANDED 2026-08-12.** `vibefield-plugin://` is now a registered privileged scheme with a
handler that knows nothing about plugins. It has no root, no id, no manifest, no directory —
only `token → bytes`, answered by asking the daemon that does know. §8.4 says main "may serve
bytes only from a pre-authorized, generation-bound mapping" and "MUST NOT discover plugins or
decide grants", so the handler's whole claim is that it adds nothing to the decision.

**The URL is one datum and the parse is strict about it.** A module URL is
`vibefield-plugin://<32 hex>` and nothing else: a path segment, a query, or credentials each
get their own named refusal class, following the app scheme's precedent that the reason is
evidence while every response is an identical 404. `path-present` matters most — with the token
as the entire address there is nothing to join a path onto, which is the shape ESP §8.4 warns
about by name. Ten refusal rows, one per class, plus the assertion that a malformed URL never
costs a round trip to the daemon.

**Scheme privileges mirror the app scheme's**, with `bypassCSP: false` carrying the weight:
plugin code is subject to the document's policy exactly like ours. The CSP now admits
`vibefield-plugin:` on `script-src` and `style-src` and nowhere else — which is a sentence that
can only be written because the scheme is NOT the app origin. Admitting plugin bytes never
widens what `'self'` means for the product document.

**Two defects the tests caught, and they were different in kind.** The handler did not catch a
throwing `authorize`, so an unreachable daemon would have escaped the protocol handler as an
unhandled rejection instead of becoming a 404 — fixed at the seam rather than relying on its
caller, which happens to catch too. And one refusal-table row was simply MY expectation being
wrong: `vibefield-plugin://evil@<token>` parses with the token still in the host, so the
credential check must fire before the token test or the URL would be accepted as legitimate.
The code was right; the test row was corrected to `credentials-in-url`.

**A hazard found while writing the server half, fixed on the authority side.** fieldd's
mint-time containment compares path STRINGS, so a same-uid process (EL7) could swap
`dist/renderer.js` for a symlink AFTER a token was minted and the check would never notice.
Main cannot catch it — catching it needs the plugin root, and main knowing a root would be main
discovering plugins. So containment is now re-proven with `realpath` on the authorizing side at
the moment the answer is given: a link planted after minting is refused on the very next
request. Control-run both ways — authorize, plant the link, authorize again (refused); with the
check removed the row goes red exactly there. A companion row in the electron suite documents
the boundary from the other side: main serves a symlink it was told to serve, deliberately, so
nobody "fixes" it later by teaching main about roots.

**Gate: `pnpm verify` VERBATIM exit 0** — 19 protocol rows + 7 authority rows inside it. What
remains for the artifact to actually load is **P8b-3**: the §11.6 import map (host singleton
chunks; the map is inline, so it needs a CSP hash), async `activate` with §10.4 deadlines, and
`BUNDLED` demoted to dev-only.

## P8b-3 — the artifact finally loads (and the probe that redesigned it first)

**LANDED 2026-08-13**, one arc across four commits — `0b8ad13` (rung 0a's yield) · `ded012b`
(rung 0b) · `39c165a` (the regression fix) · `608e78e` (the rung; **P8b is COMPLETE**).
Witnessed on the final sha: `SMOKE_CANVAS {"widgetTypes":21,"plugins":4,"stagedPlugins":4}` —
all four renderer plugins arrive the way a third-party plugin will (fieldd mints, main serves,
the renderer imports and async-activates) — and `pnpm verify` VERBATIM exit 0.

**The probe ruled before any loader code existed (rung 0a).** thinking-p8 §4 owed one
empirical check; a standalone Electron harness driving the REAL `serveAppRequest` /
`servePluginRequest` / production CSP returned four verdicts. (1) **P8-D9/P8-D10 REFUTED**:
the import map binds bare specifiers to APP-ORIGIN chunks even from inside a plugin-origin
module — the fetch client is the document — so no singleton serving on the plugin origin and
no derived-token class exist. (2) **The real blocker was landed at P8b-2**: `corsEnabled:
false` makes a scheme an illegal CORS *destination*, and module fetches are always CORS-mode —
ACAO/CORP header variants failed identically, so as shipped NO plugin module could ever load;
flipped to `true` with the probe row cited at the flip (Electron enforces no response CORS on
cors-enabled custom schemes — the boundary stays token secrecy + CORP + session isolation).
(3) The inline-map-under-CSP-hash mechanism was proven end to end before a line of it was
written. (4) A "no registration clobber" verdict issued that morning was **corrected the same
day as OVERBROAD** — its control row witnessed only `standard`.

**Because that fourth verdict hid the week's real regression.** Extending the probe with
`isSecureContext`/`randomUUID` rows showed a SECOND `registerSchemesAsPrivileged` call
REPLACES the secure-scheme registration while `standard` SURVIVES: since P8b-2 the app origin
kept serving its module graph and silently stopped being a secure context — ICE died at
`crypto.randomUUID` and `smoke:canvas` was red from `ad8b804` on, invisible behind a
verify-only gate. Fixed at `39c165a`: `scheme-registration.ts` — THE one call carrying every
shell scheme, both per-module register functions DELETED, and the test now COUNTS registration
calls. Standing lesson, written where it happened: a probe row refutes exactly the property it
witnesses, never the neighborhood around it.

**Rung 0b made the map's key set registry data** (opus builder): `HOST_SINGLETON_EXTERNALS`
moved byte-exact to contracts beside the new `HOST_SINGLETON_MODULE_SPECIFIERS` — the 9 plus
`@vibefield/plugin-sdk/ui` and `/canvas`, MEASURED from all five built artifacts two
independent ways (es-module-lexer ⋈ rollup `chunk.imports`, exact agreement); plugin-build's
artifact checks now refuse a renderer bundle emitting any bare specifier outside the list
(control-run: adding the alien specifier to the list turns the refusal test red).

**The rung itself** (opus builder, integrated with two fixes): eleven singleton facade chunks
on unhashed app-origin names + the deterministic inline map injected into built index.html
(vite's `preserveEntrySignatures: false` default emitted export-less chunks — one literally
zero bytes — caught and fixed with `allow-extension`); the staged loader
(`plugin-host/staged-loader.ts`) joining `plugins.modules` to registry records; a
`registerRecord` door in plugin-runtime beside `registerV1` (which genuinely re-parses V1, so
a record could never pass without fabricated fields); async `activate` under a real §10.4
deadline race; `ctx.plugin` finally carrying `manifestHash`/`installRevision`; `BUNDLED`
demoted to dev-only with dead-branch elimination PROVEN by marker strings absent from every
prod chunk. Boot graph moved 456.2→457.4 KB raw; the singleton chunks (1.6 MB, drei alone
1.58 MB — a host singleton must export the whole surface) all sit outside it.

**Integration findings, both now law-shaped.** The builder's key file never entered its
commit: `.gitignore:7 build/` matched `src/build/`, so `git status` read clean while the vite
plugin sat unadded — and the walls and biome respect the ignore too, so its first genuine lint
contact came at integration (one real R6 hit: the plugin's own `name` wore the reserved
IPC-literal prefix; renamed). Relocated to `src/vite/host-singletons.ts`. A worktree gate
witnesses the DISK, never the COMMIT — completeness is `git show --stat` against the files you
wrote.

**Remaining, named:** the seam e2e (P8b-3e, in flight — real authority wired into the real
protocol handler over a real artifact, with the disable/re-enable and symlink controls) ·
packaged discovery stays P8c/WP8 · and the census smoke sits in NO gate — two silent-red eras
in one week (the bundle class 2026-08-06→10, the secure-context class 2026-08-11→13) is a
standing hazard now recorded as a ROADMAP debt row for James's call.

## P8b-3e — the seam proves itself, and a second row proves the control

**LANDED 2026-08-13** (`089274c`, opus builder, integrated same evening — closing the entry
above's one in-flight remainder within hours of naming it). The two halves P8b-1/P8b-2 landed
with two green suites and NOTHING asking whether they agree; `staged-serving-seam.test.ts`
is that question, with **nothing double'd**: the real `PluginRegistryService` (it constructs
standalone from `{dataDir, roots}` — no daemon boot machinery), the real
`PluginModuleAuthority`, a real artifact on disk (bytes authored in a tmp dir, never built —
the P8a law), and the real `servePluginRequest` with `authority.resolve` wired STRAIGHT IN as
`authorize` — no adapter, because a resolution already IS an AuthorizedModule, so shape drift
must fail the typecheck rather than be absorbed by test glue.

Six rows: exact module bytes + type + all three security headers · the derived stylesheet ·
an unminted token → 404 · **the §8.4 control through the protocol layer** (disable → the same
URL 404s while the artifact is STILL ON DISK; re-enable → a fresh URL serves while the old one
stays dead — a URL that leaked while enabled is not replayable) · **the control's own
sensitivity check built in**: a caching `authorize` — main "remembering" — serves the disabled
plugin 200 at the same instant the honest wiring 404s it, which is exactly why §8.4 says main
asks per request and holds no map · **EL7 through the protocol layer**: `dist/renderer.js`
swapped for an out-of-root symlink AFTER minting → 404, secret bytes asserted absent. The EL7
row was mutation-probed rather than trusted: with `isContainedFile` neutered, that row ALONE
went red — the secret would have been served — and the other five stayed green (revert
confirmed empty before commit).

One production-surface addition, flagged not buried: `PluginModuleAuthority` joined fieldd's
barrel — the exports map publishes only `.` and `./testing`, so the class had been reachable
solely by a deep import its own map forbids. Plus the stale `canvas.ts` comment retired
(ctx.canvas shipped at P6 as the stopgap PA-27 retires, not "arrives at P4").

Builder findings worth the record: the fresh-worktree first-verify red is `bundle:assert`
needing one `pnpm build` (main/preload bundles absent), distinct from the electron-extraction
race; and **a piped gate lied** — `pnpm verify 2>&1 | tail` reports the PIPE's exit, and the
builder caught a real exit-1 run reading as 0 by reading the log rather than trusting the
code. The never-pipe-the-gate law, rediscovered independently, now proven from both sides.

Gates on the integrated tree: `SMOKE_CANVAS {"widgetTypes":21,"plugins":4,"stagedPlugins":4}`
re-witnessed · `pnpm verify` VERBATIM (run recorded in the docs commit that carries this
entry). **Coverage stated precisely so nobody over-reads it** (builder's own framing): no
single test spans all four stages — artifact→mint→serve with every negative is the Node-level
seam suite; serve→import in real Chromium is `smoke:canvas` (positives only); the disable→404
control is witnessed at the Node seam, not inside a live renderer — a renderer-level
revocation witness would be its own smoke-harness slice if ever wanted. **P8b is closed
whole — every §8.4 clause has a test on the real mint↔serve seam. Next rung: P8d.**

## P8d-2 — the playground is a verdict, not a bench

**LANDED 2026-08-13** (`0478f08`, opus builder; two P8d slices ran in parallel worktrees and
joined blind — see P8d-1's coordination note). `apps/plugin-playground` (the spec §5.1 slot,
placed by the spec over CLAUDE.md's packaging-roots description — the right authority call):
a Node-runnable harness rendering EVERY declared widget state of a plugin headlessly through
the REAL host path and answering pass/fail per state in the P8-D8 verdict shape. States live
at `<plugin>/playground/states.ts` (the design-block convention; absent ⇒ one default state
from prop defaults; invalid fixture props are their own refusal class, validated BEFORE
mounting). Witnessed against the repo: note 4/4 · field-tools 5/5 · widgetlab 28 pass +
**7 `skipped-gl`** (probed, not assumed: jsdom cannot host the GL island — the runner skips
`surface:"gl"` BY DECLARATION and says why, never a fake pass; the 7 GL fixtures are authored
anyway for a future GL-capable harness) · browser and kv-service report zero widgets honestly.
44 states authored across the plugins, typechecked (each plugin's tsconfig includes
`playground/`). Two narrow production deltas, both anti-copy by law: the 20-line
`@vibefield/field-app/host-kit` door (exactly `buildWidgetType` + `createFieldEngine`;
activation deliberately NOT behind it — the SDK mock host is the surface an author may reason
about) and `RENDERER_SOURCES` promoted to a plugin-build export (two readers, one
declaration). Recorded calls: captured `console.error` reports on the row but does NOT gate
(a verdict that flips on a React upgrade isn't a verdict) · R10's exemption NOT widened for
`playground/` (fixtures are import-free data today; the first fixture needing an import is
the evidence that widens it) · pre-existing, not this slice: vitest prints
`THREE.WARNING: Multiple instances of Three.js` on field-app's own suites too. Gates:
verify VERBATIM exit 0 (worktree AND integrated tree) · runner re-witnessed on main.

## P8d-1 — the kit's front door answers in verdicts, and the docs are the schemas

**LANDED 2026-08-13** (`5cfd0b4`, opus builder). `tooling/plugin-cli` (`vibefield-plugin`,
root alias `pnpm plugin`): check · inspect · pack · dev-link · submit · release lookup ·
index sign · docs — every command speaking the P8-D8 contract (`{code, pointer?, expected?,
detail}`, `--json` NDJSON, exit 0/1/2, zero prompts, zero network), delegating to
plugin-build/plugin-sdk/contracts rather than re-implementing (pack, canonicalJson, Ed25519,
singleton predicates, mock host, schemas). **A 39-class refusal catalog in ONE typed table**
read by both the emitters and the generated refusals.md — an undeclared code is a type error —
with red-then-green controls across eleven classes (incl. a tampered index → restored).
**The generated authoring reference** (`docs/plugin-authoring/`, 7 files) is now a gen-pipeline
artifact: `pnpm gen` emits it and gen-freshness FAILS the gate when it drifts, because these
docs are the ten-minute-bar agent's ONLY input. Generated, not transcribed: field tables walk
the live zod objects; refinement rules are quoted by parsing a bad probe AT GENERATION TIME
(a probe that stops failing fails generation); the 15-row invariant table runs broken
manifests through `PluginManifestV1`; every worked example is validated before it is written;
the one hand-written table (ctx present-iff) is anchored to strings proven present in the SDK
source. Registry commands ship registry-AGNOSTIC against `fixture-registry.ts` per the design
block (the index repo is James's op). As-built findings, spec-corrected at source: **dev-link
is a dereferenced COPY, not a symlink** (probed: the registry walk keeps only real
directories, and EL7's realpath containment refuses linked artifacts — the symlink shape
could never have worked) · **the spec §5.3 per-user dev root does not exist as built**
(dev-link resolves `--root` → `FIELDD_PLUGIN_DEV_ROOTS` → the repo default; a real per-user
root is its own LAYOUT+fieldd slice, dated note at §5.3) · two latent plugin-build parameter-
property classes fixed (the erasable-syntax law; nothing had imported them through a bin until
now) · the pack exclusion of `playground/`/`test/`/`scripts/` held by construction and is now
test-pinned. Cross-slice coordination held blind: `inspect` reads P8d-2's states file
tolerantly — witnessed on the integrated tree (`"statesSource":"playground","totalStates":4`).
Gates: verify VERBATIM exit 0 · build exit 0 · 72/72 · combined-tree verify + build exit 0
with the two root aliases (`pnpm plugin` · `pnpm playground`) added at integration.

## P8d-3 — the scaffold is a working plugin, and its rehearsal caught the docs lying

**LANDED 2026-08-13** (`a3c4897`, opus builder + `a7d434f`, the orchestrator's fix for what
the rehearsal found — **the P8d kit is COMPLETE**: create → check → playground → pack →
dev-link, every command answering in P8-D8 verdicts). `tooling/create-plugin`
(`create-plugin --id vendor.name --title … --dir …`): fully non-interactive, refuses BEFORE
the first mkdir (byte-identical-target asserted; `target-not-empty` has no `--force` — the
global scaffolding law as a refusal class), id/title/widget-type validated through contracts'
own predicates, hostile-title escaping proven by test (quotes/backslashes/`${}`/newline
round-trip byte-exact). The template is plugins/note's REAL shape with substitution tokens —
manifest EMITTED at scaffold time by plugin-build's own `emitManifest` (one source of truth;
check-clean from birth including the freshness row), starter `playground/states.ts`, note's
manifest-test pattern, a self-contained tsconfig pinned against `tsconfig.base.json` drift.
**The acceptance was a full bar rehearsal**: scaffold → install → `check` 0 → `playground`
2/2 → manifest test/typecheck/biome/build all 0 — then deleted traceless (proven absent from
commit and lockfile). Builder's own red rows: an ownership-check drift from contracts'
`isOwnedName` (caught by the emit backstop, refiled as a refusal) and the escaping gap.
One shared-config edit: biome negates the token-bearing `template/` (unparseable by design),
compensated by a STRONGER gate that reads the scaffold OUTPUT (exact file list, zero
surviving tokens, unknown token throws).

**The STOP finding that justified the rehearsal** (`a7d434f`): the generated authoring docs
taught THREE calls that do not compile against the shipped SDK — bare `<CardShell>` (world +
entity are required), zero-arg `useWidgetProps` (real: `(world, entity, type)`), and
`ops.setProp` (real: `setWidgetProps(entity, props)`) — while plugins/note used the real
signatures all along; and the docs never mentioned the scaffolder, so an agent working only
from them could not discover `create-plugin`. All bar-run failures waiting (the docs are the
bar agent's ONLY input). Fixed at the generator — both fences now MIRROR
`plugins/note/src/widget.tsx`, the loop section opens with the scaffolder — and pinned
durable: `docs-anchors.test.ts` requires every taught call to appear verbatim in BOTH the
generated docs and note's shipping source, so this drift class can never be silent again.
Orchestrator's own confession in the same spirit: the integration chain briefly fell into the
pipe-exit trap the ledger recorded the night before (a piped tail masked a failed pick) —
caught by the dirty lockfile it caused, resolved unpiped. Gates on the final tree: build
exit 0 · `pnpm verify` VERBATIM exit 0 · plugin-cli 78/78 with the anchors · scaffold
witnessed on main and deleted traceless. **Remaining in P8d: the measured ten-minute bar,
gated on the mind-map pack proposal (MM-D1…D6) awaiting James.**

## PRC-0 — one ownership calculus, with honest targets

**LANDED 2026-08-15** (`7e0a0e8`; PRC-D1…D13 ratified by James: “go ahead”).
`@vibefield/plugin-runtime` now owns the dependency-free activation lifecycle core shared by the
future renderer, worker, and process adapters: synchronous single-flight close, child scopes with
pre-registered setup ownership, awaited sequential LIFO cleanup, partial-failure rollback, late
self-cleanup, exact-handle dedupe, closed-child compaction, bounded diagnostics, and a report that
never mistakes abort for quiescence. Exact structured runtime targets compare artifact, instance,
projected authority, and runtime generation while retaining broad grant generation as provenance
rather than reload identity.

The production translation caught one last semantic edge: an illegal handle transferred after a
scope is already closed briefly makes that scope non-quiescent again while its disposer runs;
`whenQuiescent()` observes that work instead of equating the monotonic `closed` authority state
with an empty cleanup queue. The package's tests consume its public barrel and pin LIFO ordering,
pre-registration, cleanup-error separation, late results, independent observer deadlines,
never-settling same-realm honesty, dedupe, compaction, bounded text/cardinality, and target equality.
Gates: plugin-runtime **24/24** · typecheck · Biome · import boundaries R1–R18 · patch hygiene.
The detailed experiment and ratified spec remain dev-local under
`draft/thinking-plugin-runtime-composability.md` and `draft/specs/plugin-architecture.md`.

## PRC-1 — renderer ownership is one tree now

**LANDED 2026-08-15** (`4831b0a`). The real renderer harness now binds every capability context to
its exact activation/effect scope. Host-created widget, command, surface, client-subscription, and
settings-subscription handles are owned automatically; exact repeated handles dedupe; labeled
`ctx.track` and child-bound `ctx.effect` ship in the SDK, its mock host, CLI activation check, and
generated authoring reference. Successful staged activation carries a host close lifetime. Failure
and timeout withdraw all publications, preserve the primary error separately from cleanup errors,
and await cleanup only to the observer's deadline.

The production integration sharpened the model twice. Close first seals the whole existing child
tree before any abort listener runs, while each descendant's cleanup still waits for its owning
LIFO record. Publication withdrawal is a separate synchronous edge: widgets, commands, and surfaces
disappear for new callers even when a later disposer is intentionally stalled; the same
identity-bound inverse is awaited once at its normal LIFO position. A timed-out same-realm setup is
reported `non-quiescent`, blocks an overlapping replacement, self-cleans a late result, and admits a
retry only after quiescence.

Gates on the landed tree: plugin-runtime **28/28** · renderer lifecycle + staged loader **20/20** ·
plugin SDK **12/12** · plugin CLI **79/79** · all four package typechecks · generated docs current ·
Biome (only the standing `void`-union advisories) · import boundaries R1–R18 zero · full field-app
**432/439** in the restricted sandbox, with all seven Unix-socket permission refusals covered by a
permitted **9/9** rerun. PRC-2 now owns the common service route-drain edge and correlated worker
deactivation acknowledgement; PRC-3 owns full window/reload/revocation target-controller wiring.

## PRC-2 — service drain and ownership share one protocol

**LANDED 2026-08-15** (`96fcd81`). Every service transition now enters one synchronous route edge:
public availability disappears, method-kind tombstones return typed `UNAVAILABLE`, new calls and
subscriptions are refused, live subscriptions receive exactly one terminal, and already-admitted
calls retain their exact worker generation for one bounded drain window. Disable no longer depends
on an incidental registry listener while reload stays callable. Worker deactivation carries a
request id plus generation, so result/log/delta/unprovide traffic cannot consume its waiter; call
drain and cooperative cleanup share one absolute deadline, followed by real worker termination.

The worker harness now consumes `ActivationScope` itself. Its product connection owner is
pre-registered before the activation child, so provider publications, client/settings
subscriptions, processes, endpoints, and inbound provider subscriptions clean in LIFO order while
exact host-issued inverses can still use the raw connection. Labeled `ctx.track` and child-bound
`ctx.effect` now have the same SDK/testing/generated-doc contract for service and renderer entries.
Process/endpoint releases and in-flight settings subscription cleanup are awaited rather than
reported complete while their inverse is pending.

Production translation found two load-bearing distinctions. A worker's synchronous `unprovide`
during drain confirms ownership cleanup but must not retire the router tombstone; final host
withdrawal does that after teardown. And route tests synchronize on the observable publication
edge, not a fixed sleep: a parallel regression run proved durable disable can take longer than a
40 ms sample to reach that edge without violating the protocol.

Gates on the landed tree: full fieldd **471 passed + 1 platform skip** across 53 files · focused
service matrix **35/35** · plugin SDK **17/17** · plugin runtime **28/28** · plugin CLI **79/79** ·
package typechecks · generated docs current · fieldd/service-harness build (347.8 KB worker bundle)
· Biome (only the standing `void`-union advisories) · import boundaries R1–R18 zero · patch
hygiene. PRC-3 now owns serialized exact-target convergence across lifecycle triggers.

## PRC-3a — exact targets now have one convergence calculus

**LANDED 2026-08-15** (`4c4755c`). `@vibefield/plugin-runtime` now owns the serialized
desired/committed controller every service/device and renderer/window adapter will consume. It
separates semantic equality (artifact + exact instance + projected authority + runtime generation)
from observation equality (semantic target + broad grant provenance): a grant change invalidates an
in-flight credential episode, while a committed semantic-equal face refreshes its stable authority
proxy without rerunning activation. Refresh failure withdraws the old candidate and makes one fresh
activation attempt.

Activation adapters prepare a private, scope-owned candidate and receive one synchronous commit
edge only after the target episode is still current. A→B→A cannot resurrect the first A; a
synchronous publication listener cannot resurrect what it superseded; async commit is refused.
Same-realm non-quiescence blocks replacement. Worker/process force advances only after a real
`terminated:true` report—callback completion and failed kill are not proof. Controller errors and
history are bounded.

The same slice adds canonical face authority projection from contracts' one
`PLUGIN_CAPABILITY_ELIGIBILITY` table, including custom capabilities, and explicitly keeps the
registry-global module-token generation out of semantic identity until an artifact-specific
approval epoch exists. Gates: production-shaped draft probe **9/9** · plugin-runtime **40/40**
including 16×40 seeded churn · plugin-runtime/field-app/fieldd typechecks · Biome · import walls
R1–R18 zero · patch hygiene. PRC-3b next makes product credentials rotatable and race-fenced;
PRC-3c/3d then bind this controller to the real service and renderer instances.

## PRC-3b — credentials rotate in place and stale leases cannot install

**LANDED 2026-08-16** (`2dbb359` + `22a4f71`; worker import correction `dbb5423`). A
`FielddClient` can now cross a credential-authority edge without changing object identity: the old
connection closes synchronously, terminal unauthorized state becomes recoverable only through an
explicit rotation, and owned subscriptions replay and re-snapshot on the new connection. Explicit
user close remains terminal. The renderer's lazy plugin-client proxy and its underlying client are
therefore stable across grant renewal rather than leaving plugin code with a dead cached object.

Lease creation and installation now carry separate observation and backend epochs. The renderer
broker converges out-of-order mint results and rejections onto the newest episode, refuses a
lifecycle-controlled response that cannot prove its grant generation, and rotates the stable
client only after the result is still current. The daemon compares manifest hash and grant
generation before and at the exact audited mint edge and returns the observed generation. Service
startup performs the same checks before and after minting; a superseded token is revoked, and a
stale episode cannot construct a worker. Both faces consume contracts' canonical authority
projection rather than maintaining another capability list.

The real service-worker integration gate found a separate PRC-3a compatibility defect: Node's
strip-only TypeScript loader cannot import constructor parameter properties. `dbb5423` rewrote the
controller field as ordinary strip-safe TypeScript, then the production worker bundle became the
standing boundary witness. Gates: credential production probe **3/3** · renderer broker probe
**7/7** · service lease-fence probe **1/1** · fieldd-client **16/16** · field-app **444/444**
· contracts **226/226** · fieldd **473 passed + 1 platform skip** · plugin-runtime **40/40**
· all affected package typechecks · fieldd production build including the worker harness ·
Biome (only standing advisories) · import walls R1–R18 zero · patch hygiene. PRC-3c now owns
the real service desired-target adapter and private provider commit.

## PRC-3c — each plugin/device service converges through one exact controller

**LANDED 2026-08-16** (`2df838b`). `ServiceHost` now gives each plugin/device service instance one
desired/committed controller keyed by install revision, manifest hash, durable device id, projected
service authority, and grant observation. Startup, enable/disable, reload/install, grant movement,
crash recovery, and shutdown therefore converge through one serialized authority instead of
competing `start`/`stop` episodes. A semantic authority change drains and replaces the worker; an
observation-only grant change retains the worker, invalidates its old product credential, installs
a freshly minted lease through a correlated worker acknowledgement, and only then revokes the old
token. Superseded refresh mints are revoked without being sent.

Provider publication now participates in the same candidate protocol. `ServiceRegistry.stage()`
validates schemas and exposes method kinds as typed `UNAVAILABLE` tombstones while keeping the
provider out of public snapshots and away from handlers. The worker must provide every declared
namespace and emit `activated`; only a still-current controller episode commits all providers at
one synchronous edge. Stale activation, incomplete provision, invalid provision, and reentrant
target movement cannot resurrect a provider. Exact candidate disposal retains PRC-2's route drain,
admitted-call deadline, correlated cleanup, and positive worker-termination proof.

The daemon's live grant cascade now distinguishes service authority from registry-wide movement:
all old plugin tokens/connections still die first, but renderer-only changes rotate the service
lease without restarting the worker or killing service-owned processes/endpoints. A real daemon +
real worker fixture opens `ctx.storage`, proves that client remains usable across renderer-only
revocation with stable worker identity, then proves a service-capability revoke replaces the worker
and the new product client succeeds. Gates: production-seam probe **3/3** · tracked controller
matrix **4/4** · real daemon/worker grant cascade **1/1** · real crash-ladder control · full fieldd
**480 passed + 1 platform skip** across 56 files · plugin-runtime **40/40** · fieldd typecheck ·
production daemon/service-harness build (1.7 MB / 369.2 KB) · Biome · R1–R18 zero · patch hygiene.
PRC-3d now owns exact renderer/window controllers and private command/surface publication.

## PRC-3d — each plugin/window renderer converges through one exact controller

**LANDED 2026-08-16** (`e747af3`). Every approved staged artifact now has one
`RuntimeTargetController` per plugin/window, keyed by install revision, manifest hash, window id,
projected renderer authority, and grant observation. Disable and relevant-authority changes close
the exact scope synchronously; observation-only movement refreshes the stable plugin credential in
place. A registry record naming different artifact bytes withdraws the old target and refuses to
run the boot-static module under the new identity—artifact replacement remains PRC-5's disruptive
barrier.

Renderer setup is private until a still-current activation commits. Commands and surfaces reserve
exact batch candidates; CSS is a detached, identity-bound candidate; stale setup cannot publish any
of them. The root publication owner withdraws the complete mutable set at one synchronous close
edge, while an open context may still acquire or release declared widgets, commands, and surfaces
later. ICE's process-global widget catalog receives one stable component facade whose implementation
follows the committed activation; fixed chrome/animation/preview metadata is checked across
replacement.

The window adapter fans every registry observation into all exact controllers before awaiting any
one of them, tracks in-flight convergence, and makes prepare-close await real quiescence before
document, engine, and product-client teardown. Same-realm work that misses cleanup remains honestly
non-quiescent and blocks close; an abort signal is never called termination. Boot installs the
plugin-client backend before behind-splash activation and owns a pre-ready close barrier, so early
window shutdown cannot strand a staged runtime. The design review also found and fixed the
late-acquisition counterexample: post-activation bindings publish through the same candidate owner
instead of remaining silently private.

Gates: disposable production-seam probe **3/3** · tracked renderer/window matrix **9/9** · changed
renderer/loader/client/boot matrix **82/82** · plugin-runtime **40/40** · field-app and
plugin-runtime typechecks · production renderer build (**39 files / 9,376,795 bytes**) · Biome
(only standing `void`-union advisories) · R1–R18 zero · patch hygiene. The restricted full
field-app run is **453/460**, with exactly the seven known Unix-socket `EPERM` cases; the last
permitted full run before the final close-barrier/late-binding additions was **458/458**, and those
additions are covered by the focused matrix above. PRC-4 now owns the behavior target keyed by
document and engine generation.

## PRC-4d — signed behavior intent reaches the renderer, still inert

**LANDED 2026-08-16** (`95da1b8`) on ICE 0.8.1 / strata 0.13.0. The never-consumed
`contributes.systems` row is now a stable structured tombstone. Signed plugin manifests instead
carry strict complete ICE behavior descriptors plus typed widget riders; fieldd projects both
verbatim into the public plugin record, including additive empty defaults for older snapshots.
Ephemeral declarations remain explicitly refused until the product presence lane exists.

`@vibefield/plugin-sdk/behavior` is a React-free authoring and binding door backed by ICE's own
`defineBehavior` and `describeBehavior`. Each private renderer candidate must bind every declared
behavior exactly once, with the exact id and canonical descriptor, before sealing. Binding remains
inert under denied grants so dormant widgets can still construct real handles and initial rider
data; only an effective `canvas.write` grant marks a row authorized for later document execution.
Missing, duplicate, undeclared, drifted, and late bindings fail closed. The activation root owns
the exact inverse, so child effects and author disposers cannot withdraw sealed catalog truth.

The same contract is enforced by the SDK mock, CLI activation check, plugin-build artifact wall,
host singleton/import map, generated author reference, inspect/refusal output, and scaffold example.
The production bundle contains the exact behavior singleton chunk. Acceptance: workspace tests
**22/22 targets**; contracts **230**, field-app **464**, Electron **564**, fieldd **481 + 1
intentional skip**, SDK/CLI/plugin-build/create-plugin **22/81/49/75**; workspace typecheck
**22/22**; preflight, one-copy dependency graph, lint, bundle assert, generated freshness, and
patch hygiene all green. PRC-4e owns the observable window catalog and synchronous sorted
durable/runtime registration batch; PRC-4f owns production conformance and lifecycle churn.

## PRC-4e — behavior execution follows exact document generations

**LANDED 2026-08-17** (`6289795`) on ICE 0.8.1 / strata 0.13.0. Complete committed renderer
candidates now publish canonical, immutable behavior rows into one window-scoped catalog. Each row
carries the exact candidate token and renderer target alongside the signed definition, code handle,
authorization, and declaration rank. Disable, relevant grant movement, candidate failure, and
window close withdraw exact identity synchronously; an obsolete disposer cannot erase a replacement.
Observation-only credential refresh retains the same token and never recomputes semantic
`canvas.write` authority from a mutable registry record.

Every committed workspace document layout lifetime now owns one `BehaviorGenerationHost`. It
subscribes before reading the catalog, validates complete truth before mutation, filters effective
grant and facade presence, and registers the canonical durable/runtime batch before
`docs.open/create` with ICE order keys plus prior breaker state. Failed additions roll back;
invalid snapshots leave committed execution untouched; close reverse-unregisters before
persistence unbind, document close, and passive engine disposal. A corrupt journal is two honest
generations: the failed one unregisters before its document closes, then a fresh nonce registers
before the quarantined blank replacement is created.

Chronic breaker memory is window-owned, bounded to 4,096 rows, and keyed without document/runtime
generation so suspension survives engine replacement. ICE behavior fault/log callbacks route
plugin/behavior/hook/entity provenance through the bounded renderer logger while generic guest
diagnostics remain intact; a broken diagnostic sink cannot interrupt authority or cleanup. The
released I18 wake path is pinned—ephemeral intent installs no guest without facade presence and
wakes after attach plus refresh—but product admission remains refused pending room transport and
the two-engine tombstone witness.

Acceptance: focused catalog/host/workspace/renderer matrix **26/26**; field-app **62 files / 477
tests**; workspace tests and typechecks **22/22 targets each**; preflight, physical singleton graph,
lint, generated freshness, production renderer/bundle wall (**480.0 KB raw / 128.7 KB gzip initial
graph**), and patch hygiene all green. PRC-4f now owns the packaged durable/runtime conformance
fixture and repeated lifecycle churn.

## PRC-4f — one packaged plugin proves the durable/runtime base

**LANDED 2026-08-17** (`9fc2de6`) on ICE 0.8.1 / strata 0.13.0. The new non-shipping
`vibefield.behavior-conformance` example declares one v2 durable behavior with a real v1 migration,
one runtime behavior, one deliberately thenable runtime breaker, and a widget pre-attaching all
three. Its canonical manifest, React-free SDK bindings, playground state, and package build use the
same author-facing surfaces as an ordinary plugin. Because `dist/` is intentionally ignored, the
vertical row invokes the production builder from committed inputs before importing only the
emitted renderer artifact; a clean checkout cannot inherit a false local precondition.

The witness discovers the manifest through `PluginRegistryService`, stages the emitted bytes with
the production renderer loader, builds the real prefab registry/engine, and connects the real
`BehaviorGenerationHost`. A fresh child process authors only durable v1 with count 41; registering
the packaged v2 code before open migrates it to 42 before first init. Three attributed thenable
faults suspend the breaker at strike 3. Six live `canvas.write` deny/regrant cycles leave zero
guests and hooks while denied, retain durable 42 and same-engine runtime 9, and reinstall the
breaker already suspended. Eight replacement engines retain durable state, restore runtime to its
declared default 7, and remain quiet after close. Across nine engines the trace balances exactly
**45 registrations / 45 unregistrations**.

The red path found one real missing middle outside the field runtime: plugin playground activation
did not pass declared behavior rows into the SDK mock or sealed behavior handles into prefab
construction, so a correct behavior plugin was unbuildable in the authoring tool. That bridge is
now wired and the fixture joins the automatic repository-plugin census. Native Node import remains
the wrong renderer witness; the shared Vite loader preserves the production singleton topology.

Acceptance: package tests **2/2**; full playground **41/41**; workspace tests and typechecks
**23/23 targets each**; six grant cycles, nine engines, and the exact lifecycle census above;
preflight; physical singleton graph (Loro 1.13.8, ICE 0.8.1, strata 0.13.0, React/React DOM
19.2.7); generated manifests/contracts/docs; lint (standing warnings only); production renderer/
bundle wall; and patch hygiene all green. PRC-4g now owns the product document-room presence
transport and two-engine remote-tombstone witness required before ephemeral admission.

## PRC-4g1 — bounded document-room presence reaches the product and native mesh

**LANDED AND PHYSICALLY CLOSED 2026-08-17** (`43929e7` + `81c21fd`) on the cumulative
ICE/strata line now consumed as ICE 0.9.0 / strata 0.13.0.
The existing ticketed document WebSocket now carries two opaque presence frame kinds without a
second room authority: fieldd derives the room only from the redeemed document connection, and
the client dispatches pushes before its persistence reply waiter. Released ICE facade presence
attaches after open/create, refreshes behavior eligibility, and closes in the evidence-selected
order: behavior unregister, ICE detach while outbound remains subscribed, then persistence and
document teardown.

One bounded `PresenceRoomRouter` owns one local generation, one newest retained snapshot, and at
most one exact inbound/outbound lane per document/peer. It shares the daemon's outbound lane-id
allocator with doc sync and uses a new MeshData barrier to fence earlier DATA before management
close. Native no longer refuses the reserved lossy class: an authenticated QUIC stream carries
OPEN/READY and graceful FINAL/receiver STOP, while shared tailnet UDP 9441 carries versioned
20-byte headers and ≤1,150-byte fragments. Reassembly retains only the newest incomplete sequence,
handles wrap/out-of-order input, and heals missing terminal UDP from the reliable final replay.
Routes are keyed by authenticated source IP plus opener lane id; direct unauthenticated fallback
UDP is refused. A receiver can reject, retire, and later reopen a lane without ghost control state,
and the bridge fences late datagrams after close.

Acceptance: all **23/23** workspace typecheck targets; focused field-app **44**, fieldd room/
doc-lane **43**, fieldd-client **8**, and contracts **25**; native lossy codec **4/4** and lane
control **6/6**; all-target Rust check; `clippy -D warnings`; formatting/patch hygiene; and the
physical ignored witness. On 2026-08-17,
`cargo test -p field-native --test quic_lane_transport -- --ignored --nocapture` passed **1/1 in
35.11 s** using the pinned arm64 sidecar. It created two uniquely namespaced ephemeral nodes and
two production-bootstrapped daemons on the real tailnet; rendezvous and first-attempt lane open
succeeded; binary records retained boundaries; a 4,242-byte ICE-shaped snapshot crossed
fragmented UDP; terminal replay deduplicated; receiver STOP retired and reopened the same outbound
id with post-reopen delivery; and taking the peer offline produced `peer-unreachable` instead of a
dangling lane. The broad Rust lib row separately passed 63 tests, ignored one benchmark, and failed
only where this sandbox refused a pre-existing fake socket bind (`Operation not permitted`).

E22 does **not** lift plugin ephemeral admission. One legal 16-facet plugin emits 66,498 bytes,
already beyond the selected 64 KiB logical cap, and runtime `ctx.write` can grow further without
producer attribution. I19 asks ICE for a descriptor-bearing, runtime-enforced facet budget; the
host will still need deterministic aggregate headroom and a packaged two-engine remote-tombstone
witness. Commit `ce43bad` keeps the stable `behavior-store-unsupported` code but corrects its
author-facing explanation to the real budget gate. PRC-4g2 remains closed until that evidence is
green (or a separately ratified fixed-width fallback replaces I19).

## PRC-4g2 — bounded plugin presence admission

**LANDED 2026-08-17** (`1fecb94` dependency consumption + `ce92023` implementation) on ICE 0.9.0 /
strata 0.13.0. The published ICE artifact adds optional, identity-bearing `maxFacetBytes` for
ephemeral behaviors. Its canonical measure is the UTF-8 JSON bytes of the complete component cell.
Default mint and every prospective merged runtime write are checked before publication; refusal
leaves no residue or preserves the last good facet, and repeated attributed overruns reach the
existing breaker/quarantine path whose I17 inverse withdraws the facet. VibeField requires the
claim for plugin declarations even though ICE keeps it optional for compatibility, and defensively
validates its finite positive shape because declaration dev guards can be disabled independently
of production byte enforcement.

E23 measures the exact installed wire before selecting product constants. Baseline is 132 bytes;
one maximal 128-byte behavior id adds 139 bytes beyond its cell claim; sixteen empty maximal-id
facets add 2,224 bytes, refuting a claims-only sum. VibeField therefore charges each claim plus a
256-byte envelope and reserves a 48 KiB plugin window beneath the independent 64 KiB transport
ceiling. A plugin must fit that window alone at manifest validation. At runtime, the document host
groups eligible ephemeral declarations by plugin, admits or blocks each group atomically in
canonical plugin-id order, and skips a group that does not fit so a later smaller group may still
run. Durable/runtime rows are unaffected; values are never silently truncated.

The boundary case is executable, not arithmetic-only. Sixteen exact-claim facets with maximal ids
charge exactly 48 KiB; with a 120-character multibyte profile, 64-character multibyte color, and
32 selected durable entities, ICE emits **48,776 bytes**, leaving **16,760 bytes** below the hard
guard. A tracked field-app test repeats a fully charged maximum-id plugin against the installed
artifact so future encoding drift cannot silently cross the transport ceiling.

The packaged `vibefield.behavior-conformance` artifact now contributes a bounded presence facet
without attaching it to a durable widget. The vertical witness rebuilds the artifact, discovers it
through fieldd, stages and seals the exact byte-bearing descriptor, installs it through the real
generation host, and connects two engines through VibeField's production document-presence
composition. The second engine observes the remote facet; live `canvas.write` withdrawal removes
the producer and the second engine observes the I17 tombstone. The legacy
`behavior-store-unsupported` code remains in the refusal vocabulary for older hosts but has no
current emitter; over-large manifests use `behavior-presence-budget-exceeded`.

Acceptance: exact published-artifact E23 probes **8/8**; all **23/23** workspace typecheck targets;
contracts **231**, SDK **23**, CLI **81**, playground **42**, and fixture **2** tests; non-socket
field-app **61 files / 473 tests**; preflight; one-copy resolution (Loro 1.13.8, ICE 0.9.0, strata
0.13.0, React/React DOM 19.2.7); generated manifests/contracts/docs; changed-file lint; production
renderer/bundle wall; and patch hygiene. The broad workspace run reached only pre-existing local
TCP/Unix socket tests that this sandbox refuses with `EPERM`; no changed-surface failure occurred.
Together with PRC-4g1's physical closeout, **PRC-4 is complete**. PRC-5/PRC-6 follow.

## PRC-E18 + PRC-5a — exact renderer identity precedes update coordination

**LANDED 2026-08-17** (`c5dcca9`). The E18 semantic model makes the multi-realm boundary
executable before changing reload: one service and two exact renderer incarnations freeze at the
synchronous ingress-close edge; a newcomer stays held; all remaining members prepare before one
logical commit epoch; and ingress stays closed through exact commit or retained-old recovery
acknowledgements. Normal host-drained close leaves without recovery, positive renderer-process
death retires only the dead incarnation and creates candidate-only forward recovery, and WebSocket
disconnect does neither. Concurrent updates, stale update ids/incarnations, replacement behind an
unproven disconnect, and every post-commit old-recovery attempt are refused. Failed candidate
external history remains visible.

Production now has the identity needed to enforce that model. Electron main mints one stable
participant id per logical window and a new incarnation for every cross-document renderer
generation. Retry in the same document preserves the tuple; navigation preserves only the stable
id; destruction retires both. fieldd requires and stores the tuple when minting the window bearer,
returns an exact echo, and ProductAPI derives it into the local-token `CallerContext`—future
participant handlers must never trust identity params. A missing/mismatched echo fails closed and
the undisclosed bearer is revoked. field-app threads the stable id into its existing renderer
target and retains the exact tuple in boot state; browser harnesses may omit it. Bounded strict
contracts pin immutable artifact identity, update phase/snapshot, frozen participant state,
prepare/commit/recover commands, and identity-free acknowledgements without advertising methods
whose handlers do not exist yet.

Acceptance: E18 **7/7** plus E13 **6/6**; contracts **45**, Electron bootstrap **10**, field-app
boot **21**, and TokenService **5** focused tests; contracts, fieldd, field-app, Electron main, and
Electron renderer typechecks; changed-file Biome and patch hygiene. The daemon product-surface
integration row was attempted but this sandbox refused every temporary Unix socket at `listen`
with `EPERM` before test logic; its changed mint cases remain a required physical/local gate.
PRC-5b landed below; PRC-5c now owns explicit candidate authority.

## PRC-5b — immutable artifact slots before disruptive coordination

**LANDED 2026-08-17** (`6817116`). Registry installation no longer deletes the live plugin root
before publishing new bytes. Each complete signed `.vfplugin` SHA-256 owns an immutable
`revisions/<sha256>/` root. Preparation privately unpacks, validates manifest id/version, replaces
artifact-supplied provenance with fieldd's verified sidecar, syncs the complete tree, and renames it
into that slot while discovery still follows the old pointer. Commit compare-and-swaps a small
versioned `.vf-current.json` against the base slot captured before preparation, then refreshes the
registry from the exact selected root. A malformed/mismatched/missing pointer fails closed rather
than falling back to stale legacy bytes.

P7 flat installs migrate without a destructive rewrite: fieldd copies the exact provenance-pinned
tree into its first revision, commits the pointer, and retains the flat bytes as an ignored recovery
copy. Boot recovery deletes only hidden staging and pointer-temp state; it never guesses that an
unreferenced revision is disposable. The public installer is now factored into `prepare`, `commit`,
and `discard`, with the old `install` behavior preserved as a back-to-back compatibility wrapper
until the PRC-5 coordinator owns the interval.

Acceptance: **7/7 new PRC-5b cases + 13/13 registry regressions**. The production signed-registry
probe packs v0.1 and v0.2, proves v0.2 is fully durable while registry/module roots remain v0.1,
commits one pointer, then proves v0.2 is selected and v0.1 remains readable. Store controls cover
legacy adoption, candidate discard/current protection, an injected interruption after pointer-file
sync but before rename, stale-writer CAS, traversal/malformed-pointer refusal, and conservative boot
cleanup. Focused fieldd typecheck, Biome, and patch hygiene pass. The existing daemon socket e2e
remains physically gated because this sandbox refuses temporary listeners with `EPERM`; actual
power-loss and Windows no-directory-fsync behavior remain PRC-5g acceptance.

## PRC-E19 + PRC-5c — candidate authority without premature discovery

**LANDED 2026-08-17** (`3fa514f`, `1602654`). Candidate preparation can now cross the old/live
registry boundary without borrowing live authority. The installer returns a code-free validated
candidate record, manifest, explicit immutable root, and complete signed-artifact identity while
live registry rows/root paths/service declarations remain unchanged. Registry-installed
`installRevision` is now the full 64-hex artifact slot rather than the manifest-hash prefix; this
distinguishes changed code/assets under an unchanged manifest.

Renderer candidate URLs remain path-free opaque grants. Each is owned by one update/plugin episode,
fenced to the exact base observation and candidate artifact/grants, and resolves only the explicit
immutable candidate root. Exact-current promotion is required; base/grant/disable movement and
disposal revoke the candidate without erasing retained live grants. Live generation rebuilds no
longer erase in-flight candidate authority.

`RuntimeTargetController` now has a generic manual publication seam: `prepareDesired()` preserves
the existing break-before-make and scope disposal laws but stops with a fully activated candidate
in `prepared`; `commitPrepared()` is synchronous and stale checked. `ServiceHost` uses it to drain
old providers, activate a worker from the explicit candidate record/root, and keep typed provider
declarations unavailable until the exact candidate row is current. Commit before pointer movement
or against a changed authority observation is refused. Discard terminates the private worker and
retained old authority can restart. Review also corrected the observation boundary: service entry
state (`active`, `inactive`, etc.) is lifecycle output, so normal drain movement is normalized out;
artifact, manifest, enablement, and grants remain fenced.

Acceptance: PRC-E19 **5/5** beside E18 **7/7** and E13 **6/6**; focused fieldd **40/40**,
plugin-runtime **42/42**, and Electron staged-serving **6/6**; fieldd, plugin-runtime, field-app,
and electron-shell typechecks; Biome and patch hygiene. No product update RPC or pointer interval was
widened. **PRC-5d is next:** replace a live renderer controller/module namespace behind the held
route before PRC-5e wires the coordinator.

## PRC-E20 + PRC-5d — renderer replacement behind one stable slot

**LANDED 2026-08-17** (`6cafd0a`). Renderer updates no longer replace the boot-created
`RendererPluginController`, which would strand ICE's already-registered widget facades. One stable
plugin/window slot now owns those facade identities while exact artifact activation sources replace
behind it. Every source defensively snapshots its code-free record and module row, defers import
until the common target controller has closed and quiesced old, and carries explicit candidate
product-client authority rather than borrowing retained-old credentials.

Preparation withdraws old commands, surfaces, styles, behaviors, and widget implementations at the
synchronous close edge, waits cleanup, imports the candidate, and stops with all new publication
private. A strict command adapter converts exact prepare/commit/recover commands to bounded,
identity-free acknowledgements; future transport must derive participant identity from the window
bearer. Commit publishes the candidate synchronously. The episode tolerates either registry-pointer
or authenticated-command delivery first, including a queued old snapshot after commit, but any
unrelated observation revokes the target. Once a commit command exists, old recovery is permanently
unreachable even if local publication fails.

The production audit added four refusal laws. A changed fixed widget projection requires a new
document generation and is rejected before old closes. Candidate source objects are cloned and
recursively frozen before the asynchronous ownership gap. A same-realm non-quiescent verdict clears
the desired candidate, so even late cleanup cannot resume import; only positive renderer-boundary
replacement may progress. Pre-commit retained-old recovery requires separately authorized bytes
under a freshly minted module URL, avoiding the disposed browser ESM namespace. External effects
from a failed candidate remain history and are never described as rollback.

Acceptance: revised PRC-E20 **10/10**; renderer controller **15/15**, participant adapter **5/5**,
and staged loader **19/19**; complete field-app **64 files / 495 tests**; plugin-runtime **42/42**;
fieldd candidate/service seams **18/18**; Electron staged serving **6/6**; fieldd, plugin-runtime,
field-app, and electron-shell typechecks; changed-file Biome and patch hygiene. PRC-5e now owns the
authenticated update-id/participant-bound candidate-client mint and revocation, trusted source
resolver, coordinator command/ack transport, pointer CAS interval, and held-newcomer admission.

## TC-S0 + TC-S1 — resource governance and floor supervision (terminal custody opens)

The terminal-custody track's first two slices, implemented from the evidence-complete spec
(`draft/specs/terminal-custody.md` v0.2, awaiting ratification; §15 pre-cleared TC-S0/S1 as
blocking on nothing). TC-S0 makes resource governance law: RLIMIT_NOFILE raised at the
floor's boot, so the rehearsed silent death at session ~#47 under launchd's 256 is
unreachable — the sabotage arm dies at 14 sessions, the real arm sails past 30 on the same
inherited limit. Create refusals classify only what is provable: openpty errnos survive the
wire and answer `fd_pressure` end-to-end; spawn-stage flattening (ENOENT and EMFILE leave
ghosttea as one string) is an upstream fact, petitioned, never guessed at; absolute shells
pre-flight to NotFound on both sides of the seam. fd/pty pressure are recovering health
states with 80/70 hysteresis; the machine-wide flock'd admission ledger (TC-L1f) derives
its root through the layout registry, reaps dead-pid entries by liveness, and holds its
two-process contention row (exactly 12 of 24 asks admitted; LOCK_EX→LOCK_SH fails it). The
per-class scrollback caps gen into Rust but stand UNENFORCED — ghosttea 0.9.3 has no
per-session knob; the ask is recorded.

TC-S1 closes the oldest as-built gap: design-00 §4.2's "fieldd restarts it" now exists.
The supervisor respawns a dead floor behind the double-spawn probe under bounded intensity
(3/60s), escalating to the permanent honest "gone" with `system.native.restart` as the
affordance — which probes liveness before killing, because after an intensity trip the
held pid is a corpse. The 100ms two-stage heartbeat makes wedge a first-class state:
"unresponsive", distinct from "crashed", detection-to-state at the ≤250ms design budget,
the destructive rung held behind 3s of confirmed silence, recovery behind two clean pongs.
NativeLink gained request deadlines (it waited forever before), ping, and dialNow so a
fresh floor is not served its predecessor's backoff.

Acceptance: field-native 27 new tests including the fd-exhaustion kill-matrix row (both
arms, mutation-failable) and the admission contention row; fieldd 11 new rows including
three kill-matrix rows against the real binary (SIGKILL → respawn 3.9s end-to-end with a
fresh pid; SIGSTOP → distinct state → same-pid recovery; intensity → gone → affordance);
the full verify gate green through every stage with gen:check proven post-commit; clippy
at -D warnings clean. Two pre-existing gate reds fixed en route with provenance recorded:
the stale mesh_bridge supersession row (red since the presence-lanes close-fence; its
subject was supersession, so it now opens its lane) and doc-sync's ENOTEMPTY teardown
race (the cross-daemon harness's own retry idiom).

## PRC-5e–g — coordinated replacement survives renderer and daemon death

**PRC-5 COMPLETE 2026-08-17** (`7873e60` + `31a48c1` + `303374f` + `ffd1ae2` +
`0c58fe7` + `b35f73d` + `137f086`). PRC-5e joined the previously isolated participant,
candidate-authority, and renderer-controller seams into the production install path. One
per-plugin coordinator closes ingress synchronously, freezes the exact service and renderer
incarnations, stages update-bound module and Product API authority, waits for strict
transport-derived prepare acknowledgements, publishes one immutable pointer, then keeps the route
closed through exact commit acknowledgements. Candidate bearer release revokes both mint state and
authenticated sockets; retained-old recovery receives fresh module authority and exists only
before logical commit. Newcomers are held outside the vote.

PRC-5f makes time and death honest. Prepare expiry enters a separately bounded retained-old phase;
commit/recovery expiry asks Electron to crash only the exact unsettled generation and starts a
second death-evidence grace. Request acceptance removes nothing. Only the later
token-correlated `render-process-gone` retires that incarnation, after its update sources are
revoked; reload waits for that retirement and retains the stable window participant id with a fresh
document incarnation. Disconnect and orderly close remain different facts.

PRC-5g removes the temptation to persist a dead coordinator. The version-2 current pointer is the
recovery journal and atomically carries both the complete signed-artifact slot and monotonic
`commitEpoch`; legacy v1 reads as epoch 1. Definitely pre-rename failure may recover old. Any error
after rename is publication-indeterminate, fails forward with ingress closed, and is resolved by a
fresh daemon reading the pointer. A deliberately paused commit also pins the only legal handoff
window: while registry refresh sees candidate/next-epoch just before the coordinator resumes, only
that active episode's exact candidate at exactly `epoch + 1` is accepted.

The real process-death matrix bundles the production store into a child and SIGKILLs it on both
sides of rename. Restart selects old/epoch 1 and cleans the temp before rename; after rename it
selects candidate/epoch 2. Electron observes replacement fieldd handles through a daemon boot-id
fence. Owned-child exit closes the exact stale client; an adopted daemon stuck reconnecting is
reprobed after a bounded grace. Same-boot handle churn is inert; a new boot requests every current
document generation.

The packaged acceptance smoke creates two sandboxed BrowserWindows on the production custom origin,
loads **22 widget types / 5 staged plugins** in each, SIGKILLs the shell-owned fieldd, waits for
automatic respawn, and observes the same census in both replacements. Both participant ids stay
stable, both incarnations change, and the daemon boot id changes. That smoke found two adjacent
real bugs: concurrent `plugins.modules` calls could mint competing token tables and invalidate the
first window, so generation rebuild is now single-flight; macOS's long session temp root could push
`meshdata.sock` over `sun_path`, so Unix smoke roots deliberately use `/tmp`.

Acceptance on the landed tree: restart spike **6/6**; focused PRC-5g fieldd **59/59**; complete
fieldd **566 passed + 1 platform skip**; Electron **574/574**; supervisor **54/54**; all affected
typechecks; changed-file Biome; bundle assertion; patch hygiene; and the physical two-window smoke.
The independent real-tailnet lane remains **1/1 in 35.11 s**. A literal hardware power cut and a
Windows filesystem run remain named release/portability witnesses; macOS process SIGKILL is not
presented as stronger storage-hardware evidence. PRC-6 now owns bounded diagnostics and soak.

## PRC-6a — bounded shared runtime diagnostics

**LANDED 2026-08-17 (`26fcfdf`).** The shared renderer/service controller now has a distinct
serialization-safe diagnostic projection. The rich recursive snapshot remains available for
in-process control/debugging, but it is no longer mistaken for a bounded wire shape: an adversarial
4-wide/5-deep tree proved that `maxDiagnosticEffects: 8` could emit more than 1,000 rows and 256 KiB
because the old cap applied at every scope.

`ActivationScope.diagnostic()` emits a globally capped, breadth-first flat tree. Parent-indexed
`{id,parentId,label}` rows preserve exact ancestry without repeating whole paths; root aggregate
counters retain every omitted live/pending/late/error fact. The hard maxima are 128 effects, 32
errors, 120-code-point labels, 512-code-point messages/close details, and 64 ownership levels.
Configuration can reduce them, never expand them. The depth ceiling came from a real counterexample:
around 2,000 nested scopes overflowed `report()`'s stack and threatened close as well; level 65 now
refuses before recording a partial child.

Controller history is no longer an open `Record<string, unknown>` ring repeating full targets and
close reports. It is a closed compact 64-event vocabulary with monotonic sequence and
`omittedHistory`; exact current desired/committed targets stay at the top, one bounded `lastClose`
retains cleanup errors, and `lastForce` separately records target, phase,
confirmed/unconfirmed/error state, and the real boundary outcome. Loading, prepared, active,
unloading, and blocked scopes are all visible. A host lifecycle observer receives immutable compact
events; sync throws and rejected promises cannot interrupt reconciliation. No candidate, disposer,
scope, worker, port, promise, or termination adapter crosses the projection.

Acceptance: plugin-runtime **50/50**; production cardinality/plain-wire/forced-GC retention **3/3**;
candidate controls **2/2**; plugin-runtime, field-app, and fieldd typechecks; R1–R18 zero violations;
Biome and patch hygiene. At 2,388 live records the 128-row projection measured 9,829 bytes and
1.29 ms p99; at 9,556 it remained 9,829 bytes and measured 8.34 ms p99. WeakRef collection is
supportive evidence; the stronger retention invariant is field-by-field construction of a closed
plain-data schema.

PRC-6b still owns the passive service/renderer/update aggregation and lifecycle log mapping. PRC-6c
owns calibrated clean/leak controls, the compressed gate, and the literal 24-hour physical soak;
none of PRC-6a's fast loops claim that duration.

## PRC-6b — passive product runtime diagnostics

**LANDED 2026-08-17 (`06860e0` + `078d8fc` + `9fb74f8`).** Canonical exact-target comparison now
feeds a passive, bounded fieldd join of registry, service-controller, renderer-controller,
behavior-generation, and PRC-5 update facts. Renderer identity comes only from the shell-minted
bearer and must already name a current coordinator participant; report/get/subscribe cannot create,
admit, acknowledge, disconnect, retire, or advance update membership. The sender is one-in-flight,
latest-only, and bounded in both pending values and plugin-key state. Disconnect retains stale plain
data; positive retirement owns deletion.

Service and renderer controller transitions emit one existing first-party log record each;
diagnostic polling emits none. The Plugin Manager shows the bounded fold only behind explicit
disclosure, and Doctor derives failure, non-quiescence, reachability, target mismatch, and update
acknowledgement issues without replacing the exact underlying reports.

A failed behavior old→new transition refuted the initial one-renderer-target design: desired new
authority and a still-live failed old inverse can name different artifacts. The selected fold uses
at most two exact renderer targets while globally shedding low-priority rows below 32 KiB. That
counterexample also fixed physical ownership: unregister/rollback rows now disappear only after a
successful inverse, so later close can retry them.

Acceptance at that checkpoint: contracts **247/247**, field-app **507/507**, fieldd **576 passed +
1 skipped**, affected typechecks, focused Biome, and patch hygiene. PRC-6b closes the bounded product
projection, not the resource-duration claim.

## PRC-6c1 — exact runtime censuses and compressed soak

**LANDED 2026-08-17 (`bf281bf`).** Catalog, behavior-generation, renderer-window, service-host,
service-registry, and runtime-diagnostics owners now expose plain structural censuses at their
actual ownership seams. A successful behavior close retains its useful terminal fold as plain data
then releases desired handles, candidate tokens, captured errors, fallback ledger, and listener; a
failed close remains nonzero and retries the exact inverse. Window/service shutdown compacts only
owners whose close actually succeeded, so a refused boundary cannot manufacture a zero by deleting
its last handle. Settled service lease-release promises and queued diagnostic flush state now clear.

Source audit found Ajv 8.20's strong schema-object cache behind dynamic service churn. A 4,000-row
control grew that cache from **1 to 4,001**; `removeSchema()` returned it to **0** while V8 heap
remained allocator-high. Registry schemas are now refcounted by provider generation, released on
withdrawal/failed stage/disposal, and tested across 128 unique manifest generations.

The forked 120-cycle production-seam probe exercises actual ServiceHost/ServiceRegistry, actual ICE
behavior engine/catalog/generation ownership, and actual update coordinator/runtime diagnostics.
After eight warmup samples, every one of **18 executable-resource counters** remains zero, fds stay
**14→14**, external memory stays **4,330,809 bytes**, controller history stays at its **64** ceiling,
and forced-GC heap median growth/slope are **+3,675,988 bytes / +43,575 bytes per sample**, below the
selected dual threshold. The identical negative control plants one real catalog listener at sample
12 and reaches 108; the structural oracle rejects it immediately although fd/memory budgets pass.

Final gates: field-app **514/514**, fieldd **580 passed + 1 skipped**, both typechecks, the 120-cycle
clean/leak oracle, preflight, physical-singleton dependency guard, focused Biome, and patch hygiene.
This is compressed production-seam evidence, not §24.6: the probe uses a controlled worker,
sequential renderer incarnations, and no real daemon restart/log rotation/thread/physical-footprint
sampling. PRC-6c2a now owns that ignored physical runner; PRC-6c2b owns the literal 24-hour
execution.

## PRC-6c2a — packaged physical runtime-soak runner

**LANDED 2026-08-17; CONTINUITY HARDENED 2026-08-18 (`d2fd9e5` + `03c9adb` + `5b6a190` +
`c88acdd`).** The existing production `--smoke-plugin-restart` witness now supports bounded cycle
and monotonic-duration modes without a soak-only composition root. One Electron owner
keeps two production-origin windows, repeatedly SIGKILLs the exact supervisor-owned fieldd, waits
for positive old-fieldd and old-renderer PID death, adopts a fresh boot, preserves window participant
IDs, requires fresh document incarnations, and reconstructs staged service and behavior plugins.

Counts-only health projects the Electron bootstrap cache, both renderer runtime owners, fieldd
service host/router/compiler, and passive diagnostics hub. Each quiescent sample also records the
Electron process roster; main/fieldd/field-native FDs, threads, sockets, working sets, and optional
macOS physical footprint; log category bytes/files; queue/drop counters; and full raw structural
vectors. An external wrapper streams exclusive-create JSONL incrementally into an ignored draft
evidence directory that survives production rebuilds, verifies sample count against the verdict,
and reserves `claimSatisfied: true` for an exact 24-hour passing run.

Duration mode now starts Electron's `prevent-app-suspension` blocker, exposes its live state as a
fourteenth exact gate, and stops it during teardown. Elapsed time and deadlines use a monotonic
clock. The oracle measures the origin→first-sample and every inter-sample interval; any completed-
observation gap over five minutes fails the run. This makes “uninterrupted” executable rather than
an operator note: a clock adjustment cannot earn duration, idle app suspension is actively
prevented, and a stalled observer cannot silently leave an unmeasured hole in the trace.

Calibration changed three assumptions. A replacement fieldd adopts the already-live native floor and
therefore honestly reports `nativePid: null`; the runner retains and directly samples the original
positive native PID, rejecting only a conflicting positive claim. Active Chromium descriptors also
refuted exact-repeat quiescence. Each OS point is now the median of seven readings 125 ms apart with
raw min/max ranges retained, and early/late plateau medians use at least three cycle observations.
A later run found a transient Electron app-metrics row retiring after renderer-ready; complete
seven-reading windows now retry for at most 10 seconds and report their count. Exact plugin
ownership, positive old-PID death, and the accepted final process roster remain exact.

The independent eight-cycle clean run holds all **13 exact maxima at zero**, with a constant
**1 Browser + 1 GPU + 3 Utility + 2 Tab** roster. Post-warmup main FDs are **145→145** (maximum
147); fieldd stays **48 FDs / 16 threads / 8 sockets** and field-native **30 / 13 / 0**. System and
plugin logs stay at **10 / 4 files** with **278,883 / 27,885-byte** maxima; log queues and
unexplained drops remain zero. Its structured result is pass/calibration with
`claimSatisfied: false`. The four-cycle negative control plants a real main-process listener per
graded cycle and fails only the exact **1→2→3** residue. A final rebuilt three-cycle run also passes.

The extended preflight then ran **32 crash/recovery cycles** with eight warmup and 24 graded
samples. All 13 lifecycle exact gates stayed zero; Electron stayed at seven processes; endpoint
medians were main FDs **147→147** (maximum 149), main threads **46→47**, fieldd FDs **48→48**,
and fieldd threads **16→16**. System/plugin logs remained under **998,063 / 100,366 bytes** at
**10 / 4 files**, with zero queues, drops, and extra observation-window retries. This is the same
sample shape selected for the long run, not a duration substitute.

After `c88acdd`, a 15-second duration calibration forced the terminal-sample path. It completed two
samples over **18,001 ms**, reported a **14,001 ms** maximum gap, kept all **14 exact maxima at
zero**, and recorded the suspension blocker as enabled and active in both samples. A deliberately
too-short six-second attempt emitted only one complete sample and was rejected by the minimum-
sample guard; unit controls independently reject both an oversized initial gap and an oversized
mid-run gap. Both short verdicts preserve `claimSatisfied: false`.

Gates: Electron **583/583**, field-app **514/514**, fieldd **580 passed + 1 skipped**, all three
affected typechecks, preflight, the ICE/strata/Loro/React physical-singleton guard, production build
and bundle boundary, focused Biome, patch hygiene, and packaged clean/leak witnesses. This lands the
runner and its falsifiability, not §24.6's duration: PRC-6c2b remains one uninterrupted 24-hour run
with archived JSONL and a passing literal-duration verdict.

## TC petitions land — ghosttea 0.10.0; G16 + G17 consumed (TC-D6b/c enforced)

**Date:** 2026-08-18 · **Commits:** `ffdafc8` (pins) · `05372b7` (consumption)

All seven terminal-custody petitions (G15–G21; four upstream review rounds to
convergence, record in `draft/petitions/README.md`) landed upstream in ONE release.
The EL8 bump moves cargo (`ghosttea` + `ghosttea-truffle` `=0.10.0`), the six npm
override rows, the SwiftPM exact pin, and the preflight pin table together.
Provenance triple-checked: npm `gitHead`, the crate's `.cargo_vcs_info.json`, and the
`v0.10.0` tag agree at `43361e53`; the later `v0.10.0-retry.1` tag (Windows
release-validation hardening + a `process_tree.rs` delta) shipped in NO published
artifact. Served CONTROL minor 13 → 16; field-native's Rust client still announces
1.9 — it consumes nothing new, and the G16/G17 consumer is fieldd's npm client.

Consumed at the bump, closing TC-S0's two recorded honest gaps:

- **G16 / TC-D6(c) ENFORCED.** `terminal.create` maps a DECLARED `workloadClass`
  through the genned contracts table (AGENT 2 MiB · INTERACTIVE 10 MiB) to the floor's
  per-session `scrollbackBytes` (gated at protocol 1.15); the floor validates
  reject-not-clamp and echoes the effective cap in `SessionSummary`. Undeclared sends
  nothing — the key never rides the wire and the floor's global default governs,
  byte-identical to a pre-G16 create. The pinned client refuses a pre-1.15 floor
  rather than pretend; fieldd classifies that refusal UNAVAILABLE/unsupported,
  non-retryable. The TC-S0 "enforcement pends upstream" comments are deleted on both
  sides of the seam.
- **G17 / TC-D6(b) spawn-stage classification.** Wire refusals now carry typed
  `{stage, code, osError}` beside a byte-identical message (`GhostteaRequestError` in
  the client SDK). fieldd classifies by `code`: `file-descriptor-exhausted` →
  RESOURCE_EXHAUSTED/fd_pressure · `executable-not-found` → NOT_FOUND ·
  `permission-denied` → PRECONDITION_FAILED · an UNKNOWN code refuses the
  caller's-input claim and lands INTERNAL retryable with the triple carried for
  diagnosis. The openpty errno stays message-read (portable-pty stringifies it inside
  `openpty()` — the negotiated exception), now FENCED by `stage` so spawn prose can
  never borrow the match; the bare-string arm survives as the absent-metadata
  fallback, its comment re-stated to the new boundary.

Five new rows: four fake-floor (the class mapping including the no-key wire shape ·
the pre-1.15 refusal proven never to reach the wire · four-code typed classification ·
the stage fence in both directions) and one real-floor seam row (a classed create
rides the negotiated 1.15 ladder end to end against real field-native + ghosttead
0.10.0). Available but deliberately UNCONSUMED until TC-S6's compiler: G15 `mode_get`
· G18 pending-wrap / wrap flags / hyperlink URI / `recovery_fragment()` · G19
`SavedCursor` · G20 screen-parameterized reads · G21 hyperlink identity — each
petition file's workaround-retirement section is the consumption checklist. G13
(win32 env-strip case-fold) did NOT land; its `it.fails` witness row stays. The mac
gate is blind to win32 (standing memory): the box gates re-run at the next WIN rung.

Gates: `pnpm verify` verbatim green end to end (preflight with the moved pin table → typecheck 23 projects → biome → rustfmt/clippy → all TS suites → all cargo suites → gen:check), plus `pnpm smoke` `{"ok":true, nativeConnected:true}` with the terminal unit up on 0.10.0.

## R3-0 — the mind-map pack's platform prep closes (five slices; three entries owed-late)

**Date:** 2026-08-18 · **Commits:** `e66143a` (S2, keyboard-claim contract fields) ·
`30fd403` (W1, the SDK wire door — the concrete PA-27 evidence) · `57c4720` (S3, SDK
`useUndo`) · `a002dc5` (S1, MeasureQueue wiring, today) · P1 = a deliberately never-merged
probe, verdict at `draft/predesign-mindmap-evidence.md` §F

**Ledger repair, named plainly:** S2/W1/S3 landed 2026-08-14 with ROADMAP mentions and
ZERO entries here — the same parallel-track miss the 2026-08-07 debt row documents (the
milestone ritual walks the track being closed; work landing beside it is invisible by
construction). Recorded now as one rung entry rather than three backdated ones.

**S1 (`a002dc5`) — auto-size was a dead declaration; now it measures.** ICE installs
`measureIngest` only when `createCanvasEngine` receives a `measureQueue`, and field-app
never passed one. Now `createFieldEngine` mints one queue per engine, records the pairing
in a `WeakMap` side table (`measureQueueFor`), and `CanvasStage` hands the SAME instance
to `InfiniteCanvasGround` — two instances is the silent-nothing failure mode, so the
pairing is structural. Five tests, each mutation-checked red-then-green, including the
full loop headless: a real `MeasureEvent` → `ce.step(now)` → `MeasuredSize {w:320,h:214}`
on the entity, plus ICE's ±1px dead band respected across ticks. `pnpm verify` verbatim
exit 0 in the builder worktree; main fast-forwarded to the identical tree. Findings worth
keeping (both now standing memories): with `exactOptionalPropertyTypes` an ICE prop typed
`foo?: T` (no `| undefined`) must be conditionally SPREAD, never passed as a
maybe-undefined expression (TS2375 — and this is why the original S1 session stalled);
and `bundle:assert` requires a `pnpm build` a fresh worktree has never run (a different
failure from the known Electron lazy-install race). One flake (plugin-playground
behavior-conformance) was exonerated by a real control — passes standalone on base, on
the change, and on the clean full-gate rerun; order/load-dependent, not this diff.

**P1 — the CSP download probe RAN; both mechanisms work.** In the production window on
the real `vibefield-app://` origin (mode integrity proven by the pinned 9410/9411 ports
in the policy), blob AND data-URL `<a download>` anchors each produced `will-download`,
completed, and matched main's own bytes exactly (135/135) — with the CSP demonstrably
live and enforcing in the same document (two `img-src` control violations,
`disposition: "enforce"`). `default-src 'self'` does not apply to anchor downloads; ship
blob. The honest boundary: the probe installed its own `will-download` handler, and
production has none on the default session (verified — the only two handlers live on
other sessions and deny), so the bare-anchor UX is Electron's native save dialog,
unexercised. A silent/audited export copies `runAuditedSupportExport`, not a new door.
The scaffolding stays uncommitted in worktree `vf-wt-p1` for reruns; the run isolated
itself from the live PRC-6c2b soak via `FIELDD_DATA_DIR` + `--user-data-dir` and left it
untouched.

**The rung's fifth slice never existed to build:** W2a–W2d (the ECS door) superseded into
design-009 `defineBehavior` + PRC-4d/e and landed there — `thinking-plugin-ecs-door.md`
is HISTORY/substrate, and `thinking-mindmap-pack.md` carries a 2026-08-18 as-built
refresh mapping §2's vocabulary onto the landed surface (derived-at-`derive`, gesture
suppression by default, `GuardedTx.move`, `maxFacetBytes` duty). **R3-0 is closed whole;
the pack's build rungs (R3-1…R3-5) now wait on exactly one thing: MM-D1…D14
ratification.**

## Ghosttea 0.10.1 — G13 lands; the case-leak witness flips

**Date:** 2026-08-18 · **Commit:** `7d3d236`

Upstream closed the last open TC petition beside the G14-class seam: Windows private
env keys and prefixes strip ASCII-case-insensitively (unix stays case-sensitive),
closing the EL7 defense-in-depth leak WIN-6 confirmed live on the box. The fix is
verified in the shipped crate (`session.rs` `eq_ignore_ascii_case` at both the key and
prefix sites; provenance `ad97fdb` across npm gitHead, crate vcs-info, and the signed
tag), and 0.10.1 also ships the `process_tree.rs` hardening the v0.10.0-retry.1 tag
had left unpublished. Pins moved in lockstep (cargo, npm, SwiftPM, preflight);
kill-matrix row 6b dropped `.fails` exactly as the G13 filing pre-registered. The mac
gate is green verbatim; the row itself is win32-only, so the box gate is its sole
witness — and it ran the same day: James carried the tree transfer past the session's
permission-blocked file path, and **row 6b passed LIVE on WORKSTATION4090** (all six
kill-matrix rows green at 0.10.1, 402ms for the witness — a case-variant private
prefix is stripped from a real ConPTY spawn).

## TC-S2 — the terminal engine leaves the floor's address space (field-terminal-host)

**Date:** 2026-08-18 · **Commits:** `7f299d1` (wire truth) · `b6df585` (the cell) · `e5098ec` (fieldd consumer) · `77f6813` (supervisor + gate rows)

TC-D3's first custody inversion, landed as four slices in one day on the seam map's
three structural findings (write-once endpoints cell, hello-only delivery, token as
accidental generation key). The terminal engine now runs as `field-terminal-host` —
field-native's second binary, embedding today's ghosttea TerminalService AS-IS,
self-custody — supervised by the floor with intensity-bounded respawn, TC-D15
revisioned routes, and NO panic-abort (the migration-order law: abort waits for
custody to separate at TC-S4).

The load-bearing mechanics, all measured or pinned rather than assumed:

- **Per-instance socket names** (`termctl.<n>.sock`, vector-pinned twins): a cell
  restart is NEVER a rebind — the unix stale-unlink hazard and win32's
  first-pipe-instance hold both dissolve by construction.
- **The stdin leash**: token on the pipe (EL7 — never argv/env), EOF ⇒ drain(6s,
  the genned budget mirroring G7's sweep) ⇒ report ⇒ exit 0. One portable stop
  signal; a dead parent reaps the cell for free — row S2-B measured the reap at
  391ms after a floor SIGKILL. Found and kept as design: Rust ignores SIGPIPE, so
  the exit report is best-effort by construction (a println to the dead parent's
  pipe would have panicked the drain).
- **Routes as state transfer**: the supervisor publishes {revision, cells[]} on
  EVERY transition — an empty snapshot at revision 1 before the first spawn is the
  capability announcement fieldd's cell-birth wait keys on (a floor that never
  speaks routes stays honestly absent and refuses NOW). The mgmt hello carries the
  snapshot beside the legacy lockstep mirror; `routes.subscribe` re-delivers on the
  LIVE link — the seam that did not exist before (endpoints moved only with a
  re-pair).
- **The birth wait**: a create arriving while the engine is being spawned rides the
  cell's own hello budget (genned CELL_SUPERVISION) instead of refusing — GT-1's
  spirit one level up: create may outrun the inventory, never the engine's birth.
- **The fd gauge follows the descriptors**: the PTY fds live in the cell now, so
  the sampler reads max(floor, cell) against the (inherited) limit — the TC-S0
  fd-exhaustion arm passes in cell mode because the gauge watches the plane that
  actually spends.
- **Honest loss**: a replaced cellBootId while an observed inventory stood emits
  the receipt naming every lost session, carrying the S2 string ("a terminal-engine
  crash loses only its class").

**The gate** (all green): row S2-A — cell SIGKILL → supervised replacement →
routes delta with a new cellBootId on the same mgmt link → endpoints move →
killed session leaves the inventory → a fresh create lands on the replacement,
4.3s end to end. Row S2-B — floor SIGKILL → the leash reaps the cell, 391ms, no
orphan. The full prior matrix (adopt, honest-refusal, env strip, epoch, churn)
passes unchanged against cell-mode floors, as do the seam, governance, and cell
lifecycle suites.

**The published formula** (macOS, debug build, idle): processes 3+1 · cell
12 threads / 16 fds / 3.7 MiB phys_footprint · floor 13 threads / 4.0 MiB (the
service left its address space). The spec table's "cell base ≈1–2MB" estimate
reads high-side-of-honest for debug; the release re-measure rides the next
formula row.

**Mode fallback**: FIELD_NATIVE_TERMINAL_MESH keeps the in-process serve
bit-for-bit (a cell cannot borrow the floor's tailnet node across a process
boundary — the G14-class seam owns that future), and the legacy hello mirror
keeps every pre-routes reader working.

Gates: `pnpm verify` verbatim green end to end over the completed slice (all TS suites, all cargo suites including the 15-row terminal_unit matrix and 4-row cell lifecycle, clippy `-D warnings`, gen freshness).

## TC-S3 — K=2 class cells: routing, attribution, spawn-isolation

**Date:** 2026-08-18 · **Commits:** `4ba9df7` (wire truth) · `fd48777` (the K=2 floor) · fieldd consumer + gate rows (this commit's parents; see bodies)

The terminal floor now hosts one cell per workload class (agents | interactive)
plus on-demand solo isolation hosts — TC-D4's placement contract at S3 fidelity,
deliberately upstream-free. The gate: a class-A crash leaves class-B streaming
THROUGH the kill (same control connection, same epoch, input landing), the blast
is counted per cell, and row 13's no-false-blame half holds against an induced
evidence-free storm.

The load-bearing mechanics:

- **The create-target discipline** (contracts-documented, derivable from any
  snapshot alone — no new verb): a class's target is its `role:"class"` row,
  else its HIGHEST-instance `role:"solo"` row. The floor spawns a fresh empty
  solo the moment the previous one takes a session, so the newest solo is
  always the empty one; at MAX_SOLO_CELLS the newest stays target as the
  honest overflow (TC-D6(f): a bound and a named shed strategy).
- **TC-D4 attribution through a crumb seam** (`termcell.<n>.crumb`, floor-passed
  via `--crumb`, consumed on read, generation-fenced by cellBootId): a crumb
  NAMING a session ⇒ Exact; the cell's own panic hook writes the sessionless
  form ⇒ Infrastructure; no evidence (SIGKILL, OOM kill) ⇒ Unknown. **Only
  Exact strikes.** The cell can only ever write the sessionless form today —
  upstream owns the feed path until custody separates (TC-S4+) — so production
  crashes classify Infrastructure/Unknown and blame NOBODY; the session-naming
  writer arrives with custody, and the file protocol is the seam the kill
  matrix exercises meanwhile.
- **Spawn-isolation** (TC-S6's quarantine migration replaces it): an intensity
  breach WITH an Exact offender in the window flips the class to solo
  placement for ISOLATION_WINDOW_MS instead of the S2 dead end — each create
  lands alone, so the recurring poison workload can only crash itself. A
  breach WITHOUT evidence keeps the honest dead end: no isolation, no blame,
  the sibling class unaffected (row 13, measured).
- **The inventory `cell` tag** (`ObservedTerminalCell` on every observed row):
  the join key. fieldd routes creates by class, mints a session's ticket from
  ITS OWN cell (never the create target), terminates via the hosting cell, and
  counts loss receipts per vanished cellBootId ("blast counted"). The floor's
  mgmt desired-set reconciler routes prunes/repolicies the same way — one
  client would read the other cell's "unknown session" as the benign race and
  silently skip real terminations.
- **Per-cell inventory pumps**, merged: one pump per route row, rows tagged,
  faults composed per cell into one health cell, occupancy per instance
  driving solo rotation/reaping, and ONE governed total into the admission
  ledger (TC-L1f's single meaning of "a session on this device"). A vanished
  route row removes its rows — the supervisor's own word the cell died —
  deliberately unlike a mere connection fault, where the last inventory stays.
- **Health composes per class**: all Up → Up · all Crashed → Crashed · any
  dead end → Degraded (a config-shaped failure is never a crash claim). The
  legacy mirror stays the INTERACTIVE host (snapshot ordered interactive-first),
  so pre-routes readers keep landing where legacy creates land.

**The gate** (all green, first run): row S3-A — agent-cell SIGKILL under a live
interactive witness: same connection, same epoch, input lands post-kill; blast
= exactly the agent session; fresh agent create on the replacement (682ms).
Row S3-B / row 13 — three evidence-free SIGKILLs: NO solo ever appears, the
class ends honest-dead, interactive keeps serving (4.9s). Row S3-C — the same
storm WITH crumbs naming a session: isolation entered, the create lands SOLO
on the target, the target rotates, the second create lands on the NEWER solo,
interactive untouched (1.3s). Row S2-A was made class-aware in the same pass
(cells[0] resolved to the surviving class during the respawn window — the
array-position trap the helpers now forbid). Full matrix, seam, terminal_unit
16 (incl. the new K=2 shape row), lib 94 (attribution/order/composition units),
fieldd terminal-service + native-link 65 across both, clippy clean.

**Named debts, recorded not hidden**: (1) an untagged session inside GT-1's
observation window (62–117ms) falls to the interactive target for
terminate/ticket — on a K=2 floor that can answer `{terminated:false}` for a
live agent session; the fix is a floor "which cell holds X" verb or a fan-out
(TC-S6 scope). (2) a config write reloads only the cell that served it; other
cells restyle at their next respawn (floor-side fan-out verb, TC-S6). (3) the
win32 dual for the S3 rows awaits the next box run (rows are platform-portable
by construction; the tarball ships them).

Packaging (same day, separate commit): `field-terminal-host` now stages beside
`field-native` — the stager's PAIR assertion fails a package holding a floor
without its cell, the macOS nested-code list signs it, and the SEA `--verify`
sandbox stages it. The half-pair refusal FIRED on live repo state (this
checkout's release tree predates the cell), which is the gate working.

## TP-S1a — the terminal pipeline's wire truth (contracts)

2026-08-21, `f799ffc`. The first slice of the merged terminal-pipeline spec
(`draft/specs/terminal-pipeline-v3.md` v0.7 — custody continued through
presentation, transport and the renderer's scene/view model; §20 item 1 of its
closure checklist). `packages/contracts/src/terminal-pipeline.ts` makes every
TPv3 message a zod shape, TS-only like `terminal.ts` (the grant verifier is the
cell, upstream; the floor only mints the key): grants as authenticated envelopes
with the protected header UNDER the MAC and sorted-unique arrays (JCS has no
sets), the per-cell handshake with no claim repeated outside the grant, the
two-level attach, the TWO-DIMENSIONAL `CellActivationStatus` (input=allowed ⇒
presentation=presenting is a parse refinement), the geometry verbs, BYTE
credits, the presentation-envelope header with per-kind rules and the binary
FRAMING the prose had never written down (`'T','P',version,reserved,u32BE
header length, JSON header, payload`; the charge is the received message
length). `canonicalJson` is RFC 8785, pinned by the RFC's own example;
`tp-grant-mac.vector.json` pins both MACs; 30 `tp-*` fixtures; 18 new tests.
Spec deltas recorded for v0.8: `endpoints` optional until S3a (cells serve UDS
today — no `unix:` detour), unit-suffixed limit names, the framing.

## TP-S0b — the pool owns the runtime; the deck is its first consumer

2026-08-21, `19ff4d9` (built in a parallel worktree by an Opus agent, rebased
onto main). The ghosttea runtime leaves the Godview deck for a window-level,
module-owned pool (`packages/field-app/src/terminal/pool/`): one factory (the
deck's and warm-transport's byte-identical copies collapsed; the 1s frame-
subscription grace is now ours by name), a ROUTED data model with a transport
table keyed by `cellBootId` (one named stand-in entry today — `terminal.
connectTicket` carries no cell identity until TP-S1 routes it), a per-session
demand ledger (MAX fold; release is atomic and idempotent), and the recovery
ladder (`terminal.onStatus` → discard/re-warm/replace) moved in whole. Deck =
first consumer; `warm-transport.ts` deleted. TP-R1's proof does NOT mock the
runtime: the real 0.10.1 class drops a session exactly one grace after the LAST
view releases, never while another view holds it; the pool takes no retain.
Honest limits named (decode counts need S0a's counters; `DeclareDemand` to the
cell is S3b). Findings: a control run on main showed the smoke's renderer-
reload row flaky 0/2 there vs 2/2 on the slice; the deck's one-runtime test had
passed for the wrong reason (a fixture logger without `info` rejected the warm
inside its catch); a flapping-bridge one-runtime hole closed (identity-checked
pending slot); §9.1's "doc-generation subtree" precedent is right but the deck
was already outside the keyed subtree (errata note for the spec). Gate
verbatim green; `smoke:godview` green twice incl. the real bridge kill.

## TP-S1b — the floor mints the grant key; fieldd is the issuer

2026-08-21 (this commit). The cross-plane half of S1. The floor mints one
32-byte GRANT KEY per cell boot beside the cell token (`field-native
services/terminal.rs`) and the route row carries it over the paired mgmt
channel (`TerminalRouteCell.grantKey` / `grantKeyGeneration` — same custody as
`authToken`: never env, disk or logs; absent on a pre-TP floor and the
in-process serve). fieldd (`terminal-grants.ts`) derives `clientId` from the
caller's principal (a window's participant + incarnation, NON-REUSED), keeps
the two generation ledgers in memory (safe only because a fieldd restart
replaces every renderer document — TP-R21's argument), mints HMAC-SHA256 over
the contracts' canonical signing input, and `terminal.openTicket` /
`terminal.create` answer the TPv3 route + grants SPREAD beside today's legacy
trio when the cell carries a key — the legacy shape ALONE when it does not
(never a half ticket; a v2 reader shows `UNAVAILABLE {grants-not-landed}`).
New methods (declared == shipped): `terminal.renewAttach` (a CAS on the held
generation, idempotent by requestId, audited as `terminal.attach.renew`) and
`terminal.roster` (TP-D4 — the UI projection with NO placement; `terminal.list`
stays the transport-facing inventory). `leaseEpoch` and `endpoints` stay absent
until S3a exposes custody's per-session epoch and the cells' T1 doors. Tests:
the minter in isolation (7), the product API with two keyed cells (6 — tickets
verify against THEIR cell's key and not the other's, fresh transport grants
with a stable connection set, renewAttach CAS/idempotency/NOT_FOUND/malformed,
create's spread result from the cell the session landed on, the keyless floor's
legacy answer + `grants_not_landed`, the roster with no placement + the
unobserved refusal), the Rust key mint, the keyed route fixture parsed on both
sides. Renderer consumption (zero `connectTicket`, the honest cross-cell face,
the roster in the UI) is the S1-renderer slice on the pool.

## TP-§20a — the state-transition tables and the failure matrix, as data

2026-08-22 (this commit). Spec §20 items 2 and 3 — the protocol-closure
checklist's behavioural half — become machine-checkable contracts:
`packages/contracts/src/terminal-pipeline-machines.ts` carries five tables
(the connection leg as the cell sees it · the runtime-owned activation with
the cell's `presentation × input` dimensions as INPUTS and the two predicates
as outputs · the credit account live → draining → closed · the transfer
staging → validated → swapped | aborted · the geometry seat empty → held →
held-grace), each with every input event, its guard in the spec's words, the
resulting state and its actions; `machineCoverage()` computes the structural
facts and the test holds them — every state×event pair is a transition, an
explicit ignore or an explicit refusal (no "handled elsewhere"), at most one
default row and it is last, no dangling state/event, absorbing states absorb.
The failure/retry matrix names every pre-auth (silent 1008), connection-
refusal, attach-refusal, geometry-refusal, seed-required, close (1001/1008/
1011/4000–4004 — `LEG_TIMEOUT 4004` and `GOING_AWAY 1001` added) and
envelope-decode code with retryable, who retries, how, the user's face and
the audit line; the test proves the matrix covers the enums exactly once per
family. `fixtures/tp-machines.vector.json` is the published form the upstream
verifier reads; the test pins it byte for byte. Spec v0.8 §20 records items
1–3 as EXISTING and what 4–7 still owe.

## TP-S2 — zoom is one resize; the ICE widget watches

2026-08-22, `0f10b22` (built in a parallel worktree by an Opus agent; rebased, fast-forwarded).
Fullscreen/zoom of a deck pane is a CSS-transform morph the DECK owns (`godview/deck-zoom.ts`,
DESIGN.md's island easing, reduced-motion honoured): zero resizes during the animation by
construction (a transform changes no layout box), ONE layout commit and ONE `runtime.resize`
at gesture end, each way, siblings hidden by `visibility` with pinned grid placement so no
other pane is ever resized — measured on the real `TerminalSurface`. Upstream's
`toggle-zoom` could not be used: it swaps the rendered root and re-keys `SplitView`, so every
pane unmounts and the zoomed one REMOUNTS (new viewId, new canvas, re-attach + re-seed) —
spec §2 errata at source; `is-zoomed` is dead code at 0.10.1. The chord ⌘⇧Enter is claimed
ahead of the workspace's passive capture listener (layout effect + `stopImmediatePropagation`,
proven). The ICE terminal widget ships as a field-app product surface, the pool's second
consumer (`src/terminal/mirror/TerminalMirrorSurface`): a WATCH-ONLY mirror that cannot take
focus BY CONSTRUCTION — five layers (a watch-only runtime facade with an allow-list of verbs,
`inert`, `pointer-events: none`, `active={false}`, a `readWrite:false` projection) because
props cannot do it: `controlsResize:false` gates only the explicit claim while the surface's own
ResizeObserver still resizes the PTY (a SECOND hazard beside focus⇒claim — spec §2 + G23),
`readWrite` is not a prop, `setTheme` is session-scoped. TP-R4a proven by attack (focus,
hand-delivered focus events, pointer, keys, a real 1200×800 box change → zero claims/resizes/
input reach the runtime). Cull-driven demand through the pool's ledger (live ⇄ none; release
on unmount; the two-view fold keeps the session); camera scale rides a custom property and
re-rasters once at settle; no `data-canvas-interactive` (a mirror consumes no gesture). UI
Bench mounts the SHIPPING surface through a fixture adapter; `ui-system-boundaries` rows bite.
Measured and NOT met: divider drag = 26 resizes / 200 px (~52 Hz; upstream has no throttle
seam) — TP-R17 / G23. Left undone by design: the mirror is not yet a canvas widget TYPE (a
manifest contribution — the plugin door), and no smoke row asserts `zoom.commits`. Gate green;
`smoke:godview` green.

## TP-S1r — the pool opens by session; connectTicket is gone from the renderer

2026-08-22 (built in a parallel worktree by the S0b Opus agent; rebased onto S2, fast-
forwarded — SHAs in the commit list). The renderer half of TP-S1: every pane birth and every
restore now goes through fieldd's session-addressed doors. Restore reads the saved pane ids
synchronously at first render and `openTicket`s them in order (a refused mint is the EXPECTED
case — `openTicket` gates on the observed inventory — so it tries the next, never faults);
nothing to rejoin ⇒ `dormant` (no bridge, no socket — the resting state that let the sessionless
door be retired rather than replaced); out of dormant the pool reads the ROSTER and opens on a
session the floor already has before it ever `create`s (else `claimExistingSessions` would
claim N and the pool would spawn an N+1th shell nobody asked for — found by writing its row);
splits, new panes and rehydration ride `createSplitSession` → `terminal.create` → the floor's own
summary (the Workspace birth-door "gap" the brief feared does NOT exist: `createSplitSession`
serves both `splitActive` and `createSessionInActivePane`, and `initializeWorkspace`'s fallback
never runs when a session exists to claim). Zero `terminal.connectTicket` on every path
(asserted). The first ticket handed to main PINS `route.cellBootId`; a session on another cell
answers `UNAVAILABLE {service:"terminal", state:"transport-not-landed", reason:"other-cell"}` —
a face that carries NO cell (grepped) — while cell A's one connection is provably untouched. The
UI reads `terminal.roster` only (`terminal.list` is gone from the renderer, asserted); the
restore gate mounts unarmed on anything but an OBSERVED roster. `SessionPlacementLedger` holds
route + both grants + `attachExpiresAt` + `grantGeneration` for S3; nothing verifies, renews or
dials; a keyless floor's legacy ticket still drives the bridge as `grantsLanded: false`. The
prewarm now warms the RUNTIME only — a transport cannot exist before a session does (a deliberate
consequence, named). S0a's perf-source registration moved into the pool (the deck unmounts while
the runtime lives). The smoke's persistence-flip rows were near-vacuous before this slice and
became impossible on fieldd-born panes (born keep-until-exit, `contracts/src/terminal.ts:113-
115`); the gate now BIRTHS its own witness through the automation client with
`persistence: "terminate-with-app"` and no owner — exactly the class GT-D11 governs — and
observes BOTH endpoints (the floor's own create summary = pre-flip; fieldd's inventory =
post-flip), while deck panes get an asserted row of their own (a pane ever seen
`terminate-with-app` now FAILS); the sampler's empty trail was its ~1.7 s poll cadence under
load, not a frozen set — it now counts polls/refusals and the guard waits for it to have LOOKED.
The earlier "echo" blocker was pre-S1b fieldd and vanished on the rebase; the claim path was
exonerated by probes (`accepted:true` on the claimed pane and on an unclaimed control). Gate
verbatim green; `smoke:godview` `ok:true` twice (`flipObserved: true`, `consentShown` via the
real roster, `claimedExisting: true`).

## TP-S2b — the smoke witnesses zoom.commits, and measures the panes nobody zoomed

2026-08-22, `98d2d6e` (the S2 Opus agent; one file, `electron-shell/src/testing/smoke.ts`).
Row 4c, placed right after the split because a zoom with one pane is a no-op that would pass
without the feature (it throws on fewer than two): `zoom.commits` 0 → 1 → 2 across one gesture
each way (baseline asserted 0, not assumed), AND the pane boxes read from the live page — the
floor's inventory carries no geometry — exactly one box may move and it must be the pane the deck
marked `data-vf-zoom-pane`: `590x446 → 1180x446`, the sibling untouched to the pixel, the layout
round-tripped exactly. The chord ⌘⇧Enter is delivered (`zoomDriver: "chord"`, measured); a chord
producing no phase change within 6 s falls back to the chip, and that path was exercised by
suppressing the press for one build. `DeckFacts.zoom` is the only optional field, so a pre-S2
bundle fails on a behaviour, not a missing field. The agent's control run found the fleet
blocker of the hour: `resource_governance::fd_exhaustion…` red on CLEAN main because the machine
held 527 ptys against `kern.tty.ptmx_max` 511 — 86 `field-terminal-host`s under ~15 vf-s0c floors
leaked by the perf-lab runs; reaped (ptys → 57), the S0c harness told to reap by path, cap and
assert. Gate verbatim green on the merged main afterwards.

## TP-S0c — the rig: a lab in the real app, and the first numbers that are ours

2026-08-22, `0da66d9` + `d1b8429` (the S0c Opus agent; rebased, fast-forwarded). The
`--terminal-perf-lab` Electron mode (`electron-shell/src/testing/terminal-perf-lab.ts`) is wired
like `--smoke-godview`: the production window factory, a real daemon pair on an isolated data
root, panes born through the workspace's own ⌘D, sessions driven by fieldd tickets + the
automation client; the renderer is the REAL product renderer built with an explicit lab door
(`vite build --mode` does NOT flip `import.meta.env.DEV`; `NODE_ENV` would ship React's dev
runtime into the measurement) into `.vibefield/terminal-perf-lab/renderer`, and the production
bundles REFUSE the lab marker by gate (`verify-production-{main,renderer}.mjs`). Scenarios that
run: single-pane · deck-4 · flood · flood-in-a-deck · fan-out · scroll-storm · resize-storm ·
focus-alternation · echo-probe · wall-probe · wall-100 (multi-view named as not hostable before a
second view host); generators report achieved-vs-requested rates. `pnpm perf:terminal <scenario>`
drives it; `--ab metrics,off` interleaves arms inside one launch, order flipped per rotation.
Numbers (medians, loaded host; PROPOSED inputs to the numeric checkpoint, 13 rows in RESULTS §7):
keydown → PTY write accepted **p50 1.06 ms** (p95 3.6, p99 8.1; 900/900 keys paired; fixture
10 µs) — §18.1's ≤1 ms hypothesis holds; Chromium `InputLatency::RawKeyDown` **p50 15.8 ms**
(swap included; 0.9 % apart across runs) — the §18.12 floor as a number; `frameApplyMs` **p50
0.10 ms in every scenario** incl. an 8 MB/s flood; cold open 359–519 ms vs the 300 ms hypothesis,
with the `ticket` station **202–264 ms ≈ 57 %** of it (the mint round trip is the cold-open lever) — **ERRATUM 2026-08-22 (TP-S1m, `39eb38f`): FALSE — the mint costs 6 ms and the daemon's share of that station is 38 ms; the rest was the renderer's main thread blocked by the deck mount while the answer sat in its socket; the single-station instrument could not tell a slow daemon from a request sent late (see the TP-S1m entry)**;
TP-R18's `metrics` half PASSES on frame-interval p95 and fps (Δ −0.0 %/0.0 %; null arm 1.1 %/
0.1 %) and is UNGRADEABLE on keystroke→rAF (null arm 58.8 %); TP-R19 `secondary`/`medium` with a
stable contributor set 3/3, throughput `host-contention-sensitive`; 100 panes reached idle and
under flood — with the rAF loop delivering ZERO frames to a visible+focused page while the worker
ran 118–120 submits/s at 98–99 % cache hits: the baseline's biggest open question. The Ghostty
A-vs-A control is built (echo fixture with `probeId`, a Swift CGEvent injector whose clock is
paired against Node's — macOS has TWO monotonic clocks 57,656 s apart here —, a window-list gate,
the pairing/comparison reducer) and GATED (`--native-control --i-have-the-display`, refuses with
foreign windows on screen): it injected ~33 stray characters into James's live session before the
gate existed, and it will not run until he hands over the display; even then it answers inject →
child-read and the DSR round trip, not keystroke → photon. The rig caught its own wrong headline
twice ("the deck tops out at 11 panes" = `focusDeck` reading the first, 0×0 `.terminal-input`).
**And the incident:** the lab's `finally` called `app.exit()` without `supervisor.dispose()`, so
every scenario left its Electron, its detached floor, cells and shells alive — 45 lab Electrons /
86 cells / 509 ptys put the machine over `kern.tty.ptmx_max` 511 and turned every terminal Rust
test and smoke red on clean main (reaped twice; merge held for the fix). `d1b8429`: real teardown
(bounded `dispose()`, scratch root removed only when not injected), `pnpm perf:terminal --reap`
(a SIGKILL tool, so it is the tested part: matches this worktree's absolute path at an EXECUTABLE
position only — a `grep` naming the binary and a `node -e … <path>` decoy are spared by test),
a pre-flight refusal when its own leftovers are alive, and a per-run census whose claim is "none
of this worktree's processes survived" (pty counts are corroboration — `/dev/ttys*` releases
LAZILY, ~30 s after the holders exit, and other agents' shells move the baseline). Verified
57 → 57 with zero strays on deck-4 and on wall-100 (100 sessions). Gate verbatim green.
`2c2c43b` closes the account: the exit had been the last statement of a happy path — during the
disk-full window `writeFileSync` threw ENOSPC inside the `finally` and `app.exit()` never ran (the
two incidents compounded) — so now an exit watchdog is armed BEFORE the run, `process.exit` sits
behind `app.exit` on a 5 s fuse, all eight teardown steps are individually guarded, the driver
leashes its child (SIGTERM → SIGKILL; SIGINT/SIGTERM kill the child before the driver leaves) and
OBSERVES the exit, the reaper gains an `electron` kind (this worktree's own Electron, reaped first;
fieldd-under-Electron classified by script first; a packaged VibeField.app and siblings spared —
90 rows), and the census reports `survivingLabElectrons` excluding the live app's own helpers via
`getAppMetrics()`. Proven: deck-4 then flood from a 57-pty baseline, both `0 / 0 / 0`, settled;
a planted stray is REFUSED pre-flight and cleared by `--reap`. Gate verbatim green. **Errata
to that commit's message (2026-08-22):** it attributes a missing `target/debug/field-native` to
"a rebase"; the second miss was the orchestrator's own `rm -rf` of the worktree's target after
the agent's first report (too early — recorded as a lesson), not the rebase; the driver's new
refuse-with-the-real-reason precondition stands on the FIRST miss (a fresh worktree that had never
built field-native), and its "twice in this slice's history" comment should read "once, plus a
deleted target directory" (to ride the next code commit).

## TP-S3a — the cell-side connection layer: two doors in OUR harness, and the Origin probe

2026-08-22, `bc273fa` (the orchestrator; the critical path after James ratified TP-D1 = T1 and
TP-D26 = C′ that morning). The first slice of the S3 bundle, built where TP-D26 put it: in
`field-terminal-host`, over ghosttea's public `Session` API, beside its UDS plane.
`packages/field-native/src/tp/` — `jcs.rs` (RFC 8785: ECMAScript number placement, UTF-16 key
order, JSON.stringify escaping; pinned by the SAME `tp-jcs.vector.json` and grant-MAC vector the
TypeScript minter pins, EL9 both ways) · `grant.rs` (the authenticated envelope verified over the
RECEIVED `protected`+`claims` values — an unknown claim breaks the MAC exactly as it should; the
silent class `GRANT_BAD_MAC`/`KEY_UNKNOWN`/`TYPE_MISMATCH`/`AUDIENCE_MISMATCH`/`EXPIRED`/
`NOT_YET_VALID`/`LIFETIME_EXCEEDED` + `ORIGIN_REJECTED`/`HELLO_MALFORMED`/`PRE_AUTH_LIMIT`, each
with its own test trigger; `GrantKey`'s Debug prints `<32 bytes>`, never the key) · `ledger.rs`
(the transport high-water per connection set, the `(nonce, channel)` ledger held to
`expiresAt + skew`, tombstones to `firstAcceptedAt + maxGrantLifetime + skew`; an EQUAL-generation
grant replaces a live leg only when its `issuedAt` is newer; the attach high-water lives here for
S3b) · `wire.rs` (serde mirrors of the contracts' hello/accepted/refused/heartbeat + the tagged
envelope; the announced `ProtocolLimits` re-serialize byte-equal to
`tp-protocol-limits.defaults.json`) · `door.rs` (tokio-tungstenite 0.29 — already in the lockfile
via truffle-core, so no EL8 event; ONE ephemeral loopback port, `/control` + `/frames`; Origin read
at the HTTP upgrade, a socket WITHOUT an Origin admitted (the grant is the authority, the list is
hygiene — fieldd's door's rule); the pre-auth cap decided at ARRIVAL and released the instant a
refusal is decided; every pre-auth failure a `1008` with NO body; `ConnectionRefused {code,
retryable}` then `1000`; one leg per channel, `4002 SUPERSEDED` to the replaced leg; `LegHeartbeat`
→ `Ack`, `4004 LEG_TIMEOUT` at the receipt deadline; `1001 GOING_AWAY` on drain, BEFORE the
session sweep; anything beyond the connection layer on an accepted S3a leg is `4003
PROTOCOL:unsupported-at-s3a:<type>` — honest, never a pretended attach). The floor now delivers
the grant key AND the renderer origins on the bootstrap line (`{token, grantKey,
grantKeyGeneration, allowedOrigins}`; `FIELD_NATIVE_ALLOWED_ORIGINS` is fieldd's own list passed
down at spawn), the cell reports `doors` in its hello, the floor copies them onto the route row
(`TerminalRouteCell.doors: CellEndpointSet`), and fieldd copies them into
`TerminalOpenTicket.endpoints` EXACTLY when present (a keyed cell without doors still mints
grants — the honest `transport-not-landed` face stays). Contracts deltas the prose had owed: every
JSON text message on either leg is TAGGED `{type: <MessageName>, …}` (`TpMessageType`,
`TP_LEG_INBOUND/OUTBOUND`, `tagTpMessage`/`decodeTpMessage`; the spec never said how a receiver
tells an `AttachControlLeg` from a `DeclareDemand`); §20 item 5 EXISTS as data —
`registries.TERMINAL_PIPELINE` (+ `TERMINAL_PIPELINE_CLOSE_CODES`) is the ONE authority for the
protocol version, door hygiene, grant validity, the cell's receive caps and the announced limits,
generated into `registries.rs` and pinned by a fixture both sides parse (values PROVISIONAL until
the numeric checkpoint); `CellEndpointSet` moved to `envelope.ts` because the route row needs it.
The CSP as ratified: `buildCsp(mode, hashes, {directTerminalDoor})` — production keeps the two
pinned fieldd ports, admits `ws://127.0.0.1:*` only under the flag (`--terminal-direct-door` /
`VIBEFIELD_TERMINAL_DIRECT_DOOR=1`; the probe mode implies it), the test asserts BOTH shapes;
smoke-like modes gain `worker-src 'self' blob:`. **The gate line ran live:** `pnpm
smoke:terminal-door` (`--terminal-door-probe`, `runTerminalDoorProbe` in the testing bundle; the
production-main verifier refuses its marker) boots the real pair on an isolated root, births one
session through fieldd's door, and the app-scheme renderer's DOCUMENT dialed `/control` while a
blob WORKER dialed `/frames` with the ticket's transport grant — both `ConnectionAccepted`, both
contexts' origin `vibefield-app://shell`, on the first run (the dev renderer's origin is an
ordinary http origin fieldd's door already admits every session — stated, not re-probed). Tests:
15 unit rows (JCS vectors, every silent code, ledger rules, tombstone math, version/window
selection), 9 `tests/tp_door.rs` rows against a real tungstenite client (both channels on one
grant; Origin; the silent class; deadline + cap; the structured class incl. `CAPACITY`;
higher-generation and newer-equal replacement; heartbeats and `4004`; the honest `4003`s;
shutdown `1001` + `STALE_ROUTE` by signal), 2 `cell_lifecycle` rows against the REAL binary (a key
in the bootstrap opens doors a MAC'd grant enters; a keyless bootstrap says so by absence),
fixture parity on `terminal-routes.doors.json`, fieldd (`doors` → `endpoints`; the minter's
doors row), electron-shell (modes, the CSP's both shapes, the probe's pure halves), contracts
(tagging, defaults fixture, the route row's doors). Gate verbatim green (two clippy findings
on the way: tungstenite's large `ErrorResponse` and a `min` with today's 0 minor — both allowed
with their reasons). NOT in this slice by design: attach legs, activations, frames, credits,
`STALE_ROUTE` raised by custody, the attach high-water in use (S3b/S3c); one shared session set
between the UDS plane and the doors is still G22's cost. Housekeeping: 18 orphaned `vf-smoke-*`
floors from 2026-08-17/18 were found idle on launchd (no ptys held) and reaped.

## TP-S2b-widget — the mirror becomes a canvas widget TYPE, through the host's own door

2026-08-22, `d9c2e8b` (the S2b-widget Opus agent; rebased, fast-forwarded; mark 21 RATIFIED as
(a) that morning). `vibefield.terminal.mirror` is a BUILT-IN dom widget contributed by
`vibefield.terminal` (field-app's own row, `src/terminal/widget/`): built through the SAME
`buildWidgetType` every plugin row goes through (contract vocabulary, prop constructors, the
durable `vibefield.terminal.mirror:props` component, ICE's build-once catalog), inserted from the
tray, persisted like every other widget (`{sessionId, label}` in the doc — `sessionId` is the only
address, TP-L-C; an empty one is a real state and shows the roster picker), wrapped by CardShell.
The SDK is UNTOUCHED and a test asserts it — the pool access is by construction (the component is
app source beside the pool it consumes), no reach is granted to anyone else; mark 21 (b) still
needs its own capability design. THE THIRD REGISTRY AUTHORITY: `PluginRegistry.registerBuiltIn`
(plugin-runtime) — `registerV1` would have to NAME a renderer artifact that does not exist (§7.1's
"widgets require entries.renderer") and `registerRecord` would claim fieldd staged a module it has
never seen, so the third door states what is the case (no artifact, no entries, no activation) and
then obeys the identical `bind()` laws plus the owned-name rule, now EXPORTED from contracts
(`isOwnedName`) so the namespace law has one implementation; built-ins register FIRST in
`buildRegistry`, so a plugin claiming the type refuses loudly instead of outranking the host;
`withBuiltInFace` is §11.4's failure boundary WITHOUT §12.4's disable swap (a built-in cannot be
disabled — fieldd's registry holds no row for it). SESSION CHOICE FROM THE ROSTER:
`SessionPickerView` over `terminal.roster`'s `ProductSessionRosterItem`s (ids, class, health,
provenance — NO placement; the contract refuses a placement key at parse, so the picker cannot
become a placement UI); honest faces, none blank — `unread`, `unobserved` (fieldd has not looked
at the floor — not an empty machine), `unavailable`, observed-and-empty, the session the floor
does not have, and TPv3's `UNAVAILABLE {state: transport-not-landed}` naming `other-cell` vs
`endpoints-not-served`. The catalog gains the picker's five roster states through a fixture
ADAPTER (`TerminalSessionPickerPreview` — the view was split controller-free for it);
`ui-system-boundaries` guards the fixture and holds `mirror-widget.css` to semantic tokens.
TP-R4a IN THE WIDGET FORM: the five watch-only layers live in the surface; what a widget can newly
get wrong is the canvas's own input plumbing, so two lines are load-bearing by omission — the
contribution declares NO `keyboard` interaction and the subtree carries NO `data-canvas-interactive`;
the attack test re-runs TP-S2's treatment against the REGISTERED component (programmatic focus,
delivered focus events, pointer press/click, keydown, a driven ResizeObserver box change) and the
claim count stays zero, with no `sendKey`/`sendText`/session-wide `setTheme`. Three findings: (1) an
EAGER import from the registry door instantiated the terminal pool and `@vibecook/ghosttea-react`
before any test file ran, so every `vi.mock` of it silently stopped applying and 18 green mirror rows
went red without a line changing — the fix is layering (`mount.tsx` reaches the component through
`lazy(() => import(…))`, a test pins that no static import returns); (2) a dom widget with no
declared preview mounts the REAL component in ICE's tray sandbox — a terminal door opened by
hovering the tray; the binding declares a static `TerminalMirrorTile`; (3) the canvas smoke's
census moves ONE of its two numbers (`widgetTypes` 22 → 23, `stagedPlugins` unmoved), and that
asymmetry IS the witness that the host registered it outside the plugin door. NOT WIRED on
purpose: the surface's `cameraScale`/`cameraSettled` (the ICE content plane IS the camera
transform; passing it would scale twice) and `culled` (the widget self-observes). Still S3's: the
SOURCE half of demand release (`DeclareDemand` reaches the cell at TP-S3b). Tests: 22 new rows in
`terminal-mirror-widget.test.tsx`, 5 in `plugin-runtime/test/registry.test.ts` (the third door:
provenance, owned-name, distributable-id, collisions both ways), `pnpm smoke:canvas` as the census
witness; `pnpm verify` verbatim green on the branch and again on merged main.

## TP-S1m — the ticket-mint lever, measured: there isn't one

2026-08-22, `39eb38f` (the mint-lever Opus agent; rebased, fast-forwarded; gate verbatim green in
its worktree on the rebased commit). TP-S0c published "`ticket` alone is 202–264 ms, ≈57 % of the
cold open — the single biggest lever in §18.7, a fieldd round trip, not rendering". This slice went
to pull that lever and found it is not connected to anything: **minting a ticket costs 6.0 ms**
(median, n=20 in-app cold opens, fieldd's own audit ledger) and the daemon's whole share of the
interval is **38 ms**; the remaining **152 ms of the 190 ms** is the renderer failing to READ an
answer already sitting in its socket — the main thread is blocked by the deck's GhostteaWorkspace
mount (~150 ms). **Errata at source, this entry and the S0c entry below:** the "57 %" was the
instrument's mistake — the cold-open trace had ONE station between `open` and `connected`, so
React's commit, the pool's claim, the roster read and the mint's round trip arrived as one number;
`cold-open.ts` now carries the SEND edges too (`claim · rosterAsk · roster · mintAsk · ticket ·
connected`), the `ticket`/`connected` stations are stamped on the CREATE path (they never were —
the trace was blind on the very path it measured), `terminal.roster` is the mint's NULL ARM on the
same socket, the lab reads fieldd's audit ledger at teardown and pairs `attempt`/`outcome` by
operationId (the handler's own duration with no new daemon instrument — EL7 already requires both
records), `fieldd/test/terminal-mint-hops.test.ts` (gated, `VF_MINT_HOPS=1`) runs six interleaved
arms against a real pair and asserts ORDER never milliseconds, and two opt-in lab switches
(`VF_PERF_LONGTASKS=1`, `VF_PERF_NO_MONITOR=1`) keep a before/after from also being an A/B on the
observer. The numbers (medians, n=20, loaded host): `open→claim` 15.2 · `claim→rosterAsk` 1.7 ·
`rosterAsk→roster` 8.1 (the null arm: a fieldd round trip) · `roster→mintAsk` 0.5 ·
`mintAsk→ticket` 190.4 · `ticket→connected` 8.8 · `connected→mounted` 127.4 · `mounted→frame` 9.2 ·
TOTAL 365.1; from fieldd's ledger the same 190.4 = 0.3 to reach fieldd · 27.0 create (an fsync + the
spawn) · 5.0 outcome fsync · 6.0 mint (an fsync + the HMAC) · 151.7 renderer read. Daemon side alone
(n=25/arm × 3 runs): fsync null 4.4–4.7 · roster 0.24–0.35 · openTicket 11.3–18.0 · create 26.0–27.6
· create `-l` 30.1–31.8 · the per-cell control dial 0.60–0.64. **A fix this measurement killed:** a
first pass moved fieldd's lazy per-cell control dial to cell announcement, reading a cold create
(40–55 ms) vs a warm one (27–34 ms) as that dial — it is 0.60 ms (p50, n=25, three runs, ±7 %) and
the gap was host noise; reverted (it cost TC-S3's spawn-isolation rows their meaning); the arm that
killed it stays in the ladder. **The real lever, sized:** monitor ON vs OFF, interleaved, n=6 — the
total is 365.2 vs 370.1, UNCHANGED; every hop the monitor inflated gets faster and the stall
reappears one station earlier (`claim→rosterAsk` 1.6 → 99.2): removing the monitor MOVES the cost;
shortening a mint changes the cold open by zero. **Null control (§19):** the shipping-path arm
measured 365.2 against §2's independent 20-launch baseline of 365.1, ~30 min apart — 0.03 %.
Findings: `field-terminal-host` is a second binary `cargo build -p field-native` need not leave on
disk — without it the failure surfaces two minutes later in the renderer as `UNAVAILABLE
{state:"absent"}` (the driver now refuses up front, as for field-native); the driver's "rebuilt
twice … after a rebase" comment corrected at source (the orchestrator's deleted `target/`);
`long-animation-frame` UNDER-REPORTS the stall; the lab's cold open is honestly "launch and
immediately press ⌘G" — it toggles Godview inside the GT-D14 prewarm's idle window and sometimes
inside the floor's cell boot (751–2052 ms for the host to exist), and should be labelled that way.
No product BEHAVIOUR changed. Tests: three cold-open trace cases + three pool cases; fieldd's
terminal suites 74/2-skip; the hop ladder green on demand; every lab run's pty census back to 57.
Results + reproduction: `draft/terminal-perf/results/20260821-mint-lever/README.md`.

## TP-S3b — static activation, cell side: the seed, the two-dimensional lease, byte credits, and the catch-up that repairs a lineage

2026-08-22, `5ba4a72` (the orchestrator; the critical path). The second S3 slice, built where TP-D26
put it — in `field-terminal-host`, over ghosttea's public `Session` API — and proven END TO END
against a REAL `/bin/sh` session this harness spawns and a REAL tungstenite client playing the
routed runtime. New in `field-native/src/tp/`: **`source.rs`** — the `SessionSource` seam (the door
needs a session by id, its `FrameHub`, and — until G22 — nothing else; `DirectSessions` is the
harness's own set, `NoSessions` is what a production cell serves until the accessor lands) plus the
TRF1 header parser (the door stamps and routes, never decodes — §8). **`activation.rs`** — the
cell-side ACTIVATION table, pure over its inputs (every call returns `Effect`s the door performs
outside the lock): one pending-or-active activation per `{clientId, sessionId}` (idempotent same-id
retry, `ACTIVATION_CONFLICT` for a new id without `replacesActivationId`, an atomic replacement that
revokes the old and tells its control leg), the two-dimensional lease (`presentation` goes
`presenting` when `SceneApplied` reaches the seed's revision; `input` is `allowed` only under
`PresentationReady` ∧ the input right ∧ the cell's own lag call — a read-only grant reaches
presenting and NEVER `InputAllowed`; a renewal that drops the input right revokes it at once), the
BYTES credit ledger (per-connection and per-activation windows, cumulative-max returns idempotent
and epoch-fenced, the draining rule for a closed activation), and `DeclareDemand{none|live}` driving
the ghosttea view attach/detach (warm/hot). **`presentation.rs`** — the per-activation pump: the
seed is `Session::refresh()`'s forced FULL frame shipped as a `seed` transfer (`baseContent = null`,
chunked to the announced limit, crc32c over the concatenation), ordinary `trf1-frame` deltas carry
base = the last revision SENT (the socket is ordered) and result = the frame's, and ANY dropped
frame — credit starvation, a hub lag, demand none→live — breaks the lineage and is repaired by ONE
`catchup` transfer (another forced full frame, base = last sent), bounded by `maxActivationCatchupMs`
(→ `presentation: stopped{overload}` on breach, never a livelock). **`crc32c.rs`** — the transfer
checksum (table-driven, no new crate; the RFC 3720 check values pinned). **`door.rs`** grew the S3b
wiring: a per-socket WRITER task owns the sink (so a pump and a reply never race on one socket), the
attach handlers verify the attach grant (a failure is ONE `AttachRefused {code: GRANT_INVALID,
retryable: false}`, the precise silent code in the audit line — on an authenticated leg there is no
hello to close), admit its generation against the attach high-water, and let the table decide; a
`CalibrationPing` is echoed as a `calibration` unit (and re-arms the frames leg's deadline). The
geometry verbs answer `4003 PROTOCOL:unsupported-at-s3b:<type>` — honest, never a pretended seat.
Contracts: a new `GRANT_INVALID` attach-refusal code + failure-matrix row + fixture; the
`AttachControlLeg` doc states renewal rides the same message (a higher `grantGeneration` for a held
activation); §20-item-5 data grew (`registries.TERMINAL_PIPELINE` gained `CELL_LEASE_TTL_MS`,
`INPUT_LAG_SUSPEND_REVISIONS`, `ATTACH_RENEWAL_MARGIN_MS`, `SEED_FRAME_WAIT_MS`, generated into
`registries.rs`). **Tests:** `tests/tp_activation.rs` — 4 rows against a real session + client (the
deck path: seed → lease presenting/allowed → deltas with base/result stamps → `SceneApplied` keeps
the lease fresh; credit gating: with NO credit the stream stalls partway through a feed of discrete
frames and the activation stays live, and returning credit resumes it with a `catchup` transfer;
read-only never `InputAllowed` + demand none detaches the view (`has_active_views` false) + live
re-attaches it + a frames-leg loss revokes the lease on the control leg; attach
idempotency/conflict/replacement + `SESSION_UNKNOWN` + the calibration echo) — plus the table's own
decisions unit-tested in `activation.rs` (attach idempotency, the lease under rights/lag/renewal,
demand, and the credit ledger's cumulative-max/epoch-fence). **A test discipline worth keeping:** the
engine COALESCES a burst into ~one frame (a 6000-line `seq` produced 2 frames of an 812-byte seed),
so byte-starvation cannot be reproduced by output VOLUME against a window that also fits the seed —
the credit test starves by feeding many DISCRETE spaced frames from a background task, and the pump's
convergence bound was made a `DoorConfig` field so the test sets it generously without racing the 3s
production constant. `pnpm verify` verbatim green (one biome fixup on the regenerated machines vector;
one clippy merge of two identical lag branches). NOT in S3b: routed cross-cell recovery + the geometry
seat (S3c), the stress/fairness rows (S3d), the renderer runtime that makes it user-facing (G23), and
G22 — until the accessor lands the harness hosts T1-born sessions itself and fieldd's legacy UDS
clients cannot see them.

## TP-S3c — the minimal geometry seat, cell side: the lease over ghosttea's control primitives, and the honest migration reason

2026-08-22, `e0eefa9` (the orchestrator; the critical path). The third S3 slice, built where TP-D26
put it — in `field-terminal-host`, over ghosttea 0.10.1's PUBLIC control API — and proven END TO END
against a REAL `/bin/sh` session this harness resizes and a REAL tungstenite client. **The geometry
lease (`field-native/src/tp/activation.rs`): the CELL is the authority, ghosttea commits the resize.**
ghosttea's `claim_control_checked`/`resize_view_checked` are the resize-commit fence (attachment-epoch
+ control-revision guarded), but 0.10.1 has NO clear-control-keep-view primitive and its claim does not
refuse an occupied seat (it only CASes a revision) — so the occupancy rule ("empty seat or the
claimant's own"), the CELL-MINTED `holderGeneration` (stable across resizes; only an establishing claim
or a transfer mints a new one), the `geometryRevision` and its CAS, a standalone release, and the four
auto-releases all live in the cell. A released seat leaves ghosttea's controller INERT until the next
claim overwrites it (the door is the only path to a resize and gates every one on the lease). **The
verbs** (control leg, contracts as-built): `ClaimGeometry` (a re-claim of the OWN seat commits a resize
— there is no standalone resize verb) → `GeometryCommitted {holder, geometryRevision, cols, rows}` or
`GeometryRefused {code, currentHolder?, geometryRevision?}` (`SEAT_HELD` · `STALE_REVISION` ·
`RIGHT_MISSING` · `NOT_HOLDER` · `DESTINATION_INELIGIBLE` · the engine's `VIEW_SUPERSEDED`);
`TransferGeometry` (the current holder or a `geometryAdmin` caller hands the seat to `to`, ONE engine
claim on the destination's view); `ReleaseGeometry` (the holder yields — no engine call). **The flow is
optimistic and pure:** `geometry_precheck` (rights, the CAS, occupancy) returns Refuse | Proceed WITHOUT
touching the session; the door performs the engine op OUTSIDE the registry lock (`handle_geometry` /
`perform_geometry_op`); `geometry_finalize` re-checks the revision (a lost cross-client race → one more
`STALE_REVISION`) and commits or refuses — the table never touches a socket or the engine, the module's
purity intact. **The four auto-releases** (`release_geometry_if_held`): connection death (`leg_closed`
→ `invalidate`), grant expiry (`tick` → `invalidate`), VIEW DETACH (a demand-none that parks the view
gives up the seat too — `view_detached`), and a RENEWAL that drops the geometry right (`attach_control`
renewal path); the view detach itself clears ghosttea's controller, and a renewal that RETAINS geometry
keeps the holder for free (the activation, and thus the seat, survives the grant bump). A geometry-
capable view is attached READ-WRITE (`has_input || has_geometry`) because a resize is a terminal write
ghosttea gates on read-write access; the cell still gates BYTE input on the input right + the two-
dimensional lease, so a geometry-only view never types. **The honest migration reason
(`attach_frames`):** a resume whose `from` names a different `SceneEpoch` is a MIGRATION →
`SeedRequired{reason: "epoch-changed"}`; a same-epoch resume is viable but the dormant-cursor resume is
capability-gated (capabilities §5.4, not in the core profile) → `no-resume-capability`; no resume →
`no-cursor`. `session_epoch` (from `Session::session_epoch()`) is threaded into `AttachFramesInput` by
the door. Cross-cell migration otherwise already worked (a fresh cell has no `by_key` entry, so a
`replacesActivationId` naming an activation it never hosted just activates fresh; same-cell replace is
S3b's) — S3c adds the honest reason. **NOT built here: focus ⇏ claim** — the as-built "focus ⇒ claim"
hazard lives UPSTREAM (ghostty `runtime.js` / the renderer); it lands with the G23 bundle, not the cell.
**Wire (`wire.rs`):** serde mirrors for `GeometryClaimant`/`GeometryHolder`/`ClaimGeometry`/
`ReleaseGeometry`/`TransferGeometry`/`GeometryCommitted`/`GeometryRefused`. **Tests:** three PURE unit
rows in `activation.rs` (claim an empty seat → resize by re-claim keeping the generation → the revision
CAS + an engine refusal that does not mutate the lease; the geometry right + seat occupancy + a
holder-only transfer with `SEAT_HELD`/`NOT_HOLDER`/`DESTINATION_INELIGIBLE`, two clients on one session;
and all three auto-releases) — the table's purity lets them drive the whole precheck → (simulated
engine outcome) → finalize cycle without a socket; plus two END-TO-END rows in `tp_activation.rs`
against a real session + client: a claim RESIZES THE REAL PTY (asserted via `Session::control_state`),
a re-claim resizes again keeping the holder generation, a stale revision refuses without touching the
size; and the frames attach reports `epoch-changed` / `no-resume-capability` / `no-cursor`. `tp_door.rs`
updated (a geometry verb is served now: a claim naming an unattached activation is a STRUCTURED
`GeometryRefused NOT_HOLDER` and the leg LIVES, no longer a protocol close). `pnpm verify` verbatim
green (one rustfmt wrap on a hand-written test line). NOT in S3c: the stress/fairness rows (S3d), the
renderer routed runtime that makes it user-facing (G23), and G22 (until the accessor lands, the harness
hosts T1-born sessions itself and fieldd's legacy UDS clients cannot see them).

## TP-S3d — stress and fairness, cell side: the two-lane priority writer, class-aware admission, and the fairness floor

2026-08-22, `547fde5` (the orchestrator; the critical path). The fourth S3 slice — §8's writer/admission
correctness FLOOR (tuning + TP-R20 stay at S5, TP-D23). **The two-lane PRIORITY writer
(`field-native/src/tp/door.rs`):** the frames socket's one writer task is now a scheduler with an URGENT
lane (control replies + urgent incrementals) and a BULK lane (seed/catch-up transfer chunks). Urgent
drains FULLY before any bulk and the writer re-inspects urgent after EVERY bulk chunk — a background
transfer yields to an urgent incremental at chunk boundaries, which IS the bulk-induced-HOL floor. The
priority pick is pulled out as `pick_next` so the invariant is unit-tested without a socket. A per-socket
bulk BYTE-SEMAPHORE bounds how far bulk runs ahead of the writer (`maxBulkBytesAdmittedAhead`): a pump
acquires a chunk's worth before enqueuing it and the writer returns them as it writes; the semaphore is
CLOSED when the writer exits, so a pump blocked on a dead socket's permits ends promptly (no deadlock).
**Class-aware admission (`activation.rs` `CreditLedger`):** a `UnitClass::{Urgent, Bulk}` threads through
`can_admit`/`try_admit` and the `PumpHost`. URGENT draws the full connection window; BULK may consume
connection credit only DOWN TO `connection.limit − urgentReserve`, so an urgent incremental always has
room (`urgentReserve ≥ maxUrgentPresentationUnitBytes`). **The pump (`presentation.rs`):** deltas are
URGENT (`Outbound::Binary`, no backpressure) — but a delta whose payload exceeds
`maxUrgentPresentationUnitBytes` is NOT an urgent unit: the pump drops the lineage and repairs with a
(bulk) catch-up transfer (§8 "anything larger becomes a transfer"). Transfers (seed/catch-up) are BULK
(`Outbound::Bulk`): credit is charged FIRST, and only once admitted does the pump acquire the writer's
bulk-ahead permits — so a credit-starved loop never leaks permits. **The fairness FLOOR (§8 law 7 /
TP-R15a):** the per-activation credit window means a stalled activation exhausts only ITS account, never
the connection's — one viewer's stall is another viewer's non-event. Law 1 (a return for a stale/unknown
activation still credits the CONNECTION total, exactly once) was already sound in S3b's ledger and is
unchanged. **Contracts:** three §20-item-5 knobs — `URGENT_RESERVE_BYTES` (2 MiB),
`MAX_BULK_BYTES_ADMITTED_AHEAD` (4 MiB ≥ the chunk cap), `MAX_URGENT_PRESENTATION_UNIT_BYTES` (256 KiB) —
in `registries.TERMINAL_PIPELINE` + `ProtocolLimits` + `DEFAULT_PROTOCOL_LIMITS`, generated into
`registries.rs`, mirrored in the Rust wire `ProtocolLimits::DEFAULTS`, and folded into
`tp-protocol-limits.defaults.json` and the two `…accepted…` fixtures. **Tests:** the writer priority
(`door.rs` unit — an urgent unit jumps EVERY queued bulk chunk; each lane FIFO); the credit reserve + the
fairness floor (`activation.rs` unit — bulk stops at `limit − reserve`, urgent draws the full window; a
stalled account never blocks another's admission on the connection); and the oversized-delta → catch-up
path END TO END (`tp_activation.rs` — with the urgent-unit cap set just above the TRF1 header, a change
arrives as a `catchup` transfer, never a bare oversized `trf1-frame`). `pnpm verify` verbatim green. NOT
in S3d: the S5 tuning (weighted round-robin among many urgent sessions, per-session parse/CPU accounting,
token buckets, TP-R20); a synthetic flood BEYOND the engine's coalescing is not reproducible by output
volume (S3b's discipline note — a burst coalesces to ~one frame), so convergence-under-load is proven by
S3b's starvation → catch-up → `stopped{overload}` bound plus this slice's classification path, not a new
volume flood. Also NOT here: the renderer routed runtime that makes it user-facing (G23), and G22.

## EL8 — ghosttea 0.11.0: the G22/G23 bundle consumed at the pins

2026-08-23, `6a115b3` (recorded 2026-08-23 with the S3-input pass — the entry was owed at landing).
The lockstep upgrade 0.10.1 → 0.11.0 across every plane in ONE event: the two cargo pins
(`ghosttea`/`ghosttea-truffle` `=0.11.0`), six npm rows in `pnpm-workspace.yaml`
(overrides + `minimumReleaseAgeExclude`), and `scripts/preflight.mjs`'s EL8 pin table. Upstream
payload: **G22** — the in-process `ServiceSessions` accessor (session-by-id / frame hubs /
spawn-through-the-service with the private-env strip / `subscribe_lifecycle`), the door to ONE
shared session set between the UDS plane and the T1 doors (NOT yet consumed by the production door —
that is the integration slice); **G23** — `ghosttea-react`'s routed runtime
(`createGhostteaTerminalRuntime({transport:"routed"})`, activation authority on main,
envelope-before-apply, strong resize refusal on both paths). Cross-repo interop re-verified BEFORE
the bump: ghosttea's routed codec round-trips all 42 `@vibefield/contracts` golden vectors (30 wire
+ 12 structural), close codes identical, `DEFAULT_ROUTED_PROTOCOL_LIMITS` deep-equals the S3d
defaults. Consumption findings, fixed in the same commit: 0.11.0's `TerminalSurface` calls
`setViewInputPolicy`/`releaseResizeControl` on mount → the three field-app test fakes gained stubs;
the `controlsResize` TRIPWIRE test (a by-design failure awaiting upstream's ResizeObserver fix) was
rewritten to assert the fix (baseline-delta: zero resizes for a mirror); the flaky
`read_only_never_input_allowed…` row was root-caused to the pump's demand-none boundary + 0.11.0's
post-seed settling deltas — fixed by pump hardening (`needs_full` set the moment demand-none is
OBSERVED; frames dropped while unwanted) and `receive_transfer` skipping leading deltas — 20/20
deterministic after. One artifact-service flake under full-suite concurrency was exonerated
(pre-existing class; 3× green in isolation). `pnpm verify` verbatim green at the commit.

## TP-S3-input — the input verb: SendInput, the cell gate, and typing `exit` into a real /bin/sh

2026-08-23, `d265d70` (the orchestrator; the critical path). Mark 22 — proposed, RATIFIED
(James: "go ahead" on all five sub-questions as recommended) and LANDED in one day; the evidence
trail is `draft/thinking-terminal-input-verb.md`, the spec fold is core v0.15 (§5.4 + §17 mark 22 +
the §20 item 1 amendment). **The gap it closes:** TPv3 specified the input AUTHORITY in full
(`InputAllowed`, "the cell ALWAYS rejects input while its own `input` is not `allowed`", §18.1's
`runtime.sendKey → control WS send`) and never defined the MESSAGE — `TpMessageType` had 21 tags
and no input verb, the cell door no input arm; ghosttea-react 0.11.0 names the absence
(`routed-input-suppressed {wire-verb-unavailable}`) and sends whatever the host's `encodeInput`
returns RAW (`sendExtension` — "contract publishes no such tag, so Ghosttea never invents one
itself"), so the verb is VibeField-only: NO upstream release. **Contracts:** `SendInput
{sessionId, activationId, leaseEpoch, inputSequence, op}` + `SendInputOp` (a `kind`-discriminated
union — text · paste · key · mouse · scroll (SIGNED rows) · scroll-to · interrupt) +
`TerminalKeyInput`/`TerminalMouseInput` PINNED to ghosttea's engine serde (camelCase;
`unshiftedCodepoint` defaulting 0 exactly as upstream's `#[serde(default)]`; button=u8,
codepoint/dimensions/padding=u32, coordinates=finite f32-range, and JSON-number i64/u64 fields
restricted to their exactly representable subset); tag 22 in
`TpMessageType`, the 8th control-INBOUND entry; four golden fixtures
(`tp-send-input.{text,key,mouse}` + `tp-tagged-message.send-input` with rows −5). **The cell
(`field-native/src/tp/`):** `wire.rs` serde mirrors whose `InputOp::Key/Mouse` EMBED
`ghosttea::session::{KeyInput, MouseInput}` — the fixture test deserializing the vectors into the
engine's own types IS the cross-crate drift guard; a post-landing boundary row proves integer
overflows refuse, and the Rust mouse reader closes serde's f64→f32 overflow-to-infinity hole;
`activation.rs` `send_input` (a PURE read):
own-control-leg check → `leaseEpoch` placement fence (a stale-route input never reaches the
engine) → the `input` lease dimension (the one authority — rights, presentation, lag, expiry
margin) → a synchronous renewal-margin backstop (a stale-`Allowed` lease cannot leak past the
margin) → the presenting view (demand-none = nothing to type into); `door.rs` dispatch arm +
`perform_input_op` mapping the op onto ghosttea's view-authorized family with the CELL-owned fence
coordinates (`view`, `client`, `attachmentEpoch` from the activation table — the wire cannot forge
an epoch), engine `authorize_input` the backstop. Refusals are DROP-AND-AUDIT (§5.4's "always
rejects"; the echo of accepted input is a frame; `CellActivationStatus.input` already says why
typing is dead) — no per-keystroke ack rides the wire. **The renderer half
(`field-app/src/terminal/routed/encode-input.ts`):** the same-day latest-change review caught that
G23's supplied `inputSequence` is PER DOM VIEW while the cell/engine fence is PER ACTIVATION. The
replacement `createRoutedInputEncoder` owns one monotonic sequence across every view/remount of an
activation, resets on activation replacement, and retains at most the explicit admitted-session
budget. Guarded activation release, final session release and owner dispose are its exact inverses;
it never evicts a possibly live slot, and capacity/safe-counter exhaustion fails closed. The body
validates before state commit, so invalid/future input neither allocates nor spends a sequence;
`TerminalKeyEvent.location`/`timestamp` never reach the wire. **Tests:** the activation unit
walks EVERY drop reason (no-activation · wrong-leg · stale-lease-epoch · right-expired ·
no-view · input-not-allowed) and the Proceed's cell-owned coordinates; the e2e types over a real
WebSocket into a real `/bin/sh` — acceptance witnessed by ghosttea's human-input epoch
(`record_input(true)`; every refusal and the dedup return first), a replayed `inputSequence`
authorized ONCE, a stale `leaseEpoch` and a read-only second session (same socket pair) leaving
their epochs UNMOVED, and the typed `exit` TERMINATING the shell — the PTY round trip no header
inspection can fake (8/8 reruns green); the wire fixture test (the drift guard); contracts 331/331
with the new SendInput describe + leg-decode row; the encode helper validated against the contract
schema on the control leg; the correction adds cross-view/remount sequencing, activation reset,
bounded lifecycle and numeric limit proofs. `pnpm verify` verbatim green at the original landing;
focused correction gates are recorded with the follow-up. **NOT here:** the G22 `ServiceSessions`
integration into the production door (`cell.rs` still `NoSessions`), the routed HOST in the
renderer (`runtime-factory.ts` still builds the legacy port runtime; the direct-door flag is still
CSP-only) — that integration, then the full direct-path proof, PRECEDE S3e per the corrected
sequence; and the agent input lane (`automation_input`, epoch-gated so human input wins) is a
DISTINCT future seam, not this verb.

## TP-S3 production integration — G22/G23 on the real app path

2026-08-23, **LANDED `67c043d`.** This is the integration slice
the EL8 and TP-S3-input entries above explicitly left open. **G22:** `field-terminal-host` now starts
the Ghosttea service loop, obtains its `ServiceSessions` accessor, and installs that exact shared
registry as the T1 `SessionSource`; a real lifecycle test creates through the ordinary UDS service
and attaches the same session through BOTH WebSocket doors, proving shared `Session` and `FrameHub`
identity rather than a copied inventory. **G23 product boundary:** contracts add the exact Ghosttea
runtime-summary schema and scoped `terminal.sessions`; fieldd returns the authoritative birth
summary beside `terminal.create`'s ticket (so creation never waits for observation) and lists exact
summaries only for observed sessions. Electron main parses the rollback flag once and carries the
fixed `bridge|routed` selector plus login-shell/home policy on the authenticated window bootstrap.
The field-app pool installs one G23 routed runtime and host per window, with per-session ticketing,
renewal, multi-cell route accounting, `terminal.create`/`terminate` adapters, and the bounded
activation-scoped `SendInput` encoder. The bridge path remains the flag-off rollback and is not
forked in direct mode.

The production pass found and fixed the integration failures at their ownership boundaries. A
Ghosttea session epoch is a UUID-derived opaque `u64`, not a JavaScript counter; the cell now maps
each live engine lineage to a stable, non-reused, cell-local `modelGeneration` within JSON's exact
integer range and stores that translated epoch on the activation/pump. Empty-workspace birth no
longer pre-creates in the deck: G23 calls the product create adapter, which primes the atomic create
ticket for the FIRST activation before any observation-gated `openTicket` call. The routed host
also waits, with a 5 s bound, only through fieldd's explicit retryable `unobserved` inventory state,
so Ghosttea's one initialization cannot permanently lose a slow first snapshot. Render-worker
prewarm has its own 5 s bound and falls back to a fresh cold runtime instead of wedging a claim.
Legacy ticket extras are stripped at the G23 adapter, and termination/disposal release primed
tickets, input sequence state, birth summaries, placements, and cell accounting.

**Proof:** `pnpm smoke:terminal-direct` builds the production app and launches with
`--terminal-direct-door --terminal-direct-proof`. Four consecutive clean packaged runs reached a
real applied scene (`PresentationReady`), the cell-authorized input state (`InputAllowed`), focused
the real `TerminalSurface`, typed `touch /private/tmp/…`, observed the filesystem side effect, and
found no `ghosttea-terminal-bridge` utility process. The measured cold opens were 213–279 ms, below
performance §18.7's 300 ms target. Full gates at closeout: contracts 334/334; Electron shell
603 pass / 1 skip; field-app 648/648; fieldd terminal service 49/49; all four affected TypeScript
typechecks; `cargo fmt --check`; `cargo check -p field-native --all-targets`; and the complete
field-native suite, including 126 unit passes plus every non-environment integration row (the real
tailnet probes remain intentionally ignored). **Not done here:** TP-S3e. The rollback flag,
bridge/backend, and flag-conditional CSP remain until that next deliberate removal slice.

## TP-S3e — retire the bridge: the flag, the utility, the trio and the unions, all gone on purpose

2026-08-23, `8d47dbda` (the orchestrator; the critical path). The slice the whole rollout
discipline pointed at: with S3a–S3d, TP-S3-input and TP-S3-production green and four packaged
type+display proofs behind the flag, the rollback path is REMOVED rather than left to rot.
**Removed:** `parseDirectTerminalDoor` + `--terminal-direct-door`/`VIBEFIELD_TERMINAL_DIRECT_DOOR`
(the probe MODE stays); `terminal-backend.ts` + `bridge-entry.ts` + their esbuild entry and IPC
(`vibefield:terminal:connect|status` — the CLOSED contextBridge surface is 14 keys now, its pin
test rewritten); the preload/renderer-host/host `terminal` seam (`connect`/`onStatus`);
`terminal.connectTicket` (method + contracts row + fieldd handler — a retired door answers
NOT_FOUND, and a test proves the refusal mints nothing and writes no audit);
`TerminalTicket`/`TerminalConnectTicket*`/`TerminalBridgeStatus`/`TerminalBackendAttachResult`; the
S1 result unions (`terminal.openTicket` answers exactly `TerminalOpenTicket`, `terminal.create` the
id + REQUIRED birth summary + the spread ticket; `endpoints` REQUIRED — four era fixtures retired,
two `.valid` fixtures replace them); fieldd's sessionless/legacy mints
(`ticket()`/`ticketForSession`/`ticketForCell`/`toTicket`) replaced by ONE `ticketFor` assembly
with honest refusals (`grants_not_landed` for a keyless cell, `transport_not_landed` for a
doorless one — and createOpenResult refuses the same way AFTER the audited birth, which is the
GT-5b ordering kept honest); the pool's whole bridge half (`landTransport`, the pinned-cell fossil
+ its availability face, the bridge-status recovery ladder, `discardWarm`/`rewarmOnce`, the ports
factory branch — `WindowTerminalBootstrap.transport` is the literal `"routed"`). **The deliberate
CSP reversal:** production `connect-src` = the two pinned fieldd ports + `ws://127.0.0.1:*`,
UNCONDITIONALLY; `CspOptions` is gone and `security-policy.test.ts` asserts the widened policy ON
PURPOSE, stating in-file why the assertion changed. **Suites migrated to the routed truths:** the
kill-matrix/seam's outside observers attach over `daemon.native.terminalEndpoints` (the NF-D8
fieldd-plane truth — what they always meant) with the routed mint kept as the alive-control;
"single-cell pin" rows inverted to multi-cell (two cells' tickets at once IS the point of the
doors); a real regression the migration caught: the routed `adopt` never re-declared
pre-transport demand (the bridge's `landTransport` had) — fixed with `reprojectDemand()` at
runtime birth, and the demand suite's early-bind row now proves it. **Gates:** contracts 332/332 ·
fieldd terminal suites 56/56 · electron-shell 587+1 skip (CSP 84/84) · field-app 635/635 (77
files) · `pnpm verify` verbatim exit 0. **Named residue — the instrument debt:** the godview
smoke's flip-witness (GT-D11 e2e), rehydrated-$PWD and keystroke-echo rows plus the perf-lab's
`runInPane` typed through the UDS automation door addressed by the retired product ticket; they
are skip-marked LOUDLY (`s3eInstrumentDebt` on the smoke verdict; the lab throws with the debt
named) until the **AR-lane automation surface** (fieldd-brokered `automation_input` — the door AR
needs anyway) exists; the TP-R1 renderer unit rows moved with them (upstream's G23 suite + the
packaged direct proof are the living witnesses); smoke row 12 (bridge-kill recovery) retired WITH
its failure mode — no process severs transport-but-not-sessions any more (leg death:
`tp_activation`; runtime recovery: G23's bounded ladder; floor death: the NF kill matrix). The
`$0` tombstone row WAS rewritten to type through the renderer — the product path — with a bounded
retype (a line typed before `InputAllowed` is suppressed and never reaches the PTY), and passes
live; the CWD-MOVE instrument proved doubly blocked (renderer typing reaches only the focused
pane, AND the summaries gap below swallows a landed `cd`) and is skip-marked with both gaps named
— the restore MACHINERY (dead pane → honest consent counts → relaunch → floor listing) keeps
running. **And the first fully-ROUTED run of the
godview ladder WITNESSED a real product gap S3e did not cause, at three rows: routed SESSION
EVENTS never reach the renderer.** No wire verb carries summary updates (cwd/title freeze at
birth — a moved pane would restore in the wrong place) or floor-side lifecycle (a killed pane's
face never degrades — the deck kept showing a session the floor had ended). The floor knows the
truth in every case; the renderer never re-learns it. Gap-marked in the smoke verdict
(`paneMetaPersisted`/`recordedCwd`/`killedPaneFace` carry the G24-class tag) and named here as
the upstream ask: a routed session-event seam — summaries + lifecycle — or a fieldd-driven
re-register/lifecycle-push cadence.

## TP-S3f — routed session events: the pane learns the deaths it didn't cause (petition G24, a one-day round trip)

2026-08-23, `da5919c0` on `85f7d769` (the ghosttea 0.11.1 lockstep). The petition ran its whole
arc in ONE day: drafted from S3e's three witnessed gap rows → amended by the ghosttea-side review
(the draft's "armed but starved" evidence was WRONG — the ports frame handler is the sole arming
site, so routed mode needed the trigger AND the read; corrected at source) → implemented upstream
→ released 0.11.1 → consumed here. **The wire:** `SessionEvent` (tag 23, cell → client, CONTROL
leg) carries `exited{exitCode, exitSignal, requestedTermination, exitOutcome}` / `removed` /
`resync` behind the **`session-events` capability — the FIRST capability the cell speaks**
(TP-D25; load-bearing, not advisory: an un-negotiated client protocol-closes on any unknown tag,
so the cell must stay silent without the negotiation); the exit enums are extracted from
`TerminalRuntimeSession` so the same fact never gets a second spelling; golden fixtures
(`tp-session-event.*.json`) pin BOTH directions — Rust SERIALIZES the engine's own
`TerminationSource`/`ExitOutcome` (the emit-direction drift guard, `SendInput`'s
deserialize-inverse). **The cell:** ONE lifecycle subscription through the `SessionSource` seam
(`subscribe_lifecycle` — `ServiceSessions` = G22's bus; `DirectSessions` = a harness bus a test
can SHRINK to force the `Lagged` path), fanned out connection-scoped under one registry lock to
negotiated control legs; `Created` deliberately unprojected (births reach clients through the
roster reads they already do); `Lagged` answers with the honest resync notice. **The host:**
ghosttea 0.11.1's routed metadata refresh asks `getSession`, answered from ONE coalesced
`terminal.sessions` snapshot per refresh turn (N panes cost one wire read); `onExtensionMessage`
decodes against the contract, custody-checks the emitting cell (ticketed `cellBootId`; unticketed
sessions pass through — the runtime ignores unknown ids), and drives `applySessionEvent`, whose
appliers upstream are the UDS ones — parity by construction; a resync reconciles that cell's
custody against the authoritative inventory. The runtime advertises `["resume",
"session-events"]`. **Four findings, each now load-bearing:** (1) a VERB-driven kill's `Removed`
publishes at the verb while its `Exited` lands only when the child dies — the pair arrives
INVERTED, and applying it verbatim unregisters the session before its exit facts can reach the
face; the host holds an exit-less `removed` ≤10 s (`REMOVED_WITHOUT_EXIT_HOLD_MS`) and flushes it
in the intended order when the exit lands — order repair only, never invented evidence
(fake-timer rows pin the hold, the flush, the bound, and disposal). (2) The godview smoke's
keystroke synthesis had DROPPED SHIFT since GT-2 — every capital the harness ever typed reached
shells as its lowercase twin, invisible while every typed string was lowercase, caught by the
first mixed-case path the ladder ever typed and silent because APFS is case-insensitive. (3) The
deck's pane chrome is FACT-DRIVEN now: it settles once (~5×4 px) when title/cwd facts first land,
so box-exactness rows start from a settled deck (`settledPaneBoxes`). (4) ghosttea's
`runtime.terminate` removes local registration in BOTH transports before any event applies
(upstream design, read from the 0.11.1 dist) — a deliberate OWN kill never gets an event-driven
face; row 10 states it in the verdict (`ownKillLocalFace`) and the death-blindness witness is
row 9's FLOOR-side kill, waited for before the reload. **The three S3e gap rows UN-GAP on a full
green ladder (ok:true, 69 fields):** `paneMetaPersisted` (a typed cd reaches the persisted layout
through the routed refresh — the G24 witness) · `killedPaneFace: "exited"` (a death the renderer
did not cause degrades the pane) · `rehydratedCwd` (the relaunched shell's own first-prompt OSC 7
announcement, realpath-compared — no named-pane instrument needed, and the row LEAVES
`s3eInstrumentDebt`). Cold open 255 ms, inside the 300 ms target. **Seam witnesses at the fieldd
plane** (`terminal-seam.test.ts`): a raw negotiated control leg on the PRODUCTION binary receives
`exited` (all facts) and `removed` after a fieldd-driven terminate — unattached AND with an
active control attachment (the probes that exonerated the cell mid-debug). **Gates:** `pnpm
verify` verbatim exit 0 (one unrelated artifact-service concurrency flake on the load-17 host
re-ran green solo, and the whole gate re-ran green); the godview ladder ok:true/69 fields. Spec:
core v0.18 (the lifecycle verb §5.4 + the ordering law), rollout §15 S3f row + landing entry;
petition G24 → LANDED upstream 0.11.1 + CONSUMED.

## EL8 — ice 0.10.0: the magnet grid consumed at the pin

2026-08-25. Upstream cut the same day (ICE design-010/M17): the dot grid's
PIXELS become a field-reactive lattice behind unchanged interfaces — needles
orient along a superposed field of widget-silhouette SDF magnets and injected
point poles; the classic analytic grid stays the default renderer, and a
consumer that never mentions `magnet` is byte-identical to 0.9.0 (upstream
measured settled-idle ground redraws at ZERO with the mode on). Consumed
here: the exact pin 0.9.0 → 0.10.0 (catalog + release-age exclusion; ONE
loro-crdt@1.13.8 / strata-ecs@0.13.0 / ice@0.10.0 in the lockfile), the
`haloPoles` adapter (`field-app/src/cursor/halo-poles.ts` — OUR `Cur` halo as
screen-space poles, morph scale → strength so the field quiets exactly when a
widget owns the pointer; the design-010 §7 wiring, ported from the verified
widgetlab twin), wired unconditionally in `InfiniteCanvasGround` and INERT
until the appearance enables the mode, and the `magnet` passthrough on
`WorldGridAppearance` (absence-is-off per design-010 §10.1 — never write an
explicit off block; it would ride the spread through configureGrid and
clobber a factory enable). The §10.7 runIf gating on the halo systems landed
ahead of the bump (4a1642d4) — without it the pole observer would have redrawn
the ground every tick from day one. **Gates:** nx typecheck + test 24/24
projects green, biome clean, field-app 643 tests. **Deliberately NOT decided
here (DESIGN.md governs both):** enabling magnet as the product default, and
the dark-ink question — our dark dot `#1C1C1C` sits 5/255 above the canvas
and vanishes as needles; the upstream experiment used `#8A8A8A`-class ink.
Bench tweak controls for the magnet knobs ride the same decision.

## EL8 — ice 0.11.0: magnet is the build, dots are the product

2026-08-25. This entry supersedes the 0.10.0 consumer posture above without
rewriting its historical facts. Upstream design-010 revision 5 separates
classic and magnet into complete `GridPassFactory` implementations over one
parent-facing config/dependency contract; the published package wires magnet
only, so classic has no runtime edge and `GridMagnetConfig.enabled` no longer
exists. Vibe Field consumes that architecture directly: exact pin 0.10.0 →
0.11.0; `canvasGridConfig` always states `{ magnet: { glyph: "dot" } }`; the
`vf-magnet-dots` localStorage reader, Settings switch, and four-layer prop chain
are deleted. Dot is fixed product policy, not a second renderer switch.

The halo remains an injected `PoleSource` and is now honestly always subscribed
for the selected pass. Its producer still runIf-gates and settles, preserving
the zero-frame idle contract. DESIGN.md §2.1 closes the product ink decision:
the selected dark lattice uses the experiment's legible `#8A8A8A`, light keeps
`#A6A6A6`, and the classic alternate's `#1C1C1C` stays recorded as alternate-
build design data. Product and UI Bench mount the same `InfiniteCanvasGround`;
both themes render the real dot glyph, and Canvas Settings contains no renderer
toggle. The lock holds ONE ice@0.11.0 / strata-ecs@0.13.0 /
loro-crdt@1.13.8 graph. **Focused gates:** field-app typecheck; canvas-
appearance + panels + visual-tweak-document 15/15; browser verification in
both themes. **Full gate:** `pnpm verify` verbatim exit 0.

**Same-day glyph follow-up, before this consumption event was committed.** The
fixed-dot sentence above is superseded only at the selected implementation's
tuning seam: Canvas Settings now offers an explicit Dot/Needle segmented
control, defaults to Dot, and persists `vf-magnet-grid-glyph` per device. It
changes only `GridMagnetConfig.glyph`; it does not restore `enabled`, ship the
classic pass, or introduce a renderer-selection edge. The setting rides the
existing chrome-owned presentation state into the same `canvasGridConfig`.
Focused grid/persistence/Settings/UI-Bench tests are 21/21; the real shared ICE
specimen was eyeballed Dot→Needle in light and Needle in dark; `pnpm verify`
again exits 0 after the follow-up.

**Same-day Design System completion.** The visual-tweak workbench now owns a
typed `magnetGrid` block matching all eleven fields of ICE 0.11's
`GridMagnetConfig`: glyph, reach, polarity, widget-source valve/strength/radius,
alignment, needle length/width, source cap, and zoom fade. Every control flows
through `canvasGridConfig` into the same `InfiniteCanvasGround` used by the
product; the isolated bench adds ICE's local-pointer pole so field tuning is
observable without a document, while product composition remains halo-driven.
Preset exports move to v3 and round-trip the complete block; v1/v2 imports
migrate to the reviewed defaults atomically. Focused grid/codec/control tests
are 15/15, field-app typecheck is green, and browser verification exercised the
real GPU specimen from Dot/60px to Needle/120px.

## DEV — VibeField Studio replaces the standalone UI Bench

2026-08-26. The appearance workbench and real product now run under one
Studio-capable development host. `b8133466`/`86598f6d` established one complete
`ProductAppearance` document and projection path; `8597ce8e` added separate
product/Studio renderer and preload entries over the ordinary desktop host;
`60a5e767` added the bounded MessagePort router, revision/ack protocol, latest
snapshot slot, reload grace, and product-owned strict parser; `714ebaa7` added
explicit Live controls, delivery status, Bring App Forward, and the
development-only product disclosure; `57c725e4` added the boot-scoped local
runner command endpoint and child-process IPC so `pnpm dev:studio` and
`pnpm dev:design` attach to an active `pnpm dev` instead of creating a second
stack.

The old standalone Electron Bench shell and its runner are deleted. The
browser-only catalog remains as `pnpm dev:design:web`, has no live-product
authority, and builds only under `.vibefield/studio/catalog-renderer/`.
Appearance preview is a complete in-memory override above persisted product
preferences; Live off, Studio close/crash/timeout, or host disposal clears it
without writing settings or source. Product and Studio use separate sandboxed
windows, preloads, and sessions. Production main/preload/renderer entries have
no Studio or catalog edge, enforced both structurally and by artifact scans.

**Landing gates:** full `pnpm verify` green; development runner 80/80; focused
Studio shell 24/24 and catalog/boot ownership 17/17; contracts, field-app, and
electron-shell typechecks green; browser catalog build green; production main
960,015 bytes and renderer 45 files / 9,673,134 bytes with Studio, Design
System catalog, and perf-lab markers absent. Physical Electron verification
confirmed queued and ready-state command attachment, Live revision delivery
from Dot to Needle, product disclosure at revisions 1 and 2, and immediate
restoration when Live was paused.

**Cross-audit closure.** `dc0563de` made development shell outputs structurally
disjoint from production and taught the production verifier to scan the exact
main/preload/renderer artifact set; `f8d91359` fenced acknowledgements to the
active product instance and made reconnect/disconnect state honest;
`ba89c676` completed product theme/zoom context, section navigation, catalog-only
copy, and Settings ownership. `c78f0cd2` added the `pnpm smoke:studio` physical
Electron gate and fixed the failure it exposed: protocol v3 now proves
main→product→main delivery with a matching connection ID before claiming
Connected, while transferred ports are generation-fenced against out-of-order
arrival. The gate edits magnet reach and overlap radius through the real Studio
UI, observes the real product, reloads and verifies replay, closes Studio and
verifies restoration, and checks the live fieldd door without logging its token.
Two consecutive physical runs passed; electron-shell 642/2-skip and dev-runner
84/84 were green. Intentional smoke shutdown no longer reports cancelled
background typechecks, and endpoint derivation now has an explicit Windows
named-pipe witness.

## UI — the catalog decomposes; composition doors and the kit barrel become structural

2026-08-28. Three slices prepare the UI system for the four-views era without
moving working product code. `c81c6af1` splits the 1,705-line DesignSystemPage
into a ~175-line shell plus one module per section under
`design-system/sections/` (verbatim moves; shared harness chrome in
`catalog-ui.tsx`, the Studio toolbar and its status copy in
`StudioToolbar.tsx`), and `ui-system-boundaries.test.ts` now discovers
`sections/*.tsx`, so the replica and production-view rules cover a new section
the moment its file exists. scenes.css was deliberately not split: a flat
1,499-line sheet with no per-section structure is classification risk for zero
behavior gain.

`6630874a` makes cross-package catalog composition a stated, enforced door
(docs/UI_SYSTEM.md §Catalog fidelity): catalog code imports another workspace
package only through `@vibefield/contracts`, the design-kit foundation, or that
package's own `./design-system` entry — the plugin-browser precedent
generalized into the rail every future view package rides. The one standing
violation was paid rather than excepted: widgetlab's WEATHER_GRADIENT moved to
a leaf `content-tokens.ts` behind the plugin's new `./design-system` door, and
the ownership test names any other path file → specifier.

`9cbcd799` moves the GL-card surface (GlLiftGroup, makeGlCardChrome) behind
design-kit's dedicated `./gl` entry: the root barrel is GL-free by
construction, retiring the 2026-08-10 splash-bundle class structurally instead
of by rule. plugin-sdk's `ui.ts` re-points internally, so the curated SDK
surface is byte-identical and every widgetlab GL card compiles unchanged. The
honest bound: the barrel still reaches `@vibecook/ice` core (→ loro) through
CardShell's chrome projection, so the boot-path leaf-import rule stands at a
lower stake — dated corrections at both comment sites, never a silent
retirement.

**Landing gates:** per-slice `pnpm verify` verbatim exit 0 (three runs);
field-app design-system + boundaries suites green including the new
composition-door test; design-kit, plugin-sdk, field-app, and widgetlab
typechecks; widgetlab 4/4; bundle:assert OK (initial 516.1 KB raw / 138.5 KB
gz, world lazy, three.module its own lazy chunk); `TMPDIR=/tmp pnpm
smoke:canvas` exit 0 with the census witnessed
({"widgetTypes":23,"plugins":6,"stagedPlugins":5}, all five staged stylesheets
loaded including vibefield.widgetlab).

## LSF — the live-surfaces foundation (reconciliation entry, owed since 2026-08-16)

2026-08-28, recording work landed 2026-08-15/16. **This entry is twelve days late** — the
track landed with zero presence in this ledger, ROADMAP, or DECISIONS, the same drift class
the 2026-08-07 reconciliation pass fixed for IOS-3 and the UI system; an onboarding read
found it. The work itself:

**LSF-0…6 landed on main across `9a8ee9b1`…`90b54219`** (~17 commits interleaved with
PRC-0…3), and `specs/live-surfaces-foundation.md` was RATIFIED at v0.9 (2026-08-16,
LSF-D1…D16). One window-scoped Live Surfaces runtime with two pixel-producer families —
Chromium OSR shared textures, and ScreenCaptureKit with secure IOSurface Mach handoff (the
iOS Simulator as an SCK specialization: simctl + cross-Space window resolution +
Accessibility `iOSContentGroup` crop). What's real: `contracts/src/live-surfaces.ts` (wire
vocabulary) · `packages/live-surfaces` (pure lifecycle/demand/frame-queue runtime, renderer
inbox + WebGPU texture store, the frozen `LiveSurfacePresentation` handoff, soak/fault
testing) · `electron-shell/src/main/live-surfaces/` (window host, ticket table, texture
forwarder, guarded browser producer + security policy, SCK/Simulator producers, the
main-private control-binding seam) · the Swift accessory capture helper + least-privilege
adapter under `apps/desktop` · four lab entry points incl. two 20-minute soaks. The
production preload and product renderer host already carry the transport (one-use nonce
bridge, four ports per renderer generation) — claimed on every product boot, no consumer
yet.

**Evidence highlights:** the final macOS soaks held ten Browser + four SCK surfaces for
20 minutes — 328,038 shared frames exactly reconciled, zero quarantine, zero primary-path
CPU conversions, two forced helper kills and two WebGPU device losses recovered (worst
recovery gap 852.5 ms; scoped main duty 6.76%; import p95 0.080 ms); the real-Simulator
mixed run reconciled 313,759 frames including a live rotation rebind. **LSF-3C** proved
stock agent-browser 0.34.0 against the exact offscreen targets — all 24 AB cases — and
**selected the production containment boundary**: an authenticated target-scoped loopback
transport over `webContents.debugger` via the `browser.provider`/`directPage` seam; the raw
Electron debugging endpoint is forbidden, with the attack demonstrated on record
(`draft/browser-spike/report-agent-browser-*.json`).

**Still open, deferred deliberately (2026-08-28, the DT reorder):** the LSF §18 Windows
rows (LSF-3 lab · LSF-3C AB matrix · LSF-6 soak) and the LSF-4 signed/notarized
helper artifact (credential-bound; rides EDP/WP10). The foundation's consumer is track
**DT — the dev tool pack** (`draft/thinking-devtools-pack.md`, DT-D1…D12 — RATIFIED the
same day, deltas folded), which
James ordered FIRST among the production packs on 2026-08-28 (mind map's gate unchanged;
order recorded at source in `thinking-prod-dogfood-packs.md`). Nothing in the tree changed
in this pass; the un-ledgered 8/24–25 PLUG commits (`b4adabb2` staged plugins in the dev
document · `3e638961` staged boot serving hardened · `b521466e` per-plugin CSS isolation)
are named here rather than given late entries of their own.

## DT-1 + DT-2a — the authority path is real end to end; the pool waits behind the seam

2026-08-28, four commits in one evening, two by Opus worktree builders under review.
**DT-1a `b35f3132`** (the vocabulary, both sides plumbed): three scopes
(`surface.attach/browser/capture`; `surface.control` reserved, none tailnet), three
`surface.*` method rows (locality local; the kind→scope matrix documented as the
service-level gate), the redacted product shapes, and the three INTERNAL shell provider
doors (`shell.surfaces.enumerate/mint/release`) with fieldd's contract rows, ProductAPI's
typed internal helpers, and main-side dispatch landing together so the exact-set provider
registration never broke. **DT-1c `501bb978`** (the main-side authority, the security
heart): production custody over the LSF runtimes — capture kinds dedupe on the canonical
source (one SCK session per watched window), `reuseKey` entries re-bind the SAME running
runtime across renderer reload (the reason main custody exists; `SurfaceOpenParamsV1` and
the mint door gained the optional key), un-keyed entries sweep when their document dies,
window death releases everything it owned; the renderer boundary gained `resolveCurrent`
(participant AND incarnation must match a live generation — a stale document can never
bind new authority, LSF-D6/D14); enumeration REDACTS to {kind, sourceRef, title, appName};
caps 64/32 → RESOURCE_EXHAUSTED; 16-case authority suite. **DT-1b `5d35b0b0`** (fieldd's
policy door, builder-built): `surface.sources/open/close` registered beside their peers —
the kind→scope matrix on top of the fabric's automatic registry-scope gate (verified at
`product-api.ts` `def.scope !== null`), the local-window binding read off the local-token
principal's PRC-D14 `rendererParticipant` (absent = FORBIDDEN_SCOPE — mcp/tailnet/peer
AND shell-main refused: a surface is a view inside one window), a bounded 64-entry replay
map keyed {tokenId, participant, INCARNATION, idempotencyKey} storing the in-flight
promise (a racing retry collapses onto one mint; failures evict), and the attempt→outcome
audit pair whose serialized ledger provably contains no URL, sourceRef, UDID, or ticket
token. **DT-2a `0e3b6056`** (the renderer pool, builder-built): one refcounted attachment
per key per window over the transport the product-host has claimed-and-parked since LSF —
generation-stamped single-flight (concurrent acquires spend ONE ticket), 60s grace that
folds demand to PAUSED while nobody holds (PF6: grace keeps the session warm, never a
licence to keep capturing), a pool-owned never-reset demand-revision counter, host-close
reconciled from `attachment.closed` (the transport's own close paths don't always notify —
read from the code, tested both ways), and a snapshot that cannot carry a ticket by
construction. `mountFieldApp` gained the optional `host.liveSurfaces` seam;
`getSurfacePool(host)` answers null in the browser-only catalog.

**Findings worth the ledger:** (1) `owner.pluginId` on the mint door has NO reachable
caller in v1 — TokenService refuses a token bound to both a plugin and a renderer window
("ambiguous bindings"), so plugin provenance on surfaces waits for via-attribution in the
caller context or a token-model decision; the suite pins BOTH halves of the unreachability
rather than leaving it looking supported. The DT-3 browser widget is unaffected: plugin
renderer code calls on the WINDOW token. (2) The builder's raw-NUL separator made its own
source file binary to git while tsc/vitest/biome stayed green — caught pre-commit via
`git show --stat` reading `Bin`; now a standing memory. (3) A verify run in main while a
worktree builder ran real-daemon suites (load 124) redded fieldd's TC-S1 supervision row
plus field-app's known 'serving' flake — both load artifacts; the gate re-ran green quiet.

**Gates:** per-slice typechecks + suites green (electron-shell 658+16 · fieldd full suite
×9 by the builder, 673 passed/3 skipped · field-app 677); `pnpm verify` verbatim exit 0 at
DT-1a and DT-1c; on the merged tree the gate ran three times — the first two each redded
ONE pre-existing timing row under load spikes (the finding-3 collision, then field-native's
sweep-budget row at load 44–66, green in isolation at 2.26s), **the third run exits 0
verbatim and is the landing gate of record.**

## DT-2 COMPLETE — surfaces paint, plugins reach them, the catalog shows them

2026-08-28 evening, three more commits. **DT-2b `1aef94ec`** (mine): `presentLatestVia` —
the additive DOM-era consume door on the frozen presentation seam (one latest frame to a
synchronous consumer, lease released and frame closed on every path; the foundation lab's
own 2D `drawImage` on-screen path productized; the WebGPU store untouched for the GL/ICE
compositor era) — plus the field-app view layer: the element→demand law (invisibility folds
to paused@0 at the source, PF6; apparent device-pixel size maps to the reference fps
buckets), the headless view controller (its own suite caught the mount-push defect before
commit), and the shipping `LiveSurfaceView`. **DT-2b-2 `d8440045`** (builder-built,
reviewed): the catalog's LiveSurfacesSection mounting the SHIPPING view over a real pool on
a fake transport with OffscreenCanvas→`VideoFrame` fixture frames (honest UnavailableState
where WebCodecs is absent), and the `ctx.pool` SDK door with `{liveSurface}` — keys
namespaced `${pluginId}:${key}`, the narrowed handle with `presentation` ABSENT (PA-22; the
real handle lives in a WeakMap only `SurfaceView` can reach), acquisitions tracked on the
activation's own PRC-1 scope so deactivation releases everything, pool-null hosts answer a
permanently-lost handle with honest words, mint = one `surface.open` per attach attempt on
the plugin's own guarded client with deliberately NO idempotencyKey (the service replay map
is for wire retries; fusing deliberate retries would replay a spent ticket).
**DT-2b-3 `7f48ce0e`** (mine): the builder's finding closed at source —
`surface.attach/browser/capture` join `PLUGIN_CAPABILITY_ELIGIBILITY` renderer-eligible
(my DT-1a omission had left the door complete but every plugin mint refusable), the
regenerated authoring docs riding the same commit per the gen law; the design-kit import
moves to the `/primitives` deep entry; and the LiveSurfaceView compliance pass after
reading DESIGN.md/UI_SYSTEM in full (colocated namespaced stylesheet, the real
`--vf-text-*` ramp, UnavailableState + quiet UiButton faces, lowercase stage-label voice).

**Named debt (the one DT-2 leaves open):** nothing calls `surface.close` yet — the pool
releases ATTACHMENTS, but main-side custody releases only on window death, stale-incarnation
sweep, or caps (32/64 → RESOURCE_EXHAUSTED). Bounded, honest, and carried to DT-3's top:
`SurfaceTicketSource` grows a close half wired to `surface.close` on the pool's permanent
entry drop. **Gate record, stated plainly:** the first landing run redded one further
load-tail row (`native_logging` link-death, green in isolation at 5.48s — the fourth
distinct pre-existing timing row of the evening, prompting the batched-gate discipline now
in the worktree memory) and the second run caught TWO REAL defects of mine (stale generated
docs; a test pinning the pre-compliance copy) — fixed, amended unpushed into `7f48ce0e`,
and **the final run exits 0 verbatim as DT-2's landing gate.** Suites at close: field-app
86 files/697 · plugin-sdk 6/28 · the full 24-project graph green.
**Next:** DT-3 the browser widget through the staged chain, custody-close fix first.
*(This line originally repeated the DT-1 entry's "next: DT-2b" by copy slip — corrected
2026-08-28 late evening in the same sitting; the ROADMAP row was always right.)*

## DT-3 platform wave — custody paid back, the input lane opens, the plugin steers

2026-08-28 late evening, three commits, all mine, each gate-verbatim exit 0.

**DT-3a `596dbf89` — the custody debt retired.** `SurfaceTicketSource.mint()` now returns
a grant `{ticket, surfaceId?}` and gains an optional `close(surfaceId)`; the pool retains
one CustodyClaim per installed attachment and pays every successful mint back EXACTLY once
at the moment its use permanently ends — loss, grace lapse, supersession by a retry's fresh
mint, attach-failure-after-mint, and the attach that resolves into an already-dropped entry
(the claim closes via the SOURCE that minted it; a later acquire may have swapped
`entry.tickets`). The ONE deliberate exception is pool dispose and failures caused by it:
the window is unloading and reuse-keyed custody surviving into the next document IS the
reload continuity main custody exists for; window death stays main's own cleanup. The
plugin door wires close to fieldd `surface.close` on the plugin's own client, deliberately
NOT behind `assertOpen` — the grace timer routinely outlives the activation that minted.
**Recorded caveat:** a close firing after deactivation rides a closed client and rejects;
the pool swallows it and main's stale sweep/window-death release absorb the residual
custody — one idle runtime per reuse key per window lifetime, worst case. Snapshot gains
`custodyCloses` for the census conservation check. Door header errata at source:
"always refuses" stopped being true at DT-2b-3.

**DT-3b `8261f275` — the input lane.** The spike left a complete CDP input engine in the
browser producer with the note "authorization is deliberately outside
LiveSurfaceAttachment"; this is that authorization. Contracts gain
`LiveSurfaceInputEventV1` (pointer/wheel/key/text — CSS LOGICAL coordinates per LSF §10.2,
bounds matching the engine's own), `LiveSurfaceNavigationCommandV1`,
`LiveSurfaceBrowserStateV1` (committed url/title/loading/history truth riding runtime
summaries), and input/navigate renderer control messages stamped with the geometry
revision the sender mapped against — none of it crossing to Rust (the renderer control
port never touches fieldd; gen unchanged, gate-checked). The control session forwards
behind the redeemed ticket's operations with three deliberate asymmetries: unknown
attachment = SILENT drop (the stream races the host's own detach by design — a fault
would let an ordinary race tear down every surface in the window), missing operation
grant = protocol fault, generation closed (grants are fixed for the attachment's lifetime
and the shipping sender checks first — nothing legitimate produces it, EL7), laneless
runtime = drop. The ticket vocabulary gains "navigate"; the authority mints browser
tickets `view+pointer+keyboard+navigate` and keeps capture/Simulator view-only (DT-D6),
pinned both ways in the authority suite. The producer translates wire→engine UNSCALED
(the double-scaling class), counts engine refusals as dropped stream frames, re-validates
`go` URLs against the same top-level scheme policy as the initial load, and publishes
navigation truth CLAMPED to wire bounds — a page's 9KB URL degrades to truncation, never
to the schema fault that would kill the generation. The transport's renderer attachment
gains soft-fail `sendInput`/`sendNavigation`; the LSF "no semantic control" law is
restated, not repealed — CDP sessions and DOM access (DT-5's broker) still have no
surface on the attachment.

**DT-3c `653771a0` — the renderer half.** The pool handle carries
`sendInput`/`navigate`/`browser` (summary changes that do not close the attachment now
notify holders, so a URL bar tracks the page without polling); `sendInput` takes the
sender's EXPLICIT geometry revision — §10.2's honest reading is the revision the
coordinates were mapped against, the displayed frame's, not whatever summary is newest.
`input-map.ts` is the one place canvas box → logical space happens (contain-fit letterbox
answers null rather than clamping a click onto the page edge; visibleRect origin offsets
BEFORE the logical ratio; unit-pinned against the dpr² double-scaling class).
`LiveSurfaceView` wires pointer/wheel/key/text only while `interactive`, maps against the
displayed frame's geometry captured at the draw sink, types through the committed-text
lane beside key events (CDP key events alone insert nothing), and leaves right-click to
the page. The producer derives virtual key codes for the named special keys — producer
knowledge, never sender-trusted wire. The door narrows navigation THROUGH and raw input
AWAY (the PA-22 companion: input belongs to the view's map); `browser` truth is an
explicit field-by-field copy, passthrough extras stripped. The SDK mock pool drives
browser truth (`setBrowser`) and records `navigations` for widget tests.

**In flight at this entry:** the DT-3d widget itself — an Opus builder in `../vf-dt3`
extending the EXISTING `plugins/browser` (`vibefield.browser` is today the Artifacts
side-panel plugin; the ratified design adds the canvas widget INTO it) — manifest widget
contribution + `surface.attach`/`surface.browser`, DT-D7 durable `{url,title,showChrome?}`
with gesture-edged url commits, nav chrome per DESIGN.md over the SDK ui door,
`SurfaceView interactive` gated the terminal-mirror way, census rows. Merge, review, and
the staged-chain witness land with the DT-3 completion entry; the both-themes eyeball
stays James's.

## DT-3 COMPLETE — a page you can steer where it sits

> **Errata (2026-08-29 morning, James's report: "not working at all"):** this entry
> declared a steerable page on unit suites, the playground mount, and gates — and NO ONE
> HAD EVER RUN IT. Three product defects stood between the code below and a working card,
> all found by the first live run and fixed in §DT-3e: every plugin mint was structurally
> impossible (the door rode the plugin lease, which can never carry the renderer identity
> fieldd binds surfaces to — two facts BOTH pinned in suites since DT-1, never joined),
> the window token carried no surface scopes, and the tray sandbox-mounted the real card
> into a hidden live browser runtime. The claims below about the CHAIN's design remain
> accurate; the claim that it worked was unearned. The lesson is now law in this repo's
> practice: an end-to-end feature is not COMPLETE until a live witness has run.

2026-08-29 just past midnight. **DT-3d `d7abb669`** (Opus builder in `../vf-dt3`,
claim-verified against the code before the ff-merge): the canvas browser widget joins
`vibefield.browser` BESIDE its Artifacts panel — manifest widget contribution
`vibefield.browser.page` with the repo's FIRST per-prop conflict groups
(`address`/`title`/`chrome`, the DT-D7 split so a rename never fights a re-bind),
capabilities gain the two surface scopes, and the card acquires through `ctx.pool` with
key == reuseKey == the entity key. The gesture-edge law as shipped: a submitted address is
durable IMMEDIATELY (intent, whether or not the page loads), one gesture arms exactly one
edge so an immediate redirect lands while SPA history noise never rewrites the document,
and an empty title fills once. Engagement is the note card's double-click, `keyboard:
"exclusive"` + `keyboardEscape: "release"` — the OPPOSITE call from the terminal mirror's,
for the opposite reason — and engaging moves focus onto the host view's own element
(the builder's own find: without it the ring said "yours" while keys still panned, and
blur-to-leave could never fire). Census: `widgetTypes` 23 → 24 with `stagedPlugins`
honestly UNMOVED (the plugin was already staged for the panel), and the playground's
empty-pass subject renamed to the genuinely widget-less `kv-service`. The playground
renders the real card as an independent mount witness; 20 plugin tests + 42 playground.

**Recorded ceilings and trade-offs (the builder's, verified):** a plugin has NO durable
entity key (`Entity` is a branded runtime number; the ECS runtime is key-ignorant), so
`reuseKey` re-binds within one renderer generation — remount, cull, grace — but cannot
promise reload continuity from plugin code today; the surface a reload orphans is swept by
main's stale-incarnation sweep and the card re-attaches to its durable url, which is the
half of the promise DT-D7 actually makes. The redirect trade-off is one-edge-per-gesture,
chosen over never-following (which would lose the address the user actually reached).

**DT-3d follow-ups `3afd7e4a`** (mine): the catalog mounts the shipping card —
`BrowserPagePreview` through the plugin's design-system door, the real `SurfaceView`
injected as an adapter over the section's own fixture pool (chrome states from the
plugin's fixture, moving pixels from the pool; engagement, the §10.2 map, and the demand
fold run live in `pnpm dev:design:web`). The walls HELD during composition:
`ui-system-boundaries` refused a plugin-sdk type import in the catalog and the types now
derive from the door itself. The SDK's stale "no plugin can mint" paragraph got its dated
correction at source (the builder's finding). **`1b496795`** (mine): the evening's
flakiest gate row fixed at source — `native_logging`'s 5s mgmt-bind deadline widened to
its sibling's 15s, on the builder's measurement that the daemon binds in ~0.13s and only
load ever tripped it.

**Gate record, stated plainly:** the landing gate was DELIBERATELY HELD ~1h through a
200+ load average (James's own `search-bench` run — a gate under it would have measured
the benchmark); once the box settled to its normal weather the first run redded ONE row
(`godview-tuning` reset-and-close, 5.9s under suite concurrency, 7/7 green in 2s
isolated — the load-tail class, unrelated to this tree) and **the second run exits 0
verbatim as DT-3's landing gate.**

**Still owed, named:** the physical acceptance — on-canvas navigate + type into a REAL
page — is James's both-themes eyeball (`pnpm dev`, add a Browser card, double-click in;
esc leaves); `pnpm smoke:canvas` witnesses the census row when next run. And the product
authority chain (`surface.open` → custody → attach → close over real daemons) still has
NO headless smoke section — the lab-era smoke exercises producers and tickets directly.
Carried as DT-4's opening row, where the pickers will need the same rig.
**Next:** DT-4 `vibefield.devtools` (Simulator + window-capture widgets, pickers over
`surface.sources`, `engines.platforms: ["darwin"]`) → DT-5 the agent-control lane.

## DT-3e — the first live run, three defects, and the witness that now guards them

2026-08-29 morning. James: "it is not working at all, do the validation thoroughly." He
was right on every count. Three commits, one gate, and the ledger's first entry whose
primary artifact is a stack of screenshots.

**Defect 1 `d9a0e103` — every plugin mint was structurally impossible.** fieldd's window
gate derives `rendererParticipant` from the caller's principal; TokenService refuses a
token that is both plugin- and renderer-bound; the door minted on the plugin's lease
client anyway → FORBIDDEN_SCOPE on every mint, every card permanently lost. The two
truths were EACH pinned in suites since DT-1 — and never joined, because every unit fake
happily answered `surface.open`. The fix: the mint and the custody close ride the
WINDOW's own connection (`currentWindowClient`, resolved per call across daemon
replacement); the DT-D3 per-plugin half moves into the door as an effective-grants gate
refusing with fieldd's own vocabulary; the window token mints
`surface.attach`/`surface.browser`/`surface.capture` beside `terminal.attach` (same
posture: only spine code holds a window token, and the pool door is that spine code).
Via-attribution on the wire stays future work — LSF-D6 forbids caller-supplied owner.

**Defect 2 (same commit) — the scopes were never on the token.** Even a correctly-routed
mint would have failed the fabric's registry check: `system.mintWindowToken`'s scope list
predated the surface vocabulary.

**Defect 3 `8886f1d6` — the tray held a live browser behind its closed face.** ICE's
preview tiers sandbox-mount the REAL component when a widget declares no preview; this
widget's real component acquires a live surface on mount. The smoke's card census caught
a second `.vf-browser-page` under `vf-widget-tray__tile`, live at about:blank.
`BrowserPagePreviewTile` (tier 3) is now the tray's picture-of-a-page — no pool, no
handle, no ops.

**The witness `d5735150` — `pnpm smoke:browser-widget`.** Real daemons, real renderer,
staged plugin, a page served from the smoke's own process, screenshots at every rung
(default `/tmp/vf-browser-widget-smoke`): registration → readiness-gated spawn through
the engine's own op → mint/custody/ticket/attach/producer → frames on the card's canvas
→ committed truth in the chrome → double-click engagement → **one typed string traveling
Electron input → the view's §10.2 map → the ticketed port → the ops gate → CDP → the
page's own input → its title → navigation truth → the card's footer** → URL-bar steering
to a second page. Two consecutive exit-0 runs; the second on a machine whose GPU process
was fully disabled — the CPU fallback carried every frame, which upgrades that fallback
from designed to demonstrated. Findings the harness surfaced on the way, recorded in its
comments: a spawn fired before `data-doc-loading` flips lands in a world first-run setup
is about to replace (users are veiled from this; harnesses are not), and DOM-position
probes sample scenery when the tray also renders the widget's face.

**Gate:** `pnpm verify` exit 0 over the batch, at a 190 load average — the
`native_logging` deadline widening from `1b496795` earning its keep. **Still James's:**
the both-themes eyeball, now with a working thing to look at.

## DT-3f — the page lays out at the card: the logical viewport follows demand

2026-08-29 evening. James's second live report: "when a url is loaded, it is not filling
up the entire card size." Right again — oryzo.ai sat as a 1024×768 picture in the
top-left of his resized card, spilling over the foot. Two defects locked together, and
the DT-3e smoke could not have seen either: its 640×480 spawn was exactly the producer's
4:3 default aspect.

**The loop, measured live before the fix** (the new geometry probe, run 1: canvas
element 900×675 in a 900×532 well, backing 1108×831): the surface canvas was a grid
item, so its intrinsic backing sized the implicit track — the ELEMENT took the frame's
aspect and overflowed the well; the demand derived from that element then echoed the
frame's aspect back to the producer, whose `safeEffectiveRaster` accepted only
±1%-of-4:3 requests against a base pinned at the source's construction-time viewport.
Element ← frame ← demand ← element: locked at 4:3 whatever the card's shape, with
`Emulation.setDeviceMetricsOverride` re-pinning the layout forever.

**The fix `175d40a5` — LSF D8's first variable, wired.** `LiveSurfaceDemandV1` grows an
optional `logicalViewport`; the view declares its element's CSS box as the layout ask
(pre-DPR and pre-zoom — `clientWidth` is a layout metric, so board zoom stays a
presentation transform); folds take the largest-AREA holder's viewport WHOLE; the
browser producer is born at the demanded viewport, actuates viewport+raster together on
the stabilization debounce, and reports the CURRENT layout as frame geometry, which
input mapping already keys on. The canvas element is inset-pinned (no more grid-track
feedback) and the native base derives from the call's viewport. Two regression shapes
worth their names: the lib demand tracker's defensive copy silently DROPPED unknown
fields (a new demand field could parse, ride the wire, and never reach the producer),
and the view-controller compared demand with a hand-rolled field list that would have
missed the new field — both now ride shared equality, both pinned.

**The witness `322f20dd`.** The smoke spawns non-4:3 (with the reason in place), polls
geometry to SHAPE (element spans the well, backing aspect = element aspect ±2% —
density is transport policy), and gains an input-free relayout rung: a card BORN at
`/size` whose page names its own layout viewport into committed truth. **Full ladder
exit 0** on software rendering at load ~100, run 10 of the night: geometry exact
(element 900×532 in a 900×532 well, backing 1248×738 — the CPU-clamp of the demanded
1800×1064, aspect matched to 0.04%) · the size card laid out at its OWN 700×392 well —
two cards, two viewports, one lane · typed:hi through the whole input chain · URL-bar
steer · the steered `/size` re-laying the first card out at 900×532. Runs 2–9 each
failed at a DIFFERENT rung, all host-caused — the software GL context bind flaps per
launch and a GL-dead world keeps painted DOM but mounts no new island; a mid-run
re-veil froze typed input twice; a starved producer went 20s frameless while truth
kept flowing. The harness now names and heals that weather: GL-death relaunch (≤3
windows) · per-attempt spawn offsets (a dead window's orphan restored later and
stacked two cards under one double-click) · a sustained settled gate · note-card and
browser-at-proven-rect controls that grade WHICH half broke on a terminal failure ·
45s frame patience. `pnpm verify` exit 0 (the `behavior-conformance` churn red in the
first gate run re-ran green 3× in isolation — the known suite-concurrency class).
**Still James's:** the dev-mode eyeball on real hardware GL, where none of the smoke's
lotteries exist.

## SNAP-0 — the screenshot helper comes home: one line protocol, two native helpers, one door

2026-09-09, `46c0c190`. James: "port this tool prototype properly into our vibefield project
as a tool our electron app can use in the future, follow our coding convention and quality
here, plan and land it solid." The prototype is `research/screenshot2` ("Deskline", three
commits on 2026-08-18): a WeChat-style native screenshot — every display captured BEFORE any
overlay exists, then a borderless overlay per display above the screensaver level with window
snap, a 21× loupe, eight handles and five marks; Enter copies PNG(+TIFF/DIB) and prints one
JSON line. Swift/AppKit on macOS (ScreenCaptureKit stills, `swiftc` from the CLT, ad-hoc
signed `.app` because TCC keys on the bundle), Rust/Win32 on Windows (WGC → DXGI → GDI,
PerMonitorV2, a Direct2D/GDI overlay), and a thin Electron host. The design record is
`draft/thinking-screenshot-tool.md` (SNAP-D1…D9; DECISIONS carries the row).

**Where it landed, and why there (SNAP-D1).** A screenshot helper lives for ONE capture and
must outlive nothing — neither product truth nor native floor — so it is a shell-plane tool
on the SCK helper's rails: the contract in `packages/contracts/src/screenshot.ts` (TS-only,
not in the Rust gen bundle), the host in `@vibefield/screenshot` (Node-only spine library;
wall **R19** added and self-tested), the helpers under `apps/desktop/native/{macos,windows}/
screenshot-helper` with build/test/verify scripts beside the SCK helper's, the composition in
the shell. Both helpers' Cargo/Swift sources are the prototype's with the changes §6 of the
thinking doc lists — identity, the v1 protocol, no `--hide-pid`, the glass lookup.

**The protocol (SNAP-D2)** gained two things the prototype's host had to guess: `v: 1` on
every line and a typed error `code` (`permission-denied` · `capture-failed` · `no-displays` ·
`write-failed`) beside `message`. Seven fixtures under `contracts/fixtures/screenshot-*.json`
are parsed by zod (`test/screenshot.test.ts` + the fixtures sweep), by the Swift harness
(`VF_CONTRACT_FIXTURES`, six files decoded, refuses to pass on fewer) and by the Rust crate's
`contract_fixtures_decode` (five parents up from the crate — the brief said four, the builder
measured five). Stdout is protocol only; both `--standalone` banners moved to stderr.

**The host (`ScreenshotTool`).** One live helper at most, the slot reserved synchronously so
`busy` never lies; the 20 s pre-overlay timer `ready` lifts; a strict bounded line reader
(64 KiB) that poisons itself on the first refused line and kills the helper; typed answers
for every other ending (`helper-missing` without spawning · `helper-spawn-failed` ·
`helper-timeout` · `helper-exited` with the last stderr line · `helper-protocol` · `busy` ·
`disposed`); an exit-grace kill for a helper that lingers after its answer (a lingering
overlay would make every later capture busy); dispose kills a live helper; the last twelve
stills stay on disk, the oldest unlinked (SNAP-D4). 30 tests drive it with a scripted fake
helper that is a REAL node child process (real pipes, exit codes, signals) plus an
executable shell-script fixture on the default spawn + exec-bit path.

**The doors (SNAP-D3).** `registerScreenshotCapture` wires a pure `createScreenshotDoor`
(registered sender only · request checked at the seam · the answer validated BEFORE it
crosses — a tool returning a refused shape throws on main's side); the preload exposes
`window.vibefield.screenshot.capture()` validated both ways; `FieldHost.screenshotCapture?`
mirrors it for the consumer that does not exist yet. The View menu gains **Take Screenshot**
carrying the prototype's chord — `Control+Command+A` / `Alt+A` — as an APPLICATION
accelerator (a global chord is stolen from every other app and wants a preference first:
SNAP-1); the item is present-but-disabled where no helper resolves (SNAP-D5), and the menu
path shows the one dialog main owes: a macOS Screen Recording refusal names the setting.
`DesktopResources.screenshotHelperPath` resolves the bundle's inner executable (dev:
`apps/desktop/build/native/macos/…`; packaged: flat under `bin/`), the `.exe` on Windows,
null elsewhere — deliberately NOT boot-fatal, unlike the SCK helper: a screenshot is a
peripheral, and an absent helper is an honest `helper-missing` at capture time.

**Packaging.** The stager's `dir` entries learn `exec` (the bundle's inner binary keeps
0755); the `.app` (darwin) and `.exe` (win32) are OPTIONAL entries with a `produce` line;
electron-builder's `binaries:` gains the nested executable for WP10's inside-out signing;
`package:stage` builds the helper; `apps/desktop` gains `build:` / `test:` /
`verify:screenshot-helper`. The Windows crate is its OWN cargo workspace root (SNAP-D7; the
root manifest excludes it) and its `build.rs` skips the winres manifest when the HOST is not
Windows — the measured reason the prototype's cross-target check died (`rc.exe` absent) —
so `cargo check --target x86_64-pc-windows-msvc` and cross-target clippy are witnesses from
any host.

**Evidence.** Two Opus builders ported the helpers in parallel against complete briefs;
every claim below was re-run by the orchestrator, not quoted. macOS: build exit 0 (arm64,
`codesign` identifier `com.jamesyong.vibefield.screenshot-helper`, ad-hoc), harness ALL
PASSED with 6 fixtures decoded, live `--capture-test` on this Mac `ok` 3456×2234 @2× (10.8 MB
PNG, magic checked, then removed — the verifier now cleans the per-display stills it
graded), identity grep empty, the SNAP-D8 lookup probed standalone (the class resolves, all
three KVC keys read back), the verifier negative-controlled (width 99999 · `v: 2` · a
non-PNG all fail). Windows: `cargo fmt --check`, the cross-target check and cross-target
clippy at `-D warnings` exit 0; identity grep empty; `cargo metadata` names the crate as
its own workspace root; the real `protocol.rs` compiled as a standalone lib at the same
depth passes its 7 tests with an empty-fixtures negative control. The gate: `pnpm verify`
ran VERBATIM and is RED at `pnpm lint` — 4 biome errors, all in James's untracked
`work/composer-directions.html`, the same state `0bef361b` recorded; preflight, check:deps,
icons:check and typecheck (25 projects) green inside it; run separately on the same tree,
`cargo fmt --check` · `pnpm lint:rust` · `pnpm bundle:assert` · `pnpm test:rust` ·
`pnpm gen:check` exit 0 and `pnpm test` (25 projects) red on ONE row — field-app
doc-manager "restart honors vf-last-doc" at its 5 s timeout while swiftc and a live capture
ran beside it — green 2× in isolation (7/7). Walls `--enforce` clean including R19;
electron-shell 679/679 (+2 skipped) on its own; contracts 361/361.

**Findings.** (1) Eight of the prototype's thirteen `Theme` members had zero readers — the
chrome is the glass material with AppKit semantic colors; the five the overlay READS are
DESIGN.md's (`--vf-select` ring, `--vf-red` marks, the dark backdrop dim, white handles, the
1.5px ring weight); the eight were removed rather than left as a claim the overlay did not
keep, and the helper README says exactly what is worn. (2) The prototype's capture-test
could emit an `ok` with an empty path, which the contract refuses — it answers
`write-failed` now. (3) `JSONEncoder` escapes `/` as `\/`: valid, parses, byte-differs from
the Windows line. (4) Unknown helper flags fall through to the overlay path in both helpers
(prototype behaviour, kept; the host passes only `--once`). (5) The Windows helper's
`permission-denied` is now a real outcome — `request_capture_access` reports the OS
capability status instead of only logging it.

**Owed, stated plainly.** The macOS OVERLAY was not exercised live: `--once` is a
full-screen overlay on the developer's display and no agent may put one there — James's
first ⌃⌘A in `pnpm dev` is the witness (the port changed no overlay code beyond the glass
lookup; the prototype ran it from its own host on 2026-08-18). No test in the Windows crate
has run AS the crate (nothing here links Win32) — the box round is SNAP-4, spelled out in
`docs/WINDOWS_PORT_STATUS.md`. The consumer (the still onto the canvas) is SNAP-3; the
global chord SNAP-1; the fabric method under `surface.capture` SNAP-2. The `work/` lint red
is James's to clear (delete the scratch file or exclude `work/` in `biome.jsonc`).

## AR-0 — the three-repo workbench (2026-09-12)

**AR-0 the sibling workbench** (`ba717474` — puppeteer and rosetta enter as pinned sibling
checkouts; `draft/thinking-ar-sibling-workbench.md` §7 is the landing record, the triad design
is `draft/thinking-ar-agent-plane.md` §17). The AR track's first landing, and the pivot's first
code: chopsticks and spaghetti (retired by James 2026-09-04) leave the manifests; **puppeteer**
(the agent runtime) and **rosetta** (agent history) arrive as SIBLING CHECKOUTS pinned by revision
in `siblings.lock.json`, the truffle-era machinery of `cb652e0a` revived for two siblings with
`scripts/siblings.mjs` as the one reader (preflight, `check:deps`, the Nx cache stamp, the dev
runner and the shell's Vite config all go through it; `pnpm siblings` · `siblings:pin` ·
`siblings:build`). What is real: the fenced `link:` block (five puppeteer packages + the rosetta
client; consumers ask `*`; puppeteer-react deliberately NOT linked — its react peer would be a
second physical React, and `check:deps` now searches the linked directories too), walls
R20–R22, preflight's family rule and three proven negative controls, the Nx stamp (A/B/A cache
witness), sibling-mode `server.fs.allow` (200 / 403 / watcher-change witness), the runner's
esbuild context following a linked source (1.3 s rebuild, control touch silent), and fieldd's
**RosettadSupervisor** — one index daemon per user root at the new `LAYOUT.INDEX_DB`, configured
by `FIELDD_ROSETTAD_BIN`, projected into `FielddHealth.rosettad`, eight kill-matrix rows against
a scripted daemon speaking the real `--json` contract plus an opt-in row against the real
binary (protocol 20, announce file, clean SIGINT). *Errata 2026-09-12 (the AR-0 review): six
of the eight rows drove the scripted daemon — one was the bogus-binary row, one the frozen
projection's unit row; and the projection this entry names carried the daemon's origin to every
product client, which the review-fix entry below removes.* Upstream first (W-D9): puppeteer
`0a9eb8f` adopts `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` (486 sites, widened
at the declarations), rosetta `6119826` makes `@rosetta/protocol` a resolvable package clean
under them; both are the pinned revisions.

**Owed, stated plainly.** Nothing in the product imports a puppeteer package yet — the gate
meets puppeteer's 538 files at AR-2's first import, which S0 exists to make green. CI's clone
step needs a `SIBLINGS_TOKEN` read PAT (both repos are private) and stays red-honest until James
creates it; puppeteer is cloned but not installed in CI until its ghosttea override block is
gone upstream (PU-6). rosetta's CI runs no Node at all (RO-7). Two of James's in-progress
files carry one strict-flag site each (`adapter-kimi/src/services/account-usage.ts:322`,
`builtin-providers/src/providers.ts:501` into his grok options) — his to take, absent from the
pinned revision. The pre-existing imposter conformance red (`2791f4f`'s resume precheck, not
this pass) is likewise his. The Windows box round: rosettad has no Windows archive and builds
from source there. `pnpm lint` is still red on `work/` (SNAP-0's note stands).

## AR-0r — the workbench review's fixes (2026-09-12)

**AR-0r the review fixes** (`ac065747` — one critical, three high, and the medium/low rows
of the AR-0 review closed the same day; the re-pin rides in the same commit). The critical:
`FielddHealth.rosettad` had carried the index daemon's loopback ORIGIN and announce path to
every authenticated product client (`system.health.subscribe` is scope-null, the renderer
subscribes) while the supervisor's header claimed the opposite — and rosettad has no auth
(RO-1), so the origin is the secret (EL7). Now `RosettadHealth` (phase · detail · pid ·
protocolVersion) is the projection every client sees and `RosettadState` (+origin, +announce)
stays inside fieldd for the AR-1 doors; witnessed through a minted renderer window token (the
serialized health carries neither the origin, its port, nor the announce directory). The
highs: a SIGKILLed fieldd's rosettad held rosetta's EXCLUSIVE projection lock, so the
successor's child died on it, tripped the intensity and sat in a permanent "failed" — rosettad
now announces into a fieldd-PRIVATE directory (`LAYOUT.INDEX_DAEMONS_DIR`, never rosetta's
shared per-user dir: the EL7 beacon is gone with it) and every launch runs an ORPHAN PASS
first (stale file → removed; live pid answering `/api/status` with the rosetta header on its
announced loopback origin → put down before the new generation; live pid that does not answer
→ left alone, rosetta's own announce.rs rule), witnessed against the scripted daemon and the
REAL binary (the lock control: a second rosettad exits naming the owner); `system.index.restart`
(native.admin) is the door out, resets the window, bounces a live daemon without charging the
intensity window (RESTART_MAX 1 witness) and answers the projection; an empty
`FIELDD_ROSETTAD_BIN` is unconfigured, never a spawn of "" (bin.ts, the daemon, CI's env
capture). The rest: stderr rides the failure detail and every pre-ready line is logged; utf8 on
both streams; an unanswered SIGKILL is bounded; preflight's family regex takes pnpm's quotes;
the CI PAT is scrubbed from the sibling clones; `siblings:pin` warns on an unpushed pin;
`siblings:build` names a missing cargo first; the Nx sibling stamp is a `siblings` named input
on fieldd and field-app only (A/B/A witness: contracts a hit across a sibling change, fieldd a
miss then a hit); fieldd imports `@rosetta/protocol/protocol-version` (RO-4). Upstream:
rosetta `f1e9316` (the `./protocol-version` export, the ordered-cache invariant throws, a
`protocol-ts` CI job — RO-7 CLOSED) and puppeteer `1435c77` (the mixed-interface sweep of
23 interfaces, `AgentEnvironmentRequest` and kimi's prompt options widened, the wrong
comments gone, runtime.ts's spreads reverted, jsonrpc's siblings converted, James's two
one-word widenings taken — his HEAD typechecks again). Tests: 11 scripted + 3 real-binary
supervisor rows, 6 daemon-level rows; the whole fieldd suite 690 green; `pnpm verify` verbatim
green except `pnpm lint` on James's untracked `work/` (SNAP-0's note stands).

**Still owed:** `SIBLINGS_TOKEN` (James); pushing the two upstream pins (both on local
branches — `siblings:pin` now says so); PU-6 (puppeteer's clean-room install) before AR-2's
first import; the pre-existing imposter conformance red (James's); the Windows box round; the
dev-local snapshot of the two draft docs (James's ritual). The `rust-cache` `../rosetta ->
target` row stays unverified until the first green CI run.

*Pins moved again the same day (`b6bbaa25`): rosetta `3f7ac0f` (RO-2's start-time half —
`serve --enroll FILE`, many runtimes per kind, consent by construction, a ledger directory per
runtime with an identity stamp, wire additive at protocol 20) and puppeteer `719d98d` (PU-7 —
`ProfileService.observationRoot` on all nine adapters, Pi's managed binding one level in, RFC 006
addendum). Both were the prerequisites the ratified data topology (`thinking-ar-data-topology.md`,
AR-D15…D22) named before a persona can be ingested; VibeField consumes neither until AR-1.*

## AR-1 — the index doors and the enrollment record (2026-09-12)

**AR-1 the contracts and the record** (`c7fe5fda`; the pin moved to rosetta `af6f0d7` in the
same commit). The ratified topology's first slice in code. Contracts: the `index.*` rows
(`discoveries`/`status` on `index.read`; `enroll`/`retire` on the NEW local-only `index.manage`)
and the `agents.*` rows (`installs`/`releases`/`update`/`setActive` on the NEW local-only
`agents.manage`; `profiles.list/create/delete/verify` on `agent.spawn` — decided here: a persona is
what one spawns as, no third scope), every row `locality: "local"`, neither new scope in
`TAILNET_SCOPES` or the plugin eligibility table; the LAYOUT segments the topology names
(`index/enrollment.json`, `agents/`, `agents/profiles.json`, `agents/roots/`, and the never-re-root
`machine/`, `machine/agents/`, `machine/agents/distribution.json`, `machine/agents/updates/`) with
`LAYOUT_ROOT_LEVEL` as the never-re-root set AS DATA (the users migration's manifest reads it
instead of respelling four names); `agent-index.ts` — the enrollment record (rosetta's format 1
verbatim plus the VibeField-only `retired[]`/`updated_at`; `AbsoluteDataRoot` refuses what the daemon
refuses), the index projections (`IndexDiscovery`, `IndexStatus`, `IndexRuntimeStatus`, the
tolerant `IndexPhase`), and the `agents.*` shapes mirrored from puppeteer's own schemas
(`AgentPersona` without `dataRoot`, `AgentInstall`, `AgentRelease`, `AgentUpdateReceipt`,
`AgentDistributionRecord`); six fixtures, the enrollment one parsing rosetta's bench file
verbatim. fieldd: `EnrollmentStore` — loaded at boot, published atomically (0600, temp + rename)
BEFORE every rosettad spawn and after every change, validating what the daemon validates (an
absolute existing directory, no duplicate or nested root), retiring a vanished root at publish
instead of handing it over, setting an unreadable record aside for a human; `IndexService` — the
four doors, every answer a projection (the origin is read from `RosettadState` inside `get()` and
nowhere else; an enrolled root's path never leaves fieldd — `profileId` names the persona), reads
UNAVAILABLE `{service:"index", state}` while the daemon is not ready, mutations audited
(`index.enroll`, `index.retire`) and bouncing the daemon through `requestRestart` only when the
record changed; `enrollRuntime` is AR-2's persona path (`observationRoot(profile)`, never
`dataRoot`). The supervisor gained `--enroll` and passes `--home` as the OS home explicitly
(topology R7). Tests: 9 scripted rows (the record before the first launch; the projections through
a window token holding `index.read`; enroll rewrites + audits + bounces and the same set again
changes nothing; retire of a discovered kind and of an enrolled root — rows stay, the persona
stays named; the store's refusals; the down-daemon UNAVAILABLE; the unreadable record; the
no-daemon record) and 3 rows against the REAL rosettad with an EMPTY home (the roll call
uninstalled and unconsented; an enrolled empty root live from the first start, labelled,
retired with its rows public; revocation seeded with rosetta's ground-truth claude-code fixture).
The fieldd suite 699 green (the 6 real-binary rows opt-in, all green at the moved pin); contracts 378; users 37; the Rust layout vector pinned.

**Found on the way, fixed upstream — RO-2c (rosetta `af6f0d7`).** rosetta's `serve` computed
consent as a UNION (the projection's persisted `enabled` flags ∪ the manifest ∪ the CLI ∪ the
file's `enabled_kinds` ∪ the enrolled ids), so a kind the record no longer named stayed
consented from its persisted flag: the file could ADD consent but never REVOKE it, and AR-D17's
"rosetta's `enabled` is a cache re-applied on every ready" was only half true. Now, with a file
present, the file is authoritative for discovered kinds, the projection's flags are re-derived at
start (an omitted kind reads `enabled: false` in the census and the runtimes, rows public), and
un-consenting mid-backfill never traps the daemon. The revocation row above is the VibeField-level
witness. Gate: `pnpm verify` verbatim green except `pnpm lint` on James's untracked `work/`
(SNAP-0's note stands); the remaining steps run individually after it.

**Still owed:** AR-2 (the first puppeteer import — PU-6's clean-room install gates CI — the
injected profile store and roots, the `agents.*` handlers, the persona path); the consent UI
(design-03 §4.3, AR-3/4) — today the doors are reachable from the shell and any window token
minted with `index.read`/`index.manage`, and no window asks for them yet; `SIBLINGS_TOKEN`; the
three upstream pins are still on UNPUSHED local branches; the dev-local snapshot of the draft docs
(James's ritual); RO-8 (retire/forget upstream) before a purge can exist.

## AR-2 — puppeteer in fieldd: the runtime, the persona path, the machine scope (2026-09-12)

**AR-2 the first import** (`f9f04763`). One agent runtime per fieldd, built from puppeteer's
built-in providers with everything puppeteer would otherwise keep under `~/.puppeteer` injected
from THIS user's root (PU-8: fieldd owns every byte, puppeteer every schema) — the profile
registry at `LAYOUT.AGENT_PROFILES_FILE` (fieldd's store: 0600, temp + durable rename, an
unreadable file set aside for a human and the registry started empty rather than overwritten),
managed roots under `LAYOUT.AGENT_ROOTS_DIR` (puppeteer allocates `<provider>/<uuid>` 0700),
update transcripts under `LAYOUT.MACHINE_UPDATES_DIR`. `packages/fieldd/src/agent-runtime.ts`
is the service; the daemon constructs it beside the index service (no disk is touched until a
persona door is called — puppeteer's registry is lazy) and disposes it before the index daemon
on every stop path. The eight `agents.*` doors are live: `profiles.list/create/delete/verify` on
`agent.spawn`, `installs/releases/update/setActive` on the local-only `agents.manage`; every
mutation audited (`agents.profiles.create` names the minted id in its outcome, like
`terminal.session.create`). Contracts gained the doors' params and results (`AgentProfileFailure`
is data: an adapter's honest failure to read an identity rides beside the persona) and four
fixtures. `@vibefield/users` gained `rootAboveUserRoot`, the inverse of `userRootFor`: bin.ts
derives the VibeField ROOT — the machine scope — from the user root the supervisor hands it, and a
root of any other shape has no machine scope (the two writing doors then refuse
`UNAVAILABLE {service:"agents", state:"no-machine-scope"}`, installs and releases still answer).

**The persona path as built** (topology §4, AR-D18/D19). Create: puppeteer allocates the
immutable root and registers the profile; fieldd then enrolls the OBSERVATION root — PU-7's
`observationRoot(profile)`, never `dataRoot` (claude's is the profile root; pi's is the profile
root with the agent dir bound one level inside, created if absent) — in the enrollment record
under the KIND rosetta's roll call joins it to, and the daemon bounces. **The kind join is data
at the seam, not a table:** puppeteer names the provider's native layout root (the native-default
profile's observation root), fieldd folds it to rosetta's `~/…` spelling, and the census
(`/api/discoveries`, cached per daemon generation) names the kind for that spelling; neither
sibling's registry is enumerated in VibeField. A provider whose layout root is not on the roll
call (pi, on the scripted daemon) is created and not indexed — `runtimeId` absent, a logged
reason — and **every daemon ready re-applies the record to the personas (R4 as built):** a
persona registered while the index was down, or before this fieldd existed, is enrolled at the
next ready, one publish and one bounce, and the ready after that finds nothing to do. Delete =
unregister → retire (`retired[]`, rows kept, the label and profile id still named) → delete the
root with its credentials; the registry goes FIRST because the retire's bounce wakes the
reconcile, which must find no persona to re-enroll (the first draft lost exactly that race and
recreated the root it was deleting; a reconcile also skips a persona mid-deletion). Verify
persists what the provider's own status surface said; a native-default persona is never deleted
through this door (its kind retires through `index.retire`).

**The machine scope as built** (AR-D15/D16/D22, R2/R6). `machine/agents/distribution.json` is
read tolerantly by anyone and rewritten by one writer at a time under the users root lock —
held for the read-modify-write only, never across the vendor's updater (minutes; the lock is
every fieldd's on this device and its deadline is short by law) — then published atomically
(0600, the machine directory 0700). `agents.installs` is a FRESH inspection (the vendor's version
command runs per candidate) with the record's active choice folded over puppeteer's own;
`agents.setActive` validates the executable against the provider's installs, records it, and
the choice reaches spawns from the next boot (the runtime binds `executables` at construction,
composed through `createBuiltinProviders` + `createAgentRuntime` because
`createBuiltinAgentRuntime` does not thread that option — stated at the door's contract; AR-3
may move it to per-spawn); `agents.update` runs the vendor's own updater (an opaque 0600
transcript under the machine scope) and records the full receipt, projecting the contract's
fields; `agents.releases` asks the agent's own oracle always and the declared network detectors
only when the call or the provider's recorded preference says so. **The runtime's terminal host
refuses, typed:** agent PTYs are born by `agent.spawn` over the native floor with a clean
allow-listed environment and the persona login pane rides the same path (AR-3) — never a
shell-door spawn with an inherited environment (EL7).

**CI.** fieldd importing puppeteer means puppeteer's own dependencies (zod 4, the ACP SDK,
node-pty for the adapters) must exist under `../puppeteer/node_modules`. `verify.yml` now runs a
FILTERED frozen install of exactly the packages fieldd's graph reaches
(`--filter "@vibecook/puppeteer-builtin-providers..."` + record + monitor); the godview app —
the only consumer of puppeteer's temporary ghosttea `link:../electron-ghostty` overrides — is
never selected, so a clean room needs no electron-ghostty. Witnessed 2026-09-12 in a fresh clone
at the pin with no sibling beside it: 19 of 24 projects, exit 0. PU-6 upstream is a nicety now,
not a gate; `SIBLINGS_TOKEN` still is.

**Witnesses.** `packages/fieldd/test/agent-runtime.test.ts`: 10 rows against the scripted
rosettad and a scripted `claude` on a PRIVATE search path (`test/fixtures/fake-claude` — the
claude adapter classifies it from its version banner; its `update` is the vendor's own updater as
the recipe invokes it) — the native-default personas listed without a path and behind
`agent.spawn`; create (root 0700, registry 0600, the record's runtime under `claude-code`, the
daemon bounced, the `runtimeId` on the persona, the audit naming the minted id); a provider off
the roll call created but not indexed, verify's honest `unsupported`, the typed refusals; delete
(retired, unregistered, the root gone, the record naming the label); a registry planted BEFORE
boot enrolled at the first ready and untouched by the next; installs behind `agents.manage`;
setActive (the record 0600 under the root, `machine/` never under a user, idempotent, NOT_FOUND
for an unknown executable); the no-machine-scope refusals; update (the transcript 0600, the
receipt recorded, `transcriptPath` never projected); releases (silent without network; the
vendor's stable line a release and unreachable detectors honest failures with it; an unknown
provider an `unsupported` row). And 1 row against the REAL rosettad with an EMPTY home: a claude
and a pi persona enrolled under `claude-code`/`pi` — pi at the profile root, its agent dir inside
(PU-7) — live and watched with no path projected, then deleted: retired with their names kept,
nothing watched. Found on the way: the real daemon's runtime rows trail its ready line by a
moment, so a persona's `runtimeId` can be absent in the create answer and present on the next
list; the contract says so. Puppeteer's 383 source files now sit in fieldd's typecheck program
and its esbuild bundle (`bin.cjs` 4.1 MB). Gate: `pnpm verify` verbatim (the real rosettad opted in) — preflight (dirty-sibling warnings only), check:deps, icons and the 25 typechecks green; stops at `pnpm lint` on James's untracked work/composer-directions.html (all 4 errors there — SNAP-0's standing note). The steps after it, individually: `cargo fmt --check`, `pnpm lint:rust`, `pnpm test:rust` (21 test binaries), `pnpm bundle:assert` (the shell bundle unchanged; fieldd's own bin.cjs is 4.1 MB now), `pnpm gen:check` green; `pnpm test`: 24 projects green, fieldd red on two plugin-service-host timing files (service-drain-deadline, service-lease-fence) that pass alone and passed in the full fieldd run minutes earlier — host-load lotteries, not the diff; fieldd 719 rows green in all (715 + the 4 real-binary rows, 3 skipped).

**Still owed:** AR-3 (`agent.spawn`, the AgentHost over field-native, the persona login pane,
the fold, the mock module's deletion — the P0 exit witness); the Agents settings section (no
window asks for `agents.manage`/`agent.spawn` yet); the hermes adapter's gateway host resolves a
python script beside its module by `import.meta.url`, which the cjs bundle defines away — a
staged asset for the spawn slice; `SIBLINGS_TOKEN`; the three upstream pins still on UNPUSHED
local branches; the dev-local snapshot of the draft docs (James's ritual); James's `work/` lint
red; RO-8 before a purge can exist.


## AR-3 — agent.spawn: the host over the floor, the fold, the persisted continuation, the mock deleted (2026-09-12)

**AR-3 the runtime is lent the floor** (`6b5e1612`). puppeteer's `AgentHost` — spawn a terminal,
write one semantic input to it — is `packages/fieldd/src/agent-host.ts` over
`TerminalService.spawn`, a new birth beside `create`: the floor's AGENT cell (TC-S3's
placement), `programKind: application`, keep-until-exit (NF-D3), the agent class's scrollback
cap, and a CLEAN environment (EL7). The environment is composed in three layers and stripped
last: VibeField's passthrough from the daemon's own env (PATH, SHELL, LANG/LC_*, TZ, TMPDIR,
TERMINFO, SSH_AUTH_SOCK, the XDG roots the native-default layout is discovered under; win32's
essentials, case-folded), puppeteer's own `buildAgentEnvironment` policy over it (TERM, colour,
the login identity a native credential store keys on — and the one vendor variable it sets is
puppeteer's, never spelled here: AR-L1 holds), the adapter's `spec.env` over both, then every
`FIELD_*`/`FIELDD_*` key removed whoever asked for it. `automateTerminal` is the floor's epoch
path (`TerminalService.automate` → paste-and-submit / paste / text / interrupt; a human-input
conflict is `accepted: false` with the floor's reason). The host is late-bound: the runtime holds
it from construction, the daemon binds the terminal service once it exists, and every spawn
before that refuses `UNAVAILABLE {service:"agents", state:"no-terminal-host"}`.

**The fold** (AR-D4/D5 as ruled). `AgentRuntimeService` subscribes to `runtime.onMonitorState`
/ `onMonitorRemoved` / `onMonitorNotification`, reads each state through the contract's
`AgentMonitorMirror` — the fields fieldd's logic needs, everything else carried verbatim; a shape
drift logs once and the row reads `unknown` — joins it to the floor's inventory row for the cell
tag, and projects ONE `AgentSessionSummary` per run (SessionSummary v2,
`packages/contracts/src/agent-session.ts`: the native session id as the spine with puppeteer's
own basis, the OPEN provider id and the adapter's label, `tier: managed`, the run identity, the
terminal join, the workspace, the mirror, the one derived `status`, the observation level, the
record's presence). `agent.list` answers it; `agent.subscribe` streams FULL frames, at most one
per 16 ms tick per subscriber (the runtime's own coalescing set to the same tick — PF5). The
golden is puppeteer's OWN monitor contract fixture, transcribed
(`fixtures/agent-monitor-state.valid.json`), with `AGENT_MONITOR_SCHEMA_VERSION` pinned at 2: a
generation bump upstream is a red gate here **(errata 2026-09-13, found by AR-4b's review: it was
NOT one when this was written and was not one until AR-4b — nothing in the tree read puppeteer's
constant, so a bump drifted silently and surfaced, if at all, as the runtime's
`fieldd.agents.monitor_shape_drift` warn. `packages/fieldd/test/agent-monitor-pin.test.ts`
(AR-4b, `8c0725a5`) asserts the contract's generation IS the PINNED puppeteer's and that the golden
is of that generation, which makes the sentence true from that commit. Its limit, stated: a field
RENAME without a generation bump is still only the runtime warn — the mirror is a passthrough by
law, and nothing can gate a shape the upstream constant does not move)**.

**The doors.** `agent.providers` (what one can spawn as: every composed provider, whether an
install resolved, whether its adapter resumes, its personas) · `agent.spawn` (provider, cwd,
persona, title → `runtime.spawn`; the answer is the fold's row at birth AND the same routed
create ticket `terminal.create` answers, so the pane that asked mounts the PTY with no second
round trip — GT-1's point kept) · `agent.resume` (an EXITED session continued from its record: a
new run, a new PTY, the vendor's own conversation; a live terminal is refused
`PRECONDITION_FAILED {state:"terminal-alive"}` — re-attach is AR-4's) · `agents.profiles.login`
(the persona login pane: `startProfileLogin` → the vendor's own interactive login in a PTY bound
to the persona's root; when the pane ends — or after ten minutes — the identity is re-read from
the provider's status surface and recorded on the persona). Births on `agent.spawn`, the fold on
`agent.observe`, all local in v1 (the remote tier's rows reach the deck through the mesh's own
roster); spawn and resume audited like a terminal birth (attempt-before-effect, the run id and
the terminal id on the outcome), the login like a persona mutation. The window token gained
`agent.spawn`/`agent.observe`/`agent.control` (the last minted now for AR-6, unused).

**The record** (`LAYOUT.AGENT_SESSIONS_DIR` = `users/<fuid>/agents/sessions/<runtimeRunId>.json`,
0600, the directory 0700, durable rename, an unreadable file set aside): puppeteer's opaque
continuation beside the launch facts fieldd chose (provider, persona, cwd, title, the floor
session id, the workspace), re-persisted when the adapter learns the native id, stamped at exit
with the floor's outcome and code. Exits: the floor's `session-exited` on the cell's control
connection (the terminal service now fans it out from every client it holds) →
`runtime.handleProcessExit` → the record stamped, the row withdrawn; the inventory diff is the
backstop, with a 1.5 s grace so the floor's own outcome wins — the first real-claude witness
lost its exit facts to the backstop (`reason: unknown`), and the grace is the fix. A persona's
delete now stops its sessions first (the floor's ladder) and removes its records.

**The renderer.** The monitor's mock module is DELETED (`mock-agent-field.ts`, its test, its
label, its `AgentKind` union — the last vendor enumeration in the renderer; the icon map keeps
the glyphs it knows and draws an initial for the rest, RFC 004's "isolated optional artwork
map"). The local half of the field is fieldd's fold through the deck's door: `MonitorDoor`
(GT-D17's two verbs widened, deliberately, to six — observe · providers · spawn · mountLocal
beside listHosts · attach), built where the fieldd client, the runtime and the workspace already
are; the stage still holds none of them. `facet-types.ts` became type imports of the contract;
the projection reads `AgentSessionSummary` (status from fieldd's one derived word, detail from
the blockers or the latest assistant line, model and context window from the mirror); the deck
publishes its panes' floor summaries so an unclaimed pane is a terminal row and a managed row
carries its PTY's summary; a managed row's id is its floor session id, so the pane join and the
placement survive the promotion, and its accent is by RUN, so it survives the pane **(errata
2026-09-13 — the id half is REVERSED at AR-4b `8c0725a5`: a managed row's id is its RUN
(`managedRowId` = `runtimeRunId`) and the pane join is the summary's own `agent.session?.id`. The
ruling here made the row's identity the thing AR-4 taught to change: a resume-when-idle's PTY swap
or an exit destroyed the row and took the swarm's bubble and the preview highlight with it. The
accent-by-run half stands, and is now what the whole row does)**. The chrome's
chip counts managed agents and is absent at zero (quiet is the honesty); the fold's
unavailability is said in fieldd's words; the header gained a provider select and SPAWN. Select
MOUNTS a local row's PTY in the active pane (`terminal.sessions` → the workspace's own
`mountSession`); create SPAWNS the chosen provider into it (`agent.spawn` → the pool adopts the
create ticket exactly as its own births — `adoptCreatedTerminal` — and the workspace mounts the
summary). The marker's `mockLabel`/`mockAgents` became `localClaim`/`localAgents`/`terminals`/
`localState`; the desktop smoke asserts the fold is `live`, the chip matches the count, the
stage never says "mock", and a local row's select answers through the door's local verb.

**Witnessed.** Over the mock mgmt server: the providers door, the scope gates, a spawn with no
floor refusing in the floor's own words with the audit saying failed and nothing recorded. Over
the REAL field-native, with a SCRIPTED provider (an adapter that owns nothing but a recipe and
asks the host for `/bin/sh -c 'env > "$SCRIPTED_ENV_OUT"; exec /bin/cat'` — **errata 2026-09-13:
the recipe quoted here is AR-3's; AR-4b's is `env > "$SCRIPTED_ENV_OUT.part" && mv "$SCRIPTED_ENV_OUT.part" "$SCRIPTED_ENV_OUT"; exec /bin/cat >>
"$SCRIPTED_TYPED_OUT"`, because the automation witness now reads the typed bytes back out of
`cat`'s own stdout rather than trusting the floor's `accepted`**): the PTY on the agent
cell; the environment read from INSIDE it — the adapter's token present, `TERM`/`HOME`/`PATH`/
`USER` present, the adapter's own `FIELDD_SMUGGLED` absent, not one `FIELD_*`/`FIELDD_*` key,
none of the daemon's; the row with its cell tag; the record 0600 under a 0700 directory; the
routed ticket with its grants; `agent.subscribe`'s snapshot and its withdrawal frame; automation
through the host accepted by the floor's epoch path; the audit; the exit withdrawing the row and
stamping the record; the resume as a new run with `resume` reaching the adapter; the live-run
refusal. The persona login pane with the scripted `claude`: the pane, its ticket, the identity
(`loggedIn`, method, email, organization, plan) on the persona after it ended. And the REAL
Claude Code 2.1.270 (`FIELDD_TEST_REAL_AGENT=1`): spawned into a PTY on the agent cell with the
clean environment, `alive` with the native session id within seconds, `native-hooks` and `idle`
after five, the record carrying the vendor's id, terminated cleanly — **the P0 witness at the
daemon level: a real agent in a PTY on the floor with live status.** (In the deck: James's eye;
the renderer half is witnessed by the mounted stage fixtures and the desktop smoke's rows.)

**Found.** (1) `terminal.terminate` right after a birth answers `terminated: false` — the
observed inventory still lags the spawn, so the session's cell is unknown and the ladder reads
"already gone" — the GT-1 asymmetry on the terminate side; the witness holds five seconds first;
TC's to fix, not AR's. (2) puppeteer's profile services resolve their executable from
`PUPPETEER_<KIND>_BIN`/PATH at construction, not from the `executables` the launch path takes,
so the machine record's active choice does not reach the login pane or `verify` (PU-10, a
note). (3) The first draft inferred `sessionIdBasis: "observed"` from the mirror carrying a
native id; puppeteer's own `nativeSession.basis` is the fact and is what rides now. (4)
`behavior-conformance.test.ts` (plugin-playground) failed once in the full run at 5.9 s and
passed alone — a loaded-host lottery, nothing of AR's touches it.

**Gate:** `pnpm verify` verbatim still stops at `pnpm lint` on James's untracked
`work/composer-directions.html` (the only lint findings; pre-existing); every other step run
individually: preflight, `pnpm typecheck` (25 projects, after the fieldd test's type imports),
biome clean over the batch **(errata 2026-09-12, found at AR-4's gate: the batch did not include
the four fixture JSONs `agent-list`/`agent-monitor-state`/`agent-spawn`/
`agents-profiles-login.valid.json`, which `biome check .` wanted reflowed — main's lint was red
from `6b5e1612` until AR-4 formatted them)**, `cargo fmt --check`, clippy `-D warnings`, `pnpm test` (the
lifetime fixture re-fed to the door — the two reds were the mock's absence; the conformance
lottery above), `pnpm test:rust` (the layout vector with the new segment), `pnpm bundle:assert`,
`pnpm gen:check` with the generated `layout.json`/`registries.rs` staged, `pnpm smoke:godview`
exit 0 (the stage settled `live` with the deck's own pane as its one row, no chip at zero
managed agents, the local-routing row answered "terminal is in the active pane"; the first run
read the stage's FIRST frame — empty by construction now that the field arrives through the
door — and the row waits for the field to settle since). **Still owed:** AR-4 (re-attach across a fieldd restart: the records are written
for it; resume-when-idle); the ingested tier's rows in the fold (AR-8, with the History view); the
Agents settings section (`agents.manage` on a window; the persona login pane has no UI yet — the
door is live); `agent.control` (AR-6); `terminal.terminate`'s birth race (TC); PU-10 upstream;
the dev-local snapshot of the draft docs (James's ritual); the DESIGN.md Godview citation
(James's live edit); the upstream pins still unpushed; `SIBLINGS_TOKEN`.

## AR-4 — stable ingress: a managed session outlives fieldd — re-attach at the next epoch, resume-when-idle the fallback (2026-09-12)

**AR-4 the run survives the daemon** (`ba1a1eab`; AR-D6 as ruled, PU-1 upstream landed the same
day — puppeteer `d013fef`, pinned). Every birth now names a creation request — puppeteer's
durable claim, in fieldd's custody under `LAYOUT.AGENT_RUNS_DIR` = `users/<fuid>/agents/runs/`
(claims + the installation key, puppeteer's own schema and modes: PU-8 again) — and gives the
adapter a say over the session's loopback ingress (`ingress.onBound`): the bound `{port, token}`
the adapter reports BEFORE the process launches rides in the session record (0600) beside the
claim id, and the record keeps `runtimeEpoch` current. A graceful stop RELEASES the runs rather
than closing them — `runtime.dispose({detach: true})`: no exit dispatched, no record stamped, the
claims kept, the adapter's listeners closed — because the PTYs are the floor's and outlive fieldd
(EL1). The next boot's FIRST inventory is the re-attach: every un-exited record whose PTY the
floor still lists goes through `runtime.attach` (`expectedRuntimeEpoch` = the record's; the
provider's own `attachSession` — for claude the bridge re-bound to the pinned port and token, the
transcript located; `restoreSession` at the next epoch) and re-enters the fold — the same run id,
epoch + 1, the same PTY, the row saying `continuation.reattached`, the record `reattach:
{state: attached}`. The daemon feeds the agents service the inventory `ensureStarted` already
applied (the listener is wired after it), so a boot onto a quiet floor re-attaches now and not at
the floor's next change.

**Pending, and resume-when-idle.** A provider that cannot attach (`ATTACH_UNSUPPORTED`), an
attach that fails, or a record from before AR-4 (no claim to restore against) leaves the run in
the fold as a PENDING row: `tier: managed`, `status: unknown`, `observationLevel: none`,
`sessionIdBasis: recorded`, the terminal local and alive, `continuation: {persisted, resumable,
pending: "resume-when-idle", reason}` — a live PTY nothing observes, said plainly. Resume-when-
idle polls the index every 5 s through a new `IndexService.sessionByNativeId` (rosetta's
`/api/sessions?native_session_id=`; the canonical row preferred) and replaces the run only on
EVIDENCE: rosetta knows the session and its `activity.last_at` is 30 s or more in the past. No
evidence is not idle — a session the index has never read (an unenrolled root, a provider it does
not index) stays pending until a person resumes it, and an index that is down answers nothing.
The replacement: the old PTY terminated and gone from the inventory before the new run is born
(two processes on one native session is the one thing a resume must never make), the old record
stamped (`exited: {reason: "replaced"}`, `reattach: {state: "resumed", replaced}`), the
continuation resumed into a new run whose row names the PTY it replaced (`terminal.replaced`;
the new record's `replaced`). `agent.resume` on a pending run is the same replacement by hand
(`how: manual`); a live ATTACHED run still refuses `PRECONDITION_FAILED {state: "terminal-alive"}`.
A record whose PTY did NOT survive (the floor restarted too, or the process ended while no fieldd
was there) is stamped as an unknown exit at the boot and resumes from the door like any other.
The daemon's own acts are in the ledger as the SYSTEM actor (`AuditService.requiredSystem`):
`agent.session.reattach` (outcome succeeded with the new epoch, or failed with
`ATTACH_UNSUPPORTED`/`ATTACH_FAILED` and the words) and `agent.session.resume` (`how: idle`).
A persona's delete stops its pending sessions too. The fold's exit paths cover the pending rows
(the floor's `session-exited`, the inventory backstop with the same grace).

**The renderer.** A pending row reads `idle` with the detail "unobserved · resumes when idle"
(no evidence says otherwise; "working" would be a claim the fold did not make); a re-attached
row is an ordinary row. A row that names a replaced PTY the deck is showing hands that pane the
new one through the door, once per replacement — `MonitorDoor.mountLocal(id, {replacing})`, the
deck activating the pane that held the old PTY, waiting for the workspace to commit the
activation (the active pane is a ref the workspace syncs after render), mounting, and giving the
user's own pane back — so a resume-when-idle never leaves a pane on a dead PTY. The one
widening of the door is the option, not a verb.

**Contracts.** `AgentSessionRecord` += `creationRequestId`, `ingress {port, token}`, `reattach
{state: attached|failed|unsupported|resumed, at, reason?, replaced?}`, `replaced`;
`AgentSessionSummary.continuation` += `reattached`, `pending`, `reason`; `AgentSessionTerminal`
+= `replaced`; `LAYOUT.AGENT_RUNS_DIR ["agents","runs"]` (gen'd into `registries.rs` and the
layout vector). A record written before AR-4 still parses. Upstream (PU-1, `d013fef`):
`HostIngress {port?, token?, onBound?}`/`BoundIngress` on the host seam, `ingress` on
create/resume/attach, `AgentProvider.attachSession`, `AgentRuntime.attach` (provider attach →
workspace → `restoreSession`; `ATTACH_UNSUPPORTED`/`ATTACH_FAILED`), `dispose({detach})`, the
claude driver's `attachClaudeTuiSession` (the bridge pinned, the transcript armed lazily at the
first subscriber, an existing transcript a silent baseline), RFC 003 "Stable ingress".

**Witnessed** (`packages/fieldd/test/agent-session.test.ts`, the REAL field-native, two fieldd
boots on one root with the floor running throughout). The scripted adapter WITH
`attachSession`: the claim registry 0700 with its `claims/`; a stop that stamps nothing; the
second boot's row re-attached at epoch 2 on the same PTY with the same native id and title, the
adapter handed exactly that terminal and session, the record at epoch 2 with `reattach:
attached`, the ledger's system-actor entry, automation through the re-attached run confirmed by
the floor, the attached run refusing a resume, the ordinary exit after. WITHOUT it: the pending
row as stated (`reattach: unsupported`, the audit's `ATTACH_UNSUPPORTED`), the PTY listed and
unobserved; `agent.resume` replacing it — the old PTY gone before the new run was born, the
adapter's `resume` = the native id, both records as stated, the fold holding the new run only,
`how: manual` in the ledger **(errata 2026-09-13: it was in the ledger TWICE when this was
written — the door's own caller-actor `agent.session.resume` entry and, under it, the daemon's
system-actor entry with `how: manual`, one human act attributed to two actors. At AR-4b `8c0725a5`
a manual resume is ledgered ONCE, at the caller's entry, whose outcome attrs carry `how: "manual"`
and the PTY it `replaced`; the system actor now ledgers only what the daemon itself began,
`how: "idle"`)**. Resume-when-idle against the fake rosettad's new
`/api/sessions?native_session_id=` route (rows from a JSON file re-read per request): pending
while the index served no row, pending while the row's activity was a second old, replaced by the
daemon itself once the row said a minute still (`how: idle`, the system actor). A record whose
PTY is gone: stamped `unknown` at the boot, no attach attempted, resumed from the door. And the
REAL Claude Code 2.1.270 (`FIELDD_TEST_REAL_AGENT=1`): the record carrying the bound ingress and
the claim; re-attached across the restart at epoch 2 on the pinned port; a prompt through the
re-attached run reaching the vendor's hooks at the re-bound bridge (`native-hooks`, the id
`observed`); terminated cleanly (`application-terminated`, 143). The renderer's rows: the
pending reading, the re-attached row, the resumed row's id, and the mounted stage handing a pane
the new PTY through the door exactly once.

**Found.** (1) A fieldd stop issued within about a second of the real claude's first observed
hook LOSES the process — 4 of 4 attempts without a hold (the second boot found the PTY gone and
stamped the record); with a 3 s hold the PTY survives every time (3 of 3). The driver's detaching
dispose while the TUI is still starting — the bridge closed, the staged `--settings` file and
hook forwarder removed (`cleanupClaudeSession`) — is the suspect; NOT isolated (PU-11, a note:
worth a probe upstream before it becomes a rule here). **(errata 2026-09-13: the suspect was the
cause, and it is fixed. AR-4b's upstream reviewer PROBED the detach on the real runtime — the
staged settings file and the hook forwarders VANISH under the running TUI — and puppeteer
`8402184` makes the runtime's detach RELEASE its bindings instead: the claude binding drains its
bridge and KEEPS the process's files. The same deletion is why the hook rail exec'd a deleted
script after every re-attach, not only why a fast stop lost the process. The 3 s hold is retired —
AR-4b's witness stops one second after a POLL sees `native-hooks`, and the process survives.)**
(2) The observed inventory lists a
just-born PTY only after a beat, the terminate-side lag of AR-3 seen from the list side: the
witnesses poll the listing rather than read it once. (3) A daemon act's audit outcome needs a
CODE for `reasonCode` (`[A-Z][A-Z0-9_]*`) — the first draft put the state word there and the
ledger refused the outcome after the effect had run; one record's trouble no longer ends the
re-attach for the others.

**Gate** (run by a delegated Opus agent, verbatim): `pnpm verify` stops at `pnpm lint` — 4
errors, all in James's untracked `work/composer-directions.html` (45 pre-existing warnings
elsewhere; the FOUR AR-3 fixture JSONs biome wanted reflowed are formatted with this slice — see
the AR-3 errata) · preflight OK (2 dirty-sibling warnings) · check-single-copy ok · icons
current · `pnpm typecheck` 25 projects · `cargo fmt --check` clean · clippy `-D warnings` clean ·
`pnpm bundle:assert` OK (initial 530.2 KB raw / 143.0 KB gz) · `pnpm test`: 333 files passed,
1 failed — `service-drain-deadline.test.ts` (PRC-2's 80–175 ms window; ServiceHost, nothing of
AR's) red in the full graph and green alone, the loaded-host lottery · `pnpm test:rust` 241
passed, 6 ignored · `pnpm gen:check` clean · `pnpm smoke:godview` exit 0 first attempt
(`monitorLocalState: live`, the deck's own pane as its one row, canvas2d, cold open 286 ms) ·
the fieldd agent-session suite 11/11 with `FIELDD_TEST_REAL_AGENT=1`. Measured on the working
tree before the commit; `ba1a1eab` differs from it only by biome's reflow of five files (the four
fixtures and the fieldd test). **(Amended 2026-09-12:)** The runner's second pass found the one
biome warning in `useMonitorAgents.ts` (a suppression with no effect) was AR-3's, not older debt;
removed in the follow-up commit. **Still owed:** the
Agents settings section (the persona login pane's UI; `agents.manage` on a window); AR-5 the
views port; `agent.control` (AR-6); PU-11 above and PU-10; the ingested tier's rows (AR-8); the
dev-local snapshot of the draft docs (James's ritual); the DESIGN.md Godview citation (James's
live edit); the upstream pins still unpushed (puppeteer `d013fef`, rosetta `af6f0d7`);
`SIBLINGS_TOKEN`.

## AR-4b — the review's fixes: signed records, the agent cell, verdicts and fences, the locality column enforced, the release path upstream (2026-09-13)

**AR-4b is what six reviewers found** (`8c0725a5`; puppeteer `8402184` upstream, pinned). AR-3 and
AR-4 landed in one day and were read the next by six Opus agents at six lenses — the fieldd state
machine, EL7, the contracts and this ledger's own claims, the renderer, the tests, and the
upstream landing. Every blocker and major is fixed by hand here; the minors and the witnesses by
agents. Nothing about AR-4's SHAPE changed: the re-attach is still the resting state, resume-when-
idle still the fallback on rosetta's evidence. What changed is what that shape TRUSTS, and what it
does when a step does not answer.

**The security seam (EL7): a record fieldd did not write is not a record.** Every session record
fieldd writes now carries a `signature` — HMAC-SHA256 over its canonical JSON (keys sorted at
every level), keyed by a 32-byte secret minted once per user root at
`LAYOUT.AGENT_SESSIONS_KEY_FILE` (`users/<fuid>/agents/sessions.key`, 0600, created with `wx` so a
loser of the race never inherits the winner's key). A record with NO signature, with one that does
not verify, or exposed to other users by its own mode is SET ASIDE at read with its own log event
(`session_record_unsigned` / `_forged` / `_exposed`) and never acted on; temp files are private
(`wx` + a random suffix) and owner-only modes are re-asserted after every write
(`SessionRecordStore`, `packages/fieldd/src/agent-sessions.ts`). Why this is a MAJOR and not
hygiene: same-uid agents are the adversary, and before it a file dropped into `agents/sessions/`
was a boot-time instruction — it could make fieldd TERMINATE any live PTY (through the pending
path's replacement) and launch the vendor with an attacker-chosen cwd and persona. The other half
of the same seam is the cell: the re-attach acts only on PTYs whose inventory row sits on the
AGENT cell (`cell.workloadClass === "agent"`); a record naming any other terminal is refused and
logged (`reattach_refused_cell`), never held, and the replacement re-checks the cell before it
terminates anything.

**The state machine: verdicts, not hopes.** The durable CLAIM is the authority on the epoch — before
attaching, fieldd reads it (`CreationRequestRegistry.lookup`, new upstream) and attaches at the
claim's epoch (`epoch_resynced`), because upstream's `restoreSession` increments the epoch FIRST
and can still fail after: a host that kept the record's epoch was refused on every boot after one
such failure. A missing or terminal claim is held pending with that reason. The fold is updated
INSIDE the audited act (`attachRecord`), so a ledger write that fails after the effect leaves
nothing orphaned — before, a successful attach whose audit outcome was refused left a run live in
puppeteer and invisible to fieldd. A record whose PTY the FIRST inventory lacks is held for the
exit grace (`EXIT_GRACE_MS` 1.5 s, `awaitingBoot`) and attached if the PTY appears; only then is
it stamped `unknown` — one frame is not a death, which is AR-3's own grace applied at the boot
edge. The replacement's wait for the old PTY is now a VERDICT: `awaitGone` returns false at the
5 s grace, a PTY that outlives it REFUSES the replacement (`PRECONDITION_FAILED
{state: "terminal-alive"}`), the run stays pending and the poll re-arms — never two processes on
one native session, which is the one thing a resume must never make; `terminal.terminate`
answering `terminated: false` is read as already gone (AR-3's finding, from the other side). Every
throw before the point of no return restores the pending entry (`resuming` reset, the poll
re-armed) — before, one throw, the audit's own attempt append among them, wedged that row forever.
A record already resumed into another run refuses a second resume (`PRECONDITION_FAILED
{state: "replaced", replacedBy}`) and the old record now names both sides (`reattach {state:
"resumed", replaced: <old PTY>, replacedBy: <new runtimeRunId>}`); a replacement whose resume
FAILS stamps `exited.reason: "replace-failed"`, not `"replaced"` — a stamp that said a successor
exists when none did. `dispose` fences replacements in flight (it waits up to
`DISPOSE_REPLACEMENT_WAIT_MS`, 10 s) and a replacement refuses to start once the service is
stopping; an `enter`/`hold` after a stop writes the record for the next boot but touches neither
map. A persona's delete also terminates the live terminals its RECORDS name — a run mid-attach is
in neither map — and the re-attach skips records of a persona mid-deletion. The idle poll BACKS
OFF while the index cannot answer (×2 per unanswered poll, ceiling `RESUME_POLL_MAX_MS` 60 s), and
a `last_at` that is not a finite time in the past is no evidence at all. A manual resume is
ledgered ONCE, at the door's own caller-actor `agent.session.resume` entry whose outcome attrs
carry `how: "manual"` and the PTY it `replaced` (`daemon.ts`); the SYSTEM actor now ledgers only
what the daemon itself began (`how: "idle"`) — see AR-4's errata above.

**The contracts.** `IndexService.sessionByNativeId` PARSES rosetta's body instead of casting it:
`IndexSessionsResponse` / `IndexSessionRow` / `IndexSessionActivity`
(`packages/contracts/src/agent-index.ts`) are passthrough at every level with finite stamps and
`activity` null when absent, unknown envelope fields log once at debug — the tolerant reader's
SECOND half, which this seam had skipped — a body it cannot vouch for answers `UNAVAILABLE
{state: "malformed"}`, and nonsense bounds (`first_at > last_at`) fold to null. And D36's
`locality` column is ENFORCED at last (`product-api.ts`): a method declared `local` is refused for
a peer-fieldd principal (`FORBIDDEN_SCOPE`, naming the locality) and never forwarded to a foreign
`device` (`PRECONDITION_FAILED`); `device` = self still serves locally. The column had no consumer
from the day it was declared, so every method declared local federated in fact, and AR-3/AR-4
declared the `agent.*` doors — a spawn, a resume that terminates a PTY — local into that gap. The
gap is pre-existing; AR-4b closes it for all 131 local rows. `methods.ts` gained a dated scope
exception on the `agent.resume` row: it rides `agent.spawn` although it now ends a live PTY,
accepted because the door's params name a RUN, fieldd resolves the PTY through the record it wrote
AND verified, and only agent-cell PTYs are ever re-adopted — with the named upgrade written down
for the day an agent cell adopts a PTY the record did not mint.

**The renderer.** The BLOCKER was the replacing mount: `mountLocal(id, {replacing})` fell through
to whichever pane the user was in when the pane holding the replaced PTY could not be activated
(it closed under the wait), which put a resumed stranger in front of the user and left the dead
terminal where it was. It REFUSES now, mounting nothing; mounts are serialized through one queue
so two replacements in a frame cannot race for the active-pane slot; the workspace context is
re-read AFTER the floor round trip; `mounted` is answered only when the layout actually shows the
session (a bounded `settled()` poll); and the user's previous pane is given back if it still
exists. The deck's pane-facts gate now keys on every fact the monitor DRAWS — per pane the id,
`exited`, the activity kind, the title and the cwd — an AR-3 defect: keyed on ids and the active
pane alone, the summaries AR-3 added never republished, so an exited pane stayed a live row and a
terminal's activity never moved. The remount effect records a replacement key only when the mount
LANDED and retries a failure on the next frame or pane change up to `REMOUNT_ATTEMPTS` (3),
announcing `no-pane`; the fold's damage gate keys on the drawn fields per row (`rowsKey`) rather
than `JSON.stringify` of the whole fold, which carried puppeteer's subagent/workflow/team
collections verbatim. A managed row's monitor id is now the RUN (`managedRowId` =
`runtimeRunId`) so a resume-when-idle's PTY swap and an exit no longer destroy the swarm's bubble
or the preview highlight, with the pane join kept as the floor session id — the reversal of AR-3's
ruling, recorded there too. The replaced PTY is no longer drawn as a phantom unclaimed terminal
row; a pending row whose mirror says not-alive is dropped (the alive drop precedes the pending
reading); the spawn controls wear DESIGN.md §8's muted disabled treatment (opacity 0.4) instead of
looking live; and `remote-session-field.ts`'s header no longer claims a mock module beside it.

**Upstream** (puppeteer `8402184`, PU-1b, pinned in `siblings.lock.json`). The runtime's detach
path RELEASES its bindings now — `AgentAdapterBinding.dispose({ release })` — and the claude
binding drains its bridge (in-flight posts complete, `HookBridge.dispose({ drain })`) and KEEPS
the staged settings file and the hook/status-line forwarders. That is PU-11's ROOT CAUSE, probed
on the real runtime by the review's upstream reader: a plain dispose deleted those files under the
running TUI, which is both why a stop within a second of the first hook lost the process and why
the hook rail exec'd a deleted script after every re-attach. With it: `CreationRequestRegistry
.lookup`; `attach` validates identity BEFORE it binds (a run already managed answers unbound; a
missing or terminal claim and a stale epoch are refused naming the claim's epoch — all before the
provider takes the port or a workspace is built); a bind that fails inside the restore no longer
marks the LIVE process's claim terminal (`RestoreAgentSessionOptions.attaching`); a workspace the
attach merely RESUMED is never destroyed; a `/clear` typed while no host listened is followed (the
first authenticated hook under a new id with a transcript under the same root rotates the attached
session, once); configured intent is not published for an attached process. RFC 003 carries its
"Amended 2026-09-13 (PU-1b…)" and puppeteer's CLAUDE.md names the host's ingress record as the one
exception to its bearer invariant.

**Witnessed.** The REAL Claude Code re-attached across a fieldd restart with the stop issued right
after its hooks arrived — a POLL for `native-hooks` plus one second, no blind 3 s hold — and its
hooks flowed again at the re-bound bridge; the re-attached session then FOLLOWED an in-process
`/clear` rotation, its native id changing under a row that kept its run. In the suites: the EL7
witness asserts the PTY's key SET is a subset of the allow-list (a deny-list would pass a leak)
with `VITEST` absent against a control that proves the harness has it; the scripted adapter reports
a bound ingress pair and the record and the attach carry it; "the old PTY is gone BEFORE the new
run is born" is a 5 ms poll against the new session's birth instant rather than an ordering
assumed; audit assertions are STRUCTURED (attempt + outcome joined by `operationId`); the
canonical-row preference is tested with a decoy subagent row placed FIRST in both directions;
`activity: null` and index-down windows are rows of their own; the poller's requests are counted
(`FAKE_ROSETTAD_REQUEST_LOG`); the teardown kills the native tree before removing the root; the
real-claude rows assert `native-hooks`, the PTY alive at the SECOND boot, and
`application-terminated`; and the automation witness reads the typed bytes back out of `cat`'s own
stdout (the recipe grew `>> "$SCRIPTED_TYPED_OUT"` — see AR-3's errata). Three coverage rows
answer the state machine's own edges: a PTY killed out of band withdraws the row and stamps the
record; the index down under a pending run stays pending, and a stop under the armed poll RELEASES
the PTY (a THIRD boot still lists it); and one record's trouble does not end the re-attach — a
record naming a vanished provider is held pending while the good one attaches. The monitor pin is
a test now (`packages/fieldd/test/agent-monitor-pin.test.ts`): the contract's
`AGENT_MONITOR_SCHEMA_VERSION` must equal the PINNED puppeteer's own constant and the golden must
be of that generation. In the renderer: the once-guard exercised by re-delivering frames through a
`push` handle; a run keeping its row id and its accent through the PTY swap; the phantom row; the
classifier order; the `act()` warnings gone; and a deck-level suite for the replacing mount
(`packages/field-app/test/godview-deck.test.tsx`, five rows against a workspace probe that
reproduces ghosttea's two properties — a mount lands in whatever pane is ACTIVE, and an activation
is observable only a turn later) covering the pane a replacement belongs in, the refusal when no
pane shows the replaced PTY, the refusal when that pane never takes focus, two replacements
serialized, and the plain mount.

**Found.** (1) The upstream probe turned PU-11 from a suspicion into a cause and a fix — recorded
at AR-4's finding, at the petition, and above. (2) `deletePersona` under a LIVE run is still
untested: the scripted provider has no profile service to delete a persona through, so the delete
ladder's newest rung (terminating the terminals a RECORD names) is code without a witness. Said
plainly rather than counted as covered. (3) PU-12, a note: `providerVersion` is not persisted on
the session record, so a re-attached session's OTLP usage rail reads as unverified — the version
the run was born under is not recoverable after a restart.

**Gate:**
**Gate** (a delegated Opus runner, verbatim, on the working tree before this commit — three
files of the lead's were then biome-formatted, two HEAD tests moved onto federating probes and
re-run green with the routing suite (28 tests), the scripted environment write made atomic and
the agent-session suite re-run 12/12, and `pnpm lint` re-run): `pnpm verify` stops at
`pnpm lint` — 4 errors, all in James's untracked `work/composer-directions.html` (42
pre-existing warnings elsewhere) · preflight OK (2 dirty-sibling warnings) · check-single-copy
ok · icons current · `pnpm typecheck` 25 projects · `cargo fmt --check` clean · clippy
`-D warnings` clean · `pnpm bundle:assert` OK (initial 530.6 KB raw / 143.1 KB gz) ·
`pnpm test`: 333 files passed, 3 failed — `guest-door` and `peer-link.e2e` (HEAD rows that
probed federation through local-only doors; the new D36 gate refused them, deterministically —
moved, as recorded above) and `agent-session`'s clean-environment row (green alone: a
half-written environment file, since written atomically) · `pnpm test:rust` 241 passed, 6
ignored · `pnpm gen:check`: the only diff was the two regenerated layout outputs, unstaged at
the time and byte-identical before and after `pnpm gen` · `pnpm smoke:godview` exit 0 ·
`pnpm smoke` exit 0 (native connected, five units) · the fieldd agent-session suite 14/14 with
`FIELDD_TEST_REAL_AGENT=1` (51.8 s): the real Claude Code alive and `native-hooks` after five,
re-attached at epoch 2 on the pinned port with the stop issued right after its hooks arrived,
the hooks flowing again, terminated `application-terminated` 143 — with two lines worth an
eye: the AR-3 row's terminate still reads `exited.reason: "unknown"` (the backstop won over the
floor's exit facts on that row; intermittent, TC's), and the prompt receipt after the re-attach
is `uncertain` while the hooks nonetheless arrive.

**Still owed:** `deletePersona` under a live run (above); PU-12 upstream; the Agents settings
section (the persona login pane's UI; `agents.manage` on a window); **AR-5** the views port;
`agent.control` (AR-6); the ingested tier's rows (AR-8); the upstream pins still UNPUSHED
(puppeteer `8402184`, rosetta `af6f0d7`); the dev-local snapshot of the draft docs (James's
ritual); the DESIGN.md Godview citation (James's live edit); `SIBLINGS_TOKEN`.

## AR-5-0 — the pins move: puppeteer `d2b0600`, rosetta `e8d907a`; every AR suite re-witnessed (2026-09-13)

**A pin move, ledgered as the EL8 event it is** (`f6b2accc`; this docs commit after it).
Between AR-4b's landing and the AR-5 plan, James landed `d2b0600` on puppeteer ("make session
reattachment safe and restore verification" — on top of PU-1b: `runtime.attach` answers a run it
already manages ONLY when the request names the same identity at the claim's next epoch — same
provider, creation request, terminal, native id, refs — and refuses anything else
`RUNTIME_RUN_CONFLICT`, as it refuses a terminal that already holds a session; every refusal after
the bind disposes with `{release: true}`; an in-flight attach is awaited by `dispose`; a failed
bind while attaching drops only the provisional run and releases the claim lease; the
prepared-launch path forwards `ingress` and `reportBound` sits inside the try so a failing
`onBound` releases the listeners; plus the org rename to `vibefield/puppeteer`, `.nvmrc`
22.18.0, `packageManager: pnpm@10.34.5`) and `e8d907a` on rosetta ("clear validation failures
before main integration" — the claude-code adapter's skim-admission fields, the pipeline live
test, bench, fmt). `pnpm siblings` showed both HEADs ≠ pin and `pnpm preflight` FAILED, so the
AR-5 plan's first slice is this one: `pnpm siblings:pin` (both pins are on no remote branch —
James pushes), `pnpm siblings:build` (1 m 27 s, incremental, cargo's own target on the SSD),
fieldd typechecked against the new sources (clean), and every suite AR-1…AR-4b left behind
re-run at the new pins.

**Witnessed, all at the new pins on the rebuilt rosettad:** `agent-session` 12 scripted rows + the
2 REAL claude rows (`FIELDD_TEST_REAL_AGENT=1`: alive + `native-hooks`, re-attached at epoch 2
with the hooks flowing again; 14/14 in 42 s) · `agent-runtime` 10 scripted + 1 real-rosettad
row · `rosettad-daemon` 6 scripted + 3 real rows · `rosettad-supervisor` 11 scripted + 3 real
rows · `agent-index-sessions` 13 · `agent-monitor-pin` 1. **Nothing in the upstream rewrite moved
a fieldd row:** fieldd's `attachRecord` already attaches at the CLAIM's epoch and holds pending
on any refusal, and `RUNTIME_RUN_CONFLICT` folds into the same `ATTACH_FAILED` reason as every
other refusal.

**One defect surfaced — ours, not upstream's.** The R4 reconcile row in
`packages/fieldd/test/agent-runtime.test.ts` built its root as `vf-agents-pre-<pid>-<timestamp>`
under `tmpdir()`, and under macOS's default `/var/folders/…/T/` the mock mgmt socket at
`<root>/users/1/native/run/mgmt.sock` came to 112 bytes — past the 104-byte `sun_path` limit —
so `MockMgmtServer.start` failed `listen EINVAL` on every run whose shell had not exported a short
`TMPDIR` (the class the smokes already know; every other row uses `mkdtempSync`'s 16-character
name and sits at 95 bytes). Fixed to `mkdtempSync(join(tmpdir(), "vf-pre-"))`; the file is 10/10
under the default `TMPDIR` now. A row that passes only under an exported `TMPDIR=/tmp` is a row
the gate can pass without exercising — worth a look at every fieldd fixture that plants a unix
socket under a named temp root.

**Facts for the CI clone step (`SIBLINGS_TOKEN`, still James's):** puppeteer now declares
`packageManager: pnpm@10.34.5`, and pnpm's version management follows it under
`--dir ../puppeteer` (verified locally: `pnpm --dir ../puppeteer --version` prints 10.34.5 from an
11.13.1 shell), so the filtered install will fetch that pnpm; its `.nvmrc` says 22.18.0 while ours
says 26 (`engines.node >=22.18.0` — no conflict for a `link:` consumer).

**Gate:** `pnpm verify` verbatim (detached, logged) exits 1 at `pnpm lint`: all 12 biome diagnostics are in James's untracked `work/composer-directions.html` (the SNAP-0/AR-1 state); preflight (2 dirty-tree warnings), check:deps, icons:check and typecheck ran green inside it; biome over the tracked tree exits 0 (30 warnings, 15 infos, no errors); the six stages after lint run individually in the gate's order, each exit 0 — `cargo fmt --check` · `pnpm lint:rust` · `pnpm bundle:assert` · `pnpm test` (all 25 projects green: fieldd 77 files, 737 passed + 12 skipped; the two large renderer/shell suites 725 and 679 + 2 skipped) · `pnpm test:rust` (241 passed, 0 failed, 6 ignored over 21 result lines) · `pnpm gen:check`.

**Still owed:** unchanged from AR-4b, minus the pin move: the pushes (now puppeteer `d2b0600`,
rosetta `e8d907a`); PU-12; `deletePersona` under a live run; the Agents settings section; the
DESIGN.md Godview citation (James's live edit); `SIBLINGS_TOKEN`; the dev-local snapshot (the
AR-5 plan `thinking-ar-views-port.md` joins the draft docs awaiting it). Next: **AR-5** proper —
PU-5a the views package upstream, in parallel with the fieldd halves of AR-5d/AR-5e (the plan's §7).

## AR-5 — the views port: the Godview monitor's views become `@vibecook/puppeteer-views`, behind two injected ports (2026-09-13)

**What landed** (`fe6b3d0a`; this docs commit after it). The plan (`draft/thinking-ar-views-port.md`,
Status flipped, §11 as built) ran as leaned on the slate AR5-D1…D7 — James: "go ahead". Upstream
first, then the consumer:

**PU-5a upstream — puppeteer `main`, six commits, all fast-forwards from the `feat/views-package`
worktree (the pin moved `d2b0600` → `5389449`; rosetta stays `e8d907a`; both UNPUSHED — James
pushes):** `f33da93` the package (`packages/views`, 0.1.8 — `monitor/*` incl. the registry, the
parameter system, the palette, the unread and usage ledgers; `colour/*` the project tint and the
pane colours; the marks atlas; `bar/InstrumentBar` with `leading`/`trailing` slots and
`BarControl`; `usage/UsageColumn` over `AccountUsagePort`; `find/FindSheet` over `HistoryPort`;
the swarm on WebGPU with its physics behind `SwarmPhysicsDriverContext` and VibeField's worker
host, frame, protocol and inline driver moved in under `physics/`; list; rain; the lab and its
fixtures exported; `styles/views.css` the one sheet a host imports; `MonitorAgent` generalized —
`session?`, `createdAtMs`, `remote?`, `tier?`, the facet's `provider: {id,label}` and optional
`monitor`; Core's `AccountUsageEntry/Batch` schemas; the runtime's `createAccountUsageMonitor`
service; puppeteer's own Godview re-based on the package, its lab bundling the package's; the
layout gate mapping the package) · `b9a0ce9` (a facet may precede its first monitor state; the
swarm names its renderer on its section — `data-swarm-renderer` starting|webgpu|unavailable; the
lab fixtures exported) · `77f24fd` (`useMonitorPalette(root?)` / `readMonitorPalette(root?)` read
the Godview root they are given — a page with two roots needs it) · `33d8369` (the 31 physics
tests come across with the physics, `physics/{world,host}.test.ts`; the package had zero tests
over the moved modules) · `8af9df9` (the find sheet gives focus back on close; every body's
button carries `data-agent-bubble-source`) · `5389449` (a peer's session says its host — the name
FIRST, the write policy in both directions, in all three views; `monitor/remote-write.ts` ported
and exported). Gates upstream at `5389449`: views typecheck + **17 files, 131 tests**; the Godview
app **32 files, 198 tests**; the root typecheck; the layout gate `clean (22 packages, 2 apps)`.

**AR-5a — the fence, the lock, the walls.** `pnpm-workspace.yaml` gains the seventh `link:` row
(`@vibecook/puppeteer-views`) and the fence comment records the dedupe answer: React is a PEER of
the package, so `scripts/check-single-copy.mjs` compares a sibling `link:` root's react/react-dom
by VERSION against this tree's and never counts them as a second copy (an uninstalled sibling is
still a problem); `packages/field-app/vitest.config.ts` dedupes react; the R21 door admits the
package; `siblings.lock.json`'s package list names it (`pnpm siblings:pin` writes it); CI's
filtered install widens to `--filter "@vibecook/puppeteer-views..."`; the witness
`godview-views-package-react.test.tsx` renders `listMonitorView.Component` under this tree's
React. The lockfile moved by four lines.

**AR-5b/5c — the renderer on the package.** `GodviewMonitor` is the package's `InstrumentBar`
(the notice in `leading`; in `trailing` VibeField's provider `<select>`, SPAWN, and the FIND and
SYSTEM CONTROL `BarControl`s), the `FindSheet` on ⌘F over the door's history port, and the stage
under `SwarmPhysicsProvider factory={createSwarmPhysicsDriver}` — the ONLY swarm files left under
`views/swarm/` are the worker driver (watchdog, inline fallback, the mode word) and the worker,
both importing `@vibecook/puppeteer-views/physics`; beside the stage `.vf-monitor-chrome` holds
the package's usage column and `.vf-monitor-claims` VibeField's chips. The row is the package's
`MonitorAgent` with VibeField's facet extension (`kind`, `tier`, `runtimeRunId`, `profileId?`,
`monitor?`, `summary`); `monitor/agents.ts` re-assembled over `colours` + `projectSeqs` — the
per-agent colour is the PROJECT's (record §02, D3): `monitor/project-ledger.ts` deals each project
key (workspace root, else source path, else the observed cwd) a sequence, kept in
`localStorage` (`vf-godview-projects-v1`), `projectTint(seq, palette.tint)` turns it into a hue;
terminals and remote rows wear the ramp; the eight §2.6 accent slots, `agentAccentSlot`, the
palette module, `AgentIcon`, `chrome.ts`, `parameters.ts` and `registry.ts` are DELETED. Pane
colours come from the package's `dealPaneColours` over the deck's `paneIds` (the deck now
publishes `paneIds` + `activePaneId`); attachments are keyed by session id. The usage ledger is
folded in the hook (`reconcileUsage` on a 30 s step, seeded and saved through
`monitor/usage-history-cache.ts`, `vf-godview-usage-history-v1`, D7) from the mirror's
passthrough usage rebuilt into Core's shape (`coreUsage`); unread through `reconcileUnread`. The
status word is Core's — `blocked`, where GT-3m said `waiting`; `godview.css` lost the header,
list, rain and responsive rules and gained `--blocked-*` aliases, `--tint-l/--tint-c` (light
0.6/0.15, dark 0.74/0.15), the bar select and the claims strip; the manifest imports the
package's sheet. `monitor-tuning.ts` keys a view's parameters by `viewId[:parametersRevision]`.
The marker gained `swarmRenderer` (read off `[data-swarm-renderer]` by a MutationObserver),
`usageTiles` (counted off the chrome slot; -1 unmounted) and `findSheet` (open|closed).

**AR-5d — `agents.usage` + `agents.usage.subscribe` (the builder's half).** Contracts
`agent-usage.ts` (`AgentAccountUsageEntry` — provider, label, profile, a tolerant `state`
available|rate-limited|unauthenticated|unsupported|unavailable|unknown, metrics, credits, the
provider's own message, retryable/retryAt, stale, fetchedAt, scope, source — and the batch) with
two fixtures; fieldd `agent-usage.ts` (`AccountUsageService` over the runtime's
`createAccountUsageMonitor`, `refreshProfiles` on `runtime.onProfilesChanged`, the
`FielddConfig.agentUsage` seam) and the two rows under `agent.observe`, local. **Polling is
DEMAND-DRIVEN — only while a subscriber exists** — because the reference's Claude adapter puts the
OAuth token on the wire to `api.anthropic.com` and no daemon boot in the test graph may do that
on its own. Renderer side, `usagePortOver(client)` rebuilds the flattened row into Core's
two-part entry (provider + result; `refresh.pollIntervalMs` is `NaN`, documented as not a
reading) and delivers the subscription's snapshot then frames, dropping an unreadable frame.

**AR-5e — `index.sessions` + `index.search` (the builder's half; AR-8's first brick).**
Contracts `IndexSessionsParams/Result` (camelCase rows), `IndexSearchParams {q,
nativeSessionIds?, afterMs?, limit?, prefix?, kind?}`, `IndexSearchResult {answered, state
{readiness incl. "unknown", canonicalReady?, progress?, detail?}, hits, clipped}`,
`IndexStatus.search?` (reachable, capabilities, readiness) with three fixtures incl. rosetta's
own protocol-20 answer; fieldd `IndexService.sessions()`/`search()` — chunks of 64, the two-call
keystroke, a bounded root walk, `answered: false` when the index is not ready (never "no
matches"), `index.sessions` UNAVAILABLE before the daemon is ready — on `index.read`, local; the
fake rosettad grows `/api/search` + `/api/sessions/{id}`; the window token gains `index.read`.
Renderer side, `historyPortOver(client)` maps the three doors onto the sheet's `HistoryPort`
(a `null` protocol version stays absent; a rejected `index.sessions` PROPAGATES so the sheet
keeps its last facts; a rejected search is `answered: false`).

**The catalog (UI_SYSTEM's two rules).** `SwarmBodiesPreview` mounts the SHIPPING swarm over the
package's own lab fixtures — every drawn state — inside a Godview root of its own (theme, motion
and replay controls; selection answered as a deck would; the palette read from ITS root, which is
what `77f24fd` is for); `AgentBubblePreview` and its 637 lines of replica-adjacent chrome are
gone; the boundary test's rows follow; the ambient-animation audit now reads the overlay's sheets
through the package's export and its `@import`s and asserts ZERO keyframes — GT-3p's ignition
loops, shadow cross-fades and James's tuned shadow numbers retired with the DOM bubble (the swarm's
motion is the shader's, gated by the same switches).

**Tests moved, deleted, written.** Deleted with their subjects: `godview-agent-bubble`,
`godview-swarm-loop`, `godview-rain-streams`, `godview-swarm-physics`, `godview-swarm-protocol`
(the last two are the 31 upstream now), `godview-monitor-parameters` (its registry and parameter
describes live upstream; `godview-stage-parameters.test.ts` keeps the stage-height split and
tests the tuning key). Re-expressed by two builders: the fold suite (`monitor-agents` 17,
`monitor-status` 9, `local-field` 5, `remote-field` 26) and the stage suite (`monitor` 15,
`remote-door` 17, `monitor-lifetime`, the bar instead of a `<select>`). New: `project-ledger` 12,
`usage-history-cache` 7, `monitor-doors` 24 (both adapters over a fake door and the contracts
fixtures), `stage-parameters`, the React witness. **field-app: 86 files, 723 tests** (the two
remote-row claims — the host eyebrow, the write policy both ways — were `it.skip` until
`5389449` drew the facet, then un-skipped and green). fieldd: `agent-index-search` 14 (13
scripted + 1 real rosettad), `agent-usage` 10 scripted + 1 real (`FIELDD_TEST_REAL_AGENT=1`,
11/11); contracts: `agent-usage`, `agent-index-search`, the fixtures suite.

**The smoke (`pnpm smoke:godview`, exit 0, `"ok":true`), the AR-5 rows verbatim:**
`"monitorView":"swarm","monitorAgents":1,"swarmPhysics":"worker"` ·
`"swarmRenderer":"unavailable"` with the WEBGPU line read off the stage (headless Electron on
this Mac paints on `canvas2d` and hands the overlay no WebGPU — the honest line is the row, not
the pixels; §6.7 as planned) · `"usageTiles":0,"usageColumnMounted":true` · `"findSheet":"open"`
→ `"findSheetAfterEscape":"closed"` on a synthetic ⌘F and Escape ·
`"focusAroundFind":"hasFocus=true active=TEXTAREA.terminal-input → hasFocus=true
active=TEXTAREA.terminal-input"` · `"paneTypeableAfterFind":true` ·
`"localBubbleClicked":"jamesyong, unassigned terminal, idle"` on
`.vf-monitor-swarm-list button:not([data-agent-bubble-source="remote"])` ·
`"localAck":"jamesyong mounted in the active pane"`. Five runs to get there, each red a finding:
run 1 died on `.vf-monitor-bubble` (the DOM bubble is gone — the click lands on the body's
button now); run 2 typed into nothing after ⌘F/Escape — **the package's find sheet took focus and
kept it on close** (`8af9df9`); runs 3 and 4 delivered the pane's next line IN PART after the
focus returned (an empty `$0`, then an answer file that never appeared while its marker did) —
the pane's routed activation reopens on focus and a harness typing at 3 ms a key lands in that
window, so the row now proves the pane is TYPEABLE again by retyping a marker line until it
lands; run 5 green.

**Found and fixed upstream on the way (four of the six commits):** the find sheet's focus; the
remote facet drawn by no view (the stage builder's finding — the host eyebrow and GT-5c's
writability word had lost their only surface; a peer's row drew exactly like a local terminal);
the palette reading the document's first Godview root on a two-root page; the bodies' buttons
naming no source. **Recorded deltas, placed at their sources:** GT-D16's erratum (the renderer
paints on MAIN behind a physics DRIVER port; `adoptCanvas` stays unused; the roadmap's and the
triad doc's "mounted into the worker's `adoptCanvas` socket" was the expectation restated), the
triad §16 phrase, GT-D13's "IMPORTED, not ported", the spec's §8 line, design-04 §8.1, DECISIONS
(D13/D14 as built, the AR5 slate indexed), the PU-5 petition LANDED, the plan's Status.

**Gate:** `pnpm verify` verbatim exits 1 at `pnpm lint` — biome `Checked 1294 files … Found 8
errors`, all eight in James's untracked `work/composer-directions.html` *(erratum 2026-09-13, later that night: FOUR of the eight were in that file; the other four were biome FORMAT errors in tracked files — three AR-5 fixtures, `agent-list`/`agent-monitor-state`/`agent-spawn.valid.json`, and `scripts/check-single-copy.mjs` — a count read off biome's summary line, not its diagnostics; formatted at `c2c1cf2e`, after which lint's errors are that file's alone)* (the AR-5-0 class;
preflight OK with the two dirty-sibling warnings, check:deps, icons:check and typecheck ran green
inside it). The stages after lint, in the gate's order, each run alone: `cargo fmt --check` exit
0 · `pnpm lint:rust` exit 0 · `pnpm bundle:assert` exit 0 · `pnpm test` exit 1 with ONE red in
field-app — `godview-remote-door.test.tsx › with NO door … expected 'serving' to be 'no-door'`,
the file the repo already knows samples too early under load (`godview-remote-door-samples-too-
early`); alone it is 17/17 twice in a row; every other project green (fieldd 79 files + 1
skipped, electron-shell 69, contracts 24) · `pnpm test:rust` exit 101 on
`logging::tests::queue_and_ring_stay_bounded_and_reserve_high_severity_capacity`'s 4 s flush
deadline (the row with no headroom, `native-logging-deadline-has-no-headroom`; the run overlapped
the upstream re-check on this loaded host) — re-run alone: exit 0, `241 passed; 0 failed; 6 ignored` over 21 result lines (AR-5-0's numbers exactly) · `gen:check`'s Rust half
(`gen:rust` + the diff over `packages/contracts/gen`, `contracts.rs`, `registries.rs`) exit 0; the
docs half is not run here because `gen:docs` rewrites James's STAGED `docs/plugin-authoring/*`.

**Still owed:** DESIGN.md §1.1's Godview citation + the §2.6/§2.7 sentences (James's live edit;
the text is the plan's §9) · the `adoptCanvas` phase 2, on a measured main-thread cost of the
swarm's frame, not a date · PU-12 and `deletePersona` under a live run · the Agents settings
section · `SIBLINGS_TOKEN` and the pushes (puppeteer `5389449`, rosetta `e8d907a`) · the dev-local
snapshot (the plan doc, the errata, the petition row, the triad rows — all in `draft/`) · the
six-lens review of this slice, as AR-4b was of AR-3/AR-4. Next: **AR-6** approvals + prompts
(Godview's send box PANE-ONLY).

## AR-5b — the review's fixes: two content scopes, the walk that drops nothing, the column that paints, a peer's row that says its host (2026-09-13)

**AR-5b is what six reviewers found** (`5bb79329`; puppeteer `4d734c9` + `b0f08ec` upstream, pinned).
AR-5 landed and was read the same day by six Opus agents at six lenses — the renderer, EL7,
the contracts and this ledger's own claims, fieldd, the tests, the upstream landing. One
blocker, eleven majors, some thirty minors; every blocker and major is fixed here, the minors
that were cheap with them, the rest named under "owed". Nothing about AR-5's SHAPE changed:
the views are the package's, the ports are injected, the fold and the door are ours. What
changed is what the doors may be asked for by whom, what the walk answers, and one CSS rule.

**The blocker (the renderer lens): the usage column never painted.** `.vf-monitor-chrome` had a
comment and no rule — the AR-5 rename that made the class the chrome slot deleted the claims
strip's old rule under the same name and wrote none for the slot. On the swarm (the default
view) the column laid out in flow BELOW the clipped stage; on the list it became a full-width
block whose `--vf-monitor-chrome-right` pushed every row off the stage. The smoke could not see
it (`usageTiles` counted the DOM, not the paint). The reference host's rule is ported
(`position:absolute; top:11px; left:13px; width:46px; height:calc(100% - 17px)`) — which is why
the claims strip always started at 72px — and the boundary test scans for it.

**EL7 (the security lens): two CONTENT scopes.** `index.sessions` + `index.search` rode
`index.read`, the census scope a plugin may hold to draw the roll call and that
`PLUGIN_CAPABILITY_ELIGIBILITY` admits for renderer and service entries alike — so a plugin
consented for the roll call would have gained transcript search over every consented root on an
upgrade with no re-consent. `agents.usage` rode `agent.observe` the same way: the account's
billing state and a credentialed vendor call per reading, for anyone consented to watch the
fold. Two scopes in the registry now — `index.search` and `agent.usage` — local-only forever,
absent from the tailnet preset and from every eligibility table (James's staged `plugins.ts`
names neither, and absence is the safe default there; the file was not touched). The window
token holds both; the contracts rows, the fieldd door tests (tokens, posture rows, and the D36
rows, which now meet the SCOPE wall first since the tailnet preset carries neither scope) and the
registry tests follow. Also EL7: the reader's own search query rode into fieldd's persisted log
segments and out through an RPC error on the malformed leg (`/api/search?q=…` in `getBody`'s
log lines and messages) — `routeOf(path)` strips the query string before either; the contract's
"never the query" holds. A one-shot `agents.usage` before `lifecycle.ready` spent a credentialed
call the boot meant to defer — `snapshot()` answers the honest empty until armed.

**fieldd (the daemon lens, three probe-witnessed majors).** The attribution walk is the ORDINARY
path, not an edge: rosetta widens each named root to its delegated children, so hits arrive from
sessions the question never named — and a flat budget of 32 sequential lookups dropped a fifth
of a 40-agent board's matches (the reviewer's probe: 40 hits in, 32 out). Every distinct
unknown session is resolved now, concurrently in flights of eight under one 8 s deadline, up to
the answer's own size; a walk that stops early CLIPS the answer. An unresolved hit claimed to BE
its own root (`rootSessionId: root?.id ?? hit.session_id` — a subagent transcript read as
top-level; 24 of 40 hits in the unscoped probe): `IndexSearchHit.rootSessionId` is optional in
the contract, the package's `HistorySearchHit` likewise (`4d734c9`), and the child's own row
names its root as a fact even when the root's row was not fetched. A scoped hit dropped as out of
scope marks the answer clipped. The usage poll's first frame reported every account FAILED and
spent one extra credentialed call per provider: `beginPolling` ran `monitor.start()` (an
immediate reading over the unkeyed per-provider rows) BEFORE `refreshProfiles()` replaced those
rows — the reconcile runs first now, and the start's own reading finds nothing due. Rows: three
over the service with a stub daemon (`agent-index-walk.test.ts`: 40/40 scoped, no hit its own
root unscoped, 80 lookups in flights; a daemon that cannot answer the walk clips and carries NO
root), the first frame (one row per account, `available`, one reading, no unkeyed call), the
refcount (only the last subscriber to leave stops the poll — the tests lens's mutation showed an
unconditional stop passed every row), the readiness edge over an unknown scope while the
projection is building (`answered: false`, never "no matches"), the ready refusal that asks
nothing, parse-through under the contract on the producer's side, and the metric asserted
EXACTLY (a `toMatchObject` on a `.passthrough()` shape let a new key cross with everything
green).

**The contracts lens.** A credits-only `available` reading (Codex, Grok: no percentage meters)
was drawn as a refusal captioned "available" with its credits dropped — the adapter gated on
the meters; it gates on the state now and the column's own NO LIMIT DATA line draws it. The
contract's `unknown` state (a daemon that has not read yet) was folded to a bare `unavailable`
that claimed a refusal — it is said as "no reading yet", retryable, under no code (Core's
failure union has no slot for it; a `pending` slot upstream is the real fix, owed). The open
scope word is read through Core's enum (`unknown` for a word it does not know, never a typed
lie). Two wire shapes shipped no fixture — `index-sessions.valid.json` exists and
`index-status.valid.json` carries the `search` block the sheet reads; both are in the prefix
map. The generator's "deliberately absent" comment names the agent plane.

**The renderer lens, beyond the blocker.** The usage column subscribed to the port it was born
with (`[]` deps upstream) — a door that arrives after the first mount left it on a no-op port
for the session; it follows `port` now (`4d734c9`). The stage's palette read the document's
first Godview root; it reads ITS root through a ref filled in layout. The digit chords cycled
by session id — a managed row with no pane has no session, so `undefined` matched the first
sessionless row and ⌘2 kept answering the same row; the cycle compares row ids. The FIND
control named a sheet that returns `null` while closed (`aria-controls` only while open); the
sheet's `onClose` is stable; the dead `--vf-monitor-chrome-height` write is gone; the project
ledger's cache is capped at 256 keys (the newest dealt); a usage seed is marked when it lands,
so a double-invoked effect asks again rather than never.

**The tests lens.** The gate's "lottery" red was misdiagnosed: `godview-remote-door`'s "with NO
door" row read `'serving'` from an ORPHANED MOUNT — one row mounted twice and the helper replaced
the root without unmounting the first tree, whose 2 s mesh poll kept firing markers into later
rows' arrays under load. `unmountMonitor()` between the two mounts; the repo memory that filed
it as early sampling is corrected. The two remote-row claims' "skipped" comments said to delete
them once the facet was drawn — they are live and pass; the comments say so. The deleted
parameters test's registry invariant (distinct ids, labels, controls) is kept in
`godview-stage-parameters.test.ts`. Three of AR-5's four upstream fixes shipped with no upstream
test (the package has no DOM environment): the bodies' source attribute has one now, statically
(`AgentSwarm.test.tsx`); the find sheet's focus return and the palette's root remain witnessed
only by this consumer's smoke and catalog — owed upstream with a DOM environment.

**Upstream (`4d734c9`, `b0f08ec`; views 18 files / 133 tests, the root typecheck, the layout
gate).** Beside the port and the root: the `./physics` subpath no longer re-exports the React
context (a host imports that subpath inside its physics WORKER; the provider stays on the main
entry — `b0f08ec`, after the first cut took it off both); `@webgpu/types` is a dependency
(the emitted declarations name `GPUDevice` and kin, and tsc drops the reference directive from
the `.d.ts` — a consumer typechecking against `dist` names it in its own `types`, which the
entry's header says; this consumer compiles the source); `sideEffects` names the lab entry
(its module runs `main()` on import); the palette diffs before it publishes (a host class
toggle on `<html>` re-rendered every consumer and dropped the swarm's colour cache); the DOM
damage gate's dead fields left the frame.

**Errata for §AR-5, placed here at the claim's source (the ledger is the source):**
· "six commits" — the pin move `d2b0600` → `5389449` was NINE commits: beside the six, James's
own `a94b5f4` (the runtime's conversation-snapshot API removed), `e32b56b` (core's artifacts
service and `state.subagents` removed — the schema-3 change this entry already carried) and
`2de78ee` (docs); no fieldd, renderer or contracts reader of the removed APIs exists, so the pin
carried them silently — an EL8 entry names what it carries, and now does.
· "Polling is DEMAND-DRIVEN — only while a subscriber exists" — the recurring poll is; a one-shot
`agents.usage` takes exactly the one reading it was asked for (and since AR-5b only once armed,
after the registry reconcile). The boot claim stands.
· "the file the repo already knows samples too early" — it did not; see the tests lens above.
· "views 17 files / 131 tests" — the runner's count, which stands; a static count of `it(` sites
is 126 (rows generated in loops make the difference).

**Gate:** `pnpm verify` verbatim exits 1 at `pnpm lint` — biome `Checked 1296 files … Found 8 errors`, all eight in James's untracked `work/composer-directions.html` *(erratum 2026-09-13, later that night: FOUR of the eight were in that file; the other four were biome FORMAT errors in tracked files — three AR-5 fixtures, `agent-list`/`agent-monitor-state`/`agent-spawn.valid.json`, and `scripts/check-single-copy.mjs` — a count read off biome's summary line, not its diagnostics; formatted at `c2c1cf2e`, after which lint's errors are that file's alone)* (the AR-5-0 class; preflight OK with the two dirty-sibling warnings, check:deps, icons:check and typecheck ran green inside it). The stages after lint, in the gate's order, each alone and each GREEN this time: `cargo fmt --check` exit 0 · `pnpm lint:rust` exit 0 · `pnpm bundle:assert` exit 0 · `pnpm test` exit 0 — every project green in ONE pass (field-app 86 files, 729 tests; fieldd 766 passed + 14 skipped, the opt-in real rows; electron-shell 679 + 2 skipped; contracts 160), the orphaned mount's red gone with its cause · `pnpm test:rust` exit 0, `241 passed; 0 failed; 6 ignored` over 21 result lines · `gen:check`'s Rust half (`gen:rust` + the diff over `packages/contracts/gen`, `contracts.rs`, `registries.rs`) exit 0; the docs half is not run because `gen:docs` rewrites James's staged `docs/plugin-authoring/*`.

**Owed, named by the review and not taken here:** the swarm's render loop (interpolation, the
rAF pump) has no test in either repo — the plan's §6.6 "loop rewritten against an injected fake
`SwarmRenderer`" needs a renderer seam the package does not have (an upstream ask, PU-13) · a
`pending` slot in Core's account-usage failure union · a DOM environment upstream for the find
sheet's focus return and the palette's root · `index.status`'s `detail` carries rosettad's raw
stderr tail to the renderer (project a reason word) · one deadline per `index.search` across
its legs, and `progress` on the index's UNAVAILABLE refusals · a WS heartbeat behind the
demand-driven poll (a wedged renderer holds the subscription) · the fake rosettad's four
divergences from the real daemon (prefix, clamp, the 400s, child hiding) · ⌘F is meta-only
(the Windows port) and is swallowed on the catalog page · the swarm's physics mode is not on
the section (`data-swarm-physics`) · `updatedAt ?? 0` in the history adapter (the package's
facts want a number) · the `unknown` metric count (131 vs 126) is a note, not a defect.

## IOS-3c — the write key has a home: the phone can be granted writes

**LANDED 2026-09-09, `9b07fc61`** (+ `997baf8a`, the workspace pin record). Built by a
briefed agent in a worktree, reviewed and integrated by the orchestrator on the `ios/keyboard`
branch; James merges. The gate the IOS-3 entry named as unmet: `72929d8` claimed 3c and shipped
the lifecycle without the capability — the access token rode every attach and every re-dial,
but nothing ever assigned it, so the phone attached VIEW-ONLY for the life of the process and
`HomeScreen.swift` said so in as many words. It now has a home, and the input card
(`thinking-ios-keyboard.md` §8, K-D2) has its first real user.

**What landed.** `FieldTerminal/MirrorWriteStore.swift`: `MirrorWriteHost` (device id + the
NAME, stored beside the secret so a host that is offline today can still be named in a list of
keys), `MirrorWriteStoring`, `KeychainMirrorWriteStore` — one generic-password item per host,
service `com.jamesyong.vibefield.ios.mirror-write`, account = device id,
`AfterFirstUnlockThisDeviceOnly` (the terminal re-presents its token from a foreground resume)
and `kSecAttrSynchronizable = false` (a grant to ONE device must not ride iCloud Keychain to
every device the user owns); `hosts()` asks for attributes and never data, because the one way
to keep a secret off the screen is not to fetch it — and `InMemoryMirrorWriteStore`, the fake
and the DEBUG seed, whose `wildcard` answers for hosts it never listed and is deliberately not
a host. The card's invitation gains ENTER KEY exactly where the copy blames THIS device
(`FieldHomeModel.keyEntryOffered`, pinned: never on a read-only session, never over "you can
type here"); a live attachment that is view-only for want of a key gets the same act as a
status chip; `WriteKeySheet` takes a key and never reads one back (REMOVE appears only when a
key is held; an empty SAVE is a no-op, not a greyed-out control — D-i6); the settings sheet
gains WRITE KEYS, hosts and one act, absence in words. `HomeScreen`: `mirrorWriteCapability`
is gone — the token is read PER HOST at `beginAttachment`, and a key saved under an open
view-only attachment re-attaches with it (detach awaited first, so the `attaching` latch's
invariant holds). DEBUG `-vf-write-key=<secret>` / `-vf-open-write-key` compile out of Release.

**Tests 149 green (was 135):** `MirrorWriteStoreTests` (10) on the fake, `write key entry` (4).
The Keychain store is not tested headless and says why: a package test host's keychain is not
the product's. **Witnessed** in the simulator, both themes: ENTER KEY under the invitation, "you
can type here" with a key, the sheet, the section. **NOT witnessed, and it is the slice's real
gate:** typing into a serving desktop — a phone, a tailnet and a mesh, none of which a
simulator can stand in for. James's device run. Found on the way: the Xcode workspace's
`Package.resolved` had recorded ghosttea 0.9.3 since `cec95a84` while the manifest and the
kit's own resolved file said 0.10.1 — every build re-resolved on the fly, so only the record
was wrong; `997baf8a` moves it.

## IOS-5a — the card and the rail: the keyboard design lands in the field, Draft mode

**LANDED 2026-09-09, `639bd60f`, merged onto `ios/keyboard` at `b5692752`** (with IOS-3c,
`9b07fc61`). The finalized KeyboardLab design ("Composer + Rail", `research/mobile-terminal/
KeyboardLab/DESIGN-PROPOSALS.md`, decisions §11) meets the real seam per `thinking-ios-keyboard.md`
§2–§3 and §8: re-skinned into D-i2's godview mono, carried by the session sheet's own liquid glass,
each key a `FieldChip`-shaped 44 pt key, attention as inversion and never hue, and the copy rule
kept — the word "Live" never reaches the screen; the mode is a terminal glyph and the strip says
"Typing into terminal". Built by a briefed agent in a worktree in parallel with IOS-3c; the
orchestrator reviewed, merged (three files, all keep-both) and gated the merged tree.

**What landed.** `FieldTerminal/TerminalKeystroke.swift` — `TerminalKey` / `TerminalModifiers` /
`TerminalKeystroke`, the public vocabulary the card composes in, and the module-internal encoder to
the kit's hardware-key event: the named usages and the `|`/`~` rows COPIED from the kit's own
accessory table so our rail and the row we switched off cannot drift, the rest of the US layout
derived from the HID table, unencodable characters `nil` rather than a wrong byte.
`TerminalAttachment` grows `press(_:)`, `sendDraft(_:)` (paste, then Enter; empty is Enter alone;
never trimmed) and `typeText(_:)`, all through `ensureControlForTyping()`. `TerminalSurface` grows
`showsKitAccessoryRow` (default **false** — K-D3: the kit's fifteen-key row is off because ours
replaces it), `wantsFocus` (the Live half of two-modes/two-first-responders) and
`keyboardAppearance`; responder changes ride the next main turn, because a keyboard raised inside
a SwiftUI update pass resizes the view's own ancestors mid-pass. The new target **`FieldInput`**
(K-D1) holds `InputCardModel` (two modes, the draft, the sticky-Ctrl `LatchState` as a pure value,
one `InputAct` sink), `ComposerField` (a `UIViewRepresentable` carrying the kit's trait set —
no autocorrect, no smart punctuation, no predictive bar — 1→5 lines, single-character
interception while latched) and `InputCard` (the composer row over eight rail keys); it takes
`FieldTerminal` for the vocabulary only and names no Ghosttea product, so "the card composes a
terminal without knowing how one works" is a fact the manifest enforces. `FieldHomeModel.
inputCardFace` (K-D2): the card is on screen for exactly one state — a live attachment this device
may type into; every other state renders nothing (D-i6). `HomeScreen`: one `@State`, one
`.safeAreaInset` on the session card, the sink installed at attach and cleared on close.

**Findings on the way, recorded at source.** Newlines are exempt from latch interception (no key
on this layout produces one; a latched Return is IOS-5b's Live path). The composer's text inset
had to live inside the text view — set from outside it left the placeholder half a character left
of the caret, caught in the simulator. The send path is the HOST's decision: the kit's paste op
rides the wire as `paste`, the host answers it through `session.paste` → `encode_paste` → the vt
shim's `eg_terminal_encode_paste`, which reads the terminal's own bracketed-paste mode and hands
it to `ghostty_paste_encode` — so a draft is bracketed exactly when the far program has DECSET
2004 on, which is why Send is a paste and not a run of keystrokes.

**Absent, not inert (D-i6):** the design's `+` menu and `⋯` keypad are IOS-5d; the mic needs the
Speech framework and its usage strings; the latch in Live mode, the long-press fans and haptics
are IOS-5b. **Tests 182 green** (135 → 168 on the branch; 182 merged with 3c):
`TerminalKeystrokeTests` (10), `LatchStateTests` (6), `InputActTests` (14), `InputCardFaceTests`
(3). **Witnessed** in the simulator, both themes: the card above the keyboard, both rows 44 pt,
equal-width keys, no predictive bar, Send quiet then inverted, CTRL inverted with its lock dot,
the strip with its Enter. **Device-gated:** the kit's row actually gone, `git status` sent from
Draft, Esc/Tab/arrows landing in a shell, a three-line draft arriving in zsh as one block.

## IOS-5b — the latch reaches the terminal: Live mode's Ctrl, the long-press fans, the Meta burst

**LANDED 2026-09-09, `e6617827`** (fast-forwarded onto `ios/keyboard`). Built by a briefed agent in
a worktree in parallel with IOS-5c; the orchestrator reviewed and integrated. K-D3 stops being a
plan: **one latch, ours, meaning the same thing whichever responder holds the keyboard.**

**What landed.** `FieldTerminal/SoftwareInputLatch.swift` — the shaping as a pure function: a
single-character commit under modifiers becomes that keystroke, Enter and deleteBackward their
named keys, a multi-character commit / paste / already-shaped key event `nil` (forwarded
untouched); it reproduces the shape of the kit's own accessory latch, read at the pinned 0.10.1
checkout, because the kit's is internal, single-shot and blind to our rail.
`TerminalAttachment.softwareInputLatch` — a public CONSUMING closure the host installs at attach
and clears in `closeCard` (the sink holds the attachment and this holds the card: a retain cycle
only that clear breaks); `handleSoftwareInput` consults it once per event, never for a paste, and
presses the shaped keystroke instead of forwarding; the old body became a private
`deliverSoftwareInput` that `sendDraft`/`typeText` use, because the card already spent its latch
at the tap and a second consumption would put Ctrl on the Enter that ends a draft. With no latch
installed the path is byte-for-byte the old one. `InputCardModel`: `takeLatchForTerminal` (the
Live half), `tapChord` (a fan key names its own modifiers — `^C`, never `^^C`; the latch is spent,
a locked one stays locked; the Meta burst rides along since a chord is a keystroke), `metaArmed`
with `armMeta`/`metaExpired` on the arm's 3 s discipline, `showFan`/`closeFan`.
`FieldInput/KeyPopover.swift` — the fan as a value (catalog + rows) and its presentation: CTRL
fans to the design's ten chords in two rows with one-word subtitles, ← → ↑ ↓ to HOME END PGUP
PGDN, TAB to ⇧TAB, ESC to META. `Haptics.swift` — light to arm, medium to lock, soft to release,
rigid for a chord, called from the VIEW (the model has no UIKit in it on purpose).

**Decisions named at source.** The fan is a `.popover` with compact adaptation and its keys are
TAPPED, not slid onto: the card lives in a `safeAreaInset`, so a fan must stand outside the card's
bounds, and slide-and-release wants it drawn inside them. Long press is 0.35 s, shorter than the
field's 520 ms hold-to-create, which makes an agent and wants deliberation. A long press ends in
a touch-up, so every rail key's action checks `openFan` first. Closing a fan gives the keyboard
back only if the composer had it. A multi-character commit spends the arm and passes through: an
IME composition has no single key to name. Alt has no rail slot (design decision 4): Esc-then-x
already is Alt-x for readline/emacs/zsh, and the burst exists for tmux, which wants the escape
and the key as one.

**Tests 182 → 208 green:** `SoftwareInputLatchTests` (9), `InputActTests` +12, `KeyFanTests` (5).
**Witnessed** in the simulator, both themes: the fan anchored above CTRL with its arrow, META
inverted on ESC, the strip in Live with the mode key lit. **Device-gated, and it is the slice's
real gate:** Ctrl-R then text; Ctrl-X Ctrl-S through a lock; vim Esc `:q!`; ⇧Tab; a Meta-arrow
tmux binding; whether the popover takes the keyboard in Live; every haptic.

## IOS-5c — the card answers for the agent: reply chips from the feed, the paste chip, the closed row

**LANDED 2026-09-09, `7d3aba75`, merged onto `ios/keyboard` at `f7a2f52e`** (one README conflict;
the code merged clean against IOS-5b because both lanes kept their hunks delimited). Built by a
briefed agent in a worktree in parallel with IOS-5b; the orchestrator reviewed, merged and gated
the merged tree. The design's contextual row lands under **K-D4: chips read the FEED, never the
frame.** A frame reaches this phone as TRF1 bytes only the Metal renderer can decode, so the
design's regex-over-the-last-rows detection (decision 3) is not merely unnecessary here, it is
impossible — and the feed is the better source anyway, being the same fact that made the bubble
loud.

**What landed.** `FieldAgents`: `AgentFacet.permissions`, carried by `fieldBubble(from:)` — only
an AGENT bubble has any, which is exactly why the chips are fixture-only today. `FieldInput/
ReplyChips.swift`: a pure `replyChips(provider:permissions:)` — Claude gets `1 YES · 2 YES, DON'T
ASK · 3 NO · ESC`, TYPED through the attachment because its TUI owns the dialog; codex/grok/acp
get nothing, their approval being a structured resolve over a product API that does not exist
(`thinking-ar` §7), and a chip with nowhere to send is the dead control D-i6 forbids — the card's
"approve at the desktop" line stays. `InputCardModel`: `chips` + `tapChip`'s stale rule (matched
by id, because the host re-derives the row on every bubble change), `acceptPaste` (the draft
appends on its own line; the terminal sends outright under five lines and reviews at five or
more), `InputAct.paste`, `keyboardOwner` over `fieldFocused` and a new `terminalFocused`,
`requestKeyboard`/`dismissKeyboard`. Views: `ChipsRow` (the waiting tier's inversion, so the
bubble that raised the card and the chip agree), `PasteChip` on a `UIPasteControl` (no "allow
paste" alert), `PasteboardWatcher` (`changeCount` and `hasStrings`, never the contents),
`PasteReviewSheet`, `ClosedRow` (chips beside `KEYBOARD` whenever the keyboard is down).
`FieldTerminal`: `TerminalAttachment.pasteText` (a block with no Enter behind it);
`TerminalSurface.onFocusChange` reports what the responder call ACHIEVED rather than what it
asked for, plus a `focusEpoch` so `KEYBOARD` can re-ask at an unchanged intent.

**Findings, recorded at source.** A squashed `UIPasteControl` stops drawing itself — pinned to
the row's 32 pt it rendered as a bare accent rectangle with no icon and no label, both themes; it
sizes itself now and the row follows. Its label stays the system's, in the system font — the one
thing on this card that does not speak `FieldType.mono`, and the API offers no way to change it;
the trade is the design's own (§4): the chip exists so paste costs no permanent button, and an
alert per use would cost more than the button did. The design's "preview of the first line" is
out for the same reason — a preview means reading the pasteboard before being asked to.
Interactive dismissal is a swipe on the rail: there is no scroll view on this sheet, and a drag
on the terminal is a selection. The fixture's chips had to move INSIDE the derivation — stamped
beside it they were wiped by the next honest re-derivation, a remote bubble having no agent
facet.

**Absent, not inert (D-i6):** the design's password-prompt chip (decision 8) is not buildable on
the phone at all — it wants the last row's text. **Fixture-only, and it is a fact about the feed,
not the chips:** the bubbles this phone can attach to are remote terminals; the real feed is AR
via IOS-4. **Tests 243 green on the merged tree** (182 → 217 on the branch). **Witnessed** in
the simulator, both themes: the chips row over the composer, the paste chip, the closed row, the
review sheet. **Device-gated:** a real permission from a real agent feed, and a chip tapped
against it.

## IOS-5d (mic rider) — the mic lands in the draft: on-device dictation, never straight into the terminal

**LANDED 2026-09-09, `bac6561d`, merged onto `ios/keyboard` at `63ba79d3`** (one README
conflict; the Swift merged clean against IOS-5c). The composer row's third control, deferred from
IOS-5a because it needs the Speech framework and usage strings; built by a briefed agent in a
worktree in parallel with IOS-5d proper. `Dictation.swift` — `DictationSession`, a `@MainActor
@Observable` over `SFSpeechRecognizer` + `AVAudioEngine`: `start()` asks for speech and then the
microphone (two grants, two sentences — a phone that will not transcribe is a different problem
from one that will not listen), installs the tap and streams partials; `stop()` commits exactly
the text on screen. Recognition pinned to the device wherever `supportsOnDeviceRecognition`
allows; audio streamed buffer by buffer, stored nowhere; no transcript logged. `DictationKey.swift`
— the 44 pt key between the field and Send in the card's chip shape, inverted and breathing on
`FieldMotion.breathePeriod` while it listens. `InputCardModel` gains `appendDictation` /
`replaceDictationTail` / `commitDictation` (the dictated span is character offsets that prove
themselves against the draft on every use, so Send, an edit or `reset()` need no clause of their
own). Two `INFOPLIST_KEY_*` usage strings, both configurations; `PrivacyInfo.xcprivacy`
deliberately UNCHANGED — mic and speech are not required-reason APIs and nothing leaves the device
by default; the server fallback is disclosed in the usage string itself.

**Decisions named at source.** Dictation lands in the DRAFT and never on the wire (a misheard word
that went straight to the terminal would already be a command). The mic is ABSENT from Live's
strip, where the design draws one: Live has no draft on screen, so a mic there would fill a field
nobody can see or type into the terminal, the one thing this control refuses to do (D-i6). The
honest line for a refused grant or an absent recognizer stands ABOVE the row for three seconds
rather than growing the card — the terminal's grid follows the card's height through `onGridSize
→ setViewport`, and a reflow to say one sentence is the wrong trade. `duckOthers` is a courtesy
not allowed to cost the mic. **Tests 261 green on the merged tree** (`DictationTests`, 18 — pure
string rules, no Speech in tests). **Witnessed** in the simulator under `-vf-demo-input-dictating`,
both themes. **Device-gated:** the two permission prompts, a real transcript, partial-then-refine
against live recognition, whether recognition stayed on the device, the zero-channel refusal.

## IOS-5d — the card grows its doors: the `+` menu (scan · snippets · history) and the `⋯` keypad

**LANDED 2026-09-09, `3e46ab07`, merged onto `ios/keyboard` at `59e80ba1`** (two files
conflicted — the README and one doc comment in `InputCard.swift` where the `+` lane and the mic
rider had each described the row without the other; the rest merged clean, including the
project's Info keys). Built by a briefed agent in a worktree in parallel with the mic rider; the
orchestrator reviewed, merged and gated the merged tree. The design's last two pieces of the card,
and both land with their absences named rather than greyed out.

**`+`, at the left of the composer row.** A 44 pt key whose glyph rotates to `×` while its menu is
open, over three items: SCAN TEXT, SNIPPETS, CLIPBOARD HISTORY. A `.popover`, not a system `Menu`
(`Menu` publishes no open state to rotate from, and a `UIMenu` would be the second borrowed system
surface on this card after the paste control). **Scan Text** (`ScanText.swift`): VisionKit's
`DataScannerViewController` in a full-screen cover, tap-to-take, inserting through 5c's
`acceptPaste`; on a device with no scanner — every simulator — the item is still THERE and the
cover says "text scanning needs a camera on this device". **Snippets** (`SnippetStore.swift`,
`SnippetsSheet.swift`): `UserDefaults` under `vf.input.snippets`, an inline editor on the
composer's own `InputTextView` (so a snippet cannot be smart-quoted at the moment it is written),
the `⏎` mark for "sends Enter"; nothing seeded — a shipped alias is the app guessing at
somebody's shell. **Clipboard History** (`ClipboardHistory.swift`, `ClipboardHistorySheet.swift`):
the last twenty strings pasted THROUGH this card, de-duplicated against the ring, fed by
`acceptPaste` and by nothing else — never by reading `UIPasteboard.general.string`, which is the
alert the paste chip exists to avoid.

**`⋯`, the rail's ninth key.** It REPLACES the system keyboard rather than stacking on it, so the
card never moves: Draft swaps the composer field's own `inputView`; **Live rides a hidden
`UIKeyInput` responder (K-D5)** — ghosttea's Metal view is `final` and exposes no input view —
and `abc` gives the keyboard back through `requestKeyboard`'s nonce. Three pages: Keys (named
keys, far ends, arrows, a scrolling F1–F12, the Ctrl/Alt latches), Symbols (thirty punctuation
keys in three rows of ten — fifteen across a phone is 21 pt, and the design's own floor is the
33 pt of an iOS letter key), Combos (`ComboCatalog`: emacs · tmux · readline · screen as ORDERED
keystroke sequences — `^B c` is a control chord and then a plain `c`, because `^B ^C` interrupts
instead of making a window). `keyboardOwner` gains `.keypad`: the keypad up is the keyboard up in
both modes, which keeps the card from folding to its closed row under it.

**Absent, not inert (D-i6).** Photo, Take Photo and Choose File ship as nothing at all (K-D6): a
phone-to-host file wants a mesh verb VibeField has not minted, EL2 keeping bytes off the control
plane. "Record" is not built. While the keypad is up in Live a paired hardware keyboard types into
nothing — the cost of the hidden responder; the one-line `customInputView` petition K-D5 batches
into the next pin bump is the fix. **Judgment calls recorded at source:** a combo SPENDS an armed
latch without applying it (a script has no single key for a modifier to ride); a snippet inserted
into the draft is not recorded in the history (it is already saved under `+`); `PendingPaste` grew
a `commit`, so the review sheet can say "it goes in as one block AND RUNS" over a snippet that
sends Enter rather than 5c's "nothing runs until you press Enter", which would have been the one
lie on this card. **Tests 315 green on the merged tree** (243 → 297 on the branch: the
snippet and history stores round-tripped against a real `UserDefaults` suite, because the encoder
and the key are the half of persistence that breaks). **Witnessed** in the simulator, both themes:
the `+` and its rotated `×` with three items, the nine-key rail, the keypad on all three pages in
both modes, the Snippets and Clipboard History sheets, the scanner's honest line.
**Device-gated:** `|` and `~` from Symbols reaching a shell, `^B c` opening a tmux window, a
snippet with Enter running and one without not running, Scan Text on a camera.

## IOS-5e — the card at every size and to every reader: Dynamic Type, Reduce Motion, VoiceOver, the sweep

**LANDED 2026-09-09, `1f923a30`** (fast-forwarded onto `ios/keyboard`). The last slice of the
keyboard track; nothing here restructures what 5a–5d built. `InputCardMetrics` is the Dynamic
Type rule as pure functions: one step at `isAccessibilitySize` and no ramp — the rail and
composer 44 → 52 pt (the design's own "rail is 52"), every label mono 9 → 11 heavy and never
further (a keyboard's markings are instrument markings: a scaled mono 9 at `accessibility5` is
27 pt and nine of those fit no phone), the fan's keys 40 → 48, the keypad's 38 → 46 in a frame
260 → 312, the chips 32 → 40, the draft's prose 13 → 15; pinned at every size the system has.
Reduce Motion: the `+` does not turn, the mic does not breathe, the fan fades its content in with
its presentation animation off, the keypad's page change becomes a cut; the cross-fades stay.
VoiceOver: `InputAnnouncement` holds the words and the views post them (announcements are
presentation, like the haptics) — "Control armed / locked / released", "Meta armed for the next
key", "Typing into terminal" / "Drafting", "Terminal keys" / "System keyboard"; the rail is a
container, the chips row is "Replies for the waiting agent", CTRL's hint names what the NEXT tap
does, Send says what it sends. The haptic table completed and written whole at the top of
`Haptics.swift`.

**What the sweep found, and fixed — three real defects, none of this slice's own.** A long
single-line draft made the composer demand its intrinsic width and the whole card overflowed
both screen edges (`+` and Send clipped, the rail's ends with them): `ComposerField` now answers
the layout proposal instead of asking, and measures its height against that proposal. The
keypad's `UIInputView` read its text size from a trait collection it did not yet have,
committed 260 pt and then grew 52 pt upward over the rail: the size is handed in from SwiftUI.
The paste-review sheet was still constructed on IOS-5d's default commit, so a snippet marked
"sends Enter" read "nothing runs until you press Enter" over text that SEND then ran.

**The sweep:** 36 iPhone screenshots (18 states × 2 themes), 8 at accessibility XXXL, 4 on a
13-inch iPad, a landscape witness on the phone (`simctl` cannot rotate; `-vf-demo-landscape`
asks the window scene — honoured on iPhone, refused on iPad, recorded rather than hidden); the
720 pt width cap witnessed centring the card on an 874 pt landscape phone. **Tests 315 → 331,
green on iOS 26.1 and 26.5.** The README's "real vs honest-missing" paragraphs rewritten whole as
the track's final state.

## IOS-5 — the keyboard track lands: the input card, complete to its design, on `ios/keyboard`

**Track complete on the branch 2026-09-09 (`9b07fc61` … `1f923a30`, 19 commits, 57 files); NOT on
main — James merges.** One session, one orchestrator, six briefed Opus builders in worktrees
(3c ∥ 5a, then 5b ∥ 5c, then 5d ∥ the mic rider, then 5e), every slice gated on its own branch
and again on the merged tree, every merge conflict read rather than trusted. The design
(`research/mobile-terminal/KeyboardLab/DESIGN-PROPOSALS.md`, final 2026-09-09) is on the phone
whole, in the godview voice: the write key's Keychain home (3c), the composer and the rail with
the sticky Ctrl (5a), the latch reaching the terminal's own keyboard with the fans and the Meta
burst (5b), reply chips from the feed, the paste chip and the closed row (5c), the mic in the
draft, the `+` menu and the `⋯` keypad (5d), and the card at every size and to every reader (5e).
Tests 135 → 331. **K-D1…K-D7 were adopted provisionally to build against and await James's ruling**
(`thinking-ios-keyboard.md` §8.1) — the ones that bind a future: K-D5 (the keypad in Live rides a
hidden responder; the `customInputView` petition batches into the next pin bump), K-D6 (`+` ships
without Photo / Take Photo / Choose File until a phone→host file verb exists).

**What no simulator could witness, and what this entry therefore does NOT claim:** typing into a
serving desktop with a key entered on the phone; Esc, Tab and the arrows landing in a shell; a
three-line draft arriving in zsh as one bracketed block; Ctrl-R then text, Ctrl-X Ctrl-S through
a lock, vim's `Esc :q!`, ⇧Tab, a Meta-arrow tmux binding; `|` and `~` from Symbols; `^B c`
opening a tmux window; a snippet with Enter running and one without not; Scan Text on a camera;
the two dictation prompts and a real transcript; a chip tapped against a real permission (the
agent feed is IOS-4/AR's); every haptic. Each is named at its slice above. **They are James's
device run** — a phone on the tailnet, a desktop serving with `FIELD_NATIVE_TERMINAL_MIRROR_WRITE`
set, the key entered through ENTER KEY. Found on the way and fixed at source: the workspace's
`Package.resolved` had recorded ghosttea 0.9.3 since `cec95a84` while the manifest said 0.10.1.

## IOS-5v — the card speaks VibeField: the canvas's chrome on the phone, godview kept for the field and the terminal

**LANDED 2026-09-11, `62387ead`** (fast-forwarded onto `ios/keyboard`). James, on seeing the
built card in the simulator: *"i dont like this design, the bubble swarm view and terminal does
has their own style, but they are a small part of our app, our app itself should follow
vibefield style, and i think the design in our live artifact is close to what we wanted"* —
and, asked about scope, "focus on the keyboard first". The mono re-skin was the orchestrator's
decision (K-D7, now REVERSED at source in `thinking-ios-keyboard.md` §8.1), not the design's.
DESIGN.md §1.1 had already said it: the godview instrument palette is "the deliberate
control-room exception", scoped to the agent stage and the terminal deck. So the swarm field and
the terminal surface keep `FieldType`/`FieldPalette` untouched, and the input card and its sheets
become the chrome family — §1's second surface family, §2's opacity ramp and hairlines, §3's SF,
§4's radii and round pills, §5's ambient shadows — as the KeyboardLab canvas draws it. D-i2 is
scoped accordingly in `thinking-ios-app.md` §4. **Visual only:** no behaviour, state machine,
act, fixture or launch argument changed; the two copy changes that reached data are sentence
case (§9) — the reply chips' labels with the keystroke as its own numbered circle, and the
keypad's page and pack names.

**The token set** (`FieldDesign`, four files, every value carrying the DESIGN.md section and the
canvas class it came from): `ChromeType` (SF at the canvas's steps; the key label is the one
place `ui-rounded` is used; mono is for DATA only — command text and a key's name in a fan or a
combo), `ChromePalette` (every token a light/dark pair: dark transcribed from the canvas, light
DERIVED by DESIGN.md — white chrome material, black/5–8 hairlines, the opacity ramp in black,
every inversion swapped whole — and matched by eye in both themes), `ChromeMaterial` +
`ChromeRadius` + `ChromeShadow` (the glass card, key cap, circle, floating surface and well;
card 26 · key 9 · keypad key 7 · chip 18 · pop 14 · menu 18 · well 12 · pill round),
`ChromeControls` (§3's eyebrow and §4's round pill in two weights). Re-skinned, every file:
`InputCard`, `ComposerField`, `ChipsRow`/`ReplyChips`, `ClosedRow`, `PasteChip`, `KeyPopover`,
`PlusMenu`, `DictationKey`, `TerminalKeypad`, `SnippetsSheet`, `ClipboardHistorySheet`,
`PasteReviewSheet`, `ScanText`, and FieldHome's `WriteKeySheet`. `FieldType`/`FieldPalette` no
longer appear anywhere in `FieldInput` — grepped, and the grep is the test. `InputCardMetrics`
keeps its one accessibility step and moves only its floor to the canvas (labels 13 → 15, the
field 17 → 20, chips 36 → 44, keypad keys 42 → 50); one test added pinning the base sizes to
`ChromeRadius`.

**Judgment calls, recorded at source.** The glass gradient is a dark scrim in dark mode where
the canvas's is white — a CSS backdrop-blur changes only sharpness while `.ultraThinMaterial`
adds vibrancy, so the canvas's white on top gave a milky panel (witnessed); set by measuring both
renders. The chips ship as plain glass with no `--vf-orange` tint: the row exists only while an
agent waits, so the tint would say the same thing twice and spend the one colour that means
something. Send with an empty draft is `.circle.quiet` (the canvas's own Main artboard), not
`.dim` — that faint reads disabled, which it is not. The strip carries no right-hand hint: the
canvas defines one in CSS and uses it in no artboard. `UIPasteControl` ignores a translucent
fill (witnessed), so that one chip gets a solid at the pill's resolved value with our hairline
over it. **Tests 331 → 332 green; 36 screenshots across 18 states in both themes read beside
the artboard renders.** Still James's: the rest of the phone's chrome (the session card's
header and affordances, the settings sheet, the mesh sheet) is godview mono today and waits on
his scoping; every device gate from the IOS-5 entry is unchanged by a re-skin.

## IOS-6a/6b — the field's model and physics catch up with RFC 005: the body model, the ledgers, the fixed step

**LANDED 2026-09-13, `2ac90328` on `ios/swarm`** (branched from `ios/keyboard` `a3b8a7ec`; James
merges). The plan is `draft/thinking-ios-swarm.md` (D-i11…D-i17, §4's slices). Two slices in one
commit because `SwarmParameters` is the seam both need: the locked defaults (idle 50 · working
60→80 by the session's share of the working sessions' tokens · blocked 50 · 30 Hz · fill 0.72 ·
the light's 34/0.8/0) retire the July radii the old classifier read. **6a:** `AgentVisualStatus`
is core's `idle · working · blocked` (the July off-by-one `bubbleVisual`/`AgentBubbleAppearance`
gone; a question or a failure blocks like a permission); `AgentRuntimeState` grows a SUBSET of
puppeteer's monitor mirror, names kept (`usage` + samples, `effort` + intent, `lastAssistantMessage`,
`blockers`, `statusSince`, `lastEvidenceAt`) so IOS-4's binding is a mapping; `SwarmBodyModel` =
the reference's `bubble-model.ts` transcribed whole (the five drawn states, the copy lines at the
reference's sizes, the figures, the ring, the flood/hollow/comet, the watermark, the accessibility
copy, the peer's host line said both ways per puppeteer `5389449`); `TextLayout`, `BurnBars`,
`UsageLedger` (30 s × 20, the hold rule, the grace, the spread, export/seed), `UnreadLedger`,
`ProjectTint` (OKLCH along the golden ratio with the withheld band and the gamut clamp — goldens
generated from the TypeScript under Node 26), `ProjectLedger` + `PaneColourLedger`, `SwarmColor`;
`FieldBubble` carries the row facts and `FieldAssembly` folds the ledgers per projection, dealing
the phone's ONE pane (the card, D-i12) and every project a colour (D-i13); the mock fleet burns
along the lab's four shapes, wears an effort, replies, asks, fails, and stamps the clocks.
**6b:** `SwarmWorld.advance(now:)` — the reference's accumulator (floor 15 Hz, air-friction ceiling
0.2, both clamped at every entry, the 100 ms stall cap, five steps a pump), every state's last two
solved positions for the blend, `syncAgents` reporting membership, `queryPoint`. **Tests:** FieldAgents
25 → 89 and SwarmPhysics 11 → 24, the reference's suites transcribed (values unchanged); the whole
kit 408 green; the app shell builds.

## IOS-6c — the swarm on Metal: the reference's renderer transcribed, and the lab that shows it

**LANDED 2026-09-13, `0ba7a6a8` on `ios/swarm`.** A new target `FieldSwarm` (D-i11): the six
shaders transcribed from the reference's WGSL line for line and shipped as RESOURCES that compile
at first use (D-i14 as built — one source, no twins, no plugin; 1,073 ms for the five on the
simulator, whose compiler is not a phone's), `SwarmRenderer` (the same five pipelines in painter's
order, the same 40/44/16-float layouts and flag bits, one upload a frame, three buffer sets in
flight), the glyph atlas (CoreText at the screen's scale into an `r8` shelf-packed texture; the
folder, dot and bar from CoreGraphics paths into the same atlas), the mark atlas (the reference's
`marks.png` byte for byte, its twenty-tile table), `SwarmTheme` (resolved from `FieldPalette` per
scheme, never a second transcription), `SwarmStage` (`AgentSwarm.tsx` without React: the blend
between the last two solved states, the radius spring at ω 16, the four-segment arrival curve, draw
order, hit testing, drag / tap-and-nudge / hold-to-create, VoiceOver focus → the focus ring),
`SwarmMetalView`, the SwiftUI `SwarmField`, and the design lab behind `-vf-swarm-lab[=section[:page]]`
(D-i15): the reference's fixture stages on the production renderer, paged six a surface after one
surface for the whole grid crossed the 8,192-pixel texture limit at 3×. **Two defects the gate
caught:** `vertex` is a reserved word in Metal and the transcription used it as a parameter name
(the compile witness), and the atlas's `sprite` shadowed its own `size` with the sprite's, putting
every mark's UV off the texture (the first screenshots — no dot, bar or folder anywhere).
**Witnessed:** `FieldSwarmTests` 16 rows (the mark table, the theme's pairs both schemes, the packed
flags per state incl. the light only on the open card's body, the flood's ink, the frame's hold,
the graph band, the arrival curve, the spring's landing and snap, draw order and hit test, the hold
timer, and the five shaders compiling and the atlas measuring on the simulator's device); the lab
screenshotted on the iPhone 17 Pro (26.5) simulator, both themes, every page.

## IOS-6d — the field goes live: the home screen mounts the swarm on Metal, the July views retire

**LANDED 2026-09-13, `360cf8c9` on `ios/swarm`.** `HomeScreen` mounts `SwarmField` over rows
dressed by `FieldAssembly`, folded on every change of the feed, the card's subject and the colour
scheme (the project ledger cached per device); the July field (`SwarmFieldView`, `FieldBubbleView`,
`IgnitionView`, `DisplayLinkDriver`, the grid canvas) and the tokens only it read are deleted, not
kept in parallel. The README is rewritten for the port. **Witnessed:** the whole kit 424 green;
the live field screenshotted both themes over the mock fleet, with the peers' hollows
(`-vf-demo-remote`) and with the card open (`-vf-auto-open-card` — the subject's body lit in the
pane's colour). **Owed to a device (the README says so on screen):** the shader compile at first
use, the feel of 30 Hz physics under a 120 Hz blend (`physicsHz` is a parameter), the type at 7 pt
on a real panel. **Not in this track, recorded as deltas:** no panes beyond the open card
(D-i12), no hover (the title is the VoiceOver label and the card's header), the project colour
dealt per device until a fieldd door carries the sequence (D-i13).

## IOS-6 — the swarm on Metal lands: the phone's field is RFC 005's, on `ios/swarm`

**2026-09-13.** Four slices (`2ac90328` · `0ba7a6a8` · `360cf8c9`), the phone's port of the design
pass the desktop consumed at AR-5, built as a TRANSCRIPTION of puppeteer `packages/views`'s swarm
(design locked 2026-09-09; the 2026-09-12 pane-colour revision; the host line of `5389449`) rather
than an import: every constant, every branch of the body model, every line of the six shaders
carried across and pinned by the reference's own tests. D-i11…D-i17 are adopted provisionally —
James rules; DECISIONS rows follow. **The base branch is James's call** (§6 of the plan): `ios/swarm`
is cut from `ios/keyboard`, so it lands on main after the keyboard track does, or as one merge with
it. **The record:** `draft/thinking-ios-swarm.md` §9 is the landing log.

## IOS-TF — the phone reaches TestFlight, and the keyboard and swarm tracks land on main

**2026-09-13, `168548c4` (IOS-TF) + `09c526ab` (the merge) + the docs commit after them.** James:
"all the new changes merge back to main properly and build and upload latest build containing all
the latest changes to TestFlight." **The finding that started it:** TestFlight build 0.1 (1), set up
that morning from main's working tree, carried the PRE-IOS-3c app — main's `apps/ios` had no commit
since the fork point `0bef361b`, `ios/keyboard` (22 commits) and `ios/swarm` (4) were both unmerged,
and the notes said so themselves ("IOS-3c has not landed", 135 tests); the archive log had no
`FieldSwarm`, no write-key store, and the July views still compiling.

**What landed.** James's TestFlight setup committed as IOS-TF (the helper `scripts/testflight.sh
archive|upload N` with the Xcode 26.6 `-disable-large-loadable-types-reg2mem` workaround, the export
options, the privacy manifest's three reasons, the icon, `ITSAppUsesNonExemptEncryption` removed so
compliance is answered explicitly). Then `ios/swarm` merged — one merge with the keyboard track, the
base-branch question ruled: `README.md` conflicted in two hunks against the TestFlight edits and the
branch's rewrite won with the TestFlight paragraph kept; `project.pbxproj` merged clean with both sides
(the camera/microphone/speech strings in, the compliance key out); `Package.resolved` the branch's;
`docs/LANDED.md` main's run before the IOS entries. The branch had first taken main (`55335736`) so
the kit is byte-identical to the tested tree, plus a README pin errata (`92c014ec`).

**Gates on the merged tree:** the README's kit gate verbatim — 424/424 across seven suites, TEST
SUCCEEDED — and its simulator build, exit 0; the helper's Release `generic/platform=iOS` archive of
build 2 succeeded: `VibeField-2.xcarchive` carries the bundle id and team, 0.1 (2), the six `.metal`
sources and `marks.png` in `VibeFieldKit_FieldSwarm.bundle`, the three usage strings, no compliance
key, and `codesign --verify --deep --strict` passes.

**NOT done — the upload.** `-exportArchive` stopped at the account step twice, sandbox on and off:
"Failed to Use Accounts — failed to find an account with App Store Connect access for team
9F79X9D26S", two hours after build 1 uploaded with the same helper and the same Apple account. Xcode's
sign-in is James's; the archive persists and `testflight.sh upload 2` finishes the job, then the
compliance answers and the Personal iPhone assignment in App Store Connect. **Records moved:** the
roadmap row rewritten and its two IOS-3c claims corrected at source; DECISIONS gained the
D-i11…D-i17 row and the base-branch ruling; TESTFLIGHT.md carries build 2's state and the product
limits as they now are. **Still a device's to answer:** the shader compile at first launch, 30 Hz
physics under the 120 Hz blend, the 7 pt type, VoiceOver per body, the tab bar as an obstacle.

## MF-1 — the Godview and its phone, first: the frame upstream, the field's wire shapes, the fold in the deck, the phone's client and store reader (2026-09-13)

**The ruling that opens the wave (James, evening 2026-09-13):** *"land the Godview and its mobile
connected experience first"* — the desktop reads as puppeteer's Godview, the phone's field hears the
desktop's monitor state efficiently, and the phone attaches to any active terminal in the desktop
Godview over truffle. The navigation is `draft/thinking-godview-mobile-first.md` (three witness runs
W1–W3; the track-by-track state; slate GM-D1…D9 — **GM-D3 RULED (a) the frame's home is upstream;
GM-D4 ADOPTED (c) the hybrid: truffle's synced store carries a content-free field projection, the
product API carries content on tap and every verb**). AR-6's plan stands; its stop verb left it as
AR-6-0 and landed here.

**PU-14 — the pane frame becomes the views package's (puppeteer `aa34eb1`, pinned by `fdb421b4`).**
The reference's frame (record §07: the badge growing out of the top edge with the provider mark, the
`model · effort` readout, the context meter with its figure, the ghost verbs stop / resume /
fullscreen, the safe areas, the narrow rules) was app-side in `apps/godview/src/renderer/deck` — not
in `@vibecook/puppeteer-views`, so AR-5 did not bring it. It moves into the package behind a
host-neutral facts type (`PaneFrameAgent`: provider id and label, the status word, liveness,
statusSince, project, model, effort with its intent, the context share a host could vouch for) and a
verbs PORT (`PaneFrameVerbs`: stop answers whether the interrupt was delivered; resume; zoom; the
zoom binding's label — each optional, and a verb a host did not lend is not drawn). `PaneFrameChrome`
is the markup, pure over its props, so a host's static tests and catalog render it without a pane;
`PaneFrame` is the portal into Ghosttea's pane element with the stopping state and the narrow
attribute; `DeckFrames` follows the panes through a mutation observer, ticks the clock while a
mounted agent works, marks the deck `vf-deck-framed`, takes a `frame` slot for hosts whose facts
need hooks and a `zoomedPaneId` override for hosts that own their zoom. The stylesheet is
`./styles/deck-frame.css` — the app's deck.css rescoped to `.vf-deck-framed` (13 rules), an opt-in
export beside `views.css` so a host without frames gets no pane padding. The reference app consumes
it through `deck/pane-frame-host.tsx` (its facet → the facts; the verbs over its IPC; the remote
device name from Ghosttea's lifecycle) and deletes its own copies. Gates upstream: views 20 files /
149 tests (from 18 / 133) + typecheck; the app 32 / 196 + typecheck; `packages:check` clean; the
root `pnpm test` exit 0; `pack:check` exit 0 (the tarball ships `deck/*` + the stylesheet); the
app's Electron smoke SMOKE OK under `GHOSTTEA_TRUFFLE_ENABLED=false` — with Truffle on, ghosttead
times out headless behind the sidecar's tsnet login before the renderer loads. Here: `pnpm
siblings:pin` → `aa34eb1` (`b0f08ec` + one commit; rosetta unchanged `e8d907a`), preflight OK,
field-app typecheck green at the new pin — commit `fdb421b4`.

**Probe (GM-D4's gate): truffle's bench on the real tailnet, two nodes on this host** — synced store
B1 sequential, 200 writes: convergence 28 ms, the peer held all 200; request/reply 1 KiB × 200: p50
0.29 ms · p99 0.56 ms · 0 timeouts (same-host caveat: no DERP, no cross-network hop).

**Lane A — the field's wire shapes, the projection, the store slice, the stop verb (fieldd; `2f331dbb` contracts · `baa750ce` projection · `cb6da52b` publisher · `4f25ce16` `agent.interrupt` · `256f559b` liveness, as landed on main).** `packages/contracts/src/agent-field.ts` carries §10.1 verbatim — the CONTENT-FREE `AgentFieldRow` (no reply text, no blocker input or questions, no title, no mirror; a blocker's `tool` read from Core's `permission.tool`), `AgentSubscribeParams {projection, minIntervalMs}`, the snapshot/delta pair (`since`/`revision` chain), `AgentFieldSlice`, the interrupt and grant shapes; `STORES.AGENT_FIELD = field.agents.v1`, the 64 KiB slice cap on both planes (the floor's cap table, `registries.rs` via `gen:rust`), `AGENT_FIELD` limits, the two method rows; six fixtures incl. the refused interrupt. `packages/fieldd/src/agent-field.ts`: `projectFieldRow` (`AgentFieldRow.omit({revision})` — one authority, no retyped shape) with a per-row revision that moves only when the PROJECTED JSON changes (an idle board sends nothing — asserted); `agent.subscribe {projection: "field"}` answers a field snapshot then deltas at a per-subscriber trailing-edge floor, the desktop's `full` stream untouched; `agent-field-publisher.ts` writes one slice per device through the floor's store door at ≤4 Hz, a heartbeat refreshes `expiresAt` while rows exist, dispose publishes empty, mesh-down is quiet. `agent.interrupt` = the floor's interrupt on the run's OWN PTY, refused NOT_FOUND / `not-alive`, audited `agent.session.interrupt` (outcome `succeeded`/`denied`+REFUSED — `AuditOutcomeV1`'s vocabulary, the floor's raw word in attrs). **Liveness (a ruling the golden forced):** a PENDING row is alive while the floor hosts its PTY — `alive` answers "is this agent still there", `pending` "is anyone at the wheel"; the goldens moved to say so. **The gate fact that does not exist:** the floor keeps its terminal-mesh state as prose in a unit `detail` (`services/terminal.rs:1030`), the hello carries none, fieldd reads no unit stream — so the publisher gates on the neighbouring consent it can see, the product serve being active (`daemon.ts:1603`, the same fact `DeviceService.productEndpoint()` uses); one call site to change when the hello grows a typed fact (NF-8). Found on the way: `managed-session-fixture.ts` builds a blocker with `tool` at the root (Core nests it — the AR-6 §0 defect, now proven by a producer-side test); `terminal-service.ts:645` raises INTERNAL instead of the typed `unknown-session` when an automate precedes the inventory's cell tag (pre-existing, shared with paste/text; the interrupt test waits for the tag). Tests: contracts 25 files / 457; fieldd 82 files / 794 passed / 14 skipped, twice (one lottery row in one run, `agent.providers lists what one can spawn as`, green alone and in three other runs); `agent-field` 20 + publisher 8.

**Lane E — GT-6, the deck wears the record's frame (`c2b6d71c` as landed, the review's `15e746e7` · `980bc8e6` · `9b652ff4` · `510dfaec` after it; 22 files, +2409 / −308).** **The fold lifted:** `GodviewAgentsProvider` (new) owns the window's ONE `agent.subscribe`, mounted by `GodviewOverlay` over the door the deck publishes upward and gated on the overlay being open (PF6: a closed Godview holds no subscription; the lifetime fixture shows `no-door` closed, `live` reopened); `useAgentFold()` → `{rows, byTerminal, state, reason?}`; `useMonitorAgents` consumes it as a pure projection, every monitor claim unchanged; two contexts on one subscription — the monitor takes the broad fold, the deck a NARROW value keyed on the fields a frame draws, so a working agent's usage revisions never re-render the workspace at the 16 ms tick; the join is `hosted: "local"` only (a remote row's session id names the peer's floor, GT-5c). **The projection** (`pane-frame-facts.ts`, pure): the fold row → `PaneFrameAgent` — `unknown` → idle, no monitor → no facts (the bare badge), not-alive rows KEPT (the monitor's classifier drops them; the deck must not), effort and `percentageSource` read tolerantly off the mirror's passthrough, the project named by the same chain the monitor uses. **The deck:** the package's `DeckFrames` inside the zoom host, pane colours joined session → pane, `zoomedPaneId` from the deck's own morph (ghosttea's `is-zoomed` is not the truth here), a stable `frame` slot adding the remote device name, `--vf-godview-terminal-ink`/`-bg` published from the terminal theme's ground so a viewer's palette moves the frame. **Verbs:** stop → `agent.interrupt {runtimeRunId}` read tolerantly (only `accepted === true` is a delivery; refusals logged, never drawn as done); zoom → the deck's morph by pane id, labelled ⌘⇧↵ / ⌃⇧↵; resume → `agent.resume` → the answered create ticket adopted → `mountSummaryNow(born.session, replacing)` extracted from the door's hand-over (AR-4b's, sharing `mountQueue`, so a resume and a replacement cannot race for the active pane; a manual resume of an EXITED run sets no `terminal.replaced`, so the monitor's remount effect does not double-fire). **The stylesheet:** `@import "@vibecook/puppeteer-views/styles/deck-frame.css"` after godview.css (order asserted); VibeField's own pane badge, its outline variant, the active line/glow and the divider rule DELETED from `godview.css` (605–632 at `fdb421b4`), `.ghostty-pane-access` loses its `top` (the package centres it in the band) and keeps its colours; VibeField never set pane padding, so the record's safe areas apply with nothing to fight. **The one deviation, flagged for James:** `describePane`'s exit faces move to the badge's bottom-left over the meter track (ghosttea's own badge sits at the top-right the frame's badge now owns — a guaranteed collision); a live pane still says nothing. Tests: field-app 89 files / 757; electron-shell 69 files / 679 passed / 2 skipped; the eight touched files 110 (facts 10 · deck-frames 9 · provider 8 · monitor 15 · remote-door 17 · boundaries 13 · design-system 6 · deck 32); typecheck green; smoke row 1c added (`vf-deck-framed`, `.vf-pane-frame` with a non-empty `.vf-pane-name` on the active pane, `paneFrameNarrow` absent) — run at landing. **Owed, found here:** the resume verb is mostly unreachable until the fold keeps an exited run's row while its PTY is on the floor (`agent-runtime.ts:720`, `:2029` — MF-1f); the glass-vs-record gap (§07: the DECK tints the sheet at 82 % and no pane has a ground; VibeField tints each PANE at 82 % with no deck tint and `stageBlur` 0 — the gaps between panes and the active pane's corners show the canvas) is a one-line design decision for James's eyeball; VibeField exposes no `--vf-terminal-safe-*` tunables (the record's fallbacks are in force).

**Lane D — the floor mints its own mirror-write capability; fieldd grants it (`d205548b` MF-2a · `29c9aa42` FD-2 as landed).** `config.rs` `ensure_terminal_mirror_write()`: terminal mesh ON and `FIELD_NATIVE_TERMINAL_MIRROR_WRITE` unset ⇒ 32 random bytes as 64 lowercase hex, persisted 0600 at `LAYOUT.TERMINAL_MIRROR_WRITE_FILE` (`native/terminal-mirror-write.key`), read back on later boots; the env wins and writes nothing; mesh off mints nothing; an empty file is re-minted (a truncated write must not hand WRITE to a viewer supplying ""), a loose mode is re-hardened, a hand-written value is honoured; never fatal (a floor that cannot write keeps serving view-only and logs the PATH). Called at boot before `build_units`, so `offers_mirror_write()` is true for every serving floor; the compare stays upstream's constant-time one (ghosttea-truffle 0.11.1 `access_for`). The mgmt verb `native.terminal.mirrorWriteCapability {}` → `{configured, capability?}` behind the pairing gate (its row and shapes in contracts' mgmt registry; not in the typify bundle, PingAck's precedent). fieldd: `terminal.mirrorWriteGrant` on `terminal.attach`, audited `capability.mirror_write.grant` (the plan's hyphen is illegal under `AuditActionV1` — erratum at the source; the hyphen lives in the audit target id), attrs `{deviceId}` + the principal, never the capability; unconfigured ⇒ `UNAVAILABLE {service: "terminal", state: "no-mirror-write"}`; the ask sits INSIDE the audited effect so a refused grant still ledgers attempt + outcome. **Walls, each beside a control:** guest → FORBIDDEN_SCOPE (UA-4's choke); peer-fieldd → FORBIDDEN_SCOPE `{locality: "local"}` (D36) while the same connection's federating `device.list` passes; a scopeless token → `{required: "terminal.attach"}` while a scoped one is served; a self peer (`ios` clientKind, the stored login) reaches the handler. **A ruling taken on the way:** `plugin` and `mcp-agent` principals are refused before the floor is asked (attempt ledgered) — `terminal.attach` is plugin-eligible for the terminal pool, and attaching to a PTY is not the power to hold the tailnet's write credential. **The joint:** one row spawns the REAL floor with `FIELD_NATIVE_TERMINAL_MESH=1` under a real fieldd and asserts the granted string is 64 hex and byte-for-byte the 0600 file; EL7's row scans every regular file under the daemon's root after `stop()` for the canary with the ledger and log asserted non-empty. Tests: `mirror-write-grant` 10; fieldd whole package 776/14 skipped (three runs); field-native 250 passed / 6 ignored; clippy + fmt clean; contracts 457. Landing: the contracts commit had pinned the row as NOT_FOUND "until G4 lands" — retired at landing (59 passed over both files).

**Lane C — IOS-4a, the phone speaks the product API and reads a synced store (`24f9dc92` · `84eb1d12` · `b7aa8009` · `8ac1654d`, as landed on main by `7f2915e2`; kit 424 → 504 tests, green twice; the app builds; the pbxproj untouched — `FieldProduct` reaches the app through FieldHome → FieldMesh, 1,735 symbols in the debug dylib).** `Sources/FieldProduct/`: `FieldProductClient` (`@MainActor @Observable`, the TS client's shape and its three ordering lessons — the route installed before the caller resumes, a stale-socket generation guard, one reconnect timer), `RpcCodec` + `JSONValue` + `WireObject`, `ProductTransport` + `URLSessionProductTransport`, tolerant readers for `HelloAck`, `DeviceInfo`/`DeviceListResult`, the narrowed full agent row and every §10.1 field shape; states `off · connecting · ready · reconnecting · closed · failed(reason)` (a radio that wandered off is a different face from a first dial); a per-call deadline; the door's own refusal outlives the socket close that follows it (a real defect the test found — hello's `UNAVAILABLE {service, state}` was being overwritten by "connection closed" a beat later). Closed enums ride as raw strings with folded accessors (a fifth status upstream is `unknown`, never a failed parse); `contractsVersion` is a hand-pinned constant (the app is outside `pnpm verify`). `Sources/FieldMesh/FieldStore.swift` + `FieldStoreDoors+Mesh.swift`: the synced-store READER over `GhostteaTruffleRuntime.node` — `onMessage(namespace:handler:)` (the plan's `subscribe(namespace:)` does not exist; the subscription handle is held weakly by the node and is retained in the stream's termination), `request` to every online peer at start, `update|full` applied when `version` is newer per device, `clear` and `.peerLeft` (observable through `node.events`, which ghosttea's wrapper flattens away — the doors read the node) remove the slice; the two keyspaces kept apart (`FieldStorePeer.id` routes, `deviceId` files, RFC 017 §8's durable ULID); `attributionMismatches` COUNTS a slice whose payload names a device the sender is not (a counter, not a guard, until a live mesh is watched). `b7aa8009` stands a real RFC 6455 listener on 127.0.0.1 with Network.framework and drives the transport through it — handshake, hello from the contracts' golden, a call, a subscription's snapshot and delta as text frames, a server hang-up answered by a re-dial and a fresh snapshot, a control at port 1 reaching `UNAVAILABLE`/retryable/`reconnecting` (a mutation control on the expected `serverKind` reds). `8ac1654d` swaps the hand-authored field fixtures for the contracts' goldens (byte-identical copies; the delta is checked against the snapshot it was cut from; slice and snapshot agree on the board; `"branch": null` from a real row; the NO-CONTENT wall asserted on the GOLDEN, not only the Swift type) and adds `AgentInterruptResult` and `TerminalMirrorWriteGrant` readers (the capability redacted from `description`, `Equatable` hand-written beside it, a test that the rendering never contains it). **Found upstream (TF-1, petitions):** truffle 0.7.12 clears a departed peer's slice by the Tailscale node id against the ULID-keyed remotes — a peer going offline never drops its slice; the phone's reader drops it anyway. **The live probe is not reachable headless** and none of its three blockers is this lane's: ghosttea's Swift runtime hardcodes interactive auth (no authkey path; a launch-argument key would mint a real device on James's tailnet, which the README already forbids); no desktop was serving; both floor flags default off. The witness is James's Phase 0: a serving `pnpm dev` with `FIELD_NATIVE_MESH=1 FIELD_NATIVE_TERMINAL_MESH=1` and a phone taken through the Safari sign-in by hand.

**Lane C, second slice — IOS-4b, the field is the daemon's (`03b3554d` the goldens re-copied after MF-1e moved them · `5a46c163` FieldLink and the feed; kit 504 → 543 tests, green twice; the app builds; simulator-witnessed both themes).** `FieldLink` (in FieldMesh — the one module that sees both vocabularies, so the projection that makes bubbles learns no wire type and the whole join runs headless): the mesh node up → `field.devices.v1` names every desktop with its `productEndpoint.url` → one `FieldProductClient` per desktop that has one, `system.hello` with no token → the board from `field.agents.v1` where the floor publishes it, and over `agent.subscribe {projection: "field", minIntervalMs: 250}` where it does not (the store leg wins wherever it has a live slice — the floor's own publication, one publisher tells every phone; a door subscription once open stays open so a slice that expires and returns does not tear it down; a mutation control on the precedence reds one test). A desktop on the mesh that publishes no endpoint is NAMED and not dialed (`noDoor` — "on the mesh, not serving its product surface"), distinct from a door that refused (its own words, wants attention) and from one still dialing. The fold obeys AR-D4 by REPRODUCING: the row's `status` is the word fieldd derived, the phone's classifier is shaped to return it (a board that says blocked with no blocker draws blocked). Background: door subscriptions and both stores' streams stop on a real `.background` (not `.inactive`, which is transient and would flap), the node and the sockets stay; `FieldStore.pause()` keeps its slices and `expiresAt` decides whether a kept board is still true. A row whose provider has no mark is counted `undrawable` and not drawn (ruled after: the record's letter fallback applies — IOS-4c). `-vf-demo-field-slice` mounts the golden slice through the REAL reader and fold (a fixture store, not a demo path); `MockAgentField` retired to `-vf-demo-fleet` and the lab; a phone with no mesh shows NO ACTIVE AGENTS with the mesh chip. Method note: a screenshot gate that picks its binary by `ls | head -1` sorts alphabetically and can install a seven-hour-old app — captures now come from a pinned derived-data path with the app uninstalled first. Owed: IOS-4c (the walk from `runtimeSessionID` to the hosts store's row and the attach; the "terminal not published" face; the exited face with RESUME), IOS-4d (the grant call + Keychain write; the sheet's "get it from studio"), the letter fallback, `agent.projectSeqs` (held, D-i13 stands).

**Lane A, follow-up — MF-1f, the fold keeps an exited run's row while its PTY is on the floor (`cf8a5d64` as landed).** `ExitedEntry` + an `exited` map with two provenances and one row: kept when THIS fieldd watched the exit (the card keeps the mirror and the clocks), record-only after a restart (`status: unknown`, `observationLevel: none`); `holdExited` at the close takes the floor's own listing as the only evidence a pane exists; the inventory pass keeps a listed husk and arms the same grace for an unlisted one; `reattach` re-lists an exited record whose PTY the floor still lists, never one already continued into a successor; the field projection carries it as `alive: false`, no `pending`. **Two defects the rule forced into the open, both fixed:** `agent.resume` refused `terminal-alive` for exactly this row (the guard asked whether the TERMINAL was listed; it now asks whether the RUN is alive); the ordinary resume never stamped the record as continued (only `replacePending` did), so a second resume forked one native conversation into two runs — the state AR-4b forbids — and a later boot would have re-listed the dead pane beside its successor; `resume` now stamps `reattach {state: "resumed", replacedBy}`. One additive contract field: `continuation.exited?: boolean` — once `terminal.hosted` stays `local` for a dead run it is the only field that says the conversation stopped, and the projection reads it FIRST (a witnessed exit outranks a mirror's `alive` still in flight). **The finding that decides visibility (measured):** agent PTYs are created `keep-until-exit` (`terminal-service.ts:630`) and leave the floor within 150 ms of the exit, so under that policy the exited pane can never be an agent pane — MF-1g (below) takes the record's behaviour. Tests: fieldd 83 files / 809 passed / 14 skipped after the rebase (one lottery row under load, `service-drain-deadline` "shares one deadline…", 2/2 alone); contracts 458; the field unit files 29; `pnpm lint` exit 0 (main's hygiene commit cleared the four).

**Lane A, the persistence ruling — MF-1g, an agent pane outlives its run (`22fa81a1` as landed) and MF-1h, the field's tests bite (`5679751f`).** Until now an agent's PTY was born `close-on-exit`, so the fold's exited row (MF-1f) had nothing to be hosted by: the run ended and the pane, its final screen and the resume verb went with it. The ruling, taken to keep going and FLAGGED FOR JAMES (one literal at the agent-class create in `terminal-service.ts`): agent terminals are `keep-until-explicit-close` — a run that ends, or is killed out of band, leaves a readable pane with its last screen; the row is exited, hosted, resumable, keeps its title and its last mirror; the field projection says `alive: false` with no `pending`; closing the pane withdraws it; a restart finds the dead pane and re-lists the row from the record alone. Resume births the successor FIRST (its ticket minted, the record superseded, the exited row dropped), then terminates the husk — so a resume that fails leaves the dead pane where it was, the successor's row carries `terminal.replaced = <husk>` (AR-4's hand-over shape, exactly what the deck's resume verb reads to mount the new PTY in the same pane), and the terminate lands before the door answers, the ordering AR-4b already proved for `replacePending`. Persona login panes are born through the same create and would have stood as husks forever: `finishLogin` closes one on exit, a timed-out login pane (still live, a person may be typing) is left alone and reaped when it ends. Named consequence: dead agent panes hold floor session slots until someone closes them, against `TERMINAL_SESSION_CAP = 100` — twenty finished agents on screen are twenty slots. Not weakened: no kill-matrix row (`terminal.create` keeps the interactive default), GT-D11 re-governs only an ownerless birth. The MF-1f rows were rebuilt on the product's own path (no test-owned pane, no re-pointed record); two goldens (`agent-spawn`, `agents-profiles-login`) now read the new class. MF-1h answers lens 5: a daemon-level publisher witness (a real fieldd over the mock mgmt server, the fold made non-empty through MF-1f's restart path from a signed exited record; the first draft did not bite — `notifyServingChanged()` also schedules a flush — so it ends on a fold change nothing else delivers, the pane's cell tag, instant rather than behind the 1.5 s grace; deleting `agentField.start()` or the serves-changed hook reds it); the content wall an ALLOWLIST from `AgentFieldRow.shape` (a maximal summary projects to exactly the contract's keys minus `revision`; a `transcript` field reds it and leaves the old denylist green); golden parity (the union of the golden's keys equals the contract's set and every key the producer can emit appears there — dropping `profileId` reds it); a door-level row on the real floor (a live row `alive: true`, a still board silent, the interrupt exactly ONE delta chained `since === snapshot.revision`, every wire key in the allowlist; found on the way: a subscription's frames ride as `agent.delta`, the base dropping `.subscribe`). Counts at `5679751f`: fieldd 84 files / 815 passed, 14 skipped (the builder's run; the final tip's is below); contracts 458.

**The six-lens review (read-only Opus worktrees cut at `c2b6d71c`, lens 4 extended to `5a46c163`, lens 6 on puppeteer `aa34eb1`; briefs at the plan's §12) and the fix wave (lane A `22fa81a1` MF-1g · `5679751f` MF-1h · `76cd2a5c` MF-1i · `2525f480` MF-1j · `d39db4a1` MF-1k (the wire row waits for a settled board — the final gate's one red, a precondition assumed under load); lane D `090e25b5` FD-2b · `1587b9c7` MF-2c · `da0832d5` MF-2d · `2388e28d` MF-2e · `b1e330f7` MF-2f · `8a448522` MF-2g · `2aa57e52` MF-2h; lane E `15e746e7` · `980bc8e6` · `9b652ff4` · `510dfaec`; the phone `74c70dd6` IOS-4c-0 · `3e18debe` IOS-4c/4d · `a39c9ba5` IOS-4c · `ac4a291c` IOS-4d · `fcff4a26` the IOS-4a review fixes · `42938f43` IOS-4f · `cecdd268` IOS-4g · `bd2acc04` IOS-4h · `b22344d9` IOS-4e · `97826e2d` IOS-4e′ the corner (a comment-only errata commit follows); upstream PU-14b `73b2d64`, pinned `cfcd951c`).** Every finding graded with a probe where one was cheap; the ledger is `scratchpad/mf-review-findings.md` (dev-local). What the lenses found, and what became of it:
- **fieldd (lens 1: 0 blocker · 3 major · 10 minor).** The store publisher's `flush`/`publish` escaped as UNHANDLED REJECTIONS — `list()`, `serving()` and `deviceId()` are injected live-service calls outside the try, and fieldd has no `unhandledRejection` handler, so a throw ("the fold is mid-rebuild") killed the daemon (probe-witnessed) → wrapped, both `void` sites caught, a test counts zero. An oversized slice read as mesh-down at DEBUG and retried forever, the desktop vanishing from every phone; measured, a populated row is ~725 B, so the 64 KiB cap bites near 90 agents (§5's 300–500 B was low) → the publisher measures before it writes, trims the board's tail under the cap and stamps `omitted: n` (a new optional field on `AgentFieldSlice`), warns once per crossing, and tells the floor's `RESOURCE_EXHAUSTED` from a down mesh. `agent.interrupt`'s typed `unknown-session` refusal was UNREACHABLE — the helper matched "unknown session" and the floor (ghosttea 0.11.1) says "unknown or remote session", so the phone's stop would answer INTERNAL on the benign cell-tag race → both phrasings matched, the floor's exact words in a test. Minors fixed: the content wall was a five-name denylist (a `lastReply` field passed 28/28 and typecheck) → the projected key set is asserted against `AgentFieldRow.shape`; nothing parsed fieldd's own projection through the contract → it does; a returning row's revision restarts at 1 → the contract says so (a change stamp, never an ordering); `minIntervalMs` was silently ignored on the `full` path → refused; `agentField.dispose()` was missing from the boot-rollback ladder → added; the mint wrote at the umask's mode then hardened → `create_new` at 0600, and the identical shape in `pairing.rs` with it; the cap table's test lacked the new row → added; an unlinked desktop (no stored login → every tailnet peer `self`-less with the full preset) reached the grant → the door requires `self: true`. Kept as owed: the gate's dangerous direction (product serve up, terminal mesh OFF → tappable joins for PTYs not on the mesh) — the builder tried the honest gate and reverted it: the only floor fact fieldd can read for "the terminal mesh is serving" is `native.terminal.mirrorWriteCapability`'s `configured`, and that verb answers with the CAPABILITY ITSELF, so polling it to gate a publisher would move a secret across the mgmt channel on a schedule nothing needs — it broke four of MF-2a's EL7 rows ("one ask per grant", "a plugin never causes the capability to be read"). The direction now stands WRITTEN where it bites (the publisher's `serving` doc, `daemon.ts`); what closes it is a secret-free `terminalMesh` boolean on the floor's hello beside `terminal`/`terminalRoutes` — cross-plane, owed as MF-1l; no heartbeat on the door subscription (the socket's death is the signal).
- **EL7 (lens 2: 1 blocker · 3 major · 3 minor).** The blocker is a POSTURE, not a defect in the wave: `field.agents.v1` reaches every tailnet node whose hostname starts with `truffle-vibefield-` — truffle-core broadcasts a slice to every app peer and pushes the full slice to any joiner, admission is the hostname prefix, and there is no WhoIs, no login check and no per-store authorization anywhere in the store path; the guest choke (`TAILNET_GUEST_SCOPES = []`) is the WebSocket door's. `terminal.v1.hosts` has carried a title and a cwd label to that same audience every 5 s since the terminal track, unexamined. Shipped now at no product cost: `project.cwd` (an absolute path, the OS username in it) became `project.name`, the folder's basename — the only thing any consumer draws (the phone's badge, the desktop reads `full`). Still on the wire to that audience: the branch, the model, the effort, the blocker's tool name, the label — **GM-D10, James's ruling** (DECISIONS). The devices store's contract claimed "same-user-private" and `daemon.ts` cited it as the field gate's precedent — corrected at both sources, dated. Slice SPOOFING is truffle's: `Update`/`Full` apply under the PAYLOAD's device id with the sender in scope and never compared, `Clear` has no check at all — **TF-2** (petitions); the phone now refuses the mismatch itself (below). No per-connection subscription cap and the field projection is per-subscriber work (linear, 1.2 ms per window at 100 subscriptions) → a registry constant and `RESOURCE_EXHAUSTED` past it. Stated, not changed: every serving floor now holds a durable bearer write key on disk that a same-uid read reaches (GT-D6 per-device tokens is the named upgrade).
- **the renderer (lens 3: 0 blocker · 2 major · 10 minor).** The stop verb cast where its contract exists, and fieldd THROWS for an ended run (PRECONDITION_FAILED, `details.state: "not-alive"`) rather than returning a refusal, so a healthy daemon's refusal logged at ERROR as "could not reach fieldd" → `AgentInterruptResult.parse` on the success path, the door's own words at INFO from the thrown error's details. A selected BARE SHELL got no line and no glow: the package keyed on `[data-pane-accent]`, which Ghosttea sets only for a dealt colour, and its `::before` exists only under that attribute — the record asks for the ink at 30 % / 20 % / 10 % → upstream (PU-14b), the frame's own `::before`. Minors: the zoom glyph led the deck's chip by 240 ms (`entering`) → `zoomLayoutApplied`; `frameVerbs` rebuilt every render (the zoom object is fresh each render) → a ref; smoke row 1c read the portal with no deadline → `until(…, 10 s)`; `--vf-godview-terminal-bg` was published and read by nothing (the GT-6 commit body's claim was half dead — this line is that erratum), `--terminal-divider` orphaned, the host's pane crossfade overridden by the package's transition → all three deleted explicitly; the boundary gate forbade `.vf-pane-` in prose → a rule, not a mention. Recorded: the verbs are pointer-only by the record (⌃C and ⌘⇧↵ are the keyboard paths; resume has none); the monitor lab switch no longer silences the fold (the cost moved to the provider); `godview-monitor`'s WEBGPU row red once in ten three-file runs (the swarm renderer's, not this diff's).
- **the phone (lens 4: 1 blocker · 4 major · 9 minor; the kit measured 495 tests twice at `c2b6d71c` where the lane's report said 504 — the final count below is the orchestrator's own run).** The blocker: `replaySubscriptions` RETURNED on a gone key and on any thrown error, so one refused or timed-out replay abandoned every later subscription for the socket's life with the state `.ready` (both triggers probe-witnessed: a restarted desktop answering NOT_FOUND; a handle cancelled mid-replay) → `continue`, and a replay failure closes the socket and re-dials like the TS client. Majors: an attribution mismatch was counted and then APPLIED — a peer replaced another desktop's dial target at version 9,000,000 for good (a door-redirection primitive on the store whose purpose is teaching the phone a capability URL) → refused, and `clear` checked too (it was not even counted); `socketDown` walked away from a connection without `close()` while the real transport's `connect` never throws → closed; `connect()` was not idempotent in the dial window (three concurrent calls, three sockets) → one dial held. The capability URL from the slice was unchecked → pinned to the sender's tailnet address (by HOST — the peer's `hostname` and `tailnetIPs` from the mesh node, the fully-qualified name BUILT from this node's own `dnsName` suffix so every comparison is an equality (a prefix match on the slug would welcome `studio.attacker.example`, and MagicDNS forwards names it does not own — a row says so) — plus the `/t/` capability path; the scheme is any socket, because the contracts' own golden publishes `http://…:443/t/…` and fieldd builds that string from truffle's serve URL, so a `wss` pin would have refused every endpoint that exists). Minors: the store's retain cycle, a failed subscribe leaving a live daemon subscription, a cancel during reconnect naming the previous socket's id, the NO-CONTENT wall reflecting over the Swift type (it now feeds a content-carrying payload and reads `unknownFields`), the byte-for-byte fixture claim already false and ungated (re-copied; `check:ios-fixtures` in `pnpm verify`), `maximumMessageSize` unset, the URL public and redacted by a 117-character accident, a test's fire-and-forget teardown. Found by the pin, not by the review: the phone's product transport was a plain `URLSession`, which does not route over the in-process userspace tailnet at all — a `100.x` address goes nowhere and a MagicDNS name resolves on the device's ordinary network, if at all — so it now takes truffle's own `MeshNode.urlSession(configuration:)` through a session provider; on the device this would have read as "the desktop is unreachable". Owed: the mesh doors' `Peer → FieldStorePeer` wiring has no test (`MeshNode` is a concrete actor and `Peer.init` is internal to truffle, so the package can neither fake the node nor build a peer; the doors are covered through the injected seam). One repair to another lane's row on the way: `pollingRunsOnlyBetweenStartAndStop` counted 10 ms polls in a fixed window and starved under the heavier suite — it waits for presence now.
- **tests and the ledger (lens 5: 10 probes, 3 green under mutation).** The publisher's wiring in `daemon.ts` was unwitnessed → a daemon-level row; the contracts' content wall tested the hand-authored golden, not the projection → producer parity; the mcp-agent half of the grant guard untested → a row; `agentDetail` read `blocker.tool` at the root (the fixture's fake shape; Core puts it under `permission`) → fixed with a real-shape fixture; the door-level field row saw only an empty board → populated; smoke 1c's narrow assertion was vacuous and the catalog specimen hand-wrote the attribute → the real portal in a jsdom. The counts: fieldd's suite is the FINAL tip's measurement, below; the phone's kit runs outside the gate (`pnpm verify` never opens Xcode), the fieldd joint row IS in the gate; the not-lent-verb rule is upstream's witness only; electron-shell red 1 in 10 (a lottery row, name lost).
- **upstream (lens 6, PU-14 at `aa34eb1`).** A fresh split said "terminal" (the host's remembered folder no longer reached the badge) → `fallbackCwd`; the deck class set in an effect and never removed → marked and unmarked by the observer effect, expected statically; the narrow attribute a literal on both sides → `PANE_NARROW_ATTRIBUTE`; `./deck` not an export subpath → it is. All in PU-14b (`73b2d64`, pinned `cfcd951c`), gated by the root `pnpm test` and `pack:check`.

**Gate (the landing script: `pnpm verify` VERBATIM first, then every stage after lint alone — `scratchpad/mf-gate-*.log`, dev-local):** run four times on main during the wave — at `c2b6d71c` (wave 1), `2aa57e52` (lanes A and D landed), `bd2acc04` (lane C landed) and `d39db4a1` (the final tip for everything the gate reads; the commits above it are Swift under `apps/ios` only, which `pnpm verify` never opens). At `d39db4a1`: `pnpm verify` — preflight OK (puppeteer `73b2d64`, rosetta `e8d907a`; the two dirty-tree warnings are James's own edits in both checkouts), `check:deps`, **`check:ios-fixtures` 14 copies identical to `packages/contracts/fixtures`** (new in this wave), `icons:check`, typecheck 25 projects, then lint stops on James's untracked `work/composer-directions.html` (4 errors, all his — the tracked tree is lint-clean; an erratum on the GT-6 commit body's claim that four tracked errors were pre-existing: they were formatted away in `c2c1cf2e`) · `cargo fmt --check` 0 · clippy `-D warnings` 0 · `pnpm bundle:assert` 0 · **`pnpm test` 0** — field-app 90 files / 765 tests, fieldd 84 files + 1 skipped / 828 passed + 14 skipped (the `FIELDD_TEST_REAL_AGENT` rows and their kin), contracts 25 files / 464, every other project green · `pnpm test:rust` 0 (21 suites, 254 tests, 6 ignored) · the gen check's Rust half 0. Two reds on the way, both isolated one file at a time before they were named: at `2aa57e52` the field-app `godview-monitor` WEBGPU-unavailable row (3/3 alone, 3/3 in its three-file trio — the lottery lens 3 measured at 1-in-10 under load; green in every later run), and at `bd2acc04` the new door-level field row's "a still board kept sending frames: expected 2 to be 1" (2/2 alone, the package alone 828/14 — a precondition assumed under the loaded graph, fixed at the row by MF-1k, green in the graph at `d39db4a1`). Both of those gate runs shared the host with two Xcode simulator suites. **The phone's kit, outside the gate, measured by the orchestrator at `97826e2d`** (the README's command, `TMPDIR=/tmp DEVELOPER_DIR=… xcodebuild test -scheme VibeFieldKit-Package -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -skipPackagePluginValidation`, twice): **614 tests in 116 suites, passed, both runs** — 89/22 · 38/7 · 158/18 · 131/23 · 67/15 · 16/6 · 91/21 · 24/4 (FieldDesign · FieldTerminal · FieldProduct · FieldMesh · FieldHome · FieldSwarm · FieldAgents · FieldInput, by bundle order in the log); every earlier count in this entry (495 · 504 · 543 · 572 · 584 · 586 · 596 · 598 · 614) is a lane's own run at its own tip, and the 495-vs-504 disagreement between lens 4 and lane C was the goldens swap `03b3554d` landing between the two measurements — both right.

**Smoke (`pnpm smoke:godview`, headless, TMPDIR=/tmp) at `c2b6d71c`, again at `9b652ff4` after the review's renderer fixes and PU-14b, and again at `bd2acc04` with every lane but the phone's corner landed (`ok: true`, exit 0 each time; `paneFrame: {framed, frames: 1, frameInPane, name: jamesyong, narrow: 0}` — row 1c with its deadline poll; run with James's nine-day-old dev stack live on the host. The GT-6 worktree's own attempts exited 1 with no output on both harnesses; its own logs under `/tmp/vf-smoke-*/logs/` say why — the shell booted and spawned its fieldd, and the renderer hit `renderer.boot.stability_cap_reached` on every one of five retries (a GPU/host contention signature), so no Godview code ran; the last ERROR row, `supervisor disposed`, is a teardown artifact and the wrong line to read first). At `c2b6d71c`:** `ok: true`, exit 0 — the deck carries `vf-deck-framed`, the active shell pane wears the frame (`paneFrame.framed: true`, `paneFrameName: "jamesyong"` — the badge is the folder, never a title), `paneFrameNarrow: 0`; the AR-5 rows unchanged (`swarmRenderer: unavailable` headless, `findSheet` open→closed, `usageTiles: 0`, `monitorAgents: 1`, `swarmPhysics: worker`; `s3eInstrumentDebt` still the flip-witness).

**Owed, named:** James's rulings — **GM-D10** the field store's audience (DECISIONS; the narrowing shipped, the posture is his) · **MF-1g** the persistence ruling (agent panes `keep-until-explicit-close`, one literal at the agent-class create; dead panes hold floor slots against `TERMINAL_SESSION_CAP = 100` until closed) · the exit face at the badge's bottom-left and the deck-vs-pane 82 % tint gap vs record §07 (his eyeball) · the unlinked desktop's PRESET (full `TAILNET_SCOPES` to any WhoIs-verified peer when no login is stored — a UA ruling; the grant door refuses regardless) · **NF-8** the mesh posture toggle (GM-D6) · **IOS-EL8** the phone's ghosttea pin to 0.11.1 · **Phase 0** the hardware witnesses (a serving `pnpm dev` with `FIELD_NATIVE_MESH=1 FIELD_NATIVE_TERMINAL_MESH=1`, the phone signed in by hand: the live field, the attach, the granted key typing, the join's assumption that the devices-store key and the hosts-store `deviceID` are one truffle ULID) · the pushes and `SIBLINGS_TOKEN` (every pin since AR-5 is on no remote branch) · the `dev-local` snapshot by hand. Engineering — **MF-1l** a secret-free `terminalMesh` boolean on the floor's hello so the publisher can gate on the terminal mesh (the false-positive direction stands written at two sites that predate the name — `packages/fieldd/src/agent-field-publisher.ts:68`, the `serving` doc ending "OWED", and `packages/fieldd/src/daemon.ts:1768`, the gate comment marked MF-1h as its provenance — to be deleted together when this lands) · the hosts-store slice cap (a registry row and a decision: the cap table is a cap LIST, a store with no row is admitted at any size) · a per-PRINCIPAL subscription bound (the cap is per connection) · no heartbeat on the door's field subscription (the socket's death is the signal) · the mesh doors' `Peer → FieldStorePeer` wiring untestable in the kit · the link's `notes` have no surface and the mesh sheet says nothing about doors · `unknown` draws as idle on the phone (a tested decision, no mark) · the frame's verbs are pointer-only (resume has no keyboard path) · `PU-15` the imposter autoplay (AR-6's smoke) · **TF-1**/**TF-2** truffle petitions (the peer-left keyspace; slices applied under the payload's id, `clear` unchecked). Precedents examined and left: every serving floor holds a durable bearer write key on disk (GT-D6 per-device tokens the upgrade); `terminal.v1.hosts` carries a title and a cwd label to the same audience GM-D10 is about.

## MF-1a — James's QA of the wave, its fix wave, and the terminal-mesh ruling (2026-09-14; main `f999b6e1`)

**The witness the wave lacked, and what it found.** James ran a QA of `522065df` the same night (`work/godview-verification-2026-09-13/verification.md`, read-only): a signed-in phone saw ZERO peers, the mesh flag broke the desktop floor, a Codex pane stayed blank, a live shell vanished from LIST, the old chips overprinted the record's frame, the Godview smoke failed on cwd, the dev design page was blank. Two of those were blockers with exact causes; every finding is either fixed below or diagnosed with its next probe named.

**IOS-4i — the phone joins the field's own namespace (`dd845ece`, lane qa-ns).** ghosttea's Swift runtime hardcodes `appId "ghosttea-terminal"` and keeps its node init private; the desktop's node is `vibefield`, and truffle admits a peer by the `truffle-{appId}-` hostname prefix — so the phone could never see the desktop. `FieldTruffleRuntime` (FieldMesh) starts truffle's public `MeshNode.startTailscale` with `FieldMeshContract.appID = "vibefield"` (hand-pinned from `registries.ts`; `scripts/check-ios-fixtures.mjs` now also pins the registry value — three mutations probed) and composes the same pieces ghosttea's runtime did, every one of which is public below that init; a one-time atomic rename carries James's node state from `truffle/ghosttea-terminal` to `truffle/vibefield` (truffle derives the state directory FROM the app id in two places; the fallback is a fresh sign-in, which is also the no-migration outcome). Kit 625 tests / 118 suites twice. Petition **G14** filed. The live discovery witness is James's.

**MF-2i — the floor's two mouths say one thing (`ee29867f`, lane qa-floor).** With the mesh flag on, the floor's hello applied a disclosure rule (a route snapshot only at revision ≥ 1) that its routes SUBSCRIPTION did not, so the in-process serve's `{revision: 0, cells: []}` reached fieldd one message after the ack and threw away the hello's legacy endpoint — `device.list` answered `terminalHost: false` and `terminal.create` refused on a floor serving PTYs throughout. `disclosed_routes` is ONE rule for the ack, the subscribe and its deltas (an unrevised snapshot is disclosed on no surface; withholding is absence); fieldd's `applyTerminalRoutes` refuses an unrevised empty snapshot over a hello-vouched mirror; a LIVE row boots a real `terminal_mesh_enabled` floor with no tailnet and reds under the QA's literal payload; the mock gained `routesSubscribeSnapshot`. cargo 257 · fieldd 829/14. A serve-mode discriminator was built, measured and reverted: TC-D15's revision-1 capability announcement is the one authority. ~~MF-1l stays owed at its measured size (a unit→state→bootstrap plumbing, a `HelloAck` field, a reader, the gate).~~ **Erratum 2026-09-14 (the TM review's record lens): PAID the next day.** TM-1 `4c89e7a1` put the secret-free `terminalMesh` boolean on the floor's hello — `HelloAck.terminalMesh` (`packages/contracts/src/envelope.ts:228`), the golden `hello-ack.terminal-mesh.json`, with `mgmt_server.rs` and `fixture_parity.rs` rows — and TM-2 `048544c9` wired the publisher's gate to it, taking the two comments that named the owed field out together (§TM below).

**GT-6a…6d — the deck's findings (`7517e911` · `578f8e2c` · `31d699d1` · `f999b6e1`, lane qa-deck).** The old `zoom pane` and two-step `kill session` chips are REMOVED — they hung in exactly the corners §07 gives the readout and the badge (the photographed overlap); zoom is the frame's ⤢ verb plus the chord (`use-deck-zoom.ts`); the kill has NO replacement and that is stated as a real loss (⌘W detaches, the session keeps running — GT-D5; **a kill affordance is James's ruling**); the claims strip's MEASURED bottom is published as `--vf-monitor-claims-bottom` so the list starts below it. A live PTY the floor holds now STAYS on the roster when a select takes its pane: the deck publishes `floor` from `terminal.roster` (TP-D4's placement-free projection), the monitor keeps un-paned, unclaimed rows as `MonitorFloorRecord` with `floorSessionId` so select can mount them; the re-read fires on pane changes, never at the mount (TP-S3e). The cwd row: **James's red does not reproduce** — under the real default temp root both readings match; his log shows every session at `cwd: null` for twenty seconds, which is no OSC 7 announcement at all (his finding-3 ambiguity stands); the commit removes a latent asymmetry (one canonical `samePlace` for the three readings, `realpathSync` not `.native` because APFS folds case) and both smoke roots pass, `TMPDIR=/tmp` and `$(getconf DARWIN_USER_TEMP_DIR)`; the fail-fast row was NOT added on measurement (`assertDataRootUsable` already refuses an over-long root in ~4 s; what is owed is one line of prose — the shell drops the socket byte count on that path). The dev design page: the workspace carries zod 3 and the pinned sibling its own zod 4; Vite's optimizer keyed by the bare specifier and answered puppeteer-core with the prebundled v3 → `optimizeDeps.exclude: ["zod"]`, verified headless by CDP (0 → 166,351 bytes of DOM, zero exceptions, also after a forced re-optimization). The Codex pane: DIAGNOSED, not fixed — the adapter's own live composition passes in James's topology (codex 0.154.0, 1.66 s); the leading cause is the ALTERNATE SCREEN on a LATE ATTACH (select attaches an existing PTY, the Claude pane was mounted at birth), the settling probe needs no Codex (an alt-screen program in an agent-class PTY, a late attach), and a hazard found on the way: with `TMPDIR=/tmp` codex's app-server refuses its socket outside the user temp dir, so a Codex row under the smoke discipline dies before a PTY exists. Upstream: **PU-16** — a bare shell has no pointer path to zoom (the package draws ⤢ only beside stop or resume; §07's table wants a shell's verbs in ink at 70 %). Gates: field-app 90 files / 767, electron-shell 69 / 679 + 2, typecheck, biome, `bundle:assert` OK; each new row mutation-probed.

**The design James asked for, and his ruling.** While the fixes landed, three read-only research lanes established at the source how the terminal mesh couples to the floor (`draft/thinking-terminal-mesh-cells.md`): the desktop's tailnet is a Go sidecar's userspace netstack, an inbound TCP connection arrives in the floor as a real owned socket, QUIC cannot leave the floor, the phone reads no hosts store and receives whole JSON grid rows while its Metal renderer already decodes TRF1 it encodes itself, ghosttea's serve path is typed on its in-process session map and calls 32 of its methods, and the sidecar's reverse proxy already routes WebSockets by path to loopback targets. **Verified in the source and stated in the plan:** with `FIELD_NATIVE_TERMINAL_MESH=1` the floor is the pre-TP-S3e product — no route rows, no T1 doors, no grants — and fieldd refuses every routed ticket `transport_not_landed`, so the mesh flag and the desktop deck are MUTUALLY EXCLUSIVE today; Phase 0 could not have shown the phone beside a working deck. **James ruled TM-D1 = T directly** (2026-09-14 04:59): the phone becomes a routed T1 client over the sidecar's proxy to the cells' doors, fed the cell's own TRF1, the write right a per-client expiring grant (the bearer retires), the in-process serve and the TSP1 adapter deleted; slices TM-1 (the floor), TM-2 (fieldd), TM-4 (the kit's routed client) in flight; DECISIONS carries TM-D1…D8. Petitions: **T3** (truffle's UDP relay accepts its registration from any local sender — EL7, the QUIC plane), **G27** drafted (the Swift routed client into GhostteaKit, after it lands here), G25/G26 withdrawn as moot under T, the T1 row's "QUIC remoteIdentity()" claim corrected (NAPI only).

**Gate at `f999b6e1`** (the landing script, `pnpm verify` verbatim first): preflight OK · `check:ios-fixtures` 14 copies + 1 registry value identical · typecheck 25 projects · lint stops on James's untracked `work/` only (his QA dropped NDJSON there) · fmt 0 · clippy 0 · `bundle:assert` 0 · `pnpm test` 0 (field-app 90, fieldd 84 + 1 skipped, electron-shell 69) · `pnpm test:rust` 0 (21 suites) · gen:check's Rust half 0. **Owed:** James's live witnesses (discovery, the deck with the flag on — after TM-1), the kill affordance ruling, the Codex late-attach probe, the fail-fast prose line, a new TestFlight build (build 3 predates IOS-4), IOS-EL8 (the kit's ghosttea pin at 0.10.1 against 0.11.1).

## TM-3 — the bearer key retires into grant rights (2026-09-14; lane tm-bearer)

**What this retires, and why it could be retired rather than replaced.** MF-2 built a
durable write credential: the floor minted 32 random bytes as hex at boot when
`FIELD_NATIVE_TERMINAL_MIRROR_WRITE` was unset, kept them 0600 at
`LAYOUT.TERMINAL_MIRROR_WRITE_FILE`, answered for them on ONE mgmt hop
(`native.terminal.mirrorWriteCapability`), and fieldd handed them to a WhoIs-verified self
peer through `terminal.mirrorWriteGrant` behind FD-2's default-refuse allow-list, audited as
`capability.mirror_write.grant`. The phone kept what it was given in a Keychain item per host
and presented it on every attach. Every property of that design was a consequence of the
credential being DURABLE: one secret per floor, so a rotation revoked every device at once; a
file on disk, so every same-uid process could read it (EL7's adversary); and a door that had
to enumerate who may hold it, because a kind nobody had thought about must not be handed a key
that never expires. TM-D3 replaced the credential with a CLAIM — `rights: ["input", "read"]`
in the per-client, per-session, expiring, revocable-by-generation attach grant the ticket
already mints (TM-2) — and TM-5 moved the phone onto it (`13120801`, `87d13ec9`: the
attachment sends no bearer). With no reader left, this slice is one deletion across four
planes, nothing fenced and nothing flagged.

**The floor (`5d041995`).** `config.rs` loses `TERMINAL_MIRROR_WRITE_ENV`,
`NativeConfig::terminal_mirror_write` and its three initialisers,
`terminal_mirror_write_file()`, `ensure_terminal_mirror_write()` and
`load_or_mint_mirror_write()` — the mint with its idempotence, its re-harden, its empty-file
remint and its create-race read-back — plus six unit rows and the EL7 strip-class row TM-1 had
moved here from the deleted `tests/terminal_mesh.rs` (it bound the variable's NAME to
`registries::ENV_PREFIXES`, and there is no variable). `lib.rs` loses the boot act and the
capability argument to `DaemonState::new`, and `bootstrap_with_logging` no longer needs `mut
config` — that `mut` existed for this one call. `state.rs` loses the memory-only holder;
`mgmt/mod.rs` loses the verb, so a pre-TM-3 caller falls through to METHOD_NOT_FOUND, which is
the honest answer (the door is gone, not temporarily unavailable). `tests/mgmt_server.rs`
loses the MF-2a block whole. **`secret_file.rs` stays and `harden` does not:** MF-2f's
`create_private` is the pairing secret's O_EXCL-plus-mode fix and keeps its rows, but
`harden`'s only callers were the capability's two read-back paths. It is deleted rather than
left a public function with no caller under a doc comment claiming a live behaviour — and
nothing regresses, because the pairing secret is born 0600 and read back verbatim, so no file
in this daemon was ever re-hardened. Hardening the pairing file on read would be a NEW claim
needing its own test; recorded, not done.

**The contracts and fieldd (`5d041995`).** Both method rows, both mgmt shapes, both product
shapes, `LAYOUT.TERMINAL_MIRROR_WRITE_FILE`, the golden
`terminal-mirror-write-grant.valid.json` with its `fixtures.test.ts` row and its
`layout.vector.json` entry, regenerated through `gen:rust` and root `pnpm gen`. fieldd loses
the door, `MIRROR_WRITE_GRANT_ADMITTED_PRINCIPALS`, `mirrorWriteGrantRefusal`,
`NativeLink.mirrorWriteCapability()` (the only place a secret ever came UP that channel), the
mock's scripted capability and ask counter, and `mirror-write-grant.test.ts`'s 17 rows. Every
registry keeps a DATED comment naming this slice and the design; the audit action has no
registry row to annotate (`AuditActionV1` is a regex, not an enumeration), so its retirement
is recorded where the product row was. **FD-2's allow-list is not replaced, because the
question it answered is gone:** `rightsFor` reads the write right off the PRINCIPAL — a window
and a self peer are minted `input`, everything else (a plugin, an unlinked tailnet peer, a
guest, a peer-fieldd) is minted `["read"]` — so a caller the door refused now receives a grant
that cannot type, and it expires either way. **One clause has no counterpart and that is
stated at the source:** `agent-claim`, which refused a hello claiming `mcp-agent`. A ticket
binds to the principal and never to a UI claim, so an agent's claim has never changed what a
ticket grants; it only ever cost that caller the durable key. The walls the deleted suite
proved were checked to exist elsewhere BEFORE deleting it — the guest choke and the scope wall
in `terminal-remote-ticket.test.ts` and `terminal-grants.test.ts`, D36 locality in
`tailnet-door.test.ts`, `guest-door.test.ts` and four more. One row is ADDED as the inverse of
what it replaces: `registry.test.ts` asserted the registry DECLARED the door and now asserts
that no method on any surface names a mirror-write door — a registry is the one place a
retired door can quietly come back.

**The phone.** `MirrorWriteStore` (the `MirrorWriteHost`/`MirrorWriteStoring` pair, the
Keychain store and the in-memory double), `WriteKeySheet`, `FieldLink`'s
`requestMirrorWriteGrant` with its `MirrorWriteGrant` outcomes, its `.automatic`/`.deliberate`
asker, its once-per-connection latch and `hasAskedForGrant`, `TerminalMirrorWriteGrant` with
the three-door redaction (`description`, `debugDescription`, a custom `Mirror`) and its golden
copy, HomeScreen's whole ladder (the store, the mirrored host list, the sheet's subject, the
note, the grant notes, `collectWriteGrants`, `askDesktopAction`, `requestWriteGrant`,
`cardHasWriteKey`, `writeKeyEntry`, `refreshWriteKeys`, `saveWriteKey`, `removeWriteKey`) and
its two DEBUG launch arguments, the settings sheet's WRITE KEYS section, and
`FieldHomeModel.viewOnlyReason` (no shipping caller) and `keyEntryOffered` with the card's
ENTER KEY invitation, its one caller. `writeInvitation` survives on ONE parameter: the
listing's `sessionSharesWrites` is the only fact a card has before a tap, and the case it
cannot know is named where it becomes known — `TerminalAttachment`'s "view only — this desktop
granted read without input". Removing the affordance rather than disabling it is D-i6's rule.
**The Keychain does not empty itself**, so a phone upgrading from an older build would keep
secrets nothing can read, use or offer to remove: `RetiredWriteKeyCleanup.runOnce()` deletes
them at the first launch on this build, by SERVICE rather than by account (the store indexed
by host and this code has no host list) and with no `kSecReturnData` in the query, so the
capability never enters the process even on its way to being destroyed. The flag is set only
when the Keychain agrees the items are gone, so a locked-keychain launch retries rather than
recording a lie.

**Corrections at their sources (the errata rule).** `registries.ts`'s PORTS note kept
9420/9421 SPOKEN FOR "because the phone's GhostteaKit still dials 9421 until TM-5" — TM-5
landed, nothing on any plane dials either port, they are free. `terminal-grants.ts`'s
`rightsFor` doc said `input` "grants nothing new" because the bearer door already handed a
self peer the same power; it is now the ONLY way a self peer comes by the right to type.
`native-link.ts` and `agent-field-publisher.ts` both explain the `terminalMesh` boolean by
contrast with the secret-carrying verb. `process-service.test.ts`'s win32 strip row named the
capability as §4.2's leak. `field-app`'s `remote-door.ts` and `useMonitorAgents.ts` called a
read-only peer session "the mirror-write law" — traced before rewriting: no renderer code ever
supplied such a key and `session.readWrite` is the mesh runtime's own flag, so only the NAME
was wrong. ROADMAP's known issue **"our mirror-write secret leaves the device" is CLOSED by
deletion** rather than by the per-device-token upgrade it argued for, and its IOS-3c paragraph
("the middle third is not reachable until that leg lands") is corrected: the leg is not owed.
DECISIONS carries TM-D3 **LANDED** and GM-D5 **SUPERSEDED**. ~~TESTFLIGHT's build-2 limits
paragraph is dated as describing a build that predates this slice.~~ **Erratum 2026-09-14 (the TM
review's record lens): false as written — that note was never applied.** The landing (TM-3a
`f01380af`) deliberately kept OFF `apps/ios/TESTFLIGHT.md`, because James holds an uncommitted
edit in that file; the committed paragraph is still undated and still describes the write key as
a current product limit ("the write key landed with IOS-3c — entered on the card (ENTER KEY) …
kept in the Keychain per host"), which this slice deleted on every plane. The note is OWED to that
file, exactly as §TM below records it.

**Findings.** `scripts/check-ios-fixtures.mjs` SILENTLY skips a phone-side copy whose
contracts origin no longer exists — it reads that as a fixture the lane authored for itself —
so deleting a golden without its copy leaves an unchecked orphan and the count merely drops.
Not fixed here; the copy is deleted instead. `packages/fieldd/test/terminal-service.test.ts`
carries an unused `type TerminalCreateResult` import, pre-existing at `87d13ec9` (verified by
re-running biome with this slice's change stashed) and left alone. On process: the fieldd
suite's `global-setup.ts` spawns its own `cargo build -p field-native` and inherits the
caller's environment, so running it without `CARGO_TARGET_DIR` starts a COLD build in the
worktree's own `target/` beside the symlinks the harness needs — export the target dir for the
pnpm invocation, not only for cargo.

**Gate.** `cargo test -p field-native` 20 suites / 244 passed / 0 failed / 7 ignored ·
clippy `-D warnings` clean · `cargo fmt --all --check` clean ·
`pnpm --filter @vibefield/contracts test` 470 / 25 files · `gen:rust` + root `pnpm gen` then a
diff over the generated paths: exactly the two expected deletions ·
`pnpm --filter @vibefield/fieldd test` 844 passed / 14 skipped, 86 files / 1 skipped, no
lottery row · typecheck 3 projects (`--skip-nx-cache`) · `pnpm lint` exit 0 ·
`check-ios-fixtures` 17 copies + 15 registry values identical · the kit suite twice on a
throwaway iPhone 17 Pro / iOS 26.5 simulator, deleted after · the app's own build command.
**Owed:** the design corpus still describes the bearer as current in 11 documents (listed for
James at the source), and TM-7 folds them.

## TM — the terminal mesh on the cells, done the proper way: the phone is a routed T1 client of a cell's own door (2026-09-14; main `bbe551a5`)

**The ruling (James, 2026-09-14 04:59): "I'll choose T directly, let's do things the proper way, plan and land it solid and cleanly."** The design is `draft/thinking-terminal-mesh-cells.md` (TM-D1…D8 in DECISIONS), written on three source-level fact sheets: the desktop's tailnet is a Go sidecar's userspace netstack (every byte crosses it once; an inbound TCP connection reaches the floor as a real owned loopback socket with the peer's WhoIs already stripped into the floor's hands; QUIC cannot leave the floor); the phone read no hosts store, dialed TCP 9421 and received whole JSON grid rows while its Metal renderer already decoded TRF1 it encoded itself; ghosttea's serve path is typed on its in-process session map and calls 32 of its methods, and no protocol anywhere carries the logical snapshot a bridge would need; and the sidecar's reverse proxy already routes WebSockets by path prefix to loopback targets with per-route login allow-lists. **The fact that forced the order:** with `FIELD_NATIVE_TERMINAL_MESH=1` the floor was the pre-TP-S3e product — no route rows, no T1 doors, no grants — and fieldd refused every routed ticket `transport_not_landed`: the mesh flag and the desktop deck were mutually exclusive by construction, and James's QA of 2026-09-13 had stopped one failure short of seeing it.

**TM-1 — cells always; the flag means the tailnet door (`afc35b15` · `4c89e7a1`; TM-1a `c2ba516f`; lane tm-floor).** `cell_mode` is gone as a concept: the class cells run unconditionally and `MeshPlan` answers only "are the terminal doors published on the tailnet". The in-process serve (bind, font discovery, the service, the drain), `services/terminal_mesh.rs`, the `with_terminal_mesh` attach, the `ghosttea-truffle` dependency, the TSP1 ports and `STORES.TERMINAL_HOSTS` (retired with dated comments; 9420/9421 marked SPOKEN FOR until the phone moved), and the two mesh test files — ~1,991 lines deleted, not fenced (TM-D7: the path never worked beside the deck). The hello gains `terminalMesh: boolean`, written on EVERY hello — true iff the flag is on AND the gateway's node is present, read per hello; absent = a floor predating the field (golden `hello-ack.terminal-mesh.json`). Found on the way and fixed: an unreachable `OnceLock` fallback, a write-only `serving` watch, the legacy reconcile and its `FaultSink` variant, a GT-5d note made unreachable; one regression fence retired with a dated note (a revision-0 floor cannot occur — the supervisor announces revision 1 first; `disclosed_routes`'s own rows keep the rule). TM-1a: `pnpm verify` then failed at PREFLIGHT on the EL8 pin table's row for the deleted crate — the row removed with a dated note; the roadmap's pins line corrected at its source (`4cdf8bc6`). cargo 251 · fieldd 829/14 · contracts 466 · the kill-matrix rows S2/S3 green.

**TM-2 — remote tickets and the terminal routes (`7fce2811` · `8d6603c9` · `048544c9` · `64c26a75`; TM-2a `e041d680`; the reader cleanup `3ec5f156`; TM-2b `4848a39b`; TM-2c `f94862bd`; TM-2d `1435e11f`; lane tm-fieldd).** A second endpoint shape, `RemoteCellEndpointSet` (`ws://<tailnet dns>:9422/cell/<cellBootId>/control|frames` — `ws`, because the serve runs `tls: false` on purpose inside WireGuard; golden `tp-remote-open-ticket.valid.json`), and `doorsFor(cell, principal)`: a window is byte-for-byte what TP-S3e shipped, a WhoIs-verified SELF peer gets the tailnet pair and `rights: ["input", "read"]` (TM-D3 — the trust `mirrorWriteGrant` handed out automatically once per connection), every other principal the loopback answer; the grants are identical, so a cell cannot tell a remote ticket from a local one. `native.mesh.serve.add` learns `target: {kind: "routes"}` — a path prefix and a LOOPBACK port and nothing else, `stripPrefix` true (a cell door matches `/control` and `/frames` EXACTLY), no implicit catch-all, an empty list refused; `terminal-serve.ts` is pure policy with three gates (no linked login publishes NOTHING EVER; `terminalMesh` false or absent publishes nothing; a doorless cell is dropped), idempotent by signature. **TM-D2 corrected as built:** the cell routes ride THEIR OWN tailnet listener, `PORTS.TERMINAL_CELLS_SERVE = 9422`, because truffle's `Proxy` offers `add` and `remove` and no update — changing a serve's route list drops every live connection on that listener, cell routes change on every cell birth and exit, and the product door is what a dropped client re-dials for a replacement ticket. A defect fixed on the way: `clientIdFor` had no `tailnet` arm, so every remote client shared one connection set and one attach-generation ledger — now `tailnet:<verified login>`. *(Erratum 2026-09-14, the TM review's EL7 lens: the arm as landed also names `"tailnet-peer"` (`packages/fieldd/src/terminal-grants.ts:68`), a principal kind nothing mints — the peer kind on the wire is `"peer-fieldd"` (`packages/contracts/src/envelope.ts:14` and `:334`) — so the code's own comment, that `tailnet` "joins the login-keyed family" the guest and peer arms already used, names a family with a dead member. Harmless as it stands: `terminal.openTicket` is `locality: "local"` (`packages/contracts/src/methods.ts:1036`) and a `peer-fieldd` principal is refused before any mint (`packages/fieldd/src/product-api.ts:733`). The code fix is the fieldd lane's.)* `doors_not_published` is a new refusal beside `transport_not_landed` (this DEVICE is not carrying its doors vs THIS CELL serves none); the field publisher withholds a row's `terminal` JOIN while the doors are off (the row stays; only the tap goes) and the two MF-1l comments came out together; `DeviceCapabilities.terminalMesh` beside `terminalHost`, deliberately untouched (it means "this device has a floor"). **TM-2b, the real sidecar over a real tailnet:** the route PREFIX must NOT end with a slash — a trailing-slash prefix never matches in the shipped sidecar, so TM-2's routes could not have worked until this commit (longest-prefix matching and fixed-width hex boot ids answer the `/cell/cb-1` vs `/cell/cb-10` hazard; a slash route stays mounted as the permanent control). Measured with a loopback backend that captures the bytes: `GET /control` (the prefix stripped), 101 with `Connection`/`Upgrade`/`Sec-WebSocket-Key`/`-Version` intact, NO `Sec-WebSocket-Extensions` added, `Tailscale-User-Login`/`-User-Name`/`-Node-Id`/`-Node-Name` injected and the caller's own copies dropped, `Host` rewritten to the loopback target, `X-Forwarded-Proto: http`; the allow-gate 403, 404 only when no route matches (indistinguishable from outside, so the row asserts the contrast). The live path reached `ConnectionAccepted` on both legs, `ControlLegAttached` with `rights: ["input","read"]` verified by a real cell against a real grant, `FramesLegAttached` with a real `trfIdentity` — and no seed bytes, with an A-vs-A control (the same client against the same cell over plain loopback, no sidecar) equally silent: the gap is the probe's own client flow (a hardcoded route revision), not the path; the fieldd e2e witnesses a seed through a proxy. Two things stay beyond a headless run: the floor's mesh service has NO auth-key path (an interactive browser login only), so no test can make a FLOOR join a tailnet — the probe stands ephemeral nodes beside it — and a foreign login at the allow-gate needs a second account. The re-mint rate a flaky phone produces (one `terminal.openTicket` per leg loss, since nonces never replay): the 60 s transport TTL is an establishment deadline, `connectionSetId` is stable per client and cell, each re-mint costs two audit appends and one nonce per channel ~~for the ~10 min tombstone — a 1 Hz flap for ten minutes ≈ 600 bounded entries per channel~~ and two fsyncs a second; the audit shows first. *(Erratum 2026-09-14, the TM review's EL7 lens: the two struck figures are ten times too high, in the safe direction. A nonce is held `expiresAt + skew` — a 60 s transport grant plus 5 s skew = 65 s, not ten minutes (`packages/field-native/src/tp/ledger.rs:178-181`, pinned by the prune assertions at `:351-356`) — so a 1 Hz flap parks ≈ 65 entries per channel, not 600. The ~10 min figure belongs to a different structure: the CONNECTION SET's high-water tombstone, `MAX_GRANT_LIFETIME_MS` 600 s + skew (`packages/contracts/src/registries.ts:208`). The two audit appends per re-mint and the two fsyncs a second stand. TM-2b's commit body carries the same wrong figure, where it cannot be corrected.)* **TM-2c/2d, the field row:** "exactly ONE delta" was a claim the publisher cannot keep (an interrupt is not one fact); the row asserts the chain (`since` = the previous `revision`), no content on every upsert, the run dead somewhere in the frames — and the spacing as a RATE over the window (count ≤ ⌊window/floor⌋ + 1), because a stalled event loop batches properly spaced frames into one read and a per-pair arrival gap is a false red; `WsRpc.notifications` carry `receivedAt`. TM-2a (mine): `mgmt_server.rs`'s routes row settles the snapshot before the hello — TM-1's unconditional cells let the second cell's hello land between the ack and the subscribe under load. fieldd 858/14 · contracts 471 · the live probe three runs with the key exported, ignored without it.

**TM-4 — the routed T1 client, in the kit (`399a8de9` · `5f9f8fe7` · `e0780ddc` · `5a3a0b79`; lane tm-swift).** A `FieldRoutedTerminal` target depending on `FieldProduct` and nothing else (TM-D4 enforced by the manifest): two `URLSessionWebSocketTask` legs over an injected `MeshNode.urlSession(configuration:)` provider; the hello/accept/refuse handshake with the transport grant; per-session activation on both legs with renewal and `resume`; the `PresentationEnvelope` binary decode with the payload as a slice; seed and catch-up transfers staged, bounded, crc32c-verified; byte credits under all seven laws; the two-dimensional lease as values; input, the geometry lease, `DeclareDemand`; eight states. The three vectors copied and byte-gated (17 copies), plus 14 TPv3 pins the client BRANCHES on (15 pins); a Swift RFC 8785 canonicalizer — the third implementation — byte-for-byte against the contracts' vector, and the grant carried VERBATIM because the MAC covers the received header and claims, unknown fields included. Findings: the cell re-arms its heartbeat receipt deadline ONLY on a `LegHeartbeat` or `CalibrationPing` (credit, `SceneApplied`, attach and input do not count), so a client that beats "when idle" is closed `4004` mid-session — the client beats unconditionally at TTL/3 and the spec's prose carries a dated erratum; a leg replacement needs a FRESH ticket (the cell's ledger holds a consumed `(nonce, channel)` until the grant expires) — `reconnecting` + `needsTicket` and a `ticketProvider` closure with backoff; over real sockets the frames ack arrives first — readiness is "both legs attached", decided once; `URLSessionWebSocketTask` always offers `permessage-deflate` and the byte ledger depends on the cell refusing it (a test names the dependency). The witness: a fake cell door on Network.framework's loopback listener driving REAL TRF1 frames from the perf corpus through a five-chunk seed and a 16 KiB delta, byte for byte. Kit 699 tests / 131 suites twice (and the orchestrator's own run).

**TM-5 — the attachment over the client (`b6d4b9f8` · `f7ecae67` · `13120801`; TM-5a `87d13ec9`; lane tm-phone).** `TerminalAttachment` awaits ONE `terminal.openTicket` over the desktop's product door (the join already names the session), hands the ticket to the client, and every leg replacement re-mints through the same door; the composition seam is two closures (`MeshModel.urlSessionProvider`, `FieldLink.openTerminalTicket`); `RoutedTerminalFrameSink` hands the cell's bytes to `TerminalSurface` verbatim — the row replica and the on-device TRF1 encode are gone — and owns the scene stamp; the inner `trfIdentity` half compares the frame's own handles with the declared pair using the RENDERER's `decodeTRF1Frame` (a header and section-table walk, never a second decoder). Four things changed for a person, each stated in the code: the phone holds no geometry lease (an additive viewer: it types, never resizes); a remote terminal's glyphs are the CELL's (D-i9's "a host's theme never reaches through the mesh" corrected in the settings sheet); the write key explains nothing any more (no bearer is sent); a plain shell on a desktop is no longer a bubble on the phone (the fold's rows only — a stated loss). Retired: GhostteaKit's TSP1 lifecycle, the replica sink, the peer directory and attachment dialer, the compact dial, the per-host `list-sessions`, `FieldStoreID.terminalHosts`; the `GhostteaTruffle` product leaves the kit (`truffle` becomes a direct dependency at exact 0.7.12 with `Package.resolved` byte-identical); **G14 withdrawn as moot.** Findings: `GhostteaFrame` is a target, not a product (G27's rider); the golden ticket carries fixed timestamps and is refused unmoved — itself a test; two DEBUG launch-argument rows were stale in the code; the client gained mouse and scroll. TM-5a, the orchestrator's overrule: the card KEEPS a pre-attach "not published" face from `device.list`'s `terminalMesh` (a three-valued reader: true offers, false names the flag, nil is unknown-not-refused) — and the lane found the sharper reason: the door-served board keeps its `terminal` joins regardless of publication (only the STORE's publisher withholds them), so the face and the mint's `doors_not_published` answer different questions; the doors gate sits after the run's own state, so an ended run keeps RESUME over the product door and loses only the pane to read. ~~Kit 719 → 729 tests / 134 suites, twice and again after the rebase;~~ the orchestrator's own run 719/134 at `13120801`. *(Erratum 2026-09-14, the TM review's record lens: **729 is the lane's relayed figure and no run log witnesses it.** The logs witness 699/131 at `5a3a0b79` — §TM-4 above says so in its own words — 719/134 at `13120801`, and 702/131 at the tip `bbe551a5` after TM-3's deletions, which is the count §TM-3's lane gate reports. A kit count is quoted from a run log, never from a lane's summary.)* Four errata dated at their sources (`Package.swift`'s TruffleTerminalMesh claim, `FieldStore.swift`'s store list, the settings sheet's two lines, the README).

**TM-3 — the bearer retires into grant rights (`5d041995` · `394a1946` · `d5386cdc` · TM-3a `f01380af`; TM-4a `bbe551a5`; lane tm-bearer).** Its own entry, §TM-3 above, carries the deletion in full (tm-bearer's record); here the shape: one deletion across four planes with nothing fenced and nothing flagged — the floor's mint, its key file, its env var and the mgmt verb; the contracts' two method rows, two mgmt shapes, two product shapes, `LAYOUT.TERMINAL_MIRROR_WRITE_FILE` and the golden; fieldd's door, admitted set, refusal and `NativeLink.mirrorWriteCapability()`; the kit's Keychain store, the sheet, `FieldLink`'s grant and latch, `TerminalMirrorWriteGrant`, HomeScreen's ladder and the WRITE KEYS section — with `RetiredWriteKeyCleanup` deleting a phone's stored copies at first launch by SERVICE, never reading a value. The write right is a claim in the attach grant (`rightsFor` reads it off the principal; the one clause with no counterpart, `agent-claim`, is stated at the source). `secret_file::harden` went with its only callers; `create_private` stays for the pairing secret; `registry.test.ts` asserts no surface names a mirror-write door, the inverse of the suite it replaces. The landing (TM-3a `f01380af`) kept off James's uncommitted `TESTFLIGHT.md` — the lane's dated build-2 note is owed to that file — and cited the rebased SHA; TM-4a `bbe551a5` (mine) fixed the credit row the lane's second kit run graded red: `everyUnitReturnsItsChargeIncludingAStaleOne` settled on *a* return, and the coalescing window can close between its two deliveries — it now settles on the cumulative sum. Lane gates on the committed tree: cargo 20 suites / 244, clippy and fmt clean, contracts 470, fieldd 844 + 14 skipped, typecheck and lint green, `check:ios-fixtures` 17 + 15, the kit 702 / 131 twice on a created simulator, `pnpm gen`'s diff exactly the two expected deletions. Two findings for the next brief: `check-ios-fixtures.mjs` silently skips a phone-side copy whose contracts origin is gone (an orphan nothing checks); fieldd's `global-setup.ts` cold-builds cargo without `CARGO_TARGET_DIR` in a worktree.

**Gate, at the final tip (`bbe551a5`; the landing script — `pnpm verify` verbatim, then every stage after lint):** preflight OK (the two sibling-dirty warnings are James's trees) · `check:ios-fixtures` 17 copies + 15 registry values identical · typecheck 25 projects · lint stops on James's untracked `work/` only (10 errors, none elsewhere) · fmt 0 · clippy 0 · `bundle:assert` 0 · `pnpm test` 0 for 25 projects (fieldd 86 files + 1 skipped, field-app 90, electron-shell 69, contracts 25) · `pnpm test:rust` 0 — 20 suites, 244 passed, 0 failed, 7 ignored (the key-gated live probe among them) · gen:check's Rust half 0 (`tm-gate-6.log`). The kit: 702 tests / 131 suites on a simulator created for the run and deleted (`kit-run-tm3.log`), after tm-bearer's two identical runs.

**The witnesses that are James's:** a serving desktop with `FIELD_NATIVE_MESH=1 FIELD_NATIVE_TERMINAL_MESH=1` and the phone signed in — the deck opens panes with the flag on (the first time that is possible), a live shell's frames reach the phone through the sidecar's proxy, a keystroke lands, the deck shows the same session; the sidecar's WebSocket upgrade reaching a REAL floor's cell (a floor cannot join a tailnet headless — no auth-key path, an NF follow-up); the byte credits sized for loopback over a real link; a physical phone; a new TestFlight build. **Owed:** the floor's auth-key path for tests; the second desktop (TM-D6, deferred — a desktop has no tailnet socket of its own); the probe's seed arm (its client flow); a kill affordance for the deck (GT-6a); GM-D10's remainder (`field.agents.v1`); G27 (filed, with the `GhostteaFrame` product rider) and T3 (the UDP relay's registration); IOS-EL8.

## TM-r — the review of the terminal mesh on the cells: six lenses, four lanes, and what they found (2026-09-14; main `496f9e3f`)

**The round.** James: "Now do a review round" (13:14, the evening the T rollout landed). Six READ-ONLY lenses over `f999b6e1..37e36389` — EL7 (rv-el7, on the strongest model), fieldd + contracts (rv-fieldd), field-native (rv-floor), the kit (rv-kit), tests and witnesses (rv-tests), the record (rv-record) — each finding graded HIGH / MEDIUM / LOW with `file:line`, a failure scenario, the smallest fix and how to verify; then three fix lanes in worktrees (tmr-kit, tmr-fieldd, tmr-floor), a record lane (tmr-docs), and two fixes by the orchestrator. Seven HIGH, fifteen MEDIUM, about twenty LOW; every HIGH and every MEDIUM is fixed on main except the ones recorded as James's below. The findings ledger is the session's `tm-review-findings.md`.

**The HIGHs, and what they were.**
- **(E-F1) `HelloAck.terminalMesh` was read ONCE, at a moment it is predictably FALSE.** The tailnet node is installed by a spawned bring-up task after the mgmt listener binds; fieldd hellos at dial; nothing re-hellos — so a cold boot with both mesh flags set never published a door until fieldd alone re-paired. Phase 0 as scripted would have hit it first. Fixed by the floor lane (TM-r13 `8e9cfbb8`): the floor PUSHES the reading — `TerminalRoutesStreamPayload` (the route snapshot + optional `terminalMesh`) on the routes subscribe result and every delta, emitted on a routes move and on a node-presence flip when the composed reading moved; `MeshPlan::publishes(node_present)` is the one composition (a truth table over all four combinations, mutation-probed — TM-r16 `3419642a`); fieldd's `applyTerminalRoutes` reads it before the revision short-circuit and emits `terminal-endpoints`. Found on the way: the forwarder re-sent the subscribe snapshot as a delta on every subscription (`borrow_and_update()`). A tailnet node cannot be built headlessly (an interactive browser login), so a test seam forces presence — the live flip on a REAL node install is a hardware witness owed.
- **(N-H1 + T-M1) the live probe's seed-less result was attributed to a cause the cell cannot have** (`route_revision` is read by nothing outside test fixtures; the clientId check demonstrably passed), and its seed assertion was an Option equality that held because BOTH arms were None. The cause, found by draining the control leg the probe had been discarding: `CellActivationStatus {presentation: stopped, reason: overload}` at 3004 ms — `wait_for_credit`, not the seed wait — because the probe advertised a 1 MiB window BELOW the cell's 2 MiB urgent reserve, so bulk headroom was zero; AND a real cell defect: `CreditLedger::new` clamped the reserve to the limit under a comment claiming it prevented exactly that starvation (now `.min(connection_limit / 2)`, inert at product sizes; no refusal, no log, "overload" three seconds later was the whole symptom). The probe reads the registry's capacities now, builds its route through the production `build_serve_config` (T-M4), and the live arm decodes a real 812-byte seed through the real sidecar over a real tailnet, twice (TM-r14 `355c00e8`).
- **(N-H2) a cell-routes serve with an EMPTY allow-list published every cell door to the WHOLE TAILNET** (truffle: "empty = whole tailnet"); the floor never refused it, only fieldd's policy did. Refused now with the citation (TM-r15 `355f6ef7`).
- **(F-H1) a terminal serve OUTLIVES fieldd and the next fieldd never withdrew it** — `declared = "none"` made the first refresh a no-op when the policy computed null, so 9422 could keep listening with the predecessor's allow-list and routes aimed at recycled loopback ports. The first refresh always declares, a withdrawal included (TM-r4 `5d82cc74`, fieldd lane); the window while fieldd is DOWN remains and is bounded because no grant can be minted then.
- **(F-H2) `DeviceCapabilities.terminalMesh` read the floor's boolean** — TRUE with zero routes published in the pre-capture window. The mint and the capability now read one `publishedTerminalServe()` (TM-r5 `ad456aa5`).
- **(F-H3) the mgmt wire's `routes` serve target existed in fieldd and the floor and NOT in contracts** — the EL9 golden was blind to the shape the daemon really sends. `ServeRoute`, the arm, `ServeConfig.routes` (a `ServeRoutePrefix` newtype in Rust from the schema pattern), a golden DERIVED from `terminal-routes.doors.json`, its parity row, and `MeshClient` parses every spec with the contract before sending (TM-r6 `e9ec642d`).
- **(K-H1) a FULL frame the phone's sink refused was still acknowledged as applied** — a seed the phone cannot decode left the glass blank under `.live`, with the cell never reseeding. `applyFullFrame` answers like its sibling; a refused scene is never reported applied; a refused repair is asked again up to three consecutive times, then the card says why (TM-r4 `22552290`, kit lane). Two doors, not one: the transfer path and a bare `trf1-frame` with a null base.
- **(T-H1) every phone-side TPv3 reader was tested against hand-typed JSON** while contracts goldens for those exact shapes sat unused and the readers are strict; the hand-written accept disagreed with the golden on nine fields, two of them limits the client reads. 23 goldens copied, every reader decodes the file, `Script.accepted` derives from the golden in both bundles; 40 copies are byte-gated (TM-r3 `1894c887`) — which holds because **(T-H2)** the fixtures checker no longer silently skips a copy whose contracts origin is gone (TM-r1 `2f6c9c35`, the orchestrator; a planted orphan reds).

**The MEDIUMs, fixed.** Two of one person's devices are two clients (`tailnet:<login>#<nodeId>`; they no longer supersede each other on one cell — TM-r9 `345efe7f`) · the attach join withheld on BOTH carriers of the field through one `attachableRows` (TM-r7 `b3584296`; not moved into the projection, which would bump the board revision on a gate flip) · a route declaration counts as landed only when the node really placed it (TM-r8 `8cf5e66c`) · an unlinked desktop refuses a non-self tailnet caller with `device_not_linked` instead of handing it its own loopback ticket, who is admitted unchanged (TM-r10 `84a92019`; the phone's sentence TM-r11 `03d487e8`) · the compression refusal asserted against a client that actually OFFERS `permessage-deflate` — no product defect, the door answers 101 without the extension (TM-r17 `0eaa5e21`) · the EL7 env strip witnessed on the plane that performs it, real cell and real PTY, mutation-probed (TM-r18 `a365175f`) · the routes forwarder's delta rule driven through five steps (TM-r19 `7f7a524a`) · an established leg outlives its transport grant (TM-r20 `4778613e`) · the refused re-mint reaches the card and a locally refused ticket keeps re-minting (TM-r5 `0d4367cb`) · the three Int64 traps, plus three more the lens did not name and a BACKWARDS grant window that read valid (TM-r6 `4104918a`) · the card's false "renewing it" sentence replaced by the truth and the act — renewal itself is NOT built, a product-wide follow-up shared with the renderer's `session-grants.ts` (TM-r7 `2fe9ae57`) · the retired-key sweep's query witnessed (no value read; by service; a refused delete is not recorded as done) — the run-based witness is impossible in a SwiftPM bundle (`SecItemAdd` → -34018, measured) and is a device item (TM-r8 `28800aa2`) · `settle` throws on timeout and returns the matched value (TM-r9 `93d2b167`).

**The record.** TM-r2 `7d841e86` (tmr-docs): fourteen corrections at their sources — two written by the wave itself (§TM-3 claimed a TESTFLIGHT note that was withheld; §TM relayed a kit count no log witnessed), an open security debt about a door retired at TP-S3e, the pins block's stale ghosttea number, a pre-AR-2 paragraph, two petition numbers already taken (G12/G13), the GT paragraph's deleted floor half, smoke row 13b's meaning under T (it waits on TM-6), README's floor description, GM-D10's retired store, the Windows status's deleted suite, MF-1l's closure (TM-1/TM-2), and the "~10 min tombstone" figure (a mint's nonce is held 65 s; ~10 min is the high-water tombstone per connection set, ten times too high in the safe direction). **STALE_ROUTE is recorded UNBUILT** at both code sources (TM-r21 `3f7dcb56`) and at three places in the door spec: nothing raises 4000, a cell has no inbound route channel, and route churn tears the sidecar's connections down first — the kit's recovery arm answers an event that never comes; recovery rides transport death.

**Recorded, not fixed — James's.** (1) both carriers of the agent field read the floor's boolean while the mint reads the live serve: in the pre-capture window a tap can be offered that `doors_not_published` refuses; the stricter reading BLINKS on every cell birth (a cell birth is a remove-then-add of the serve; truffle's proxy has no route update) — his trade, or a latched reading. (2) the K-H1 bound's banner prefix "the connection failed —" is wrong for a viewer that cannot show a scene; `TerminalPhase` has no case for that (card vocabulary). (3) a locally refused ticket shows "connecting over the mesh…" honestly, but its reason reaches no face. (4) `previewDir` on a cell-routes serve mounts a static directory (nothing sends it; behind the login gate since the empty-allow refusal) — refuse it as `pathSecret` is refused. (5) the generic `spawn_forwarder` has the first-`changed()`-resolves-immediately shape the routes forwarder had. (6) the first declare vs `api.listen()` ordering in the daemon (listen wins in practice). (7) the mint is unpaced (a per-clientId bucket, optional). (8) the credit pump's 8 ms main-actor timer. (9) the proxy's assumptions are unpinned by `pnpm verify` because the probe is key-gated; the door's handling of a deflate offer is now measured at the DOOR, the sidecar's own hijack is not — a truffle petition candidate. (10) the hardware witnesses: the live `terminalMesh` flip on a real node install, the retired-key sweep on a device, the win32 arm of the env-strip row, and Phase 0 itself.

**Lessons.** A note written before a later slice's correction is a class to re-check (native-floor §7 said "the product serve's port" for a day). Three lanes numbered their commits from TM-r3 independently; the floor lane renumbered its ten to TM-r13…TM-r22 at its rebase, the fieldd lane's TM-r4…r12 and the kit lane's TM-r3…r11 still overlap in subject — the SHAs in this entry are the identity (the three stale comments the lanes handed each other closed in TM-r22 `496f9e3f`). A crashing Swift row leaves a GREEN totals line (xcodebuild restarts the bundle and drops the row); a kit witness reads the exit code and the restart line. The bearer lane's three reports sat unread for twelve hours because they never arrived as messages — a lane's scratchpad is worth a look when a report is late.

**Gate at `496f9e3f`** (the landing script, `pnpm verify` verbatim first): preflight OK (the two sibling-dirty warnings are James's trees) · `check:ios-fixtures` 40 copies + 15 registry values identical · typecheck 25 projects · lint stops on James's untracked `work/` only (10 errors, none elsewhere) · fmt 0 · clippy 0 · `bundle:assert` 0 · `pnpm test`: 24 of 25 projects green and fieldd 867 passed / 14 skipped with ONE red — `agent-session.test.ts` › "the pane stays and the row with it — exited, hosted, resumable — until the pane is closed" (a real floor, a real ended run, the file at 65 s under the full-suite load) — isolated on the same tree THREE times, 18 passed / 2 skipped each, ~50 s a run: a lottery row under load, in the file the floor lane also saw flap once on a different row, not a regression (the row reads the door-side field snapshot for `alive` and `pending` only, which the join gate does not touch) · `pnpm test:rust` 0 — 20 suites, 253 passed, 0 failed, 7 ignored (+9 rows over the wave's tip; the key-gated live probe among the ignored, green twice with the key in the floor lane) · gen:check's Rust half 0 (`tm-gate-7.log`, `tmr-isolate.log`). The kit: 744 tests / 138 suites on a simulator created for the run and deleted, 0 restarts after a crash (`kit-run-tmr.log`); the kit lane's own run on a throwaway worktree at the same tip was identical.

## UA-P — the account is the ground: the phone honors the user-account foundation, and the mesh fails closed (2026-09-15; main `68b62fb1`)

**The question and the answer.** James, the evening after the TM review: "a very important user system foundation is our user account architecture … one to one relationship to a user-provided tailscale account, which is the foundation for mesh networking … for the iOS app we need to honor this user account system as a foundation layer … check if this is done properly." Three read-only lanes audited it (ua-desktop · ua-phone · ua-mesh; `draft/thinking-ua-phone-account.md` §1 carries the file:line record). **It was not.** The desktop's binding was real and sound at the two doors that read WhoIs — the product door and the cell-routes serve — and nowhere else: the phone had no account of its own (no login learned or shown, no self/guest reading, every VibeField node dialed, every desktop's agents drawn through the store leg that bypasses the door, the hello's empty-grant guest signal decoded and unread, no sign-out); the account was invisible on the wire (no slice carried an owner; the roster's `self` meant the daemon's own row); the store bus was a namespace, not a boundary (every VibeField node on the tailnet, and any node that claimed the app id in its hello, received the roster with its capability URL and route secret, every agent's branch/model/effort/blocker, and artifact titles; writes unauthenticated per slice); an unlinked, tagged or corrupt-link desktop FAILED OPEN with the full tailnet preset and an allow-less serve; the route secret was persisted in the clear; doc-sync had no login gate in either direction; two local users could link one tailscale account unnoticed. All of it latent under the env flag nobody sets — and live the day the mesh turned on by default.

**The rulings (James, 2026-09-15; DECISIONS UA-P-D1…D8).** D1 unlinked = a default local account and an OFFLINE desktop — no node, no serve, no store, no lane; the posture derives from the link (NF-8's toggle collapses into it) · D2 every store is SCOPED to the login identity — an upstream gate is the law; until it lands nothing content-bearing rides the bus, and the phone discovers desktops by dialing their doors · D5 documents sync only among same-login desktops · D6 an artifact's audience defaults to its owner · D7 the secret never rides a store or the disk · D8 one local user per tailscale account, the second link refused until the first unlinks · D3 stands (the login on truffle's Apple plane, the tailnet domain interim) · D4 (the phone's sign-out and switch) OPEN.

**UA-P-0, the desktop (uap-desktop; `4b78081b` · `20f06a10` · `2c1c6642` · `8c8575c1` · `f861dd58` · `5f147fea`).** The mesh posture derives from the link: `native.mesh.start {mode: "capture" | "linked", login?}` and `native.mesh.stop`, the modes validated against each other, a capture-mode belt in the floor that refuses `serve.add` and `store.set` while capturing, `user.link.begin` audited beside unlink, `UserLinkStatus.linkState` (offline · capturing · linked · link_corrupt · login_unavailable · login_already_linked), the unlinked grant branch deleted (`tailnet-door.test.ts` flipped to assert the refusal), `FIELD_NATIVE_MESH` a forced-on development override only · the second link refused naming the other user · an artifact's allow defaults to the owner, and a publish naming no allow on an UNLINKED desktop is refused `not_linked` rather than inheriting "the whole tailnet" (beyond D6's text, stated) · the sidecar adds the secret on forward — every route handler is `httputil.NewSingleHostReverseProxy`, whose director joins the target's path, probed with a real round trip and a path-less control — so the product serve is `/` → `http://127.0.0.1:<port>/t/<secret>`, the phone dials a bare root, the door still sees the secret, and the secret never leaves the desktop; the mesh state dir 0700 · a new registry row **`PORTS.FIELDD_PRODUCT_SERVE = 9423`** — the product door's tailnet listener was fieldd's EPHEMERAL control port (no published slice, nothing to learn a port from) and is fixed now · nothing content-bearing rides the bus: `mesh-bus.ts` holds `MESH_BUS_CARRIES_CONTENT = false` with the argument; the roster derives from `native.mesh.peers.list` (which had carried `whois.login` since the T1 petition) joined to the linked login; `native.mesh.peers.subscribe` gained its first consumer; `DeviceInfo` no longer extends `DeviceSlice` (seven fields optional on peer rows); the artifact catalog's two bus legs off, the bridge kept so the user's own artifacts still list · documents and presence only among same-login desktops, an inbound lane from outside the set refused, two deliberate fail-closed beats. Contracts 484 · fieldd 894 + 15 skipped · cargo 258 + 7 ignored; gen, fmt, clippy, typecheck, lint clean.

**UA-P-1, the phone (uap-phone; `7cf5325e` 1b · `12ed613e` 1a · `78429838` 1c · `4c63c367` 1d · `35b3356d` the schedule rows · `21d829fd` the pin · `fdfb2ed2` the wire; rebased over the desktop stack).** Discovery by the door: `FieldMeshContract.productDoorURL(host:)` = `ws://<peer FQDN>:9423/`, a plain GET probe first because an upgrade cannot tell a 403 from a sleeping door, four outcomes per peer (403/401 ⇒ not this account's, never drawn, logged in `foreignDoors`, re-asked in 300 s · a hello with an empty grant ⇒ the same · a hello with a grant ⇒ a `FieldDesktop`, and `device.list` called at last · no answer ⇒ `noDoor`, re-asked in 30 s); the EL7 pin keeps the host equality; the store reader dormant behind `FieldStoreBus.enabledByDefault = false` until the scoped bus returns; the account line "signed in to <tailnet domain>" with a row pinning that it claims nothing about who; the guest face of the design resolved as an absence — under D2 a foreign desktop is never drawn, so there is nothing to label; the checker's `FIELDD_PRODUCT_SERVE` pin armed on arrival; the wire change absorbed — `DeviceInfo.platform` optional, `?? nil` rather than an invented empty answer, the peer-row golden copied and gated (41 copies); found and fixed on the way: `pause()` left clients open so `resume()` never re-armed a subscription (a phone back from the background behind a stale "connected"). Kit: 770 tests / 144 suites on a simulator created for the run and deleted, 0 restarts after a crash, at `be63d85f` (`kit-run-uap2.log`); the lane's own two runs at `fdfb2ed2` read the same.

**UA-P-0g (mine, `66541cb6`).** The phone lane found the desktop's derived locator naming `https://` for a serve declared `tls: false` — a scheme the door does not answer, baked into a golden, invisible because the phone builds its own address; `http://` now, the golden and its byte-gated copy together — and one kit row still asserted the old string, which the orchestrator's kit witness on `66541cb6` caught (the fixtures checker gates BYTES, `pnpm verify` never runs the kit; a golden change reaches a kit expectation only through a kit run): UA-P-0h `be63d85f`. The lesson both lanes wrote down: a golden or literal the same lane authors in the same sitting pins its assumption — four green rows agreed with the wrong scheme; the consumer that DIALS is the witness. The same assumption sat in the peer-link e2e's stand-in sidecar, which forwarded only `wss`/`https` dials and let the new `ws://<magicdns>` dial through to nothing — six rows red in the gate on `66541cb6`; it keys on the tailnet HOST now, as the real sidecar does (UA-P-0i `68b62fb1`; 10 of 10 twice alone).

**Filed upstream (James's repo).** **T4** the login name on truffle's Apple plane (self and per authenticated peer — the LocalAPI answer carries it and the decoder drops it) · **T5** the synced store scoped to a login: a per-store login allow-list evaluated at the hello by WhoIs (the shape `ProxyConfig.allow` already has), sender-bound slice application (TF-2's fix), an accept loop that honours the layer-3 app-peer filter, and no fail-open when the bridge supplies no node id. The bus returns, scoped, at UA-P-4 when T5 lands.

**Owed.** D4 (James) · the phone's own login (T4) and the real account line · UA-P-4 the scoped bus · `MeshLanePeerOpened.whois` declared and never populated (an owed slice) · the two-account tailnet witness James has owed since UA-4 · the live sidecar forward on a real tailnet (the probe ran on go 1.25.6 against a 1.26.5 sidecar) · Phase 0.

**Gate at `68b62fb1`** (the landing script, `pnpm verify` verbatim first): preflight OK (the two sibling-dirty warnings are James's trees) · `check:ios-fixtures` 41 copies + 16 registry values identical · typecheck 25 projects · lint stops on James's untracked `work/` only (10 errors, none elsewhere) · fmt 0 · clippy 0 · `bundle:assert` 0 · `pnpm test` 0 for 25 projects (fieldd 86 files + 1 skipped, no red row) · `pnpm test:rust` 0 — 20 suites, 258 passed, 0 failed, 7 ignored · gen:check's Rust half 0 (`uap-gate-3.log`). The two earlier gates on the way: `5f147fea` (the desktop stack) all green; `66541cb6` red on six peer-link e2e rows (the harness's scheme assumption, UA-P-0i) and the agent-session load flap (twice green alone). The kit: 770 tests / 144 suites at `be63d85f`, 0 restarts after a crash; the harness fix after it touches no Swift.

## UA-P-W — the truffle side of T4/T5 built upstream as RFC 025, and the petition window opens on both planes (2026-09-16; main `4b1385e3`)

**The ask.** James, the morning after UA-P landed: "Now plan and work on the truffle side of work, land the proper and solid." The truffle side is petitions T4 (the login name on the Apple plane) and T5 (the synced store scoped to a login), filed the day before against James's own repo, which nothing in this repo could consume until it existed.

**Built upstream (James's truffle, local branches, nothing pushed).** The design of record is truffle's `docs/rfcs/025-login-scoped-nodes.md` — RFC 025 "login-scoped nodes: the tailnet login as the mesh boundary" — written first, then built in three lanes plus the orchestrator: the Rust core (the orchestrator: the `path.Match` glob port shared by all three planes, the hello gate 4003/4004 that refuses before revealing our hello and never falls open when gated, `HelloRefused` on the dialer, sender-bound store slices and `Clear`, and a pre-existing bug found on the way — a departed peer's slice was removed by its Tailscale id against a ULID-keyed map and so never removed, hidden by a mock peer that violated RFC 022 I1), Layer 3 (lane t5-l3: the sidecar's `loginName` on every peer row and the self status at protocol 5, the provider's row verdict Allowed/LoginRefused/LoginUnknown/NotOurApp with eviction on both the snapshot and delta paths, the start refusal below protocol 5, the NAPI/Tauri/CLI/TypeScript mirrors, a three-node real-tailnet witness with its own latency control), and the Apple plane (lane t4-apple, stacked on James's open PR #188: the login on `AuthenticatedPeer`, `BackendPeer`, `BackendStatus`, `Peer`, `MeshNode`; the Swift gate; `LoginGlob`; eviction; `helloRefused`; `MeshNode.whoIs`). Decisions as built, per the petition's asks: the gate is PER NODE, not per store (a per-store list would leave the connection open to a foreign login for every other namespace); the hostname-prefix half of the Layer 3 filter is deliberately NOT enforced at the hello (RFC 023 §6.4 custom hostnames) — the login is the admission rule; a gated node refuses to start on a sidecar that cannot report logins. Found on the way, corrected at their sources: the pinned TailscaleKit decodes `PeerStatus` without `UserID`, so the Swift logins come from one extra authenticated GET of `/localapi/v0/status` overlaid onto the status (RFC 025 §3.3's dated correction; RFC 024 §8.1.2 carries the mechanism); Rust's and Swift's full case mapping diverges from Go's per-rune `ToLower` on Turkish `İ` only, deny-side.

**Reviewed, twice, read-only.** The Apple review found a HIGH and proved it live: the gate ran only at entry creation, so a login CHANGE on an admitted peer — a device transfer keeps the stable node id — bypassed it in both directions. Its Rust twin was there too (the `peerChanged updated` arm did nothing on a refusal). Both planes now carry the ruling "admission ≠ membership": a refused login is a departure (the entry removed, the session closed); an unresolved owner keeps the peer but reports its login ABSENT and a gated node opens no new session to it, while an existing one stands, so both directions agree with the inbound gate. The Rust/Go review then found two MEDIUMs: a hello-only peer's slices (RFC 023 §6.4 custom hostnames) were dropped forever because their identity never left `pending_identities` — bound to the verified hello now, first-wins respected — and the keep-on-unknown rule had falsified the dial side's reason for having no check, which is the refinement above. A lesson both reviews taught and both lanes then applied: a test that re-implements the predicate inline passes with the production guard deleted — DELETE the guard, not only mutate it; two such rows were found and replaced with rows that drive the real node.

**Gates at the tips** (Rust/Go branch `feat/rfc025-login-scoped-nodes` `66dcbd6`, 19 commits over v0.7.13; Apple branch `feat/rfc025-apple-login` `5fc40f8`, 14 over #188; local integration `integration/rfc025` `8abd825`): `cargo fmt` · CI's clippy line · `cargo test -p truffle-core --lib` 354 passed / 3 ignored (was 318) · `truffle-cli` 52 · every integration binary with the real authkey — network 9 (the gated-pair witness), synced_store 4, eager_identity 1, file_transfer 3, request_reply 3, interop fixtures 4 · doctest · `go vet` + `go test -race` 49 · `packages/core` node 64 · Swift 70 → 107 tests / 17 suites, both iOS destinations built serially, zero warnings. What James owes upstream: pushing both branches (the PR bodies are drafted in the session's `pr-bodies.md`) and tagging 0.7.14; the phone's production LocalAPI reads on a device; the two-account tailnet witness.

**The window (lane vf-window; `af3a97db` · `7cc29510` · the re-pin `4b1385e3`).** CLAUDE.md's sanctioned mechanism for a petition window, reopened on THREE planes and pinned by one revision: root `Cargo.toml` at `truffle-core = "=0.7.13"` with `[patch.crates-io] truffle-core = { path = "../truffle-rfc025/crates/truffle-core" }` (the lock moved by one line; `cargo tree -i truffle-core` shows one crate, from the path, and field-native is the graph's ONLY consumer — the manifest's claim that ghosttea "brings truffle-core of its own" had been false since TM-1 and carries a dated erratum now); `siblings.lock.json`'s `truffle` entry `{path, sha, patch, swift, go}` written by `pnpm siblings:pin`; `scripts/siblings.mjs` + preflight extended — a patch row must name a path inside a lock-backed sibling and a lock entry must have its row (all-or-nothing), HEAD ≠ pin FAILS, the built sidecar missing or older than any Go source WARNS; `pnpm siblings:build` also runs `go build` from the sibling into `target/debug/sidecar-slim` BESIDE `field-native`, the floor's first search location, so the dev stack picks the protocol-5 sidecar up on its next restart with no env var (the packaged app keeps npm's 0.7.12 sidecar and cannot run a gated node until 0.7.14 ships — said where it belongs); the SwiftPM plane needed a mechanism nobody anticipated — a path package's identity is its DIRECTORY NAME, so `../truffle-rfc025` put two truffle packages in the kit's graph beside ghosttea's remote edge and SwiftPM refused; a committed symlink `apps/ios/VibeFieldKit/.window/truffle` gives identity `truffle` and the root-local package overrides ghosttea's edge (SwiftPM warns it will one day be an error; documented in the manifest; biome's root config excludes the resolved tree it would otherwise lint). Also found: the Nx `siblings` named input had been DEAD since AR-0 (defined, referenced by no target), now referenced by `default` with a regression row; `pnpm siblings:pin` warned about a GitHub URL it had never read — it reads each checkout's own origin now, and warns for all three siblings because every pin is unpushed (CI cannot be green with or without this window; stated in the workflow header). The 8-place EXIT list sits in `Cargo.toml` above the requirement: when James tags 0.7.14, delete the patch, pin `=0.7.14`, delete the lock entry, restore the exact SwiftPM tag, remove the symlink, bump the npm sidecars.

**Gate at `4b1385e3`** (the landing script, `pnpm verify` verbatim first; `win-gate-1.log`): preflight OK (the two sibling-dirty warnings are James's trees; truffle at its pin, clean, sidecar fresh) · `check:ios-fixtures` 41 copies + 16 registry values identical · `pnpm verify` stops at `@vibefield/field-app:typecheck` — three TS2353 errors in `godview-usage-history-cache.test.ts` (`UsageLedgerRecord` has `boundary`/`total` at puppeteer's PINNED revision and `currency`/`runs` in its UNCOMMITTED rewrite; 71 dirty files in that checkout as this landed) — which the lane reproduced on a pristine detached checkout of `d3fc3292` and which preflight's "verify runs against unpinned edits" warning names: James's, not this slice's; the lane's own biome pass was 1329 files, 0 errors, 31 warnings, main's exact counts · every stage after, alone: fmt 0 · clippy 0 · `bundle:assert` 0 · `pnpm test` 0 for 25 projects (fieldd 86 files + 1 skipped, no red row) · `pnpm test:rust` 0 (20 suites) · gen:check's Rust half 0. The kit witness (the lane's run at the landed tip, on a simulator created by UDID and deleted after): 770 tests / 144 suites over 9 bundles, exit 0, 0 restarts after a crash, compiled from the sibling's `apple/Sources` at `8abd825` — identical to its run at the pre-review tip, so the 40-line `MeshNode` refinement costs the kit nothing; preflight at the landed tip caught the re-pin's stale sidecar (its first real case, a WARN by design) and `pnpm siblings:build` cleared it. The lane's own run at `7cc29510`: every stage green except `@vibefield/field-app:typecheck`, three TS2353 errors in `godview-usage-history-cache.test.ts` that reproduce on a pristine detached checkout of `d3fc3292` — the cause is James's DIRTY puppeteer working tree (the usage-ledger rewrite in flight there; 20 → 71 dirty files during the lane), exactly what preflight's "verify runs against unpinned edits" warning names; kit 770 tests / 144 suites, compiled from the sibling's `apple/Sources`.

## UA-P-5a — the phone's node starts gated on its own login, and the store bus comes back inside that gate (2026-09-16; main `77a771c7`; lane vf-phone)

**The slice.** UA-P-5's T4 half, the day the truffle side landed (§UA-P-W): the phone honors the account foundation with truffle's login surfaces instead of a domain string. D4 — sign-out, account switching and what clears — stays James's and is untouched; a row pins the boundary (a marker file in the state directory survives a re-gate byte for byte).

**As built.** `Sources/FieldMesh/AccountGate.swift`: `AccountGate.step(gatedOn:reports:)` is a pure five-row machine — gated on nothing and the node reports nothing → wait (the pre-login window); nothing and a login → REMEMBER it (`account.login` beside truffle's state, written BEFORE the restart so a launch that dies between comes back gated), stop, restart gated on it — one restart per fresh sign-in and no browser round because the tailscale state persists; a login and the same one (case-insensitively) → settled; a login and ABSENT → nothing, because absent is not a switch (the Apple plane reads the login through a status overlay that can fail, RFC 024 §8.1.2, and a thin refresh must not tear the node down); a login and another one → RE-GATE (write, stop, restart) and clear nothing. A write that fails answers "nothing" and records why rather than asking for a restart that cannot stick. A login is not a glob: `AccountGate.glob(for:)` escapes `\ * ? [`, and the rows drive truffle's own `LoginGlob` to prove the escaped literal admits itself and refuses `ab@` and `aXb@`. `FieldStoreBus.enabledByDefault = true`, but `FieldLink(storeBus:)` defaults to false — fail closed — and the live wiring passes `enabledByDefault && mesh.nodeIsGatedOnAccount`, so the bus reads only inside the gate and the ungated pre-login window publishes and reads nothing. `FieldStorePeer.loginName` rides from truffle's `Peer`; a peer whose stated login differs from this node's is refused before a socket is spent. The account line asserts WHO — `"<login> · <domain>"` — with the UA-P-1c domain line kept word for word while the login is unknown. `foreignDoors` kept and narrowed: empty by construction under a gated node; still filled in the pre-login window from two verdicts (a differing Layer 3 login; the door's 403 or empty grant), so the optional "N other accounts' desktops" line has something true to count in exactly one window — not drawn.

**Where the door probe and the store bus disagreed.** (1) A foreign desktop's board could reach the fold: `refold` folded a board for every device id it knew while `refreshDesktops` dropped peers the door refused, so with the bus on, a desktop the phone had already established belongs to someone else would have put bodies on the field with no desktop row to explain them — closed by `FieldLink.sliceIsDrawable`, witnessed by `aRefusedPeersBoardIsHeldOffTheField`: held with no verdict yet, held on `notThisAccount`, DRAWN on `unreachable` (a sleeping door is not a refusal, the peer is one truffle's gate admitted, liveness is not a stand-in for authorization, and §5's hybrid is a board that arrives with no connection needed; the strict reading is one enum arm if James wants it). (2) RFC 025 §3.3's one-shot health notice — a gated node saw an app peer it cannot name an owner for, the only warning that an empty mesh is the overlay failing rather than a quiet tailnet — was being dropped with every `.health` event; it lands in `MeshModel.accountNote` now, a face for a later slice. Pre-existing and fixed: the `-vf-demo-field-slice` screenshot lab had read no store since UA-P-1b (its link took the defaulted flag; the golden test built its own link and never noticed) — named at the call site now.

**Witnesses.** The lane: `check-ios-fixtures` 42 copies (one new, `device-slice.valid.json`, byte-identical to its contracts origin) + 16 pins; the kit on a simulator created by UDID and deleted after — 806 tests / 150 suites (770/144 at UA-P), 0 restarts after a crash; the device slice built serially (`-skipPackagePluginValidation` is required for ghosttea's Metal plugin, and `swift build` cannot check this iOS-only package at all — xcodebuild is the only compile witness). The orchestrator's landing kit run at `77a771c7` (`kit-run-uap5.log`): 9 bundles, 806 tests / 150 suites passed, exit 0, 0 restarts.

## UA-P-4 — the floor starts gated on the linked login, and the store bus returns, scoped (2026-09-16; main `87987bc4`; lane vf-desktop)

**The slice.** The desktop half of consuming RFC 025 (§UA-P-W): James's D2 — the ecosystem linked with a user account interacts only with the tailnet nodes under that user's login, every store scoped to it — becomes the floor's node construction, and the switch UA-P-0e turned off (`MESH_BUS_CARRIES_CONTENT`) turns back on because the reasons it was off are gone upstream.

**As built** (`f9357483` UA-P-4a · `87987bc4` UA-P-4b). `spawn_bring_up` hands truffle `.login_allow([login])` for exactly the captured login — one entry, never a widened glob (D2 scopes to the login identity; `*@domain` would be a wider ruling than the one made); capture mode and the `FIELD_NATIVE_MESH` development override stay ungated, the first because the tailnet has not said who this node is yet and the capture belt holds that window, the second because the probes have no account to scope to. The gate forced a correction to UA-P-0a: `MeshHandle::start` returned early on any posture change to a live node ("costs no restart"), true while the login was only a record and false under RFC 025 §3.1 where the gate is fixed for a node's lifetime — the ordinary capture → linked promotion would have left an UNGATED node wearing the account's name and made the slice inert on the product path. The promotion rebuilds now (same state dir, identity and keys — no second interactive login), and the floor records what the live node was actually built with rather than re-deriving it from the posture. A gated bring-up against a sidecar below protocol 5 degrades with truffle's sentence verbatim, witnessed by a real stub sidecar process at `protocolVersion: 4` with a capture-mode control. Peer rows take `whois.login` from Layer 3's `Peer.login_name` — on a gated node the very fact that admitted the peer — with `node.whois(ip)` kept for the MagicDNS name RFC 022's `Peer` does not carry (the brief's "the RPC stays only as the fallback", taken literally, deleted every peer's door on the first cut) and as the login fallback on ungated nodes only. `native.mesh.self` takes its login from `NodeIdentity.login_name` and gains a REQUIRED `loginAllow: string[]` (contract, two fixtures, Rust golden parity, `gen:rust`), so a reader says "gated" from a fact. `MESH_BUS_CARRIES_CONTENT = true`: devices, agents and artifacts publish and consume again; the published device slice carries no route secret — proved against the published BYTES with a positive control that the secret is live in the serve declaration; a peer's door coordinate stays derived; the tailnet's peer registry is the authority on membership (a slice may describe a device the registry lists and never add one, the drop logged once per device). The artifact catalog deliberately keeps AH-2's retained last-known-safe metadata for a departed owner — an unlisted origin already yields an inert, URL-less row — and the rejected alternative is recorded where someone would next try it. Two comments claiming "truffle's `Peer` carries no tailnet login" carry dated errata. Seven `native.mesh.self` stand-ins state their gate (required — a stand-in omitting it stands in for a floor that does not exist); the artifact two-stack convergence row is unskipped, its stale `me@example.com` peer logins corrected (they made the two desktops strangers).

**Witnesses.** The live one is new: `packages/field-native/tests/mesh_login_gate_probe.rs` (`#[ignore]`d on the key), run twice on the real tailnet — a node gated on the account's own login, read live from Layer 3 (the T4 witness), sees the account's peer AND the synced store converges across the gate; a node gated on a glob that cannot match holds 0 peers in the beat the ungated control holds 2. The lane's gate: `pnpm verify` verbatim red on `@vibefield/field-app:typecheck` only (James's dirty puppeteer tree, as at §UA-P-W); every stage after, alone: lint 0 (31 warnings, main's), fmt, clippy, `pnpm test` 25 projects (fieldd 894 / 14 skipped across 87 files, contracts 487, field-app 767), `pnpm test:rust` (field-native lib 138, `mesh_unit` 8, `fixture_parity` 12); `gen:rust` idempotent and `gen:docs` diffed identical; `46df8332` stands alone in a throwaway worktree (contracts 487, fieldd 894).

**Found, owed to the window.** `apps/desktop` pins `@vibecook/truffle-sidecar-*` 0.7.12 — pre-RFC-025, protocol 4 (verified: the built sidecar has `loginNameForUser`, the npm one does not) — and `scripts/stage-package.mjs` staged exactly that beside `field-native`, where the floor looks first: a PACKAGED desktop that links would build a gated node against it and every linked desktop would degrade at bring-up. Dev is unaffected (`pnpm siblings:build` puts the protocol-5 sidecar there). The staging follow-up `window/rfc025-stage` (the packaged build stages the sibling-built sidecar while the window is open, and fails loudly rather than falling back to the npm binary) is in flight as this is written and gets its own line below when it lands; the 0.7.14 tag carries the npm sidecars with it.

**Gate at `87987bc4`** (the landing script, `pnpm verify` verbatim first; `uap4-gate-1.log`): preflight OK (the two sibling-dirty warnings are James's trees; truffle at its pin, clean, sidecar fresh) · `check:ios-fixtures` 42 copies + 16 registry values identical · `pnpm verify` stops at `@vibefield/field-app:typecheck` — the same three TS2353 errors as §UA-P-W, James's dirty puppeteer tree (`UsageLedgerRecord`), attributed there; the lane's own lint pass was 0 errors / 31 warnings, main's counts · every stage after, alone: fmt 0 · clippy 0 · `bundle:assert` 0 · `pnpm test` 0 for 25 projects (fieldd 86 files + 1 skipped, no red row) · `pnpm test:rust` 0 (21 suites; field-native lib 138 passed / 1 ignored) · gen:check's Rust half 0.

## UA-P-W3 — the packaged stage ships the window's sidecar, or refuses to ship at all (2026-09-16; main `9547603a`; lane vf-window)

The consequence §UA-P-4 found: `scripts/stage-package.mjs` staged the npm `@vibecook/truffle-sidecar-*` 0.7.12 binary (protocol 4 — verified against the artifact, not the reasoning) beside `field-native`, where the floor looks first, so a PACKAGED desktop that links would have built a gated node against it and degraded at bring-up. The decision now lives in `scripts/siblings.mjs`, the one reader of the lock, as its fourth consumer: `goSidecarState` (none / missing / stale / fresh) and `sidecarStagingSource` (npm / window / refuse). No window in the lock → the registry package, byte for byte the old behaviour and the state the exit returns to with no edit to the script; window open and the built binary fresh → `target/debug/sidecar-slim`, the plan's `produce:` reading `pnpm siblings:build`; window open and the binary missing or stale → `stage REFUSED`, exit 1, before anything is staged or an out directory exists — no fallback at all. preflight's WARN and `pnpm siblings`' marker read that same state. Thirteen rows in `tooling/dev-runner/test/siblings-window.test.mjs` (five new: both registry branches, the window branch asserting a repo-relative path, both refusals asserting nothing to fall back to, and a source-level row pinning that the stager still consults the decision); live: the decision on this tree reads `window`, and with the binary moved aside the real script printed one line, exited 1, staged nothing. Found on the way: the platform guard named "Truffle 0.7.12", a version it never read; it names the published target set now. The exit list in `Cargo.toml` gains its rider: the staging needs no edit when the window closes — verify by staging once afterwards. Landing witnesses at `9547603a`: preflight OK (James's two dirty siblings), `@vibefield/dev-runner` 98 rows, the lane's lint 0 errors / 31 warnings (main's) and typecheck for 24 projects.

## UA-P-4c — the promoted node is GATED, and a stub sidecar is how we can see it (2026-09-16; main `e1507125`; lane vf-desktop)

The row the orchestrator asked for after UA-P-4's finding A, and one that nearly did not land: it was committed on the lane's branch AFTER the orchestrator had rebased and landed 4a/4b and reaped the worktree, so the commit was orphaned — the branch delete said "was f5ecb6d7" against a landed tip of `87987bc4`, which is the tell — and the lane re-homed it on a fresh branch off main. What it pins that UA-P-4a could not: 4a asserted "linked means gated" on a floor with NO node installed, so `start` took the first-bring-up path and never the promotion path. This row takes the promotion path on a LIVE node — possible because a stand-in sidecar speaking newline JSON on stdio with a protocol-5 `tsnet:started` gets a genuine `Node` installed, which a real tailnet cannot do headlessly — and pins the precondition (the live capture node is UNGATED), a control (re-declaring the same posture is a no-op and keeps the same node object), the claim (after the promotion `login_allow` is the captured login AND a different node object is installed: rebuilt, not relabelled), and that the identity survived (same device id — no second interactive login, no new device to peers). Restoring the old early return reddens exactly its own sentence. `mesh_unit` 9 passed / 1 ignored at the landing; clippy and fmt clean.

**Recorded for James, not changed — a mirrored rule with different arms.** The desktop and the phone answer "is an UNATTRIBUTABLE peer mine?" differently, and both are reasoned: the phone (`FieldLink.foreignLoginReason`) treats an absent peer login as NOT a refusal, because the door probe remains the authority and would reach the refusal itself; the desktop (`DeviceService.refreshPeers`) gives an absent login no roster row at all, which also removes the peer from the doc-sync fan-out, because there is no second gate behind the roster outbound. The case is new with gated nodes (before UA-P-4 the WhoIs fallback always filled a login); on a gated node RFC 025 §3.3 reports an unresolved owner's login as absent and opens no new session to it, so the desktop matches upstream and the phone leans on its door. Flagged as the class where a silent divergence hides: two planes, one rule, different arms.

## UA-P-X — truffle 0.7.14 released, and the window closes: RFC 025 from the registries on all three planes (2026-09-16; main `723cb356`; lane vf-exit)

**The release (James: "Push and release truffle changes").** Everything the window had consumed went upstream through truffle's own release contract (`docs/RELEASING.md`: Release Please as the only versioning system, one release unit, fail-closed sidecar checksums, the SemVer tag last). The PR chain on `github.com/vibecook-dev/truffle`, every merge a rebase merge: **#190** `feat/rfc025-login-scoped-nodes` (19 commits: RFC 025, the core gate, the sidecar at protocol 5, the bindings) · **#188** James's own open PR (the Apple identity and watch-recovery fixes, green since 09-08 — merged here because the Apple RFC 025 work stacks on it) · **#191** `feat/rfc025-apple-login` rebased onto it (14 commits) · **#193** `fix(deps): rustls 0.23.45` — cargo-deny had gone red on main and every PR the day RUSTSEC-2026-0285 was published (rustls 0.23.38, TLS 1.3 handshake messages across encryption levels); a lockfile-only pin, since cargo's default pick 0.23.43 was still inside the advisory · **#192** `chore(main): release truffle 0.7.14`, release-please's PR, squash-merged as `9f0d628` after its dispatched CI, real-tailnet integration and CodeQL runs were green at `74454b3` and the documented pre-release list had been run locally on that head (install, `release:check`, tooling tests 18, build, node suites 64 + 3, fmt, the locked clippy line, `cargo test --locked --workspace` 18 suites — the last line needs `TRUFFLE_SIDECAR_SKIP_DOWNLOAD=1` on a release branch because the checksum for the version under release cannot exist before its tag, which the doc omitted: **#194** fixes the line, merged after the release). The orchestration run then created the immutable tag `truffle-v0.7.14` and a draft release, waited for the tag's own CI, integration and CodeQL, dispatched the CLI, sidecar and NAPI builds, required the crates.io and npm publishers, published the release (10 assets: five CLI archives, five sidecars) and created the SemVer tag `v0.7.14` on the same commit; the sidecar workflow committed the checksum map back to main (`891421c`). Verified from here: crates.io `truffle-core` and `truffle-sidecar` 0.7.14; npm `@vibecook/truffle`, `@vibecook/truffle-native` and all five `@vibecook/truffle-sidecar-*` at 0.7.14; `git ls-remote --tags` shows `v0.7.14` → `9f0d628`.

**The window closes on two planes of three (the EL8 event `Cargo.toml`'s exit list scheduled; lane vf-exit, `723cb356`).** Cargo: `truffle-core = "=0.7.14"`, the `[patch.crates-io]` section gone, the eight-place list rewritten as a dated closure note; `cargo tree -i truffle-core` shows the registry crate with field-native its one consumer; `Cargo.lock` moved by three lines (the version plus the `source` and `checksum` a path package never had). npm: the five `@vibecook/truffle-sidecar-*` rows at 0.7.14 (`pnpm-lock.yaml`: 80 lines, every one of them truffle's — no control install needed); `stage-package.mjs` untouched and its decision verified to read `npm`; the built `target/debug/sidecar-slim` retired after the landing, once main's `node_modules` carried npm 0.7.14 and James's `.env` override named it. `siblings.lock.json`'s `truffle` entry keeps ONLY its `swift` block, re-pinned from the integration tip to `9f0d628` — the released `v0.7.14` commit itself, which the sibling checkout `../truffle-rfc025` now sits detached at (its `apple/Sources` byte-identical to the tip the kit was witnessed against); `PIN_EXPECTATIONS` names `=0.7.14` and the patch-row assertion retired with the `patch` key. **SwiftPM could not follow, and the vice has two jaws, both measured:** forward to `exact: "0.7.14"` SwiftPM refuses — "root depends on 'truffle' 0.7.14 … 'ghosttea' 0.10.1 depends on 'truffle' 0.7.12" — because ghosttea's Swift manifest pins truffle exactly at 0.7.12 in every published tag (v0.10.1, v0.11.0, v0.11.1 checked); back to `exact: "0.7.12"` resolves and then does not compile — UA-P-5a taught the kit RFC 025's login API (`MeshConfiguration.loginAllow`, `MeshNode.loginName`, `Peer.loginName`), six errors. So the kit's row stays `.package(path: ".window/truffle")` through the identity symlink, the app workspace's `Package.resolved` stays without a truffle row, biome's `!**/truffle-rfc025` ignore stays with a dated note, and the resolver error and the reasoning are recorded at the source in `Package.swift`. No version divergence rides along: all three planes read 0.7.14, the path package is only how the kit reaches it, and the sibling is the one pin that raises no unpushed warning because it is a published tag. The unblock is one upstream event — a ghosttea Swift release whose `truffleVersion` is 0.7.14 — filed as petition **G28**; the day it lands the row becomes `exact: "0.7.14"`, the symlink and the lock entry go, and the ghosttea pin moves in the same EL8 event. Found on the way: the cargo family rule (every path patch backed by a pin) had lived only in preflight's sibling-mode branch, so registry mode with no lock could carry an unpinned `[patch.crates-io]` row silently — the registry-mode branch carries the rule now, both halves probed; and `@vibefield/plugin-playground`'s "preserves migration … through churn" flapped once under 25-project parallelism (green alone and on a clean re-run — it asserts on a behaviour LOG as a proxy for a fact the line above already checked directly, which is what makes it load-sensitive; a lottery row).

**Gate at `723cb356`** (the lane's run on the identical tree; the orchestrator fast-forwarded without a second run): `pnpm verify` verbatim red ONLY at `@vibefield/field-app:typecheck` — the same three TS2353 errors on `UsageLedgerRecord`, attributed with a control (identical on main's checkout; James's puppeteer tree is dirty across exactly that monitor surface) · every stage after, in order: `pnpm test` 25 projects green · `pnpm test:rust` 21 suites, 263 passed / 0 failed / 8 ignored · `gen:check` clean · `pnpm preflight` OK with three warnings (puppeteer dirty, rosetta dirty, rosettad not built), none truffle · `pnpm siblings` shows truffle with the swift link only · the kit on a simulator created by UDID and deleted after: 806 tests / 150 suites, 0 failures, 0 restarts after a crash, compiled from the sibling at `9f0d628` (one DerivedData clear first: the TailscaleKit xcframework differs between 0.7.12 and 0.7.14 and a stale module fails with "has been modified since the module file was built").

## IOS-7a — the body says one thing at a time: the state line, the folder, the burn ladder, the USD ledger (2026-09-20; `ff9483c1`, lane `ios/swarm-2`)

James: "there are new changes in puppeteer godview app, onboard to those changes and update ios app
accordingly." The reference's swarm had moved six commits past the revision IOS-6 transcribed
(`5389449`), two of them past VibeField's own pin: RFC 008 (`a7a0c4e`, live usage as estimated USD)
and `29ce206` ("the swarm body says one thing at a time", the one-ink revision of 2026-09-16…18 with
the STATE GLOW tunables of 09-19). `draft/thinking-ios-swarm.md` §10 is the plan. **The model layer
transcribed:** the project's colour in ONE place (the folder before the name, solid once a state
line has displaced it); what the body needs from you in the NAME's place behind its mark, the name
above at the supporting weight; the light is the STATE's (ink · orange · blue), the flood gone; the
burn ladder (four flames on an absolute scale of USD a minute — 0.05 · 0.15 · 0.4 · 1 — or ONE
hollow flame where nothing prices the work); the working body sized by its share of USD;
`SwarmWeight` (one ink at eight weights, `climb`, `onField`); `UsageLedger` as RFC 008's run-keyed
USD display history (no hold rule, no interpolation, a correction lands in its own bucket);
`AgentUsage` with the three cost fields and the buckets; `AgentBlocker` with question · tool · code
(D-i19) and `blockerText` in the reference's order; the ten STATE GLOW parameters; `BurnBars` and
the bar tag deleted. The mock prices its burn (claude · codex) and leaves grok · acp unpriced.
**Tests:** the reference's bubble-model, usage-ledger, weight and text-layout rows transcribed.

## IOS-7b — one surface, one ink: the theme, the shaders and the renderer catch up (2026-09-20; `9b92ff2a`)

`FieldPalette` loses the per-tier tokens; `bodySurface` (`--idle-bg`) and `textMain` are the swarm's
whole greyscale (D-i20). `SwarmTheme` resolves surface · ink · `stateInk` (`readable`, 45% toward
the ink on a light theme) · `stateGlow` (`vivid` by `stateChroma`, lifted toward white on dark) ·
`stateGround` (scaled toward black on dark, carried toward white on light), WITH the parameters.
The shaders: Frame 48 floats (`glowBand`, `glowWave`), Body 40 (`accent` → `core`, the graph gone),
`F_FLOOD` → `F_WAVES`, the samples buffer gone; the state's light rides the annulus in carried waves
(Reduce Motion holds mid-crest); the gauge CLIMBS in weight as it goes round and the track is cut
out under it. The renderer: `emitBurn` (13 pt flames, 3 pt gap, `climb` per slot, the last one
breathing), the figures in the ink at the secondary weight, `rung` on a coloured ground, seven new
sprites from the reference's SVG paths. **Findings:** a ternary over two static function references
and a nested ternary in a float expression each made the Swift type-checker give up ("failed to
produce diagnostic"); free functions named like the theme's properties shadowed them in `resolve`.

## IOS-7c — the lab shows the new states and the burn ladder; the wire's USD lane decodes tolerantly (2026-09-20; `0c867e1f`, tip `4f9b4d7d`)

The lab gains `idle-unread-silent`, the context-low/high pair, the question as asked, the adapter's
detail, `working-quiet` unpriced, and a BURN section (`-vf-swarm-lab=burn`); it reads its models at
the fixtures' own clock (the running terminal said 177 hours on a day a week after the fixtures were
dated). `field.agents.v1` rows now yield `usage.costUsd` · `costCoverage` · `costRatePerMin` when
present (D-i18) — absent is the missing lane, one hollow flame, never a calm session; **fieldd does
not project them yet and the desktop's pin predates RFC 008, so on today's wire every daemon agent is
unpriced — that projection is the named follow-up, a desktop slice.** **Witnessed:** the kit suite
verbatim — 815 tests across nine bundles, exit 0, no restarts (13:58); the simulator app build; the
lab's twenty pages in both themes and the live field over the mock, every drawn state and the ladder's
six readings. **A finding, not this slice's:** fifteen minutes later two `FieldLinkTests` rows
(`aRefusedLoginIsAskedAgainOnlyAfterMinutes`, `anUnreachableDoorIsAskedAgainSoon`) went red on their
five-second real-time wait — and MAIN's own untouched tree fails the first of them at the same
minute (`-only-testing:FieldMeshTests` on both trees), so it is the host's clock, not the branch;
the mesh sources this lane touches are one pure function. Those two rows want a movable clock for
their wait as well as for their schedule. **Owed to a device, still:** the shader compile at first launch, 30 Hz physics under the
120 Hz blend, the 7 pt type, VoiceOver per body, the tab bar as an obstacle. **Unruled, adopted as
leans:** D-i18 · D-i19 · D-i20 (§10.2 of the plan).

## UA-P-0g — the link begins from the Account pane: the offline face offers the act, the refused faces speak (2026-09-20; `f161e866`, lane uap0g)

**Found while preparing Phase 0 (James: "let's close this gate, what do you need from me").** UA-P-0a (2026-09-15) gave fieldd the link act — `user.link.begin`, scope `settings.manage` — and the six-word posture `linkState` with its `linkDetail` sentence, and nothing in the renderer ever called the one or read the other. `account/link.ts::linkFace` derived from `meshEnabled` alone; since UA-P-0a the mesh derives FROM the link (`link-service.ts:122`), so an unlinked desktop reports `meshEnabled: false` by construction and landed on a `mesh-off` face that offered nothing and blamed an env flag (`FIELD_NATIVE_MESH`) that had already become a forced-on development override. A fresh install, and anything that pressed **Unlink**, could not link from the UI at all. James's own dev desktop holds a link from 2026-08-05, which is why five days passed unseen; the old fixtures in both suites carried no `linkState` and still passed, which is how a renderer ignoring the posture survived a green suite.

**As built.** The face derives from `linkState` (`postureOf`: the word when it is one the renderer knows; otherwise an honest derivation from the record and the address that ARE on the wire — a daemon older than UA-P-0a still renders, a daemon newer than this build cannot make it lie); `mesh-off` is deleted with its sentence, `authenticating`/`idle` fold into `capturing` (with or without an address yet), and three refusals gain a face: `link_corrupt` names the file and WITHHOLDS the act, because `begin()` refuses that state by construction until the file is moved aside; `login_unavailable` and `login_already_linked` name the reason in the daemon's own `linkDetail` and OFFER the act again, because both end capture without retiring the tailnet keys. The one phrase for the act, `Link Tailscale account`, and each refusal's one-phrase title live in `link.ts` so the two surfaces (Settings → Account; the Setup Assistant's connect step) cannot disagree about what a word MEANS while differing in paint. Both call `user.link.begin` through the client the Unlink path already used, under a two-step `LinkBeginStep` mirroring `UnlinkStep`; the call's response is deliberately not applied to the face — the subscription is the only thing that moves it, the local step owns the in-flight beat and a `PRECONDITION_FAILED` reason, rendered, never swallowed. `linkFace` believes the RECORD over the word: `linked` over a null `link` reads as offline, since UA-4 compares the stored login at every door and a face claiming an account it cannot show would be the one lie that matters. `hasLink` (W6, the wizard's resume) keeps its meaning. The catalog's connect lab shows all nine postures through the production derivation, not hand-built faces (UI_SYSTEM's rule; `ui-system-boundaries` green).

**Witness.** field-app 794 tests / 91 files (a new `account-link.test.ts` with 16 rows, one deliberately omitting `linkState` to pin the pre-UA-P-0a fallback; every fixture now carries the real wire shape); nine guard deletions each cutting one call site went red (the act, the request, the detail, the `canBegin` gate on each surface, and the old `meshEnabled` derivation restored — 10 of 16 rows red, the defect reproduced on demand). Typecheck's three TS2353 in `godview-usage-history-cache.test.ts` are the puppeteer sibling's drift, attributed on a pristine detached worktree at `9beac2bc`; `pnpm preflight` is red on main for the same drift, so THE gate is owed to the pin move, not to this slice.

## UA-P-4d — a foreign login at the gate: the second-account witness runs headless on a guest key (2026-09-20; `b4a61f23`, the lane's `25df8f9e` rebased over UA-P-0g; lane guestprobe)

**Why now.** The roadmap has owed "the two-account tailnet witness" since UA-4 — a colleague's login on the same tailnet seeing nothing of yours — and since UA-P-4 it has had something concrete to falsify (a colleague's desktop must never appear in the roster, never receive a slice, and be refused at the hello with 4004), but only a human on a second device could stand it up. UA-P-4's live row (`mesh_login_gate_probe.rs`) stands three ephemeral nodes on ONE auth key, so every node carries the same login and the only refusal it can show is a gate that matches nobody. This slice adds the node that key cannot buy: an auth key names its minter, so a fourth node built from a key the SECOND USER of the tailnet generated puts a genuinely foreign login on the tailnet from one machine.

**As built.** `common::GUEST_AUTHKEY_ENV = "TRUFFLE_TEST_AUTHKEY_GUEST"` beside the primary key; `build_node`/`build_gated_node` take their key as a parameter. The new `#[ignore]`d row `a_foreign_login_is_refused_at_the_gate_and_never_enters_it` SKIPS LOUDLY when the guest key is absent — one line naming the env var and what the key must be — and pins its preconditions before measuring anything: the guest login differs from the account's and is not `tagged-devices` (a tagged key would exercise the "caller has no login" row instead of "caller is someone else", and fieldd's own capture refuses such a node, `link-service.ts` `login_unavailable`); neither login is printed, only a verdict and a length. Then, each absence read in the same beat as the control that explains it: **roster** (RFC 025 §3.3) — the gated node never lists the guest within 4× the measured guest discovery (floor 30 s) while its ungated twin lists it, and the gated node still lists the twin; **the guest's own view** (§3.3) — the guest SEES the gated node, because the gate is admission and not invisibility, and the login it reports for that peer is asserted against what §3.3 promises (the owner's login from the netmap's user map, or absent, never fabricated); **slice** (§3.3 + §3.5) — neither direction crosses while three controls converge (guest→open, open→guest, gated→open); **hello** (§3.4) — the guest's dial is refused with close code 4004, asserted only after both positive controls (the account's own node admitted by that same gated listener; the guest admitted by an ungated one). The dial goes through the node's own session-plane listener, NOT a sidecar `serve` route: RFC 023 §9.7's `allow` list guards a serve and RFC 025 §3.7 says that is not the login gate, so a serve would have witnessed the wrong gate. A process-wide turn mutex makes the two live rows take turns (six sidecars and four discovery measurements at once would make every window a statement about load), taken after the skip checks so a keyless machine never queues. `.env.example` documents the guest key (name only). Errata corrected at their sources: the probe header and `build_gated_node`'s doc said the vendored npm sidecar was pre-RFC-025 and told the reader to set `FIELD_NATIVE_SIDECAR_PATH` — false since UA-P-X (the live run resolved this worktree's own vendored 0.7.14 with the override unset); `vendored_sidecar()`'s doc named `0.7.12` in prose — the number is deleted, the manifest is the authority.

**Witness.** `cargo fmt --check` · clippy `-D warnings` · `cargo test -p field-native` 263 passed / 9 ignored / 0 failed across 21 targets (the only count change: the probe binary's ignored rows 1 → 2) · the ignored run on the real tailnet with the guest key ABSENT: exit 0, 2 passed — the skip loud and named, the three-node row green as the regression control (ungated discovery 25 µs; the walled node holds 0 peers while the ungated node holds 2). **The live guest-key run is owed** to James's second tailnet user. Re-run by the orchestrator before landing: fmt, clippy, the probe compile and the key-absent ignored run — quoted in the docs commit.

**Findings.** (1) The typed refusal RFC 025 §4 promises the dialer does not reach `truffle_core::Node`'s public surface: `TransportError::HelloRefused { code, reason }` is typed at the transport boundary, then `PeerRegistry::ensure_ws_connected` folds every transport failure into `SessionError::ConnectFailed(String)` via `to_string()`, so a consumer who wants to tell "not my app" from "not my login" reads prose — the probe parses the code back out and fails closed; a petition row the day the floor needs to branch on the code. (2) Eager identity re-dials a refused peer with a per-peer backoff doubling to a 30 s cap, so a single `send_bytes` would often report truffle's own rate limiter, not the gate — the probe waits the window out and accepts only an admission or a code the remote sent. (3) A synced store subscribes inside the task it spawns and a lost broadcast is never retried — every store is created and given a beat before a write. (4) `Node` publishes no sidecar protocol version; the gated node's successful `build()` is the assertion (below 5 it refuses to start). (5) The main checkout's `.env` sets `FIELD_NATIVE_SIDECAR_PATH`, which outranks everything in `common::sidecar()`; byte-identical to the vendored 0.7.14 today (sha256 `9f10e84b…`), but a stale override there would silently decide which sidecar every tailnet probe exercises.

## UA-P-4d witness — the foreign login refused on the real tailnet, two human logins (2026-09-21; run by the orchestrator from the lane's worktree at `b4a61f23`)

James invited a second account to the tailnet (a plain Member cannot generate a key — Tailscale gates the Keys page to Owner/Admin/IT admin/Network admin, so the second account holds Admin for the duration) and minted its key into `.env` as `TRUFFLE_TEST_AUTHKEY_GUEST`. The ignored run, both rows, `cargo test -p field-native --test mesh_login_gate_probe -- --ignored --nocapture` against the vendored 0.7.14 sidecar: **`test result: ok. 2 passed; 0 failed`, 81 s.** The foreign-login row, in its own words: two distinct human logins, neither `tagged-devices`; the ungated node found the guest in 1.7 ms and its gated twin in 20 µs; the allowed login completed the hello with the gated listener and the guest completed one with an ungated node (both controls); **THE ROW: the gated node refused the guest — 4004 (login refused)**; slices converged guest→open, open→guest and gated→open (three controls); after the 30 s settle, in one beat: the gated node holds 1 peer and none of them is the guest while the ungated twin and the guest each hold 2; the ungated node holds the guest's AND the gated node's slice, the gated node holds no guest slice, the guest holds no gated slice. The three-node row ran after it as the regression control (walled node 0 peers against 2). **The two-account tailnet witness owed since UA-4 is PAID on the desktop plane**: a real other identity is refused at the hello, never enters the roster, and exchanges no slice, while the same gate admits the account's own login. Still owed on the phone plane: the phone signed in as the second login drawing no desktop (Phase 0's guest half, James's hands).

## AR-5-1 — the puppeteer pin moves to `2f5ce002`, and the gate is green again (2026-09-21; `d4e60d8d`, lane pin)

**Why.** James landed seven commits on puppeteer over 09-17…09-19 (99 files) while the lock still pinned `73b2d646`, so `pnpm preflight` failed at step one and nobody could run THE gate; field-app's typecheck had been red on three TS2353 since, attributed to the drift. This is the EL8 event, run at James's word ("run it"), and the same hour he had me push puppeteer main (`807904c..2f5ce00`, 122 commits) so the pinned revision is fetchable by CI's clone step.

**What moved upstream.** Live usage accounting is isolated from transcripts — `liveUsageOrigin` admits usage only from `native-telemetry`, `native-protocol` or `native-hook`, and a replayed envelope's usage updates are filtered out of the monitor batch — then native usage is priced into `costUsd`, `costCoverage` and a `costHistory` of buckets, and the UI's ledger record turns from a token series into a list of independently observed USD RUNS (`{currency: 'USD', providerId, nativeSessionId, savedAt, runs}`); the swarm's ONE-INK revision collapses seven state colours to a surface and an ink, deletes `burn-bars`, and brings a STATE GLOW parameter group with defaults (the desktop side of IOS-7's revision).

**Three breaks here, only one of them obvious.** (1) The fixture's three TS2353 — rewritten around a `run()` helper over the new shape. (2) The silent one typecheck could not see, the `clean-merge-hides-a-mirrored-rule` class exactly: `exportUsage` now hands the store only the conversation's LIVE run, and upstream's own host store (`apps/godview/src/main/usage-history-store.ts`) answers that with a per-run merge that preserves corrections by revision — while our renderer-local cache (`packages/field-app/src/godview/monitor/usage-history-cache.ts`) still replaced the whole record, so every earlier run's observed spend would have been discarded and a resumed bubble would open holding only its latest leg. The cache now merges by run id with revision precedence (a newer save breaks ties when neither side carries a revision), bounds a conversation to 50 runs, and writes a version 2 document so a version 1 record (token series, not dollars) is dropped on read rather than shown as USD; three new rows, each proved to bite (reverting the merge reds exactly those three; accepting version 1 again reds exactly the legacy-document row). (3) A stale expectation that was NOT this move's: the opt-in real-claude row in `packages/fieldd/test/agent-session.test.ts` asserted `schemaVersion === 2` while `AGENT_MONITOR_SCHEMA_VERSION` had been 3 at the OLD pin already — a row the ordinary gate cannot see had been red since AR-3; it now asserts the contract's constant.

**Witness.** `pnpm verify` VERBATIM, exit 0 (the second run; the first stopped on the MF-1 "settled board kept sending frames" row that LANDED already records as a precondition assumed under the loaded graph — 2/2 alone, the fieldd package 895/909 alone, under a load average of 148): preflight OK (2 warnings: rosetta dirty; rosettad "not built" under the lane's own target dir — see the memory rule) · check:deps · ios fixtures 42 + 16 pins · icons 27 · typecheck 25 projects · biome 1332 files, 31 warnings, 0 errors · cargo fmt · clippy `-D warnings` · bundle 543.7 KB raw / 145.9 KB gz · `pnpm test` 25 projects (field-app 91 files / 797 · fieldd 86 files / 895 + 14 skipped · electron-shell 69 / 679 + 2 skipped · contracts 26 files) · `pnpm test:rust` 21 suites, 263 passed, 9 ignored · `gen:check` clean. Re-witnessed at the new pin on the prebuilt rosettad: `agent-session` 20/20 including both REAL claude rows (the native session id observed from the vendor's hooks at schemaVersion 3; re-attached across a fieldd restart at runtime epoch 2, same PTY, hooks flowing, ordinary exit 143), `agent-runtime` 11, `rosettad-daemon` 18, `rosettad-supervisor` 14, `agent-index-sessions` 13, `agent-monitor-pin` 1, `agent-usage` 13 — 70/70; `pnpm smoke:godview` ok (usage column mounted, cold open 1894 ms / 78 ms warm, 60 frames p50 16.6 / p95 17.4 ms; `swarmRenderer: unavailable` is this host's GL bind flap). The orchestrator re-ran preflight, field-app's typecheck and the usage cache file (10/10) before the fast-forward.

**Findings.** The desktop already carries the USD fields: `AgentMonitorMirror.usage` is `.passthrough()` and upstream added the three cost fields at the same schema version 3 with no generation bump (`agent-monitor-pin` stays green); the only thing holding a USD readout back on the desktop is `coreUsage`'s explicit key list in `useMonitorAgents.ts`, which copies the token aggregates and drops the rest — the phone's `field.agents.v1` is a separate content-free projection and is the real D-i18. Neither touched here. `burn-bars` has no importer in this tree; the new swarm parameters all ship defaults; the narrowed `SwarmPalette` reads fewer tokens, so no DESIGN.md change is owed; no new `process.env` read entered the runtime.

**Erratum, the same evening (2026-09-21).** `d4e60d8d`'s commit body ends "James still has to PUSH puppeteer `2f5ce002` — `siblings:pin` warns it is on no remote branch". True when the lane wrote it, false by the time it landed: James had the orchestrator push puppeteer main while the lane ran (`git ls-remote` on `vibefield/puppeteer` gives `refs/heads/main` = `2f5ce002eca4…`; the checkout that read ahead 122 at the lane's start reads ahead 0). What IS unpushed is **rosetta**: the pinned `e8d907ab2899` is on no remote branch, rosetta's local main is 246 ahead of `origin/main` and 0 behind (the remote tip `10ea2ce7` is an ancestor, so a plain push fast-forwards), so CI's clone step has been unable to fetch the rosetta pin since AR-5-0 pinned it on 2026-09-13. Local builds are unaffected (the lock reads the checkout); the push is James's call. **Pushed the same evening at James's word (23:09): rosetta `10ea2ce..e8d907a`, 246 commits; the pinned revision is now the remote's main tip, so both sibling pins are fetchable.**

## AP-DOCS — the agent plane documented as one system across three repositories (2026-09-22; main `577309f3`, fourteen commits from lanes docs-a and docs-b; upstream pages on branches)

**James:** "we need an overarching architecture, system diagram and API design doc in vibefield to umbrella [puppeteer's and rosetta's docs] together so things are well managed, well designed, and consistent; architecture, system diagram and API design docs on the vibefield side governing the aggregation, integration, seams, layering, separations; and more top-level abstraction seam design and API documentation on the puppeteer and rosetta side if needed."

**What landed here.** Three pages in the HTML family puppeteer's docs already use (Spectral · Source Sans 3 · JetBrains Mono, the paper palette, inline SVG, one status legend BUILT · DESIGNED · OWED, every claim cited): `docs/agent-plane/architecture.html` — the umbrella (the ownership law with AR-L1 defined main-tracked for the first time, as a law CANDIDATE; the system diagram across three repositories; the seams as a table with HostIngress/BoundIngress as the daemon half of AgentHost; the walls R20–R22 quoted and where they run; the data domains with the login gate per NODE; the identity spine; the laws; lifetimes; performance with only quoted numbers; status; the documentation map of every page in three repositories) · `docs/agent-plane/system.html` — aggregation and integration in VibeField (fieldd's eight agent services and their graph with the honest module notes, the floor's agent cell, the mirror and the fold, the field projection to the phone, history and enrollment with rosettad's real spawn line, the data domains and layout, the walls as enforced, four sequence diagrams) · `docs/agent-plane/api.html` — the doors (conventions; the catalogue of all 23 `agent.*`/`agents.*`/`index.*` rows with scope, locality, idempotency and the upstream call each wraps — every number measured; the agent-relevant `terminal.*`; the mesh store; the upstream map with the not-wrapped list; versioning with the usage-ledger change as the worked example) · `docs/AGENT_PLANE.md` — the Markdown hub indexing every document in the three repositories, with one pointer each in `README.md` and `CLAUDE.md`.

**What landed upstream, on branches for James to merge (his repositories, not pushed by us):** puppeteer `docs/host-integration` (page `f5d0048`, additions `ccba98d`, errata `4f0b0c7`, nav `585e95b`, slug `ba8bb11`, family `ed4a786a`) — the embedding seam for any host, and the errata puppeteer's own docs carried (the `views` package absent from every page and the count 21 → 22; "43 routes" → 37; RFC 005, RFC 008 and the CI note missing from the docs map; a note pointing daemon hosts at the Runtime fan-out); rosetta `docs/daemon-api` (page `7b13156`, revisions `758c2d37`, errata + the first `docs/README.md` `c4c991b0`, schema erratum `7d13270`, slug `11fc5dd`, drifts `c409113`, family `076497b9`, the review's blocker `3b1e65f`) — rosettad's protocol and embedding seam, plus the errata its architecture doc carried (the hello frame's protocol 17 → 20; the metrics stream marked DESIGNED/unshipped; §8's workspace map with nine adapters, the real subcommands, `clients/ts` + the undocumented `clients/app`, the absent PATTERNS.md, the dependency rule; the schema number as a dated note naming `SCHEMA_VERSION` 21; the third guarded surface; `native_session_id` in the session entity). Also on a puppeteer branch, `fix/usage-key-nul-escape` (`a3de299`): a raw 0x00 byte in `account-usage-monitor.ts:45` since `f33da93` made git call the file binary — spelled as the `\0` escape, same value, 10/10 tests.

**How it was built and reviewed.** Four writing lanes plus seven read-only diggers (puppeteer docs, upstream imports, rosetta docs and code, the ledger, the design corpus, the reference hosts, the code truth), a read-only reviewer with four citation checkers (about 300 checks across the five pages: 105 puppeteer citations exact, ~115/120 VibeField claims, every rosetta citation exact, 246 links and 58 anchors clean), and a family pass that changed chrome only with body badge counts unchanged. Every lane verified relayed facts against the code before publishing and refused what did not hold — the shared brief's own errors were caught this way (no `AGENT_KINDS` exists; the walls run under `pnpm preflight`, not `check:deps`; `@rosetta/protocol` enters through two files as types and a version constant while fieldd dials six GET routes; `index.openTicket` is designed only; the vibe-field GitHub slug is `vibefield/vibefield`; the rosetta asset URL is correctly `<blake3>.<ext>`; two dated version notes were not errors). Findings for the product, recorded on the pages: puppeteer documents seven of the ~75 symbols VibeField imports and has no host page; approvals are not wrapped at all and `submitPrompt` is test-only (AR-6's true scope); fieldd is read-only and poll-only against rosettad, six of 24 routes, no WebSocket — the observe service's live half has no host consumer outside rosetta's own app (AR-8's true scope); rosettad has no authentication of any kind and no SIGTERM handler; the agent PTY's environment is the host's composition with nothing upstream enforcing the strip; a host's error text does not survive a failed spawn; the monitor's version constant does not cover the views' port types; AR-L1's two named violations are closed in code. The refactor slate (the deck monolith, `useMonitorAgents`, `agent-runtime.ts`'s four concerns, `daemon.ts`'s inline registrations) is recorded as OWED on system.html.

**Gate.** Docs only, no build input touched; `pnpm verify` not run for this landing (main's last green verify is AR-5-1 `d4e60d8d`, and the three docs commits since do not change it).

## UA-7 — a user is known by a face: the gear grows into the Me menu, and Settings is headed by you (2026-09-22; `135bd9dd` + review `9d11c838`)

**Why now.** James ruled the account's look across the "Whose Field" and "Where You Sit" artifact rounds (2026-09-21/22) and then said "plan and implement this". UA-D17: a user is known by a face, never a colour — the accent dot collided with the project inks and with §2.5 (in OKLCH three of the eight slots sat within 3° of green, orange and red, and one inside the band withheld for `--vf-select`). UA-D18: the face travels with the login. UA-D19: the face takes the Settings gear's corner and grows into the Me menu, and Settings is headed by the account. The doc-first fold (DESIGN.md §2.6/§2.8/§8/§10, spec v0.3, the DECISIONS row) rode in the slice.

**As built.** Contracts: `UserFace` beside a deprecated, tolerated `color`, and the zod-free policy `contracts/src/user-face.ts` — the 48-face deck, the refusals (a joined sequence judged by its base), `dealFace` from the id's FNV-1a, `effectiveFaces` (no two users shown alike), `faceProblem` and its roster-free half `emojiProblem`. design-kit: `UserFaceView` on a `./face` leaf — the sticker's die-cut one thresholded SVG filter per edge width, the per-user tilt from 40px, the lift from 20px; the coin's beading, reeding, light and legend by size — and the §2.8 tokens. Main: face writes under the §3.3 lock, merged over the stored face, refused in `faceProblem`'s words and unwrapped by the preload for all four users verbs; the silent deal writes every owed face at each attach; the tray leads with the emoji. Renderer: the Me menu in the gear's corner (grows on `--vf-ease-island`, keyboard and focus return, one of the spine's expanded surfaces, one z-step above Godview's button while open, refusals reopening it with main's words), `⌘,` (it did not exist), Settings headed by the account, one `FacePicker` for the Account page and pane 2, presence as "🦊 James" in one neutral ink, the switcher's faces, and the Ready pane saying where Settings went. The catalog mounts every face surface through `account-fixtures.ts`.

**Witness.** `pnpm verify` VERBATIM in a clean detached worktree of each tree, with its own cargo target and `FIELDD_ROSETTAD_BIN` set: preflight through typecheck (25 projects) green; lint RED on main's own `docs/agent-plane/{api,architecture,system}.html` only — 9 `aria-label` errors from the 09-21 AP-DOCS commits, untouched here, so main was already red at lint (AP-DOCS's "the three docs commits since do not change it" did not hold: biome lints HTML); then the chain after lint, in order — rustfmt · clippy · bundle:assert (562.4 → 563.5 KB raw, 152.3 → 152.7 KB gz, world lazy) · test in all 25 projects (field-app 830 → 852, electron-shell 715 → 717, contracts 502 → 508, fieldd 903, users 40) · test:rust 263 passed / 9 ignored / 0 failed across 21 targets · gen:check. Mutation probes by deletion: 18 on `135bd9dd` (16 red; the two survivors, `⌘,` and the menu's exclusivity, which no test mounted, became hooks with tests), 23 on `9d11c838` (22 red; ChromeLayer's one-line call into the chord hook is the survivor).

**Findings.** (1) The settings doc does not replicate (`fieldd/src/settings-doc.ts` says so; DocSyncService carries canvas documents only), so UA-D18 is GATED — corrected at its source; faces stay machine-local. (2) `⌘,` did not exist: the app menu's `appMenu` role has no Settings item. (3) Presence cannot be "the cursor in ink": ICE paints the SENDER's colour at every receiver under white label text; one neutral `--vf-presence-ink`, moved in review from #636366 (2.99:1 on the dark ground) to #68686B (3.2:1). (4) The waiting count has no feed; the views draw one when handed it. (5) Face drift: a set-up face-less user's shown deal could move when another user released a face — every owed face is written at attach. (6) The wizard shell centred unsafely and a tall pane lost its title. (7) The review — three read-only lanes — found no blocker and four majors: the open menu under Godview's button, the Account deck dropping keyboard focus on every write, the tailnet the docs promised on rows and the coin legend and nothing draws, and the Setup pane that never said where Settings went; plus about thirty minors (a ZWJ chain smuggling a refused face, a face write dropping a newer key, swallowed switch refusals, a stale pick in pane 2, a Settings head that blinked its fallback). All fixed or recorded at source in `9d11c838`; left as found: tray labels unescaped for `&` (older than UA-7, non-shipping platforms), the presence label's pre-deal moment, ChromeLayer's hook call sites. (8) Tool lesson: `\uXXXX` typed in a Bash command reaches the shell as the raw character, so escapes are built from `chr(92)` and changed code lines are scanned for invisible characters.

## UA-7b — Setup's pane 2 fits its shell, and a new user's Back chooses who to enter (2026-09-22; `73136f74`)

**Why now.** James, testing UA-7 in the product, clicked "New user…" and landed on a pane 2 whose deck and actions fell below the fold of the 512px shell once "Change face…" was open, with no way back: "make it more compact, clean and fit everything inside, and there should be a back button that back to a choose user to enter ui".

**As built.** Pane 2 in two columns — the 96px face with a small Sticker / Coin switch under it; the name and a three-row deck beside them, the typed face on the deck's label row; the picker always open. Behind a second user's Back, the users chooser: every user on this machine as a 56px face tile ("Setting up" on this one, "Not set up yet" on another unfinished one); another user's tile switches the window (a refusal said on the pane, in main's words), this one's or "Continue setup" returns. `FacePicker` → `FaceFrameSwitch` + `FaceDeck`; a `small` segmented control in the kit. DESIGN.md §2.8/§8 first; the spec's §6.2 amended on dev-local.

**Witness.** `pnpm verify` VERBATIM in a clean worktree of this tree: preflight through typecheck (25 projects) green; lint red only on main's own `docs/agent-plane` pages (the same 9 errors); then fmt · clippy · bundle:assert (567.8 KB raw / 153.8 KB gz, from 563.5 / 152.7) · test — field-app 854, electron-shell 717, contracts 508, users 40, fieldd 900 with 3 timing rows red on a loaded host (the TM-2 attach-join pair, the PRC-2 drain) whose files pass alone 2 of 2 · test:rust 263 passed / 9 ignored / 0 failed · gen:check. Measured over CDP at the window James tested in (766 × 573): pane 2 (both themes, both frames) and the chooser each scroll exactly their shell's height.

**Findings.** (1) The overflow no trim could fix: each deck cell's `sr-only` radio is `position: absolute` and the cells were unpositioned, so the hidden rows' radios escaped the deck's clip and stretched the SHELL's scroller — 443 against 425 while the form measured 416. Positioned cells fix it, and take the same stray scroll out of Settings → Account. (2) A new user's "Back" cannot un-create the user (create-then-attach), so it opens a chooser of who to enter instead; an unfinished user stays on the machine, labelled, and removing one remains spec §11's non-goal.

## AR-S1 — Settings → Agents: the shelf of installed agents, updates with the updater's own output, each agent's page (2026-09-22; `19b35b1b`, puppeteer `ea90c34` pinned)

**James:** "…implement the settings ui inside vibefield properly following its coding conventions, and at the same time, any api and underline features needs should be implemented or refactored properly inside puppetear side … plan and implement the agent setting first, focus on that, let's do it proper and solid, features in puppetear should also have proper abstractions so actual per agent logics are implemented properly under each adapters." The design is the record's R1 at pass 16 (artifact `MqjwWoxdxFZ87Vt2uduNT1`); AR-S1 is its shared half — the plan names the series (S2 Agent Profiles, S3 install from Settings, S4 extensions, S5 usage windows) in `draft/thinking-ar-agents-settings.md`.

**What moved upstream (puppeteer `ea90c34`, pinned here — on no remote branch until James pushes).** Four answers a host needs and the runtime could not give, every vendor fact inside its adapter: `runtime.planUpdate({providerId, executable?})` → `UpdatePlan` (the adapter's `recipeFor` resolved by the runner's own `recipeArgv`, so the command a host shows is the command run); `InstalledAgent.releaseChannel` (the release line the install's own updater follows — Claude maps `autoUpdatesChannel`, whose default "latest" is `preview`, and npm-global or an `@latest` cask to `preview`; Grok maps `alpha` to `preview`); `ReleaseCheckResult.available` with an exported `availableUpdate()`; `updateInstallation({onOutput})`, an opaque observer beside the 0600 transcript. The read-only live proof now plans every install; on James's Mac it read 11 installs across 10 agents, every one planned, and Grok's oracle offered 1.0.41 on stable. Codex's npm install plans `codex update` by the adapter's documented rule (it resolves npm, bun, pnpm, brew and standalone installs itself).

**The doors.** `agents.installs` names each install's update plan and says whether this daemon holds the machine scope. `agents.releases` KEEPS a check that consulted anything in `distribution.json` (`lastCheckedAt` + the rows) and answers `{cached: true}` from the record alone, re-judged against today's installs — so the page opens on "Checked 09:41:20" and never checks on its own (AR-D22); a check that asked nothing (no oracle, the network off) is not kept, because it learned nothing. `agents.operations.subscribe` carries an update's own output while it runs: ANSI-stripped, a carriage-return redraw settled to its last draw, the last 16 KiB, whole snapshots at the 16 ms tick, memory only, never parsed — the receipt is the outcome; a second update of the same provider is `CONFLICT`. `agents.reveal` shows an install in Finder only when fieldd's own inventory holds the path, through the shell provider's new internal `shell.revealPath` (→ `shell.showItemInFolder`); with no desktop shell attached it refuses `UNAVAILABLE {service: shell}`. The window token holds `agents.manage`. fieldd's distribution service moved out of `agent-runtime.ts` into `agent-distribution.ts` — the first cut of the refactor slate system.html records.

**The section.** `SettingsDialog` gains Agents (Workspace, first) and a subpage header — the record's round back button beside the title; a press on the Agents item returns to the shelf. `panels/agents/` is the UI_SYSTEM.md shape: `agents-model.ts` the pure join of the doors' answers and every word, `AgentsView.tsx` the controller-free shelf and agent page, `AgentsSection.tsx` the controller, `agents-settings.css` beside them. The shelf: one row per installed agent (puppeteer's mark, "2.2.0 → 2.3.0" + Update when behind, else "version · installed by"), Check for updates as the section's act, "Checked HH:MM:SS · N updates"; loading, empty ("No coding agents on this Mac yet" + Look again), unavailable (a refused scope offers no retry) and no-machine-scope states. The agent's page: hero with Update to X / Updating… / Up to date; the updater's output card (the command, Running… or Finished HH:MM:SS, the output open while it runs and folded under its outcome after); Version (installed, latest — "Same as installed", "No release feed" or a failed check in the provider's words — Release notes ↗ in the browser, https only); Install (installed by, location + Show in Finder, automatic updates, what Update runs and who runs it); Signed in under. An update ends when its version has been read back: this window's own request re-reads once before it settles, the feed re-reads for an update another window ran. Focus moves to the page's title on the way in and back to the row on the way out. The catalog mounts the shipping views on fixture doors in six states.

**Record fidelity.** Two corrections back to the record before landing: an other install is SHOWN, never offered as a choice ("not used, new sessions use the one above" + Show in Finder, as in every pass) — so `agents.setActive` keeps its door (AR-D16) and has no UI — and the offered version is neutral ink (pass 16 took the orange out).

**Witness.** In a clean detached worktree of `19b35b1b` with every sibling at its pin and clean (rosetta through a worktree at `e8d907a`, because its checkout carries in-flight protocol-21 edits): preflight OK · `gen:check` clean — the generated Rust and schemas byte-identical, so the cargo steps (fmt, clippy, `test:rust`) were not run, no Rust input having changed · check:deps · iOS fixtures · icons · typecheck 25 projects · biome 9 errors, all main's own `docs/agent-plane` `aria-label` rows, unchanged by this slice · bundle:assert 573.5 KB raw / 154.8 KB gz (from 567.8 / 153.8 at UA-7) · `pnpm test` green in 24 projects (field-app 96 files / 870, electron-shell 718 + 2 skipped, contracts 508, dev-runner among them) and fieldd, re-run with a private `CARGO_TARGET_DIR` (finding 4): 87 files, 914 passed + 14 skipped. puppeteer `ea90c34`: `pnpm test` green (typecheck, structural gates, every suite); `format:check` red only on `scripts/capture-swarm-states.mjs`, as at its HEAD. The read-only live proof as above. The catalog over CDP (headless Chrome against a private Vite): every state in light and dark, a 1000 px window, keyboard focus on the rows.

**Findings.** (1) The first full `pnpm test` timed two distribution rows out at 5 s (350–490 ms alone): each boots a daemon and spawns the scripted agent, so the block now carries the 20 s budget the other daemon-spawning rows carry. (2) Mid-session the rosetta sibling's `PROTOCOL_VERSION` moved 20 → 21 in its working tree (19:55) while the built rosettad is still 20; every rosettad-dependent fieldd file (index-search, rosettad-daemon, -supervisor, agent-session, agent-runtime) fails against that pairing until `pnpm siblings:build` — not this slice's, and the distribution rows passed before it. (3) The catalog's "Update runs" row broke a command inside a word (`word-break: break-all`); paths wrap at their spaces first now (`overflow-wrap: anywhere`). (4) A clean worktree needs fieldd's `<root>/target`: its global setup builds field-native and looks there, and `~/.cargo/config.toml` sends every build to the shared SSD target — so the first clean run rebuilt the shared `target/debug/field-native` (identical sources, 20:19) before the witness moved to a private `CARGO_TARGET_DIR` with `target` linked to it, the escape hatch the cargo config documents.

**Owed.** Agent Profiles (AR-S2) waits on one ruling: whether a cross-agent profile groups the per-provider personas in fieldd (A) or in puppeteer's registry (B, the lean). A live pass in the product window (James's dev-runner was running; nothing was driven in it). The puppeteer push, so CI can fetch the pin.

## UA-7c — a user switch is one transition: the window defocuses into the next user's face, and the reload happens under a frame both windows share (2026-09-22; `0361e6cf`)

**Why now.** James: "when clicked switch to another user, entire window should first enter blur, and the user icon appear large at the center, and there will be visual indicators indicating that we are switching to another user, the whole transition should feel seamless, buttery smooth, intuitive". A switch reloads the window (UA-D15); until now the reload was the only feedback.

**As built.** DESIGN.md §8 "The switch" first. The window being left converges on the boot splash wearing the next user's face — the pressed face travels from its row to the centre at 128px (held, 560ms island), the field defocuses (40px backdrop blur), recedes to 0.98 and freezes (M5), the splash's ground rises over it, and "Switching to", the name and the splash's real bar and stage line settle in — and only then asks main. The reloaded window paints that frame first, runs its real boot stages on the bar, and at the reveal flies the face home to the Me corner (to Setup pane 2's face for a user not set up yet) while the new field comes into focus. A refusal plays it backwards; New user… leaves to the plain splash; reduced motion fades in place. `boot/switch.ts` conducts (every switch and New user… door goes through `leaveFor`; a validated, read-once `sessionStorage` handoff carries the face across the reload); `SwitchSceneView` + `SwitchLayer` draw it; the catalog stages it (`SwitchPreview`). The product entry is render-blocking with a synchronous, theme-stamped first render, kept through the build by `render-blocking-entry.ts` and asserted by `verify-production-renderer`. The spec's UA-D15 is amended on dev-local. Not covered: the tray's Switch User (main reloads unannounced; it boots on the plain splash).

**Witness.** Gated on the exact tree (`b3d838c2`), `pnpm verify` then the rest of its chain in a clean worktree: preflight, fmt, clippy, bundle:assert, test:rust (263) and gen:check green; field-app 893 and electron-shell 721 green; typecheck red only at fieldd's agent-distribution.ts and fieldd's rosettad/index rows red, both from UNCOMMITTED edits in the puppeteer and rosetta siblings (at their pins the types and the protocol agree); lint red only on main's agent-plane pages; logging's seed-fuzz green alone. The catalog specimen was recorded frame by frame in headless Chrome, both themes, both frames, a refusal and reduced motion; the leaving window's held frame and the arriving window's first frame are pinned equal in markup, and photographed identical in dark (0 differing pixels). No real user switch was run in Electron before landing — James's dev run is the live witness.

**Findings.** (1) Chromium keeps the old frame on screen through a reload of an `http:` page until the new page paints content, but not through a reload of a `vibefield-app:` page: an offscreen Electron 43 probe saw the new page's stylesheet ground presented ~22ms after the reload — a packaged reload flashed bare ground for as long as the boot script ran, invisible in dev. `blocking="render"` on the head entry holds the first frame until the entry has run (no intermediate frame at 150ms or 900ms of script). (2) Vite's build drops `blocking` when it re-emits the bundled entry tag; the dev server keeps it. (3) The boot splash painted in the light theme for a dark-mode user until the workspace mounted under it: the theme was stamped by `useTheme`, not before the first render. (4) The first catalog photographs showed the scene's ground transparent: `.vf-splash` lives in `boot.css`, which only BootRoot imported — the product loaded it by accident of order, the catalog did not. The scene owns that import now.
