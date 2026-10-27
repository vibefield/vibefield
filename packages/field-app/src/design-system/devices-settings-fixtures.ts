import { type LinkFace, linkFace } from "../account/link";
import type { DevicesRow, DevicesSheet } from "../panels/DevicesSection";

// Settings → Devices in the catalog (TS-3a): the adapter supplies what a host
// supplies — the link's wire snapshot, the roster's rows — and the production
// derivation (`linkFace`) turns the snapshot into a face, so a state the
// catalog shows is one the shipping page can show.

export const DEVICES_FIXTURE_STATES = [
  "connected",
  "renamed",
  "this Mac only",
  "signing in",
  "approval",
  "expired",
  "not yet trusted",
  "logs sent",
  "logs required",
  "disconnect",
  "sign-out missed",
  "add a device",
] as const;
export type DevicesFixtureState = (typeof DEVICES_FIXTURE_STATES)[number];

/** The catalog's afternoon: the renewal reads "Due by" a fixed date from it. */
export const DEVICES_FIXTURE_NOW = Date.UTC(2026, 9, 27, 12);

const LINK = {
  login: "james@example.com",
  tailnet: "studio.ts.net",
  linkedAt: "2026-08-05T19:24:00.000Z",
};
const QUIET = {
  link: null,
  meshEnabled: false,
  nodeState: null,
  authUrl: null,
  linkDetail: null,
};
const FACTS = {
  machineName: "truffle-vibefield-studio",
  adminUrl: "https://login.tailscale.com/admin/machines",
};
/** The client a 0.7.24 floor embeds (TS-8), as Network details says it. */
const CLIENT = { tailscaleVersion: "1.104.1", needsSignature: false, sendLogs: false };

/** This Mac by the computer's name, as fieldd publishes it until the person
 * names it (TS-3b). */
const SELF: DevicesRow = {
  id: "self",
  name: "Studio.local",
  os: "macos",
  self: true,
  online: true,
  nameSource: "hostname",
};
const PEERS: readonly DevicesRow[] = [
  { id: "air", name: "MacBook Air", os: "macos", self: false, online: true },
  { id: "pc", name: "Workshop PC", os: "windows", self: false, online: false },
];
const ROSTER: readonly DevicesRow[] = [SELF, ...PEERS];

export function devicesFixture(state: DevicesFixtureState): {
  face: LinkFace;
  sheet: DevicesSheet;
  devices: readonly DevicesRow[];
  /** TS-D14 — the console a missed sign-out left this Mac in, said once */
  signOutMissed?: { readonly adminUrl: string };
} {
  const connected = linkFace("live", {
    ...QUIET,
    link: LINK,
    meshEnabled: true,
    nodeState: "Running",
    linkState: "linked",
    ...FACTS,
    ...CLIENT,
    keyExpiresAt: Date.UTC(2027, 3, 24),
  });
  switch (state) {
    case "connected":
      return { face: connected, sheet: "none", devices: ROSTER };
    case "renamed":
      // TS-3b — the person named this Mac: the computer's name is offered back
      return {
        face: connected,
        sheet: "none",
        devices: [{ ...SELF, name: "Studio", nameSource: "user" }, ...PEERS],
      };
    case "disconnect":
      return { face: connected, sheet: "disconnect", devices: ROSTER };
    case "sign-out missed":
      // TS-D14 — Disconnect done, but Tailscale never took the sign-out
      return {
        face: linkFace("live", { ...QUIET, linkState: "offline" }),
        sheet: "none",
        devices: ROSTER.slice(0, 1),
        signOutMissed: { adminUrl: FACTS.adminUrl },
      };
    case "not yet trusted":
      // T11 — up, and held by Tailnet Lock until a signing device signs it
      return {
        face: linkFace("live", {
          ...QUIET,
          link: LINK,
          meshEnabled: true,
          nodeState: "Running",
          linkState: "linked",
          ...FACTS,
          ...CLIENT,
          needsSignature: true,
          keyExpiresAt: Date.UTC(2027, 3, 24),
        }),
        sheet: "none",
        devices: ROSTER.slice(0, 1),
      };
    case "logs sent":
      // TS-D16 — the person sends device logs on this network (Network details)
      return {
        face: linkFace("live", {
          ...QUIET,
          link: LINK,
          meshEnabled: true,
          nodeState: "Running",
          linkState: "linked",
          ...FACTS,
          ...CLIENT,
          sendLogs: true,
          keyExpiresAt: Date.UTC(2027, 3, 24),
        }),
        sheet: "none",
        devices: ROSTER,
      };
    case "logs required":
      // TS-D16 — a standing link the network keeps down for its logs
      return {
        face: linkFace("live", {
          ...QUIET,
          link: LINK,
          meshEnabled: true,
          nodeState: "Stopped",
          linkState: "logs_required",
          ...FACTS,
        }),
        sheet: "none",
        devices: ROSTER.slice(0, 1),
      };
    case "add a device":
      return { face: connected, sheet: "add-device", devices: ROSTER };
    case "this Mac only":
      return {
        face: linkFace("live", { ...QUIET, linkState: "offline" }),
        sheet: "none",
        devices: ROSTER.slice(0, 1),
      };
    case "signing in":
      return {
        face: linkFace("live", {
          ...QUIET,
          meshEnabled: true,
          nodeState: "NeedsLogin",
          authUrl: "https://login.tailscale.com/a/vibefield-preview",
          linkState: "capturing",
          machineName: FACTS.machineName,
        }),
        sheet: "none",
        devices: ROSTER.slice(0, 1),
      };
    case "approval":
      return {
        face: linkFace("live", {
          ...QUIET,
          meshEnabled: true,
          nodeState: "NeedsMachineAuth",
          linkState: "awaiting_approval",
          ...FACTS,
        }),
        sheet: "none",
        devices: ROSTER.slice(0, 1),
      };
    case "expired":
      return {
        face: linkFace("live", {
          ...QUIET,
          link: LINK,
          meshEnabled: true,
          nodeState: "NeedsLogin",
          linkState: "expired",
          ...FACTS,
        }),
        sheet: "none",
        devices: ROSTER,
      };
  }
}
