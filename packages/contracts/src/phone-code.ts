// TS-7b (TS-D11; James's Q2 A, 2026-10-29 05:29:23Z) — the code a Mac shows so a phone signs in to the SAME
// Tailscale account: `vibefield://add-phone?login=…&from=…`. The Mac draws it as a QR (the Connect pane's and
// Settings → Devices' phone asides); the phone reads it with its own reader, or iOS opens it from the camera when the
// app is installed. It carries no secret: the login is the account the phone should expect (a mismatch is drawn as
// "Another account?", presentation only — the gate is untouched), and `from` is the Mac's display name, drawn as
// plain text ("came from Studio").
//
// Deliberately free of runtime imports, like `./user-face`: the Connect pane is boot-reachable and takes this
// through the `./phone-code` subpath (ui-system-boundaries pins the leaf rule). The parser is written out by hand,
// not as a zod schema, because the phone parses the same bytes in Swift (`FieldMesh/PhoneCode.swift`) and both
// sides are held to ONE vector, `fixtures/phone-code.vector.json` (EL9 on two sides): every rule below is a rule
// both languages can state exactly — Unicode scalars, not UTF-16 units or graphemes; percent-decoding without
// `+`-as-space (URLSearchParams decodes `+` to a space, Swift's URLComponents does not, so neither is used here).
// It has no JSON Schema and no Rust: field-native reads none of it (gen-jsonschema's absent list).
//
// When a public install link exists, the code becomes that link with the same two parameters and the parser takes
// both prefixes (Q2 A's "the store link with the same params later").

export const PHONE_CODE_SCHEME = "vibefield";
export const PHONE_CODE_HOST = "add-phone";
/** A code is short; anything longer is not one of ours. */
export const PHONE_CODE_MAX_TEXT = 1024;
/** A Tailscale login name (`me@example.com`, `me@github`), in Unicode scalars. */
export const PHONE_CODE_MAX_LOGIN = 254;
/** The Mac's display name, in Unicode scalars. */
export const PHONE_CODE_MAX_FROM = 64;

export interface PhoneCode {
  readonly login: string;
  readonly from: string;
}

/** Why a text is not a code, in words both parsers return. */
export type PhoneCodeRefusal =
  | "not-a-code"
  | "too-long"
  | "duplicate"
  | "no-login"
  | "bad-login"
  | "no-from"
  | "bad-from";

export type PhoneCodeParse =
  | { readonly ok: true; readonly code: PhoneCode }
  | { readonly ok: false; readonly why: PhoneCodeRefusal };

/** The code for a login and a Mac, the one spelling the Mac draws. */
export function encodePhoneCode(code: PhoneCode): string {
  return `${PHONE_CODE_SCHEME}://${PHONE_CODE_HOST}?login=${encodeURIComponent(code.login)}&from=${encodeURIComponent(code.from)}`;
}

/** The code a Mac draws for `login`, named by the first of `names` the phone will read back — a name past the
 * bound, or one the rules refuse, is passed over for the next (the roster's name, then Tailscale's machine name) —
 * or null when none will do, and the Mac draws no code: it never shows one its own phone refuses. */
export function phoneCodeFor(
  login: string | null,
  names: readonly (string | null | undefined)[],
): string | null {
  if (login === null) return null;
  for (const name of names) {
    if (name === null || name === undefined) continue;
    const code = encodePhoneCode({ login, from: name });
    if (parsePhoneCode(code).ok) return code;
  }
  return null;
}

// Every rule below is stated in Unicode scalars and explicit sets, so `FieldMesh/PhoneCode.swift` states it exactly:
// - TRIMMED: ASCII whitespace (space, tab, LF, VT, FF, CR) at either end — a scanner's trailing newline;
// - SPACE (refused inside a login): JavaScript's `\s`, written out;
// - UNSAFE (refused anywhere in either field): C0 and C1 controls; the line and paragraph separators (a line break,
//   as LF is); and Unicode's Bidi_Control set — the Arabic letter mark, the LRM and RLM, the embeddings and overrides,
//   the isolates. A name that can reorder or break what is drawn around it is refused, never cleaned, because a
//   cleaned name is a second spelling the other parser would have to agree on.
const TRIMMED = new Set([0x20, 0x09, 0x0a, 0x0b, 0x0c, 0x0d]);
const SPACE = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
  0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
]);
const unsafe = (scalar: number): boolean =>
  scalar <= 0x1f ||
  (scalar >= 0x7f && scalar <= 0x9f) ||
  scalar === 0x061c ||
  scalar === 0x2028 ||
  scalar === 0x2029 ||
  scalar === 0x200e ||
  scalar === 0x200f ||
  (scalar >= 0x202a && scalar <= 0x202e) ||
  (scalar >= 0x2066 && scalar <= 0x2069);

const codePoints = (text: string): number[] => [...text].map((c) => c.codePointAt(0) ?? 0);
// Every TRIMMED scalar is one UTF-16 unit, so the ends are found unit by unit and the middle is never rebuilt (a
// rebuild by `String.fromCodePoint(...points)` spreads one argument per scalar, and throws on a long enough text).
const trim = (text: string): string => {
  let from = 0;
  let to = text.length;
  while (from < to && TRIMMED.has(text.charCodeAt(from))) from += 1;
  while (to > from && TRIMMED.has(text.charCodeAt(to - 1))) to -= 1;
  return text.slice(from, to);
};
const asciiLower = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** Read a code, or say why the text is not one. Trimmed first; the scheme and host match without regard to ASCII
 * case; after the host, an optional `/`, then an optional query up to an optional `#` fragment, which is ignored;
 * unknown parameters are ignored (tolerant reader); `login` or `from` given twice is refused. */
export function parsePhoneCode(text: string): PhoneCodeParse {
  const trimmed = trim(text);
  if (codePoints(trimmed).length > PHONE_CODE_MAX_TEXT) return { ok: false, why: "too-long" };
  const prefix = `${PHONE_CODE_SCHEME}://${PHONE_CODE_HOST}`;
  if (asciiLower(trimmed.slice(0, prefix.length)) !== prefix)
    return { ok: false, why: "not-a-code" };
  let rest = trimmed.slice(prefix.length);
  if (rest.startsWith("/")) rest = rest.slice(1);
  let query = "";
  if (rest.startsWith("?")) {
    const hash = rest.indexOf("#");
    query = hash < 0 ? rest.slice(1) : rest.slice(1, hash);
  } else if (rest !== "" && !rest.startsWith("#")) {
    return { ok: false, why: "not-a-code" };
  }
  const fields = new Map<string, string>();
  for (const pair of query.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    let name: string;
    let value: string;
    try {
      name = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
      value = decodeURIComponent(eq < 0 ? "" : pair.slice(eq + 1));
    } catch {
      return { ok: false, why: "not-a-code" };
    }
    if (name !== "login" && name !== "from") continue;
    if (fields.has(name)) return { ok: false, why: "duplicate" };
    fields.set(name, value);
  }
  const login = trim(fields.get("login") ?? "");
  if (login === "") return { ok: false, why: "no-login" };
  const loginPoints = codePoints(login);
  if (
    loginPoints.length > PHONE_CODE_MAX_LOGIN ||
    loginPoints.some((p) => unsafe(p) || SPACE.has(p)) ||
    !login.includes("@") ||
    login.startsWith("@") ||
    login.endsWith("@")
  ) {
    return { ok: false, why: "bad-login" };
  }
  const from = trim(fields.get("from") ?? "");
  if (from === "") return { ok: false, why: "no-from" };
  const fromPoints = codePoints(from);
  if (fromPoints.length > PHONE_CODE_MAX_FROM || fromPoints.some(unsafe))
    return { ok: false, why: "bad-from" };
  return { ok: true, code: { login, from } };
}
