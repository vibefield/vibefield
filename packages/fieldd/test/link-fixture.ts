import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** UA-P-0a (D1) — the login every tailnet-door row in this suite dials as. */
export const TEST_LOGIN = "me@jamesyong42.com";

/**
 * Give a data root a captured tailscale link, so the daemon that boots on it is
 * LINKED rather than offline.
 *
 * It exists because UA-P-0a made the posture derive from the link: an unlinked
 * desktop declares no product serve and its door mints a guest, so any row about
 * federation, quotas, artifacts or the agent field — none of which is about the
 * posture — has to say which account the desktop is before it can test anything
 * else. Writing the file is the honest way to say it: it is the same record a
 * real capture writes, and the daemon reads it through the same path.
 *
 * Call BEFORE `bootstrap()` — the posture is derived once, at start.
 */
export function writeLinkFixture(dataDir: string, login: string = TEST_LOGIN): void {
  mkdirSync(join(dataDir, "fieldd"), { recursive: true });
  writeFileSync(
    join(dataDir, "fieldd", "link.json"),
    `${JSON.stringify(
      {
        login,
        tailnet: "tail1234.ts.net",
        linkedAt: "2026-09-15T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
  );
}
