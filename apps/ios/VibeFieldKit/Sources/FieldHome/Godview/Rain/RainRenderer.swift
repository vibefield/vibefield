import Foundation
import Metal

// PG-8 — THE RAIN'S RENDERER: a plan's ops (`RainFrame.plan`) as instanced quads, in the plan's order, through the one
// pipeline. The stage's fill is the pass's clear colour (it is opaque and first); a glyph is placed with
// its advance centred on the cell's x and its baseline on the row's y; a head with a blur paints its glow first, in
// its tail's channels at the column's weight (the canvas's `shadowColor`, `rgba(<tail>, 1)`, under `globalAlpha`).
// Whitespace has no ink and no quad. Hex and channel strings are read as the canvas reads them, gamma-encoded, so
// `bgra8Unorm` blends them as the canvas does.

/// One quad, laid out as the shader's `RainInstance`.
struct RainInstance: Equatable {
  var rect: SIMD4<Float>
  var uv: SIMD4<Float>
  var color: SIMD4<Float>
}

@MainActor
final class RainRenderer {
  static let pixelFormat: MTLPixelFormat = .bgra8Unorm

  let device: MTLDevice
  let queue: MTLCommandQueue
  let pipeline: MTLRenderPipelineState
  let sampler: MTLSamplerState
  /// How long the shader took to compile and link, milliseconds.
  let compileMs: Double

  init(device: MTLDevice) throws {
    throw RainPaintError.compile("the skeleton compiles nothing")
  }

  /// THE RAIN'S ONE SHADER, as a Swift string: compiled from source at first use (D-i14, the swarm's pattern,
  /// `FieldSwarm/SwarmGPU.swift`), so the rain needs no `.metal` resource and no Package.swift line. One instanced
  /// quad per glyph or glow sprite, in the plan's order, so the blending order is the canvas's paint order: a head's
  /// glow, then the head (a canvas shadow is painted under its shape). The atlas is coverage (r8); the colour arrives
  /// straight and leaves premultiplied, blended `one, oneMinusSourceAlpha` into `bgra8Unorm` — gamma-space blending,
  /// as a 2D canvas blends.
  static let shaderSource = """
    #include <metal_stdlib>
    using namespace metal;

    // One quad: its rect in the stage's points (y down), its atlas rect, its straight colour.
    struct RainInstance {
      float4 rect;
      float4 uv;
      float4 color;
    };

    struct RainUniforms {
      float2 viewport;
    };

    struct RainVarying {
      float4 position [[position]];
      float2 uv;
      float4 color;
    };

    vertex RainVarying rain_vs(
      uint vid [[vertex_id]], uint iid [[instance_id]],
      const device RainInstance *instances [[buffer(0)]],
      constant RainUniforms &uniforms [[buffer(1)]]
    ) {
      RainInstance quad = instances[iid];
      float2 corner = float2(float(vid & 1u), float(vid >> 1u));
      float2 point = mix(quad.rect.xy, quad.rect.zw, corner);
      RainVarying out;
      float2 clip = float2(point.x / uniforms.viewport.x * 2.0 - 1.0, 1.0 - point.y / uniforms.viewport.y * 2.0);
      out.position = float4(clip, 0.0, 1.0);
      out.uv = mix(quad.uv.xy, quad.uv.zw, corner);
      out.color = quad.color;
      return out;
    }

    fragment float4 rain_fs(
      RainVarying in [[stage_in]],
      texture2d<float> atlas [[texture(0)]],
      sampler linear [[sampler(0)]]
    ) {
      float alpha = in.color.a * atlas.sample(linear, in.uv).r;
      return float4(in.color.rgb * alpha, alpha);
    }
    """

  /// The plan's ops as the pass draws them: the clear colour (the stage's fill) and the quads, in order.
  static func instances(_ ops: [RainOp], atlas: RainAtlas) -> (clear: SIMD4<Float>, quads: [RainInstance]) {
    (.zero, [])
  }

  /// Encode one frame's quads into a pass that cleared to the stage, at `viewport` points.
  func encode(
    _ quads: [RainInstance], atlas: RainAtlas, viewport: SIMD2<Float>, into encoder: MTLRenderCommandEncoder
  ) {}

  nonisolated private static func quad(
    _ region: RainAtlasRegion, penX: Double, baseline: Double, colour: SIMD4<Float>
  ) -> RainInstance {
    RainInstance(rect: .zero, uv: .zero, color: colour)
  }

  /// `#rrggbb` at an opacity; anything else is no colour (transparent).
  nonisolated static func colour(_ hex: String, opacity: Double) -> SIMD4<Float> { .zero }

  /// `"r, g, b"` (the reader's `hexToRgb255`) at an opacity.
  nonisolated static func channels(_ rgb: String, opacity: Double) -> SIMD4<Float> { .zero }
}
