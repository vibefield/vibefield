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
  LATER_ON_DEVICES,
  primaryCls,
  quietCls,
  SkipAction,
  useWizardFrame,
  voiceCls,
  WizardError,
  WizardHold,
  WizardHoldOut,
  WizardPane,
  WizardStatus,
} from "../wizard-ui";

// The Connect pane (DESIGN.md §8 "The Connect pane"; track TS, TS-D1…D8,
// D12, D13 ruled 2026-10-27). One pane whose faces follow the link: ask (the
// payoff, the partner line, one act), opening, waiting (two true steps and four
// exits), approval, arrival, the refusals re-voiced, and other ways in. The
// machinery is the shared door (account/use-link-door.ts); this file draws it
// in the wizard's glass and keeps the shell's height (nothing here grows it:
// Privacy and alternate sign-in details use the full body, above the fixed footer).
// On the glass its two waits are loads (FG-L5, FG-4b): the link's read, and
// Tailscale opening — the logo and one line, with a way out after 6s.

/** The line while an auth key joins this Mac to its network (FG-4b): no
 * browser opens for a key. */
const JOINING_LABEL = "Joining your network…";

/** The controller's word that the address is slow, under the opening's line. */
const SLOW_NOTE =
  "Still waiting for Tailscale. Check this Mac's internet connection; VibeField keeps trying.";

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
  /** Esc is the pane's own — in the Setup Assistant: Not now on the ask (§8:
   * "Not now (esc)"), and Cancel from the start while Tailscale opens (FG-4b).
   * A host whose own Escape means something else (Finish setting up's sheet
   * closes on it) leaves it off. */
  escapeIsNotNow?: boolean;
  onBack: (() => void) | undefined;
}

const REASONS = [
  "Answer your agents from your phone",
  "Continue sessions on another computer",
  "Keep your documents in sync",
] as const;

function Reasons(): ReactElement {
  return (
    <ul className="vf-wizard-device-reasons">
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
  const frame = useWizardFrame();
  const [aside, setAside] = useState<ConnectAside>(props.initialAside ?? "constellation");
  const [key, setKey] = useState("");
  const detailPanel = useRef<HTMLElement>(null);
  const privacyLink = useRef<HTMLButtonElement>(null);
  const otherWaysLink = useRef<HTMLButtonElement>(null);
  const previousAside = useRef(aside);
  useEffect(() => {
    if (previousAside.current === aside) return;
    const returningTo = previousAside.current === "why" ? privacyLink : otherWaysLink;
    previousAside.current = aside;
    (aside === "constellation" ? returningTo.current : detailPanel.current)?.focus({
      preventScroll: true,
    });
  }, [aside]);
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

  // ...and Cancel while Tailscale opens, from the start, though its button
  // waits 6s under the line (FG-O7 (a))
  const cancel = useRef(props.onCancel);
  cancel.current = props.onCancel;
  const opening =
    face.kind === "capturing" && face.authUrl === null && face.failure !== "sidecar_missing";
  useEffect(() => {
    if (props.escapeIsNotNow !== true || !opening) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") cancel.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.escapeIsNotNow, opening]);

  const asideBody = (fallback: ReactElement): ReactElement => {
    switch (aside) {
      case "why":
        return <WhatVibeFieldCanSee />;
      case "other":
        return (
          <div className="vf-wizard-device-detail">
            <p className={voiceCls}>Use your phone, or connect with a Tailscale auth key.</p>
            <div className="vf-wizard-device-choices">
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
            </div>
            <p className={factCls}>
              For a computer without a browser, create an untagged auth key in the Tailscale admin
              console under Settings → Keys. VibeField uses it once and never stores it.
            </p>
          </div>
        );
      case "key":
        return (
          <div className="vf-wizard-device-detail">
            <p className={voiceCls}>
              Create an untagged auth key in the Tailscale admin console under Settings → Keys.
              VibeField uses it once and never stores it.
            </p>
            <label className="flex flex-col gap-2">
              <span className={factCls}>Tailscale auth key</span>
              <input
                type="password"
                aria-label="Tailscale auth key"
                autoComplete="off"
                spellCheck={false}
                placeholder="tskey-auth-…"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                className="vf-wizard-input font-mono"
              />
            </label>
          </div>
        );
      default:
        return fallback;
    }
  };

  const detailBack =
    aside !== "constellation" ? (
      <button
        type="button"
        className="vf-wizard-text-action"
        onClick={() => setAside("constellation")}
      >
        Back to your devices
      </button>
    ) : null;

  switch (face.kind) {
    case "loading":
    case "unavailable":
      if (face.kind === "loading" && frame === "glass") {
        // a read with no give-up of its own, so its way out shows once it runs long
        return (
          <WizardHold face="connect:asking">
            <WizardStatus line="Asking this Mac about its link…" />
            <WizardHoldOut>
              <button type="button" className={quietCls} onClick={props.onContinue}>
                Continue
              </button>
            </WizardHoldOut>
          </WizardHold>
        );
      }
      return (
        <WizardPane
          eyebrow="Your devices"
          track="ts"
          title="Your field, on every device."
          onSubmit={props.onContinue}
          back={<BackAction onBack={onBack} />}
          actions={
            <button type="submit" className={primaryCls}>
              Continue
            </button>
          }
        >
          <p className={factCls}>
            {face.kind === "loading"
              ? "Checking your device connection…"
              : "Device connections aren't available right now. You can keep working on this Mac and try again later in Settings → Devices."}
          </p>
        </WizardPane>
      );

    case "offline":
    case "refused": {
      const refusal = face.kind === "refused" ? face : null;
      const title =
        refusal === null
          ? aside === "why"
            ? "What VibeField can see."
            : aside === "other"
              ? "Choose how to connect."
              : aside === "key"
                ? "Connect with an auth key."
                : "Your field, on every device."
          : refusal.state === "login_already_linked"
            ? "That account already has a field here."
            : refusal.state === "login_unavailable"
              ? "That sign-in can't own this Mac."
              : "This Mac's link record is damaged.";
      const canBegin = refusal === null || refusal.canBegin;
      return (
        <WizardPane
          eyebrow="Your devices"
          track="ts"
          title={title}
          later={LATER_ON_DEVICES}
          back={<BackAction onBack={onBack} />}
          onSubmit={() => {
            // a refused sign-in kept its identity, so asking again with it lands
            // on the same account: "Use another account" starts over
            if (step.kind === "pending") return;
            if (refusal === null && aside === "key") {
              if (key.trim().length > 0) props.onBegin({ authKey: key.trim() });
            } else if (refusal === null) props.onBegin();
            else if (canBegin) props.onSignInAgain();
          }}
          actions={
            <>
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
              {canBegin && (
                <button
                  type="submit"
                  className={primaryCls}
                  disabled={
                    step.kind === "pending" ||
                    (refusal === null && aside === "key" && key.trim().length === 0)
                  }
                >
                  {step.kind === "pending"
                    ? LINK_ACT_PENDING_LABEL
                    : refusal !== null
                      ? "Use another account"
                      : aside === "key"
                        ? "Connect with auth key"
                        : LINK_ACT_LABEL}
                </button>
              )}
            </>
          }
        >
          {refusal === null ? (
            aside === "constellation" ? (
              <>
                <div className="vf-wizard-device-overview">
                  <Constellation face={me.face} seed={me.seed} devices={ghosts} />
                  <Reasons />
                </div>
                <div className="vf-wizard-device-links">
                  <button
                    ref={privacyLink}
                    type="button"
                    className="vf-wizard-text-action"
                    onClick={() => setAside("why")}
                  >
                    What VibeField can see
                  </button>
                  <button
                    ref={otherWaysLink}
                    type="button"
                    className="vf-wizard-text-action"
                    onClick={() => setAside("other")}
                  >
                    Other ways to sign in
                  </button>
                </div>
                <PartnerLine compact />
              </>
            ) : (
              <section
                ref={detailPanel}
                tabIndex={-1}
                aria-label={title}
                className="vf-wizard-device-detail"
              >
                {asideBody(<Constellation face={me.face} seed={me.seed} devices={ghosts} />)}
                {detailBack}
              </section>
            )
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
            track="ts"
            title="VibeField's network part is missing."
            voice="Reinstall VibeField to connect. Everything local keeps working."
            onSubmit={props.onSkip}
            back={
              <button type="button" className={quietCls} onClick={props.onCancel}>
                Cancel
              </button>
            }
            actions={
              <button type="submit" className={primaryCls}>
                Not now
              </button>
            }
          />
        );
      }
      if (opening && frame === "glass") {
        // Esc cancels from the start (above); the button waits for the load to run long
        return (
          <WizardHold face="connect:opening">
            <WizardStatus
              line={aside === "key" ? JOINING_LABEL : LINK_ACT_PENDING_LABEL}
              sub={slow ? SLOW_NOTE : undefined}
            />
            <WizardHoldOut>
              <button type="button" className={quietCls} onClick={props.onCancel}>
                Cancel
              </button>
            </WizardHoldOut>
          </WizardHold>
        );
      }
      return (
        <WizardPane
          eyebrow="Your devices"
          track="ts"
          title={opening ? LINK_ACT_PENDING_LABEL : "Finish in your browser."}
          voice={
            opening
              ? slow
                ? SLOW_NOTE
                : undefined
              : "Sign in to Tailscale in your browser. Setup will continue here automatically."
          }
          onSubmit={props.onOpenAgain}
          back={
            <button type="button" className={quietCls} onClick={props.onCancel}>
              Cancel
            </button>
          }
          actions={
            <>
              {!opening && (
                <CopyButton label="Copy link" copy={props.onCopyLink} className={quietCls} />
              )}
              {!opening && (
                <button type="submit" className={primaryCls}>
                  Open again
                </button>
              )}
            </>
          }
        >
          {aside === "phone" && face.authUrl !== null ? (
            <div className="flex items-center gap-4">
              <SignInQr text={face.authUrl} label="Scan to sign in on your phone" />
              <p className={factCls}>
                Scan with your phone's camera and sign in. Setup will continue here automatically.
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
          {!opening && aside !== "phone" && (
            <button
              type="button"
              className="vf-wizard-text-action"
              onClick={() => setAside("phone")}
            >
              Sign in on your phone
            </button>
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
          track="ts"
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
              <CopyButton
                label="Copy approval request"
                copy={(from) => props.onCopyText(request, from)}
                className={quietCls}
              />
              <button type="submit" className={primaryCls}>
                Tell me when it's approved
              </button>
            </>
          }
        >
          <WaitingSteps live="join" />
          <button type="button" className="vf-wizard-text-action" onClick={props.onSignInAgain}>
            Use another account
          </button>
          {face.adminUrl !== null && (
            <a
              className="vf-wizard-text-action"
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
          track="ts"
          title="Your network requires device logs."
          later={LATER_ON_DEVICES}
          voice="This network requires every device to send logs to Tailscale. VibeField doesn't send them by default. Allow logs to join, or continue without connecting."
          onSubmit={props.onSendLogs}
          actions={
            <>
              <SkipAction label="Not now" onSkip={props.onSkip} />
              <button type="submit" className={primaryCls} disabled={step.kind === "pending"}>
                Send logs on this network
              </button>
            </>
          }
        >
          {face.adminUrl !== null && (
            <a
              className="vf-wizard-text-action"
              href={face.adminUrl}
              target="_blank"
              rel="noreferrer"
            >
              Manage in Tailscale ↗
            </a>
          )}
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
            track="ts"
            title="Connected, not yet trusted."
            voice="Your network uses Tailnet Lock. Until a device that can sign trusts this Mac, it can't reach your other devices, and they can't reach it."
            onSubmit={props.onContinue}
            actions={
              <>
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
                <button type="submit" className={primaryCls}>
                  Continue
                </button>
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
          track="ts"
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
              {!alone && aside !== "phone" && (
                <button type="button" className={quietCls} onClick={() => setAside("phone")}>
                  Add your phone
                </button>
              )}
              <button type="submit" className={alone && aside !== "phone" ? quietCls : primaryCls}>
                Continue
              </button>
              {alone && aside !== "phone" && (
                <button type="button" className={primaryCls} onClick={() => setAside("phone")}>
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
          <button type="button" className="vf-wizard-text-action" onClick={props.onSignInAgain}>
            Not this account? Sign in again
          </button>
        </WizardPane>
      );
    }

    case "signedOut":
      return (
        <WizardPane
          eyebrow="Your devices"
          track="ts"
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
              <button type="submit" className={quietCls}>
                Continue
              </button>
              <button type="button" className={primaryCls} onClick={props.onRenew}>
                {face.reason === "removed" ? "Connect again" : "Sign in again"}
              </button>
            </>
          }
        />
      );
  }
}
