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
`unshiftedCodepoint` defaulting 0 exactly as upstream's `#[serde(default)]`); tag 22 in
`TpMessageType`, the 8th control-INBOUND entry; four golden fixtures
(`tp-send-input.{text,key,mouse}` + `tp-tagged-message.send-input` with rows −5). **The cell
(`field-native/src/tp/`):** `wire.rs` serde mirrors whose `InputOp::Key/Mouse` EMBED
`ghosttea::session::{KeyInput, MouseInput}` — the fixture test deserializing the vectors into the
engine's own types IS the cross-crate drift guard; `activation.rs` `send_input` (a PURE read):
own-control-leg check → `leaseEpoch` placement fence (a stale-route input never reaches the
engine) → the `input` lease dimension (the one authority — rights, presentation, lag, expiry
margin) → a synchronous renewal-margin backstop (a stale-`Allowed` lease cannot leak past the
margin) → the presenting view (demand-none = nothing to type into); `door.rs` dispatch arm +
`perform_input_op` mapping the op onto ghosttea's view-authorized family with the CELL-owned fence
coordinates (`view`, `client`, `attachmentEpoch` from the activation table — the wire cannot forge
an epoch), engine `authorize_input` the backstop. Refusals are DROP-AND-AUDIT (§5.4's "always
rejects"; the echo of accepted input is a frame; `CellActivationStatus.input` already says why
typing is dead) — no per-keystroke ack rides the wire. **The renderer half
(`field-app/src/terminal/routed/encode-input.ts`):** the pure `encodeRoutedInput` context →
tagged-`SendInput` projection the G23 routed host will take verbatim (`host.encodeInput =
encodeRoutedInput`); `TerminalKeyEvent.location`/`timestamp` never reach the wire; an operation
kind this build cannot encode returns null — closed, not guessed. **Tests:** the activation unit
walks EVERY drop reason (no-activation · wrong-leg · stale-lease-epoch · right-expired ·
no-view · input-not-allowed) and the Proceed's cell-owned coordinates; the e2e types over a real
WebSocket into a real `/bin/sh` — acceptance witnessed by ghosttea's human-input epoch
(`record_input(true)`; every refusal and the dedup return first), a replayed `inputSequence`
authorized ONCE, a stale `leaseEpoch` and a read-only second session (same socket pair) leaving
their epochs UNMOVED, and the typed `exit` TERMINATING the shell — the PTY round trip no header
inspection can fake (8/8 reruns green); the wire fixture test (the drift guard); contracts 330/330
with the new SendInput describe + leg-decode row; the encode helper validated against the contract
schema on the control leg. `pnpm verify` verbatim green. **NOT here:** the G22 `ServiceSessions`
integration into the production door (`cell.rs` still `NoSessions`), the routed HOST in the
renderer (`runtime-factory.ts` still builds the legacy port runtime; the direct-door flag is still
CSP-only) — that integration, then the full direct-path proof, PRECEDE S3e per the corrected
sequence; and the agent input lane (`automation_input`, epoch-gated so human input wins) is a
DISTINCT future seam, not this verb.
