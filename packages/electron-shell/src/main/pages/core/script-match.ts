// EY-1 (2026-11-19): is a script the engine's own? Matched by exact source against the script set
// recorded from the pin (contracts' `PagesScriptSetV1`, which keeps every body and every fixed part
// as its SHA-256 and its length in UTF-8 bytes, never as text; pages.ts).
//
// It reads the script's UTF-8 bytes left to right, with no backtracking:
//  - a fixed part takes the next `length` bytes and compares their SHA-256;
//  - a gap is read to its own end: one JSON string, one finite JSON number, one JSON value, or the
//    template its `id` names, in place. Every delimiter is ASCII, so no UTF-8 sequence holds one.
// The set's own parse holds that two gaps never meet and that no template holds itself, so one
// pass decides. Exact bodies are tried first (by method, length and digest), then each template
// that names a method, in the set's order. A template with no method only fills another's gap.
// Anything else is the agent's script.

import { createHash } from "node:crypto";
import {
  PagesScriptSetV1,
  type PagesScriptTemplateV1,
  type PagesTemplatePartV1,
} from "@vibefield/contracts";
import { PAGES_ENGINE_RECORD, PAGES_SCRIPT_SET } from "@vibefield/contracts/pages-record";
import type { ScriptMatch, ScriptMatcher } from "./types";

const NO_MATCH: ScriptMatch = Object.freeze({ matched: false });

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const decoder = new TextDecoder("utf-8", { fatal: true });

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isDigit(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x30 && byte <= 0x39;
}

/** Where the JSON string at `pos` ends (past its closing quote), or -1. */
function stringEnd(bytes: Uint8Array, pos: number): number {
  if (bytes[pos] !== QUOTE) return -1;
  for (let i = pos + 1; i < bytes.length; i += 1) {
    const byte = bytes[i] as number;
    if (byte === BACKSLASH) i += 1;
    else if (byte === QUOTE) return i + 1;
    else if (byte < 0x20) return -1;
  }
  return -1;
}

/** Where the array or object at `pos` ends, its strings read as strings, or -1. */
function bracketedEnd(bytes: Uint8Array, pos: number): number {
  let depth = 0;
  for (let i = pos; i < bytes.length; i += 1) {
    const byte = bytes[i] as number;
    if (byte === QUOTE) {
      const end = stringEnd(bytes, i);
      if (end < 0) return -1;
      i = end - 1;
    } else if (byte === 0x5b || byte === 0x7b) depth += 1;
    else if (byte === 0x5d || byte === 0x7d) {
      depth -= 1;
      if (depth === 0) return i + 1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/** The longest JSON number at `pos`, `-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?`, or -1. */
function numberEnd(bytes: Uint8Array, pos: number): number {
  let i = pos;
  if (bytes[i] === 0x2d) i += 1;
  if (bytes[i] === 0x30) i += 1;
  else if (isDigit(bytes[i])) {
    while (isDigit(bytes[i])) i += 1;
  } else return -1;
  if (bytes[i] === 0x2e && isDigit(bytes[i + 1])) {
    i += 2;
    while (isDigit(bytes[i])) i += 1;
  }
  if (bytes[i] === 0x65 || bytes[i] === 0x45) {
    let j = i + 1;
    if (bytes[j] === 0x2b || bytes[j] === 0x2d) j += 1;
    if (isDigit(bytes[j])) {
      i = j;
      while (isDigit(bytes[i])) i += 1;
    }
  }
  return i;
}

function startsWithAscii(bytes: Uint8Array, pos: number, word: string): boolean {
  if (pos + word.length > bytes.length) return false;
  for (let i = 0; i < word.length; i += 1) {
    if (bytes[pos + i] !== word.charCodeAt(i)) return false;
  }
  return true;
}

/** bytes[pos, end) as one JSON text's value, or undefined when it is not one. */
function parsed(bytes: Uint8Array, pos: number, end: number): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(decoder.decode(bytes.subarray(pos, end))) };
  } catch {
    return undefined;
  }
}

type GapKind = Exclude<PagesTemplatePartV1["kind"], "fixed" | "template">;

/** Where the gap of `kind` at `pos` ends, read to its own end, or -1. */
function gapEnd(bytes: Uint8Array, pos: number, kind: GapKind): number {
  if (kind === "json-string") {
    const end = stringEnd(bytes, pos);
    return end > pos && typeof parsed(bytes, pos, end)?.value === "string" ? end : -1;
  }
  if (kind === "finite-number") {
    const end = numberEnd(bytes, pos);
    if (end <= pos) return -1;
    const value = parsed(bytes, pos, end)?.value;
    return typeof value === "number" && Number.isFinite(value) ? end : -1;
  }
  // json-value: a string, an array or object, a literal or a number, with no whitespace before it.
  const byte = bytes[pos];
  let end = -1;
  if (byte === QUOTE) end = stringEnd(bytes, pos);
  else if (byte === 0x5b || byte === 0x7b) end = bracketedEnd(bytes, pos);
  else if (startsWithAscii(bytes, pos, "true") || startsWithAscii(bytes, pos, "null"))
    end = pos + 4;
  else if (startsWithAscii(bytes, pos, "false")) end = pos + 5;
  else end = numberEnd(bytes, pos);
  return end > pos && parsed(bytes, pos, end) !== undefined ? end : -1;
}

/** Where `parts` end when they match from `pos`, or -1. */
export function partsEnd(
  bytes: Uint8Array,
  pos: number,
  parts: readonly PagesTemplatePartV1[],
  byId: ReadonlyMap<string, PagesScriptTemplateV1>,
): number {
  let at = pos;
  for (const part of parts) {
    if (part.kind === "fixed") {
      const end = at + part.length;
      at = end <= bytes.length && sha256Hex(bytes.subarray(at, end)) === part.sha256 ? end : -1;
    } else if (part.kind === "template") {
      const inner = byId.get(part.id);
      at = inner === undefined ? -1 : partsEnd(bytes, at, inner.parts, byId);
    } else {
      at = gapEnd(bytes, at, part.kind);
    }
    if (at < 0) return -1;
  }
  return at;
}

/**
 * A matcher over one recorded set. The set is parsed strict first (pages.ts), so a set whose
 * templates could not match exactly (two gaps that meet, a nested id it does not hold, a template
 * inside itself) is refused here, before any script is judged.
 */
export function createScriptMatcher(set: PagesScriptSetV1): ScriptMatcher {
  const checked = PagesScriptSetV1.parse(set);
  // keyed by method and digest; a plain string key, so any method may be looked up
  const exact = new Map<string, (typeof checked.exact)[number]>();
  for (const body of checked.exact) exact.set(`${body.method} ${body.sha256}`, body);
  const byId = new Map(checked.templates.map((template) => [template.id, template] as const));
  const templates = checked.templates.filter((template) => template.method !== undefined);
  return (body: string, method: string): ScriptMatch => {
    const bytes = Buffer.from(body, "utf8");
    const hit = exact.get(`${method} ${sha256Hex(bytes)}`);
    if (hit !== undefined && hit.length === bytes.length) {
      return { matched: true, entryId: hit.id, commandClass: hit.commandClass };
    }
    for (const template of templates) {
      if (template.method !== method) continue;
      if (partsEnd(bytes, 0, template.parts, byId) === bytes.length) {
        return { matched: true, entryId: template.id, commandClass: template.commandClass };
      }
    }
    return NO_MATCH;
  };
}

let recorded: ScriptMatcher | undefined;

/**
 * The matcher over the pin's own record, made once for the bridge's life. A set recorded from
 * another release than the pinned engine's is refused here, so the bridge never starts on it.
 */
export function pagesScriptMatcher(): ScriptMatcher {
  if (recorded === undefined) {
    if (PAGES_SCRIPT_SET.engineVersion !== PAGES_ENGINE_RECORD.version) {
      throw new Error(
        `the script set was recorded from ${PAGES_SCRIPT_SET.engineVersion}; the pin is ${PAGES_ENGINE_RECORD.version}`,
      );
    }
    recorded = createScriptMatcher(PAGES_SCRIPT_SET);
  }
  return recorded;
}
