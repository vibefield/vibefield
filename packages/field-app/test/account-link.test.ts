// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  hasLink,
  linkFace,
  RENEWAL_WARN_DAYS,
  renewalDays,
  thisDeviceWord,
  type UserLinkStatus,
  unlinkedWord,
} from "../src/account/link";
import { linkLine } from "../src/account/use-account";

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
    expect(face).toEqual({
      kind: "capturing",
      authUrl: null,
      nodeState: "Starting",
      machineName: null,
      failure: null,
    });
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
      machineName: null,
      failure: null,
    });
  });

  it("names the account on the linked face", () => {
    const face = linkFace(
      "live",
      wire({ link: LINK, linkState: "linked", meshEnabled: true, nodeState: "Running" }),
    );
    expect(face).toEqual({
      kind: "linked",
      link: LINK,
      nodeState: "Running",
      keyExpiresAt: undefined,
      machineName: null,
      adminUrl: null,
      needsSignature: false,
      tailscaleVersion: null,
      sendLogs: false,
    });
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

  it("draws TS-1's three words as their own faces (TS-2)", () => {
    // an approval wait: the sign-in is done and an admin acts now; the machine
    // and the console are named
    expect(
      linkFace(
        "live",
        wire({
          linkState: "awaiting_approval",
          meshEnabled: true,
          machineName: "truffle-vibefield-studio",
          adminUrl: "https://login.tailscale.com/admin/machines",
        }),
      ),
    ).toEqual({
      kind: "approval",
      machineName: "truffle-vibefield-studio",
      adminUrl: "https://login.tailscale.com/admin/machines",
      link: null,
    });
    // a signed-out link keeps its account and carries the renewal's address
    for (const reason of ["expired", "removed"] as const) {
      const face = linkFace(
        "live",
        wire({
          linkState: reason,
          link: LINK,
          meshEnabled: true,
          authUrl: "https://login.example/a/x",
        }),
      );
      expect(face, reason).toMatchObject({
        kind: "signedOut",
        reason,
        link: LINK,
        authUrl: "https://login.example/a/x",
      });
      expect(hasLink(face), reason).toBe(true);
    }
    // a signed-out word over no record reads as what it can prove
    expect(linkFace("live", wire({ linkState: "expired" })).kind).toBe("offline");
  });

  it("draws a network that requires device logs as its own face, never as linked (TS-D16)", () => {
    // The record stands, so a reading from the facts alone would say linked.
    const standing = linkFace(
      "live",
      wire({
        linkState: "logs_required",
        link: LINK,
        meshEnabled: true,
        nodeState: "Stopped",
        machineName: "truffle-vibefield-studio",
        adminUrl: "https://login.tailscale.com/admin/machines",
      }),
    );
    expect(standing).toEqual({
      kind: "logsRequired",
      link: LINK,
      machineName: "truffle-vibefield-studio",
      adminUrl: "https://login.tailscale.com/admin/machines",
    });
    expect(hasLink(standing)).toBe(true);
    // the menu reads This Mac only (DESIGN.md §9); a standing link sends its
    // logs in Settings, so the row offers no second begin
    const now = Date.UTC(2026, 9, 27, 8);
    expect(linkLine(standing, "darwin", now)).toEqual({
      detail: "This Mac only",
      isLogin: false,
      tone: "plain",
      canLink: false,
    });
    // a capture the network refused has no record, and can begin again
    const capture = linkFace("live", wire({ linkState: "logs_required", meshEnabled: true }));
    expect(capture).toMatchObject({ kind: "logsRequired", link: null });
    expect(hasLink(capture)).toBe(false);
    expect(linkLine(capture, "darwin", now).canLink).toBe(true);
  });

  it("carries Tailnet Lock's hold, the embedded client and the logs opt-in on the linked face (T11, TS-8)", () => {
    expect(
      linkFace(
        "live",
        wire({
          linkState: "linked",
          link: LINK,
          needsSignature: true,
          tailscaleVersion: "1.104.1",
          sendLogs: true,
        }),
      ),
    ).toMatchObject({
      kind: "linked",
      needsSignature: true,
      tailscaleVersion: "1.104.1",
      sendLogs: true,
    });
    // a daemon that says none of them: no hold, no version, no logs
    expect(linkFace("live", wire({ linkState: "linked", link: LINK }))).toMatchObject({
      needsSignature: false,
      tailscaleVersion: null,
      sendLogs: false,
    });
  });

  it("carries the floor's facts: the machine's name while capturing, the key's expiry when linked", () => {
    expect(
      linkFace(
        "live",
        wire({
          linkState: "capturing",
          machineName: "truffle-vibefield-studio",
          failure: "sidecar_missing",
        }),
      ),
    ).toMatchObject({ machineName: "truffle-vibefield-studio", failure: "sidecar_missing" });
    // the record's expiry stands in when the status has none (a node that is down)
    expect(
      linkFace("live", wire({ linkState: "linked", link: { ...LINK, keyExpiresAt: 42 } })),
    ).toMatchObject({ kind: "linked", keyExpiresAt: 42 });
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

describe("the link's words (TS-2; DESIGN.md §9)", () => {
  const NOW = Date.UTC(2026, 9, 27, 8, 0, 0);
  const DAY = 86_400_000;

  it("names an unconnected desktop by its own platform, never offline", () => {
    // AO-6 — the device word itself, which the spawn menu says too
    expect(thisDeviceWord("darwin")).toBe("This Mac");
    expect(thisDeviceWord("win32")).toBe("This PC");
    expect(thisDeviceWord("linux")).toBe("This computer");
    expect(thisDeviceWord(undefined)).toBe("This Mac");
    expect(unlinkedWord("darwin")).toBe("This Mac only");
    expect(unlinkedWord("win32")).toBe("This PC only");
    expect(unlinkedWord("linux")).toBe("This computer only");
    expect(unlinkedWord(undefined)).toBe("This Mac only");
    const line = linkLine(linkFace("live", wire()), "darwin", NOW);
    expect(line).toEqual({ detail: "This Mac only", isLogin: false, tone: "plain", canLink: true });
  });

  it("says where the link is while it moves", () => {
    expect(linkLine(linkFace("live", wire({ linkState: "capturing" })), "darwin", NOW).detail).toBe(
      "Connecting…",
    );
    expect(
      linkLine(linkFace("live", wire({ linkState: "awaiting_approval" })), "darwin", NOW).detail,
    ).toBe("Waiting for approval");
  });

  it("is the login when connected, and the renewal 14 days out, in the attention ink (TS-D9)", () => {
    const linked = (keyExpiresAt: number | null) =>
      linkLine(
        linkFace("live", wire({ linkState: "linked", link: LINK, keyExpiresAt })),
        "darwin",
        NOW,
      );
    expect(linked(NOW + 30 * DAY)).toEqual({
      detail: LINK.login,
      isLogin: true,
      tone: "plain",
      canLink: false,
    });
    expect(linked(null).detail).toBe(LINK.login); // expiry disabled: nothing to renew
    expect(linked(NOW + RENEWAL_WARN_DAYS * DAY)).toMatchObject({
      detail: `Sign-in renews in ${RENEWAL_WARN_DAYS} days`,
      tone: "attention",
      isLogin: false,
    });
    expect(linked(NOW + 6 * DAY - 1000).detail).toBe("Sign-in renews in 6 days");
    expect(linked(NOW + DAY / 2).detail).toBe("Sign-in renews in 1 day");
    expect(linked(NOW).detail).toBe("Sign-in renews today");
    expect(renewalDays(undefined, NOW)).toBeNull();
  });

  it("says a signed-out link in the attention ink, and names the ordinary state on a refusal", () => {
    const expired = linkLine(
      linkFace("live", wire({ linkState: "expired", link: LINK })),
      "darwin",
      NOW,
    );
    expect(expired).toMatchObject({ detail: "Sign-in expired · this Mac only", tone: "attention" });
    expect(
      linkLine(linkFace("live", wire({ linkState: "removed", link: LINK })), "darwin", NOW).detail,
    ).toBe("Removed from Tailscale");
    // a refusal is said where the act is; the line keeps the ordinary state
    expect(
      linkLine(
        linkFace("live", wire({ linkState: "login_unavailable", linkDetail: "tagged" })),
        "darwin",
        NOW,
      ),
    ).toMatchObject({ detail: "This Mac only", canLink: true });
  });
});
