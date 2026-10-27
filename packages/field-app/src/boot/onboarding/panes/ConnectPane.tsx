import { useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useState } from "react";
import type { DoorDevice } from "../../../account/door/door-parts";
import { copyText, useLinkDoor } from "../../../account/use-link-door";
import { osOf } from "../../../godview/monitor/devices";
import { getHost } from "../../../host";
import { type ConnectMe, OnboardingConnectPaneView } from "../views/connect";

/** The roster rows the arrival reads — `DeviceInfo` (contracts' devices.ts),
 * named structurally: the Setup Assistant imports leaf entries only (UA-7),
 * and contracts has no devices leaf. */
type RosterRow = {
  readonly deviceId: string;
  readonly name: string;
  readonly platform?: string | undefined;
  readonly self: boolean;
};

/** The sign-in address usually arrives within seconds. Past this the pane says
 * so (the network may be down) — and keeps waiting: there is no timer on the
 * person (DESIGN.md §8 "The Connect pane"). */
const SLOW_MS = 20_000;

/** The Connect pane (DESIGN.md §8; track TS, TS-2) — the link, and since UA-P-0g
 * the place it BEGINS. The acts are the shared door's (`useLinkDoor`), the
 * same ones the face menu and Settings use: one click reaches the browser,
 * once (TS-D5). The face is the door's subscription; this file adds only what
 * the pane alone draws — the account's devices for the arrival, and the word
 * that the address is slow.
 *
 * The client rather than the view owns it for the same reason `PosturePane`
 * does: `views/` is the Electron-free surface the catalog mounts, and a view
 * that reached for a daemon could not be shown there. */
export function ConnectPane({
  me,
  onContinue,
  onSkip,
  onBack,
  onNewUser,
  escapeIsNotNow,
}: {
  /** who is connecting: the face the constellation is drawn around */
  me: ConnectMe;
  onContinue: () => void;
  onSkip: () => void;
  onBack: (() => void) | undefined;
  /** TS-D12 — a second account is a second user; absent where none can be made */
  onNewUser?: (() => void) | undefined;
  /** Esc is Not now — the Setup Assistant's; a sheet that closes on Esc leaves it off */
  escapeIsNotNow?: boolean;
}): ReactElement {
  const door = useLinkDoor();
  // C4 (D31): the roster wholesale on every delta — self ⋈ the account's peers
  const roster = useSubscription<RosterRow[]>("device.subscribe");
  const devices: DoorDevice[] = (roster.data ?? []).map((device) => ({
    id: device.deviceId,
    name: device.name,
    os: osOf(device.platform),
    self: device.self,
  }));

  const awaitingAddress = door.face.kind === "capturing" && door.face.authUrl === null;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!awaitingAddress) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [awaitingAddress]);

  return (
    <OnboardingConnectPaneView
      face={door.face}
      step={door.step}
      me={me}
      devices={devices}
      platform={getHost().platform}
      slow={slow}
      onBegin={(options) => void door.begin(options)}
      onRenew={() => void door.renew()}
      onSendLogs={() => void door.sendLogs(true)}
      onCancel={() => void door.cancel()}
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
      onSignInAgain={() => void door.startOver()}
      onNewUser={onNewUser}
      onContinue={onContinue}
      onSkip={onSkip}
      onBack={onBack}
      escapeIsNotNow={escapeIsNotNow === true}
    />
  );
}
