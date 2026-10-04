// The OBJECT rows of `check`'s activation (DK-6; the plan's DK-6 inputs (b), (c), (e)): each
// `contributes.objects` row held to the renderer module the host will import — in plain Node, with NO
// device — by the SDK's KIND-CONFORMANCE HARNESS (DK-7, `@vibefield/plugin-sdk/testing`), the one the
// playground runs, so `check` and the playground cannot disagree about a kind:
//
//  - its DECLARATION (`checkKindDeclaration`): `binding.kind` names a real export of the built module
//    holding an `ObjectBinding` — read off the module's namespace exactly as the host's
//    `objectBindingsFrom` reads it — whose kind is a desk kind (ICE `isObjectKind`) named by the row's
//    type, a tray entry that says how it hangs under a category of 1–64 characters, a row that provides
//    `desk.object`;
//  - its PROGRAM (`checkKindProgram`): the kind's `create` on a RECORDING device that answers every call
//    as WebGPU does short of compiling — its kit pieces exist, its WGSL arrives as TEXT and READS (its
//    entry points and the bindings each stage statically uses, laid in its layouts), its bind groups
//    fill their layouts — then disposed.
//
// THE WGSL ROW IS A PRESENCE-AND-READ CHECK, said plainly (DK-6's open question 1): nothing compiles
// the shader, so an unresolved name or a type error passes here — every kind with shaders carries the
// note `object-wgsl-not-compiled`. The still that would compile it waits on ICE's host-less desk
// (VibeField's ask I30). The STATES are the playground's to drive (`pnpm playground <dir>`).

import type { ObjectContribution } from "@vibefield/contracts";
import {
  checkKindDeclaration,
  checkKindProgram,
  type KindNoteCode,
  type KindRefusalCode,
  type KindVerdict,
} from "@vibefield/plugin-sdk/testing";
import { REFUSAL_CATALOG, type RefusalCode } from "./refusals";
import type { Verdict } from "./verdict";

/** The harness codes `check` can say — its declaration's and its program's (the states are the
 * playground's) — each one in the catalog: a code missing there is a type error here. */
type CheckedCode = Exclude<KindRefusalCode | KindNoteCode, `state-${string}`>;
const CATALOGUED: Readonly<Record<CheckedCode, unknown>> = REFUSAL_CATALOG;

const LEVEL = { pass: "pass", note: "note", refused: "refuse" } as const;

/** One harness verdict as a `check` row: its level, its code (from the catalog), its pointer and
 * what would have passed — the harness's own `expected`, which is specific to the row. */
function asVerdict(v: KindVerdict, type: string): Verdict {
  const code =
    v.code === "ok" ? "ok" : v.code in CATALOGUED ? (v.code as RefusalCode) : "harness-error";
  return {
    level: LEVEL[v.status],
    check: "activation",
    code,
    detail: v.detail.includes(type) ? v.detail : `${type}: ${v.detail}`,
    ...(v.pointer !== undefined ? { pointer: v.pointer } : {}),
    ...(v.status !== "pass" && v.expected !== undefined ? { expected: v.expected } : {}),
  };
}

/** Each object row against the imported module's namespace — the host's reading, before the host. */
export async function checkObjectRows(
  namespace: unknown,
  objects: readonly ObjectContribution[],
): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];
  const exports = (typeof namespace === "object" && namespace !== null ? namespace : {}) as Record<
    string,
    unknown
  >;
  for (const [index, row] of objects.entries()) {
    const binding = exports[row.binding.kind];
    const declaration = checkKindDeclaration(binding, row, `/contributes/objects/${index}`);
    verdicts.push(...declaration.map((v) => asVerdict(v, row.type)));
    // a binding that holds no desk kind has no program to make (the declaration said why)
    if (
      declaration.some(
        (v) => v.code === "object-export-missing" || v.code === "object-kind-invalid",
      )
    )
      continue;
    for (const v of await checkKindProgram(binding)) verdicts.push(asVerdict(v, row.type));
  }
  return verdicts;
}
