import type { ProbeResult, tryAdopt } from "@vibefield/fieldd-supervisor";
import type { ShellCustody } from "./custody";

// OB custody, C1 (CUSTODY-SPEC §7; AL-3's quit gate) — a person's quit looks for every other user's resident pair with
// an adopt-only probe (never a spawn: a quit must not start what it means to stop). At `files` that probe reads the
// pair's token file, as it always has, and SAYS so: the supervisor's probe has no default credential (a call that
// names none is refused before anything is read or dialled), so each call below names its own. At `sealed` there is
// no token file: the pair is paired with ITS OWN shell secret, derived for that user's root, so one user's secret is
// never offered at another user's door. The secret is MAC'd with, never sent (the supervisor's pairing probe).
//
// `null` is "no probe was possible": the root is unavailable (there is no secret, and nothing to fall back on), or
// the user root is gone. The quit then reaches the pairs it can and leaves the rest running, as it does for any
// pair it cannot read.

export async function probeResidentPair(options: {
  readonly root: string;
  readonly userId: string;
  readonly probeMs: number;
  readonly custody: Pick<ShellCustody, "level" | "shellSecret">;
  /** the supervisor's `tryAdopt` */
  readonly adopt: typeof tryAdopt;
}): Promise<ProbeResult | null> {
  if (options.custody.level === "files") {
    return options.adopt(options.root, options.probeMs, undefined, undefined, options.userId, {
      credential: { kind: "token-file" },
    });
  }
  let secret: string | undefined;
  try {
    secret = options.custody.shellSecret(options.root);
  } catch {
    return null;
  }
  if (secret === undefined) return null;
  return options.adopt(options.root, options.probeMs, undefined, undefined, options.userId, {
    credential: { kind: "pairing", secret },
  });
}
