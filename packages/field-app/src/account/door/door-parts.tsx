import { UserFaceView } from "@vibefield/design-kit/face";
import type { CSSProperties, ReactElement } from "react";
import type { MonitorDeviceFacet } from "../../godview/monitor/types";
import { OS_LABEL, OsMark } from "../../godview/os-marks";
import type { FieldUserFace } from "../../host";
import { TailscaleMark } from "../tailscale-mark";
import "./door.css";

// TS-2 (track TS) — the door's parts (DESIGN.md §8 "The Connect pane"), shared by
// every surface that draws the link: the Setup Assistant's pane now, Settings →
// Devices next (TS-3). Plain data in, no daemon reads: the catalog mounts them
// through the shipping views with fixtures.

/** The partner line: Tailscale's mark where trust is decided (§13, TS-D4), and
 * what a person needs to know before the click (TS-L4). */
export function PartnerLine({ compact = false }: { compact?: boolean }): ReactElement {
  return (
    <div className="vf-door-partner" data-compact={compact || undefined}>
      <TailscaleMark size={56} />
      <div className="vf-door-partner-words">
        <p>
          Private connections with Tailscale. Free for personal use. Signing in creates an account
          if you don't have one.
        </p>
        <p className="vf-door-quiet">
          Use your personal account for your own devices. A work account joins your company's
          network.
        </p>
      </div>
    </div>
  );
}

/** Five privacy facts. The wizard gives these the full body width, within its fixed frame. */
export const WHAT_VIBEFIELD_CAN_SEE: ReadonlyArray<readonly [string, string]> = [
  [
    "Your login and devices.",
    "VibeField sees your Tailscale login and signed-in devices. Nothing else about your account.",
  ],
  [
    "Your network settings stay the same.",
    "VibeField joins as a separate device, alongside any Tailscale app you use. No VPN prompt or changes to this Mac's network settings.",
  ],
  [
    "Only you can reach this Mac.",
    "Others on a shared network can see that the device exists, but VibeField blocks their access.",
  ],
  [
    "Encrypted from device to device.",
    "Your work travels directly, encrypted end to end. VibeField runs no servers. Tailscale sees connections, never their contents.",
  ],
  [
    "Disconnect whenever you like.",
    "Settings → Devices → Disconnect. Your field stays on this Mac.",
  ],
];

export function WhatVibeFieldCanSee(): ReactElement {
  return (
    <ul className="vf-door-see" aria-label="What VibeField can see">
      {WHAT_VIBEFIELD_CAN_SEE.map(([lead, rest]) => (
        <li key={lead}>
          <strong>{lead}</strong> {rest}
        </li>
      ))}
    </ul>
  );
}

/** One device in the constellation: a real one of this account (an OS mark and
 * its name), or a ghost of what connecting would bring. */
export interface DoorDevice {
  readonly id: string;
  readonly name: string;
  readonly os: MonitorDeviceFacet["os"];
  /** This Mac: solid, and never a ghost. */
  readonly self?: boolean;
  /** Drawn dashed: what you would get, not what you have. */
  readonly ghost?: boolean;
}

/** The constellation's places, as % of its box — around the face, never under
 * the pane's words. The first is This Mac's. */
const SLOTS: ReadonlyArray<readonly [number, number]> = [
  [16, 50],
  [84, 22],
  [86, 78],
  [24, 14],
  [74, 92],
];
const CENTRE: readonly [number, number] = [50, 50];

/** A wire from the face to a slot: a hairline rotated into place (CSS, so the
 * chrome adds no inline SVG, §13). */
function wireStyle(to: readonly [number, number], index: number): CSSProperties {
  const dx = to[0] - CENTRE[0];
  const dy = to[1] - CENTRE[1];
  return {
    left: `${CENTRE[0]}%`,
    top: `${CENTRE[1]}%`,
    // the box is square, so % lengths along either axis agree
    width: `${Math.hypot(dx, dy)}%`,
    transform: `rotate(${Math.atan2(dy, dx)}rad)`,
    "--vf-door-delay": `${index * 90}ms`,
  } as CSSProperties;
}

/** TS-D8 — your devices around your face. Before connecting it shows what you
 * would get (This Mac, and a phone and another computer as ghosts); at arrival
 * the account's devices take the slots, each 90ms after the one before
 * (DESIGN.md §6, the arrival), up to five. */
export function Constellation({
  face,
  seed,
  devices,
  arriving = false,
}: {
  face: FieldUserFace;
  seed: string;
  devices: readonly DoorDevice[];
  /** Play the arrival: wires draw and marks pop, 90ms apart. */
  arriving?: boolean;
}): ReactElement {
  const shown = devices.slice(0, SLOTS.length);
  return (
    <div className="vf-door-constellation" data-arriving={arriving ? "" : undefined}>
      {shown.map((device, index) => {
        const slot = SLOTS[index] ?? SLOTS[0];
        return (
          <span
            key={`wire-${device.id}`}
            className="vf-door-wire"
            data-ghost={device.ghost === true ? "" : undefined}
            style={wireStyle(slot as readonly [number, number], Math.min(index, 4))}
            aria-hidden="true"
          />
        );
      })}
      <div className="vf-door-you">
        <UserFaceView emoji={face.emoji} frame={face.frame} size={64} seed={seed} />
      </div>
      {shown.map((device, index) => {
        const slot = SLOTS[index] ?? SLOTS[0];
        return (
          <div
            key={device.id}
            className="vf-door-device"
            data-ghost={device.ghost === true ? "" : undefined}
            data-self={device.self === true ? "" : undefined}
            style={
              {
                left: `${slot?.[0] ?? 50}%`,
                top: `${slot?.[1] ?? 50}%`,
                "--vf-door-delay": `${Math.min(index, 4) * 90}ms`,
              } as CSSProperties
            }
          >
            <span className="vf-door-device-disc">
              <OsMark os={device.os} size={18} />
            </span>
            <span className="vf-door-device-name">
              {device.name}
              <span className="sr-only">
                {device.ghost === true ? " (not connected yet)" : `, ${OS_LABEL[device.os]}`}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The waiting pane's two true steps (§8, v2's "two true steps"); the live one
 * breathes until its fact arrives (§6's loop). */
export function WaitingSteps({ live }: { live: "sign-in" | "join" }): ReactElement {
  const steps = [
    ["sign-in", "Sign in or create an account at Tailscale"],
    ["join", "This Mac joins your network"],
  ] as const;
  const at = live === "sign-in" ? 0 : 1;
  return (
    <ol className="vf-door-steps">
      {steps.map(([key, words], index) => (
        <li
          key={key}
          data-state={index < at ? "done" : index === at ? "live" : "next"}
          aria-current={index === at ? "step" : undefined}
        >
          <span className="vf-door-step-dot" aria-hidden="true" />
          {words}
        </li>
      ))}
    </ol>
  );
}
