// MA-3h — Keep, the short path (James, 2026-11-13 01:29:54Z): `made-app-intents.ts`, the person's kept apps read
// and written over the settings document's root map `madeApps.kept` (contracts' SETTINGS_DOC_SECTIONS.MADE_APPS_KEPT).
// A key is the fold key's sha256: the fold key itself, which may be a hosted URL, never enters a document every
// desktop syncs. Both injected readers (made-app-service's `on`, index-apps-mesh's `onChanged`) are this one object.
// Unit rows over a real SettingsDocService on a temp data dir: no daemon, no mesh.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MADE_APP_LIMITS, SETTINGS_DOC_SECTIONS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { MadeAppKeptIntents, madeAppKeptKey } from "../src/made-app-intents";
import { RpcCallError } from "../src/native-link";
import { SettingsDocService } from "../src/settings-doc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-kept-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function settingsOn(dataDir: string): SettingsDocService {
  const svc = new SettingsDocService({ dataDir });
  cleanup.push(() => svc.dispose());
  return svc;
}

async function intentsOn(settings: SettingsDocService, now = () => 1_000) {
  const intents = await MadeAppKeptIntents.open(settings, { now });
  cleanup.push(() => intents.dispose());
  return intents;
}

const NATIVE = "native:claude-code:review";
const HOSTED = "hosted:https://claude.ai/public/artifacts/0b1c2d3e";

describe("MA-3h — the kept apps over the settings document", () => {
  it("opens only once the document is read, and answers kept for a key already there with no event", async () => {
    const dataDir = tempDataDir();
    const first = settingsOn(dataDir);
    await first.setKept(madeAppKeptKey(NATIVE), true, 500, "test");
    await first.dispose();

    const intents = await intentsOn(settingsOn(dataDir));
    expect(intents.of(NATIVE), "read at open").toEqual({ kept: true });
    expect(intents.of(HOSTED)).toBeUndefined();
    expect(madeAppKeptKey(HOSTED)).toBe(createHash("sha256").update(HOSTED, "utf8").digest("hex"));
  });

  it("keeps by the fold key's digest and never stores the key; a row it cannot read costs that row", async () => {
    const settings = settingsOn(tempDataDir());
    const intents = await intentsOn(settings);
    expect(await intents.mark(HOSTED, true, "test")).toEqual({
      foldKey: HOSTED,
      kept: true,
      hidden: false,
    });
    const stored = JSON.stringify(settings.hostDoc().toJSON());
    expect(stored, "no fold key, no URL").not.toContain("claude.ai");
    expect(stored).toContain(madeAppKeptKey(HOSTED));
    const kept = settings.hostDoc().getMap(SETTINGS_DOC_SECTIONS.MADE_APPS_KEPT);
    kept.set(madeAppKeptKey(NATIVE), "soon");
    kept.set("not-a-digest", 1);
    settings.hostDoc().commit();
    settings.hostOwner().merged?.();
    expect(intents.of(NATIVE), "a value it cannot read is no keep").toBeUndefined();
    expect(intents.of(HOSTED), "the rest stand").toEqual({ kept: true });
    expect(await intents.mark(HOSTED, false, "test")).toEqual({
      foldKey: HOSTED,
      kept: false,
      hidden: false,
    });
    expect(intents.of(HOSTED)).toBeUndefined();
  });

  it("tells both readers when the kept map moves, by a local write or a merge, and never otherwise", async () => {
    const a = settingsOn(tempDataDir());
    const b = settingsOn(tempDataDir());
    const reader = await intentsOn(b);
    const heard: string[] = [];
    const offService = reader.on(() => heard.push("service"));
    const offFold = reader.onChanged(() => heard.push("fold"));
    await reader.mark(NATIVE, true, "test");
    expect(heard, "a local write").toEqual(["service", "fold"]);

    await (await intentsOn(a)).mark(HOSTED, true, "test");
    b.hostDoc().import(a.hostDoc().export({ mode: "update" }));
    b.hostOwner().merged?.();
    expect(heard, "a merge").toEqual(["service", "fold", "service", "fold"]);
    expect(reader.of(HOSTED)).toEqual({ kept: true });

    await b.setAppValue("theme", "dark", "pane");
    b.hostOwner().merged?.();
    expect(heard, "another section moved: nothing to tell").toHaveLength(4);
    offService();
    offFold();
    await reader.mark(HOSTED, false, "test");
    expect(heard, "unsubscribed").toHaveLength(4);
  });

  it("a new fold key past MADE_APP_LIMITS.INTENTS is RESOURCE_EXHAUSTED, not retryable, and writes nothing", async () => {
    const settings = settingsOn(tempDataDir());
    const intents = await intentsOn(settings);
    const kept = settings.hostDoc().getMap(SETTINGS_DOC_SECTIONS.MADE_APPS_KEPT);
    for (let n = 0; n < MADE_APP_LIMITS.INTENTS; n += 1) {
      kept.set(n.toString(16).padStart(64, "0"), 1);
    }
    settings.hostDoc().commit();
    settings.hostOwner().merged?.();
    expect(intents.full(NATIVE, true), "the bound is read before a write").toBe(true);
    expect(intents.full(NATIVE, false), "stopping is never refused").toBe(false);
    const refused = await intents.mark(NATIVE, true, "test").catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RpcCallError);
    expect(refused).toMatchObject({ kind: "RESOURCE_EXHAUSTED", retryable: false });
    expect(kept.keys(), "nothing written").toHaveLength(MADE_APP_LIMITS.INTENTS);
    expect(intents.of(NATIVE)).toBeUndefined();
  });
});
