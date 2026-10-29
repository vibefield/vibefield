import { phoneCodeFor } from "@vibefield/contracts/phone-code";
import type { ReactElement } from "react";
import { SignInQr } from "./sign-in-qr";

// TS-7b (DESIGN.md §8 "The Connect pane", Add your phone; James's Q2 A, 2026-10-29) — the code that tells a phone
// which account to expect: `vibefield://add-phone` with the account and this Mac's name (`@vibefield/contracts/
// phone-code`, a leaf: the Connect pane is boot-reachable). One drawing for both places that offer it, the Connect
// pane's Connected aside and Settings → Devices' Add a device → Phone, so the two never say it differently.
//
// It carries no secret, and it installs nothing: there is no install link yet, so the words send the person to
// TestFlight first. The Mac is named by the first of `names` the phone will read back — the roster's own name (the
// one the phone's corner will show it by), then Tailscale's machine name (`phoneCodeFor`) — and while none will do
// (or the login is not known), the code waits and the words say what to do without it.

/** The QR's spoken name, and the line beside it. */
export const ADD_PHONE_CODE_LABEL = "Scan with VibeField on your iPhone";

export function AddPhoneCode({
  login,
  names,
  className,
}: {
  login: string | null;
  /** this Mac's names, in order: the roster's, then the machine name Tailscale shows */
  names: readonly (string | null | undefined)[];
  /** the surface's own text style */
  className: string;
}): ReactElement {
  const code = phoneCodeFor(login, names);
  if (login === null || code === null) {
    return (
      <p className={className}>
        On your iPhone, open VibeField and Continue with Tailscale, signing in as{" "}
        <span className="font-mono">{login ?? "this account"}</span>. It finds this Mac on its own.
      </p>
    );
  }
  // `data-code` says what the QR holds: no secret (the QR shows it to anyone looking), and a test reads it
  return (
    <div className="flex items-center gap-4" data-code={code}>
      <SignInQr text={code} label={ADD_PHONE_CODE_LABEL} />
      <p className={className}>
        {ADD_PHONE_CODE_LABEL}. Get VibeField from TestFlight first, then open it and choose{" "}
        <strong>Scan the code on your Mac</strong>. The same code tells it to expect{" "}
        <span className="font-mono">{login}</span>.
      </p>
    </div>
  );
}
