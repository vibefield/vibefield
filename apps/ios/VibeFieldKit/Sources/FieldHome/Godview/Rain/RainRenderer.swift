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
    self.device = device
    guard let queue = device.makeCommandQueue() else { throw RainPaintError.noDevice }
    queue.label = "rain"
    self.queue = queue
    let started = Date()
    let library: MTLLibrary
    do {
      library = try device.makeLibrary(source: Self.shaderSource, options: MTLCompileOptions())
    } catch {
      throw RainPaintError.compile("\(error)")
    }
    let descriptor = MTLRenderPipelineDescriptor()
    descriptor.label = "rain"
    descriptor.vertexFunction = library.makeFunction(name: "rain_vs")
    descriptor.fragmentFunction = library.makeFunction(name: "rain_fs")
    guard let attachment = descriptor.colorAttachments[0] else { throw RainPaintError.pipeline("no attachment") }
    attachment.pixelFormat = Self.pixelFormat
    attachment.isBlendingEnabled = true
    attachment.rgbBlendOperation = .add
    attachment.alphaBlendOperation = .add
    attachment.sourceRGBBlendFactor = .one
    attachment.sourceAlphaBlendFactor = .one
    attachment.destinationRGBBlendFactor = .oneMinusSourceAlpha
    attachment.destinationAlphaBlendFactor = .oneMinusSourceAlpha
    do {
      pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
    } catch {
      throw RainPaintError.pipeline("\(error)")
    }
    compileMs = Date().timeIntervalSince(started) * 1000
    let samplerDescriptor = MTLSamplerDescriptor()
    samplerDescriptor.minFilter = .linear
    samplerDescriptor.magFilter = .linear
    samplerDescriptor.sAddressMode = .clampToEdge
    samplerDescriptor.tAddressMode = .clampToEdge
    guard let sampler = device.makeSamplerState(descriptor: samplerDescriptor) else {
      throw RainPaintError.pipeline("no sampler")
    }
    self.sampler = sampler
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
    var clear = SIMD4<Float>(0, 0, 0, 1)
    var quads: [RainInstance] = []
    quads.reserveCapacity(ops.count + 32)
    for op in ops {
      switch op {
      case .stage(_, _, let fill):
        clear = colour(fill, opacity: 1)
      case .glyph(let glyph):
        guard let region = atlas.glyph(glyph.unit) else { continue }
        let penX = glyph.x - region.advance / 2
        if glyph.blur > 0, let rgb = glyph.glowRgb, let glow = atlas.glow(glyph.unit, blur: glyph.blur) {
          quads.append(quad(glow, penX: penX, baseline: glyph.y, colour: channels(rgb, opacity: glyph.alpha)))
        }
        let ink: SIMD4<Float>
        switch glyph.ink {
        case .solid(let fill): ink = colour(fill, opacity: glyph.alpha)
        case .faded(let rgb, let opacity): ink = channels(rgb, opacity: opacity * glyph.alpha)
        }
        quads.append(quad(region, penX: penX, baseline: glyph.y, colour: ink))
      }
    }
    return (clear, quads)
  }

  /// Encode one frame's quads into a pass that cleared to the stage, at `viewport` points.
  func encode(
    _ quads: [RainInstance], atlas: RainAtlas, viewport: SIMD2<Float>, into encoder: MTLRenderCommandEncoder
  ) {
    guard !quads.isEmpty else { return }
    atlas.flush()
    let length = quads.count * MemoryLayout<RainInstance>.stride
    guard let buffer = quads.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: length) }) else {
      return
    }
    var uniforms = viewport
    encoder.setRenderPipelineState(pipeline)
    encoder.setVertexBuffer(buffer, offset: 0, index: 0)
    encoder.setVertexBytes(&uniforms, length: MemoryLayout<SIMD2<Float>>.stride, index: 1)
    encoder.setFragmentTexture(atlas.texture, index: 0)
    encoder.setFragmentSamplerState(sampler, index: 0)
    encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4, instanceCount: quads.count)
  }

  nonisolated private static func quad(
    _ region: RainAtlasRegion, penX: Double, baseline: Double, colour: SIMD4<Float>
  ) -> RainInstance {
    let x0 = penX + region.left
    let y0 = baseline + region.top
    return RainInstance(
      rect: SIMD4(Float(x0), Float(y0), Float(x0 + region.width), Float(y0 + region.height)),
      uv: SIMD4(region.u0, region.v0, region.u1, region.v1), color: colour)
  }

  /// `#rrggbb` at an opacity; anything else is no colour (transparent).
  nonisolated static func colour(_ hex: String, opacity: Double) -> SIMD4<Float> {
    let digits = hex.utf8.dropFirst()
    guard hex.hasPrefix("#"), digits.count == 6,
      let value = UInt32(String(decoding: digits, as: UTF8.self), radix: 16)
    else { return .zero }
    let red = Float((value >> 16) & 0xFF) / 255
    let green = Float((value >> 8) & 0xFF) / 255
    let blue = Float(value & 0xFF) / 255
    return SIMD4(red, green, blue, Float(opacity))
  }

  /// `"r, g, b"` (the reader's `hexToRgb255`) at an opacity.
  nonisolated static func channels(_ rgb: String, opacity: Double) -> SIMD4<Float> {
    let parts = rgb.split(separator: ",").compactMap { Float($0.trimmingCharacters(in: .whitespaces)) }
    guard parts.count == 3 else { return .zero }
    return SIMD4(parts[0] / 255, parts[1] / 255, parts[2] / 255, Float(opacity))
  }
}
