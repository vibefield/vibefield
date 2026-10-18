// One agent body: fill, the state's inner light, rim (working border,
// hollow dash, running comet), context ring, the pane band, focus ring, and
// the stale treatment. Every layer is a coverage of the same distance to
// the rim, so nothing cracks.

constant float BODY_MARGIN = 8.0;

vertex BodyVertex vs(uint vid [[vertex_id]], uint instance [[instance_id]],
                     constant Frame& frame [[buffer(0)]], device const Body* bodies [[buffer(1)]]) {
  return bodyQuad(vid, instance, BODY_MARGIN, true, frame, bodies);
}

fragment float4 fs(BodyVertex in [[stage_in]], constant Frame& frame [[buffer(0)]],
                   device const Body* bodies [[buffer(1)]]) {
  Body body = bodies[in.index];
  uint flags = body.flags.x;
  float r = body.posRadius.z * body.posRadius.w;
  float2 p = in.local;
  float dist = length(p);
  float d = dist - r;
  float inside = cov(d, frame);
  // A mounted body wears a band a thirtieth of the radius wide just outside
  // the rim, the gutter, in the colour the host packs (the theme's ink: the
  // phone's one pane, D-i12); the open card's light starts where it stops.
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

  // The one light inside a body. The project's colour is not here — it is the
  // folder before the name, and nowhere else (2026-09-16).
  //
  // A working body BREATHES: a density at its centre in the theme's own ink,
  // swelling and settling. A body that NEEDS THE USER GLOWS: its ground is the
  // state's own hue at this theme's calm end, and the state's light rides the
  // annulus over it in the full chroma, carried outward as wave after wave
  // (2026-09-18). Motion off holds the waves at their mid-crest, so a still
  // frame is a lit body and nothing here depends on animation to read. The
  // STATE GLOW group of the parameters drives every number of it.
  if (has(flags, F_CORE)) {
    bool moving = frame.params.y > 0.5;
    if (has(flags, F_WAVES)) {
      // Waves of the glow are CARRIED outward: a sinusoid in the radius moving
      // with time, so there is always another behind the one that is leaving
      // and never a pause. The crest is squared, which narrows the bright bands
      // and widens the dim ones, the way light ripples actually sit. Every
      // number is a tunable, and at their tuned values the glow ramps across
      // nearly the whole body but holds a fifth of its strength, so the copy
      // sits on the ground rather than in the light.
      float u = dist / r;
      float radial = smoothstep(frame.glowBand.x, frame.glowBand.y, u);
      float carried = sin((u * frame.glowWave.x - time * frame.glowWave.y) * TAU + body.motion.y);
      float crest = select(0.5, 0.5 + 0.5 * carried, moving);
      float lit = mix(1.0 - frame.glowWave.z, 1.0, crest * crest);
      out = over(out, premul(float4(body.core.rgb, radial * lit * frame.glowBand.z * body.core.a)) * inside);
    } else {
      float k = select(0.5, 0.5 - 0.5 * cos(time * TAU / 1.5 + body.motion.y), moving);
      float reach = r * mix(0.5, 0.78, k);
      float core = exp(-(dist * dist) / (reach * reach) * 2.0);
      out = over(out, premul(float4(body.core.rgb, mix(0.16, 0.34, k) * body.core.a)) * core * inside);
    }
  }

  // The rim. A working body wears a 1px border in the ink at the edge's weight.
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

  // The context ring on the rim: a faint ink track and the gauge, a twelfth of
  // the radius wide (5px at 60), from twelve o'clock clockwise with round
  // caps, its outer edge on the rim. The gauge CLIMBS as it goes round — its
  // weight ramps from the track's own to the title's — so a barely-used
  // context is barely there and a nearly-spent one is the strongest mark on
  // the body. That climb is the alarm; nothing here turns a colour
  // (2026-09-18). On a mounted body the band's gutter sits just outside
  // it, before the light begins.
  if (has(flags, F_RING)) {
    float width = r * GAUGE_WIDTH_RATIO;
    float ringRadius = r - width * 0.5;
    float ringD = dist - ringRadius;
    float fraction = body.ring.x;
    float gauge = 0.0;
    float weight = body.ring.y;
    if (fraction > 0.0) {
      float angle = clockwise(p);
      float endAngle = fraction * TAU;
      float capStart = length(p - float2(0.0, -ringRadius));
      float capEnd = length(p - float2(sin(endAngle) * ringRadius, -cos(endAngle) * ringRadius));
      // Signed distance to the arc with its round caps.
      float arcD = select(1.0e6, abs(ringD), angle <= fraction);
      float shape = min(arcD, min(capStart, capEnd)) - width * 0.5;
      gauge = cov(shape, frame);
      // How far round this pixel sits, with the caps folded onto the ends:
      // past the arc, whichever end is nearer owns it, so neither cap takes
      // the other's weight.
      float gap = 1.0 - fraction;
      float along = select(min(angle, fraction), 0.0, angle > fraction + gap * 0.5);
      weight = mix(body.ring.y, body.ring.w, clamp(along, 0.0, 1.0));
    }
    // The track is only the part still to spend: it is cut out under the
    // gauge, round caps included, so no hairline shows through the filled arc.
    out = over(out, premul(float4(body.ink.rgb, body.ring.z)) * stroke(ringD, 1.0, frame) * (1.0 - gauge));
    out = over(out, premul(float4(body.ink.rgb, weight * body.motion.w)) * gauge);
  }

  // Mounted in the pane: the gutter band outside the rim, in the packed colour;
  // the outer light (the glow pass) joins it only for the open card's body.
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
