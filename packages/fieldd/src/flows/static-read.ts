import {
  FLOW_INPUTS_MAX,
  FLOW_LABEL_MAX,
  FLOW_LIMITS,
  FLOW_PHASES_MAX,
  FLOW_READ_CALLS_MAX,
  FLOW_READ_GATES_MAX,
  FLOW_READ_REFUSALS_MAX,
  type FlowCall,
  type FlowGate,
  FlowInputName,
  type FlowMeta,
  FlowRead,
  type FlowReadRefusalReason,
  type FlowRefusal,
  NEEDS_CHOICE_MAX,
  NEEDS_CHOICES_MAX,
  NEEDS_NAME_MAX,
  NEEDS_QUESTION_MAX,
  NEEDS_REASON_MAX,
} from "@vibefield/contracts";
import { type Node, parse } from "acorn";
import { flowScriptOf, type SesShape, sesShapesOf } from "./module-script";

// CP-4a1 (step0-cp4.md §5.1 commit 5; CP4-Q3 (a), ruled 2026-11-04 at the lean; CP4-S4) — the static read: what a
// flow's bytes say, read with acorn and NEVER run. A proposal's card and a library row show this and nothing a spark
// says about its script, since a spark (or anything it read) can say one thing and write another.
// - `meta` is read as plain values only (strings, numbers, booleans, null, arrays and objects of them): its `name`,
//   `phases` and `input`. Anything else in it is not read at all, so `meta.budget` is neither shown nor refused (James,
//   2026-11-02 13:08Z; CP4-S11), whatever it holds.
// - Each `agent(…)` is listed with its agent, model and label where the script writes them plainly, the `phase(…)` it
//   sits in, "in a loop" where it sits in one (a loop statement, or a callback handed to an array's iteration method),
//   and `in` where it sends to a session the run already has. Where the script computes the agent, the model or the
//   label, the call is "chosen as it runs" (`computed`); a template's label reads with "…" where its expressions stand.
//   "In a loop" is the syntax's: a call in a helper that a loop calls is not marked, and the run's call cap
//   (FLOW_LIMITS.CALLS_MAX) is what bounds a script that loops.
// - Each `ask(…)` is listed with its question and choices where written plainly. A gate offers at most
//   NEEDS_CHOICES_MAX choices of the script's own, since Stop the run takes the item's last place (CP4-Q6 (a)), each at
//   most NEEDS_CHOICE_MAX characters on one line and no two the same; any other gate is refused, in words.
// - `unlisted`: the script reaches agents or asks the read cannot list — `agent` or `ask` handed on as a value rather
//   than called, either reached through `globalThis` (or `this`, `self`), a computed member of those, `eval` or
//   `Function`, or more calls than the read lists. The card then says it starts agents it cannot list.
// - Refused, never run: bytes past SCRIPT_MAX_BYTES (`size`), a file that does not parse as a module (`syntax`), a meta
//   missing or not plain where it is read (`meta`), no default function to run (`default`), a gate as above
//   (`choices`). Each refusal is in fieldd's own words, with the line it is on.
// - CP-4a2b (Q-B3 (a)): and the three shapes the run's sandbox refuses in a script's code, a dynamic `import(`
//   (`import`), a direct-looking `eval(` (`eval`), `<!--` or `-->` (`html-comment`). They are read by SES's own tests
//   over the script the run evaluates (module-script.ts, `sesShapesOf`), so the read refuses exactly what the sandbox
//   would, on the line its refusal names, and a person's words that say them (in a string, a template, a regex or a
//   comment) are never refused, since the rewrite takes them out of the text. A file the rewrite itself refuses is
//   not read for them: one that does not parse or has no default is refused here already (`syntax`, `default`); one
//   that imports or re-exports a module, or is not UTF-8, is the run's to refuse, in the rewrite's words.
// The run itself is CP-4a2's, in a child under `ses` (R32): this read evaluates nothing.

type AnyNode = Node & Record<string, unknown>;

/** The names the flow API gives a script; `agent` and `ask` are the ones the read lists. */
const AGENT = "agent";
const ASK = "ask";
const PHASE = "phase";
/** The globals a script could reach the flow API through, by name. */
const GLOBAL_OBJECTS = new Set(["globalThis", "self", "window", "global"]);
/** An array's iteration methods: a callback handed to one runs once per element, as a loop does. */
const ITERATION_METHODS = new Set([
  "map",
  "flatMap",
  "forEach",
  "filter",
  "reduce",
  "reduceRight",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "from",
]);
const LOOPS = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);
const FUNCTIONS = new Set(["FunctionExpression", "ArrowFunctionExpression", "FunctionDeclaration"]);
/** The nodes whose `key` is a name, not a reference, unless it is computed. */
const KEYED = new Set(["Property", "MethodDefinition", "PropertyDefinition"]);

/** Read a flow's bytes without running them. */
export function readFlow(source: Uint8Array | string): FlowRead {
  const size = typeof source === "string" ? Buffer.byteLength(source, "utf8") : source.byteLength;
  if (size > FLOW_LIMITS.SCRIPT_MAX_BYTES)
    return refusedWhole(
      "size",
      `it is ${size} bytes; a flow's script is at most 64 KiB (${FLOW_LIMITS.SCRIPT_MAX_BYTES} bytes)`,
    );
  const text = typeof source === "string" ? source : Buffer.from(source).toString("utf8");
  let program: AnyNode;
  try {
    program = parse(text, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
    }) as unknown as AnyNode;
  } catch (error) {
    const loc = (error as { loc?: { line?: number } }).loc;
    const message = String((error as Error).message ?? error).replace(/\s*\(\d+:\d+\)\s*$/, "");
    return refusedWhole(
      "syntax",
      `it does not parse as a module: ${message}`,
      typeof loc?.line === "number" ? loc.line : undefined,
    );
  }
  const script = flowScriptOf(typeof source === "string" ? Buffer.from(source, "utf8") : source);
  return new Reader(program, script.kind === "script" ? sesShapesOf(script.script) : []).read();
}

/** The sandbox's three shapes, in the read's own words (CP-4a2b, Q-B3 (a); DESIGN.md §9 "What a flow's read refuses"). */
const SANDBOX_WORDS: Readonly<Record<SesShape, string>> = {
  import: "it calls import(), which a flow may not",
  eval: "it calls eval(), which a flow may not",
  "html-comment": "it has <!-- or --> in its code, which a flow may not",
};

function refusedWhole(reason: FlowReadRefusalReason, words: string, line?: number): FlowRead {
  return FlowRead.parse({
    calls: [],
    gates: [],
    unlisted: false,
    refusals: [refusal(reason, words, line)],
  });
}

function refusal(reason: FlowReadRefusalReason, words: string, line?: number): FlowRefusal {
  return {
    reason,
    words: cut(words, NEEDS_REASON_MAX),
    ...(line !== undefined ? { line } : {}),
  };
}

/** Said on one line, cut at `max` with "…". */
function cut(words: string, max: number): string {
  const line = words.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

function lineOf(node: Node): number {
  return node.loc?.start.line ?? 1;
}

function isNode(value: unknown): value is AnyNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function isIdentifier(node: unknown, name?: string): node is AnyNode & { name: string } {
  return isNode(node) && node.type === "Identifier" && (name === undefined || node.name === name);
}

/** A string the script writes plainly: a string literal, or a template with no expression. */
function plainString(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && (node.expressions as unknown[]).length === 0)
    return templateText(node);
  return undefined;
}

/** A template's text, "…" where each expression stands. */
function templateText(node: AnyNode): string {
  const quasis = node.quasis as AnyNode[];
  return quasis
    .map((quasi) => quasi.value as { cooked?: string | null; raw: string })
    .map((value) => value.cooked ?? value.raw)
    .join("…");
}

/** A plain value of meta (or none, with the reason it is not). */
type Plain = { value: unknown } | { not: true };

function plainValue(node: unknown): Plain {
  if (!isNode(node)) return { not: true };
  switch (node.type) {
    case "Literal":
      return node.regex !== undefined || typeof node.value === "bigint"
        ? { not: true }
        : { value: node.value };
    case "TemplateLiteral":
      return (node.expressions as unknown[]).length === 0
        ? { value: templateText(node) }
        : { not: true };
    case "UnaryExpression": {
      const argument = node.argument as AnyNode;
      return node.operator === "-" &&
        argument.type === "Literal" &&
        typeof argument.value === "number"
        ? { value: -argument.value }
        : { not: true };
    }
    case "ArrayExpression": {
      const values: unknown[] = [];
      for (const element of node.elements as unknown[]) {
        const plain = plainValue(element);
        if ("not" in plain) return plain;
        values.push(plain.value);
      }
      return { value: values };
    }
    case "ObjectExpression": {
      const object: Record<string, unknown> = {};
      for (const property of node.properties as AnyNode[]) {
        const key = propertyKey(property);
        if (key === undefined || property.kind !== "init" || property.method === true)
          return { not: true };
        const plain = plainValue(property.value);
        if ("not" in plain) return plain;
        object[key] = plain.value;
      }
      return { value: object };
    }
    default:
      return { not: true };
  }
}

/** A property's name where the script writes it plainly (`name:`, `"name":`), else undefined (computed, a spread). */
function propertyKey(property: AnyNode): string | undefined {
  if (property.type !== "Property" || property.computed === true) return undefined;
  const key = property.key as AnyNode;
  if (key.type === "Identifier") return key.name as string;
  if (key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number"))
    return String(key.value);
  return undefined;
}

/** Where the walk is: the phase a call sits in, and whether it sits in a loop. */
interface Place {
  readonly phase: string | undefined;
  readonly inLoop: boolean;
}

class Reader {
  readonly #calls: FlowCall[] = [];
  readonly #gates: FlowGate[] = [];
  readonly #refusals: FlowRefusal[] = [];
  #unlisted = false;
  /** the CallExpressions whose callee is the flow API's own name, so the walk knows that identifier is called */
  readonly #called = new WeakSet<object>();

  constructor(
    private readonly program: AnyNode,
    /** where the rewritten script holds a shape the sandbox refuses (module-script.ts, `sesShapesOf`) */
    private readonly sandboxShapes: readonly { readonly shape: SesShape; readonly line: number }[],
  ) {}

  read(): FlowRead {
    const meta = this.#meta();
    this.#defaultExport();
    this.#walk(this.program, { phase: undefined, inLoop: false });
    for (const { shape, line } of this.sandboxShapes)
      this.#refuse(shape, SANDBOX_WORDS[shape], line);
    return FlowRead.parse({
      ...(meta !== undefined ? { meta } : {}),
      calls: this.#calls,
      gates: this.#gates,
      unlisted: this.#unlisted,
      refusals: this.#refusals.slice(0, FLOW_READ_REFUSALS_MAX),
    });
  }

  #refuse(reason: FlowReadRefusalReason, words: string, line?: number): void {
    this.#refusals.push(refusal(reason, words, line));
  }

  /** The top-level statements, with a module's exports unwrapped to their declarations. */
  #topLevel(): AnyNode[] {
    return this.program.body as AnyNode[];
  }

  /** The `const <name> = …` a top-level statement declares, if any. */
  #topLevelInit(name: string): AnyNode | undefined {
    for (const statement of this.#topLevel()) {
      const declaration =
        statement.type === "ExportNamedDeclaration"
          ? (statement.declaration as AnyNode)
          : statement;
      if (!isNode(declaration) || declaration.type !== "VariableDeclaration") continue;
      for (const declarator of declaration.declarations as AnyNode[])
        if (isIdentifier(declarator.id, name) && isNode(declarator.init)) return declarator.init;
    }
    return undefined;
  }

  /** Whether the module exports `name`: `export const name …`, or `export { name }` of a top-level binding. */
  #exports(name: string): boolean {
    for (const statement of this.#topLevel()) {
      if (statement.type !== "ExportNamedDeclaration") continue;
      const declaration = statement.declaration as AnyNode | null;
      if (isNode(declaration) && declaration.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations as AnyNode[])
          if (isIdentifier(declarator.id, name)) return true;
      }
      if (statement.source === null || statement.source === undefined)
        for (const specifier of (statement.specifiers as AnyNode[] | undefined) ?? []) {
          const exported = specifier.exported as AnyNode;
          const local = specifier.local as AnyNode;
          if (
            (isIdentifier(exported, name) || plainString(exported) === name) &&
            isIdentifier(local, name)
          )
            return true;
        }
    }
    return false;
  }

  /** meta's name, phases and input, read as plain values; anything else in it is not read (CP4-S11). */
  #meta(): FlowMeta | undefined {
    const init = this.#exports("meta") ? this.#topLevelInit("meta") : undefined;
    if (init === undefined) {
      this.#refuse("meta", "it exports no meta");
      return undefined;
    }
    const line = lineOf(init);
    if (init.type !== "ObjectExpression") {
      this.#refuse("meta", "its meta is not plain values", line);
      return undefined;
    }
    const fields = new Map<string, AnyNode>();
    for (const property of init.properties as AnyNode[]) {
      const key = propertyKey(property);
      // a spread or a computed key could carry a name, phases or an input the read cannot see
      if (key === undefined) {
        this.#refuse("meta", "its meta is not plain values: a field is computed", lineOf(property));
        return undefined;
      }
      fields.set(key, property);
    }
    const fieldValue = (field: string): Plain | undefined => {
      const property = fields.get(field);
      if (property === undefined) return undefined;
      if (property.kind !== "init" || property.method === true) return { not: true };
      return plainValue(property.value);
    };
    let ok = true;
    const meta: Record<string, unknown> = {};

    const name = fieldValue("name");
    if (name === undefined) {
      this.#refuse("meta", "its meta names no flow", line);
      ok = false;
    } else if ("not" in name) {
      this.#refuse(
        "meta",
        "its meta is not plain values: name is computed",
        lineOf(fields.get("name")!),
      );
      ok = false;
    } else if (typeof name.value !== "string" || name.value.trim() === "") {
      this.#refuse("meta", "its meta's name is not words", lineOf(fields.get("name")!));
      ok = false;
    } else if (name.value.length > NEEDS_NAME_MAX) {
      this.#refuse(
        "meta",
        `its name is longer than ${NEEDS_NAME_MAX} characters`,
        lineOf(fields.get("name")!),
      );
      ok = false;
    } else meta.name = name.value;

    const phases = fieldValue("phases");
    if (phases !== undefined) {
      const at = lineOf(fields.get("phases")!);
      if ("not" in phases) {
        this.#refuse("meta", "its meta is not plain values: phases is computed", at);
        ok = false;
      } else if (
        !Array.isArray(phases.value) ||
        phases.value.some(
          (phase) => typeof phase !== "string" || phase === "" || phase.length > FLOW_LABEL_MAX,
        )
      ) {
        this.#refuse("meta", "its meta's phases are not a list of names", at);
        ok = false;
      } else if (phases.value.length > FLOW_PHASES_MAX) {
        this.#refuse("meta", `it lists more than ${FLOW_PHASES_MAX} phases`, at);
        ok = false;
      } else meta.phases = phases.value;
    }

    const input = fieldValue("input");
    if (input !== undefined) {
      const at = lineOf(fields.get("input")!);
      const value = "not" in input ? undefined : input.value;
      if ("not" in input) {
        this.#refuse("meta", "its meta is not plain values: input is computed", at);
        ok = false;
      } else if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        Object.entries(value).some(
          ([key, kind]) =>
            !FlowInputName.safeParse(key).success ||
            typeof kind !== "string" ||
            kind === "" ||
            kind.length > 32,
        )
      ) {
        this.#refuse("meta", "its meta's input is not names and kinds", at);
        ok = false;
      } else if (Object.keys(value).length > FLOW_INPUTS_MAX) {
        this.#refuse("meta", `it names more than ${FLOW_INPUTS_MAX} inputs`, at);
        ok = false;
      } else meta.input = value;
    }
    return ok ? (meta as FlowMeta) : undefined;
  }

  /** The default export must be a function to run: declared there, or a top-level function it names. */
  #defaultExport(): void {
    const statement = this.#topLevel().find((node) => node.type === "ExportDefaultDeclaration");
    if (statement === undefined) {
      this.#refuse("default", "it exports no default function to run");
      return;
    }
    const declaration = statement.declaration as AnyNode;
    if (FUNCTIONS.has(declaration.type)) return;
    if (isIdentifier(declaration)) {
      const name = declaration.name;
      const declared = this.#topLevel().some(
        (node) => node.type === "FunctionDeclaration" && isIdentifier(node.id, name),
      );
      const init = this.#topLevelInit(name);
      if (declared || (init !== undefined && FUNCTIONS.has(init.type))) return;
    }
    this.#refuse("default", "its default export is not a function", lineOf(statement));
  }

  /** Every node, in source order, knowing the phase and loop it sits in. */
  #walk(node: AnyNode, place: Place): void {
    if (node.type === "CallExpression" || node.type === "NewExpression") {
      this.#call(node, place);
      return;
    }
    if (node.type === "Identifier") {
      this.#reference(node);
      return;
    }
    if (node.type === "MemberExpression") {
      this.#member(node, place);
      return;
    }
    if (LOOPS.has(node.type)) {
      this.#loop(node, place);
      return;
    }
    // a property's own name is not a reference (`{ agent: "codex" }` names an option, not the API)
    if (KEYED.has(node.type) && node.computed !== true) {
      this.#children(node, place, new Set(["key"]));
      return;
    }
    this.#children(node, place);
  }

  #children(node: AnyNode, place: Place, skip: ReadonlySet<string> = new Set()): void {
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || skip.has(key)) continue;
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) this.#walk(child, place);
      } else if (isNode(value)) this.#walk(value, place);
    }
  }

  /** A loop's body (and its test and update) runs again and again; a `for`'s init and a `for…of`'s list run once. */
  #loop(node: AnyNode, place: Place): void {
    const once = node.type === "ForStatement" ? "init" : "right";
    if (isNode(node[once])) this.#walk(node[once] as AnyNode, place);
    this.#children(node, { ...place, inLoop: true }, new Set([once]));
  }

  /** A name of the flow API used anywhere but as a call's callee is handed on, so the read cannot list what it does. */
  #reference(node: AnyNode): void {
    if ((node.name === AGENT || node.name === ASK) && !this.#called.has(node))
      this.#unlisted = true;
  }

  /** `globalThis.agent`, `self["ask"]`, `globalThis[name]`, `this.agent`: the API reached around the read. */
  #member(node: AnyNode, place: Place): void {
    const object = node.object as AnyNode;
    const property = node.property as AnyNode;
    const onGlobal =
      object.type === "ThisExpression" ||
      (isIdentifier(object) && GLOBAL_OBJECTS.has(object.name as string));
    if (onGlobal) {
      const name = node.computed === true ? plainString(property) : (property.name as string);
      if (name === undefined || name === AGENT || name === ASK) this.#unlisted = true;
    }
    this.#walk(object, place);
    // a property's name is not a reference (`x.agent` is not the API)
    if (node.computed === true) this.#walk(property, place);
  }

  #call(node: AnyNode, place: Place): void {
    const callee = node.callee as AnyNode;
    const args = node.arguments as AnyNode[];
    if (node.type === "CallExpression" && isIdentifier(callee)) {
      const name = callee.name as string;
      if (name === AGENT || name === ASK) {
        this.#called.add(callee);
        if (name === AGENT) this.#agent(node, args, place);
        else this.#ask(node, args, place);
        for (const arg of args) this.#walk(arg, place);
        return;
      }
      if (name === "eval") this.#unlisted = true;
      if (name === PHASE) {
        const phase = plainString(args[0]);
        for (const [index, arg] of args.entries())
          this.#walk(
            arg,
            index === 1 && FUNCTIONS.has(arg.type) && phase !== undefined
              ? { ...place, phase: cut(phase, FLOW_LABEL_MAX) }
              : place,
          );
        return;
      }
    }
    if (isIdentifier(callee, "Function")) this.#unlisted = true;
    // `items.map(x => agent(…))`: the callback runs once per element
    const iterates =
      node.type === "CallExpression" &&
      callee.type === "MemberExpression" &&
      callee.computed !== true &&
      ITERATION_METHODS.has((callee.property as AnyNode).name as string);
    this.#walk(callee, place);
    for (const arg of args)
      this.#walk(arg, iterates && FUNCTIONS.has(arg.type) ? { ...place, inLoop: true } : place);
  }

  #agent(node: AnyNode, args: AnyNode[], place: Place): void {
    if (this.#calls.length >= FLOW_READ_CALLS_MAX) {
      this.#unlisted = true;
      return;
    }
    const call: Record<string, unknown> = { line: lineOf(node) };
    if (place.phase !== undefined) call.phase = place.phase;
    if (place.inLoop) call.inLoop = true;
    const opts = args[1];
    let computed = args.some((arg) => arg.type === "SpreadElement");
    if (opts !== undefined && !computed) {
      if (opts.type !== "ObjectExpression") computed = true;
      else
        for (const property of opts.properties as AnyNode[]) {
          const key = propertyKey(property);
          if (key === undefined) {
            // a spread or a computed key may set the agent, the model or the label
            computed = true;
            continue;
          }
          if (key === "in") {
            call.in = true;
            continue;
          }
          if (key !== "agent" && key !== "model" && key !== "label") continue;
          const value = property.value as AnyNode;
          const plain = plainString(value);
          if (plain !== undefined) {
            // written plainly: shown on one line, cut at the wire's bound; an empty one names nothing
            const max = key === "agent" ? 64 : key === "model" ? 128 : FLOW_LABEL_MAX;
            const shown = cut(plain, max);
            if (shown !== "") call[key] = shown;
            continue;
          }
          computed = true;
          if (key === "label" && value.type === "TemplateLiteral") {
            const shown = cut(templateText(value), FLOW_LABEL_MAX);
            if (shown !== "") call.label = shown;
          }
        }
    }
    if (computed) call.computed = true;
    this.#calls.push(call as FlowCall);
  }

  #ask(node: AnyNode, args: AnyNode[], place: Place): void {
    const line = lineOf(node);
    const gate: Record<string, unknown> = { line };
    if (place.phase !== undefined) gate.phase = place.phase;
    if (place.inLoop) gate.inLoop = true;
    let computed = args.some((arg) => arg.type === "SpreadElement");
    const question = plainString(args[0]);
    if (question !== undefined && question.trim() !== "")
      gate.question = cut(question, NEEDS_QUESTION_MAX);
    else computed = true;
    const choices = args[1];
    if (choices?.type === "ArrayExpression") {
      const elements = choices.elements as (AnyNode | null)[];
      const words = elements.map((element) => plainString(element));
      const spread = elements.some(
        (element) => element === null || element.type === "SpreadElement",
      );
      if (!spread && elements.length > NEEDS_CHOICES_MAX) {
        this.#refuse(
          "choices",
          `an ask offers ${elements.length} choices; a gate takes at most ${NEEDS_CHOICES_MAX}`,
          line,
        );
      } else if (!spread && elements.length === 0) {
        this.#refuse("choices", "an ask offers no choice", line);
      } else if (spread || words.some((word) => word === undefined)) {
        computed = true;
      } else {
        const plain = words as string[];
        if (plain.some((word) => word.trim() === "" || /[\r\n]/.test(word)))
          this.#refuse("choices", "an ask's choice is not one line of words", line);
        else if (plain.some((word) => word.length > NEEDS_CHOICE_MAX))
          this.#refuse(
            "choices",
            `an ask's choice is longer than ${NEEDS_CHOICE_MAX} characters`,
            line,
          );
        else if (new Set(plain).size !== plain.length)
          this.#refuse("choices", "an ask offers the same choice twice", line);
        else gate.choices = plain;
      }
    } else computed = true;
    if (computed) gate.computed = true;
    if (this.#gates.length >= FLOW_READ_GATES_MAX) {
      this.#unlisted = true;
      return;
    }
    this.#gates.push(gate as FlowGate);
  }
}
