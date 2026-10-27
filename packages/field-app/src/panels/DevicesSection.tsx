import type { DeviceInfo } from "@vibefield/contracts";
import { SegmentedControl } from "@vibefield/design-kit";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import {
  LINK_ACT_LABEL,
  LINK_ACT_PENDING_LABEL,
  type LinkBeginStep,
  type LinkFace,
  RENEWAL_WARN_DAYS,
  renewalDays,
  unlinkedWord,
} from "../account/link";
import { POSTURE_CHOICES, useSyncPosture } from "../account/posture";
import { TailscaleMark } from "../account/tailscale-mark";
import { useAccountSnapshot } from "../account/use-account";
import { copyText, useLinkDoor } from "../account/use-link-door";
import { leaveFor } from "../boot/switch";
import { osOf } from "../godview/monitor/devices";
import type { MonitorDeviceFacet } from "../godview/monitor/types";
import { OsMark } from "../godview/os-marks";
import { getHost } from "../host";
import { MeshSection } from "./MeshSection";
import { buttonCls, labelCls, SettingsSection } from "./settings-ui";
import "./devices.css";

// Settings → Devices (track TS, TS-3a; DESIGN.md §8 "Settings → Devices",
// TS-D3): the account's reach, one page under the head, absorbing Mesh —
// Account keeps the profile and the users. In order: the Tailscale card, This
// Mac, your devices, new projects, and the network's details, collapsed.
//
// The link's acts are the shared door's (account/use-link-door.ts), the same
// ones the Setup Assistant's Connect pane and the face menu use, so no surface
// can invent a different act. `DevicesSectionView` takes everything as props:
// the catalog mounts it with a fixture adapter (docs/UI_SYSTEM.md).

/** Where the hosted console sends an admin for this tailnet's machines, when
 * the floor has not named its own (a custom control server names none). */
const HOSTED_MACHINES_URL = "https://login.tailscale.com/admin/machines";

/** The page's sheets (DESIGN.md §8): each opens in place under the card. */
export type DevicesSheet = "none" | "disconnect" | "add-device" | "another-account";

/** Disconnect's act (TS-D14): in flight, or the daemon's refusal of it. */
export type DisconnectStep =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "failed"; reason: string };

/** One device, as the quiet rows draw it: an OS mark, the name, one word. */
export interface DevicesRow {
  readonly id: string;
  readonly name: string;
  readonly os: MonitorDeviceFacet["os"];
  readonly self: boolean;
  readonly online: boolean;
}

export interface DevicesSectionViewProps {
  face: LinkFace;
  /** the door's act in flight, or the daemon's refusal of it */
  step: LinkBeginStep;
  disconnect: DisconnectStep;
  sheet: DevicesSheet;
  /** this Mac first, then the account's other devices */
  devices: readonly DevicesRow[];
  platform: string | undefined;
  /** ms since the epoch, for the renewal's date */
  now: number;
  /** the posture's cards (controller-owned; absent in the catalog) */
  newProjects?: ReactNode;
  /** today's mesh diagnostics (controller-owned; absent in the catalog) */
  networkDetails?: ReactNode;
  onBegin: () => void;
  onCancel: () => void;
  onRenew: () => void;
  onOpenAgain: () => void;
  onCopyLink: () => Promise<boolean>;
  onCopyText: (text: string) => Promise<boolean>;
  /** "Use another account" on a refusal: unlink first, then sign in afresh */
  onStartOver: () => void;
  onSheet: (sheet: DevicesSheet) => void;
  onDisconnect: () => void;
  /** TS-D12 — a second account is a second user; absent where none can be made */
  onNewUser?: (() => void) | undefined;
}

/** "2 Nov": the renewal's day, in the person's own calendar words. */
function dueDay(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** A button that says it worked, for two seconds, in its own words. */
function CopyButton({
  label,
  copy,
}: {
  label: string;
  copy: () => Promise<boolean>;
}): ReactElement {
  const [done, setDone] = useState<null | boolean>(null);
  useEffect(() => {
    if (done === null) return;
    const timer = setTimeout(() => setDone(null), 2000);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <button type="button" className={buttonCls} onClick={() => void copy().then(setDone)}>
      {done === true ? "Copied" : done === false ? "Couldn't copy" : label}
    </button>
  );
}

function Refusal({ reason }: { reason: string }): ReactElement {
  return (
    <div className="text-right text-[12px] text-amber-600 dark:text-amber-400" role="alert">
      {reason}
    </div>
  );
}

/** The card's state word: green when connected, muted when this Mac is alone,
 * the attention ink for every state that asks something of the person. */
function stateWord(
  face: LinkFace,
  platform: string | undefined,
): {
  word: string;
  tone: "healthy" | "muted" | "attention" | "plain";
} {
  switch (face.kind) {
    case "linked":
      return { word: "Connected", tone: "healthy" };
    case "offline":
      return { word: unlinkedWord(platform), tone: "muted" };
    case "capturing":
      return {
        word: face.authUrl === null ? LINK_ACT_PENDING_LABEL : "Signing in…",
        tone: "plain",
      };
    case "approval":
      return { word: "Waiting for approval", tone: "attention" };
    case "signedOut":
      return {
        word: face.reason === "removed" ? "Removed from Tailscale" : "Sign-in expired",
        tone: "attention",
      };
    case "refused":
      return { word: face.title, tone: "attention" };
    case "loading":
      return { word: "", tone: "muted" };
    case "unavailable":
      return { word: "Unavailable", tone: "muted" };
  }
}

function TailscaleCard(props: DevicesSectionViewProps): ReactElement {
  const { face, step, platform } = props;
  const { word, tone } = stateWord(face, platform);
  let body: ReactElement;
  if (face.kind === "loading") {
    body = <div className={labelCls}>Reading link status…</div>;
  } else if (face.kind === "unavailable") {
    body = (
      <div className={labelCls}>
        This daemon does not report link status. Everything local keeps working.
      </div>
    );
  } else if (face.kind === "offline") {
    body = (
      <>
        <div className={labelCls}>
          Connect to reach this field from your phone and your other computers. Everything local
          keeps working.
        </div>
        <div className="vf-devices-acts">
          {step.kind === "failed" && <Refusal reason={step.reason} />}
          <button
            type="button"
            className={buttonCls}
            disabled={step.kind === "pending"}
            onClick={props.onBegin}
          >
            {step.kind === "pending" ? LINK_ACT_PENDING_LABEL : LINK_ACT_LABEL}
          </button>
        </div>
      </>
    );
  } else if (face.kind === "refused") {
    // The daemon's own sentence, verbatim: it names the file or the other local
    // user. A refused capture kept its keys, so another account starts over.
    body = (
      <>
        <div className={labelCls}>{face.detail}</div>
        <div className="vf-devices-acts">
          {step.kind === "failed" && <Refusal reason={step.reason} />}
          {face.canBegin ? (
            <button type="button" className={buttonCls} onClick={props.onStartOver}>
              Use another account
            </button>
          ) : (
            <span className={labelCls}>Connecting is refused until that file is moved aside.</span>
          )}
        </div>
      </>
    );
  } else if (face.kind === "capturing") {
    body =
      face.authUrl === null ? (
        <>
          <div className={labelCls}>
            {face.failure === "sidecar_missing"
              ? "VibeField's network part is missing. Reinstall VibeField to connect; everything local keeps working."
              : "The sign-in opens in your browser as soon as Tailscale has its address."}
          </div>
          <div className="vf-devices-acts">
            <button type="button" className={buttonCls} onClick={props.onCancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={labelCls}>
            Finish signing in in your browser.
            {face.machineName !== null && (
              <>
                {" "}
                Tailscale will ask to connect <span className="vf-ui-mono">{face.machineName}</span>
                . That's this Mac.
              </>
            )}
          </div>
          <div className="vf-devices-acts">
            <button type="button" className={buttonCls} onClick={props.onOpenAgain}>
              Open again
            </button>
            <CopyButton label="Copy link" copy={props.onCopyLink} />
            <button type="button" className={buttonCls} onClick={props.onCancel}>
              Cancel
            </button>
          </div>
        </>
      );
  } else if (face.kind === "approval") {
    body = (
      <>
        <div className={labelCls}>
          An admin approves new devices on this network.
          {face.machineName !== null && (
            <>
              {" "}
              This Mac shows as <span className="vf-ui-mono">{face.machineName}</span>.
            </>
          )}
        </div>
        <div className="vf-devices-acts">
          {face.adminUrl !== null && (
            <a className={buttonCls} href={face.adminUrl} target="_blank" rel="noreferrer">
              Open the admin console ↗
            </a>
          )}
          {face.link === null && (
            <button type="button" className={buttonCls} onClick={props.onCancel}>
              Cancel
            </button>
          )}
        </div>
      </>
    );
  } else if (face.kind === "signedOut") {
    body = (
      <>
        <div className="vf-ui-mono">{face.link.login ?? "your account"}</div>
        <div className={labelCls}>
          {face.reason === "removed"
            ? "This Mac was removed from your network. Connecting again adds it as a new device."
            : "Your other devices can't reach this Mac until you sign in again. Nothing here is lost."}
        </div>
        <div className="vf-devices-acts">
          {step.kind === "failed" && <Refusal reason={step.reason} />}
          <button
            type="button"
            className={buttonCls}
            disabled={step.kind === "pending"}
            onClick={face.authUrl !== null ? props.onOpenAgain : props.onRenew}
          >
            {face.reason === "removed" ? "Connect again" : "Sign in again"}
          </button>
        </div>
      </>
    );
  } else {
    const link = face.link;
    body = (
      <>
        <div>
          <span className="vf-ui-mono">{link.login ?? "learning the login…"}</span>
          {link.tailnet !== undefined && <span className={labelCls}> · {link.tailnet}</span>}
        </div>
        <div className="vf-devices-acts">
          <a
            className={buttonCls}
            href={face.adminUrl ?? HOSTED_MACHINES_URL}
            target="_blank"
            rel="noreferrer"
          >
            Manage in Tailscale ↗
          </a>
          <button
            type="button"
            className={buttonCls}
            onClick={() => props.onSheet("another-account")}
          >
            Use another account
          </button>
          <button
            type="button"
            className={`${buttonCls} text-[var(--vf-red)]`}
            onClick={() => props.onSheet("disconnect")}
          >
            Disconnect…
          </button>
        </div>
      </>
    );
  }
  return (
    <SettingsSection title="Tailscale" description="Your devices, privately, by Tailscale.">
      <div className="vf-devices-card">
        <TailscaleMark />
        <div className="vf-devices-card-body">
          {word.length > 0 && (
            <div className="vf-devices-state" data-tone={tone}>
              {word}
            </div>
          )}
          {body}
        </div>
      </div>
    </SettingsSection>
  );
}

/** This Mac: its name, the name Tailscale shows with Copy, and the sign-in's
 * renewal (TS-D9: a date; the attention ink and Sign in again once due). */
function ThisMac(props: DevicesSectionViewProps): ReactElement | null {
  const { face } = props;
  if (face.kind !== "linked" && face.kind !== "signedOut") return null;
  const self = props.devices.find((device) => device.self);
  const expiresAt = face.kind === "linked" ? face.keyExpiresAt : undefined;
  const days = renewalDays(expiresAt, props.now);
  const due = face.kind === "signedOut" || (days !== null && days <= 0);
  return (
    <SettingsSection title="This Mac">
      <div className="vf-devices-facts">
        <span className={labelCls}>Name</span>
        <span>{self?.name ?? "This Mac"}</span>
        {face.machineName !== null && (
          <>
            <span className={labelCls}>In Tailscale</span>
            <span className="vf-devices-fact-act">
              <span className="vf-ui-mono">{face.machineName}</span>
              <CopyButton label="Copy" copy={() => props.onCopyText(face.machineName ?? "")} />
            </span>
          </>
        )}
        {expiresAt !== undefined && (
          <>
            <span className={labelCls}>Sign-in</span>
            <span
              className="vf-devices-fact-act"
              data-tone={
                due || (days !== null && days <= RENEWAL_WARN_DAYS) ? "attention" : undefined
              }
            >
              {expiresAt === null ? "Never expires" : `Due by ${dueDay(expiresAt)}`}
              {due && (
                <button type="button" className={buttonCls} onClick={props.onRenew}>
                  Sign in again
                </button>
              )}
            </span>
          </>
        )}
      </div>
    </SettingsSection>
  );
}

function YourDevices(props: DevicesSectionViewProps): ReactElement {
  const linked = props.face.kind === "linked";
  const rows =
    props.devices.length > 0
      ? props.devices
      : [{ id: "self", name: "This Mac", os: osOf(props.platform), self: true, online: true }];
  return (
    <SettingsSection title="Your devices">
      <ul className="vf-devices-rows">
        {rows.map((device) => (
          <li key={device.id} className="vf-devices-row" data-self={device.self ? "" : undefined}>
            <OsMark os={device.os} size={16} />
            <span className="vf-devices-row-name">{device.name}</span>
            <span className={labelCls}>
              {device.self ? "This Mac" : device.online ? "Online" : "Away"}
            </span>
          </li>
        ))}
      </ul>
      {linked ? (
        <div className="vf-devices-acts">
          <button type="button" className={buttonCls} onClick={() => props.onSheet("add-device")}>
            Add a device
          </button>
        </div>
      ) : (
        <div className={labelCls}>Connect to see your other devices here.</div>
      )}
    </SettingsSection>
  );
}

/** The sheets (DESIGN.md §8), in place under the card; Esc closes them. */
function Sheet(props: DevicesSectionViewProps): ReactElement | null {
  const { sheet, onSheet } = props;
  const [kind, setKind] = useState<"phone" | "computer">("phone");
  useEffect(() => {
    if (sheet === "none") return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onSheet("none");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, onSheet]);
  if (sheet === "none") return null;
  const login = props.face.kind === "linked" ? (props.face.link.login ?? "your account") : null;
  if (sheet === "disconnect") {
    // TS-D14 — Disconnect signs out at Tailscale, then archives. Until truffle
    // can sign out (petition T9), it archives and names where the record stays.
    const busy = props.disconnect.kind === "pending";
    return (
      <SettingsSection title="Disconnect this Mac?">
        <div className={labelCls}>
          This Mac leaves your devices: your phone and other computers stop reaching this field, and
          everything on this Mac stays. VibeField can't sign this Mac out of Tailscale yet, so it
          stays listed in your admin console until you remove it there.
        </div>
        <div className="vf-devices-acts">
          {props.disconnect.kind === "failed" && <Refusal reason={props.disconnect.reason} />}
          <button
            type="button"
            className={buttonCls}
            disabled={busy}
            onClick={() => onSheet("none")}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${buttonCls} text-[var(--vf-red)]`}
            disabled={busy}
            onClick={props.onDisconnect}
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </SettingsSection>
    );
  }
  if (sheet === "add-device") {
    return (
      <SettingsSection title="Add a device">
        <div className="vf-devices-kind">
          <SegmentedControl
            options={["Phone", "Computer"] as const}
            value={kind === "phone" ? "Phone" : "Computer"}
            onChange={(label) => setKind(label === "Phone" ? "phone" : "computer")}
            label="Device kind"
          />
        </div>
        <div className={labelCls}>
          {kind === "phone"
            ? `On your iPhone, open VibeField and Continue with Tailscale, signing in as ${login ?? "this account"}. It finds this Mac on its own.`
            : `On your other computer, install VibeField and Continue with Tailscale, signing in as ${login ?? "this account"}. It joins your devices here.`}
        </div>
        <div className="vf-devices-acts">
          <button type="button" className={buttonCls} onClick={() => onSheet("none")}>
            Done
          </button>
        </div>
      </SettingsSection>
    );
  }
  // TS-D12 — another account is another user: each has its own field.
  return (
    <SettingsSection title="Use another account">
      <div className={labelCls}>
        A second Tailscale account is a second user on this Mac, with its own field and its own
        devices.
      </div>
      <div className="vf-devices-acts">
        <button type="button" className={buttonCls} onClick={() => onSheet("none")}>
          Cancel
        </button>
        {props.onNewUser !== undefined && (
          <button type="button" className={buttonCls} onClick={props.onNewUser}>
            New user…
          </button>
        )}
      </div>
    </SettingsSection>
  );
}

export function DevicesSectionView(props: DevicesSectionViewProps): ReactElement {
  return (
    <div className="space-y-4">
      <TailscaleCard {...props} />
      <Sheet {...props} />
      <ThisMac {...props} />
      <YourDevices {...props} />
      {props.newProjects}
      {props.networkDetails !== undefined && (
        <details className="vf-devices-details">
          <summary className={labelCls}>Network details</summary>
          {props.networkDetails}
        </details>
      )}
    </div>
  );
}

/** The roster rows the page reads (`DeviceInfo`): self ⋈ the account's peers. */
function rowsOf(roster: readonly DeviceInfo[] | null): DevicesRow[] {
  const rows = (roster ?? []).map((device) => ({
    id: device.deviceId,
    name: device.name,
    os: osOf(device.platform),
    self: device.self,
    online: device.online,
  }));
  return rows.sort((a, b) => Number(b.self) - Number(a.self));
}

export function DevicesSection({
  onSettingsChanged,
}: {
  onSettingsChanged?: ((undoable: boolean) => void) | undefined;
} = {}): ReactElement {
  const client = useFielddClient();
  const door = useLinkDoor();
  const roster = useSubscription<DeviceInfo[]>("device.subscribe");
  const account = useAccountSnapshot();
  const host = getHost();
  const [sheet, setSheet] = useState<DevicesSheet>("none");
  const [disconnect, setDisconnect] = useState<DisconnectStep>({ kind: "idle" });

  const onDisconnect = (): void => {
    setDisconnect({ kind: "pending" });
    void client.request("user.link.unlink", {}).then(
      () => {
        setDisconnect({ kind: "idle" });
        setSheet("none");
      },
      (cause: unknown) =>
        setDisconnect({
          kind: "failed",
          reason: cause instanceof Error ? cause.message : String(cause),
        }),
    );
  };
  const usersCreate = host.usersCreate;
  const onNewUser =
    account.canCreate && usersCreate !== undefined
      ? () => void leaveFor(null, null, () => usersCreate({})).catch(() => undefined)
      : undefined;

  return (
    <DevicesSectionView
      face={door.face}
      step={door.step}
      disconnect={disconnect}
      sheet={sheet}
      devices={rowsOf(roster.data)}
      platform={host.platform}
      now={Date.now()}
      newProjects={<NewProjectsSection onSettingsChanged={onSettingsChanged} />}
      networkDetails={<MeshSection />}
      onBegin={() => void door.begin()}
      onCancel={() => void door.cancel()}
      onRenew={() => void door.renew()}
      onOpenAgain={door.openAgain}
      onCopyLink={door.copyLink}
      onCopyText={async (text) => {
        try {
          await copyText(text);
          return true;
        } catch {
          return false;
        }
      }}
      onStartOver={() => void door.startOver()}
      onSheet={(next) => {
        setDisconnect({ kind: "idle" });
        setSheet(next);
      }}
      onDisconnect={onDisconnect}
      onNewUser={onNewUser}
    />
  );
}

/** New projects (moved from Account, TS-D3): what a new project does by
 * default — the posture's two cards, the same ones the Setup Assistant asks. */
function NewProjectsSection({
  onSettingsChanged,
}: {
  // Explicitly `| undefined`: under `exactOptionalPropertyTypes` a forwarded
  // optional prop is a value that may BE undefined, not an absent one.
  onSettingsChanged?: ((undoable: boolean) => void) | undefined;
}): ReactElement {
  const posture = useSyncPosture();
  const locked = posture.unavailable || posture.pending;

  return (
    <SettingsSection
      title="New projects"
      description="What a new document does by default. You can change any single document afterwards."
    >
      <div role="radiogroup" aria-label="Sync posture" className="grid gap-2 sm:grid-cols-2">
        {POSTURE_CHOICES.map((card) => {
          const selected = posture.posture === card.value;
          return (
            <label
              key={card.value}
              className={`rounded-[14px] border p-3 text-left transition-[background-color,border-color,transform] focus-within:ring-2 focus-within:ring-black/15 dark:focus-within:ring-white/20 ${
                selected
                  ? "border-black/25 bg-black/[0.04] dark:border-white/30 dark:bg-white/[0.08]"
                  : "border-black/10 hover:bg-black/[0.02] dark:border-white/10 dark:hover:bg-white/[0.04]"
              } ${locked ? "cursor-not-allowed opacity-45" : "cursor-pointer active:scale-[0.99]"}`}
            >
              <input
                type="radio"
                name="vf-sync-posture"
                className="sr-only"
                checked={selected}
                disabled={locked}
                onChange={() => {
                  void posture.set(card.value).then((landed) => {
                    if (landed) onSettingsChanged?.(true);
                  });
                }}
              />
              <div className="text-[13px] font-medium leading-5 text-black/80 dark:text-white/80">
                {card.title}
              </div>
              <div className={`mt-0.5 ${labelCls}`}>{card.description}</div>
            </label>
          );
        })}
      </div>
      {posture.status === "loading" && (
        <div className={`pt-2 ${labelCls}`}>Loading preferences…</div>
      )}
      {posture.status === "error" && (
        <div className="pt-2 text-[12px] text-amber-600 dark:text-amber-400">
          Preferences unavailable.
        </div>
      )}
      {posture.writeError !== null && (
        <div className="pt-2 text-[12px] text-amber-600 dark:text-amber-400">
          {posture.writeError}
        </div>
      )}
    </SettingsSection>
  );
}
