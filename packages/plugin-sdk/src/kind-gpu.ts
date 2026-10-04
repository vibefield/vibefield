// A WebGPU device for a kind's CPU half, with NO GPU (DK-7 — the kind-conformance harness behind
// `@vibefield/plugin-sdk/testing`). Every object a kind's `create`, `prepare` and `drawRange` ask for
// is a stub that remembers what it was made from, and each ask is held to the rules a real device
// enforces that need no compiler. That is the ceiling, said plainly: the WGSL is READ, never compiled.
//
// What it reads of a module's text (comments stripped, the way ICE's `device-ratio` unit reads the
// desk's generated WGSL — ICE packages/desk/test/ratio.ts, regular expressions, no parser): the entry
// points (`@vertex` / `@fragment` / `@compute fn name`), the resource bindings (`@group(g) @binding(b)
// var…`: the resource each declares), the pipeline-overridable constants (`override name`, `@id(n)
// override …`), and each function's body by name — so a stage's STATIC USE is the bindings its entry
// point names, and every function it calls names, transitively (WebGPU's own rule for a layout).
//
// What it holds a kind to, as a device would refuse it:
//  - a shader module's code is WGSL TEXT (a non-empty string)                        `wgsl-not-text`
//  - a pipeline names entry points its module declares for their stage, and only
//    constants its module overrides                                                  `wgsl-unread`
//  - every binding a pipeline's entry points statically use is one its layout
//    carries, as the same kind of resource (buffer, texture, storage texture,
//    sampler) — a binding the module declares and no stage reaches is no matter     `binding-unlaid`
//  - a bind group fills its layout exactly, each entry with the resource the layout
//    asks for (a buffer made for that use)                                           `bind-group-mismatch`
//  - a draw has a pipeline, and a bind group of that pipeline's layout at every
//    index the layout carries                                                        `draw-ill-formed`
// What it cannot see without a compiler — an unresolved name, a type error, a binding's visibility,
// a texture's sample type — passes here; the harness names that gap in its verdicts.
//
// Typed structurally on purpose: the SDK carries no WebGPU types (`@webgpu/types` is a kind's own dev
// dependency), so nothing here names `GPUDevice`; the harness hands the device to `create` as the
// opaque value it is.

/** The WebGPU constant namespaces a kind's pass reads while it builds (ICE's `bindLayout` reads
 * `GPUShaderStage`, `uniformBuffer` reads `GPUBufferUsage`) — the spec's values. */
export const GPU_CONSTANTS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
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

const UNIFORM_USAGE = 64;
const STORAGE_USAGE = 128;

let constantsHeld = 0;
let constantsInstalled: string[] = [];

/** Install the constant namespaces Node lacks for as long as one run holds them (refcounted: two
 * harness runs may overlap), and the release that takes them away again. */
export function holdGpuConstants(): () => void {
  const scope = globalThis as Record<string, unknown>;
  if (constantsHeld === 0) {
    constantsInstalled = Object.keys(GPU_CONSTANTS).filter((name) => scope[name] === undefined);
    for (const name of constantsInstalled) scope[name] = GPU_CONSTANTS[name];
  }
  constantsHeld += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    constantsHeld -= 1;
    if (constantsHeld > 0) return;
    for (const name of constantsInstalled) delete scope[name];
    constantsInstalled = [];
  };
}

// --- the WGSL, read ---------------------------------------------------------------------------

/** A shader stage an entry point is declared for. */
export type WgslStage = "vertex" | "fragment" | "compute";

/** The resource a `var` binding declares, as a layout entry must carry it. */
export type BindingResource =
  | "uniform"
  | "storage"
  | "read-only-storage"
  | "texture"
  | "storage-texture"
  | "sampler"
  | "external"
  | "unknown";

export interface WgslBinding {
  readonly group: number;
  readonly binding: number;
  readonly name: string;
  readonly resource: BindingResource;
}

export interface WgslRead {
  readonly entryPoints: readonly { readonly stage: WgslStage; readonly name: string }[];
  readonly bindings: readonly WgslBinding[];
  /** each `override` by name, and by its `@id` where it has one */
  readonly overrides: ReadonlySet<string>;
  /** each function by name: the identifiers its body names — what a stage's static use is read from */
  readonly functions: ReadonlyMap<string, ReadonlySet<string>>;
}

/** WGSL without its comments — a commented-out binding is no binding (block comments nest). */
export function uncommented(code: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < code.length; i += 1) {
    const two = code.slice(i, i + 2);
    if (two === "/*") {
      depth += 1;
      i += 1;
    } else if (depth > 0 && two === "*/") {
      depth -= 1;
      i += 1;
    } else if (depth > 0) {
      if (code[i] === "\n") out += "\n";
    } else if (two === "//") {
      const end = code.indexOf("\n", i);
      if (end === -1) break;
      i = end - 1;
    } else out += code[i];
  }
  return out;
}

const ENTRY = /@(vertex|fragment|compute)\b(?:\s*@\w+\s*(?:\([^)]*\))?)*\s*fn\s+([A-Za-z_]\w*)/g;
const VAR =
  /((?:@\w+\s*(?:\([^)]*\))?\s*)+)var\b\s*(<[^>]*>)?\s*([A-Za-z_]\w*)\s*:\s*([^;=]+?)\s*[;=]/g;
const OVERRIDE = /(?:@id\s*\(\s*(\d+)[iu]?\s*\)\s*)?\boverride\s+([A-Za-z_]\w*)/g;

function attributeNumber(attributes: string, name: string): number | undefined {
  const m = new RegExp(`@${name}\\s*\\(\\s*(\\d+)[iu]?\\s*\\)`).exec(attributes);
  return m?.[1] === undefined ? undefined : Number(m[1]);
}

function resourceOf(space: string | undefined, type: string): BindingResource {
  if (space !== undefined) {
    const [where, access] = space
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim());
    if (where === "uniform") return "uniform";
    if (where === "storage") return access === "read_write" ? "storage" : "read-only-storage";
    return "unknown";
  }
  const t = type.trim();
  if (/^sampler(_comparison)?\b/.test(t)) return "sampler";
  if (t.startsWith("texture_storage_")) return "storage-texture";
  if (t.startsWith("texture_external")) return "external";
  if (t.startsWith("texture_")) return "texture";
  return "unknown";
}

const FN = /\bfn\s+([A-Za-z_]\w*)\s*\(/g;
const IDENTIFIER = /\b[A-Za-z_]\w*\b/g;

/** Each function's body (from the first `{` after its name — a signature holds none — to its match):
 * the identifiers it names. */
function functionsOf(text: string): Map<string, ReadonlySet<string>> {
  const out = new Map<string, ReadonlySet<string>>();
  for (const m of text.matchAll(FN)) {
    const open = text.indexOf("{", m.index + m[0].length);
    if (open === -1) continue;
    let depth = 0;
    let end = text.length;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    out.set(m[1] as string, new Set(text.slice(open, end).match(IDENTIFIER) ?? []));
  }
  return out;
}

/** A module's text, read: its entry points, its bindings, its overrides and its functions. */
export function readWgsl(code: string): WgslRead {
  const text = uncommented(code);
  const entryPoints = [...text.matchAll(ENTRY)].map((m) => ({
    stage: m[1] as WgslStage,
    name: m[2] as string,
  }));
  const bindings: WgslBinding[] = [];
  for (const m of text.matchAll(VAR)) {
    const attributes = m[1] as string;
    const group = attributeNumber(attributes, "group");
    const binding = attributeNumber(attributes, "binding");
    if (group === undefined || binding === undefined) continue;
    bindings.push({
      group,
      binding,
      name: m[3] as string,
      resource: resourceOf(m[2], m[4] as string),
    });
  }
  const overrides = new Set<string>();
  for (const m of text.matchAll(OVERRIDE)) {
    overrides.add(m[2] as string);
    if (m[1] !== undefined) overrides.add(m[1]);
  }
  return { entryPoints, bindings, overrides, functions: functionsOf(text) };
}

/**
 * The bindings an entry point STATICALLY USES — WebGPU's rule for what its pipeline's layout must
 * carry: those its function names, and those of every function it calls, transitively. A binding
 * the module declares that this entry never reaches (a depth-only pass's vertex stage, say, beside
 * the colour pass's fragment) is no business of this pipeline's layout. Read by name, as ICE's
 * `device-ratio` unit reads a WGSL body: a local that shadows a binding's name counts as a use.
 */
export function bindingsUsedBy(read: WgslRead, entry: string): WgslBinding[] {
  const named = new Set<string>();
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const fn = stack.pop() as string;
    if (seen.has(fn)) continue;
    seen.add(fn);
    for (const id of read.functions.get(fn) ?? []) {
      named.add(id);
      if (read.functions.has(id) && !seen.has(id)) stack.push(id);
    }
  }
  return read.bindings.filter((b) => named.has(b.name));
}

// --- the device ---------------------------------------------------------------------------------

export type GpuProblemCode =
  | "wgsl-not-text"
  | "wgsl-unread"
  | "binding-unlaid"
  | "bind-group-mismatch"
  | "draw-ill-formed";

/** One rule a real device would have refused the kind for, said as it happened. */
export interface GpuProblem {
  readonly code: GpuProblemCode;
  readonly detail: string;
}

/** A shader module the kind asked for: its label, its code, and the code read (when it was text). */
export interface RecordedModule {
  readonly label: string;
  readonly code: unknown;
  readonly read: WgslRead | undefined;
}

/** One pipeline stage, read: the module it names and the bindings its entry point statically uses. */
interface StageUse {
  readonly module: string;
  readonly bindings: readonly WgslBinding[];
}

/** What a layout entry carries, as a binding's resource is matched against it. */
type LayoutResource = Exclude<BindingResource, "unknown">;

interface LayoutStub {
  readonly kind: "layout";
  readonly label: string;
  readonly entries: readonly { readonly binding: number; readonly resource: LayoutResource }[];
}
interface PipelineLayoutStub {
  readonly kind: "pipeline-layout";
  readonly groups: readonly (LayoutStub | undefined)[];
}
interface PipelineStub {
  readonly kind: "pipeline";
  readonly label: string;
  readonly valid: boolean;
  readonly groups: readonly (LayoutStub | undefined)[];
}
interface GroupStub {
  readonly kind: "group";
  readonly label: string;
  readonly valid: boolean;
  readonly layout: LayoutStub | undefined;
}
interface BufferStub {
  readonly kind: "buffer";
  readonly usage: number;
}
type Stub =
  | LayoutStub
  | PipelineLayoutStub
  | PipelineStub
  | GroupStub
  | BufferStub
  | { readonly kind: "module"; readonly module: RecordedModule }
  | { readonly kind: "texture" | "view" | "sampler" };

type Rec = Record<string, unknown>;

const asRec = (value: unknown): Rec =>
  typeof value === "object" && value !== null ? (value as Rec) : {};

const labelOf = (desc: unknown): string => {
  const label = asRec(desc).label;
  return typeof label === "string" && label.length > 0 ? label : "(unlabelled)";
};

/** An inert stand-in for whatever no rule here covers: every member a function returning another; never a thenable. */
function inert(): unknown {
  const target = (): unknown => inert();
  return new Proxy(target, {
    get: (_t, key) => (key === "then" || typeof key === "symbol" ? undefined : inert()),
    apply: () => inert(),
  });
}

/** `fixed`, answering anything else it is asked for with an inert stand-in. */
function open<T extends object>(fixed: T): T {
  return new Proxy(fixed, {
    get: (t, key) => {
      if (typeof key === "symbol") return undefined;
      if (key in t) return (t as Rec)[key];
      return key === "then" ? undefined : inert();
    },
  });
}

/** WebGPU's default limits — what a pass that plans against `device.limits` reads. */
const LIMITS = {
  maxTextureDimension1D: 8192,
  maxTextureDimension2D: 8192,
  maxTextureDimension3D: 2048,
  maxTextureArrayLayers: 256,
  maxBindGroups: 4,
  maxBindingsPerBindGroup: 1000,
  maxDynamicUniformBuffersPerPipelineLayout: 8,
  maxDynamicStorageBuffersPerPipelineLayout: 4,
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
  maxStorageBuffersPerShaderStage: 8,
  maxStorageTexturesPerShaderStage: 4,
  maxUniformBuffersPerShaderStage: 12,
  maxUniformBufferBindingSize: 65536,
  maxStorageBufferBindingSize: 134217728,
  maxBufferSize: 268435456,
  maxVertexBuffers: 8,
  maxVertexAttributes: 16,
  maxVertexBufferArrayStride: 2048,
  maxColorAttachments: 8,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupsPerDimension: 65535,
};

/** The device, the stubs it made, and what a real device would have refused. */
export interface RecordingGpu {
  /** hand it to the kind's `create` as its device */
  readonly device: unknown;
  /** every shader module the kind asked for, in order */
  readonly modules: readonly RecordedModule[];
  /** draw calls the recording passes were told, so far */
  readonly draws: () => number;
  /** pipelines and bind groups the kind made on it so far, and the bindings their stages statically use */
  readonly made: () => {
    readonly pipelines: number;
    readonly groups: number;
    readonly bindings: number;
  };
  /** the problems raised since the last take, in the order they arose — and forget them */
  take(): GpuProblem[];
  /** a command encoder whose passes record and check what they are told (a pass's `prepare` gets one) */
  encoder(): unknown;
  /** a render pass that records and checks what it is told (a pass's `drawRange` gets one) */
  pass(): unknown;
}

const ACCEPTS: Readonly<Record<Exclude<BindingResource, "unknown">, readonly LayoutResource[]>> = {
  uniform: ["uniform"],
  // a read-only storage binding is lenient: a device refuses less than this would, never more
  "read-only-storage": ["read-only-storage", "storage"],
  storage: ["storage"],
  texture: ["texture"],
  "storage-texture": ["storage-texture"],
  sampler: ["sampler"],
  external: ["external"],
};

function layoutResourceOf(entry: Rec): LayoutResource | undefined {
  if ("buffer" in entry) {
    const type = asRec(entry.buffer).type;
    return type === "storage" || type === "read-only-storage" ? type : "uniform";
  }
  if ("texture" in entry) return "texture";
  if ("storageTexture" in entry) return "storage-texture";
  if ("sampler" in entry) return "sampler";
  if ("externalTexture" in entry) return "external";
  return undefined;
}

const sameLayout = (a: LayoutStub | undefined, b: LayoutStub | undefined): boolean => {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.entries.length !== b.entries.length) return false;
  return a.entries.every((e) =>
    b.entries.some((f) => f.binding === e.binding && f.resource === e.resource),
  );
};

/** A recording device with nothing behind it. */
export function recordingGpu(): RecordingGpu {
  const stubs = new WeakMap<object, Stub>();
  const modules: RecordedModule[] = [];
  let problems: GpuProblem[] = [];
  let draws = 0;
  let pipelines = 0;
  let groupsMade = 0;
  const usedBindings = new Set<string>();
  const raise = (code: GpuProblemCode, detail: string): void => {
    problems.push({ code, detail });
  };
  const stubOf = (handle: unknown): Stub | undefined =>
    typeof handle === "object" && handle !== null ? stubs.get(handle) : undefined;
  const make = <T extends object>(handle: T, stub: Stub): T => {
    stubs.set(handle, stub);
    return handle;
  };

  const buffer = (desc: unknown): unknown => {
    const d = asRec(desc);
    const size = typeof d.size === "number" ? d.size : 0;
    const usage = typeof d.usage === "number" ? d.usage : 0;
    return make(
      {
        label: labelOf(d),
        size,
        usage,
        mapState: "unmapped",
        // a buffer is the one resource that maps — ICE's `bindGroup` tells one by this member
        getMappedRange: (_offset?: number, length?: number) => new ArrayBuffer(length ?? size),
        mapAsync: async () => {},
        unmap: () => {},
        destroy: () => {},
      },
      { kind: "buffer", usage },
    );
  };

  const texture = (desc: unknown): unknown => {
    const d = asRec(desc);
    const size = Array.isArray(d.size) ? d.size : [asRec(d.size).width, asRec(d.size).height];
    const handle = {
      label: labelOf(d),
      width: typeof size[0] === "number" ? size[0] : 1,
      height: typeof size[1] === "number" ? size[1] : 1,
      depthOrArrayLayers: typeof size[2] === "number" ? size[2] : 1,
      mipLevelCount: typeof d.mipLevelCount === "number" ? d.mipLevelCount : 1,
      sampleCount: typeof d.sampleCount === "number" ? d.sampleCount : 1,
      format: d.format,
      usage: d.usage,
      createView: (view?: unknown) =>
        make({ label: labelOf(view ?? d) }, { kind: "view" }) as unknown,
      destroy: () => {},
    };
    return make(handle, { kind: "texture" });
  };

  const bindGroupLayout = (desc: unknown): unknown => {
    const d = asRec(desc);
    const entries: { binding: number; resource: LayoutResource }[] = [];
    for (const raw of Array.isArray(d.entries) ? d.entries : []) {
      const entry = asRec(raw);
      const resource = layoutResourceOf(entry);
      if (typeof entry.binding === "number" && resource !== undefined)
        entries.push({ binding: entry.binding, resource });
    }
    return make({ label: labelOf(d) }, { kind: "layout", label: labelOf(d), entries });
  };

  const pipelineLayout = (desc: unknown): unknown => {
    const d = asRec(desc);
    const groups = (Array.isArray(d.bindGroupLayouts) ? d.bindGroupLayouts : []).map((g) => {
      const s = stubOf(g);
      return s?.kind === "layout" ? s : undefined;
    });
    return make({ label: labelOf(d) }, { kind: "pipeline-layout", groups });
  };

  const shaderModule = (desc: unknown): unknown => {
    const d = asRec(desc);
    const label = labelOf(d);
    const code = d.code;
    const isText = typeof code === "string" && code.trim().length > 0;
    if (!isText)
      raise(
        "wgsl-not-text",
        `the shader module "${label}" was asked for with code that is ${typeof code === "string" ? "empty" : typeof code}, not WGSL text`,
      );
    const module: RecordedModule = { label, code, read: isText ? readWgsl(code) : undefined };
    modules.push(module);
    return make(
      {
        label,
        // nothing compiles here: no message is the truth of a READ, not a compiler's word
        getCompilationInfo: async () => ({ messages: [] }),
      },
      { kind: "module", module },
    );
  };

  /** One stage of a pipeline against its module: the entry point, the constants — and the bindings
   * that entry statically uses. Undefined when it cannot draw. */
  const stage = (pipeline: string, which: WgslStage, desc: unknown): StageUse | undefined => {
    const d = asRec(desc);
    const s = stubOf(d.module);
    if (s?.kind !== "module") {
      raise(
        "wgsl-unread",
        `the pipeline "${pipeline}"'s ${which} stage names no module this device made`,
      );
      return undefined;
    }
    const read = s.module.read;
    if (read === undefined) return undefined; // its code was not text: said when the module was asked for
    const declared = read.entryPoints.filter((e) => e.stage === which);
    const all = read.entryPoints.map((e) => `${e.stage} ${e.name}`).join(", ") || "none";
    let entry: string;
    if (typeof d.entryPoint === "string") {
      if (!declared.some((e) => e.name === d.entryPoint)) {
        raise(
          "wgsl-unread",
          `the pipeline "${pipeline}" names the ${which} entry point "${d.entryPoint}", which "${s.module.label}" does not declare (it declares: ${all})`,
        );
        return undefined;
      }
      entry = d.entryPoint;
    } else if (declared.length !== 1) {
      raise(
        "wgsl-unread",
        `the pipeline "${pipeline}" names no ${which} entry point and "${s.module.label}" declares ${declared.length} (it declares: ${all})`,
      );
      return undefined;
    } else entry = (declared[0] as { readonly name: string }).name;
    for (const key of Object.keys(asRec(d.constants))) {
      if (!read.overrides.has(key)) {
        raise(
          "wgsl-unread",
          `the pipeline "${pipeline}" overrides the constant "${key}", which "${s.module.label}" never declares (\`override ${key}\`)`,
        );
        return undefined;
      }
    }
    return { module: s.module.label, bindings: bindingsUsedBy(read, entry) };
  };

  /** Every binding a pipeline's stages statically use, against the layout it is made with — each
   * binding said once however many of its stages use it. */
  const laid = (
    pipeline: string,
    uses: readonly WgslBinding[],
    groups: readonly (LayoutStub | undefined)[],
  ): boolean => {
    let ok = true;
    for (const b of uses) {
      if (b.resource === "unknown") continue;
      const entry = groups[b.group]?.entries.find((e) => e.binding === b.binding);
      if (entry === undefined) {
        ok = false;
        raise(
          "binding-unlaid",
          `the pipeline "${pipeline}"'s WGSL uses \`${b.name}\` at @group(${b.group}) @binding(${b.binding}), which its layout does not carry`,
        );
      } else if (!ACCEPTS[b.resource].includes(entry.resource)) {
        ok = false;
        raise(
          "binding-unlaid",
          `the pipeline "${pipeline}"'s WGSL declares \`${b.name}\` at @group(${b.group}) @binding(${b.binding}) as a ${b.resource} binding, and its layout carries a ${entry.resource} one there`,
        );
      }
    }
    return ok;
  };

  const pipeline = (desc: unknown): unknown => {
    const d = asRec(desc);
    const label = labelOf(d);
    const auto = d.layout === "auto";
    const pl = stubOf(d.layout);
    let groups: readonly (LayoutStub | undefined)[] =
      pl?.kind === "pipeline-layout" ? pl.groups : [];
    let valid = auto || pl?.kind === "pipeline-layout";
    if (!valid)
      raise("binding-unlaid", `the pipeline "${label}" is made with no layout this device made`);
    // what the pipeline's stages statically use, each binding once (vertex and fragment often share one)
    const uses = new Map<string, WgslBinding>();
    for (const [which, part] of [
      ["vertex", d.vertex],
      ["fragment", d.fragment],
      ["compute", d.compute],
    ] as const) {
      if (part === undefined) continue;
      const use = stage(label, which, part);
      if (use === undefined) valid = false;
      else
        for (const b of use.bindings) {
          uses.set(`${use.module} ${b.group}/${b.binding}`, b);
          usedBindings.add(`${use.module} ${b.group}/${b.binding}`);
        }
    }
    const derived: (LayoutStub | undefined)[] = [];
    if (auto) {
      // `layout: "auto"`: the device derives each group's layout from what the stages use
      for (const b of uses.values()) {
        if (b.resource === "unknown") continue;
        const at = derived[b.group];
        if (at?.entries.some((e) => e.binding === b.binding)) continue;
        const entries = [...(at?.entries ?? []), { binding: b.binding, resource: b.resource }];
        derived[b.group] = { kind: "layout", label: `${label} (auto) ${b.group}`, entries };
      }
      groups = derived;
    } else if (!laid(label, [...uses.values()], groups)) valid = false;
    const handles = new Map<number, unknown>();
    const handle = {
      label,
      getBindGroupLayout: (index: number) => {
        let h = handles.get(index);
        if (h === undefined) {
          const g = groups[index];
          h = make(
            { label: `${label} group ${index}` },
            g ?? { kind: "layout", label: `${label} group ${index}`, entries: [] },
          );
          handles.set(index, h);
        }
        return h;
      },
    };
    pipelines += 1;
    return make(handle, { kind: "pipeline", label, valid, groups });
  };

  const bindGroup = (desc: unknown): unknown => {
    const d = asRec(desc);
    const label = labelOf(d);
    const ls = stubOf(d.layout);
    const layout = ls?.kind === "layout" ? ls : undefined;
    let valid = true;
    const mismatch = (detail: string): void => {
      valid = false;
      raise("bind-group-mismatch", `the bind group "${label}" ${detail}`);
    };
    if (layout === undefined) mismatch("is made with no layout this device made");
    const given = Array.isArray(d.entries) ? d.entries.map(asRec) : [];
    const seen = new Set<number>();
    for (const e of given) {
      const n = e.binding;
      if (typeof n !== "number") {
        mismatch("has an entry with no binding number");
        continue;
      }
      if (seen.has(n)) mismatch(`fills binding ${n} twice`);
      seen.add(n);
      const want = layout?.entries.find((x) => x.binding === n);
      if (layout !== undefined && want === undefined) {
        mismatch(`fills binding ${n}, which its layout "${layout.label}" does not carry`);
        continue;
      }
      if (want === undefined) continue;
      const resource = e.resource;
      const direct = stubOf(resource);
      const inner = stubOf(asRec(resource).buffer);
      const s = direct ?? inner;
      if (
        want.resource === "uniform" ||
        want.resource === "storage" ||
        want.resource === "read-only-storage"
      ) {
        if (s?.kind !== "buffer")
          mismatch(`fills ${want.resource} binding ${n} with something that is not a buffer`);
        else if ((s.usage & (want.resource === "uniform" ? UNIFORM_USAGE : STORAGE_USAGE)) === 0)
          mismatch(
            `fills ${want.resource} binding ${n} with a buffer not made for ${want.resource === "uniform" ? "UNIFORM" : "STORAGE"} use`,
          );
      } else if (want.resource === "sampler") {
        if (s?.kind !== "sampler")
          mismatch(`fills sampler binding ${n} with something that is not a sampler`);
      } else if (s?.kind !== "view" && s?.kind !== "texture") {
        mismatch(`fills ${want.resource} binding ${n} with something that is not a texture view`);
      }
    }
    for (const want of layout?.entries ?? [])
      if (!seen.has(want.binding))
        mismatch(`leaves binding ${want.binding} of its layout "${layout?.label}" empty`);
    groupsMade += 1;
    return make({ label }, { kind: "group", label, valid, layout });
  };

  /** A pass that records and checks what it is told. */
  const recordingPass = (): unknown => {
    let current: PipelineStub | undefined;
    const groups = new Map<number, GroupStub>();
    const illFormed = (detail: string): void => raise("draw-ill-formed", detail);
    const draw = (call: string) => (): void => {
      draws += 1;
      if (current === undefined) {
        illFormed(`a ${call} with no pipeline set`);
        return;
      }
      if (!current.valid) return; // its own refusal was said when it was made
      current.groups.forEach((want, index) => {
        if (want === undefined) return;
        const have = groups.get(index);
        if (have === undefined)
          illFormed(
            `a ${call} with the pipeline "${current?.label}" and no bind group at index ${index}`,
          );
        else if (have.valid && !sameLayout(have.layout, want))
          illFormed(
            `a ${call} with the pipeline "${current?.label}" and, at index ${index}, the bind group "${have.label}" made for another layout`,
          );
      });
    };
    return open({
      label: "harness/pass",
      setPipeline: (p: unknown) => {
        const s = stubOf(p);
        if (s?.kind !== "pipeline") {
          illFormed("setPipeline was handed something no create on this device made");
          current = undefined;
        } else current = s;
      },
      setBindGroup: (index: number, g: unknown) => {
        const s = stubOf(g);
        if (s?.kind !== "group")
          illFormed(
            `setBindGroup(${index}) was handed something that is not a bind group this device made`,
          );
        else groups.set(index, s);
      },
      draw: draw("draw"),
      drawIndexed: draw("drawIndexed"),
      drawIndirect: draw("drawIndirect"),
      drawIndexedIndirect: draw("drawIndexedIndirect"),
      dispatchWorkgroups: draw("dispatch"),
      dispatchWorkgroupsIndirect: draw("dispatch"),
      setVertexBuffer: () => {},
      setIndexBuffer: () => {},
      setViewport: () => {},
      setScissorRect: () => {},
      setBlendConstant: () => {},
      setStencilReference: () => {},
      pushDebugGroup: () => {},
      popDebugGroup: () => {},
      insertDebugMarker: () => {},
      end: () => {},
    });
  };

  const encoder = (): unknown =>
    open({
      label: "harness/encoder",
      beginRenderPass: () => recordingPass(),
      beginComputePass: () => recordingPass(),
      copyBufferToBuffer: () => {},
      copyBufferToTexture: () => {},
      copyTextureToBuffer: () => {},
      copyTextureToTexture: () => {},
      clearBuffer: () => {},
      finish: () => ({ label: "harness/commands" }),
    });

  const device = open({
    label: "a recording device (no GPU) — @vibefield/plugin-sdk/testing",
    features: new Set<string>(),
    limits: LIMITS,
    // a device that is never lost: its promise never settles
    lost: new Promise<never>(() => {}),
    queue: open({
      label: "harness/queue",
      writeBuffer: () => {},
      writeTexture: () => {},
      copyExternalImageToTexture: () => {},
      submit: () => {},
      onSubmittedWorkDone: async () => {},
    }),
    createBuffer: buffer,
    createTexture: texture,
    createSampler: (desc?: unknown) => make({ label: labelOf(desc) }, { kind: "sampler" }),
    createBindGroupLayout: bindGroupLayout,
    createPipelineLayout: pipelineLayout,
    createShaderModule: shaderModule,
    createRenderPipeline: pipeline,
    createRenderPipelineAsync: async (desc: unknown) => pipeline(desc),
    createComputePipeline: pipeline,
    createComputePipelineAsync: async (desc: unknown) => pipeline(desc),
    createBindGroup: bindGroup,
    createCommandEncoder: encoder,
    pushErrorScope: () => {},
    popErrorScope: async () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    destroy: () => {},
  });

  return {
    device,
    modules,
    draws: () => draws,
    made: () => ({ pipelines, groups: groupsMade, bindings: usedBindings.size }),
    take: () => {
      const out = problems;
      problems = [];
      return out;
    },
    encoder,
    pass: recordingPass,
  };
}
