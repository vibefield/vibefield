// The pane pass's ENTRY (the prototype's shaders/browser/browser-pass.wgsl, on the kit) — one quad per pane over the world
// rect `resolvePane` measured (the pane as its eye sees it, its shadow, its glow), one `shade_pane` per covered fragment,
// premultiplied, through the slot's presence and its portal chain. The page is the pane's own texture, the head's
// engraving its own raster and a failed page's words their own (group 1), so a pane is one draw. `fs_light` is the second program over the same quad, drawn
// first with a lighting blend (what is there × (1 + light)): the arris's caustic by day, the page's light on the mat and
// the edges' halo by night. Group 0 is the slot's: its ONE view block (`u` — the kit's `MatPass.view`, never written),
// the pass's knobs, its records' persistent store and draw list, the gobo, the noise and the samplers.

// The slot is lit from elsewhere (a mini mat's inside, a flight's departed desk): the pass's other pipelines — a pipeline
// constant, never a uniform flag.
override LIT_ELSEWHERE: bool = false;

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> k: PaneUniforms;
@group(0) @binding(2) var<storage, read> panes: array<Pane>;
@group(0) @binding(3) var gobo_tex: texture_2d<f32>;      // the slot's animated gobo silhouette
@group(0) @binding(4) var gobo_samp: sampler;
@group(0) @binding(5) var noise_tex: texture_2d<f32>;
@group(0) @binding(6) var noise_samp: sampler;
@group(0) @binding(7) var page_samp: sampler;             // trilinear, clamped
@group(0) @binding(8) var ink_samp: sampler;              // linear, clamped
@group(0) @binding(9) var<storage, read> order: array<u32>;   // the draw list: paint index → the record's slot
@group(1) @binding(0) var page_tex: texture_2d<f32>;      // the pane's page (rgba8unorm-srgb, its mips)
@group(1) @binding(1) var ink_tex: texture_2d<f32>;       // the head's raster (rgba8, premultiplied)
@group(1) @binding(2) var notice_tex: texture_2d<f32>;    // a failed page's words (rgba8unorm-srgb, their block alone, its mips)

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
  let P = panes[slot];
  let zoom = mat_zoom(u);
  let lo = (P.bounds.xy - u.cam.xy) * zoom;   // CSS px
  let hi = (P.bounds.zw - u.cam.xy) * zoom;
  if (P.centre.w <= 0.0 || hi.x < u.box.x || hi.y < u.box.y || lo.x > u.box.x + u.box.z || lo.y > u.box.y + u.box.w) { return out; }
  let pos = mix(lo, hi, CORNERS[vid] * 0.5 + 0.5);
  out.clip = vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let P = panes[in.idx];
  let dpr = mat_dpr(u);
  let px = 1.0 / (mat_zoom(u) * dpr);
  let s = in.clip.xy * px + u.cam.xy;   // device px → world
  let c = shade_pane(P, u, k, s, px, in.clip.xy, gobo_tex, gobo_samp, noise_tex, noise_samp, page_tex, page_samp, ink_tex, ink_samp, notice_tex, LIT_ELSEWHERE);
  if (c.a < 0.002 && max(c.r, max(c.g, c.b)) < 0.002) { discard; }
  return c * (u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}

@fragment
fn fs_light(in: VSOut) -> @location(0) vec4f {
  let P = panes[in.idx];
  let dpr = mat_dpr(u);
  let px = 1.0 / (mat_zoom(u) * dpr);
  let s = in.clip.xy * px + u.cam.xy;
  let light = light_pane(P, u, k, s, gobo_tex, gobo_samp, page_tex, page_samp, LIT_ELSEWHERE);
  if (max(light.r, max(light.g, light.b)) < 0.0005) { discard; }
  return vec4f(light * (u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr)), 0.0);
}
