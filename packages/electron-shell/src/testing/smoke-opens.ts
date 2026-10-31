// PT-S3 (D3) — WHAT MAIN'S OS OPENER WAS HANDED, as a smoke:canvas row reads it. In every smoke-like mode main's opener
// RECORDS instead of opening (GT-8b, main/index.ts `harnessShellOpens`): no run puts a page in the person's browser, a
// window in their Finder, or System Settings on their screen. smoke:canvas is handed the record as the godview smoke is
// (`runSmokeCanvas({ shellOpens })`), and the phone's rows read it:
//  - SIM-NONE's face offers NO act, so the record never moves under it;
//  - a bound phone with no permission offers Open Settings (PT-S2 R4, `open-settings`): pressed, main records its ONE fixed
//    address — Screen Recording's — and nothing opens.
// The judge prints counts and addresses, never a path revealed, and masks anything shaped like a UUID in what it prints:
// a smoke print never carries a UDID.

/** What main's opener was handed: the addresses it would have opened, the paths it would have revealed. */
export interface ShellOpens {
  readonly opened: readonly string[];
  readonly revealed: readonly string[];
}

/** Screen Recording's settings: the address main's Open Settings records for a bound phone with no permission —
 * `openSettings` in main/index.ts, restated (testing never imports main's wiring; a unit reads it there). */
export const SCREEN_RECORDING_SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

/** A row's mark before its act: how much of each the record held. */
export interface OpensMark {
  readonly opened: number;
  readonly revealed: number;
}

export const opensMark = (record: ShellOpens): OpensMark => ({
  opened: record.opened.length,
  revealed: record.revealed.length,
});

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;

/** An address as a judge prints it: anything shaped like a UUID masked. */
const said = (addresses: readonly string[]): string =>
  JSON.stringify(addresses.map((address) => address.replace(UUID, "<uuid>")));

/**
 * The opener since `before`: handed exactly `want`, in order — none, for a row that offers no act — and asked to reveal
 * nothing. A run main handed no record proved nothing: an unmarked run's opener reaches the OS.
 */
export function judgeOpens(
  row: string,
  record: ShellOpens | undefined,
  before: OpensMark,
  want: readonly string[],
): string[] {
  if (record === undefined)
    return [
      `${row}: main handed the row no opener record — what it opens reaches the OS; the row proved nothing`,
    ];
  const opened = record.opened.slice(before.opened);
  const revealed = record.revealed.slice(before.revealed).length;
  const out: string[] = [];
  if (opened.length === 0 && want.length > 0)
    out.push(`${row}: ${said(want)} never reached main's opener — the act did not run there`);
  else if (opened.length !== want.length || opened.some((address, i) => address !== want[i]))
    out.push(`${row}: main's opener was handed ${said(opened)}, not ${said(want)}`);
  if (revealed > 0)
    out.push(
      `${row}: main's opener was asked to reveal ${revealed} path(s) — no row of the phone reveals one`,
    );
  return out;
}
