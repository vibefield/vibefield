# Puppeteer package pin check (vibefield 433505f vs puppeteer 748d015)

Read-only check, Fri Nov 6 2026 (PST). Nothing was committed or pushed.

## Verdict
- **Match with 748d015a: NO** (it's a partial match: most files are the same, but the monitor core, normalization and views differ).
- **Exact match: `52d09c8e84951b9a355a6700eac2dfc1290a9fa0`** = tag `v0.3.3` ("chore(main): release 0.3.3 (#56)", 2026-11-02 14:25 PST). All 691 emitted dist `.js` files in all 17 packages match byte-for-byte after whitespace normalization.
- 748d015a is **4 commits after v0.3.3** and is already past release 0.3.4 (`7ca6aab9`). Its `core/src/version.ts` says `0.3.4`.

## What vibefield pins
In `pnpm-lock.yaml` overrides at 433505f, every one of these is `0.3.3`: `@vibefield/puppeteer-runtime`, `-builtin-providers`, `-core`, `-record`, `-monitor`, `-view-sdk`, `-views`. The adapters come in transitively as `@vibefield/puppeteer-adapter-{acp,antigravity,claude,codex,copilot,grok,hermes,kimi,opencode,pi}@0.3.3` (dependencies of builtin-providers). npm publish time for 0.3.3: 2026-11-02 14:43 PST.

## Method
1. `npm pack` all 17 packages @0.3.3. The tarballs hold only `dist/` and `package.json`, with no src and no sourcesContent in the maps.
2. Transpiled each source file at the candidate commits with TypeScript 5.9.3 `transpileModule` (ES2022/ESNext, verbatimModuleSyntax, isolatedModules, react-jsx, which is the repo's tsconfig.base) and compared it to the dist `.js` with whitespace and the sourceMappingURL removed. `.d.ts` files were not compared.

| commit | result |
|---|---|
| 0987664d (v0.3.2..0.3.3 fix) | all match except core/version.ts |
| **52d09c8e (v0.3.3)** | **691/691 match** |
| 7ca6aab9 (v0.3.4) | 55 files differ (adapter evidence refresh, #59) |
| 748d015a (audit pin) | 88 files differ, plus new files |

## Commits between the shipped package and the audit pin
- `5a5f285e` feat(adapters): refresh evidence and native-TUI promotion proofs (#59). Changes `monitor-capabilities.ts` for codex/copilot/hermes/kimi/opencode/pi and `monitor.ts` for hermes/kimi/opencode.
- `7ca6aab9` release 0.3.4
- `7d87dd82` perf(monitor): one projection per coalesce window, a dead run blocked by its failures alone… (#64). **Rewrites the core monitor model**: project/rate/reduce/cost/notifications, plus the new `monitor/selection.ts`, `transitions.ts`, `usage-index.ts`, and `runtime/services/monitor-service.ts`.
- `3c12ba73` fix(adapter-claude)!: forwarder runtime, typed turn endings (#65). Changes claude pipeline/transcript, `core/events/turn.ts`, `catalog.ts`, `host.ts`, and adds `builtin-providers/src/forwarder.ts`.
- `748d015a` fix(views): swarm/rain rendering fixes (#66). Changes views and view-sdk.

## Differences relevant to the monitor model, views and normalization (748d015a vs the shipped 0.3.3)
Most relevant: `packages/core/src/monitor/{project,rate,reduce,cost,notifications}.ts`, `packages/core/src/monitor-spi.ts`, `packages/runtime/src/services/monitor-service.ts`, the `packages/*/src/normalization/monitor-capabilities.ts` files (codex, copilot, hermes, kimi, opencode, pi), `normalization/monitor.ts` (hermes, kimi, opencode), and the views swarm/rain files.

Files at 748d015a that are **not in the shipped package at all**: `packages/core/src/monitor/selection.ts`, `transitions.ts`, `usage-index.ts`, `packages/builtin-providers/src/forwarder.ts`, `packages/monitor/src/backend/testing/fixtures` (test-only).

Full list of emitted files whose compiled output differs:
- **adapter-acp**: `packages/adapter-acp/src/services/prompt.ts`
- **adapter-antigravity**: `packages/adapter-antigravity/src/services/distribution.ts`, `packages/adapter-antigravity/src/services/account-usage.ts`, `packages/adapter-antigravity/src/services/models.ts`
- **adapter-claude**: `packages/adapter-claude/src/observation/hook-bridge.ts`, `packages/adapter-claude/src/observation/status-channel.ts`, `packages/adapter-claude/src/observation/transcript/services/jsonl-reader.ts`, `packages/adapter-claude/src/observation/transcript/wire.ts`, `packages/adapter-claude/src/observation/transcript/conversation.ts`, `packages/adapter-claude/src/observation/transcript/provider.ts`, `packages/adapter-claude/src/detection.ts`, `packages/adapter-claude/src/services/profiles.ts`, `packages/adapter-claude/src/generated/registry.ts`, `packages/adapter-claude/src/generated/detection-surface.ts`, `packages/adapter-claude/src/driver.ts`, `packages/adapter-claude/src/launch/settings.ts`, `packages/adapter-claude/src/launch/invocation-grammar.ts`, `packages/adapter-claude/src/launch/prepare.ts`, `packages/adapter-claude/src/normalization/pipeline.ts`
- **adapter-codex**: `packages/adapter-codex/src/index.ts`, `packages/adapter-codex/src/observation/observer.ts`, `packages/adapter-codex/src/observation/thread-history.ts`, `packages/adapter-codex/src/services/prompt.ts`, `packages/adapter-codex/src/launch/tui-session.ts`, `packages/adapter-codex/src/normalization/turn.ts`, `packages/adapter-codex/src/normalization/monitor-capabilities.ts`
- **adapter-copilot**: `packages/adapter-copilot/src/detection.ts`, `packages/adapter-copilot/src/launch/invocation-grammar.ts`, `packages/adapter-copilot/src/normalization/monitor-capabilities.ts`, `packages/adapter-copilot/src/normalization/mode.ts`
- **adapter-grok**: `packages/adapter-grok/src/normalization/turn.ts`
- **adapter-hermes**: `packages/adapter-hermes/src/services/models.ts`, `packages/adapter-hermes/src/generated/detection.ts`, `packages/adapter-hermes/src/driver.ts`, `packages/adapter-hermes/src/launch/gateway-host.ts`, `packages/adapter-hermes/src/normalization/turn.ts`, `packages/adapter-hermes/src/normalization/monitor-capabilities.ts`, `packages/adapter-hermes/src/normalization/interaction.ts`, `packages/adapter-hermes/src/normalization/monitor.ts`, `packages/adapter-hermes/src/normalization/pipeline.ts`, `packages/adapter-hermes/src/normalization/types.ts`
- **adapter-kimi**: `packages/adapter-kimi/src/observation/session-store.ts`, `packages/adapter-kimi/src/detection.ts`, `packages/adapter-kimi/src/launch/invocation-grammar.ts`, `packages/adapter-kimi/src/normalization/monitor-capabilities.ts`, `packages/adapter-kimi/src/normalization/adapter.ts`, `packages/adapter-kimi/src/normalization/monitor.ts`, `packages/adapter-kimi/src/normalization/pipeline.ts`, `packages/adapter-kimi/src/normalization/delegation.ts`
- **adapter-opencode**: `packages/adapter-opencode/src/transport/event-stream.ts`, `packages/adapter-opencode/src/transport/client.ts`, `packages/adapter-opencode/src/detection.ts`, `packages/adapter-opencode/src/services/distribution.ts`, `packages/adapter-opencode/src/services/models.ts`, `packages/adapter-opencode/src/services/extensions.ts`, `packages/adapter-opencode/src/services/profiles.ts`, `packages/adapter-opencode/src/driver.ts`, `packages/adapter-opencode/src/launch/invocation-grammar.ts`, `packages/adapter-opencode/src/normalization/monitor-capabilities.ts`, `packages/adapter-opencode/src/normalization/monitor.ts`
- **adapter-pi**: `packages/adapter-pi/src/detection.ts`, `packages/adapter-pi/src/services/models.ts`, `packages/adapter-pi/src/services/prompt.ts`, `packages/adapter-pi/src/driver.ts`, `packages/adapter-pi/src/launch/native-invocation.ts`, `packages/adapter-pi/src/launch/invocation-grammar.ts`, `packages/adapter-pi/src/normalization/monitor-capabilities.ts`, `packages/adapter-pi/src/normalization/tool.ts`
- **builtin-providers**: `packages/builtin-providers/src/providers.ts`
- **core**: `packages/core/src/monitor/notifications.ts`, `packages/core/src/monitor/rate.ts`, `packages/core/src/monitor/reduce.ts`, `packages/core/src/monitor/cost.ts`, `packages/core/src/monitor/project.ts`, `packages/core/src/monitor-spi.ts`, `packages/core/src/events/turn.ts`, `packages/core/src/events/catalog.ts`, `packages/core/src/services/invocation-arguments.ts`, `packages/core/src/version.ts`
- **runtime**: `packages/runtime/src/services/monitor-service.ts`
- **view-sdk**: `packages/view-sdk/src/toolkit/motion.ts`, `packages/view-sdk/src/toolkit/worker.ts`
- **views**: `packages/views/src/views/rain/RainView.tsx`, `packages/views/src/views/swarm/gpu/frame-layout.ts`, `packages/views/src/views/swarm/gpu/swarm-renderer.ts`, `packages/views/src/views/swarm/gpu/shaders/body.wgsl.ts`, `packages/views/src/views/swarm/gpu/shaders/common.wgsl.ts`, `packages/views/src/views/swarm/AgentSwarm.tsx`

Same in both: `@vibefield/puppeteer-monitor` (17/17) and `record`. `monitor` matches at every candidate commit.

## Implications for the audit
- Anything traced at 748d015a for the files above (especially the capability tables GV-AUDIT4 cited, and core monitor projection/rate) describes **unreleased code that vibefield at 433505f does not run**.
- For "what vibefield ships" evidence, use `v0.3.3` / `52d09c8e`. Alternatively, label 748d015a findings "pinned source (post-0.3.3)" and re-check those files at 52d09c8e.
- Reproduce with: `git -C src/puppeteer diff 52d09c8e 748d015a -- packages/*/src`.
