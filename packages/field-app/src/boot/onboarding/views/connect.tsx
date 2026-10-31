import { type ReactElement, useEffect, useRef, useState } from "react";
import { AddPhoneCode } from "../../../account/door/add-phone-code";
import {
  Constellation,
  type DoorDevice,
  PartnerLine,
  WaitingSteps,
  WhatVibeFieldCanSee,
} from "../../../account/door/door-parts";
import { SignInQr } from "../../../account/door/sign-in-qr";
import {
  LINK_ACT_LABEL,
  LINK_ACT_PENDING_LABEL,
  type LinkBeginStep,
  type LinkFace,
  unlinkedWord,
} from "../../../account/link";
import { CopyButton } from "../../../frame/cards/CopyButton";
import type { DealFrom } from "../../../frame/cards/cards-store";
import type { FieldUserFace } from "../../../host";
import {
  BackAction,
  factCls,
  primaryCls,
  quietCls,
  SkipAction,
  voiceCls,
  WizardError,
  WizardPane,
} from "../wizard-ui";

// The Connect pane (DESIGN.md §8 "The Connect pane"; track TS, TS-D1…D8,
// D12, D13 ruled 2026-10-27). One pane whose faces follow the link: ask (the
// payoff, the partner line, one act), opening, waiting (two true steps and four
// exits), approval, arrival, the refusals re-voiced, and other ways in. The
// machinery is the shared door (account/use-link-door.ts); this file draws it
// in the wizard's glass and keeps the shell's height (nothing here grows it:
// "What VibeField can see" and the phone's code REPLACE the constellation).

/** What the pane shows in place of the constellation, chosen by the person. */
export type ConnectAside = "constellation" | "why" | "other" | "phone" | "key";

/** The person at the constellation's centre: their face, and the seed it is
 * drawn from. All the pane needs of who is connecting. */
export type ConnectMe = { readonly face: FieldUserFace; readonly seed: string };

export interface ConnectPaneProps {
  face: LinkFace;
  step: LinkBeginStep;
  /** the person, at the constellation's centre */
  me: ConnectMe;
  /** this account's devices (DeviceService), for the arrival; [] before it */
  devices: readonly DoorDevice[];
  /** the shell's platform, for the words "This Mac" / "This PC" */
  platform?: string | undefined;
  /** the controller's word that the address has not come for a while (no internet?) */
  slow?: boolean;
  /** catalog fixtures choose a panel; the pane starts on the constellation */
  initialAside?: ConnectAside;
  onBegin: (options?: { authKey?: string; browser?: boolean }) => void;
  /** A signed-out link signs in again on its own identity (its key lapsed, or
   * it was removed): `user.link.renew`, never a second begin. */
  onRenew: () => void;
  /** TS-D16 — Send logs on this network: the door's act, for a standing link
   * and for a capture the network refused alike. */
  onSendLogs: () => void;
  onCancel: () => void;
  onOpenAgain: () => void;
  /** HN-5 — a copy deals a card from the button pressed: `from` is its box, under the glass */
  onCopyLink: (from: DealFrom | null) => Promise<boolean>;
  /** "Copy a request for your admin": the machine and the console, as text */
  onCopyText: (text: string, from: DealFrom | null) => Promise<boolean>;
  /** "Not this account? Sign in again" and "Use another account": leave this
   * sign-in (unlink archives its identity, so the next sign-in can choose any
   * account — a capture waiting on approval comes back to the same network
   * otherwise), then sign in afresh. */
  onSignInAgain: () => void;
  /** TS-D12 — a second account is a second user. Absent: no door to offer. */
  onNewUser?: (() => void) | undefined;
  onContinue: () => void;
  /** Not now: the same Ready pane; the face menu keeps the row (§8). */
  onSkip: () => void;
  /** Esc is Not now on the ask — in the Setup Assistant (§8: "Not now (esc)").
   * A host whose own Escape means something else (Finish setting up's sheet
   * closes on it) leaves it off. */
  escapeIsNotNow?: boolean;
  onBack: (() => void) | undefined;
}

const REASONS = [
  "Answer your agents from your phone",
  "Open sessions running on your other computers",
  "Keep documents in step across your desks",
] as const;

function Reasons(): ReactElement {
  return (
    <ul className="flex flex-col gap-1.5">
      {REASONS.map((reason) => (
        <li key={reason} className={voiceCls}>
          {reason}
        </li>
      ))}
    </ul>
  );
}

export function OnboardingConnectPaneView(props: ConnectPaneProps): ReactElement {
  const { face, step, me, devices, platform, slow = false, onBack } = props;
  const [aside, setAside] = useState<ConnectAside>(props.initialAside ?? "constellation");
  const [key, setKey] = useState("");
  const thisMac = unlinkedWord(platform).replace(/ only$/, "");

  // the ask's ghosts: This Mac, and what connecting would bring
  const ghosts: DoorDevice[] = [
    { id: "self", name: thisMac, os: platform === "win32" ? "windows" : "macos", self: true },
    { id: "ghost-phone", name: "Your phone", os: "macos", ghost: true },
    { id: "ghost-desk", name: "Another computer", os: "unknown", ghost: true },
  ];

  // Esc is Not now on the ask, where the host asks for it (§8: "Not now
  // (esc)"); the listener reads the latest callback, so it is bound once per
  // face and panel, not per render
  const skip = useRef(props.onSkip);
  skip.current = props.onSkip;
  useEffect(() => {
    if (props.escapeIsNotNow !== true || face.kind !== "offline" || aside !== "constellation")
      return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") skip.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.escapeIsNotNow, face.kind, aside]);

  const asideBody = (fallback: ReactElement): ReactElement => {
    switch (aside) {
      case "why":
        return <WhatVibeFieldCanSee />;
      case "other":
        return (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className={quietCls}
              onClick={() => {
                setAside("phone");
                props.onBegin({ browser: false });
              }}
            >
              Sign in on your phone
            </button>
            <button type="button" className={quietCls} onClick={() => setAside("key")}>
              Use an auth key
            </button>
            <p className={factCls}>
              An auth key is for a Mac with no browser: make one in the admin console under Settings
              → Keys, untagged. It is used once and never stored.
            </p>
          </div>
        );
      case "key":
        return (
          <div className="flex flex-col gap-2">
            <input
              type="password"
              aria-label="Tailscale auth key"
              autoComplete="off"
              spellCheck={false}
              placeholder="tskey-auth-…"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              className="h-10 rounded-[12px] border border-black/10 bg-white px-3.5 font-mono text-[13px] text-black/85 outline-none focus:border-black/25 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/90"
            />
            <button
              type="button"
              className={primaryCls}
              disabled={key.trim().length === 0 || step.kind === "pending"}
              onClick={() => props.onBegin({ authKey: key.trim() })}
            >
              Sign in with the key
            </button>
          </div>
        );
      default:
        return fallback;
    }
  };

  const whyLink =
    aside === "why" ? (
      <button
        type="button"
        className={`${factCls} self-start underline`}
        onClick={() => setAside("constellation")}
      >
        Back to your devices
      </button>
    ) : (
      <button
        type="button"
        className={`${factCls} self-start underline`}
        onClick={() => setAside("why")}
      >
        What VibeField can see
      </button>
    );

  switch (face.kind) {
    case "loading":
    case "unavailable":
      return (
        <WizardPane
          eyebrow="Your devices"
          title="Your field, on every device."
          onSubmit={props.onContinue}
          actions={
            <>
              <button type="submit" className={primaryCls}>
                Continue
              </button>
              <BackAction onBack={onBack} />
            </>
          }
        >
          <p className={factCls}>
            {face.kind === "loading"
              ? "Asking this Mac about its link…"
              : "This daemon does not report link status, so there is nothing to connect from here. Everything local keeps working."}
          </p>
        </WizardPane>
      );

    case "offline":
    case "refused": {
      const refusal = face.kind === "refused" ? face : null;
      const title =
        refusal === null
          ? "Your field, on every device."
          : refusal.state === "login_already_linked"
            ? "That account already has a field here."
            : refusal.state === "login_unavailable"
              ? "That sign-in can't own this Mac."
              : "This Mac's link record is damaged.";
      const canBegin = refusal === null || refusal.canBegin;
      return (
        <WizardPane
          eyebrow="Your devices"
          title={title}
          onSubmit={() => {
            // a refused sign-in kept its identity, so asking again with it lands
            // on the same account: "Use another account" starts over
            if (refusal === null) props.onBegin();
            else if (canBegin) props.onSignInAgain();
          }}
          actions={
            <>
              {canBegin && (
                <button type="submit" className={primaryCls} disabled={step.kind === "pending"}>
                  {step.kind === "pending"
                    ? LINK_ACT_PENDING_LABEL
                    : refusal === null
                      ? LINK_ACT_LABEL
                      : "Use another account"}
                </button>
              )}
              {refusal?.state === "login_already_linked" && props.onNewUser !== undefined && (
                <button type="button" className={quietCls} onClick={props.onNewUser}>
                  New user…
                </button>
              )}
              {refusal?.state === "link_corrupt" && (
                <CopyButton
                  label="Copy path"
                  copy={(from) => props.onCopyText(refusal.detail, from)}
                  className={quietCls}
                />
              )}
              <SkipAction label="Not now" onSkip={props.onSkip} />
              {refusal === null && aside === "constellation" && (
                <button type="button" className={quietCls} onClick={() => setAside("other")}>
                  Other ways to sign in
                </button>
              )}
              <BackAction onBack={onBack} />
            </>
          }
        >
          {refusal === null ? (
            <>
              <div className="grid grid-cols-[1fr_1.1fr] items-center gap-4">
                {asideBody(<Constellation face={me.face} seed={me.seed} devices={ghosts} />)}
                <Reasons />
              </div>
              {whyLink}
              <PartnerLine />
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className={voiceCls}>
                {refusal.state === "login_already_linked"
                  ? "Each Tailscale account belongs to one user on this Mac. Sign in with another account, or add a user for this one."
                  : refusal.state === "login_unavailable"
                    ? "It made a tagged device, which belongs to no one. VibeField connects devices that belong to you."
                    : "VibeField won't guess an identity. Move the file aside to connect again."}
              </p>
              <p className={`${factCls} break-all`}>{refusal.detail}</p>
            </div>
          )}
          {step.kind === "failed" && <WizardError reason={step.reason} />}
        </WizardPane>
      );
    }

    case "capturing": {
      if (face.failure === "sidecar_missing") {
        return (
          <WizardPane
            eyebrow="Your devices"
            title="VibeField's network part is missing."
            voice="Reinstall VibeField to connect. Everything local keeps working."
            onSubmit={props.onSkip}
            actions={
              <>
                <button type="submit" className={primaryCls}>
                  Not now
                </button>
                <button type="button" className={quietCls} onClick={props.onCancel}>
                  Cancel
                </button>
              </>
            }
          />
        );
      }
      const opening = face.authUrl === null;
      return (
        <WizardPane
          eyebrow="Your devices"
          title={opening ? LINK_ACT_PENDING_LABEL : "Finish in your browser."}
          voice={
            opening
              ? slow
                ? "Still waiting for Tailscale. Check this Mac's internet connection; VibeField keeps trying."
                : undefined
              : "Tailscale opened in your browser. This pane follows on its own."
          }
          onSubmit={props.onOpenAgain}
          actions={
            <>
              {!opening && (
                <button type="submit" className={primaryCls}>
                  Open again
                </button>
              )}
              {!opening && (
                <CopyButton label="Copy link" copy={props.onCopyLink} className={quietCls} />
              )}
              {!opening && aside !== "phone" && (
                <button type="button" className={quietCls} onClick={() => setAside("phone")}>
                  Sign in on your phone
                </button>
              )}
              <button type="button" className={quietCls} onClick={props.onCancel}>
                Cancel
              </button>
            </>
          }
        >
          {aside === "phone" && face.authUrl !== null ? (
            <div className="flex items-center gap-4">
              <SignInQr text={face.authUrl} label="Scan to sign in on your phone" />
              <p className={factCls}>
                Scan with your phone's camera, then sign in there. This Mac completes on its own.
              </p>
            </div>
          ) : (
            <WaitingSteps live="sign-in" />
          )}
          {face.machineName !== null && (
            <p className={factCls}>
              Tailscale will ask to connect <span className="font-mono">{face.machineName}</span>.
              That's this Mac.
            </p>
          )}
        </WizardPane>
      );
    }

    case "approval": {
      const machine = face.machineName ?? "this Mac";
      const request = `Please approve ${machine} in the Tailscale admin console${
        face.adminUrl !== null ? `: ${face.adminUrl}` : "."
      }`;
      return (
        <WizardPane
          eyebrow="Your devices"
          title="Waiting for approval."
          voice={
            <>
              An admin approves new devices on this network. This Mac shows as{" "}
              <span className="font-mono">{machine}</span>.
            </>
          }
          onSubmit={props.onContinue}
          actions={
            <>
              <button type="submit" className={primaryCls}>
                Tell me when it's approved
              </button>
              <CopyButton
                label="Copy a request for your admin"
                copy={(from) => props.onCopyText(request, from)}
                className={quietCls}
              />
              <button type="button" className={quietCls} onClick={props.onSignInAgain}>
                Use another account
              </button>
            </>
          }
        >
          <WaitingSteps live="join" />
          {face.adminUrl !== null && (
            <a
              className={`${factCls} self-start underline`}
              href={face.adminUrl}
              target="_blank"
              rel="noreferrer"
            >
              Admin? Approve it in the console ↗
            </a>
          )}
        </WizardPane>
      );
    }

    case "logsRequired":
      // TS-D16 — a network that requires device logs keeps this Mac out until the
      // person sends them on this network; Not now leaves it (DESIGN.md §9)
      return (
        <WizardPane
          eyebrow="Your devices"
          title="Your network requires device logs."
          voice="Your Tailscale network's admin turned on network logging, which needs every device to send its logs to Tailscale. VibeField sends none, so this Mac can't join this network."
          onSubmit={props.onSendLogs}
          actions={
            <>
              <button type="submit" className={primaryCls} disabled={step.kind === "pending"}>
                Send logs on this network
              </button>
              {face.adminUrl !== null && (
                <a className={quietCls} href={face.adminUrl} target="_blank" rel="noreferrer">
                  Manage in Tailscale ↗
                </a>
              )}
              <SkipAction label="Not now" onSkip={props.onSkip} />
            </>
          }
        >
          {step.kind === "failed" && <WizardError reason={step.reason} />}
        </WizardPane>
      );

    case "linked": {
      if (face.needsSignature) {
        // T11 — up, but Tailnet Lock holds this Mac until a signing device signs
        // it: the signer finds it by the name Tailscale shows (DESIGN.md §9)
        const machine = face.machineName;
        return (
          <WizardPane
            eyebrow="Your devices"
            title="Connected, not yet trusted."
            voice="Your network uses Tailnet Lock. Until a device that can sign trusts this Mac, it can't reach your other devices, and they can't reach it."
            onSubmit={props.onContinue}
            actions={
              <>
                <button type="submit" className={primaryCls}>
                  Continue
                </button>
                {machine !== null && (
                  <CopyButton
                    label="Copy"
                    copy={(from) => props.onCopyText(machine, from)}
                    className={quietCls}
                  />
                )}
                {face.adminUrl !== null && (
                  <a className={quietCls} href={face.adminUrl} target="_blank" rel="noreferrer">
                    Manage in Tailscale ↗
                  </a>
                )}
              </>
            }
          >
            {machine !== null && (
              <p className={factCls}>
                This Mac shows as <span className="font-mono">{machine}</span>.
              </p>
            )}
          </WizardPane>
        );
      }
      const alone = devices.filter((device) => device.self !== true).length === 0;
      const arrived: readonly DoorDevice[] =
        devices.length > 0
          ? devices
          : [
              {
                id: "self",
                name: thisMac,
                os: platform === "win32" ? "windows" : "macos",
                self: true,
              },
            ];
      return (
        <WizardPane
          eyebrow="Your devices"
          title="Connected."
          voice={
            <>
              <span className="font-mono">{face.link.login ?? "your account"}</span>
              {face.link.tailnet !== undefined && <> · {face.link.tailnet}</>}
            </>
          }
          onSubmit={props.onContinue}
          actions={
            <>
              {alone && aside !== "phone" && (
                <button type="button" className={primaryCls} onClick={() => setAside("phone")}>
                  Add your phone
                </button>
              )}
              <button type="submit" className={alone && aside !== "phone" ? quietCls : primaryCls}>
                Continue
              </button>
              {!alone && aside !== "phone" && (
                <button type="button" className={quietCls} onClick={() => setAside("phone")}>
                  Add your phone
                </button>
              )}
            </>
          }
        >
          {aside === "phone" ? (
            // TS-7b — the code that tells the phone which account to expect, naming this Mac by the roster's
            // own name (the one the phone will show), else Tailscale's machine name
            <AddPhoneCode
              login={face.link.login}
              names={[devices.find((device) => device.self === true)?.name, face.machineName]}
              className={voiceCls}
            />
          ) : (
            <Constellation face={me.face} seed={me.seed} devices={arrived} arriving />
          )}
          <button
            type="button"
            className={`${factCls} self-start underline`}
            onClick={props.onSignInAgain}
          >
            Not this account? Sign in again
          </button>
        </WizardPane>
      );
    }

    case "signedOut":
      return (
        <WizardPane
          eyebrow="Your devices"
          title={
            face.reason === "removed"
              ? "This Mac was removed from your network."
              : "Sign in to Tailscale again."
          }
          voice={
            face.reason === "removed"
              ? "Someone removed it in the admin console. Connecting again adds it as a new device."
              : "Your phone and other computers can't reach this Mac until you do. Nothing here is lost."
          }
          onSubmit={props.onContinue}
          actions={
            <>
              <button type="button" className={primaryCls} onClick={props.onRenew}>
                {face.reason === "removed" ? "Connect again" : "Sign in again"}
              </button>
              <button type="submit" className={quietCls}>
                Continue
              </button>
            </>
          }
        />
      );
  }
}
