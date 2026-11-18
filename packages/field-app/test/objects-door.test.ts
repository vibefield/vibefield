// @vitest-environment node
/**
 * OB-1b's seams, connected: the window's doors over fieldd's `objects.hand`, `objects.ref` and `objects.resolve`, and which
 * agents' runs the door can name, read once from `agent.providers` into a synchronous cache.
 */
import { FielddRpcError } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { doorCanNameRun, resetRunNameCacheForTest } from "../src/frame/cards/card-landing";
import {
  HAND_OVER_WORDS,
  handOver,
  installObjectsDoor,
  REF_WAIT_MS,
  refFor,
  resetHandOverForTest,
  resolveRef,
  takeBack,
} from "../src/frame/cards/hand-over";

const REF = "vf:obj/7hk2qx4m";

function clientOf(answers: Record<string, unknown | (() => unknown)>) {
  const asked: Array<[string, unknown]> = [];
  return {
    asked,
    request: vi.fn(async (method: string, params: unknown) => {
      asked.push([method, params]);
      const answer = answers[method];
      return typeof answer === "function" ? (answer as () => unknown)() : answer;
    }),
  };
}

const provider = (id: string, briefing?: Record<string, unknown>) => ({
  id,
  label: id,
  available: true,
  resumable: false,
  personas: [],
  ...(briefing === undefined ? {} : { briefing }),
});

afterEach(() => {
  resetHandOverForTest();
  resetRunNameCacheForTest();
  vi.useRealTimers();
});

describe("the grant's door", () => {
  it("asks fieldd, and answers what it said", async () => {
    const client = clientOf({
      "agent.providers": { providers: [] },
      "objects.hand": { handed: true },
    });
    installObjectsDoor(client as never);
    await expect(handOver(REF as never, "run-1")).resolves.toEqual({ handed: true });
    expect(client.asked).toContainEqual(["objects.hand", { ref: REF, run: "run-1" }]);
  });

  it("carries fieldd's refusal in its own words", async () => {
    const client = clientOf({
      "agent.providers": { providers: [] },
      "objects.hand": { handed: false, reason: "That object has closed" },
    });
    installObjectsDoor(client as never);
    await expect(handOver(REF as never, "run-1")).resolves.toEqual({
      handed: false,
      reason: "That object has closed",
    });
  });

  it("says so when fieldd cannot be reached or answers nonsense: nothing is handed", async () => {
    const client = clientOf({
      "agent.providers": { providers: [] },
      "objects.hand": () => {
        throw new Error("socket closed");
      },
    });
    installObjectsDoor(client as never);
    await expect(handOver(REF as never, "run-1")).resolves.toEqual({
      handed: false,
      reason: HAND_OVER_WORDS.unreachable,
    });
  });

  it("goes back to no door when it is taken down", async () => {
    const off = installObjectsDoor(clientOf({ "agent.providers": { providers: [] } }) as never);
    off();
    await expect(handOver(REF as never, "run-1")).resolves.toEqual({
      handed: false,
      reason: HAND_OVER_WORDS.noDoor,
    });
  });
});

describe("naming an object", () => {
  it("asks fieldd for the ref of a key on a board", async () => {
    const client = clientOf({ "agent.providers": { providers: [] }, "objects.ref": { ref: REF } });
    installObjectsDoor(client as never);
    await expect(refFor({ docId: "d", key: "k", kind: "desk.note" })).resolves.toBe(REF);
    expect(client.asked).toContainEqual([
      "objects.ref",
      { docId: "d", key: "k", kind: "desk.note" },
    ]);
  });

  it("answers null with no door, a thrown request or a shape it cannot read", async () => {
    await expect(refFor({ docId: "d", key: "k" })).resolves.toBeNull();
    const client = clientOf({
      "agent.providers": { providers: [] },
      "objects.ref": () => {
        throw new Error("no");
      },
    });
    installObjectsDoor(client as never);
    await expect(refFor({ docId: "d", key: "k" })).resolves.toBeNull();
    installObjectsDoor(
      clientOf({ "agent.providers": { providers: [] }, "objects.ref": { ref: "nope" } }) as never,
    );
    await expect(refFor({ docId: "d", key: "k" })).resolves.toBeNull();
  });

  it("stops waiting: a card is never held up by a fieldd that does not answer", async () => {
    vi.useFakeTimers();
    const client = clientOf({
      "agent.providers": { providers: [] },
      "objects.ref": () => new Promise(() => undefined),
    });
    installObjectsDoor(client as never);
    const asked = refFor({ docId: "d", key: "k" });
    await vi.advanceTimersByTimeAsync(REF_WAIT_MS);
    await expect(asked).resolves.toBeNull();
  });
});

describe("finding an object by its ref", () => {
  it("answers its board and key", async () => {
    const client = clientOf({
      "agent.providers": { providers: [] },
      "objects.resolve": { found: true, docId: "d", key: "k" },
    });
    installObjectsDoor(client as never);
    await expect(resolveRef(REF as never)).resolves.toEqual({ docId: "d", key: "k" });
  });

  it("answers null for one that is gone, or with no way to ask", async () => {
    await expect(resolveRef(REF as never)).resolves.toBeNull();
    installObjectsDoor(
      clientOf({
        "agent.providers": { providers: [] },
        "objects.resolve": { found: false },
      }) as never,
    );
    await expect(resolveRef(REF as never)).resolves.toBeNull();
  });
});

describe("which agents' runs the door can name", () => {
  it("learns it from `agent.providers`: a terminal or a run's own helper, and only with MCP servers", async () => {
    const client = clientOf({
      "agent.providers": {
        providers: [
          provider("a", { mcpServers: true, mcpServerProcess: "terminal" }),
          provider("b", { mcpServers: true, mcpServerProcess: "run-helper" }),
          provider("c", { mcpServers: true, mcpServerProcess: "shared-leader" }),
          provider("d", { mcpServers: false, mcpServerProcess: "terminal" }),
          provider("claude"),
        ],
      },
    });
    installObjectsDoor(client as never);
    await vi.waitFor(() => expect(doorCanNameRun("r", "a")).toBe(true));
    expect(doorCanNameRun("r", "b")).toBe(true);
    expect(doorCanNameRun("r", "c")).toBe(false);
    expect(doorCanNameRun("r", "d")).toBe(false);
    // the catalog's word stands until an answer, and an agent that declares nothing is named by nothing
    expect(doorCanNameRun("r", "claude")).toBe(false);
  });

  it("keeps the catalog's word when fieldd cannot say", async () => {
    installObjectsDoor(
      clientOf({
        "agent.providers": () => {
          throw new Error("no");
        },
      }) as never,
    );
    await Promise.resolve();
    expect(doorCanNameRun("r", "claude")).toBe(true);
  });
});

describe("the take-back's door never swallows a refusal (item 526)", () => {
  const grantRow = (holder: string, name: string) => ({
    ref: REF,
    docId: "doc-1",
    key: "k1",
    holder,
    name,
    how: "handed",
    at: 1,
  });
  /** `objects.takeBack` answers each ask in turn from `takes` (a throw is a refusal); `objects.grants` from `grants`. */
  function takeBackClient(takes: ReadonlyArray<() => unknown>, grants: unknown | (() => unknown)) {
    let asked = 0;
    return clientOf({
      "agent.providers": { providers: [] },
      "objects.takeBack": () => {
        const answer = takes[Math.min(asked, takes.length - 1)];
        asked += 1;
        return answer?.();
      },
      "objects.grants": grants,
    });
  }
  const refused = () => {
    throw new Error("socket closed");
  };
  const methods = (client: ReturnType<typeof clientOf>) => client.asked.map(([method]) => method);

  it("is taken when fieldd takes it, asked once", async () => {
    const client = takeBackClient([() => ({ taken: true })], { grants: [] });
    installObjectsDoor(client as never);
    await expect(takeBack(REF, "run-a")).resolves.toBe("taken");
    expect(methods(client).filter((m) => m !== "agent.providers")).toEqual(["objects.takeBack"]);
  });

  it("is taken when fieldd answers AUDIT_UNAVAILABLE with the act applied: its evidence is owed, and nothing more is asked", async () => {
    const applied = () => {
      throw new FielddRpcError("AUDIT_UNAVAILABLE", "the action completed", true, {
        service: "audit",
        actionApplied: true,
      });
    };
    const client = takeBackClient([applied], { grants: [grantRow("run-a", "claude·2")] });
    installObjectsDoor(client as never);
    await expect(takeBack(REF, "run-a")).resolves.toBe("taken");
    expect(methods(client).filter((m) => m !== "agent.providers")).toEqual(["objects.takeBack"]);
  });

  it("asks twice, and a second ask that takes it is taken", async () => {
    const client = takeBackClient([refused, () => ({ taken: true })], { grants: [] });
    installObjectsDoor(client as never);
    await expect(takeBack(REF, "run-a")).resolves.toBe("taken");
    expect(methods(client).filter((m) => m !== "agent.providers")).toEqual([
      "objects.takeBack",
      "objects.takeBack",
    ]);
  });

  it("refused twice, it reads the grants: one that stands for the run is said to stand", async () => {
    const client = takeBackClient([refused], { grants: [grantRow("run-a", "claude·2")] });
    installObjectsDoor(client as never);
    await expect(takeBack(REF, "run-a", "claude·2")).resolves.toBe("stands");
    expect(methods(client).filter((m) => m !== "agent.providers")).toEqual([
      "objects.takeBack",
      "objects.takeBack",
      "objects.grants",
    ]);
    expect(client.asked.at(-1)).toEqual(["objects.grants", { ref: REF }]);
  });

  it("refused twice, a spark's grant stands by the name the pane shows", async () => {
    const client = takeBackClient([refused], { grants: [grantRow("spark:sp-7k2m9q4x", "Vela")] });
    installObjectsDoor(client as never);
    await expect(takeBack(REF, "run-a", "Vela")).resolves.toBe("stands");
  });

  it("refused twice, it is taken when no grant stands for the run, whoever else holds the object", async () => {
    const client = takeBackClient([refused], { grants: [grantRow("run-b", "codex·1")] });
    installObjectsDoor(client as never);
    await expect(takeBack(REF, "run-a", "claude·2")).resolves.toBe("taken");
  });

  it("refused twice, and the grants cannot be read either: VibeField cannot tell", async () => {
    const client = takeBackClient([refused], refused);
    installObjectsDoor(client as never);
    await expect(takeBack(REF, "run-a", "claude·2")).resolves.toBe("unknown");
  });

  it("with no door in this window there is no grant to take back", async () => {
    await expect(takeBack(REF, "run-a")).resolves.toBe("taken");
  });
});
