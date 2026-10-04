// {{title}} — this kind's OWN WGSL: one disc per object, lying where the desk lays it, through the slot's
// portal chain (inside a mini mat it fades with the mat's face, with no code of its own). It is composed
// AFTER what it names (shaders.ts): the kit's `view` piece (the slot's view block `MatUniforms`), its
// `portal` piece (`portal_cover`), its `light` piece (`mat_zoom`, `mat_dpr`), and the record `Disc`,
// generated from record.ts.
// plugin-build inlines this file into the renderer bundle as its text.

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<storage, read> discs: array<Disc>;
@group(0) @binding(2) var<storage, read> order: array<u32>;   // the draw list: paint index → the record's slot

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(flat) idx: u32,
}

const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;
  out.clip = vec4f(2.0, 2.0, 2.0, 1.0);   // degenerate: a culled instance collapses
  let slot = order[iid];
  out.idx = slot;
  let D = discs[slot];
  let zoom = mat_zoom(u);
  let px = 1.0 / (zoom * mat_dpr(u));
  // the disc grown by its shadow and the antialiasing
  let ext = D.radius * 1.2 + 3.0 * px;
  let lo = (D.centre - vec2f(ext) - u.cam.xy) * zoom;   // CSS px
  let hi = (D.centre + vec2f(ext) - u.cam.xy) * zoom;
  if (hi.x < u.box.x || hi.y < u.box.y || lo.x > u.box.x + u.box.z || lo.y > u.box.y + u.box.w) { return out; }
  let pos = mix(lo, hi, CORNERS[vid] * 0.5 + 0.5);
  out.clip = vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let D = discs[in.idx];
  let dpr = mat_dpr(u);
  let px = 1.0 / (mat_zoom(u) * dpr);
  let p = in.clip.xy * px + u.cam.xy;   // device px → world
  let d = length(p - D.centre) - D.radius;
  let cover = clamp(0.5 - d / px, 0.0, 1.0);
  // a soft contact shadow under it, a little down and right of the disc
  let ds = length(p - D.centre - vec2f(0.04, 0.08) * D.radius) - D.radius;
  let shadow = 0.22 * (1.0 - smoothstep(-0.08 * D.radius, 0.16 * D.radius, ds)) * (1.0 - cover);
  let c = vec4f(D.colour.rgb * cover, cover + shadow);   // premultiplied
  if (c.a < 0.002) { discard; }
  return c * (D.alpha * u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
