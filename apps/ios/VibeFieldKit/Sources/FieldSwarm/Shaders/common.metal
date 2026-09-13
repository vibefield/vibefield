// Shared by every swarm pipeline; the renderer prepends this to each shader.
// A transcription of the reference's `common.wgsl` (puppeteer views, RFC 005):
//
// All geometry is in points with y down, the same space the physics and the
// touch use; the screen scale only enters through `cov`, the one-pixel box
// filter, so edges are one device pixel wide at any scale. Colours are
// straight-alpha sRGB in the buffers and premultiplied on output, composited
// over the SwiftUI ground with (one, one-minus-src-alpha).

#include <metal_stdlib>
using namespace metal;

struct Frame {
  // width, height (points), screen scale, time (s; frozen when motion is off)
  float4 viewport;
  // body fill opacity, motion (0/1), grid pitch (points), unused
  float4 params;
  float4 grid;
  // the theme's shadow colour; `a` is the resting alpha, `shadowPeak.a` the peak's
  float4 shadow;
  float4 shadowPeak;
  // hold-to-create: x, y, progress 0..1, active (0/1)
  float4 pointer;
  float4 orange;
  float4 holdRim;
  float4 holdFill;
  float4 holdInk;
};

struct Body {
  // x, y, radius, visual scale (arrival curve)
  float4 posRadius;
  float4 fill;
  float4 ink;
  float4 accent;
  float4 rim;
  // x: flag bits, y: first sample of this body's graph (output side, then input side), z/w unused
  uint4 flags;
  // context ring: fraction 0..1, unused, track alpha, unused
  float4 ring;
  // the outer light: reach (points), strength, breath (0..1), phase seed
  float4 glow;
  // spawn time (s), phase seed, stale mix (0/1), opacity
  float4 motion;
  float4 link;
  // the burn bars' band as fractions of the diameter: top (full intensity), bottom (none)
  float4 graph;
};

constant uint F_HOLLOW = 1u;
constant uint F_RUNNING = 2u;
constant uint F_GRAPH = 4u;
constant uint F_GLOW = 8u;
constant uint F_RIM = 16u;
constant uint F_STALE = 32u;
constant uint F_LINKED = 64u;
constant uint F_FOCUS = 128u;
constant uint F_RING_HOT = 512u;
constant uint F_RING = 1024u;
constant uint F_SHADOW = 2048u;
constant uint F_CORE = 4096u;
constant uint F_FLOOD = 8192u;

constant float TAU = 6.28318530718;
// The context gauge's width and the light's gutter follow the body's radius:
// 5px and 2px on the 60px working body, thicker on a bigger one.
constant float GAUGE_WIDTH_RATIO = 5.0 / 60.0;
constant float LIGHT_GUTTER_RATIO = 2.0 / 60.0;
// The burn bars span this much of the diameter, centred, so they stay clear of the rim.
constant float BARS_SPAN = 0.56;
// Per side; a body's samples are the output side then the input side.
constant uint GRAPH_SAMPLES = 20u;

static inline bool has(uint flags, uint bit) {
  return (flags & bit) != 0u;
}

static inline float4 cssToClip(float2 p, constant Frame& frame) {
  return float4(p.x / frame.viewport.x * 2.0 - 1.0, 1.0 - p.y / frame.viewport.y * 2.0, 0.0, 1.0);
}

static inline float2 quadCorner(uint vid) {
  const float2 corners[6] = {
    float2(-1.0, -1.0), float2(1.0, -1.0), float2(-1.0, 1.0),
    float2(-1.0, 1.0), float2(1.0, -1.0), float2(1.0, 1.0),
  };
  return corners[vid];
}

static inline float4 premul(float4 c) {
  return float4(c.rgb * c.a, c.a);
}

/// Source-over of premultiplied `src` on premultiplied `dst`.
static inline float4 over(float4 dst, float4 src) {
  return src + dst * (1.0 - src.a);
}

/// Coverage of a signed distance (points) under a one-device-pixel box filter.
static inline float cov(float d, constant Frame& frame) {
  return clamp(0.5 - d * frame.viewport.z, 0.0, 1.0);
}

/// Coverage of a stroke of width `w` centred on the iso-line `d = 0`.
static inline float stroke(float d, float w, constant Frame& frame) {
  return cov(abs(d) - w * 0.5, frame);
}

// Abramowitz–Stegun 7.1.26: enough for a shadow.
static inline float erfA(float x) {
  float s = sign(x);
  float a = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * a);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}

/// The disc blurred by a gaussian of `sigma`: what CSS `box-shadow` paints,
/// with sigma half the blur radius.
static inline float occupancy(float d, float sigma) {
  return 0.5 - 0.5 * erfA(d / max(sigma * 1.4142136, 0.0001));
}

static inline float luma(float3 c) {
  return dot(c, float3(0.2126, 0.7152, 0.0722));
}

/// Angle from twelve o'clock, clockwise, 0..1.
static inline float clockwise(float2 p) {
  return fract(atan2(p.x, -p.y) / TAU + 1.0);
}

struct BodyVertex {
  float4 position [[position]];
  float2 local;
  uint index [[flat]];
};

static inline BodyVertex bodyQuad(uint vid, uint instance, float margin, bool enabled,
                                  constant Frame& frame, device const Body* bodies) {
  Body body = bodies[instance];
  float radius = body.posRadius.z * body.posRadius.w;
  float extent = select(0.0, radius + margin, enabled);
  float2 corner = quadCorner(vid);
  BodyVertex out;
  out.local = corner * extent;
  out.position = cssToClip(body.posRadius.xy + out.local, frame);
  out.index = instance;
  return out;
}
