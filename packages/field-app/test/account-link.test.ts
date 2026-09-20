// @vitest-environment node

import { describe, expect, it } from "vitest";
import { hasLink, linkFace, type UserLinkStatus } from "../src/account/link";

// UA-P-0g — the derivation is the thing both surfaces trust, so every posture
// `user.link.subscribe` can report gets a row here. The defect this replaces
// was exactly a derivation bug with two faces downstream: `meshEnabled: false`
// (which is what an UNLINKED desktop reports, by construction) read as "the
// mesh is switched off", so a fresh install and an unlinked one landed on a
// face that offered nothing and said the flag was the way in.

const wire = (over: Partial<UserLinkStatus> = {}): UserLinkStatus => ({
  link: null,
  meshEnabled: false,
  nodeState: null,
  authUrl: null,
  linkState: "offline",
  linkDetail: null,
  ...over,
});

const LINK = {
  login: "james@example.com",
  tailnet: "example.ts.net",
  linkedAt: "2026-08-05T09:00:00.000Z",
};

describe("linkFace", () => {
  it("reads an unlinked desktop as offline, not as a switched-off mesh", () => {
    // The whole slice in one row: meshEnabled is FALSE here and the face is
    // still the one where the act is offered.
    const face = linkFace("live", wire({ meshEnabled: false }));
    expect(face.kind).toBe("offline");
  });

  it("carries the node's own word onto the offline face when there is one", () => {
    const face = linkFace("live", wire({ nodeState: "disabled" }));
    expect(face).toEqual({ kind: "offline", nodeState: "disabled" });
  });

  it("reads capturing with no address yet as capturing, not as linked or idle", () => {
    const face = linkFace("live", wire({ linkState: "capturing", nodeState: "Starting" }));
    expect(face).toEqual({ kind: "capturing", authUrl: null, nodeState: "Starting" });
  });

  it("carries the sign-in address once the node offers one", () => {
    const face = linkFace(
      "live",
      wire({
        linkState: "capturing",
        nodeState: "NeedsLogin",
        authUrl: "https://login.tailscale.com/a/abc",
      }),
    );
    expect(face).toEqual({
      kind: "capturing",
      authUrl: "https://login.tailscale.com/a/abc",
      nodeState: "NeedsLogin",
    });
  });

  it("names the account on the linked face", () => {
    const face = linkFace(
      "live",
      wire({ link: LINK, linkState: "linked", meshEnabled: true, nodeState: "Running" }),
    );
    expect(face).toEqual({ kind: "linked", link: LINK, nodeState: "Running" });
  });

  it("believes the RECORD, not the word, when a daemon says linked with nothing on file", () => {
    // UA-4 compares the stored login at every door, so a face that claimed
    // "linked" over a null record would be the one lie that matters.
    const face = linkFace("live", wire({ link: null, linkState: "linked" }));
    expect(face.kind).toBe("offline");
  });

  it("speaks a corrupt link record and withholds an act that could only fail", () => {
    const face = linkFace(
      "live",
      wire({ linkState: "link_corrupt", linkDetail: "link.json is present but unusable: /x/y" }),
    );
    expect(face).toEqual({
      kind: "refused",
      state: "link_corrupt",
      title: "Link record unreadable",
      detail: "link.json is present but unusable: /x/y",
      canBegin: false,
      link: null,
    });
  });

  it("speaks a tagged node and offers the act again", () => {
    const face = linkFace(
      "live",
      wire({
        linkState: "login_unavailable",
        linkDetail: "the tailnet has no user for this node (a tagged node cannot link)",
      }),
    );
    expect(face).toMatchObject({
      kind: "refused",
      state: "login_unavailable",
      detail: "the tailnet has no user for this node (a tagged node cannot link)",
      canBegin: true,
    });
  });

  it("speaks the other local user and offers the act again once they unlink", () => {
    const face = linkFace(
      "live",
      wire({
        linkState: "login_already_linked",
        linkDetail: 'the local user "Work" is already linked to this tailscale account',
      }),
    );
    expect(face).toMatchObject({
      kind: "refused",
      state: "login_already_linked",
      detail: 'the local user "Work" is already linked to this tailscale account',
      canBegin: true,
    });
  });

  it("falls back to the shape of a refusal when the daemon sends the word alone", () => {
    const face = linkFace("live", wire({ linkState: "login_unavailable", linkDetail: null }));
    expect(face).toMatchObject({
      kind: "refused",
      detail: "The tailnet never answered with a user for this node.",
    });
  });

  it("derives a posture for a daemon that predates the word", () => {
    // Tolerant reader: an older daemon still answers this subscription, and
    // what it DID send is enough to say which of the three live shapes it is in.
    const older = { link: null, meshEnabled: false, nodeState: null, authUrl: null };
    expect(linkFace("live", older).kind).toBe("offline");
    expect(linkFace("live", { ...older, authUrl: "https://login.tailscale.com/a/x" }).kind).toBe(
      "capturing",
    );
    expect(linkFace("live", { ...older, link: LINK }).kind).toBe("linked");
  });

  it("ignores a posture word it does not know rather than inventing a face", () => {
    // Cast at the boundary on purpose: the point of the row is a value that
    // has no type here, because a newer daemon invented it.
    const face = linkFace("live", {
      ...wire({ link: LINK }),
      linkState: "quantum",
    } as unknown as UserLinkStatus);
    expect(face.kind).toBe("linked");
  });

  it("keeps loading and unavailable as themselves", () => {
    expect(linkFace("loading", null)).toEqual({ kind: "loading" });
    expect(linkFace("error", null)).toEqual({ kind: "unavailable" });
    expect(linkFace("live", null)).toEqual({ kind: "unavailable" });
  });
});

describe("hasLink", () => {
  it("acknowledges a recorded link so the wizard never re-asks it (W6)", () => {
    expect(hasLink(linkFace("live", wire({ link: LINK, linkState: "linked" })))).toBe(true);
  });

  it("acknowledges a recorded link under a refusal — the keys were left in place", () => {
    expect(hasLink(linkFace("live", wire({ link: LINK, linkState: "login_unavailable" })))).toBe(
      true,
    );
  });

  it("is false for every posture with nothing on file", () => {
    for (const linkState of ["offline", "capturing", "link_corrupt"] as const) {
      expect(hasLink(linkFace("live", wire({ linkState })))).toBe(false);
    }
    expect(hasLink(linkFace("loading", null))).toBe(false);
    expect(hasLink(linkFace("error", null))).toBe(false);
  });
});
