// The slot is lit from elsewhere (a mini mat's inside): the pass's second pipeline — a pipeline constant, never a uniform flag.
override LIT_ELSEWHERE: bool = false;

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<storage, read> clocks: array<Clock>;
@group(0) @binding(2) var gobo_tex: texture_2d<f32>;      // the slot's animated gobo silhouette
@group(0) @binding(3) var gobo_samp: sampler;
@group(0) @binding(4) var noise_tex: texture_2d<f32>;
@group(0) @binding(5) var noise_samp: sampler;
@group(0) @binding(6) var<storage, read> order: array<u32>;   // the draw list: paint index → the record's slot

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
  let C = clocks[slot];
  let zoom = mat_zoom(u);
  let px = 1.0 / (zoom * mat_dpr(u));
  // the case grown by what the fragment paints past it: its shadow's reach at its height, and the AA
  let hc = C.heights.x + C.lift;
  let ext = C.radius + length(C.slope) * hc + 2.5 * (C.shadow.x + C.shadow.z * hc) + 3.0 * px;
  let lo = (C.centre - vec2f(ext) - u.cam.xy) * zoom;   // CSS px
  let hi = (C.centre + vec2f(ext) - u.cam.xy) * zoom;
  if (hi.x < u.box.x || hi.y < u.box.y || lo.x > u.box.x + u.box.z || lo.y > u.box.y + u.box.w) { return out; }
  let pos = mix(lo, hi, CORNERS[vid] * 0.5 + 0.5);
  out.clip = vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let C = clocks[in.idx];
  let dpr = mat_dpr(u);
  let px = 1.0 / (mat_zoom(u) * dpr);
  let p = in.clip.xy * px + u.cam.xy;   // device px → world
  let c = shade_clock(C, u, p, px, in.clip.xy, gobo_tex, gobo_samp, noise_tex, noise_samp, LIT_ELSEWHERE);
  if (c.a < 0.002) { discard; }
  return c * (u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
