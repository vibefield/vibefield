/**
 * Item 212 (RV #29) — the field service on the window's status line (DESIGN.md §8 "The status line", amended
 * 2026-11-06; the words at the lean until James rules rv-service-recovery): main's `desktopState.fieldd` said as ONE
 * held notice — "Reconnecting to the field service…" while main starts it again; "VibeField's field service stopped
 * after 3 tries. Your terminal sessions keep running." with Try again once main stopped trying — and withdrawn the
 * moment it is back. Try again asks main to replace the window through the existing door (`field-service`): the
 * reloaded window's bootstrap is the person's ask. The states are contracts' EL9 fixtures, read as the window reads
 * main's desktop state.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FielddLinkUnavailable } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fieldServiceNotice, fieldServiceTeller } from "../src/frame/field-service-notice";
import {
  getStatusNotice,
  resetStatusLineForTest,
  STATUS_STAND_MS,
  statusLineSaid,
} from "../src/frame/status-line";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../contracts/fixtures");
const state = (name: string): FielddLinkUnavailable =>
  FielddLinkUnavailable.parse(
    JSON.parse(readFileSync(join(FIXTURES, `fieldd-link-unavailable.${name}.json`), "utf8")),
  );
const RECOVERING = state("recovering");
const CRASH_LOOP = state("crash-loop");
const UNRESPONSIVE = state("unresponsive");
const STOPPED =
  "VibeField's field service stopped after 3 tries. Your terminal sessions keep running.";
const NOT_RESPONDING =
  "VibeField's field service isn't responding. Your terminal sessions keep running. If it lasts, quit VibeField and open it again.";

beforeEach(() => {
  vi.useFakeTimers();
  resetStatusLineForTest();
});

afterEach(() => {
  resetStatusLineForTest();
  vi.useRealTimers();
});

describe("the field service on the status line (item 212, RV #29)", () => {
  it("holds the stopped notice with Try again, which asks main to replace this window", () => {
    const replaceRenderer = vi.fn(async () => ({ replacing: true }));
    const teller = fieldServiceTeller({ replaceRenderer });
    teller.tell(CRASH_LOOP);
    const notice = getStatusNotice();
    expect(notice?.text).toBe(STOPPED);
    expect(notice?.act?.label).toBe("Try again");
    vi.advanceTimersByTime(STATUS_STAND_MS * 3);
    expect(getStatusNotice()).toBe(notice);
    notice?.act?.run();
    expect(replaceRenderer).toHaveBeenCalledWith("field-service");
  });

  it("holds Reconnecting… with no act while main starts it again, and withdraws it the moment it is back", () => {
    const teller = fieldServiceTeller({ replaceRenderer: vi.fn() });
    teller.tell(RECOVERING);
    expect(getStatusNotice()?.text).toBe("Reconnecting to the field service…");
    expect(getStatusNotice()?.act).toBeUndefined();
    vi.advanceTimersByTime(STATUS_STAND_MS * 3);
    expect(getStatusNotice()?.text).toBe("Reconnecting to the field service…");
    teller.tell(null);
    expect(getStatusNotice()).toBeNull();
  });

  it("moves from Reconnecting… to the stopped notice, one notice at a time", () => {
    const teller = fieldServiceTeller({ replaceRenderer: vi.fn() });
    teller.tell(RECOVERING);
    teller.tell(CRASH_LOOP);
    expect(getStatusNotice()?.text).toBe(STOPPED);
    teller.tell(null);
    expect(getStatusNotice()).toBeNull();
    expect(statusLineSaid().map((said) => said.text)).toEqual([
      "Reconnecting to the field service…",
      STOPPED,
    ]);
  });

  it("says one state once, however often main publishes it", () => {
    const teller = fieldServiceTeller({ replaceRenderer: vi.fn() });
    teller.tell(CRASH_LOOP);
    teller.tell({ ...CRASH_LOOP });
    teller.tell(state("crash-loop"));
    expect(statusLineSaid()).toHaveLength(1);
  });

  it("says nothing for a shell that names no field service, and never guesses a count", () => {
    const teller = fieldServiceTeller({ replaceRenderer: vi.fn() });
    teller.tell(undefined);
    expect(getStatusNotice()).toBeNull();
    teller.tell({ service: "fieldd", state: "crash-loop" });
    expect(getStatusNotice()?.text).toBe(
      "VibeField's field service stopped. Your terminal sessions keep running.",
    );
  });

  it("holds the stopped notice without its act where the host cannot replace the window", () => {
    const teller = fieldServiceTeller({});
    teller.tell(CRASH_LOOP);
    expect(getStatusNotice()?.act).toBeUndefined();
    vi.advanceTimersByTime(STATUS_STAND_MS * 3);
    expect(getStatusNotice()?.text).toBe(STOPPED);
  });

  it("withdraws what it said when the window stops telling", () => {
    const teller = fieldServiceTeller({ replaceRenderer: vi.fn() });
    teller.tell(CRASH_LOOP);
    teller.stop();
    expect(getStatusNotice()).toBeNull();
  });

  it("is the one notice the catalog's plate shows: the words come from the state alone", () => {
    const retry = vi.fn();
    expect(fieldServiceNotice(null, retry)).toBeNull();
    expect(fieldServiceNotice(CRASH_LOOP, retry)).toMatchObject({ text: STOPPED });
    expect(fieldServiceNotice(CRASH_LOOP, retry)?.act?.run).toBe(retry);
    expect(fieldServiceNotice(RECOVERING, retry)?.act).toBeUndefined();
    expect(fieldServiceNotice(UNRESPONSIVE, retry)).toMatchObject({ text: NOT_RESPONDING });
  });
});

// Item 212 (RV #67; DESIGN.md §8 "The status line", amended 2026-11-06, the words at the lean until James rules
// rv-service-recovery) — the field service up and silent: main hears no reply to two asks in a row, and the window
// holds it in plain words, with no act (there is nothing a person's ask would start while it is up).
describe("the field service not responding, on the status line (item 212, RV #67)", () => {
  it("holds Not responding with no act, and withdraws it the moment the field service answers", () => {
    const teller = fieldServiceTeller({ replaceRenderer: vi.fn() });
    teller.tell(UNRESPONSIVE);
    expect(getStatusNotice()?.text).toBe(NOT_RESPONDING);
    expect(getStatusNotice()?.act).toBeUndefined();
    vi.advanceTimersByTime(STATUS_STAND_MS * 3);
    expect(getStatusNotice()?.text).toBe(NOT_RESPONDING);
    teller.tell(null);
    expect(getStatusNotice()).toBeNull();
  });

  it("gives way to Reconnecting… when a field service main started is ended at the bound and does not come back at once", () => {
    const teller = fieldServiceTeller({ replaceRenderer: vi.fn() });
    teller.tell(UNRESPONSIVE);
    teller.tell(RECOVERING);
    teller.tell(null);
    expect(getStatusNotice()).toBeNull();
    expect(statusLineSaid().map((said) => said.text)).toEqual([
      NOT_RESPONDING,
      "Reconnecting to the field service…",
    ]);
  });
});
