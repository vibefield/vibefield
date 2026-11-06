import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FielddLinkUnavailable } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import type { FielddRecoveryState } from "../src/main/fieldd-handle-coordinator";
import { FielddLink, type FielddLinkView, projectFielddLink } from "../src/main/fieldd-link";

// Item 212 (RV #29) — the ONE link model in Electron main: the attached pair's client status and its coordinator's
// bounded recovery, projected to the status item's service row and the window's `desktopState.fieldd`. The worse and
// truer story wins: crash-loop, then recovering, then the client's own word. Its writes are contracts' EL9 fixtures,
// compared here on the writer's side.

/** contracts' fixture for the field service, as main writes it */
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../../contracts/fixtures", name), "utf8"));

const READY: FielddRecoveryState = { kind: "ready" };
const RECOVERING: FielddRecoveryState = { kind: "recovering", attempt: 1, of: 3 };
const CRASH_LOOP: FielddRecoveryState = { kind: "crash-loop", failures: 3, since: 1_000 };

describe("the field service's link, projected (item 212, RV #29)", () => {
  it("says the client's own word while recovery is at rest, and tells the window nothing", () => {
    const linkOf = (client: string | null) => projectFielddLink({ client, recovery: READY });
    expect(linkOf(null).link).toBe("starting");
    expect(linkOf("connecting").link).toBe("starting");
    expect(linkOf("ready").link).toBe("ready");
    expect(linkOf("reconnecting").link).toBe("reconnecting");
    expect(linkOf("closed").link).toBe("unavailable");
    expect(linkOf("failed").link).toBe("unavailable");
    for (const client of [null, "connecting", "ready", "reconnecting", "closed", "failed"]) {
      expect(linkOf(client).fieldd).toBeNull();
      expect(linkOf(client).serviceTries).toBeUndefined();
    }
  });

  it("says recovering to the status item and the window, as the contract's fixture reads", () => {
    const view = projectFielddLink({ client: "closed", recovery: RECOVERING });
    expect(view.link).toBe("recovering");
    expect(view.serviceTries).toBeUndefined();
    expect(view.fieldd).toEqual(fixture("fieldd-link-unavailable.recovering.json"));
    expect(FielddLinkUnavailable.safeParse(view.fieldd).success).toBe(true);
  });

  it("says crash-loop with its tries, as the contract's fixture reads", () => {
    const view = projectFielddLink({ client: "closed", recovery: CRASH_LOOP });
    expect(view.link).toBe("crash-loop");
    expect(view.serviceTries).toBe(3);
    expect(view.fieldd).toEqual(fixture("fieldd-link-unavailable.crash-loop.json"));
    expect(FielddLinkUnavailable.safeParse(view.fieldd).success).toBe(true);
  });

  it("lets recovery outrank the client's word: a ready client of a recovery not yet settled says the recovery", () => {
    expect(projectFielddLink({ client: "ready", recovery: CRASH_LOOP }).link).toBe("crash-loop");
    expect(projectFielddLink({ client: "ready", recovery: RECOVERING }).link).toBe("recovering");
    expect(projectFielddLink({ client: "reconnecting", recovery: RECOVERING }).link).toBe(
      "recovering",
    );
  });
});

describe("the link model, bound to the attached pair (item 212, RV #29)", () => {
  it("is moved by the attached pair alone, and re-bound on a switch", () => {
    const views: FielddLinkView[] = [];
    const link = new FielddLink((view) => views.push(view));
    const attachedPair = { recovery: READY };
    const background = { recovery: READY };
    link.attach(attachedPair);
    link.clientStatus("ready");
    // a background pair keeps its own coordinator and intensity, and moves nothing here
    link.recoveryChanged(background, CRASH_LOOP);
    link.ensureFailed(background);
    expect(link.view().link).toBe("ready");
    link.recoveryChanged(attachedPair, RECOVERING);
    expect(link.view().link).toBe("recovering");
    // a switch: the new pair's recovery now, and no client word until its observers say one
    link.attach({ recovery: CRASH_LOOP });
    expect(link.view().link).toBe("crash-loop");
    expect(link.view().serviceTries).toBe(3);
    // the pair left behind moves nothing now
    link.recoveryChanged(attachedPair, READY);
    expect(link.view().link).toBe("crash-loop");
    expect(views.map((view) => view.link)).toEqual(["ready", "recovering", "crash-loop"]);
  });

  it("says Unavailable for the attached pair's attempt that failed with no handle (a boot's failure)", () => {
    const views: FielddLinkView[] = [];
    const link = new FielddLink((view) => views.push(view));
    const pair = { recovery: READY };
    link.attach(pair);
    expect(link.view()).toEqual({ link: "starting", serviceTries: undefined, fieldd: null });
    link.ensureFailed(pair);
    expect(link.view().link).toBe("unavailable");
    link.clientStatus("ready");
    expect(views.map((view) => view.link)).toEqual(["unavailable", "ready"]);
  });

  it("tells only a change: the same view twice is one", () => {
    const views: FielddLinkView[] = [];
    const link = new FielddLink((view) => views.push(view));
    const pair = { recovery: READY };
    link.attach(pair);
    link.recoveryChanged(pair, RECOVERING);
    link.recoveryChanged(pair, { kind: "recovering", attempt: 1, of: 3 });
    link.clientStatus("closed");
    expect(views).toHaveLength(1);
  });
});
