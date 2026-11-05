# Run briefings: sparks (CP-1d) and plain runs (MT-0)

The runtime API is owned by Puppeteer's [per-run briefing guide](https://github.com/vibefield/puppeteer/blob/main/docs/guides/run-briefings.md), introduced by [#53](https://github.com/vibefield/puppeteer/pull/53) for [#52](https://github.com/vibefield/puppeteer/issues/52). This page owns VibeField's consumption of that API. The dependency pin is [Puppeteer v0.3.2](https://github.com/vibefield/puppeteer/releases/tag/v0.3.2), commit `95a70aa77aad6bb0ca30805651797cffb153e1c2`; its publication and clean npm-consumer verification passed. The implementation remains stacked on CP-1c until that compose slice lands.

`packages/fieldd/src/agent-briefing.ts` (`AgentBriefings`; `agent-spark-briefing.ts` until MT-0) constructs each spark's briefing from the verified spark record, the current contents of its editable `CLAUDE.md`, and a fresh `native.door.info` result. It passes `mcpServers.vibefield`, `allowTools: ["vibefield/*"]`, and `instructions`. The door's command and arguments contain no credential or caller-supplied identity. No `.mcp.json` is created.

`AgentRuntimeService` requests the briefing for every spark process birth: hatch/spawn, run-id resume, native-id resume of a recorded conversation, and manual or idle replacement of a pending run. A native-id resume retains the newest signed record's spark and origin, alongside the existing rule for its most recent recorded model selection. A pending replacement prepares and validates the briefing before terminating its old terminal. Preparation failures retain the pending run. Ordinary sessions receive no spark briefing. *(Corrected 2026-10-30 by MT-0, the tool plane: an ordinary session now receives the plane's briefing for its audience; see "Plain runs" below.)*

The signed session record keeps the spark identity. It does not keep MCP configuration or instructions; the next process receives freshly constructed values. The spark's signed record still bounds tool access through its Agent Profiles. The compose service and its verbs continue to import only fieldd services (R29); the runtime handoff lives outside `compose/`.

`agent.providers[].briefing` projects Puppeteer's optional capability declaration. A reader must treat missing fields as unsupported, and an unknown process topology as unidentified. Hatch refuses unsupported agents before writing a spark folder or record, and each later birth checks support again. Since CP-5a both read the catalog's spark claim before these facts (see "The catalog's spark claim" below). An installed executable can still refuse flags its adapter supports. *(Item 124, 2026-10-31: such a birth is made once more without the briefing, and says so; see "Plain runs" below.)*

## Plain runs (MT-0, the tool plane)

Every run the door can name is an agent (MT-D3), and the tool plane serves it the catalog's `agent` rows (History and
the projects list at MT-0; `draft/thinking-tool-plane.md`, ruled 2026-10-30). `AgentRuntimeService` asks for a plain
run's briefing at the same four births (`briefingFor`, with no spark). `AgentBriefings.forRun` answers
`mcpServers.vibefield` (the same `native.door.info` bridge) and `allowTools` naming the run's read-only `agent` rows
exactly (`vibefield/history_search`, `vibefield/history_read`, `vibefield/projects_list`), with no `instructions`: the
server's own `instructions` say which rooms the caller holds (provisional, until the history room's eval shows the
harness puts a server's instructions in front of the model). It degrades rather than refuses: an agent that does not
declare `mcpServers` and `allowTools`, a process topology other than `terminal`, or a door that does not answer means
the run starts with no briefing. The check comes first, because the runtime refuses a whole launch
(`UNSUPPORTED_LAUNCH_FIELD`) whose briefing carries a field the agent does not declare. A launch typed into a managed
pane is adopted by puppeteer's spawn-through, which applies no briefing at 0.3.2, so it holds no door until petition
PU-J.

*Corrected 2026-10-31 (item 124):* "the check comes first" checked the agent's DECLARED capability
(`agent.providers[].briefing`), never the executable on the PATH. puppeteer's adapter probes the executable itself
(Claude's `--help`, for `--mcp-config`, `--allowedTools` and the instructions' two flags) and refused every briefed birth
of a Claude that lacks them as `UNSUPPORTED_LAUNCH_FIELD`. So from MT-0 such a Claude started no agent at all, and the
godview smoke's stub was one (`smoke:godview` row 23's launch rung, red since MT-0 and unseen while the row was owed). Since item 124
such a birth is made once more without the briefing (`fieldd/src/agent-door-launch.ts`): the fold's row says
`door: "off"`, the ledger has `tools.door.withheld`, and the log carries puppeteer's own sentence. A spark's birth too:
it thinks with its folder's `CLAUDE.md`, which Claude reads itself, and without its tools. A second refusal is the
launch's own.

## The talk room (CP-2)

A spark's door also serves CP-2's six rows (`draft/compose-plane/cp2-talk-room.md`, ruled 2026-10-31): `agent_spawn`,
`agent_watch` and `agent_unwatch`, and `agent_send`, `agent_interrupt` and `agent_stop`. The talk room
(`fieldd/src/tool-plane/rooms/talk/`) answers them. Every call is held to the spark's profiles and to CP-D5 and CP-D6's
reach, and is written to the audit log before it acts.

- **One queue per session** (`fieldd/src/agent-input-queue.ts`; CP-L5). `agent_send` and a spawn's tasks join it, and
  so do fieldd's own wakes. The head is delivered when the session's monitor reads idle with no blocker, through
  puppeteer's `submitPrompt`, one input per idle moment.
- **Marked by source** (CP2-D1). A spark's words land as "Vela (your spark) on your behalf:" and then the words. A wake
  lands as "VibeField: …". The words count as the person's, by proxy (CP-D2), but no wording is a boundary. The door's
  naming, the holds and the record are.
- **Receipts** (CP2-D2). A rejected delivery (a dialog open, another injection, or the person's keystrokes overtaking it)
  waits for the next idle. An uncertain one is never resent, and its sender is told on its next wake.
- **Kept** (CP2-D3). Each session's queue is one file under `LAYOUT.AGENT_INPUTS_DIR` (0600 in 0700), so it outlives a
  fieldd restart. Since CP-3 (LEANS P3) each file is signed by fieldd's one record signer under
  `LAYOUT.AGENT_INPUTS_KEY_FILE`, its run inside the signature. At restore a file that is unsigned (CP-2's own bare
  array among them), does not verify, does not parse, names another run, or is exposed to other users is set aside
  (`fieldd.inputs.set_aside`) and never delivered. That holds against an edit. The key is 0600 to the same uid, so it
  is no wall against an agent that reads it (EL7), nor against one that puts back a file fieldd once wrote for that
  run.
- **Wakes** (CP2-D6, `fieldd/src/agent-waker.ts`). They come from the monitor rows fieldd already hears: a run finished,
  is asking, failed, or ended. They wake the spark that started it and the sparks watching it, and a spark with no live
  session keeps its wakes until one opens.
- **Not yet:**
  - CP2-D7's "wait for his quiet" needs the time of the person's last keystroke in the pane, which the floor does not
    give fieldd. Until it does, the terminal service's ordering against accepted human input is the guard (the mark's
    B).
  - *Corrected 2026-10-31 (CP-3):* this said "CP-D7's cap past 8 live agents is refused as `limit`. Its needs-you card
    comes with CP-3." Since CP-3 such a spawn waits in the needs-you queue for Allow one more (below), and Not now is
    told as `limit`. The window's needs-you card answers it (DESIGN.md §8 "Chat's thread").

## The person (CP-3)

A spark's door serves CP-3's two rows too (`draft/compose-plane/cp3-the-person.md`, ruled 2026-10-31), and every
settled run's door serves `notify` (MT-D11). The you room (`fieldd/src/tool-plane/rooms/you/`) answers them over the
needs-you queue, fieldd's one list of what waits on the person, which the window reads and answers through `needs.*`.

- **`ask_user`** returns at once with the item its question waits in. The answer is a wake: one marked line of facts in
  the spark's own input queue ("VibeField: you answered Vela's question "Push the fix?": Push", DESIGN.md §9), and a
  sleeping spark is resumed for it (CP3-D7 A).
- **`notify`** is said on every window's status line, and as an OS notice while no window is in front (CP3-D5 A). A
  plain run's harness asks the person before each call, because its allowance takes read-only rows alone (MT-D7).
- **Holds.** A spark's first send into a session the person started answers `{queued: false, held}` and waits for his
  Allow, which lasts for that run (CP3-D3 B). Past 8 live agents a spawn answers `{held, queued}` and waits for Allow
  one more (CP3-D4 A). Each call answers at once and is no refusal; the person's answer reaches the spark as a wake.
- **Kept.** Each item is a signed record under `LAYOUT.NEEDS_DIR`, signed by the one record signer under
  `LAYOUT.NEEDS_KEY_FILE`, with the input queues' EL7 claim: it holds against an edit, not against an agent that reads
  the key. An agent's own ask is read from its run's blockers and never kept.

## The catalog's spark claim (CP-5a)

Which agents may be a spark is a decision, and the catalog makes it (CP5-Q9 (a), ruled 2026-11-04). `AgentOffers.spark`
(`packages/contracts/src/agent-catalog.ts`) is claimed only on a `supported` row, once a live spark of that agent is
witnessed here, and a `deprecated` row may keep it, because a deprecated agent's sparks still wake (AC-D3). Wall R23
holds the claim to the pin: it needs the pin's `descriptor.briefing` to declare all three fields with
`mcpServerProcess: "terminal"` (`pin-claim` otherwise), and a claim under any other status is red (`claim-status`). The
claim is the decision and the facts are the proof, so a claim can never get ahead of the pin.

fieldd's gate (`AgentBriefings`) reads the claim first, before any fact:

- **Hatch** (`requireSupported`, before a folder or record is written) needs the catalog to offer the row and the row
  to claim `spark` (`isOffered(id, "spark")`). Without that it refuses `PRECONDITION_FAILED {reason:
  "spark-not-offered", provider}`, "VibeField does not offer this agent as a spark", and reads no fact.
- **Every later birth** (`prepare`: a wake, a resume, a pending replacement) needs the row visible and claiming
  (`isVisible(id)` and `offers.spark`). It answers the same refusal when either is missing, so a spark whose agent
  loses the claim cannot wake, and its Wake says so in fieldd's words (ruled with CP5-Q9, 2026-11-04).
- Then the facts, as CP-1d wrote them: `spark-briefing-unsupported`, then `spark-door-identity-unsupported`.
  `sparkHatchRefusal` and `sparkFactsRefusal` are the one copy of the rule. `agent.providers` reads the same
  predicate for `offers.spark` (true only where this device's hatch would pass it), and the New spark sheet reads that
  key, never the facts (DESIGN.md §8). The facts stay as the sheet's fallback only for a row with no key: only a daemon
  older than the claim sends one, and that daemon's own hatch is gated by those facts alone.
- A plain run's `forRun` reads no claim (MT-D9): every run the door can name is briefed by the facts.

From CP-5a every unclaimed row reads `spark-not-offered` at hatch: Codex, Grok, ACP and the rest. The two older reasons
remain only for a row that claims `spark` on a pin lacking the facts, which R23 fails at preflight, and for `forRun`'s
silent degrade. Claude Code is the one row that claims it. Its live witness, a spark by hand on Claude Code (hatch,
Ready, the audit's `tools.agents_list` line naming its run, Stop), is owed by James before CP-5a's records.

## Process identity is a separate prerequisite

The current native door authenticates a process by its terminal ancestry. CP-1d therefore requires all three briefing fields and `mcpServerProcess === "terminal"`. There are no vendor-id branches in this policy. Claude's adapter declares this topology. Codex's app-server and Grok's shared leader start MCP children under helpers, and ACP delegates their ownership externally. They remain refused until the door has a trusted process-to-run association for those topologies.

*Corrected 2026-11-04 (CP-5a; ER-C32):* "they remain refused until the door has a trusted
process-to-run association" was true of Codex alone. Grok's adapter at 0.3.3 declares ACP's capabilities on a helper
(`mcpServers` only; no `allowTools` and no `instructions`), so it also waits on taking a spark's brief and allowance
(PU-O). ACP declares the same fields on an external process, so it waits on both. From CP-5a every agent waits first on
the catalog's claim (above), and an unclaimed row is refused `spark-not-offered` before either fact is read.

This corrects the compose study's §17 assumption that receiving the briefing alone enables Codex sparks. Puppeteer delivers Codex's briefing; VibeField still needs to identify its MCP child. A role name, environment token or claimed run id does not supply that proof.

## Validation

- `agent-briefing.test.ts` (`agent-spark-briefing.test.ts` until MT-0): fresh endpoints and edited instructions, verified records, capability and ancestry refusals, missing briefs, and no folder MCP configuration.
- `compose-sparks.test.ts`: unsupported hatch has no durable side effects, and the existing hatch/list/open behavior.
- `agent-session.test.ts`: real native terminals with a scripted provider; hatch and run-id resume receive the briefing, and a terminal child launches its native bridge, lists the tools and calls `agents_list` on both births. Ordinary launches receive no spark briefing (since MT-0 they receive the plain-run briefing below), a legacy spark resumes by native id with its identity, and a failed pending preparation leaves its old terminal alive.
- `agent-providers.valid.json`: the optional capability declaration beside an older row that omits it; contracts fixtures remain tolerant of older daemons. Since CP-5a the claimed row carries `offers.spark` and the older row has no key.
- CP-5a: `agent-briefing.test.ts` refuses an unclaimed row `spark-not-offered` at hatch and at every birth before a fact is read, lets a deprecated row's claimed spark be born again, and leaves `forRun` unchanged; `compose-sparks.test.ts` shows that refusal writes no folder or record; `agent-runtime.test.ts` answers `offers.spark` on the real pin; R23's self-test holds the claim's four rotten shapes (no fields, a helper's process, unclaimed on a supported row, claimed on a preview row); `new-spark.test.ts` holds the sheet's order, its filter and its fallback.

The daemon witness uses an isolated `CARGO_TARGET_DIR` and disposable user roots. Native vendor delivery is covered by the upstream Claude and Codex briefing proofs. These are separate from a live-user Chat smoke and from authorizing helper-process callers.
