import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The staged bundle, not the source tree, must advertise service support.
 * Older helpers treat unknown flags as --once, so blindly prewarming one
 * would put an overlay on screen before the user requested a capture. */
export function screenshotHelperSupportsService(
  helperPath: string | null,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): boolean {
  if (helperPath === null) return false;
  try {
    return /<key>VFScreenshotServiceVersion<\/key>\s*<integer>1<\/integer>/.test(
      read(join(dirname(dirname(helperPath)), "Info.plist")),
    );
  } catch {
    return false;
  }
}
