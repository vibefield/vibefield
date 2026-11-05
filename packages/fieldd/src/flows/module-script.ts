import { type Node, parse } from "acorn";

// CP-4a2a (CP4-S4 (a)) — the approved bytes, an ES module (`export const meta`, `export default`), rewritten by acorn
// into ONE script a compartment evaluates: the module's own text, its exports turned into plain bindings, inside an
// async function that returns the default export, so its lines keep their numbers and a top-level `await` stays valid.
// fieldd's side: the host never parses (wall R32 keeps acorn out of the child).
//
// The forms the static read accepts (static-read.ts) are the forms rewritten: `export const meta = …` (the `export`
// dropped), `export { meta }` (dropped, its lines kept as blank lines), and a default export that is a function, a
// class, or a name bound to one. A flow imports nothing (its API is the compartment's globals, `agent`, `ask`, `log`
// and `phase`), so an `import` or a re-export is refused here, before any host starts; a dynamic `import()` is SES's to
// refuse when the host evaluates it.

/** The bytes as a script the host evaluates, or why fieldd will not hand them on. */
export type FlowScript =
  | { readonly kind: "script"; readonly script: string }
  | { readonly kind: "refused"; readonly reason: string };

/** The name a default export that is not a named declaration is bound to inside the script. */
const DEFAULT_BINDING = "__vibefieldFlowDefault";

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

type AnyNode = Node & {
  declaration?: (Node & { id?: { name: string } | null }) | null;
  source?: Node | null;
};

const refused = (reason: string): FlowScript => ({ kind: "refused", reason });

/** The newlines of `text`, so a statement taken out keeps the lines after it where they were. */
const linesOf = (text: string): string => text.replace(/[^\n]/g, "");

/** Rewrite the approved bytes. */
export function flowScriptOf(bytes: Uint8Array): FlowScript {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return refused("it is not UTF-8 text");
  }
  // a `#!` line is a comment to the module, and would not be one after the script's first characters
  if (text.startsWith("#!")) text = `//${text.slice(2)}`;
  let program: { body: AnyNode[] };
  try {
    program = parse(text, { ecmaVersion: "latest", sourceType: "module" }) as unknown as {
      body: AnyNode[];
    };
  } catch (error) {
    return refused(`it does not parse: ${error instanceof Error ? error.message : String(error)}`);
  }

  const edits: Edit[] = [];
  let defaultName: string | undefined;
  for (const node of program.body) {
    switch (node.type) {
      case "ImportDeclaration":
        return refused(
          "it imports a module; a flow imports nothing (its API is agent, ask, log and phase)",
        );
      case "ExportAllDeclaration":
        return refused("it re-exports another module");
      case "ExportNamedDeclaration": {
        if (node.source !== undefined && node.source !== null)
          return refused("it re-exports another module");
        const declaration = node.declaration;
        if (declaration !== undefined && declaration !== null)
          edits.push({ start: node.start, end: declaration.start, text: "" });
        else
          edits.push({
            start: node.start,
            end: node.end,
            text: linesOf(text.slice(node.start, node.end)),
          });
        break;
      }
      case "ExportDefaultDeclaration": {
        const declaration = node.declaration;
        if (declaration === undefined || declaration === null)
          return refused("its default export is not a function");
        const named =
          (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") &&
          declaration.id !== undefined &&
          declaration.id !== null;
        if (named && declaration.id) {
          edits.push({ start: node.start, end: declaration.start, text: "" });
          defaultName = declaration.id.name;
        } else {
          edits.push({
            start: node.start,
            end: declaration.start,
            text: `const ${DEFAULT_BINDING} = `,
          });
          edits.push({ start: declaration.end, end: declaration.end, text: ";" });
          defaultName = DEFAULT_BINDING;
        }
        break;
      }
    }
  }
  if (defaultName === undefined) return refused("it exports no default function to run");

  let body = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start))
    body = body.slice(0, edit.start) + edit.text + body.slice(edit.end);
  // the opening stays on the module's first line, so every line keeps its number
  return { kind: "script", script: `(async () => {${body}\nreturn ${defaultName};\n})()` };
}
