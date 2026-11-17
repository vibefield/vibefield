import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { CUSTODY, CustodyHandoff } from "@vibefield/contracts";
import { deriveCustody, FIELDD_SIGNING_IDENTIFIER } from "@vibefield/trust";
import { describe, expect, it, vi } from "vitest";
import {
  type CustodyProvider,
  type CustodyProviderOptions,
  createCustodyProvider,
} from "../src/main/custody/provider";
import { fakeDerive, OWN, PLAIN_ROOT, vibefieldTree } from "./custody-fakes";

// OB custody, C1 (CUSTODY-SPEC §7, §2.3) — one user root's custody, as the supervisor is handed it: the hand-off it
// writes on fieldd's stdin, the check it awaits before writing, and the marks it gives back. Nothing but the root is
// stored anywhere: each secret is derived from it under its own label and the user root's real path, so every user
// of an install has secrets of its own. The rows inject the derivation and the child check; one row names trust's.

const OTHER_ROOT = Buffer.alloc(32, 0x5c);

function provider(userRoot: string, extra: Partial<CustodyProviderOptions> = {}): CustodyProvider {
  return createCustodyProvider({
    root: () => PLAIN_ROOT,
    userRoot,
    own: OWN,
    derive: fakeDerive,
    ...extra,
  });
}

describe("a user root's custody (C1)", () => {
  it("the hand-off is three secrets, each derived under its own label and the user root's path", () => {
    const tree = vibefieldTree();
    const userRoot = tree.userRoots[0]!;
    const derive = vi.fn(fakeDerive);
    const handoff = provider(userRoot, { derive }).handoff();

    expect(handoff).toEqual({
      v: 1,
      shell: fakeDerive(PLAIN_ROOT, CUSTODY.LABELS.shell, userRoot),
      pairing: fakeDerive(PLAIN_ROOT, CUSTODY.LABELS.pairing, userRoot),
      records: fakeDerive(PLAIN_ROOT, CUSTODY.LABELS.records, userRoot),
    });
    // the contract's own shape, and with no marks remembered it carries no `expect` at all
    expect(CustodyHandoff.parse(handoff)).toEqual(handoff);
    expect(handoff).not.toHaveProperty("expect");
    expect(derive.mock.calls.map(([, label, context]) => [label, context])).toEqual([
      [CUSTODY.LABELS.shell, userRoot],
      [CUSTODY.LABELS.pairing, userRoot],
      [CUSTODY.LABELS.records, userRoot],
    ]);
    expect(new Set([handoff.shell, handoff.pairing, handoff.records]).size).toBe(3);
  });

  it.skipIf(process.platform === "win32")(
    "the context is the user root's REAL path: a link to it derives the same secrets",
    () => {
      const tree = vibefieldTree();
      const userRoot = tree.userRoots[0]!;
      const alias = join(tree.root, "alias");
      symlinkSync(userRoot, alias);
      expect(provider(alias).handoff()).toEqual(provider(userRoot).handoff());
    },
  );

  it("two users of one install never share a secret, and a user's own never move", () => {
    const tree = vibefieldTree([1, 2]);
    const first = provider(tree.userRoots[0]!);
    const second = provider(tree.userRoots[1]!);
    const a = first.handoff();
    const b = second.handoff();
    expect(new Set([a.shell, a.pairing, a.records, b.shell, b.pairing, b.records]).size).toBe(6);
    expect(first.handoff()).toEqual(a);
  });

  it("the shell's own secret is the hand-off's: adoption pairs with what the spawned fieldd was handed", () => {
    const tree = vibefieldTree();
    const one = provider(tree.userRoots[0]!);
    expect(one.shellSecret()).toBe(one.handoff().shell);
  });

  it("the recipe is trust's deriveCustody over the root, when nothing is injected", () => {
    const tree = vibefieldTree();
    const userRoot = tree.userRoots[0]!;
    const real = createCustodyProvider({ root: () => PLAIN_ROOT, userRoot, own: OWN });
    expect(real.handoff()).toEqual({
      v: 1,
      shell: deriveCustody(PLAIN_ROOT, CUSTODY.LABELS.shell, userRoot),
      pairing: deriveCustody(PLAIN_ROOT, CUSTODY.LABELS.pairing, userRoot),
      records: deriveCustody(PLAIN_ROOT, CUSTODY.LABELS.records, userRoot),
    });
  });

  it("the root is read at each use, so a root that was replaced derives new secrets", () => {
    const tree = vibefieldTree();
    let root = PLAIN_ROOT;
    const one = provider(tree.userRoots[0]!, { root: () => root });
    const before = one.handoff();
    root = OTHER_ROOT;
    const after = one.handoff();
    expect(after.shell).not.toBe(before.shell);
    expect(after.pairing).not.toBe(before.pairing);
    expect(after.records).not.toBe(before.records);
  });

  it("a root that will not open derives nothing: the refusal is the root's own", () => {
    const tree = vibefieldTree();
    const derive = vi.fn(fakeDerive);
    const one = provider(tree.userRoots[0]!, {
      derive,
      root: () => {
        throw new Error("custody is unavailable");
      },
    });
    expect(() => one.handoff()).toThrow("custody is unavailable");
    expect(() => one.shellSecret()).toThrow("custody is unavailable");
    expect(derive).not.toHaveBeenCalled();
  });

  it("the child is asked about as fieldd's own binary, signed by the shell's own team", async () => {
    const tree = vibefieldTree();
    const isOurChild = vi.fn(async () => true);
    const one = provider(tree.userRoots[0]!, { isOurChild });
    expect(await one.verifyChild(4242)).toBe(true);
    expect(isOurChild).toHaveBeenCalledWith(4242, OWN, { identifier: FIELDD_SIGNING_IDENTIFIER });
    isOurChild.mockResolvedValueOnce(false);
    expect(await one.verifyChild(4243)).toBe(false);
  });

  it("noted keeps the highest value per name, and the next hand-off expects it", () => {
    const tree = vibefieldTree();
    const one = provider(tree.userRoots[0]!);
    one.noted({ [CUSTODY.MARK_OBJECT_GRANTS]: 3 });
    one.noted({ [CUSTODY.MARK_OBJECT_GRANTS]: 2, "desk.other": 7 });
    expect(one.handoff().expect).toEqual({ [CUSTODY.MARK_OBJECT_GRANTS]: 3, "desk.other": 7 });
    one.noted({ [CUSTODY.MARK_OBJECT_GRANTS]: 9 });
    expect(one.handoff().expect).toEqual({ [CUSTODY.MARK_OBJECT_GRANTS]: 9, "desk.other": 7 });
    expect(CustodyHandoff.safeParse(one.handoff()).success).toBe(true);
  });

  it("noted takes nothing it could not hand back: a name off the pattern, a value that is no count, a 65th name", () => {
    const tree = vibefieldTree();
    const one = provider(tree.userRoots[0]!);
    one.noted({
      "Not A Mark": 1,
      "": 1,
      negative: -1,
      fraction: 1.5,
      huge: Number.MAX_SAFE_INTEGER + 2,
      text: "7" as unknown as number,
    });
    one.noted(null as unknown as Record<string, number>);
    expect(one.handoff()).not.toHaveProperty("expect");

    const full = Object.fromEntries(
      Array.from({ length: CUSTODY.MARKS_MAX }, (_, index) => [`mark.${index}`, index]),
    );
    one.noted(full);
    one.noted({ "one.more": 1, "mark.0": 5 });
    const kept = one.handoff().expect ?? {};
    expect(Object.keys(kept)).toHaveLength(CUSTODY.MARKS_MAX);
    expect(kept).not.toHaveProperty("one.more");
    // a name it already holds still rises
    expect(kept["mark.0"]).toBe(5);
  });
});
