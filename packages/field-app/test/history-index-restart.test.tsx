// @vitest-environment happy-dom
/**
 * fix7 (DESIGN.md §8 "History" — the index's failed state carries its act):
 * PJ-7's first phone run met a FAILED index whose sentence named a restart
 * affordance no window offered. The frame's band calls `system.index.restart`
 * over the window's client, says that it is restarting, and says what came of
 * it — running again, stopped again in fieldd's words, or a refusal in its own.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryIndexRestart, restartIndex } from "../src/history/index-restart";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function door(answer: () => Promise<unknown>) {
  const calls: Array<{ method: string; params: unknown }> = [];
  return {
    calls,
    request(method: string, params: unknown): Promise<unknown> {
      calls.push({ method, params });
      return answer();
    },
  };
}

const refusal = (kind: string, message: string) =>
  Object.assign(new Error(message), { rpc: { data: { kind, retryable: false } } });

describe("the index's restart (fix7)", () => {
  it("asks system.index.restart and says the index's new phase in words", async () => {
    const ready = door(async () => ({
      rosettad: { phase: "ready", detail: null, pid: 2, protocolVersion: 27 },
    }));
    expect(await restartIndex(ready)).toEqual({
      state: "restarted",
      words: "The index is running again.",
    });
    expect(ready.calls).toEqual([{ method: "system.index.restart", params: {} }]);
    const rebuilding = door(async () => ({
      rosettad: { phase: "rebuilding", detail: "schema 24 → 27" },
    }));
    expect(await restartIndex(rebuilding)).toEqual({
      state: "restarted",
      words: "The index is rebuilding.",
    });
    const again = door(async () => ({
      rosettad: { phase: "failed", detail: "rosettad exited (1)" },
    }));
    expect(await restartIndex(again)).toEqual({
      state: "refused",
      words: "The index stopped again — rosettad exited (1)",
    });
    const forbidden = door(async () => {
      throw refusal("FORBIDDEN_SCOPE", "this caller may not restart the index");
    });
    const refused = await restartIndex(forbidden);
    expect(refused.state).toBe("refused");
    expect("words" in refused && refused.words).toMatch(/^Could not restart the index — /);
  });

  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("the band: Restart the index → restarting, said → what came of it, said", async () => {
    let release!: (value: unknown) => void;
    const client = door(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<HistoryIndexRestart client={client} />));
    const button = host.querySelector("button") as HTMLButtonElement;
    expect(button.textContent).toBe("Restart the index");
    await act(async () => button.click());
    expect(client.calls.map((call) => call.method)).toEqual(["system.index.restart"]);
    expect(button.textContent).toBe("Restarting the index…");
    expect(button.disabled).toBe(true);
    await act(async () => release({ rosettad: { phase: "ready", detail: null } }));
    expect(button.textContent).toBe("Restart the index");
    expect(host.querySelector("[role=status]")?.textContent).toBe("The index is running again.");
  });
});
