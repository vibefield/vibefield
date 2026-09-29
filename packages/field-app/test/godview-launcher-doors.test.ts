// @vitest-environment node
/**
 * THE EMPTY PANE LAUNCHER'S PORT (QL-1), as an adapter.
 *
 * The launcher is the views package's and is tested there. What is VibeField's
 * is the translation between it and fieldd's doors — `launcherPortOver`,
 * `launcherAgents` and the refusal sentences in `src/godview/launcher-doors.ts`
 * — and that is all this file holds. The door's answers are the CONTRACT's own
 * fixtures (`index-recent.valid.json`, `agent-providers.valid.json`,
 * `agent-spawn.valid.json`), so a shape that moves there fails here.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentProviderSummary,
  AgentProvidersResult,
  IndexRecentResult,
} from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  historyStatusFromRefusal,
  type LauncherPortDeps,
  launcherAgents,
  launcherPortOver,
  launcherSession,
  launchPreview,
  refusalReason,
  UNTITLED_SESSION,
} from "../src/godview/launcher-doors";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

const RECENT = fixture("index-recent.valid.json");
const SPAWNED = fixture("agent-spawn.valid.json");
const PROVIDERS = AgentProvidersResult.parse(fixture("agent-providers.valid.json")).providers;

/** The fixture's providers plus the one its rows name that the fixture lacks. */
const WITH_CODEX: readonly AgentProviderSummary[] = [
  ...PROVIDERS,
  {
    id: "codex",
    label: "Codex",
    available: true,
    resumable: true,
    personas: [],
    status: "supported",
    offers: { spawn: true, resume: true, personas: true },
  },
];

/** An RpcCallError as the renderer sees it: a rejected object with kind and details. */
function refusal(kind: string, message: string, details: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { kind, details });
}

function deps(
  answers: Record<string, unknown | ((params: Record<string, unknown>) => unknown)>,
  providers: readonly AgentProviderSummary[] = WITH_CODEX,
): { deps: LauncherPortDeps; request: ReturnType<typeof vi.fn>; place: ReturnType<typeof vi.fn> } {
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (!(method in answers)) throw new Error(`unexpected door ${method}`);
    const answer = answers[method];
    return typeof answer === "function" ? await answer(params) : answer;
  });
  const place = vi.fn(async () => ({ accepted: true as const }));
  return { deps: { client: { request }, providers: () => providers, place }, request, place };
}

const READY_STATUS = fixture("index-status.valid.json") as { search: Record<string, unknown> };

describe("index.recent → the launcher's sessions", () => {
  const rows = IndexRecentResult.parse(RECENT).rows;

  it("maps a row: its key, agent, title, folder, here and last activity", () => {
    const [first] = rows;
    if (first === undefined) throw new Error("fixture has rows");
    expect(launcherSession(first, WITH_CODEX)).toEqual({
      key: "s_7c1e2f9a",
      providerId: "claude",
      nativeSessionId: "3b9d4c2e-6f18-4a7b-9c3d-2e1f0a8b7c6d",
      title: "Port the swarm to WebGPU",
      cwd: "/Users/kim/Projects/vibe-field",
      here: true,
      lastAt: 1789232460000,
      resumable: true,
    });
  });

  it("titles a row by its title, then its summary, then the design's words", () => {
    const [first] = rows;
    if (first === undefined) throw new Error("fixture has rows");
    const { title: _title, ...untitled } = first;
    expect(launcherSession(untitled, WITH_CODEX).title).toBe(
      "Moved the swarm's physics behind a driver port.",
    );
    const { summary: _summary, ...bare } = untitled;
    expect(launcherSession({ ...bare, title: "   " }, WITH_CODEX).title).toBe(UNTITLED_SESSION);
  });

  it("dates a row by its conversation's last activity, else by its update stamp", () => {
    const [first] = rows;
    if (first === undefined) throw new Error("fixture has rows");
    expect(launcherSession({ ...first, activity: null, updatedAt: 42 }, WITH_CODEX).lastAt).toBe(
      42,
    );
    const { updatedAt: _updated, ...stampless } = first;
    expect(launcherSession({ ...stampless, activity: null }, WITH_CODEX).lastAt).toBeUndefined();
  });

  it("withholds ↵ with a reason: no agent, an agent not offered here, one that can't resume, one not installed", () => {
    const [first, , orphan] = rows;
    if (first === undefined || orphan === undefined) throw new Error("fixture has rows");
    expect(launcherSession(orphan, WITH_CODEX)).toMatchObject({
      resumable: false,
      unresumable: "can’t resume",
    });
    expect(launcherSession(first, [])).toMatchObject({
      resumable: false,
      unresumable: "not offered here",
    });
    const claude = WITH_CODEX.filter((row) => row.id === "claude");
    expect(
      launcherSession(
        first,
        claude.map((row) => ({ ...row, resumable: false })),
      ),
    ).toMatchObject({ resumable: false, unresumable: "can’t resume" });
    expect(
      launcherSession(
        first,
        claude.map((row) => ({ ...row, available: false })),
      ),
    ).toMatchObject({ resumable: false, unresumable: "not installed" });
    expect(
      launcherSession(
        first,
        claude.map((row) => ({ ...row, status: "declined" })),
      ),
    ).toMatchObject({ resumable: false, unresumable: "not offered here" });
  });
});

describe("the port's list and its status", () => {
  it("asks index.recent with the pane's folder and scope, and reads the index's readiness beside it", async () => {
    const { deps: port, request } = deps({
      "index.recent": RECENT,
      "index.status": {
        ...READY_STATUS,
        search: {
          ...READY_STATUS.search,
          readiness: "catching-up",
          progress: { done: 1204, total: 3880 },
        },
      },
    });
    const answer = await launcherPortOver(port).recent({ cwd: "/repo", scope: "here", limit: 100 });
    expect(request).toHaveBeenCalledWith("index.recent", {
      cwd: "/repo",
      scope: "here",
      limit: 100,
    });
    expect(answer.sessions.map((session) => session.key)).toEqual([
      "s_7c1e2f9a",
      "s_1f9e8d7c",
      "s_0a4b5c6d",
    ]);
    expect(answer.status).toEqual({
      readiness: "catching-up",
      progress: { done: 1204, total: 3880 },
    });
  });

  it("answers ready when the list answered and the status could not be read", async () => {
    const { deps: port } = deps({
      "index.recent": RECENT,
      "index.status": () => {
        throw new Error("no status");
      },
    });
    expect((await launcherPortOver(port).recent({ scope: "all" })).status).toEqual({
      readiness: "ready",
    });
  });

  it("says a refused list in the launcher's readiness words, with the door's sentence", async () => {
    const cases: [unknown, string][] = [
      [
        refusal("UNAVAILABLE", "the agent index is starting", {
          service: "index",
          state: "starting",
        }),
        "building",
      ],
      [refusal("UNAVAILABLE", "restarting", { service: "index", state: "restarting" }), "building"],
      [
        refusal("UNAVAILABLE", "the agent index is failed", { service: "index", state: "failed" }),
        "failed",
      ],
      [refusal("UNAVAILABLE", "malformed", { service: "index", state: "malformed" }), "failed"],
      [
        refusal("UNAVAILABLE", "the agent index is stopped", {
          service: "index",
          state: "stopped",
        }),
        "unreachable",
      ],
      [
        refusal("UNAVAILABLE", "unconfigured", { service: "index", state: "unconfigured" }),
        "unreachable",
      ],
      [new Error("socket closed"), "unreachable"],
    ];
    for (const [cause, readiness] of cases) {
      expect(historyStatusFromRefusal(cause).readiness, String(cause)).toBe(readiness);
      const { deps: port } = deps({
        "index.recent": () => {
          throw cause;
        },
        "index.status": READY_STATUS,
      });
      const answer = await launcherPortOver(port).recent({ scope: "here" });
      expect(answer).toEqual({
        status: { readiness, detail: (cause as Error).message },
        sessions: [],
      });
    }
  });

  it("says an unreadable list as a failed index, never as no sessions", async () => {
    const { deps: port } = deps({ "index.recent": { rows: "nope" }, "index.status": READY_STATUS });
    expect((await launcherPortOver(port).recent({ scope: "here" })).status.readiness).toBe(
      "failed",
    );
  });
});

describe("the words lane", () => {
  it("asks index.search over the sessions the last list named, joining a hit to its root", async () => {
    const { deps: port, request } = deps({
      "index.recent": RECENT,
      "index.status": READY_STATUS,
      "index.search": {
        answered: true,
        clipped: false,
        state: { readiness: "ready" },
        hits: [
          {
            sessionId: "s_7c1e2f9a",
            rootSessionId: "s_7c1e2f9a",
            nativeSessionId: "3b9d4c2e-6f18-4a7b-9c3d-2e1f0a8b7c6d",
            timelineId: "t1",
            kind: "user",
            snippet: "the [swarm] physics",
          },
          {
            sessionId: "s_child",
            rootSessionId: "s_1f9e8d7c",
            nativeSessionId: "child-native",
            timelineId: "t2",
            kind: "agent",
            snippet: "a [gate]",
          },
        ],
      },
    });
    const launcher = launcherPortOver(port);
    await launcher.recent({ cwd: "/repo", scope: "here" });
    const words = launcher.words;
    if (words === undefined) throw new Error("the port has a words lane");
    const answer = await words({ query: "swarm", scope: "here", limit: 100 });
    expect(request).toHaveBeenLastCalledWith("index.search", {
      q: "swarm",
      nativeSessionIds: [
        "3b9d4c2e-6f18-4a7b-9c3d-2e1f0a8b7c6d",
        "019247aa-5c3e-7d21-b8f0-3a6e2c1d9b47",
        "8e2f1a0b-9c7d-4e6f-8a1b-0c9d8e7f6a5b",
      ],
      limit: 100,
      prefix: true,
    });
    expect(answer).toEqual({
      answered: true,
      hits: [
        {
          sessionKey: "s_7c1e2f9a",
          nativeSessionId: "3b9d4c2e-6f18-4a7b-9c3d-2e1f0a8b7c6d",
          kind: "user",
          snippet: "the [swarm] physics",
        },
        // a delegated child's hit: joined to the root, never by the child's id
        { sessionKey: "s_1f9e8d7c", kind: "agent", snippet: "a [gate]" },
      ],
    });
  });

  it("is unanswered, never no matches, when the search is refused", async () => {
    const { deps: port } = deps({
      "index.search": () => {
        throw new Error("down");
      },
    });
    const words = launcherPortOver(port).words;
    expect(await words?.({ query: "x", scope: "all" })).toEqual({ answered: false, hits: [] });
  });
});

describe("the verbs", () => {
  it("launches with agent.spawn in the pane's folder under NO profile, and hands the ticket to the pane it replaces", async () => {
    const { deps: port, request, place } = deps({ "agent.spawn": SPAWNED });
    const outcome = await launcherPortOver(port).launch({
      paneId: "pane-1",
      sessionId: "shell-1",
      providerId: "claude",
      cwd: "/repo",
    });
    expect(request).toHaveBeenCalledWith("agent.spawn", { provider: "claude", cwd: "/repo" });
    expect(place).toHaveBeenCalledWith((SPAWNED as { terminal: unknown }).terminal, "shell-1");
    expect(outcome).toEqual({ accepted: true });
  });

  it("resumes with the native form and the ROW's persona — never another", async () => {
    const {
      deps: port,
      request,
      place,
    } = deps({
      "index.recent": RECENT,
      "index.status": READY_STATUS,
      "agent.resume": SPAWNED,
    });
    const launcher = launcherPortOver(port);
    const { sessions } = await launcher.recent({ cwd: "/pane", scope: "here" });
    const [claude, codex] = sessions;
    if (claude === undefined || codex === undefined) throw new Error("fixture has rows");

    await launcher.resume({ paneId: "p", sessionId: "shell-1", session: codex, cwd: "/pane" });
    expect(request).toHaveBeenLastCalledWith("agent.resume", {
      provider: "codex",
      nativeSessionId: "019247aa-5c3e-7d21-b8f0-3a6e2c1d9b47",
      // the conversation's own folder, not the pane's
      cwd: "/Users/kim/Projects/vibe-field-lanes/ql",
      profileId: "codex:work-1c7e",
      title: "Launcher gate",
    });

    await launcher.resume({ paneId: "p", sessionId: "shell-2", session: claude, cwd: "/pane" });
    const last = request.mock.lastCall?.[1] as Record<string, unknown>;
    expect(last).not.toHaveProperty("profileId");
    expect(last).not.toHaveProperty("profileSet");
    expect(place).toHaveBeenLastCalledWith((SPAWNED as { terminal: unknown }).terminal, "shell-2");
  });

  it("refuses a row it never listed rather than guessing its agent", async () => {
    const { deps: port, request } = deps({});
    const outcome = await launcherPortOver(port).resume({
      paneId: "p",
      sessionId: "s",
      session: { key: "unknown", title: "t", here: true, resumable: true },
    });
    expect(outcome).toEqual({ accepted: false, reason: "no agent here can resume it" });
    expect(request).not.toHaveBeenCalled();
  });

  it("says fieldd's refusals as plain sentences, leaving the shell where it is", async () => {
    const cases: [Error, string][] = [
      [
        refusal("PRECONDITION_FAILED", "x", { reason: "unsupported-agent", capability: "resume" }),
        "this agent can’t resume sessions here",
      ],
      [
        refusal("PRECONDITION_FAILED", "x", { reason: "unsupported-agent", capability: "spawn" }),
        "this agent can’t start sessions here",
      ],
      [
        refusal("PRECONDITION_FAILED", "x", { runtimeRunId: "run-9", state: "terminal-alive" }),
        "it is already running",
      ],
      [
        refusal("PRECONDITION_FAILED", "x", { nativeSessionId: "n", state: "resuming" }),
        "it is already being resumed",
      ],
      [refusal("PRECONDITION_FAILED", "x", { state: "signed-out" }), "its profile is signed out"],
      [
        refusal("NOT_FOUND", "no profile p", { provider: "a", code: "AGENT_PROFILE_NOT_FOUND" }),
        "its profile no longer exists",
      ],
      [
        refusal("NOT_FOUND", "x", { nativeSessionId: "n", reason: "unknown-conversation" }),
        "the history no longer knows it",
      ],
      [
        refusal("NOT_FOUND", "x", { nativeSessionId: "n", reason: "other-agent" }),
        "the history files it under another agent",
      ],
      [
        refusal("NOT_FOUND", "no agent a in the catalog", { reason: "unsupported-agent" }),
        "this agent is not offered here",
      ],
      // a NOT_FOUND the launcher has no sentence for is fieldd's own words,
      // never a guess that a profile went missing
      [
        refusal("NOT_FOUND", "no managed session run-9", { runtimeRunId: "run-9" }),
        "no managed session run-9",
      ],
      [refusal("NOT_FOUND", "the agent vanished"), "the agent vanished"],
      [
        refusal("PRECONDITION_FAILED", "x", { reason: "missing-cwd", cwd: "/gone" }),
        "its folder is gone",
      ],
      [
        refusal("PRECONDITION_FAILED", "x", { reason: "malformed-native-id" }),
        "its id is not one an agent can resume",
      ],
      [
        refusal("RESOURCE_EXHAUSTED", "the floor holds its cap of sessions"),
        "the floor holds its cap of sessions",
      ],
    ];
    for (const [cause, sentence] of cases) {
      expect(refusalReason(cause)).toBe(sentence);
      const { deps: port, place } = deps({
        "agent.spawn": () => {
          throw cause;
        },
      });
      expect(
        await launcherPortOver(port).launch({ paneId: "p", sessionId: "s", providerId: "claude" }),
      ).toEqual({ accepted: false, reason: sentence });
      expect(place).not.toHaveBeenCalled();
    }
  });
});

describe("the agents", () => {
  it("lists the rows that start sessions, in the door's order, with their last launch and a reason for the uninstalled", () => {
    const agents = launcherAgents([
      ...PROVIDERS,
      { ...PROVIDERS[0], id: "old", label: "Old", status: "deprecated" } as AgentProviderSummary,
      {
        ...PROVIDERS[0],
        id: "nospawn",
        label: "No spawn",
        offers: { spawn: false },
      } as AgentProviderSummary,
      { ...PROVIDERS[0], id: "odd", label: "Odd", status: "someday" } as AgentProviderSummary,
      { id: "bare", label: "Bare", available: true, resumable: false, personas: [] },
    ]);
    expect(agents).toEqual([
      {
        providerId: "claude",
        label: "Claude Code",
        lastLaunchedAt: 1789232460000,
        preview: "Claude Code · its defaults",
      },
      { providerId: "pi", label: "Pi", unavailable: "not installed", preview: "Pi · its defaults" },
      // a row from a daemon before AC-3 decides nothing, and launches as before
      { providerId: "bare", label: "Bare", preview: "Bare · its defaults" },
    ]);
  });

  it("previews the default Agent Profile where a launch with no profile runs under it", () => {
    const [claude] = PROVIDERS;
    if (claude === undefined) throw new Error("fixture has rows");
    const work = { id: "work", label: "Work", default: true };
    const native = { id: "native", label: "This Mac", default: true };
    // the default profile holds no sign-in for the agent: the agent's own folder
    expect(launchPreview(claude, [work])).toBe("Claude Code · its defaults");
    const signedIn = {
      ...claude,
      personas: claude.personas.map((persona) => ({ ...persona, set: "work" })),
    };
    expect(launchPreview(signedIn, [work])).toBe("Claude Code · Work");
    expect(launchPreview(signedIn, [{ ...work, default: false }])).toBe(
      "Claude Code · its defaults",
    );
    expect(launchPreview(claude, [native])).toBe("Claude Code · This Mac");
    // a row that claims no personas runs as itself whatever the default is
    expect(launchPreview({ ...signedIn, offers: { personas: false } }, [work])).toBe(
      "Claude Code · its defaults",
    );
  });
});
