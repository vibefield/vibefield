// CP-4a2a (CP4-S4 (a)) — the approved bytes, an ES module (`export const meta`, `export default`), rewritten by acorn
// into ONE script a compartment evaluates: the module's own text, its exports turned into plain bindings, inside an
// async function that returns the default export, so its lines keep their numbers and a top-level `await` stays valid.
// fieldd's side: the host never parses (wall R32 keeps acorn out of the child).
//
// SKELETON (the red, commit 5): every module is refused.

/** The bytes as a script the host evaluates, or why fieldd will not hand them on. */
export type FlowScript =
  | { readonly kind: "script"; readonly script: string }
  | { readonly kind: "refused"; readonly reason: string };

/** Rewrite the approved bytes. */
export function flowScriptOf(_bytes: Uint8Array): FlowScript {
  return { kind: "refused", reason: "the rewrite is not built yet" };
}
