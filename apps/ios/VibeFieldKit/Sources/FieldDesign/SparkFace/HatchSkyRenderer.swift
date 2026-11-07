import CoreGraphics
import Foundation
import Metal

// IOS-12f's f5 (PC-D8 A; DESIGN.md §2.10, amended 2026-11-07) — THE HATCH'S METAL: `HatchSky.metal`'s programs from
// FieldDesign's default library, and the star engine's one frame (`SparkEngine.render(t)`, star-spark.js :634):
// - the engine's four targets in half floats (`resize`, :569: the scene, a half and two quarters, RGBA16F as the
//   frames' host drew them, LINEAR and CLAMP_TO_EDGE);
// - the night ground into the scene, unblended; then each star's trail, body and particles over it, blended
//   premultiplied (ONE, ONE_MINUS_SRC_ALPHA), every star's rows in a 32×N RGBA32F texture;
// - the bloom: the scene down to the half above 0.6, down again to a quarter, and four blurs between the quarters;
// - the composite into the frame: the scene, the bloom at 0.45, the shoulder, the grain and the dither.
// The pixel ratio is the view's, capped at the engine's 2 (VF-PM's Q3 ruling, 2026-11-07 13:58:40Z).

/// The hatch's Metal on one device. Nothing changes after it is built, and Metal's device, pipelines and buffers may
/// be used from any thread, so one renderer serves the frames golden (any thread) and the sheet's sky (the main
/// thread).
public final class HatchSkyRenderer: @unchecked Sendable {
  public let device: any MTLDevice
  let queue: any MTLCommandQueue
  /// FieldDesign's default library, kept for the hin probe (`hin`, f5h).
  let library: any MTLLibrary
  let ground: any MTLRenderPipelineState
  let trail: any MTLRenderPipelineState
  let body: any MTLRenderPipelineState
  let parts: any MTLRenderPipelineState
  let down: any MTLRenderPipelineState
  let blur: any MTLRenderPipelineState
  let composites: [MTLPixelFormat: any MTLRenderPipelineState]
  let sampler: any MTLSamplerState
  let palettes: any MTLBuffer
  let confetti: any MTLBuffer

  /// The system's GPU, built once; the error where Metal cannot build the sky (the sheet then draws the flat star).
  public static let system = Result<HatchSkyRenderer, any Error> {
    guard let device = MTLCreateSystemDefaultDevice() else { throw SparkStarError.unavailable("a Metal device") }
    return try HatchSkyRenderer(device: device)
  }

  /// The engine's targets: RGBA16F, which it takes when EXT_color_buffer_float is there (the frames' host had it).
  public static let sceneFormat = MTLPixelFormat.rgba16Float
  /// A frame's pixels (`toDataURL`'s RGBA) and a layer's (`CAMetalLayer`'s BGRA): 8 bits a channel, no sRGB encoding,
  /// as WebGL's default framebuffer.
  public static let frameFormat = MTLPixelFormat.rgba8Unorm
  public static let layerFormat = MTLPixelFormat.bgra8Unorm
  /// Each star's particles (`PARTS`, :543): 22 debris, 8 glitter, 26 dust.
  public static let particles = 56

  public init(device: any MTLDevice) throws {
    self.device = device
    let library = try device.makeDefaultLibrary(bundle: .module)
    self.library = library
    func function(_ name: String) throws -> any MTLFunction {
      guard let function = library.makeFunction(name: name) else {
        throw SparkStarError.unavailable("HatchSky.metal's \(name) in FieldDesign's library")
      }
      return function
    }
    func pipeline(
      _ vertex: String, _ fragment: String, format: MTLPixelFormat, blended: Bool
    ) throws -> any MTLRenderPipelineState {
      let descriptor = MTLRenderPipelineDescriptor()
      descriptor.vertexFunction = try function(vertex)
      descriptor.fragmentFunction = try function(fragment)
      guard let attachment = descriptor.colorAttachments[0] else {
        throw SparkStarError.unavailable("a colour attachment")
      }
      attachment.pixelFormat = format
      if blended {
        attachment.isBlendingEnabled = true
        attachment.sourceRGBBlendFactor = .one
        attachment.destinationRGBBlendFactor = .oneMinusSourceAlpha
        attachment.sourceAlphaBlendFactor = .one
        attachment.destinationAlphaBlendFactor = .oneMinusSourceAlpha
      }
      return try device.makeRenderPipelineState(descriptor: descriptor)
    }
    let full = "hatch_sky_full_vertex"
    ground = try pipeline(full, "hatch_sky_ground_fragment", format: Self.sceneFormat, blended: false)
    trail = try pipeline(
      "hatch_sky_trail_vertex", "hatch_sky_trail_fragment", format: Self.sceneFormat, blended: true)
    body = try pipeline("hatch_sky_body_vertex", "hatch_sky_body_fragment", format: Self.sceneFormat, blended: true)
    parts = try pipeline(
      "hatch_sky_part_vertex", "hatch_sky_part_fragment", format: Self.sceneFormat, blended: true)
    down = try pipeline(full, "hatch_sky_down_fragment", format: Self.sceneFormat, blended: false)
    blur = try pipeline(full, "hatch_sky_blur_fragment", format: Self.sceneFormat, blended: false)
    var composites: [MTLPixelFormat: any MTLRenderPipelineState] = [:]
    for format in [Self.frameFormat, Self.layerFormat] {
      composites[format] = try pipeline(full, "hatch_sky_comp_fragment", format: format, blended: false)
    }
    self.composites = composites
    let filtering = MTLSamplerDescriptor()
    filtering.minFilter = .linear
    filtering.magFilter = .linear
    filtering.mipFilter = .notMipmapped
    filtering.sAddressMode = .clampToEdge
    filtering.tAddressMode = .clampToEdge
    filtering.normalizedCoordinates = true
    guard let sampler = device.makeSamplerState(descriptor: filtering) else {
      throw SparkStarError.unavailable("a linear sampler")
    }
    self.sampler = sampler
    guard let queue = device.makeCommandQueue() else { throw SparkStarError.unavailable("a command queue") }
    self.queue = queue
    // uPal (ten colours a palette) and uConf (eight), each colour a float4 (the shader's stride), as `hex` reads them
    let colours = StarSpark.palettes.flatMap { $0.c.map(Self.rgba) }
    let confetti = StarSpark.confetti.map(Self.rgba)
    guard
      let paletteBuffer = device.makeBuffer(
        bytes: colours, length: MemoryLayout<SIMD4<Float>>.stride * colours.count, options: .storageModeShared),
      let confettiBuffer = device.makeBuffer(
        bytes: confetti, length: MemoryLayout<SIMD4<Float>>.stride * confetti.count, options: .storageModeShared)
    else { throw SparkStarError.unavailable("the palettes' buffers") }
    palettes = paletteBuffer
    self.confetti = confettiBuffer
  }

  static func rgba(_ hex: String) -> SIMD4<Float> {
    let rgb = StarSpark.rgb(hex)
    return SIMD4(rgb.x, rgb.y, rgb.z, 0)
  }

  /// The engine's four targets at a frame's pixel size (`resize`, :569): the scene, its half and two quarters.
  struct Targets {
    let scene: any MTLTexture
    let half: any MTLTexture
    let qa: any MTLTexture
    let qb: any MTLTexture
  }

  func targets(width: Int, height: Int) throws -> Targets {
    func make(_ width: Int, _ height: Int) throws -> any MTLTexture {
      let descriptor = MTLTextureDescriptor.texture2DDescriptor(
        pixelFormat: Self.sceneFormat, width: width, height: height, mipmapped: false)
      descriptor.usage = [.renderTarget, .shaderRead]
      descriptor.storageMode = .private
      guard let texture = device.makeTexture(descriptor: descriptor) else {
        throw SparkStarError.unavailable("the sky's targets")
      }
      return texture
    }
    return Targets(
      scene: try make(width, height), half: try make(max(1, width >> 1), max(1, height >> 1)),
      qa: try make(max(1, width >> 2), max(1, height >> 2)), qb: try make(max(1, width >> 2), max(1, height >> 2)))
  }

  /// A texture for `capacity` stars' rows: 32 RGBA32F texels a star, a star a row.
  func rowsTexture(capacity: Int) throws -> any MTLTexture {
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .rgba32Float, width: 32, height: max(1, capacity), mipmapped: false)
    descriptor.usage = .shaderRead
    descriptor.storageMode = .shared
    guard let texture = device.makeTexture(descriptor: descriptor) else {
      throw SparkStarError.unavailable("a rows texture")
    }
    return texture
  }

  /// `texSubImage2D(…, ROW, max, …)`: the first `stars` stars' rows.
  static func upload(_ rows: [Float], stars: Int, to texture: any MTLTexture) {
    guard stars > 0 else { return }
    rows.withUnsafeBytes { bytes in
      guard let base = bytes.baseAddress else { return }
      texture.replace(
        region: MTLRegionMake2D(0, 0, 32, stars), mipmapLevel: 0, withBytes: base,
        bytesPerRow: 32 * MemoryLayout<SIMD4<Float>>.stride)
    }
  }

  /// One full-screen pass of the bloom: `source` into `target`.
  private func pass(
    _ pipeline: any MTLRenderPipelineState, into target: any MTLTexture, from source: any MTLTexture,
    uniforms: [SIMD4<Float>], on buffer: any MTLCommandBuffer
  ) throws {
    let descriptor = MTLRenderPassDescriptor()
    descriptor.colorAttachments[0].texture = target
    descriptor.colorAttachments[0].loadAction = .dontCare
    descriptor.colorAttachments[0].storeAction = .store
    guard let encoder = buffer.makeRenderCommandEncoder(descriptor: descriptor) else {
      throw SparkStarError.unavailable("a render encoder")
    }
    encoder.setRenderPipelineState(pipeline)
    encoder.setFragmentTexture(source, index: 0)
    encoder.setFragmentSamplerState(sampler, index: 0)
    encoder.setFragmentBytes(uniforms, length: MemoryLayout<SIMD4<Float>>.stride * uniforms.count, index: 0)
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    encoder.endEncoding()
  }

  /// `render(t)`: the frame of `stars` stars' rows, on a sky `view` points in size at `scale` pixels a point, at
  /// `time`, with `grain`, composited into `output` (a target of `format`, the scene's size).
  func encode(
    on buffer: any MTLCommandBuffer, output: any MTLTexture, format: MTLPixelFormat, targets: Targets,
    rows: any MTLTexture, stars: Int, view: CGSize, scale: Double, time: Double, grain: Double
  ) throws {
    guard let composite = composites[format] else { throw SparkStarError.unavailable("a composite for \(format)") }
    let width = targets.scene.width
    let height = targets.scene.height
    let night: Float = HatchSky.night ? 1 : 0
    // a = (uRes, uTime, uDpr), b = (uNight, uP, uResPx), and c zero: the zero HatchSky.metal's `hin` ORs into each of a
    // hash's two products, so the compiler cannot fuse one into the sum (f5f 4/4)
    let sky: [SIMD4<Float>] = [
      SIMD4(Float(view.width), Float(view.height), Float(time), Float(scale)),
      SIMD4(night, Float(Self.particles), Float(width), Float(height)),
      SIMD4(0, 0, 0, 0),
    ]
    let skyLength = MemoryLayout<SIMD4<Float>>.stride * sky.count
    let scenePass = MTLRenderPassDescriptor()
    scenePass.colorAttachments[0].texture = targets.scene
    scenePass.colorAttachments[0].loadAction = .clear
    scenePass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    scenePass.colorAttachments[0].storeAction = .store
    guard let scene = buffer.makeRenderCommandEncoder(descriptor: scenePass) else {
      throw SparkStarError.unavailable("a render encoder")
    }
    // the ground, unblended
    scene.setRenderPipelineState(ground)
    scene.setFragmentBytes(sky, length: skyLength, index: 0)
    scene.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    // every star's trail, body and particles, blended, as the engine draws the slots it uses
    if stars > 0 {
      for (pipeline, instances) in [(trail, stars), (body, stars), (parts, stars * Self.particles)] {
        scene.setRenderPipelineState(pipeline)
        scene.setVertexTexture(rows, index: 0)
        scene.setVertexBytes(sky, length: skyLength, index: 0)
        scene.setVertexBuffer(palettes, offset: 0, index: 1)
        scene.setVertexBuffer(confetti, offset: 0, index: 2)
        scene.setFragmentTexture(rows, index: 0)
        scene.setFragmentBytes(sky, length: skyLength, index: 0)
        scene.setFragmentBuffer(palettes, offset: 0, index: 1)
        scene.setFragmentBuffer(confetti, offset: 0, index: 2)
        scene.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4, instanceCount: instances)
      }
    }
    scene.endEncoding()
    // the bloom: down above 0.6 to the half, down to a quarter, four blurs between the quarters
    let bloom = HatchSky.bloom && HatchSky.night
    var bloomed = targets.scene
    if bloom {
      func texel(_ texture: any MTLTexture, halved: Bool) -> SIMD2<Float> {
        let by = halved ? 2.0 : 1.0
        return SIMD2(Float(1 / Double(texture.width) / by), Float(1 / Double(texture.height) / by))
      }
      let toHalf = texel(targets.half, halved: true)
      try pass(
        down, into: targets.half, from: targets.scene, uniforms: [SIMD4(toHalf.x, toHalf.y, 0.6, 0), SIMD4()],
        on: buffer)
      let toQuarter = texel(targets.qa, halved: true)
      try pass(
        down, into: targets.qa, from: targets.half, uniforms: [SIMD4(toQuarter.x, toQuarter.y, 0, 0), SIMD4()],
        on: buffer)
      var a = targets.qa
      var b = targets.qb
      for off in 0..<4 {
        let step = texel(a, halved: false)
        try pass(blur, into: b, from: a, uniforms: [SIMD4(step.x, step.y, Float(off), 0), SIMD4()], on: buffer)
        swap(&a, &b)
      }
      bloomed = a
    }
    // the composite into the frame
    let compositePass = MTLRenderPassDescriptor()
    compositePass.colorAttachments[0].texture = output
    compositePass.colorAttachments[0].loadAction = .dontCare
    compositePass.colorAttachments[0].storeAction = .store
    guard let encoder = buffer.makeRenderCommandEncoder(descriptor: compositePass) else {
      throw SparkStarError.unavailable("a render encoder")
    }
    let uniforms: [SIMD4<Float>] = [
      SIMD4(
        Float(1 / Double(width)), Float(1 / Double(height)), 0, bloom ? Float(HatchSky.bloomStrength) : 0),
      SIMD4(night, Float(time), Float(grain), Float(height)),
    ]
    encoder.setRenderPipelineState(composite)
    encoder.setFragmentTexture(targets.scene, index: 0)
    encoder.setFragmentTexture(bloomed, index: 1)
    encoder.setFragmentSamplerState(sampler, index: 0)
    encoder.setFragmentBytes(uniforms, length: MemoryLayout<SIMD4<Float>>.stride * uniforms.count, index: 0)
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    encoder.endEncoding()
  }

  /// One frame of the sky drawn offscreen, as `render(t)` and `toDataURL` draw one: `stars` stars' rows (128 floats
  /// each, in slot order), on a sky `size` points in size at `scale` pixels a point (`Math.round` of each side), at
  /// `time`, with `grain`. Opaque RGBA, 8 bits a channel, in sRGB.
  public func frame(
    rows: [Float], stars: Int, size: CGSize, scale: Double, time: Double, grain: Double
  ) throws -> CGImage {
    let width = max(1, Int((Double(size.width) * scale).rounded()))
    let height = max(1, Int((Double(size.height) * scale).rounded()))
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: Self.frameFormat, width: width, height: height, mipmapped: false)
    descriptor.usage = .renderTarget
    descriptor.storageMode = .private
    let bytesPerRow = width * 4
    // drawn into the GPU's own memory and copied out to a buffer: a read-back every host allows, the simulator's too
    guard let output = device.makeTexture(descriptor: descriptor),
      let readBack = device.makeBuffer(length: bytesPerRow * height, options: .storageModeShared)
    else { throw SparkStarError.unavailable("a frame's texture") }
    let rowsTexture = try rowsTexture(capacity: stars)
    Self.upload(rows, stars: stars, to: rowsTexture)
    let targets = try targets(width: width, height: height)
    guard let buffer = queue.makeCommandBuffer() else { throw SparkStarError.unavailable("a command buffer") }
    try encode(
      on: buffer, output: output, format: Self.frameFormat, targets: targets, rows: rowsTexture, stars: stars,
      view: size, scale: scale, time: time, grain: grain)
    guard let blit = buffer.makeBlitCommandEncoder() else { throw SparkStarError.unavailable("a blit encoder") }
    blit.copy(
      from: output, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
      sourceSize: MTLSize(width: width, height: height, depth: 1), to: readBack, destinationOffset: 0,
      destinationBytesPerRow: bytesPerRow, destinationBytesPerImage: bytesPerRow * height)
    blit.endEncoding()
    buffer.commit()
    buffer.waitUntilCompleted()
    if let error = buffer.error { throw error }
    let pixels = Data(bytes: readBack.contents(), count: bytesPerRow * height)
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let provider = CGDataProvider(data: pixels as CFData),
      let image = CGImage(
        width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: bytesPerRow, space: space,
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider,
        decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    else { throw SparkStarError.unavailable("a frame's picture") }
    return image
  }
}

extension HatchSkyRenderer {
  /// IOS-12f's f5h — `hin` as this GPU and its compiler compute it, for each ask's (a, k1, b, k2)
  /// (`hatch_sky_hin_probe`, which nothing draws). HatchSkyHinTests holds each answer, bit for bit, to the engine's
  /// form.
  func hin(_ asks: [SIMD4<Float>]) throws -> [Float] {
    guard !asks.isEmpty else { return [] }
    guard let function = library.makeFunction(name: "hatch_sky_hin_probe") else {
      throw SparkStarError.unavailable("HatchSky.metal's hatch_sky_hin_probe in FieldDesign's library")
    }
    let pipeline = try device.makeComputePipelineState(function: function)
    var count = UInt32(asks.count)
    var zero: UInt32 = 0
    guard
      let ask = device.makeBuffer(
        bytes: asks, length: MemoryLayout<SIMD4<Float>>.stride * asks.count, options: .storageModeShared),
      let answer = device.makeBuffer(length: MemoryLayout<Float>.stride * asks.count, options: .storageModeShared),
      let buffer = queue.makeCommandBuffer(), let encoder = buffer.makeComputeCommandEncoder()
    else { throw SparkStarError.unavailable("a compute pass for hatch_sky_hin_probe") }
    encoder.setComputePipelineState(pipeline)
    encoder.setBuffer(ask, offset: 0, index: 0)
    encoder.setBuffer(answer, offset: 0, index: 1)
    encoder.setBytes(&count, length: MemoryLayout<UInt32>.stride, index: 2)
    encoder.setBytes(&zero, length: MemoryLayout<UInt32>.stride, index: 3)
    let width = pipeline.threadExecutionWidth
    encoder.dispatchThreadgroups(
      MTLSize(width: (asks.count + width - 1) / width, height: 1, depth: 1),
      threadsPerThreadgroup: MTLSize(width: width, height: 1, depth: 1))
    encoder.endEncoding()
    buffer.commit()
    buffer.waitUntilCompleted()
    let answers = answer.contents().bindMemory(to: Float.self, capacity: asks.count)
    return Array(UnsafeBufferPointer(start: answers, count: asks.count))
  }
}
