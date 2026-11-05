import { type Comment, type Node, parse, type Token, tokTypes } from "acorn";

// CP-4a2a (CP4-S4 (a)) — the approved bytes, an ES module (`export const meta`, `export default`), rewritten by acorn
// into ONE script a compartment evaluates: the module's own text, its exports turned into plain bindings, inside an
// async function that returns the default export, so its lines keep their numbers and a top-level `await` stays valid.
// fieldd's side: the host never parses (wall R32 keeps acorn out of the child).
//
// The forms the static read accepts (static-read.ts) are the forms rewritten: `export const meta = …` (the `export`
// dropped), `export { meta }` (dropped, its lines kept as blank lines), and a default export that is a function, a
// class, or a name bound to one, parenthesized or not (finding 6: the parse keeps its parentheses). Whatever an export
// takes out keeps its line breaks, so `export` alone on its line moves no later line (finding 10). A flow imports
// nothing (its API is the compartment's globals, `agent`, `ask`, `log` and `phase`), so an `import` or a re-export is
// refused here, before any host starts; a real dynamic `import()` or direct `eval(…)` is left as written, for SES to
// refuse when the host evaluates it, with its line (the lines are kept, so SES's line is the file's).
//
// SES refuses a source whose TEXT looks like `import(` (or `import //`, `import /*`), a direct `eval(`, `<!--` or
// `-->`, wherever it stands, strings and comments included (ses 2.3.0, transforms.js and compartment-evaluate.js). A
// person's words in a prompt say such things ("replace the dynamic import()", "A --> B"), so the rewrite takes them
// out of the text and never out of the values (the review bth-1142Z, finding 5; not SES's `__evade*` options). acorn's
// tokens tell a person's words from code, so only words are rewritten:
// - a string literal holding one is written again with an escape in its place: its value is byte-identical;
// - a template's part holding one is split by an empty substitution, `${""}`, in its place: its value is identical,
//   and so is String.raw's;
// - a regex literal holding one becomes `new RegExp(source, flags)`, its source and flags as such strings;
// - a comment's text is blanked, its line breaks kept (a comment with none becomes one space).

/** The bytes as a script the host evaluates, or why fieldd will not hand them on. */
export type FlowScript =
  | { readonly kind: "script"; readonly script: string }
  | { readonly kind: "refused"; readonly reason: string };

/** The name a default export that is not a named declaration is bound to inside the script. */
const DEFAULT_BINDING = "__vibefieldFlowDefault";

/** SES's own three source tests (ses 2.3.0): an HTML-like comment, a dynamic import, and a direct-looking eval.
 * Sticky-free and global-free, so no test leaves a `lastIndex` behind; `cutsOf` makes its own global copies. */
const SES_HTML = /<!--|-->/;
const SES_IMPORT = /(^|[^.]|\.\.\.)\bimport(?=\s*(?:\(|\/[/*]))/;
const SES_EVAL = /(^|[^.])\beval(?=\s*\()/;

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

/** Whether SES's tests find anything in `text`. */
const sesFinds = (text: string): boolean =>
  [SES_HTML, SES_IMPORT, SES_EVAL].some((test) => test.test(text));

/** Every match of `test` in `text`, from the start. */
const matchesOf = (test: RegExp, text: string) => text.matchAll(new RegExp(test.source, "g"));

/** The places in `text` where one of SES's patterns would be broken by a cut: after an `import` or an `eval` that SES
 * reads as a call, after the `<!` of `<!--`, and after the first `-` of `-->`. */
function cutsOf(text: string): number[] {
  const cuts = new Set<number>();
  for (const match of matchesOf(SES_IMPORT, text))
    cuts.add(match.index + (match[1] ?? "").length + "import".length);
  for (const match of matchesOf(SES_EVAL, text))
    cuts.add(match.index + (match[1] ?? "").length + "eval".length);
  // every place, overlapping ones too ("<!-->" holds both)
  for (let i = text.indexOf("-"); i !== -1; i = text.indexOf("-", i + 1)) {
    if (text.startsWith("<!--", i - 2)) cuts.add(i);
    if (text.startsWith("-->", i)) cuts.add(i + 1);
  }
  return [...cuts].sort((a, b) => a - b);
}

/** `value` as a double-quoted string literal SES finds nothing in: the characters a literal must escape, escaped, and
 * at each cut the character after it written as `\uXXXX`. Its value is `value`, byte for byte. */
function stringLiteralOf(value: string): string {
  const cuts = new Set(cutsOf(value));
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    const char = value[i] ?? "";
    const lone =
      (unit >= 0xd800 && unit <= 0xdbff && !/[\udc00-\udfff]/.test(value[i + 1] ?? "")) ||
      (unit >= 0xdc00 && unit <= 0xdfff && !/[\ud800-\udbff]/.test(value[i - 1] ?? ""));
    if (cuts.has(i) || unit < 0x20 || unit === 0x2028 || unit === 0x2029 || lone)
      out += `\\u${unit.toString(16).padStart(4, "0")}`;
    else if (char === '"' || char === "\\") out += `\\${char}`;
    else out += char;
  }
  return `${out}"`;
}

/** A template's part (its raw text, between its backquote or `}` and its `${` or backquote), cut by an empty
 * substitution at each place SES would read. Cooked and raw, the template's value is unchanged. */
const templatePartOf = (raw: string): string => {
  let out = "";
  let from = 0;
  for (const cut of cutsOf(raw)) {
    out += `${raw.slice(from, cut)}\${""}`;
    from = cut;
  }
  return out + raw.slice(from);
};

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
  const tokens: Token[] = [];
  const comments: Comment[] = [];
  let program: { body: AnyNode[] };
  try {
    program = parse(text, {
      ecmaVersion: "latest",
      sourceType: "module",
      preserveParens: true,
      onToken: tokens,
      onComment: comments,
    }) as unknown as { body: AnyNode[] };
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
        const end =
          declaration !== undefined && declaration !== null ? declaration.start : node.end;
        edits.push({ start: node.start, end, text: linesOf(text.slice(node.start, end)) });
        break;
      }
      case "ExportDefaultDeclaration": {
        const declaration = node.declaration;
        if (declaration === undefined || declaration === null)
          return refused("its default export is not a function");
        const lines = linesOf(text.slice(node.start, declaration.start));
        const named =
          (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") &&
          declaration.id !== undefined &&
          declaration.id !== null;
        if (named && declaration.id) {
          edits.push({ start: node.start, end: declaration.start, text: lines });
          defaultName = declaration.id.name;
        } else {
          edits.push({
            start: node.start,
            end: declaration.start,
            text: `const ${DEFAULT_BINDING} = ${lines}`,
          });
          edits.push({ start: declaration.end, end: declaration.end, text: ";" });
          defaultName = DEFAULT_BINDING;
        }
        break;
      }
    }
  }
  if (defaultName === undefined) return refused("it exports no default function to run");

  // SES's tests read the text, never the values: each string, template part, regex and comment SES would misread is
  // written again with its value kept (an export's span is already its line breaks alone)
  const exported = [...edits];
  const inExport = (start: number, end: number): boolean =>
    exported.some((edit) => start >= edit.start && end <= edit.end && edit.end > edit.start);
  for (const token of tokens) {
    if (inExport(token.start, token.end)) continue;
    const raw = text.slice(token.start, token.end);
    if (!sesFinds(raw)) continue;
    const value = (token as Token & { value?: unknown }).value;
    if (token.type === tokTypes.string && typeof value === "string")
      edits.push({ start: token.start, end: token.end, text: stringLiteralOf(value) });
    else if (token.type === tokTypes.template || token.type === tokTypes.invalidTemplate)
      edits.push({ start: token.start, end: token.end, text: templatePartOf(raw) });
    else if (token.type === tokTypes.regexp && typeof value === "object" && value !== null) {
      const { pattern, flags } = value as { pattern: string; flags: string };
      edits.push({
        start: token.start,
        end: token.end,
        text: ` new RegExp(${stringLiteralOf(pattern)}, ${stringLiteralOf(flags)})`,
      });
    }
  }
  for (const comment of comments) {
    if (inExport(comment.start, comment.end)) continue;
    const lines = linesOf(text.slice(comment.start, comment.end));
    edits.push({ start: comment.start, end: comment.end, text: lines === "" ? " " : lines });
  }

  let body = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end))
    body = body.slice(0, edit.start) + edit.text + body.slice(edit.end);
  // the opening stays on the module's first line, so every line keeps its number
  return { kind: "script", script: `(async () => {${body}\nreturn ${defaultName};\n})()` };
}
