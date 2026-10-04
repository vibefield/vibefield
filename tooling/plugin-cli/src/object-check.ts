// The OBJECT rows of `check`'s activation (DK-6; the plan's DK-6 inputs (b), (c), (e)): each
// `contributes.objects` row held to the renderer module the host will import — in plain Node, with NO
// device. The SHAPE only; DK-7's conformance harness runs a kind's states.
//
//  - the EXPORT: `binding.kind` names a real export of the built module holding an `ObjectBinding` —
//    read off the module's namespace exactly as the host's `objectBindingsFrom` reads it;
//  - the KIND: a desk kind (ICE `isObjectKind`, through the SDK's `/desk` door) whose registry name IS
//    the row's type — the host's two refusals (build-widget.ts), said here before the host says them;
//  - the TRAY ENTRY: where and how it hangs (the schema already demands `hang`; the row says it);
//  - the WGSL: the kind's `create`, handed a RECORDING device — every call answered by an inert stub,
//    the shader module's code KEPT and the create stopped there — asks for its shader as TEXT: proof
//    that the bundle carries it inlined (plugin-build's `wgsl()`). A create that finishes without a
//    shader of its own passes as a kind that draws nothing; one that stops earlier for want of a real
//    device is a NOTE — the harness's ceiling, never the plugin's fault.

import type { ObjectContribution } from "@vibefield/contracts";
import { note, pass, refuse, type Verdict } from "./verdict";

/** What the recording device throws once it holds the shader's code: the create stops there. */
class ShaderSeen extends Error {
  // an explicit field, not a parameter property: the bin strips types and refuses those
  readonly code: unknown;
  constructor(code: unknown) {
    super("the kind's shader module was asked for");
    this.code = code;
  }
}

/** An inert stand-in for any GPU object: every member is a function returning another; never a thenable. */
function inert(): unknown {
  const target = (): unknown => inert();
  return new Proxy(target, {
    get: (_t, key) => (key === "then" || typeof key === "symbol" ? undefined : inert()),
    apply: () => inert(),
  });
}

/** A device that draws nothing and remembers the one thing this row asks: the shader's code. */
function recordingDevice(): unknown {
  const fixed: Record<string, unknown> = {
    createShaderModule: (desc: { code?: unknown } | undefined) => {
      throw new ShaderSeen(desc?.code);
    },
    features: new Set<string>(),
    limits: {},
    lost: new Promise<never>(() => {}),
    label: "vibefield-plugin check: a recording device (no GPU)",
  };
  return new Proxy(fixed, {
    get: (t, key) => (typeof key === "symbol" ? undefined : key in t ? t[key] : inert()),
  });
}

/** The WebGPU constant namespaces a kind's pass names while it builds (ICE's `bindLayout` reads
 * `GPUShaderStage`): the spec's values, installed only where Node has none, and removed after. */
const GPU_CONSTANTS: Record<string, Record<string, number>> = {
  GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
  GPUBufferUsage: {
    MAP_READ: 1,
    MAP_WRITE: 2,
    COPY_SRC: 4,
    COPY_DST: 8,
    INDEX: 16,
    VERTEX: 32,
    UNIFORM: 64,
    STORAGE: 128,
    INDIRECT: 256,
    QUERY_RESOLVE: 512,
  },
  GPUTextureUsage: {
    COPY_SRC: 1,
    COPY_DST: 2,
    TEXTURE_BINDING: 4,
    STORAGE_BINDING: 8,
    RENDER_ATTACHMENT: 16,
  },
  GPUColorWrite: { RED: 1, GREEN: 2, BLUE: 4, ALPHA: 8, ALL: 15 },
  GPUMapMode: { READ: 1, WRITE: 2 },
};

/** How long a create may run before the row stops waiting on it. */
const CREATE_BUDGET_MS = 2000;

type ShaderAnswer =
  | { readonly kind: "text"; readonly code: string }
  | { readonly kind: "not-text"; readonly code: unknown }
  | { readonly kind: "none" }
  | { readonly kind: "stopped"; readonly why: string };

/** Run a kind's `create` on the recording device, and say what it asked for. */
export async function shaderOf(create: unknown): Promise<ShaderAnswer> {
  if (typeof create !== "function") return { kind: "stopped", why: "the kind has no create" };
  const scope = globalThis as Record<string, unknown>;
  const installed = Object.keys(GPU_CONSTANTS).filter((name) => scope[name] === undefined);
  for (const name of installed) scope[name] = GPU_CONSTANTS[name];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const budget = new Promise<"budget">((resolve) => {
      timer = setTimeout(() => resolve("budget"), CREATE_BUDGET_MS);
    });
    const made = Promise.resolve().then(() =>
      (create as (d: unknown, f: string, m: unknown) => unknown)(
        recordingDevice(),
        "bgra8unorm",
        inert(),
      ),
    );
    const outcome = await Promise.race([made.then(() => "made" as const), budget]);
    if (outcome === "budget")
      return {
        kind: "stopped",
        why: `its create ran past ${CREATE_BUDGET_MS} ms without a shader`,
      };
    return { kind: "none" };
  } catch (error) {
    if (error instanceof ShaderSeen) {
      return typeof error.code === "string" && error.code.trim().length > 0
        ? { kind: "text", code: error.code }
        : { kind: "not-text", code: error.code };
    }
    return { kind: "stopped", why: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    for (const name of installed) delete scope[name];
  }
}

/** The entry points a WGSL text declares, for the row's detail. */
function entryPoints(code: string): string {
  const stages = [...code.matchAll(/@(vertex|fragment|compute)\b/g)].map((m) => m[1]);
  return stages.length === 0 ? "no entry point" : stages.join(" + ");
}

/** Each object row against the imported module's namespace — the host's reading, before the host. */
export async function checkObjectRows(
  namespace: unknown,
  objects: readonly ObjectContribution[],
  entry: string,
): Promise<Verdict[]> {
  if (objects.length === 0) return [];
  const { isObjectKind } = await import("@vibefield/plugin-sdk/desk");
  const verdicts: Verdict[] = [];
  const exports = (typeof namespace === "object" && namespace !== null ? namespace : {}) as Record<
    string,
    unknown
  >;
  for (const [index, row] of objects.entries()) {
    const pointer = `/contributes/objects/${index}/binding/kind`;
    const value = exports[row.binding.kind];
    if (typeof value !== "object" || value === null || !("kind" in value)) {
      verdicts.push(
        refuse(
          "activation",
          "object-export-missing",
          `${entry} exports no ObjectBinding \`${row.binding.kind}\` for ${row.type}`,
          {
            pointer,
            expected: `export const ${row.binding.kind}: ObjectBinding = { kind } from the renderer module (@vibefield/plugin-sdk/desk)`,
          },
        ),
      );
      continue;
    }
    const kind = (value as { kind: unknown }).kind;
    if (!isObjectKind(kind)) {
      verdicts.push(
        refuse(
          "activation",
          "object-kind-invalid",
          `\`${row.binding.kind}\`.kind holds no desk kind for ${row.type} (ICE isObjectKind: name · stratum · create · resolve · record · hit · reach)`,
          { pointer },
        ),
      );
      continue;
    }
    if (kind.name !== row.type) {
      verdicts.push(
        refuse(
          "activation",
          "object-kind-misnamed",
          `${row.type}'s kind is named "${kind.name}" — a kind's registry name IS its type`,
          { pointer, expected: `name the kind "${row.type}"` },
        ),
      );
      continue;
    }
    const hangs =
      row.tray === undefined
        ? "hangs nowhere (no tray entry)"
        : `hangs on "${row.tray.category}" by a ${row.tray.hang.accessory} (${row.tray.hang.w} × ${row.tray.hang.h})`;
    verdicts.push(
      pass(
        "activation",
        `${row.type}: \`${row.binding.kind}\` is a desk kind named by its type; ${hangs}`,
      ),
    );
    const shader = await shaderOf(kind.create);
    if (shader.kind === "text")
      verdicts.push(
        pass(
          "activation",
          `${row.type}: its WGSL arrived as text (${shader.code.length} characters, ${entryPoints(shader.code)})`,
        ),
      );
    else if (shader.kind === "none")
      verdicts.push(
        pass(
          "activation",
          `${row.type}: its create compiles no shader (a kind that draws nothing)`,
        ),
      );
    else if (shader.kind === "not-text")
      verdicts.push(
        refuse(
          "activation",
          "object-wgsl-not-text",
          `${row.type}'s create asked for a shader module whose code is ${typeof shader.code === "string" ? "empty" : typeof shader.code}, not WGSL text`,
          {
            pointer,
            expected:
              "import the kind's .wgsl files (plugin-build inlines each as its text) and compose them",
          },
        ),
      );
    else
      verdicts.push(
        note(
          "activation",
          "object-create-not-run-here",
          `${row.type}'s create stopped before its shader without a device: ${shader.why}`,
          { pointer },
        ),
      );
  }
  return verdicts;
}
