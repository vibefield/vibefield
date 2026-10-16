# The agent plane

`draft/thinking-ar-agent-plane.md` remains the design authority. This document is the INDEX: what
the agent plane is, who owns which part of it, and where every governing document lives across the
three repositories. Start here, then read the page that owns the seam you are changing.

The agent plane is everything between a user asking for an agent and that agent's work being
visible, controllable and searchable — on this device and on the user's other devices. It is built
from three repositories and one spine. **puppeteer** is the managed-session runtime, running inside
fieldd. **rosetta** is the agent data plane, a `rosettad` process per user root supervised by fieldd.
**VibeField** composes the two at the native session id and owns custody, policy and presentation.

The files service is a separate low-level seam: **mille** runs in a fieldd-owned
worker, with bounded row doors for own devices and a ticketed direct plane for
History's worktree guest. The phone's folder picker uses those rows and sends
`agent.spawn {cwd}` to the selected desktop. See the [workspace API](agent-plane/api.html#workspace)
and [ownership and import wall](agent-plane/architecture.html#files-service).

For DK's tree consumer, `WorkspaceClient.pickFolder()` opens the native picker and
returns a persisted picked root or `null` on cancellation. Pass that root directly to
`attach(root, path?)` to obtain an independent recovering lease, without resolving it
through the bounded roots list. Each `ports` event transfers a fresh tree/git pair;
the consumer replaces its engine on reconnect and disposes the lease on close.
The widget, decorations and composer drag integration remain DK's work.

The packaged Files worker has a separate artifact check:
`pnpm --filter @vibefield/desktop run package:verify:files --native-root <Resources/bin>`.
It runs the real worker, door and attachment suites against the shipped fieldd executable,
worker bundle and mille addon. `--require-signed` also requires the frozen macOS team's
Developer ID signatures, timestamps and hardened runtime on fieldd and the addon; the macOS
release command runs it before the existing app/notarization checks. The tests' fieldd
control host remains source-based, so this does not replace an installed-app or phone run.

## The ownership law

Stated at `draft/thinking-ar-agent-plane.md` §1. Read the middle column as hard as the left one.

| Repo | Owns | Must never know |
|---|---|---|
| **puppeteer** (TS, in fieldd) | one `Agent` per managed run: lifecycle, adapter-owned live semantics, guarded control, workspaces, own-action records, one live monitor backend per desktop and its model, the launch recipe | PTYs (it borrows a host) · the desktop · other devices · transcript ingestion and history search |
| **rosetta** (Rust, `rosettad`) | every agent's on-disk history on this device as a raw ledger plus a disposable canonical projection; full-text search; the live transcript tail; consent over which runtimes enroll | process liveness · control · VibeField · puppeteer |
| **vibe-field** | custody (PTYs + mesh in field-native), composition and policy in fieldd, presentation (Godview, canvas, History, the phone) | any vendor's format, grammar or protocol — **AR-L1: VibeField knows no vendor** |

Enforced by walls R20/R21/R22 in `scripts/check-import-boundaries.mjs`, which `scripts/preflight.mjs`
runs twice (`--self-test`, then `--enforce`). `pnpm verify` gets them through `pnpm preflight`, its
first step — **not** through `pnpm check:deps`, which is a different script.

MV's monitor ownership is written in [architecture](agent-plane/architecture.html#monitor-ownership),
its backend/window composition in [system](agent-plane/system.html#monitor-backend), and its one model
subscription plus `agent.reportShown` in [api](agent-plane/api.html#monitor-model). Only the model syncs;
one SDK view mounts per window. Godview is runtime only: it records no history. *Corrected 2026-10-10 (TL):
"runtime only" is no longer the whole of what a view draws. A view that declares `history` is lent the record's
past, read by fieldd from rosettad at a window's ask and held nowhere, so the timeline draws it; Godview still
records nothing. The seam's row is in [architecture](agent-plane/architecture.html#seams), its two doors in
[api](agent-plane/api.html).* The ownership law assigns
transcript ingestion solely to rosetta; architecture names the pre-existing runtime adapter readers that
still need migration. MV adds no reader and does not claim that separate gap is closed. Find and usage
are host chrome with injected ports, outside the sandboxed views.

## The five family pages

Written as one set, in one visual family, cross-linked. Across repositories the links are GitHub
URLs, because a relative path cannot resolve between checkouts.

| Page | Path | Governs |
|---|---|---|
| **The agent plane across three repositories** | [`docs/agent-plane/architecture.html`](agent-plane/architecture.html) | The umbrella: the ownership law, the system diagram across three repositories, the seams, the walls, the data domains, the identity spine, the laws, lifetimes, performance, status, and the map of every document. |
| **Aggregation and integration in VibeField** | [`docs/agent-plane/system.html`](agent-plane/system.html) | Aggregation and integration in VibeField: fieldd's agent services and their graph, the floor's agent cell, the mirror and the fold, the live monitor backend and replicas, the audience cuts to windows/peers/phones, history and enrollment, the data domains and layout, the walls as enforced, and the sequences. |
| **The doors** | [`docs/agent-plane/api.html`](agent-plane/api.html) | The doors: the conventions (contracts, scopes, locality, errors, subscriptions, tickets, audit), the catalogue of agent.*, agents.*, index.* and the agent-relevant terminal.*, the model board and window-only facts, `agent.reportShown`, what the last run left (`agent.lastRun` / `agent.lastRunForget`, LR 2026-10-15), the mesh store, each door mapped to the upstream API it wraps, and versioning. |
| **Hosting puppeteer — the embedding seam** | puppeteer [`docs/host-integration.html`](https://github.com/vibefield/puppeteer/blob/main/docs/host-integration.html) | Hosting puppeteer: the embedding seam for any host — the AgentHost contract and its ingress half, constructing the runtime, what a host may import, the monitor contract and its versioning, the views' ports, distribution and profiles from the host's seat, continuity across host restarts, and the two reference hosts. |
| **rosettad — the daemon protocol and embedding seam** | rosetta [`docs/daemon-api.html`](https://github.com/vibefield/rosetta/blob/main/docs/daemon-api.html) | rosettad for a host: the process model and supervision, enrollment and consent, the readiness vocabulary, the wire, the TypeScript client, identity across the seam, access control today and RO-1, versioning, and the two reference hosts. |

## The complete index

### vibe-field (this repository)

Main-tracked:

- `CLAUDE.md` — the laws condensed, the workspace taxonomy, the sibling mode, the commands. **current**
- [`docs/ROADMAP.md`](ROADMAP.md) — now/next, rewritten in place at each milestone; the AR row names the next rung. **current**
- [`docs/LANDED.md`](LANDED.md) — the append-only ledger; every `## AR-` entry is this plane's build history with its revision and witness. **current**
- [`docs/DECISIONS.md`](DECISIONS.md) — the decision index; AR-D1…D14 and AR-D15…D22 carry this plane's rulings and amendments; AR7-D1…D16 the typed agent's slate. **current**
- `DESIGN.md` · [`docs/UI_SYSTEM.md`](UI_SYSTEM.md) — art direction, and where it lives in code. Any view in this plane defers to them. **current**

Design corpus (`draft/`, tracked on the local-only `dev-local` branch, never on main):

- `draft/thinking-ar-agent-plane.md` — the triad design: the ownership law, the planes, the identity spine, the durability ceilings, the cross-repo asks. §17 is the re-verification delta. **RATIFIED 2026-09-12**
- `draft/thinking-ar-data-topology.md` — consent by construction, the machine scope, personas as profiles, who writes what. **RATIFIED 2026-09-12**
- `draft/thinking-ar-sibling-workbench.md` — the three-repo workbench: the link mechanism, the pin, the walls, the build, the exit (W-D8). **current**
- `draft/thinking-ar-agent-catalog.md` — the agent CATALOG: which agents VibeField supports, decided by hand in
  `packages/contracts/src/agent-catalog.ts` and held to both pins by wall R23; the slate AC-D1…AC-D11; §13 as built.
  **RULED + BUILT 2026-09-22** (LANDED §AC)
- `draft/thinking-ar7-typed-agents.md` — a typed agent is a managed agent: the eight facts, the rule of refusal,
  the slate AR7-D1…D16 (six ruled by James), the build table and the witnesses. **RULED + BUILT 2026-09-27/28**
  (LANDED §AR-7)
- `draft/thinking-ar-views-port.md` — the views port as built. `draft/thinking-ar-approvals-prompts.md` — the design AR-6 will run. **current**
- `draft/design-00…design-04` — the governing specification in authority order. The agent plane defers to these for mechanics. **current**

### puppeteer — the agent runtime

Its own map is `docs/README.md`, which sorts documents by whether they are authoritative.

- `docs/architecture.html` — foundations, layers, repository ownership, conventions, public contracts; its package map and allowed edges is the upstream twin of our walls. **current**
- `docs/rfcs/004-layered-agent-runtime.md` — the repository-wide layer and dependency model, including the adapter boundary: provider ids are open and opaque. **current**
- `docs/rfcs/001` evidence-backed runtime observation · `002` modular agent events and services · `003` native observation sources (why the live runtime needs no semantic database). **current**
- `docs/rfcs/005` the swarm on WebGPU · `006` agent distribution and account profiles (with the observation-root addendum) · `007` history search through an external daemon · `008` live usage cost. **current**
- `docs/agent-api.html` — the Agent API and event-flow reference. **current**
- `docs/agent-monitor.html` — the monitor system diagram and interface reference; the schema our mirror mirrors. **current**
- `docs/agent-management-api.html` — provider management, account profiles, quota usage, native service contracts. **current**
- `docs/agent-aggregation-api.html` — history and search from the runtime's side: native-session joins, external-daemon ownership, protocol compatibility. **current**
- `docs/guides/` — adapting an agent · surface adaptation · the normalization devkit. **current**
- `docs/guides/spawn-through-hosts.md` — the spawn-through kit for hosts: what a host answers, the rule of refusal
  (strict refuses only a session, interactive, in the host's own terminal), the codes and the host's words, the two
  lifetimes, the tmux limit. The seam's OWNER; VibeField's gateway is its consumer. **current**
- `docs/archive/` — rationale for archaeology, not an implementation contract. `draft/` — unfinished adaptation plans and audits. **historical / in flight**

### rosetta — agent history

`docs/README.md` (added 2026-09-22 on the `docs/daemon-api` branch) is the index, in the shape of puppeteer's; `ARCHITECTURE.md` is the living entry point and the rest hang off it.

- `docs/ARCHITECTURE.md` — the three layers and the rule each obeys, ground truth, the normalizer, the service provider (one daemon, loopback HTTP/WS), storage, the performance playbook, the workspace layout, the open decisions. **current**
- `docs/canonical-model.html` — the canonical entities, including the session row carrying `native_session_id` and no liveness. **current**
- `docs/ingest-engine.html` — crate responsibilities and the required readiness vocabulary that fieldd projects into honest states. **current**
- `docs/ingest-pipeline.html` · `docs/ingest-timeline.html` — how evidence becomes rows, and how a timeline is assembled and paged. **current**
- `docs/message-schema-matrix.html` — what every adapter's message shapes normalize to. **current**
- `docs/groundtruth/` — Layer 1's finished product, one canonical evidence file and report per captured agent. **current**
- `docs/ADAPTER_AUDIT.md` · `docs/INGEST_ISSUES.md` — per-adapter coverage and open ingestion defects. **working notes**
- `docs/COLD_INGEST_IO_FLOOR.md` · `docs/INGEST_PERFORMANCE_REVIEW_2026-09-06.md` · `docs/codex-session-weight.html` · `docs/message-payload-weight.html` — dated measurement evidence behind the cost numbers, not contracts. **measurement**
- `docs/FILE_VIEWER_MINIMAP.md` — a viewer feature note from rosetta's own app. **working notes**

## How to keep these true

1. **A change to a seam updates the page that owns the seam FIRST**, then the umbrella's seam table.
   The umbrella indexes and summarises; it is never where a seam is defined.
2. **Errata at the source.** A falsified claim gets a dated correction where it was made, never only
   downstream in a ledger. The umbrella's own corrections live in the section that carried the claim.
3. **Status legend, everywhere.** Every claim wears **BUILT** (in the code at a named revision — cite
   the file), **DESIGNED** (ruled and specified, not in code — cite the doc and the decision id) or
   **OWED** (named on the roadmap, not designed in detail). Never write an intent in the present tense.
4. **The pages name their revisions.** Each carries the vibe-field, puppeteer and rosetta revisions it
   was read at. A pin move (`pnpm siblings:pin`) is an EL8 event with its own ledger entry; if it
   changes a seam, it changes the page that owns that seam.
5. **A new agent is a row, never a branch.** Support is decided in `packages/contracts/src/agent-catalog.ts`
   (AC-D1…D11): a pin move that composes or registers an agent with no row turns `pnpm siblings:pin` red
   until a maintainer writes one (`declined` counts). No product code compares an agent id to a literal
   (R23b); the readers are the way in.
6. **Definitions stay in their owning document.** `docs/DECISIONS.md` flips statuses; it does not
   redefine. The same rule holds between these pages and the design corpus in `draft/`.
