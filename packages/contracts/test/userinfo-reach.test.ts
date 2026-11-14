// The userinfo pins (VF-PM 07:18Z, 2026-11-14, after the phone lane's SP-4 finding): a URL whose USERINFO names a host
// a rule would admit (`name:x@`, `name@`, `name:443@`) while its real host is another. Every reach decision on the
// desktop reads the PARSED host, or an anchored pattern whose host cannot hold an `@` or a `:` (ma-6's read at
// a5025d1fa). These rows keep it so: an edit that opens one of them is red here. The capture's own guard is pinned
// beside its other rows (electron-shell's artifact-preview-capture.test.ts).
import { describe, expect, it } from "vitest";
import { artifactRootUrlClaim, MadeAppReachHost } from "../src/artifacts";
import { readMadeAppEnvironment } from "../src/made-app-network";
import { ShellArtifactPreviewUrl } from "../src/shell";

const NAME = "studio.tail1234.ts.net";
const OTHER = "other.tail1234.ts.net";
const ROOT = `https://${NAME}:14211/`;
/** The three forms over a root URL: each names NAME in its userinfo, and its host is OTHER. */
const ROOT_FORMS = [
  `https://${NAME}:x@${OTHER}:14211/`,
  `https://${NAME}@${OTHER}:14211/`,
  `https://${NAME}:443@${OTHER}:14211/`,
] as const;
/** The three forms as a declared host: a public name, then the loopback address. */
const HOST_FORMS = [
  "cdn.jsdelivr.net:x@127.0.0.1",
  "cdn.jsdelivr.net@127.0.0.1",
  "cdn.jsdelivr.net:443@127.0.0.1",
] as const;

describe("the userinfo forms stay refused", () => {
  it("the root-URL claim (artifactRootUrlClaim) claims none of them; the plain root URL still claims", () => {
    expect(artifactRootUrlClaim(ROOT), "the control").toEqual({
      raw: ROOT,
      hostname: NAME,
      port: 14211,
    });
    for (const form of ROOT_FORMS) expect(artifactRootUrlClaim(form), form).toBeNull();
  });

  it("the capture's target (ShellArtifactPreviewUrl) refuses each; the plain root URL still parses", () => {
    expect(ShellArtifactPreviewUrl.safeParse(ROOT).success, "the control").toBe(true);
    for (const form of ROOT_FORMS) {
      expect(ShellArtifactPreviewUrl.safeParse(form).success, form).toBe(false);
    }
  });

  it("a declared host (MadeAppReachHost) is never one of them, and a captured environment strips each", () => {
    expect(MadeAppReachHost.safeParse("cdn.jsdelivr.net").success, "the control").toBe(true);
    for (const form of HOST_FORMS) {
      expect(MadeAppReachHost.safeParse(form).success, form).toBe(false);
    }
    const read = readMadeAppEnvironment({ hosts: { "script-src": [...HOST_FORMS] } });
    expect(read.policy.hosts, "the policy names no host").toEqual({});
    expect(read.stripped).toEqual(
      HOST_FORMS.map((entry) => ({ field: "script-src", entry, why: "unreadable" })),
    );
  });
});
