export const LOGO_SEGMENTS = 512;
export const LOGO_PROFILE_SEGMENTS = 16;
export const LOGO_BODY_VERTICES = LOGO_SEGMENTS * LOGO_PROFILE_SEGMENTS * 6;
export const LOGO_EDGE_VERTICES = (LOGO_SEGMENTS + 1) * 2;

/** Native 3D WGSL. An elliptical ribbon profile, a depth buffer, and two emissive rims. */
export const LOGO_SHADER = /* wgsl */ `
struct Uniforms {
  viewport: vec4f, // width, height, time, transparent
  shape: vec4f, // scale, width, height, thickness
  form: vec4f, // taper, pinch, rotation radians, asymmetry
  material: vec4f, // chromatic, iridescence, glow, field
  light: vec4f, // saturation, exposure, filaments, count
  atmosphere: vec4f, // diffusion, twist, grain, vignette
  motion: vec4f, // breathe, color drift, pointer x, pointer y
  colorA: vec4f,
  colorB: vec4f,
  colorC: vec4f,
  colorD: vec4f,
  background: vec4f,
  ink: vec4f,
  spin: vec4f, // bounded axial angle radians, loop depth, perspective, reserved
  flow: vec4f, // highlight strength, speed, falloff length, count
  weave: vec4f, // traveling half-twist phase, twist focus, reserved, reserved
}
@group(0) @binding(0) var<uniform> u: Uniforms;
const TAU = 6.28318530718;
const SEGMENTS = ${LOGO_SEGMENTS}u;
const PROFILE = ${LOGO_PROFILE_SEGMENTS}u;
const RELIEF = 0.24;

fn palette(phase: f32) -> vec3f {
  let p = fract(phase) * 4.0;
  let f = smoothstep(0.0, 1.0, fract(p));
  if (p < 1.0) { return mix(u.colorA.rgb, u.colorB.rgb, f); }
  if (p < 2.0) { return mix(u.colorB.rgb, u.colorC.rgb, f); }
  if (p < 3.0) { return mix(u.colorC.rgb, u.colorD.rgb, f); }
  return mix(u.colorD.rgb, u.colorA.rgb, f);
}
fn rotate(p: vec2f, a: f32) -> vec2f {
  return vec2f(cos(a)*p.x - sin(a)*p.y, sin(a)*p.x + cos(a)*p.y);
}
fn grain(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
}
fn curve(t: f32) -> vec3f {
  let s = sin(t);
  let c = cos(t);
  let breath = 1.0 + sin(u.viewport.z * 0.72) * u.motion.x * 0.035;
  let p = vec2f(u.shape.y*c, u.shape.z*sin(2.0*t)) / (1.0 + u.form.y*s*s);
  return vec3f(p * vec2f(1.0, 1.0 + u.form.w*c), -u.spin.y*s) * u.shape.x * breath;
}
fn roll(p: vec3f) -> vec3f {
  let a = u.spin.x;
  let axial = vec3f(p.x, p.y*cos(a)-p.z*sin(a), p.y*sin(a)+p.z*cos(a));
  return vec3f(rotate(axial.xy,u.form.z),axial.z);
}
fn project(p: vec3f) -> vec4f {
  let size = u.viewport.xy;
  let fit = min(1.0,size.x/size.y*0.78);
  let w = 1.0-p.z*u.spin.z*0.2;
  let xy = p.xy*fit + u.motion.zw*0.02*w;
  return vec4f(xy*min(size.x,size.y)/size*vec2f(1.0,-1.0),0.5*w-p.z*0.1,w);
}
fn ribbonWidth(t: f32) -> f32 {
  return u.shape.w*u.shape.x*(1.0+u.form.x*sin(t+0.7));
}
fn ribbonNormal(t: f32) -> vec3f {
  let tangent = normalize(curve(t+0.001)-curve(t-0.001));
  let normal = normalize(vec3f(-tangent.y,tangent.x,0.0));
  let binormal = normalize(cross(tangent,normal));
  let q = t-u.weave.x;
  // One half-turn per lap. The cross-section closes with opposite sides joined.
  // Focus concentrates the turning section while keeping a broad, open ribbon face.
  let twist = q*0.5-u.weave.y*0.45*sin(q);
  return normal*cos(twist)+binormal*sin(twist);
}
fn edgeCoordinate(t: f32, side: f32) -> f32 {
  // A Möbius ribbon has a single boundary: lap two continues on the opposite rim.
  // This double-cover coordinate keeps color and pulse phase continuous at both joins.
  return (t-u.weave.x)/(2.0*TAU)+select(0.0,0.5,side < 0.0);
}
fn pulse(t: f32, side: f32) -> f32 {
  // Two broad periodic lobes make one soft, asymmetric reflection, continuous at the join.
  let travel = u.viewport.z*u.flow.y*0.3;
  let direction = select(1.0,-1.0,u.flow.y < 0.0);
  let phase = fract(direction*(travel-edgeCoordinate(t,side)*round(u.flow.w)));
  let angle = phase*TAU;
  let reflection = exp((cos(angle)-1.0)*mix(9.0,4.0,u.flow.z));
  let falloff = exp((cos(angle-0.48)-1.0)*mix(5.0,1.8,u.flow.z));
  return reflection*0.62+falloff*0.38;
}
fn highlightEnergy(value: f32) -> f32 {
  // A soft shoulder preserves detail at high settings and with earlier, brighter presets.
  return 1.0-exp(-value*0.72);
}

struct FieldVertex { @builtin(position) position: vec4f }
@vertex fn fieldVertex(@builtin(vertex_index) index: u32) -> FieldVertex {
  let p = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var out: FieldVertex;
  out.position = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  return out;
}
@fragment fn fieldFragment(v: FieldVertex) -> @location(0) vec4f {
  if (u.viewport.w > 0.5) { return vec4f(0.0); }
  let size = u.viewport.xy;
  let p = (v.position.xy * 2.0 - size) / min(size.x, size.y) - u.motion.zw * 0.07;
  let r = max(length(p), 0.002);
  let t = u.viewport.z;
  let a = atan2(p.y, p.x);
  let warp = a + u.atmosphere.y*r*0.45 + sin(a*3.0+t*0.18)*0.12;
  let hue = warp/TAU * 2.0 + 0.08 + t*u.motion.y*0.035;
  let raw = palette(hue);
  let lum = dot(raw, vec3f(0.2126, 0.7152, 0.0722));
  let spectral = mix(vec3f(lum), raw, u.light.x);
  let dark = 1.0 - smoothstep(0.1, 0.7, dot(u.background.rgb, vec3f(0.3333)));
  let cloud = 0.54 + 0.23*sin(warp*5.0-r*0.7+t*0.13) + 0.12*sin(warp*9.0+t*0.09);
  let spread = u.atmosphere.x;
  let field = mix(u.background.rgb, spectral, clamp(cloud*u.material.w*(0.75+spread*0.6),0.0,1.0));
  var color = field;
  // Angular filaments fan out from one focal point. Derivatives band-limit the lines.
  let phase = (warp + sin(a*2.0+t*0.1)*0.035)*u.light.w + r*0.4-t*0.55;
  let pixelWidth = max(fwidth(phase), 0.001);
  let wave = sin(phase);
  let filament = smoothstep(0.78-pixelWidth, 0.98+pixelWidth, wave);
  let resolve = 1.0-smoothstep(1.3,3.2,pixelWidth);
  let rays = filament * resolve * smoothstep(0.12,0.85,r) * u.light.z;
  color = mix(color, mix(vec3f(1.0), spectral*0.85, dark*0.7), rays*0.65);
  let veins = pow(max(0.0, sin(warp*11.0+sin(warp*3.0)*1.2)), 80.0);
  color += spectral * veins * u.light.z * 0.17 * smoothstep(0.1,0.6,r);
  let source = exp(-r*(5.0-spread*2.0)) * u.material.w;
  color = mix(color, mix(vec3f(1.0,0.94,0.85),spectral*1.1,dark*0.76),source*0.8);
  color *= 1.0-u.atmosphere.w*smoothstep(0.25,1.8,r)*0.65;
  color = color*u.light.y + grain(v.position.xy)*u.atmosphere.z;
  return vec4f(clamp(color,vec3f(0.0),vec3f(1.0)),1.0);
}

struct RibbonVertex {
  @builtin(position) position: vec4f,
  @location(0) along: f32,
  @location(1) ring: f32,
  @location(2) normal: vec3f,
}
@vertex fn ribbonVertex(@builtin(vertex_index) index: u32) -> RibbonVertex {
  let corner = index%6u;
  let alongStep = array<u32,6>(0u,1u,0u,0u,1u,1u);
  let ringStep = array<u32,6>(0u,0u,1u,1u,0u,1u);
  let segment = index/(PROFILE*6u) + alongStep[corner];
  let ring = (index/6u)%PROFILE + ringStep[corner];
  let t = f32(segment)/f32(SEGMENTS)*TAU;
  let theta = f32(ring)/f32(PROFILE)*TAU;
  let tangent = normalize(curve(t+0.001)-curve(t-0.001));
  let normal = ribbonNormal(t);
  let binormal = normalize(cross(tangent,normal));
  let width = ribbonWidth(t);
  let p = curve(t) + width*(normal*cos(theta)+binormal*sin(theta)*RELIEF);
  var out: RibbonVertex;
  out.position = project(roll(p));
  out.along = t;
  out.ring = theta;
  out.normal = roll(normalize(normal*cos(theta)+binormal*sin(theta)/RELIEF));
  return out;
}
@fragment fn ribbonFragment(v: RibbonVertex) -> @location(0) vec4f {
  let n = normalize(v.normal);
  let side = cos(v.ring);
  let drift = u.viewport.z*u.motion.y*0.09;
  let edgeColor = mix(palette(edgeCoordinate(v.along,-1.0)+drift),
    palette(edgeCoordinate(v.along,1.0)+drift),side*0.5+0.5);
  let reflection = highlightEnergy(
    mix(pulse(v.along,-1.0),pulse(v.along,1.0),side*0.5+0.5)*u.flow.x);
  let rimPosition = abs(side);
  let rimWidth = 0.018+u.material.x*0.12;
  let aa = max(fwidth(rimPosition),0.005);
  let rim = smoothstep(1.0-rimWidth-aa,1.0-rimWidth+aa,rimPosition);
  let light = normalize(vec3f(-0.35,-0.55,1.3));
  let diffuse = max(dot(n,light),0.0);
  let specular = pow(max(dot(n,normalize(light+vec3f(0.0,0.0,1.0))),0.0),20.0);
  let sheen = 0.5+0.5*sin(v.along-u.weave.x+v.ring*2.0);
  let pearl = mix(u.ink.rgb,edgeColor,u.material.y*sheen*0.32);
  var body = pearl*(0.78+0.2*diffuse);
  body = mix(body,vec3f(0.98,0.975,0.965),specular*0.085);
  let rimColor = mix(edgeColor,pearl,0.24)*(0.86+diffuse*0.12);
  body = mix(body,rimColor,rim*min(0.9,u.material.x*1.2));
  let grazing = pow(1.0-abs(n.z),2.0);
  let glintColor = mix(edgeColor,vec3f(0.98,0.975,0.965),0.24);
  let glintBand = smoothstep(0.7-aa,0.995+aa,rimPosition);
  body = mix(body,glintColor,glintBand*reflection*(0.22+grazing*0.38));
  return vec4f(body,1.0);
}

struct EdgeVertex {
  @builtin(position) position: vec4f,
  @location(0) across: f32,
  @location(1) along: f32,
  @location(2) side: f32,
  @location(3) response: f32,
}
fn edgePoint(t: f32, side: f32) -> vec4f {
  return project(roll(curve(t)+ribbonNormal(t)*ribbonWidth(t)*side));
}
@vertex fn edgeVertex(@builtin(vertex_index) index: u32,
  @builtin(instance_index) instance: u32) -> EdgeVertex {
  let t = f32(index/2u)/f32(SEGMENTS)*TAU;
  let across = f32(index%2u)*2.0-1.0;
  let side = f32(instance)*2.0-1.0;
  let center = edgePoint(t,side);
  let step = TAU/f32(SEGMENTS);
  let a = edgePoint(t-step,side);
  let b = edgePoint(t+step,side);
  let size = u.viewport.xy;
  let aspect = size/min(size.x,size.y);
  let previous = (center.xy/center.w-a.xy/a.w)*aspect;
  let next = (b.xy/b.w-center.xy/center.w)*aspect;
  let delta = previous+next;
  let tangent = delta/max(length(delta),0.00001);
  let normal = vec2f(-tangent.y,tangent.x);
  let fit = min(1.0,size.x/size.y*0.78);
  // Keep diffusion close to the material; strength never inflates the halo into a bead.
  let requested = ribbonWidth(t)*fit*(1.0+u.material.z*1.2)/center.w;
  // Offset strips fold across themselves when the halo exceeds a bend's radius.
  // A smooth curvature limit keeps the inner halo from forming bright triangular fans.
  let area = abs(previous.x*next.y-previous.y*next.x);
  let bendRadius = 0.45*length(previous)*length(next)*length(delta)/max(2.0*area,0.00000001);
  let radius = requested*bendRadius/max(requested+bendRadius,0.00001);
  let offset = normal*across*radius/aspect*center.w;
  var out: EdgeVertex;
  // No depth writes: the opaque surface occludes light on the farther strand.
  out.position = vec4f(center.xy+offset,center.z-0.00015*center.w,center.w);
  out.across = across;
  out.along = t;
  out.side = side;
  let surfaceNormal = roll(ribbonNormal(t)*side);
  let grazing = pow(1.0-abs(surfaceNormal.z),2.0);
  let light = normalize(vec3f(-0.35,-0.55,1.3));
  out.response = (0.4+grazing*0.6)*(0.55+0.45*max(dot(surfaceNormal,light),0.0));
  return out;
}
@fragment fn edgeFragment(v: EdgeVertex) -> @location(0) vec4f {
  let phase = edgeCoordinate(v.along,v.side) + u.viewport.z*u.motion.y*0.09;
  let reflection = highlightEnergy(pulse(v.along,v.side)*u.flow.x);
  // Retain the palette's chroma instead of diluting the glow toward white.
  let color = mix(palette(phase),vec3f(0.98,0.975,0.965),0.18);
  let radius2 = v.across*v.across;
  let falloff = (exp(-radius2*12.0)*0.75+exp(-radius2*3.5)*0.25)
    * (1.0-smoothstep(0.7,1.0,abs(v.across)));
  let alpha = (u.material.z*0.12+reflection*0.62)*falloff*v.response;
  return vec4f(color*alpha,alpha);
}
`;
