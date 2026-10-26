// BP-D7 (thinking-browser-profile.md §3·6) — `smoke:profile`'s judging, from outside the packaged app: the desk profile
// directories' names (BP-D6), the fixture that sets the witness cookie, the verdict over the two `Cookies` databases, the
// run keychain and the shell's own profile, and what never reaches the app's environment (EL7). The physical run needs a
// package and a window (the interaction class); these pin what it must SEE to be green.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appEnv,
  cookiesDbOf,
  DESK_REF,
  judge,
  profileDirName,
  serveFixture,
  WITNESS,
} from "../../../apps/desktop/packaging/run-browser-profile-smoke.mjs";

const VALUE = "0123456789abcdef0123456789abcdef";
const enc = { host: "127.0.0.1", name: WITNESS, value: "", vlen: 0, eprefix: "763130", elen: 47 };
const plain = { host: "127.0.0.1", name: WITNESS, value: VALUE, vlen: 32, eprefix: "", elen: 0 };
const green = {
  value: VALUE,
  packaged: { db: "/p/Cookies", present: true, rows: [enc] },
  unpackaged: { db: "/u/Cookies", present: true, rows: [plain] },
  packagedBytesHoldValue: false,
  keychainHasItem: true,
  shellRows: [],
  heard: { seed: true, packaged: true },
};

test("the desk profile's two directory names are BP-D6's: the unpackaged one is PT-4's digest, the packaged one another", () => {
  const pt4 = createHash("sha256")
    .update("persistent")
    .update("\0")
    .update("desk")
    .digest("hex")
    .slice(0, 40);
  assert.equal(DESK_REF, "desk");
  assert.equal(profileDirName(false), pt4);
  assert.match(profileDirName(true), /^[a-f0-9]{40}$/);
  assert.notEqual(profileDirName(true), pt4);
});

test("green: the packaged witness encrypted (empty value, v10), its bytes nowhere in the file, the control plaintext, the key in the run keychain, the shell clean", () => {
  assert.deepEqual(judge(green), { ok: true, problems: [] });
});

test("each way the witness fails is said in words", () => {
  const cases = [
    [
      { packaged: { db: "/p/Cookies", present: true, rows: [{ ...enc, value: VALUE, vlen: 32 }] } },
      /PLAINTEXT/,
    ],
    [
      { packaged: { db: "/p/Cookies", present: true, rows: [{ ...enc, eprefix: "763131" }] } },
      /not v10/,
    ],
    [{ packaged: { db: "/p/Cookies", present: false, rows: [] } }, /packaged profile holds no/],
    [{ packagedBytesHoldValue: true }, /bytes appear in the packaged Cookies/],
    [
      { unpackaged: { db: "/u/Cookies", present: true, rows: [{ ...plain, value: "x" }] } },
      /control did not hold/,
    ],
    [{ keychainHasItem: false }, /U2: the run keychain/],
    [{ shellRows: [plain] }, /shell's own profile/],
    [{ heard: { seed: true, packaged: false } }, /U1: .*never a reason to inject input/],
    [{ heard: { seed: false, packaged: true } }, /phase A/],
  ];
  for (const [patch, said] of cases) {
    const v = judge({ ...green, ...patch });
    assert.equal(v.ok, false, JSON.stringify(patch));
    assert.ok(
      v.problems.some((p) => said.test(p)),
      `${JSON.stringify(patch)} → ${v.problems.join(" | ")}`,
    );
  }
});

test("the fixture sets the witness to the asked value, refuses any other shape, and logs every request with its Cookie header", async () => {
  const f = await serveFixture();
  try {
    const ok = await fetch(`${f.origin}/seed?v=${VALUE}`, { headers: { cookie: "a=b" } });
    assert.equal(ok.status, 200);
    assert.match(
      ok.headers.get("set-cookie") ?? "",
      new RegExp(`^${WITNESS}=${VALUE}; Path=/; Max-Age=\\d+; SameSite=Lax$`),
    );
    assert.equal((await fetch(`${f.origin}/seed?v=NOT-HEX`)).status, 400);
    assert.equal((await fetch(`${f.origin}/elsewhere`)).status, 404);
    assert.deepEqual(
      f.requests.map((r) => [r.path, r.v, r.cookie]),
      [
        ["/seed", VALUE, "a=b"],
        ["/seed", "NOT-HEX", ""],
        ["/elsewhere", null, ""],
      ],
    );
  } finally {
    await f.close();
  }
});

test("EL7: the packaged app's environment carries no secret, no Node override, no keep switch — and the run's HOME, root and mark", () => {
  const env = appEnv(
    {
      PATH: "/usr/bin",
      VIBEFIELD_RELEASE_SECRET: "s",
      VIBEFIELD_BUNDLED_INDEX_SECRET: "s",
      VIBEFIELD_SMOKE_BUNDLED_SECRET: "s",
      VIBEFIELD_REGISTRY_SECRET: "s",
      NODE_OPTIONS: "--require x",
      ELECTRON_RUN_AS_NODE: "1",
      VF_SMOKE_KEEP_ROOT: "1",
    },
    { home: "/run/home", fieldd: "/tmp/vf-smoke-x", mark: "vf-bp-1" },
  );
  for (const k of [
    "VIBEFIELD_RELEASE_SECRET",
    "VIBEFIELD_BUNDLED_INDEX_SECRET",
    "VIBEFIELD_SMOKE_BUNDLED_SECRET",
    "VIBEFIELD_REGISTRY_SECRET",
    "NODE_OPTIONS",
    "ELECTRON_RUN_AS_NODE",
    "VF_SMOKE_KEEP_ROOT",
  ])
    assert.equal(env[k], undefined, k);
  assert.equal(env.HOME, "/run/home");
  assert.equal(env.FIELDD_DATA_DIR, "/tmp/vf-smoke-x");
  assert.equal(env.PATH, "/usr/bin");
});

test("the judge reads the cookie database where Chromium wrote it: Network/Cookies, else Cookies, else the newer path", () => {
  const dir = mkdtempSync(join(tmpdir(), "vf-bp-cookies-"));
  try {
    assert.equal(cookiesDbOf(dir), join(dir, "Network", "Cookies"));
    writeFileSync(join(dir, "Cookies"), "");
    assert.equal(cookiesDbOf(dir), join(dir, "Cookies"));
    mkdirSync(join(dir, "Network"));
    writeFileSync(join(dir, "Network", "Cookies"), "");
    assert.equal(cookiesDbOf(dir), join(dir, "Network", "Cookies"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
