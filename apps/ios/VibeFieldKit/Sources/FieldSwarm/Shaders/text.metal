// Glyphs and marks, one quad each, tinted by the instance. Type comes from the
// rasterised atlas as coverage; vendor marks come from the signed-distance
// atlas and are reconstructed at any size from the field. Both atlases are
// single-channel here (the phone rasterises glyphs into an r8 alpha mask; the
// marks png's field is its red channel), so both taps read `.r`.

struct Glyph {
  // x, y, width, height (points)
  float4 rect;
  float4 uv;
  float4 color;
  // x: 0 = coverage from the glyph atlas, 1 = signed distance from the marks;
  // y: the field's px range on screen (pxRange × quad px / tile texels)
  float4 params;
};

struct GlyphVertex {
  float4 position [[position]];
  float2 uv;
  uint index [[flat]];
};

vertex GlyphVertex vs(uint vid [[vertex_id]], uint instance [[instance_id]],
                      constant Frame& frame [[buffer(0)]], device const Glyph* glyphs [[buffer(3)]]) {
  Glyph glyph = glyphs[instance];
  float2 corner = quadCorner(vid) * 0.5 + 0.5;
  GlyphVertex out;
  out.position = cssToClip(glyph.rect.xy + corner * glyph.rect.zw, frame);
  out.uv = mix(glyph.uv.xy, glyph.uv.zw, corner);
  out.index = instance;
  return out;
}

fragment float4 fs(GlyphVertex in [[stage_in]], device const Glyph* glyphs [[buffer(3)]],
                   texture2d<float> atlas [[texture(0)]], texture2d<float> marks [[texture(1)]],
                   sampler atlasSampler [[sampler(0)]]) {
  Glyph glyph = glyphs[in.index];
  // Both taps stay in uniform control flow; the select picks one.
  float alpha = atlas.sample(atlasSampler, in.uv).r;
  float field = marks.sample(atlasSampler, in.uv).r;
  float fromField = clamp(glyph.params.y * (field - 0.5) + 0.5, 0.0, 1.0);
  float coverage = select(alpha, fromField, glyph.params.x > 0.5);
  return premul(glyph.color) * coverage;
}
