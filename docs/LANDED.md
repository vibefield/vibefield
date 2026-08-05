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
