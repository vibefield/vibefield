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
