import {
  SetupLedger,
  type SetupMomentKey,
  type SetupMomentState,
  setupMomentState,
} from "@vibefield/contracts";
import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import type { ConnectAsks } from "./connect-asks";
import type { FielddHandleCoordinator } from "./fieldd-handle-coordinator";

// TS-5 (track TS, P10, TS-D9; TS-D18 = d) — telling the person outside the app.
// Main decides, because a notice must reach someone with no VibeField window in
// front, or none open. Three moments, in DESIGN.md §9's words ("The link's
// words"):
//   - Connected: the link reaching `linked` from a capture this session saw.
//   - A device's first appearance in this user's roster.
//   - Renewal: once per expiry date, within 3 days of it.
// What was already said is remembered in the setup ledger's moments (TS-D18 d:
// `users/<you>/fieldd/setup.json` through `setup.moment`, keyed by device id and
// by expiry date, read through `setupMomentState` as every moment is), so it is
// said once, across restarts. The quiet rules (TS-D7's
// spirit): never in main's first minute, never while a VibeField window is in
// front (the app already says it there), and a device that was already here —
// at the session's first read, or arriving with the link itself — is recorded
// without a notice.

/** Nothing is said in main's first minute: a launch is never the moment. */
export const LINK_NOTICE_QUIET_MS = 60_000;
/** The arrival: devices that appear this soon after the link lands are the
 * account's existing devices, shown around the face — never "joined". */
export const ARRIVAL_SETTLE_MS = 30_000;
/** Renewal is noticed this many days out (TS-D9: one notice 3 days out). */
export const RENEWAL_NOTICE_DAYS = 3;
const DAY_MS = 86_400_000;

export interface LinkNotice {
  readonly title: string;
  readonly body: string;
}

export interface LinkNoticePorts {
  now(): number;
  /** a VibeField window is in front: the app says it there */
  focused(): boolean;
  /** show it; a click opens Settings → Devices */
  notify(notice: LinkNotice): void;
  /** `setup.moment {moment, state: "retired"}` — said, never again */
  retire(moment: string): Promise<void>;
}

/** The words (DESIGN.md §9, "The link's words"). */
export const CONNECTED_NOTICE: LinkNotice = {
  title: "Connected to Tailscale",
  body: "Your phone and your other computers can reach this field.",
};
export function joinedNotice(name: string): LinkNotice {
  return {
    title: `${name} joined your devices`,
    body: "It can reach this field, and you can reach it.",
  };
}
export function renewalNotice(days: number): LinkNotice {
  const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return {
    title: `Tailscale sign-in renews ${when}`,
    body: "Sign in again on This Mac to keep your devices connected.",
  };
}

/** The UTC day of an expiry, the renewal moment's key. */
function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

interface RosterRow {
  deviceId: string;
  name: string;
  self: boolean;
}

/** The roster's rows, read tolerantly: a row without the three fields is skipped. */
function rosterRows(value: unknown): RosterRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const { deviceId, name, self } = row as Record<string, unknown>;
    return typeof deviceId === "string" && typeof name === "string" && typeof self === "boolean"
      ? [{ deviceId, name, self }]
      : [];
  });
}

/** The decider: pure, fed the three streams, told the time and the focus. */
export class LinkNotices {
  private readonly startedAt: number;
  private linkState: string | null = null;
  /** a capture this session saw — the only way into a "Connected" notice */
  private sawCapture = false;
  private keyExpiresAt: number | null = null;
  private arrivalUntil = 0;
  /** the setup ledger as fieldd last published it; null until one is read */
  private ledger: SetupLedger | null = null;
  /** said (or recorded) in this session, before the ledger's echo arrives */
  private readonly retiredHere = new Set<string>();
  private pendingRoster: RosterRow[] | null = null;
  private firstRosterDone = false;

  constructor(private readonly ports: LinkNoticePorts) {
    this.startedAt = ports.now();
  }

  onLink(value: unknown): void {
    if (typeof value !== "object" || value === null) return;
    const status = value as { linkState?: unknown; keyExpiresAt?: unknown };
    const state = typeof status.linkState === "string" ? status.linkState : null;
    const previous = this.linkState;
    this.linkState = state;
    if (state === "capturing" || state === "awaiting_approval") this.sawCapture = true;
    if (typeof status.keyExpiresAt === "number") this.keyExpiresAt = status.keyExpiresAt;
    else if (status.keyExpiresAt === null) this.keyExpiresAt = null;
    if (state === "linked" && previous !== "linked" && this.sawCapture) {
      this.sawCapture = false;
      this.arrivalUntil = this.ports.now() + ARRIVAL_SETTLE_MS;
      if (this.mayNotify()) this.ports.notify(CONNECTED_NOTICE);
    }
    this.checkRenewal();
  }

  onLedger(value: unknown): void {
    const ledger = SetupLedger.safeParse(value);
    // never a guess at what was said: a ledger this build cannot read decides nothing
    if (!ledger.success) return;
    this.ledger = ledger.data;
    if (this.pendingRoster !== null) {
      const roster = this.pendingRoster;
      this.pendingRoster = null;
      this.applyRoster(roster);
    }
    this.checkRenewal();
  }

  onRoster(value: unknown): void {
    const rows = rosterRows(value);
    // what was already said is in the ledger: wait for it before deciding
    if (this.ledger === null) {
      this.pendingRoster = rows;
      return;
    }
    this.applyRoster(rows);
  }

  /** The hourly look at the renewal's date, between link events. */
  tick(): void {
    this.checkRenewal();
  }

  private applyRoster(rows: RosterRow[]): void {
    const firstRead = !this.firstRosterDone;
    this.firstRosterDone = true;
    const arriving = this.ports.now() < this.arrivalUntil;
    for (const row of rows) {
      if (row.self) continue;
      const moment: SetupMomentKey = `device-joined:${row.deviceId}`;
      if (this.isRetired(moment)) continue;
      // already here at the session's first read, or arriving with the link:
      // recorded, never announced
      if (!firstRead && !arriving && this.mayNotify()) this.ports.notify(joinedNotice(row.name));
      this.retire(moment);
    }
  }

  private checkRenewal(): void {
    if (this.linkState !== "linked" || this.keyExpiresAt === null) return;
    const left = this.keyExpiresAt - this.ports.now();
    if (left <= 0 || left > RENEWAL_NOTICE_DAYS * DAY_MS) return;
    const moment: SetupMomentKey = `renewal-notice:${dayKey(this.keyExpiresAt)}`;
    if (this.ledger === null || this.isRetired(moment)) return;
    // in front, the app says it (the attention ink): wait for a quieter moment
    if (!this.mayNotify()) return;
    this.ports.notify(renewalNotice(Math.ceil(left / DAY_MS)));
    this.retire(moment);
  }

  private mayNotify(): boolean {
    return this.ports.now() - this.startedAt >= LINK_NOTICE_QUIET_MS && !this.ports.focused();
  }

  private isRetired(moment: SetupMomentKey): boolean {
    return (
      this.retiredHere.has(moment) ||
      (this.ledger !== null && setupMomentState(this.ledger, moment) === "retired")
    );
  }

  private retire(moment: SetupMomentKey): void {
    this.retiredHere.add(moment);
    void this.ports.retire(moment).catch(() => {
      // the ledger refused or is unreachable: this session still says it once
    });
  }
}

/** Binds the deciders to the attached user's fieldd, re-subscribing on every
 * new handle (supervisor recovery), with the hourly renewal look: the link's
 * notices, and TS-4's asks to connect (`ConnectAsks`, which also reads the
 * preferences for its switch). */
export class LinkNoticeObserver {
  private generation = 0;
  private stops: Array<() => void> = [];
  private readonly stopHandles: () => void;
  private readonly timer: ReturnType<typeof setInterval>;
  private handle: FielddHandle | null = null;
  readonly notices: LinkNotices;

  constructor(
    coordinator: Pick<FielddHandleCoordinator, "onHandle">,
    ports: Omit<LinkNoticePorts, "retire">,
    private readonly asks: ConnectAsks,
    onError: (error: unknown) => void,
  ) {
    this.notices = new LinkNotices({
      ...ports,
      retire: (moment) => this.setupMoment(moment, "retired"),
    });
    this.timer = setInterval(() => this.notices.tick(), 3_600_000);
    this.timer.unref?.();
    this.stopHandles = coordinator.onHandle((handle) => {
      this.generation += 1;
      const generation = this.generation;
      this.clear();
      this.handle = handle;
      const feed = (method: string, apply: (value: unknown) => void): void => {
        // an event can land before the subscribe answers: the snapshot is
        // then older than what was applied, and is not applied over it
        let eventReceived = false;
        void handle.client
          .subscribe(method, {}, (payload: unknown) => {
            eventReceived = true;
            if (generation === this.generation) apply(payload);
          })
          .then(
            (subscription) => {
              if (generation !== this.generation) {
                subscription.unsubscribe();
                return;
              }
              if (!eventReceived) apply(subscription.snapshot);
              this.stops.push(subscription.unsubscribe);
            },
            (error: unknown) => {
              if (generation === this.generation) onError(error);
            },
          );
      };
      // the ledger first, so the first roster is read against what was said
      feed("setup.subscribe", (value) => {
        this.notices.onLedger(value);
        this.asks.onLedger(value);
      });
      feed("user.link.subscribe", (value) => {
        this.notices.onLink(value);
        this.asks.onLink(value);
      });
      feed("device.subscribe", (value) => this.notices.onRoster(value));
      feed("storage.appPreferences.subscribe", (value) => this.asks.onPreferences(value));
    });
  }

  /** `setup.moment` on the attached user's fieldd; nothing while none is attached. */
  async setupMoment(moment: SetupMomentKey, state: SetupMomentState): Promise<void> {
    const handle = this.handle;
    if (handle === null) return;
    await handle.client.request("setup.moment", { moment, state });
  }

  dispose(): void {
    this.generation += 1;
    clearInterval(this.timer);
    this.stopHandles();
    this.clear();
    this.handle = null;
  }

  private clear(): void {
    for (const stop of this.stops) {
      try {
        stop();
      } catch {
        // teardown is best-effort
      }
    }
    this.stops = [];
  }
}
