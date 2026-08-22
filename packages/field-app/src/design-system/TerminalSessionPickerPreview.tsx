import type { ProductSessionRosterItem } from "@vibefield/contracts";
import type { ReactElement } from "react";
// The VIEW's own module, not the registration door: a catalog wants the
// component, and reaching it through `terminal/widget/index.ts` would drag the
// prefab builder and the face policy into a bench that registers nothing.
import { SessionPickerView } from "../terminal/widget/SessionPickerView";

// The catalog's fixture ADAPTER for the built-in mirror's session picker
// (TP-S2b-widget).
//
// `docs/UI_SYSTEM.md`'s rule, enforced by `test/ui-system-boundaries.test.ts`:
// the catalog mounts the SHIPPING view with a fixture adapter, never a copy of
// its markup or CSS. There is therefore no picker markup here — only rows and
// roster states, which is exactly the seam `SessionPickerView` was split out
// for: it takes a roster and a state and renders, so every face it can wear is
// reachable in a bench with no daemon under it.
//
// The five states are the whole point. A picker that only ever showed "here are
// your sessions" would hide the four answers that actually matter on a cold
// machine: the read in flight, fieldd's own "I have not looked at the floor
// yet" (`unobserved` — NOT an empty machine), a window that could not ask at
// all, and an observed floor that really is empty.

const ROWS: readonly ProductSessionRosterItem[] = [
  {
    sessionId: "s-6f2a91",
    workloadClass: "agent",
    health: "live",
    title: "agent · build",
    provenance: { kind: "agent", agentId: "claude-3" },
  },
  {
    sessionId: "s-1b77c4",
    workloadClass: "interactive",
    health: "live",
    title: "shell · vibe-field",
    provenance: { kind: "user" },
  },
  {
    sessionId: "s-90ee02",
    workloadClass: "agent",
    health: "recovering",
    provenance: { kind: "agent" },
  },
  { sessionId: "s-4c0d18", workloadClass: "interactive", health: "exited", title: "cargo test" },
];

function Case({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <div className="vf-ds-picker-case">
      <span className="vf-ds-picker-label">{label}</span>
      <div className="vf-ds-picker-stage">{children}</div>
    </div>
  );
}

export function TerminalSessionPickerPreview(): ReactElement {
  const noop = (): void => undefined;
  return (
    <div className="vf-ds-picker-grid">
      <Case label="observed — pick one">
        <SessionPickerView items={ROWS} state="observed" onPick={noop} onRefresh={noop} />
      </Case>
      <Case label="observed — an empty floor">
        <SessionPickerView items={[]} state="observed" onPick={noop} onRefresh={noop} />
      </Case>
      <Case label="unread — the first read is in flight">
        <SessionPickerView items={[]} state="unread" onPick={noop} />
      </Case>
      <Case label="unobserved — fieldd has not looked yet">
        <SessionPickerView items={[]} state="unobserved" onPick={noop} onRefresh={noop} />
      </Case>
      <Case label="unavailable — this window could not ask">
        <SessionPickerView items={[]} state="unavailable" onPick={noop} onRefresh={noop} />
      </Case>
      <Case label="observed — a read in flight over a live list">
        <SessionPickerView items={ROWS} state="observed" onPick={noop} onRefresh={noop} busy />
      </Case>
    </div>
  );
}
