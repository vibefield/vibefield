// Under the bodies: a working body's resting drop shadow, breathing between a
// rest and a peak layer over three seconds, a gaussian occupancy of the disc,
// which is what CSS box-shadow is.

constant float SHADOW_MARGIN = 40.0;

vertex BodyVertex vs(uint vid [[vertex_id]], uint instance [[instance_id]],
                     constant Frame& frame [[buffer(0)]], device const Body* bodies [[buffer(1)]]) {
  uint flags = bodies[instance].flags.x;
  return bodyQuad(vid, instance, SHADOW_MARGIN, has(flags, F_SHADOW), frame, bodies);
}

fragment float4 fs(BodyVertex in [[stage_in]], constant Frame& frame [[buffer(0)]],
                   device const Body* bodies [[buffer(1)]]) {
  Body body = bodies[in.index];
  uint flags = body.flags.x;
  float r = body.posRadius.z * body.posRadius.w;
  float2 p = in.local;
  float time = frame.viewport.w;
  float4 out = float4(0.0);

  if (has(flags, F_SHADOW)) {
    float k = (0.5 - 0.5 * cos(time * TAU / 3.0 + body.motion.y)) * frame.params.y;
    float opacity = body.motion.w;
    float rest = occupancy(length(p - float2(0.0, 8.0)) - r, 2.5) * frame.shadow.a * (1.0 - k) * opacity;
    float peak = occupancy(length(p - float2(0.0, 12.0)) - r, 4.25) * frame.shadowPeak.a * k * opacity;
    out = over(out, premul(float4(frame.shadow.rgb, rest)));
    out = over(out, premul(float4(frame.shadow.rgb, peak)));
  }

  return out;
}
