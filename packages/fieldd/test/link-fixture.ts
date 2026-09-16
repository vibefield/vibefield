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

/**
 * UA-P-0d (D7) — the product serve's route secret, read from the floor the way
 * the SIDECAR learns it: off the `serve.add` this daemon sent.
 *
 * It exists because the secret stopped being discoverable from the product's
 * own surfaces, which is the whole point of D7. It used to ride the capability
 * URL — `https://host:port/t/<secret>` — so a test could lift it out of
 * `daemon.health()` exactly as a phone lifted it out of `field.devices.v1`, and
 * so could anything else that could read the slice truffle had written to disk.
 * The secret is the sidecar's TARGET path now: the public prefix is `/`, the
 * sidecar adds the secret on forward, and nothing outside this process and the
 * floor's route config ever holds it.
 *
 * A test that plays the sidecar still has to know it, and this is the honest
 * place to get it: the same declaration the real sidecar is configured from.
 * Pass the mock the daemon is talking to.
 */
export function productPathSecret(mock: {
  meshAddParams: ReadonlyArray<Record<string, unknown>>;
}): string {
  for (let i = mock.meshAddParams.length - 1; i >= 0; i -= 1) {
    const spec = mock.meshAddParams[i];
    if (spec?.["name"] !== "product") continue;
    const secret = spec["pathSecret"];
    if (typeof secret === "string" && secret.length > 0) return secret;
  }
  throw new Error("the product serve has not been declared to this floor yet");
}

/** The path a sidecar-proxied caller arrives on at fieldd's control port. */
export function productDoorPath(mock: {
  meshAddParams: ReadonlyArray<Record<string, unknown>>;
}): string {
  return `/t/${productPathSecret(mock)}`;
}
