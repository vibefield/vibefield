import type { TerminalBridgeStatus } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { PreloadTerminalStatusBridge } from "../src/preload/terminal";

// The preload's terminal status half: validate at the boundary, replay the last
// truth to a late subscriber, and never hand a handler a payload the contract
// does not recognize.

describe("PreloadTerminalStatusBridge", () => {
  it("replays the last status to a subscriber that mounted after the death", () => {
    const bridge = new PreloadTerminalStatusBridge(() => undefined);
    bridge.accept({ state: "bridge-down", detail: "bridge exited (SIGKILL)" });

    const seen: TerminalBridgeStatus[] = [];
    bridge.subscribe((status) => seen.push(status));
    expect(seen).toEqual([{ state: "bridge-down", detail: "bridge exited (SIGKILL)" }]);
  });

  it("fans one status out to every reader and stops on unsubscribe", () => {
    const bridge = new PreloadTerminalStatusBridge(() => undefined);
    const deck: TerminalBridgeStatus[] = [];
    const chrome: TerminalBridgeStatus[] = [];
    const stop = bridge.subscribe((status) => deck.push(status));
    bridge.subscribe((status) => chrome.push(status));

    bridge.accept({ state: "bridge-up", attempts: 1 });
    stop();
    bridge.accept({ state: "ticket-expired", attempts: 5 });

    expect(deck.map((s) => s.state)).toEqual(["bridge-up"]);
    expect(chrome.map((s) => s.state)).toEqual(["bridge-up", "ticket-expired"]);
  });

  it("refuses a malformed status loudly instead of forwarding it", () => {
    const onRejected = vi.fn();
    const bridge = new PreloadTerminalStatusBridge(onRejected);
    const seen: TerminalBridgeStatus[] = [];
    bridge.subscribe((status) => seen.push(status));

    bridge.accept({ state: "bridge-sideways" });
    bridge.accept("bridge-up");

    expect(seen).toEqual([]);
    expect(onRejected).toHaveBeenCalledTimes(2);
  });
});
