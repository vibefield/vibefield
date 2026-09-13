// The outer light in the body's own colour: the mark of the body mounted in
// the SELECTED pane. Every other mounted body wears the band alone. Drawn
// after every body so it falls on neighbours the way light does. Two falloffs
// of the distance outside the rim: a tight photographic rim and a designer
// halo (power 2.65, the fit from the glow study), scaled by the tunable reach
// and strength, breathing if asked.

vertex BodyVertex vs(uint vid [[vertex_id]], uint instance [[instance_id]],
                     constant Frame& frame [[buffer(0)]], device const Body* bodies [[buffer(1)]]) {
  Body body = bodies[instance];
  return bodyQuad(vid, instance, body.glow.x + 6.0, has(body.flags.x, F_GLOW), frame, bodies);
}

fragment float4 fs(BodyVertex in [[stage_in]], constant Frame& frame [[buffer(0)]],
                   device const Body* bodies [[buffer(1)]]) {
  Body body = bodies[in.index];
  float r = body.posRadius.z * body.posRadius.w;
  float d = length(in.local) - r;
  // The light starts a thirtieth of the radius off the rim (2px at 60), where
  // the pane-colour gutter band stops.
  float gutter = r * LIGHT_GUTTER_RATIO;
  float outside = clamp((d - gutter) * frame.viewport.z + 0.5, 0.0, 1.0);
  float reach = max(body.glow.x, 1.0);
  float strength = body.glow.y;
  float breath = body.glow.z * frame.params.y;
  float time = frame.viewport.w;
  float breathe = 1.0 - breath * 0.62 * (0.5 - 0.5 * cos(time * TAU / 1.2 + body.glow.w));
  float outer = max(d - gutter, 0.0);
  float rim = exp(-outer / 6.0);
  float halo = pow(clamp(1.0 - outer / reach, 0.0, 1.0), 2.65);
  float a = clamp(strength * (0.45 * rim + 0.6 * halo), 0.0, 1.0) * breathe * outside;
  // The light beyond the band is the pane's, like the band: the colour of the
  // pane the body is worked in, not the project's.
  return premul(float4(body.link.rgb, a));
}
