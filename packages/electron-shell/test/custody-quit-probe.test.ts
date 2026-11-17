import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProbeResult } from "@vibefield/fieldd-supervisor";
import { describe, expect, it, vi } from "vitest";
import { createShellCustody } from "../src/main/custody/custody";
import { probeResidentPair } from "../src/main/custody/resident-probe";
import { fakeDerive, fakeKeystore, OWN, vibefieldTree } from "./custody-fakes";

// OB custody, C1 (CUSTODY-SPEC §7; AL-3's quit gate) — a person's quit looks for every other user's resident pair
// with an adopt-only probe. Under `sealed` there is no token file to read: each pair is paired with ITS OWN shell
// secret, derived for that user's root, so one user's secret is never offered at another's door. At `files` the
// probe is the call it was. The supervisor's `tryAdopt` is a fake here: no socket is dialled.

const NO_PAIR: ProbeResult = { ok: false, failure: "no-run-files" };
const adopting = () => vi.fn(async (..._args: unknown[]): Promise<ProbeResult> => NO_PAIR);

function sealedCustody(tree: ReturnType<typeof vibefieldTree>, answers = true) {
  const keystore = fakeKeystore();
  keystore.answers = answers;
  return createShellCustody({
    level: { level: "sealed", own: OWN },
    vibefieldRoot: tree.root,
    keystore: () => keystore,
    userRoots: () => tree.users,
    logRoot: tree.logRoot,
    derive: fakeDerive,
  });
}

describe("the quit gate's look at a resident pair (C1)", () => {
  it("the quit gate probes each resident pair with its own secret", async () => {
    const tree = vibefieldTree([1, 2]);
    const [first, second] = tree.userRoots as [string, string];
    const custody = sealedCustody(tree);
    const adopt = adopting();

    expect(
      await probeResidentPair({ root: first, userId: "user-1", probeMs: 1_500, custody, adopt }),
    ).toBe(NO_PAIR);
    await probeResidentPair({ root: second, userId: "user-2", probeMs: 1_500, custody, adopt });

    const secretOf = (userRoot: string): string => custody.forUserRoot(userRoot)!.handoff().shell;
    expect(adopt.mock.calls).toEqual([
      [
        first,
        1_500,
        undefined,
        undefined,
        "user-1",
        { credential: { kind: "pairing", secret: secretOf(first) } },
      ],
      [
        second,
        1_500,
        undefined,
        undefined,
        "user-2",
        { credential: { kind: "pairing", secret: secretOf(second) } },
      ],
    ]);
    expect(secretOf(first)).not.toBe(secretOf(second));
  });

  it("at `files` the probe is the call it was, and names the token file as its credential", async () => {
    const tree = vibefieldTree();
    const custody = createShellCustody({
      level: { level: "files" },
      vibefieldRoot: tree.root,
      keystore: () => {
        throw new Error("a files build makes no keystore");
      },
      userRoots: () => tree.users,
      logRoot: tree.logRoot,
    });
    const adopt = adopting();
    await probeResidentPair({
      root: tree.userRoots[0]!,
      userId: "user-1",
      probeMs: 1_500,
      custody,
      adopt,
    });
    // the supervisor's probe has no default credential any more: a caller that names none is refused before
    // anything is read or dialled, so the token file is said here, where it is meant
    expect(adopt.mock.calls).toEqual([
      [
        tree.userRoots[0],
        1_500,
        undefined,
        undefined,
        "user-1",
        { credential: { kind: "token-file" } },
      ],
    ]);
  });

  it("no probe leaves its credential to a default: each of the two calls names one", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const probe = readFileSync(
      join(here, "..", "src", "main", "custody", "resident-probe.ts"),
      "utf8",
    );
    const calls = probe.match(/options\.adopt\([^;]*;/gu) ?? [];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('credential: { kind: "token-file" }');
    expect(calls[1]).toContain('credential: { kind: "pairing", secret }');
  });

  it("while the keys will not open no pair is probed: there is no secret to pair with, and no token to fall back on", async () => {
    const tree = vibefieldTree();
    const adopt = adopting();
    expect(
      await probeResidentPair({
        root: tree.userRoots[0]!,
        userId: "user-1",
        probeMs: 1_500,
        custody: sealedCustody(tree, false),
        adopt,
      }),
    ).toBeNull();
    expect(adopt).not.toHaveBeenCalled();
  });

  it("a user root that is gone is not probed", async () => {
    const tree = vibefieldTree();
    const adopt = adopting();
    expect(
      await probeResidentPair({
        root: join(tree.root, "users", "404"),
        userId: "user-404",
        probeMs: 1_500,
        custody: sealedCustody(tree),
        adopt,
      }),
    ).toBeNull();
    expect(adopt).not.toHaveBeenCalled();
  });

  it("main's quit gate asks through it, and nowhere dials a resident pair by hand", () => {
    const main = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main", "index.ts"),
      "utf8",
    );
    expect(main).toContain("probeResidentPair({");
    expect(main).not.toContain("tryAdopt(");
  });
});
