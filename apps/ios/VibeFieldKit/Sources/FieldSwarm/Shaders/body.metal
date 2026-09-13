// One agent body: fill, the blocked flood, burn bars, rim (working border,
// hollow dash, running comet), context ring, the pane band, focus ring, and
// the stale treatment. Every layer is a coverage of the same distance to
// the rim, so nothing cracks.

constant float BODY_MARGIN = 8.0;

vertex BodyVertex vs(uint vid [[vertex_id]], uint instance [[instance_id]],
                     constant Frame& frame [[buffer(0)]], device const Body* bodies [[buffer(1)]]) {
  return bodyQuad(vid, instance, BODY_MARGIN, true, frame, bodies);
}

fragment float4 fs(BodyVertex in [[stage_in]], constant Frame& frame [[buffer(0)]],
                   device const Body* bodies [[buffer(1)]], device const float* samples [[buffer(2)]]) {
  Body body = bodies[in.index];
  uint flags = body.flags.x;
  float r = body.posRadius.z * body.posRadius.w;
  float2 p = in.local;
  float dist = length(p);
  float d = dist - r;
  float inside = cov(d, frame);
  // A mounted body wears its colour as a band a thirtieth of the radius wide
  // just outside the rim, the gutter; the light of the selected pane's body
  // starts where the band stops.
  bool linked = has(flags, F_LINKED);
  float edge = select(0.0, r * LIGHT_GUTTER_RATIO, linked);
  float time = frame.viewport.w;
  float4 out = float4(0.0);

  // Fill. A hollow terminal has none; its rim says everything.
  if (!has(flags, F_HOLLOW)) {
    float4 fill = body.fill;
    fill.a = fill.a * frame.params.x;
    out = over(out, premul(fill) * inside);
  }

  // Blocked: the accent floods the body from the centre, a gaussian so strong
  // the circle is nearly the colour, thinning toward the rim so the ring and
  // the rim still read.
  if (has(flags, F_FLOOD)) {
    float reach = r * 1.6;
    float flood = exp(-(dist * dist) / (reach * reach) * 2.0);
    out = over(out, premul(float4(body.accent.rgb, 0.95 * body.accent.a)) * flood * inside);
  }

  // The burn bars: ten minutes of the UI ledger's steps, oldest left, as
  // rounded columns in the theme's ink either side of a baseline through the
  // middle of the band under the model line: output up, input down, each side
  // scaled so its tallest column fills its half of the band. Twenty bars of
  // thirty seconds, one sample each; the newest is the ink at full strength,
  // breathing, and never a colour.
  if (has(flags, F_GRAPH) && inside > 0.0) {
    float diameter = 2.0 * r;
    float top = body.graph.x;
    float bottom = body.graph.y;
    float bars = float(GRAPH_SAMPLES);
    float halfSpan = r * BARS_SPAN;
    float pitch = 2.0 * halfSpan / bars;
    float half_ = pitch * 0.3;
    float x01 = clamp((p.x + halfSpan) / (2.0 * halfSpan), 0.0, 0.9999);
    uint index = uint(floor(x01 * bars));
    uint first = body.flags.y;
    uint firstDown = first + GRAPH_SAMPLES;
    float up = samples[first + index];
    float down = samples[firstDown + index];
    float centre = (float(index) + 0.5) * pitch - halfSpan;
    float baseline = 0.5 * (top + bottom) * diameter - r;
    float reach = 0.5 * (bottom - top) * diameter - 1.0;
    // Each side is a column with a semicircular far end, cut flat half a
    // pixel off the baseline; a silent side keeps a 1.5px stub.
    float upTop = baseline - max(up * reach, 1.5);
    float2 qUp = float2(abs(p.x - centre), (upTop + half_) - p.y);
    float dUp = max(length(max(qUp, float2(0.0))) + min(max(qUp.x, qUp.y), 0.0) - half_, p.y - (baseline - 0.5));
    float downEnd = baseline + max(down * reach, 1.5);
    float2 qDown = float2(abs(p.x - centre), p.y - (downEnd - half_));
    float dDown = max(length(max(qDown, float2(0.0))) + min(max(qDown.x, qDown.y), 0.0) - half_, (baseline + 0.5) - p.y);
    float barCoverage = max(cov(dUp, frame), cov(dDown, frame)) * step(abs(p.x), halfSpan);
    bool newest = index == GRAPH_SAMPLES - 1u;
    float breathe = 0.5 + 0.5 * sin(time * TAU / 1.6 + body.motion.y);
    float alpha = select(0.45, mix(0.8, 1.0, breathe), newest) * body.motion.w;
    out = over(out, premul(float4(body.ink.rgb, alpha)) * barCoverage * inside);
    // The baseline itself, a hairline in the ink across the bars' span.
    float baselineCoverage = cov(abs(p.y - baseline) - 0.5, frame) * step(abs(p.x), halfSpan);
    out = over(out, premul(float4(body.ink.rgb, 0.22 * body.motion.w)) * baselineCoverage * inside);
  }

  // A light at the centre in the accent, breathing with the mark: the one
  // place the accent shows inside a working body, so it is allowed to be seen.
  if (has(flags, F_CORE)) {
    float k = select(0.5, 0.5 - 0.5 * cos(time * TAU / 1.5 + body.motion.y), frame.params.y > 0.5);
    float reach = r * mix(0.5, 0.78, k);
    float core = exp(-(dist * dist) / (reach * reach) * 2.0);
    out = over(out, premul(float4(body.accent.rgb, mix(0.16, 0.34, k) * body.accent.a)) * core * inside);
  }

  // The rim. A working body wears a 1px border in the working border colour.
  if (has(flags, F_RIM)) {
    out = over(out, premul(body.rim) * cov(abs(d + 0.5) - 0.5, frame));
  }

  // A hollow: dashed while empty, solid and faint with a comet while a job runs.
  if (has(flags, F_HOLLOW)) {
    float ringCoverage = cov(abs(d + 0.75) - 0.75, frame);
    if (has(flags, F_RUNNING)) {
      out = over(out, premul(float4(body.rim.rgb, body.rim.a * 0.22)) * ringCoverage);
      // The comet: a conic sweep, transparent for the first 60%, rising to full
      // at the head, one lap every 1.4s, in a ring 1.5–2.5px inside the rim.
      float head = fract(time / 1.4);
      float u = fract(clockwise(p) - head + 1.0);
      float sweep = smoothstep(0.6, 1.0, u);
      float cometRing = cov(abs(d + 2.0) - 0.5, frame);
      out = over(out, premul(float4(body.rim.rgb, body.rim.a)) * sweep * cometRing);
    } else {
      float arc = clockwise(p) * TAU * r;
      float dashOn = step(fract(arc / 7.5), 0.6);
      out = over(out, premul(float4(body.rim.rgb, body.rim.a * 0.52)) * ringCoverage * dashOn);
    }
  }

  // The context ring on the rim: a faint ink track and the gauge, a twelfth
  // of the radius wide (5px at 60), in the theme's ink at 55% (a mid grey
  // over either fill) whatever the state (the figure, not the gauge, turns
  // orange when hot), from twelve o'clock clockwise with round caps, its outer
  // edge on the rim. On a mounted body the pane-colour gutter sits just
  // outside it, before the light begins.
  if (has(flags, F_RING)) {
    float width = r * GAUGE_WIDTH_RATIO;
    float ringRadius = r - width * 0.5;
    float ringD = dist - ringRadius;
    float track = stroke(ringD, 1.0, frame);
    out = over(out, premul(float4(body.ink.rgb, body.ring.z)) * track);
    float fraction = body.ring.x;
    if (fraction > 0.0) {
      float angle = clockwise(p);
      float endAngle = fraction * TAU;
      float capStart = length(p - float2(0.0, -ringRadius));
      float capEnd = length(p - float2(sin(endAngle) * ringRadius, -cos(endAngle) * ringRadius));
      // Signed distance to the arc with its round caps.
      float arcD = select(1.0e6, abs(ringD), angle <= fraction);
      float shape = min(arcD, min(capStart, capEnd)) - width * 0.5;
      out = over(out, premul(float4(body.ink.rgb, 0.55 * body.motion.w)) * cov(shape, frame));
    }
  }

  // Mounted in a pane: the body's colour as the gutter band outside the rim;
  // the outer light (the glow pass) joins it only for the selected pane's body.
  if (linked) {
    out = over(out, premul(body.link) * cov(abs(d - edge * 0.5) - edge * 0.5, frame));
  }

  // Focus (VoiceOver on the phone): a 2px ring, 4px off the rim, in the theme's ink.
  if (has(flags, F_FOCUS)) {
    out = over(out, premul(float4(frame.holdInk.rgb, 1.0)) * cov(abs(d - edge - 5.0) - 1.0, frame));
  }

  // Evidence went quiet: dim and desaturate, never recolour.
  if (has(flags, F_STALE)) {
    float3 grey = float3(luma(out.rgb));
    out = float4(mix(out.rgb, grey, 0.75), out.a) * 0.58;
  }

  return out;
}
