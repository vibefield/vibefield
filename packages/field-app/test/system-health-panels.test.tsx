// @vitest-environment happy-dom
/**
 * Item 600 (2026-11-19): the two Settings sections that read `system.health.subscribe` show the
 * stream's EXISTING unavailable words when an answer does not have the health's shape, and never
 * render a half-read answer: SystemSection says "health stream unavailable", MeshSection reads its
 * node "unavailable" and lists no serve from the refused answer. And a diagnostics line never shows
 * a state it did not read: a floor block alone of the wrong shape reads "unavailable", where today
 * the section throws as it draws (its units mapped unread), and a floor block with no state reads
 * "unavailable", never "up", while fieldd's own facts stay. Each section mounts under a boundary
 * that catches a throw, so a row asserts the throw absent and fails by assertion, never by the
 * run's error. Every answer starts from contracts' golden, a whole answer as
 * fieldd gives it, and a row overrides only what it is about; the two control rows render a
 * well-formed answer's facts, so a red here is the reading, not the fixture.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, Component, createElement, type FunctionComponent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeshSection } from "../src/panels/MeshSection";
import { SystemSection } from "../src/panels/SystemSection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GOLDEN = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../contracts/fixtures/system-health.valid.json",
);
const golden = (): Record<string, unknown> =>
  JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, unknown>;

/** the golden with fieldd's identity and the docs this row reads */
function systemAnswer(docCount: unknown): Record<string, unknown> {
  const answer = golden();
  answer.fieldd = { ...(answer.fieldd as Record<string, unknown>), bootId: "boot-600" };
  answer.docs = { state: "up", docCount };
  return answer;
}

/** the golden with the one serve this row reads */
function meshAnswer(serve: Record<string, unknown>): Record<string, unknown> {
  const answer = golden();
  answer.mesh = { serves: [serve] };
  return answer;
}

function fakeClient(snapshot: Record<string, unknown>): FielddClient {
  return {
    status: "connected",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (method: string) => {
      if (method === "system.health.subscribe") {
        return { subId: "health", snapshot, unsubscribe: (): undefined => undefined };
      }
      if (method === "device.subscribe") {
        return { subId: "devices", snapshot: [], unsubscribe: (): undefined => undefined };
      }
      throw new Error(`unexpected subscription: ${method}`);
    }),
    request: vi.fn(async () => ({})),
  } as unknown as FielddClient;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
/** what the mounted section threw as it drew, if anything */
let renderError: unknown = null;

/** catches a section's throw as it draws, so a row can assert it absent */
class CatchRender extends Component<{ children?: ReactNode }, { failed: boolean }> {
  override state: { failed: boolean } = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function mount(
  section: FunctionComponent,
  snapshot: Record<string, unknown>,
): Promise<string> {
  const client = fakeClient(snapshot);
  container = document.createElement("div");
  document.body.appendChild(container);
  renderError = null;
  root = createRoot(container, {
    onCaughtError: (error) => {
      renderError = error;
    },
  });
  await act(async () => {
    root?.render(
      createElement(
        FielddProvider,
        { client },
        createElement(CatchRender, null, createElement(section)),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return container.textContent ?? "";
}

describe("system.health answers the sections cannot read (item 600)", () => {
  it("SystemSection renders a well-formed answer's facts (control)", async () => {
    const text = await mount(SystemSection, systemAnswer(3));
    expect(text).toContain("boot-600");
    expect(text).toContain("3 docs");
    expect(text).not.toContain("health stream unavailable");
  });

  it("SystemSection says the stream is unavailable for an answer of the wrong shape, and shows none of it", async () => {
    const text = await mount(SystemSection, systemAnswer("seven"));
    expect(text).toContain("health stream unavailable");
    expect(text).not.toContain("boot-600");
    expect(text).not.toContain("seven");
  });

  it("SystemSection never throws on a floor block of the wrong shape: it reads unavailable, and fieldd's facts stay", async () => {
    const answer = systemAnswer(3);
    answer.native = { n: 0 };
    const text = await mount(SystemSection, answer);
    expect(renderError).toBeNull();
    expect(text).toMatch(/native\s*unavailable/);
    expect(text).toContain("boot-600");
    expect(text).not.toContain("health stream unavailable");
  });

  it("SystemSection never shows a floor state it did not read: a floor block with no state reads unavailable, never up", async () => {
    const answer = systemAnswer(3);
    answer.native = { units: (answer.native as { units: unknown }).units };
    const text = await mount(SystemSection, answer);
    expect(renderError).toBeNull();
    expect(text).toMatch(/native\s*unavailable/);
    expect(text).not.toMatch(/native\s*up/);
    expect(text).not.toContain("signing in");
    expect(text).toContain("boot-600");
  });

  it("MeshSection renders a well-formed answer's serve (control)", async () => {
    const text = await mount(MeshSection, meshAnswer({ name: "product-600", status: "serving" }));
    expect(text).toContain("product-600");
    expect(text).toContain("serving");
  });

  it("MeshSection reads its node unavailable for an answer of the wrong shape, and lists no serve from it", async () => {
    const text = await mount(MeshSection, meshAnswer({ name: "rogue", status: 42 }));
    expect(text).toContain("unavailable");
    expect(text).not.toContain("rogue");
  });
});
