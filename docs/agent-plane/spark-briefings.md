# Spark briefings (CP-1d)

The runtime API is owned by Puppeteer's [per-run briefing guide](https://github.com/vibefield/puppeteer/blob/main/docs/guides/run-briefings.md), introduced by [#53](https://github.com/vibefield/puppeteer/pull/53) for [#52](https://github.com/vibefield/puppeteer/issues/52). This page owns VibeField's consumption of that API. The dependency pin is [Puppeteer v0.3.2](https://github.com/vibefield/puppeteer/releases/tag/v0.3.2), commit `95a70aa77aad6bb0ca30805651797cffb153e1c2`; its publication and clean npm-consumer verification passed. The implementation remains stacked on CP-1c until that compose slice lands.

`packages/fieldd/src/agent-spark-briefing.ts` constructs each briefing from the verified spark record, the current contents of its editable `CLAUDE.md`, and a fresh `native.door.info` result. It passes `mcpServers.vibefield`, `allowTools: ["vibefield/*"]`, and `instructions`. The door's command and arguments contain no credential or caller-supplied identity. No `.mcp.json` is created.

`AgentRuntimeService` requests the briefing for every spark process birth: hatch/spawn, run-id resume, native-id resume of a recorded conversation, and manual or idle replacement of a pending run. A native-id resume retains the newest signed record's spark and origin, alongside the existing rule for its most recent recorded model selection. A pending replacement prepares and validates the briefing before terminating its old terminal. Preparation failures retain the pending run. Ordinary sessions receive no spark briefing.

The signed session record keeps the spark identity. It does not keep MCP configuration or instructions; the next process receives freshly constructed values. The spark's signed record still bounds tool access through its Agent Profiles. The compose service and its verbs continue to import only fieldd services (R29); the runtime handoff lives outside `compose/`.

`agent.providers[].briefing` projects Puppeteer's optional capability declaration. A reader must treat missing fields as unsupported, and an unknown process topology as unidentified. Hatch refuses unsupported agents before writing a spark folder or record, and each later birth checks support again. An installed executable can still refuse flags its adapter supports.

## Process identity is a separate prerequisite

The current native door authenticates a process by its terminal ancestry. CP-1d therefore requires all three briefing fields and `mcpServerProcess === "terminal"`. There are no vendor-id branches in this policy. Claude's adapter declares this topology. Codex's app-server and Grok's shared leader start MCP children under helpers, and ACP delegates their ownership externally. They remain refused until the door has a trusted process-to-run association for those topologies.

This corrects the compose study's §17 assumption that receiving the briefing alone enables Codex sparks. Puppeteer delivers Codex's briefing; VibeField still needs to identify its MCP child. A role name, environment token or claimed run id does not supply that proof.

## Validation

- `agent-spark-briefing.test.ts`: fresh endpoints and edited instructions, verified records, capability and ancestry refusals, missing briefs, and no folder MCP configuration.
- `compose-sparks.test.ts`: unsupported hatch has no durable side effects, and the existing hatch/list/open behavior.
- `agent-session.test.ts`: real native terminals with a scripted provider; hatch and run-id resume receive the briefing, and a terminal child launches its native bridge, lists the tools and calls `agents_list` on both births. Ordinary launches receive no spark briefing, a legacy spark resumes by native id with its identity, and a failed pending preparation leaves its old terminal alive.
- `agent-providers.valid.json`: the optional capability declaration beside an older row that omits it; contracts fixtures remain tolerant of older daemons.

The daemon witness uses an isolated `CARGO_TARGET_DIR` and disposable user roots. Native vendor delivery is covered by the upstream Claude and Codex briefing proofs. These are separate from a live-user Chat smoke and from authorizing helper-process callers.
