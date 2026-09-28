import { describe, expect, it } from "vitest";
import {
  AgentKind,
  AgentsProfilesVerifyResult,
  AgentsReleasesParams,
  AgentsReleasesResult,
  AgentsSetActiveResult,
  INDEX_PHASES,
  IndexEnrollmentRecord,
  IndexPhase,
  IndexSessionRow,
  IndexSessionsResponse,
  IndexStatus,
} from "../src/agent-index";
import { METHODS } from "../src/methods";
import { PLUGIN_CAPABILITY_ELIGIBILITY } from "../src/plugins";
import { LAYOUT, LAYOUT_ROOT_LEVEL, SCOPES, TAILNET_SCOPES } from "../src/registries";

// AR-1 — the agent-index and agent-runtime doors (thinking-ar-data-topology.md
// §7, AR-D15…D22). The registry rows are pinned the way plugins.update's are:
// widening is a deliberate edit against this file, never drift.

describe("index.* and agents.* registry rows (AR-1)", () => {
  const rows = (prefix: string) =>
    METHODS.filter((m) => m.method.startsWith(prefix)).map((m) => ({
      method: m.method,
      scope: m.scope,
      idempotent: m.idempotent,
      locality: m.locality,
    }));

  it("index.*: census reads on index.read, content reads on index.search, mutations on the local-only index.manage", () => {
    expect(rows("index.")).toEqual([
      { method: "index.discoveries", scope: "index.read", idempotent: true, locality: "local" },
      { method: "index.status", scope: "index.read", idempotent: true, locality: "local" },
      // AR-5e — the find sheet's doors, reads like the two above
      // AR-5b: the sheet's CONTENT reads ride their own scope — a plugin holding
      // index.read for the roll call must not gain transcript search on an upgrade
      { method: "index.sessions", scope: "index.search", idempotent: true, locality: "local" },
      { method: "index.search", scope: "index.search", idempotent: true, locality: "local" },
      { method: "index.enroll", scope: "index.manage", idempotent: true, locality: "local" },
      { method: "index.retire", scope: "index.manage", idempotent: true, locality: "local" },
    ]);
  });

  it("agents.*: distribution on the local-only agents.manage, personas on agent.spawn", () => {
    expect(rows("agents.")).toEqual([
      { method: "agents.installs", scope: "agents.manage", idempotent: true, locality: "local" },
      { method: "agents.releases", scope: "agents.manage", idempotent: true, locality: "local" },
      { method: "agents.update", scope: "agents.manage", idempotent: false, locality: "local" },
      { method: "agents.setActive", scope: "agents.manage", idempotent: true, locality: "local" },
      // The Agents settings section — reads on the same local-only scope: an
      // update's own output while it runs, and Show in Finder for an install
      {
        method: "agents.operations.subscribe",
        scope: "agents.manage",
        idempotent: true,
        locality: "local",
      },
      { method: "agents.reveal", scope: "agents.manage", idempotent: true, locality: "local" },
      { method: "agents.update.stop", scope: "agents.manage", idempotent: true, locality: "local" },
      { method: "agents.profiles.list", scope: "agent.spawn", idempotent: true, locality: "local" },
      {
        method: "agents.profiles.create",
        scope: "agent.spawn",
        idempotent: false,
        locality: "local",
      },
      {
        method: "agents.profiles.delete",
        scope: "agent.spawn",
        idempotent: true,
        locality: "local",
      },
      {
        method: "agents.profiles.verify",
        scope: "agent.spawn",
        idempotent: false,
        locality: "local",
      },
      // AR-3 — the persona login pane
      {
        method: "agents.profiles.login",
        scope: "agent.spawn",
        idempotent: false,
        locality: "local",
      },
      // AR-S2 — Agent Profiles (puppeteer's profile sets), on the persona
      // rows' own scope: a profile is what one spawns in
      {
        method: "agents.profileSets.list",
        scope: "agent.spawn",
        idempotent: true,
        locality: "local",
      },
      {
        method: "agents.profileSets.subscribe",
        scope: "agent.spawn",
        idempotent: true,
        locality: "local",
      },
      {
        method: "agents.profileSets.create",
        scope: "agent.spawn",
        idempotent: false,
        locality: "local",
      },
      {
        method: "agents.profileSets.update",
        scope: "agent.spawn",
        idempotent: true,
        locality: "local",
      },
      {
        method: "agents.profileSets.delete",
        scope: "agent.spawn",
        idempotent: true,
        locality: "local",
      },
      {
        method: "agents.profileSets.reveal",
        scope: "agent.spawn",
        idempotent: true,
        locality: "local",
      },
      // AR-S4b — Extensions: a read of the agents' own configuration on this
      // machine (servers, folders; reading Codex starts its app-server), so the
      // distribution reads' native.admin posture
      {
        method: "agents.extensions.list",
        scope: "agents.manage",
        idempotent: true,
        locality: "local",
      },
      {
        method: "agents.extensions.subscribe",
        scope: "agents.manage",
        idempotent: true,
        locality: "local",
      },
      // AR-S4c — an act through the agent's own command: a mutation, audited
      {
        method: "agents.extensions.act",
        scope: "agents.manage",
        idempotent: false,
        locality: "local",
      },
      // AR-S4c — a server's sign-in opens a pane, as a persona's login does
      {
        method: "agents.extensions.signIn",
        scope: "agent.spawn",
        idempotent: false,
        locality: "local",
      },
      // AR-S4d — a server kept once: the add keeps a value in the keychain and
      // runs agents' commands (a mutation, audited); its plan only reads
      {
        method: "agents.extensions.add",
        scope: "agents.manage",
        idempotent: false,
        locality: "local",
      },
      {
        method: "agents.extensions.plan",
        scope: "agents.manage",
        idempotent: true,
        locality: "local",
      },
      // AR-S4d2 — a skill kept once: Add skill copies a folder and places links
      // (a mutation, audited); its plan only reads the folder
      {
        method: "agents.extensions.addSkill",
        scope: "agents.manage",
        idempotent: false,
        locality: "local",
      },
      {
        method: "agents.extensions.planSkill",
        scope: "agents.manage",
        idempotent: true,
        locality: "local",
      },
      // AR-S4e2 — browse and install: the catalog and a source's plan only read;
      // Check for updates runs the agents' own fetches (a mutation, audited); an
      // act a person answers in a pane takes agent.spawn, as a sign-in does
      {
        method: "agents.extensions.catalog",
        scope: "agents.manage",
        idempotent: true,
        locality: "local",
      },
      {
        method: "agents.extensions.check",
        scope: "agents.manage",
        idempotent: false,
        locality: "local",
      },
      {
        method: "agents.extensions.planSource",
        scope: "agents.manage",
        idempotent: true,
        locality: "local",
      },
      {
        method: "agents.extensions.terminal",
        scope: "agent.spawn",
        idempotent: false,
        locality: "local",
      },
      // AR-5d — account usage: a READ of the agent plane, so it rides
      // AR-5b: the account's billing state, a credentialed call per reading —
      // its own scope, not the fold's
      { method: "agents.usage", scope: "agent.usage", idempotent: true, locality: "local" },
      {
        method: "agents.usage.subscribe",
        scope: "agent.usage",
        idempotent: true,
        locality: "local",
      },
    ]);
  });

  it("none of the rows federates or admits a guest; only the feeds subscribe", () => {
    for (const m of METHODS.filter(
      (m) => m.method.startsWith("index.") || m.method.startsWith("agents."),
    )) {
      expect(m.locality, m.method).toBe("local");
      expect(m.guestOk ?? false, m.method).toBe(false);
      // AR-5d widened this family by exactly one subscription (the usage
      // column's feed), the Agents settings section by one more (an update's
      // output while it runs), Agent Profiles by a third (the profiles and
      // their sign-ins), Extensions by a fourth (a profile's lens, again when
      // a read finishes); every other row stays a one-shot call.
      expect(m.subscription ?? false, m.method).toBe(
        m.method === "agents.usage.subscribe" ||
          m.method === "agents.operations.subscribe" ||
          m.method === "agents.profileSets.subscribe" ||
          m.method === "agents.extensions.subscribe",
      );
    }
  });

  it("the two new scopes exist, never enter the tailnet preset, and are never plugin-eligible", () => {
    for (const scope of ["index.manage", "agents.manage"] as const) {
      expect(SCOPES).toContain(scope);
      expect(TAILNET_SCOPES).not.toContain(scope);
      expect(PLUGIN_CAPABILITY_ELIGIBILITY[scope]).toBeUndefined();
    }
  });
});

describe("LAYOUT — the topology's segments (AR-D15…D18)", () => {
  it("the user-scope additions hang off their owners", () => {
    expect(LAYOUT.INDEX_ENROLLMENT_FILE.slice(0, -1)).toEqual([...LAYOUT.INDEX_DIR]);
    expect(LAYOUT.INDEX_ENROLLMENT_FILE.at(-1)).toBe("enrollment.json");
    expect(LAYOUT.AGENT_PROFILES_FILE.slice(0, -1)).toEqual([...LAYOUT.AGENTS_DIR]);
    expect(LAYOUT.AGENT_ROOTS_DIR.slice(0, -1)).toEqual([...LAYOUT.AGENTS_DIR]);
    // AR-S2 — each Agent Profile's folder, beside the registry that names it
    expect(LAYOUT.AGENT_PROFILE_SETS_DIR.slice(0, -1)).toEqual([...LAYOUT.AGENTS_DIR]);
    expect(LAYOUT.AGENT_PROFILE_SETS_DIR.at(-1)).toBe("profiles");
  });

  it("the machine scope is exactly distribution, and it never re-roots", () => {
    expect(LAYOUT.MACHINE_AGENTS_DIR.slice(0, -1)).toEqual([...LAYOUT.MACHINE_DIR]);
    expect(LAYOUT.MACHINE_DISTRIBUTION_FILE.slice(0, -1)).toEqual([...LAYOUT.MACHINE_AGENTS_DIR]);
    expect(LAYOUT.MACHINE_UPDATES_DIR.slice(0, -1)).toEqual([...LAYOUT.MACHINE_AGENTS_DIR]);
    const machine = Object.entries(LAYOUT)
      .filter(([, segs]) => segs[0] === LAYOUT.MACHINE_DIR[0])
      .map(([name]) => name);
    expect(machine.sort()).toEqual(
      [
        "MACHINE_DIR",
        "MACHINE_AGENTS_DIR",
        "MACHINE_DISTRIBUTION_FILE",
        "MACHINE_UPDATES_DIR",
      ].sort(),
    );
    for (const name of machine) expect([...LAYOUT_ROOT_LEVEL] as string[]).toContain(name);
  });

  it("LAYOUT_ROOT_LEVEL is the whole never-re-root set: UA-1's four plus the machine set, and nothing under a user shares a first segment with it", () => {
    expect([...LAYOUT_ROOT_LEVEL].sort()).toEqual(
      [
        "USERS_DIR",
        "USERS_FILE",
        "USERS_LOCK",
        "LAYOUT_STAMP",
        "MACHINE_DIR",
        "MACHINE_AGENTS_DIR",
        "MACHINE_DISTRIBUTION_FILE",
        "MACHINE_UPDATES_DIR",
      ].sort(),
    );
    const rootFirsts = new Set<string>(LAYOUT_ROOT_LEVEL.map((name) => LAYOUT[name][0] as string));
    for (const [name, segs] of Object.entries(LAYOUT)) {
      if (([...LAYOUT_ROOT_LEVEL] as string[]).includes(name)) continue;
      expect(rootFirsts.has(segs[0] as string), `${name} re-roots but shares ${segs[0]}`).toBe(
        false,
      );
    }
  });
});

describe("the enrollment record — rosettad's --enroll input and VibeField's truth (AR-D17)", () => {
  // The exact JSON rosetta's own real-binary bench writes for the daemon
  // (crates/rosettad/tests/enrolled_serve.rs `write_enrollment`): what the
  // daemon reads, this package must parse.
  const rosettaBench = {
    format: 1,
    enabled_kinds: ["claude-code"],
    runtimes: [
      {
        kind: "claude-code",
        data_root: "/tmp/bench/users/u1/agents/roots/claude-code/9a3d",
        label: "Kim",
      },
    ],
  };

  it("parses rosetta's bench file verbatim and keeps VibeField's keys beside it", () => {
    expect(IndexEnrollmentRecord.parse(rosettaBench)).toEqual(rosettaBench);
    const ours = {
      ...rosettaBench,
      runtimes: [{ ...rosettaBench.runtimes[0], profile_id: "claude:9a3d" }],
      retired: [],
      updated_at: "2026-09-12T17:05:00.000Z",
    };
    expect(IndexEnrollmentRecord.parse(ours)).toEqual(ours);
  });

  it("refuses what the daemon refuses before binding: the wrong format, a `~` or relative root, a bad kind", () => {
    expect(IndexEnrollmentRecord.safeParse({ ...rosettaBench, format: 2 }).success).toBe(false);
    for (const data_root of ["~/.claude", "users/1/agents/roots/claude-code/9a3d", "", "~"]) {
      expect(
        IndexEnrollmentRecord.safeParse({
          ...rosettaBench,
          runtimes: [{ kind: "claude-code", data_root }],
        }).success,
        data_root,
      ).toBe(false);
    }
    expect(
      IndexEnrollmentRecord.safeParse({ ...rosettaBench, enabled_kinds: ["Claude"] }).success,
    ).toBe(false);
    expect(AgentKind.safeParse("kimi-code").success).toBe(true);
    expect(AgentKind.safeParse("claude_code").success).toBe(false);
  });

  it("a Windows drive root is absolute too", () => {
    expect(
      IndexEnrollmentRecord.safeParse({
        ...rosettaBench,
        runtimes: [
          { kind: "codex", data_root: "C:\\VibeField\\users\\1\\agents\\roots\\codex\\1" },
        ],
      }).success,
    ).toBe(true);
  });
});

describe("IndexPhase — the tolerant fold", () => {
  it("names the supervisor's phases and rosetta's IngestPhase, and reads an unheard-of phase as unknown", () => {
    expect(INDEX_PHASES).toContain("awaiting_consent");
    expect(INDEX_PHASES).toContain("failed");
    expect(IndexPhase.parse("hyperspace")).toBe("unknown");
    const status = IndexStatus.parse({
      phase: "hyperspace",
      rosettad: { phase: "ready", detail: null, pid: 1, protocolVersion: 20 },
      enrollment: { enabledKinds: [], runtimes: [], retired: [], updatedAt: null },
      runtimes: [],
    });
    expect(status.phase).toBe("unknown");
  });
});

describe("the session rows fieldd READS from rosetta (AR-4)", () => {
  // Hand-written, deliberately fixture-free: the witness for this shape is
  // rosetta's documented wire, and the row below is a FULL one — every column
  // `SessionRow` carries, so the test also pins that a reading narrower than
  // the wire stays a reading and never becomes a refusal. (fieldd's own suite
  // parses the sibling's GENERATED type, where that package is on the graph.)
  const row = {
    id: "s1",
    native_session_id: "nat-1",
    runtime_id: "rt-1",
    project_id: null,
    cwd: null,
    parent_session_id: null,
    delegation: null,
    root_session_id: "s1",
    role: "main",
    title: null,
    summary: null,
    started_at: 1_700_000_000_000,
    updated_at: 1_700_000_100_000,
    activity: { first_at: 1_700_000_000_000, last_at: 1_700_000_100_000 },
    stream_state: "indexed",
  };

  it("parses a full rosetta row, keeps every column fieldd does not read, and carries an unheard-of stream_state", () => {
    const parsed = IndexSessionsResponse.parse({ sessions: [row], cursor: "next-page" });
    expect(parsed).toMatchObject({ cursor: "next-page" });
    expect(parsed.sessions[0]).toMatchObject({ id: "s1", runtime_id: "rt-1", role: "main" });
    expect(parsed.sessions[0]?.activity).toEqual({
      first_at: 1_700_000_000_000,
      last_at: 1_700_000_100_000,
    });
    expect(IndexSessionRow.parse({ ...row, stream_state: "hyperspace" }).stream_state).toBe(
      "hyperspace",
    );
  });

  it("refuses a stamp that is not finite: an infinite last_at would answer every idle question the same way forever", () => {
    const infinite = JSON.parse('{"first_at":1,"last_at":1e999}') as Record<string, number>;
    expect(Number.isFinite(infinite["last_at"])).toBe(false);
    expect(IndexSessionRow.safeParse({ ...row, activity: infinite }).success).toBe(false);
    expect(
      IndexSessionRow.safeParse({ ...row, activity: { first_at: 1, last_at: Number.NaN } }).success,
    ).toBe(false);
  });

  it("no evidence is a null activity, whether the field is null or absent — never a refusal", () => {
    expect(IndexSessionRow.parse({ ...row, activity: null }).activity).toBeNull();
    const { activity, ...withoutActivity } = row;
    expect(activity.last_at).toBe(1_700_000_100_000);
    expect(IndexSessionRow.parse(withoutActivity).activity).toBeNull();
  });

  it("bounds that contradict each other still parse: folding nonsense to 'no evidence' is the READER's job", () => {
    expect(
      IndexSessionRow.parse({ ...row, activity: { first_at: 2, last_at: 1 } }).activity,
    ).toEqual({ first_at: 2, last_at: 1 });
  });

  it("refuses a row missing a column fieldd joins on, and an envelope that is not one", () => {
    const { root_session_id, ...missingRoot } = row;
    expect(root_session_id).toBe("s1");
    expect(IndexSessionRow.safeParse(missingRoot).success).toBe(false);
    expect(IndexSessionRow.safeParse({ ...row, id: "" }).success).toBe(false);
    expect(IndexSessionsResponse.safeParse({}).success).toBe(false);
    expect(IndexSessionsResponse.safeParse({ sessions: {} }).success).toBe(false);
  });
});

describe("the agents.* door shapes (AR-2)", () => {
  it("verify answers the persona with the adapter's honest failure beside it, or with the identity persisted", () => {
    const persona = {
      profileId: "9a3d1c2e-6b8f-4c1d-9e0a-2f3b4c5d6e7f",
      provider: "pi",
      label: "Research",
      kind: "managed",
      createdAt: "2026-09-12T17:58:00.000Z",
    };
    expect(
      AgentsProfilesVerifyResult.safeParse({
        persona,
        failure: { status: "unsupported", message: "no identity document", retryable: false },
      }).success,
    ).toBe(true);
    expect(AgentsProfilesVerifyResult.safeParse({ persona }).success).toBe(true);
    expect(
      AgentsProfilesVerifyResult.safeParse({
        persona,
        failure: { status: "gone", message: "?", retryable: false },
      }).success,
    ).toBe(false);
  });

  it("releases is a union of facts and honest failures; setActive answers the rewritten choice", () => {
    expect(
      AgentsReleasesResult.parse({
        releases: [
          {
            provider: "claude",
            channel: "stable",
            version: "2.2.0",
            fetchedAt: "2026-09-12T18:00:00.000Z",
            source: { kind: "text", id: "vendor-stable" },
          },
          { provider: "claude", status: "unavailable", message: "offline", retryable: true },
        ],
      }).releases,
    ).toHaveLength(2);
    expect(AgentsSetActiveResult.parse({ changed: true, installs: [] })).toEqual({
      changed: true,
      installs: [],
    });
    expect(AgentsReleasesParams.parse({}).network).toBeUndefined();
    expect(AgentsReleasesParams.safeParse({ provider: "Claude Code" }).success).toBe(false);
  });
});
