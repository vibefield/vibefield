// LSF-4's entitlement reader (2026-10-26; the first signed nightly, run 40272843651) — the keys a signed binary's
// entitlements hold, read from `codesign --display --entitlements - --xml`. Without `--xml`, a modern codesign prints
// its own text form (`[Dict] [Key] com.apple.security.cs.allow-jit [Value] [Bool] true`). The release gate matched
// `<key>` in that and read NO key from a correctly signed app: it said "V8 JIT entitlement is absent" for an app
// signed with packaging/entitlements.mac.plist. So the XML form is asked for, and the text form, if it ever comes
// back, is refused in words rather than read as "none".

/** codesign's arguments for a binary's entitlements, as an XML plist on stdout. */
export const ENTITLEMENT_ARGS = ["--display", "--entitlements", "-", "--xml"];

/** The entitlement keys in codesign's output. An XML plist yields its `<key>`s (none for an unsigned or bare
 * signature, which prints no plist). Codesign's text form throws: the caller asked for XML and must not read it as
 * empty. */
export function entitlementKeys(output) {
  if (/\[Key\]/u.test(output) && !output.includes("<plist")) {
    throw new Error(
      "codesign printed its text form, not the XML plist asked for (--xml) — the entitlements cannot be read",
    );
  }
  return Array.from(output.matchAll(/<key>([^<]+)<\/key>/gu), (match) => match[1]).sort();
}
