import {
  AppPreferences,
  connectAskMoment,
  connectAskOpen,
  SetupLedger,
  type SetupMomentKey,
  UserLinkState,
} from "@vibefield/contracts";
import { LINK_NOTICE_QUIET_MS, type LinkNotice } from "./link-notices";

// TS-4 (track TS, TS-D7, TS-L6; DESIGN.md §8 "Asking again") — after Not now,
// main's two places that offer the link again:
//   - the status item's Connect Your Devices…, a row while this Mac is not
//     connected (no ledger: "Always. A menu row.");
//   - the away notice, when the last window closes with agents running: said
//     at most once per 30 days, never two places in a day (`connectAskOpen`),
//     only for someone who put Devices off, and never once the switch in
//     Settings → Devices (`mesh.connectAsks`) is off.
// Each saying is written `asked` in the setup ledger (`connect-ask:away`), so
// the quiet holds across restarts and against the renderer's own place. Both
// retire the moment the link lands: they read the link and write nothing.

/** The words (DESIGN.md §9, "Asking again"). */
export function awayNotice(working: number): LinkNotice {
  const agents = working === 1 ? "1 agent is" : `${working} agents are`;
  return {
    title: "VibeField keeps running",
    body: `${agents} still working. Connect your phone to check on them from there.`,
  };
}

/** The agents on this Mac still working, from `agent.list` (read tolerantly: a
 * row without the word is not counted). */
export function workingAgents(list: unknown): number {
  if (typeof list !== "object" || list === null) return 0;
  const sessions = (list as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) return 0;
  return sessions.filter(
    (row) =>
      typeof row === "object" && row !== null && (row as { status?: unknown }).status === "working",
  ).length;
}

/** This Mac is in the ordinary unconnected state: the link face's `offline`
 * kind (field-app's `linkFace`, account/link.ts), read in main so the status
 * item's row and the filters' ghost rows agree. The word `offline`; a linked,
 * expired or removed word over no record (the record is the account); or, with
 * no word this build knows, no record and no capture. Read tolerantly: a field
 * this build cannot read is never taken for an absent one. */
export function offersConnectFor(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const { linkState, link, authUrl } = value as Record<string, unknown>;
  const word = UserLinkState.safeParse(linkState);
  if (!word.success) return link === null && authUrl === null;
  switch (word.data) {
    case "offline":
      return true;
    case "linked":
    case "expired":
    case "removed":
      return link === null;
    default:
      return false;
  }
}

export interface ConnectAskPorts {
  now(): number;
  /** `setup.moment {moment, state: "asked"}` — said, at this time */
  ask(moment: SetupMomentKey): Promise<void>;
}

/** The decider: pure, fed the link, the ledger and the preferences. */
export class ConnectAsks {
  private readonly startedAt: number;
  private offered = false;
  /** the setup ledger as fieldd last published it; null until one is read */
  private ledger: SetupLedger | null = null;
  /** the switch; null until the preferences are read — never a guess */
  private asksOn: boolean | null = null;
  /** said in this session, before the ledger's echo arrives */
  private readonly askedHere = new Map<SetupMomentKey, string>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly ports: ConnectAskPorts) {
    this.startedAt = ports.now();
  }

  onLink(value: unknown): void {
    if (typeof value !== "object" || value === null) return;
    const offered = offersConnectFor(value);
    if (offered === this.offered) return;
    this.offered = offered;
    for (const listener of [...this.listeners]) listener();
  }

  onLedger(value: unknown): void {
    const ledger = SetupLedger.safeParse(value);
    // a ledger this build cannot read decides nothing
    if (ledger.success) this.ledger = ledger.data;
  }

  onPreferences(value: unknown): void {
    const preferences = AppPreferences.safeParse(value);
    if (preferences.success) this.asksOn = preferences.data.connectAsks;
  }

  /** The status item's row: this Mac is in the ordinary unconnected state. A
   * capture, a refusal or a lapsed sign-in says its own words in the app. */
  offersConnect(): boolean {
    return this.offered;
  }

  /** The row's offer changed (the tray redraws). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The last window closed while VibeField stays: the notice to show, or null.
   * A notice returned is already recorded as said. */
  away(working: number): LinkNotice | null {
    const now = this.ports.now();
    // a launch is never the moment
    if (working < 1 || now - this.startedAt < LINK_NOTICE_QUIET_MS) return null;
    if (!this.offersConnect() || this.asksOn !== true || this.ledger === null) return null;
    if (!connectAskOpen(this.withAskedHere(this.ledger), "away", now)) return null;
    const moment = connectAskMoment("away");
    this.askedHere.set(moment, new Date(now).toISOString());
    void this.ports.ask(moment).catch(() => {
      // the ledger refused or is unreachable: this session still keeps the quiet
    });
    return awayNotice(working);
  }

  private withAskedHere(ledger: SetupLedger): SetupLedger {
    if (this.askedHere.size === 0) return ledger;
    const moments = { ...(ledger.moments ?? {}) };
    for (const [moment, at] of this.askedHere) moments[moment] = { state: "asked", at };
    return { ...ledger, moments };
  }
}
