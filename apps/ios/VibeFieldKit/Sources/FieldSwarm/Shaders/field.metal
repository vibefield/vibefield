// The ground of the swarm: the faint 24px grid under a radial mask, and the
// hold-to-create indicator while a long press is in flight. One triangle.

struct FieldVertex {
  float4 position [[position]];
};

vertex FieldVertex vs(uint vid [[vertex_id]]) {
  FieldVertex out;
  float2 uv = float2(float((vid << 1u) & 2u), float(vid & 2u));
  out.position = float4(uv * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

static inline float lineCoverage(float coordinate, float pitch, constant Frame& frame) {
  // A 1px line at the start of every tile, box-filtered at the device pixel.
  float half_ = 0.5 / frame.viewport.z;
  float f = fract(coordinate / pitch) * pitch;
  float overlap = min(f + half_, 1.0) - max(f - half_, 0.0);
  return clamp(overlap * frame.viewport.z, 0.0, 1.0);
}

fragment float4 fs(FieldVertex in [[stage_in]], constant Frame& frame [[buffer(0)]]) {
  float dpr = frame.viewport.z;
  float2 p = in.position.xy / dpr;
  float2 size = frame.viewport.xy;
  float2 centre = size * 0.5;
  float4 out = float4(0.0);

  float pitch = frame.params.z;
  float lines = max(lineCoverage(p.x, pitch, frame), lineCoverage(p.y, pitch, frame));
  // `radial-gradient(circle at center, black 20%, transparent 82%)`: the
  // circle reaches the farthest corner.
  float reach = length(centre);
  float mask = 1.0 - smoothstep(0.2, 0.82, length(p - centre) / reach);
  out = over(out, premul(float4(frame.grid.rgb, frame.grid.a * lines * mask)));

  if (frame.pointer.w > 0.5) {
    float progress = clamp(frame.pointer.z, 0.0, 1.0);
    float eased = 1.0 - pow(1.0 - progress, 3.0);
    float radius = 16.0 * mix(0.55, 1.0, eased);
    float opacity = min(progress / 0.2, 1.0) * mix(0.8, 1.0, eased);
    float2 q = p - frame.pointer.xy;
    float d = length(q) - radius;
    float4 rim = mix(frame.holdRim, frame.holdInk, eased);
    out = over(out, premul(frame.holdFill) * cov(d, frame) * opacity);
    out = over(out, premul(rim) * cov(abs(d + 0.5) - 0.5, frame) * opacity);
    out = over(out, premul(frame.holdInk) * cov(length(q) - 2.0, frame) * opacity);
  }

  return out;
}
