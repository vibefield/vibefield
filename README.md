# VibeField

A personal programmable field for agentic computing — infinite canvases hosting live widgets,
a two-plane daemon pair per device (`fieldd` Node product plane · `field-native` Rust native plane),
a private mesh across machines, and an iPhone companion.

> Build anything. See everything alive.

## Monorepo layout

| Path | What |
|---|---|
| `packages/contracts` | `@vibefield/contracts` — zod-first source of every VibeField-owned protocol |
| `packages/field-native` | Rust native-plane daemon (embedded ghosttea TerminalService + MeshGateway) |
| `packages/fieldd` | Node product-plane daemon (services L2–L5 + plugin host) |
| `packages/fieldd-client` | renderer/worker client (dual loopback WS, generated hooks) |
| `packages/plugin-sdk` | the plugin API surface (manifest types, renderer ctx, worker harness) |
| `packages/shell-ui` | design kit (CardShell, StateBadge, WidgetInputBoundary, tokens) |
| `packages/plugins/*` | built-in plugins — every feature ships here (note, terminal, agent, …) |
| `apps/desktop` | the Electron spine (stages: windows, field substrate, plugin runtime, Godview) |
| `services/push-relay` | the one cloud hop — open-source APNs wake-hint relay (CF Worker) |

Design docs live in `draft/` — local-only, tracked on the `dev-local` branch
(`pnpm commit-draft` snapshots them; the branch is never pushed).
