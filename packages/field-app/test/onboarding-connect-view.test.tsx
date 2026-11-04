// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ConnectPaneProps,
  OnboardingConnectPaneView,
} from "../src/boot/onboarding/views/connect";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
});

function mount(extra: Partial<ConnectPaneProps> = {}): ConnectPaneProps {
  const props: ConnectPaneProps = {
    face: { kind: "offline", nodeState: null },
    step: { kind: "idle" },
    me: { face: { emoji: "🦊" }, seed: "qa" },
    devices: [],
    onBegin: vi.fn(),
    onRenew: vi.fn(),
    onSendLogs: vi.fn(),
    onCancel: vi.fn(),
    onOpenAgain: vi.fn(),
    onCopyLink: vi.fn(async () => true),
    onCopyText: vi.fn(async () => true),
    onSignInAgain: vi.fn(),
    onContinue: vi.fn(),
    onSkip: vi.fn(),
    onBack: vi.fn(),
    ...extra,
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<OnboardingConnectPaneView {...props} />));
  return props;
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((el) => el.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

describe("device setup navigation", () => {
  it("gives privacy its own content area and keeps keyboard focus when returning", () => {
    const props = mount();
    act(() => button("What VibeField can see").click());
    expect(host.querySelector(".vf-wizard-device-overview")).toBeNull();
    expect(host.querySelector(".vf-door-partner")).toBeNull();
    expect(host.querySelectorAll(".vf-door-see li")).toHaveLength(5);
    expect(document.activeElement).toBe(host.querySelector("section"));
    expect(props.onBegin).not.toHaveBeenCalled();
    act(() => button("Back to your devices").click());
    expect(host.querySelector(".vf-wizard-device-overview")).not.toBeNull();
    expect(document.activeElement).toBe(button("What VibeField can see"));
    expect(props.onBack).not.toHaveBeenCalled();
    expect(
      [...host.querySelectorAll(".vf-wizard-navigation button")].map((el) => el.textContent),
    ).toEqual(["Back", "Not now", "Continue with Tailscale"]);
    act(() => button("Other ways to sign in").click());
    act(() => button("Use an auth key").click());
    act(() => button("Back to your devices").click());
    expect(document.activeElement).toBe(button("Other ways to sign in"));
    expect(props.onBegin).not.toHaveBeenCalled();
  });

  it("submits the auth key from the form and never opens browser sign-in instead", () => {
    const props = mount({ initialAside: "key" });
    expect(button("Connect with auth key").disabled).toBe(true);
    const form = host.querySelector("form");
    act(() => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(props.onBegin).not.toHaveBeenCalled();
    const input = host.querySelector("input");
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(input, "  tskey-auth-test-fixture  ");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(button("Connect with auth key").disabled).toBe(false);
    act(() => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(props.onBegin).toHaveBeenCalledExactlyOnceWith({ authKey: "tskey-auth-test-fixture" });
  });
});
