import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  encodePhoneCode,
  PHONE_CODE_HOST,
  PHONE_CODE_MAX_FROM,
  PHONE_CODE_MAX_LOGIN,
  PHONE_CODE_MAX_TEXT,
  PHONE_CODE_SCHEME,
  parsePhoneCode,
  phoneCodeFor,
} from "../src/phone-code";

// TS-7b — the phone code's cross-language vector. The phone's Swift parser reads a byte-identical copy
// (check:ios-fixtures' requiredMirrors row), so every row here is a row there.
const VECTOR = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "phone-code.vector.json"),
    "utf8",
  ),
) as {
  prefix: string;
  limits: { text: number; login: number; from: number };
  codes: { text: string; login: string; from: string; canonical: boolean; why: string }[];
  refused: { text: string; why: string }[];
};

describe("TS-7b — the phone code (golden vector)", () => {
  it("states the prefix and the bounds the vector states", () => {
    expect(VECTOR.prefix).toBe(`${PHONE_CODE_SCHEME}://${PHONE_CODE_HOST}`);
    expect(VECTOR.limits).toEqual({
      text: PHONE_CODE_MAX_TEXT,
      login: PHONE_CODE_MAX_LOGIN,
      from: PHONE_CODE_MAX_FROM,
    });
  });

  for (const row of VECTOR.codes) {
    it(`reads a code: ${row.why}`, () => {
      expect(parsePhoneCode(row.text)).toEqual({
        ok: true,
        code: { login: row.login, from: row.from },
      });
      if (row.canonical)
        expect(encodePhoneCode({ login: row.login, from: row.from })).toBe(row.text);
    });
  }

  for (const row of VECTOR.refused) {
    it(`refuses ${row.why}: ${row.text.slice(0, 72)}`, () => {
      expect(parsePhoneCode(row.text)).toEqual({ ok: false, why: row.why });
    });
  }

  it("refuses a text far past the bound without building it again (TypeScript's own row)", () => {
    expect(parsePhoneCode(`${VECTOR.prefix}?login=a%40b&from=${"x".repeat(200_000)}`)).toEqual({
      ok: false,
      why: "too-long",
    });
    expect(parsePhoneCode(` ${"\n".repeat(200_000)} `)).toEqual({ ok: false, why: "not-a-code" });
  });

  it("names the Mac by the first name its phone will read back, and draws no code when none will do", () => {
    const login = "me@example.com";
    const long = "x".repeat(PHONE_CODE_MAX_FROM + 1);
    const code = (from: string) => encodePhoneCode({ login, from });
    expect(phoneCodeFor(login, ["Studio", "truffle-studio"])).toBe(code("Studio"));
    expect(phoneCodeFor(login, [null, undefined, "truffle-studio"])).toBe(code("truffle-studio"));
    // the roster allows 128 characters and no character filter; the code allows neither
    expect(phoneCodeFor(login, [long, "truffle-studio"])).toBe(code("truffle-studio"));
    expect(phoneCodeFor(login, ["Studio\u200f", "truffle-studio"])).toBe(code("truffle-studio"));
    expect(phoneCodeFor(login, [long, null])).toBeNull();
    expect(phoneCodeFor(null, ["Studio"])).toBeNull();
    expect(phoneCodeFor("not-a-login", ["Studio"])).toBeNull();
  });

  it("reads back whatever it writes", () => {
    for (const code of [
      { login: "me@example.com", from: "Studio" },
      { login: "a+b@example.co.uk", from: "Mac mini & co. #2 / ?=" },
      { login: "octo@github", from: "电脑 🦊" },
    ]) {
      expect(parsePhoneCode(encodePhoneCode(code))).toEqual({ ok: true, code });
    }
  });
});
