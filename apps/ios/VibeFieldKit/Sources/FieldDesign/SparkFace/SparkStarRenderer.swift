import CoreGraphics
import Foundation
import Metal

// IOS-12e (PC-D6 A; DESIGN.md §2.10, amended 2026-11-06) — THE STAR'S METAL: `SparkStar.metal`'s two functions from
// FieldDesign's default library, one pipeline per pixel format, the twelve palettes, and the engine's one draw
// (`Engine.render`, sparks.js :1170): every face's rows in a 32×N RGBA32F texture, one instanced quad, blended
// premultiplied (ONE, ONE_MINUS_SRC_ALPHA) over a clear ground, at the view's size in points and its pixel ratio.

public enum SparkStarError: Error, Equatable {
  /// What Metal could not give: a device, the library's functions, a pipeline, a texture, a buffer.
  case unavailable(String)
}

/// The star's Metal on one device. Nothing changes after it is built, and Metal's device, pipelines and buffers may be
/// used from any thread, so one renderer serves the stills (any thread) and the stages (the main thread).
public final class SparkStarRenderer: @unchecked Sendable {
  public let device: any MTLDevice
  let queue: any MTLCommandQueue
  let pipelines: [MTLPixelFormat: any MTLRenderPipelineState]
  let palettes: any MTLBuffer
  let deeps: any MTLBuffer

  /// The system's GPU, built once; the error where Metal cannot build the star (SparkStarGate says so, once).
  public static let system = Result<SparkStarRenderer, any Error> {
    guard let device = MTLCreateSystemDefaultDevice() else { throw SparkStarError.unavailable("a Metal device") }
    return try SparkStarRenderer(device: device)
  }

  /// A still's pixels (`toDataURL`'s RGBA) and a layer's (`CAMetalLayer`'s BGRA): 8 bits a channel, no sRGB encoding,
  /// as WebGL's default framebuffer.
  public static let stillFormat = MTLPixelFormat.rgba8Unorm
  public static let layerFormat = MTLPixelFormat.bgra8Unorm

  public init(device: any MTLDevice) throws {
    self.device = device
    let library = try device.makeDefaultLibrary(bundle: .module)
    guard let vertex = library.makeFunction(name: "spark_star_vertex"),
      let fragment = library.makeFunction(name: "spark_star_fragment")
    else { throw SparkStarError.unavailable("SparkStar.metal's functions in FieldDesign's library") }
    var pipelines: [MTLPixelFormat: any MTLRenderPipelineState] = [:]
    for format in [Self.stillFormat, Self.layerFormat] {
      let descriptor = MTLRenderPipelineDescriptor()
      descriptor.vertexFunction = vertex
      descriptor.fragmentFunction = fragment
      guard let attachment = descriptor.colorAttachments[0] else {
        throw SparkStarError.unavailable("a colour attachment")
      }
      attachment.pixelFormat = format
      attachment.isBlendingEnabled = true
      attachment.sourceRGBBlendFactor = .one
      attachment.destinationRGBBlendFactor = .oneMinusSourceAlpha
      attachment.sourceAlphaBlendFactor = .one
      attachment.destinationAlphaBlendFactor = .oneMinusSourceAlpha
      pipelines[format] = try device.makeRenderPipelineState(descriptor: descriptor)
    }
    self.pipelines = pipelines
    guard let queue = device.makeCommandQueue() else { throw SparkStarError.unavailable("a command queue") }
    self.queue = queue
    // uPal (8 colours a palette) and uDeep (2), each colour a float4 (the shader's stride), as the engine's `hex` reads
    let colours = SparkEngine.palettes.flatMap { $0.c.map(Self.rgba) }
    let deeps = SparkEngine.palettes.flatMap { $0.deep.map(Self.rgba) }
    guard
      let paletteBuffer = device.makeBuffer(
        bytes: colours, length: MemoryLayout<SIMD4<Float>>.stride * colours.count, options: .storageModeShared),
      let deepBuffer = device.makeBuffer(
        bytes: deeps, length: MemoryLayout<SIMD4<Float>>.stride * deeps.count, options: .storageModeShared)
    else { throw SparkStarError.unavailable("the palettes' buffers") }
    palettes = paletteBuffer
    self.deeps = deepBuffer
  }

  /// `#rrggbb` as the engine's `hex` reads it: each channel / 255, then a float32.
  static func rgba(_ hex: String) -> SIMD4<Float> {
    let digits = Array(hex.utf8.dropFirst())
    func channel(_ at: Int) -> Float {
      let text = String(decoding: digits[at..<(at + 2)], as: UTF8.self)
      return Float(Double(Int(text, radix: 16) ?? 0) / 255)
    }
    return SIMD4(channel(0), channel(2), channel(4), 0)
  }

  /// A texture for `capacity` faces' rows: 32 RGBA32F texels a face, a face a row.
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

  /// `texSubImage2D(…, 32, faces, …)`: the first `faces` faces' rows.
  static func upload(_ rows: [Float], faces: Int, to texture: any MTLTexture) {
    rows.withUnsafeBytes { bytes in
      guard let base = bytes.baseAddress else { return }
      texture.replace(
        region: MTLRegionMake2D(0, 0, 32, faces), mipmapLevel: 0, withBytes: base,
        bytesPerRow: 32 * MemoryLayout<SIMD4<Float>>.stride)
    }
  }

  /// The engine's draw: every face in `rows`, on a view `view` points wide at `scale` pixels a point, at `time`.
  func encode(
    _ encoder: any MTLRenderCommandEncoder, format: MTLPixelFormat, rows: any MTLTexture, faces: Int, view: CGSize,
    scale: Double, time: Double
  ) {
    guard faces > 0, let pipeline = pipelines[format] else { return }
    // a = (uView, uTime, uDpr), b = (uCut, uShadow): the engine's own cut is white and it casts no shadow
    let uniforms: [SIMD4<Float>] = [
      SIMD4(Float(view.width), Float(view.height), Float(time), Float(scale)), SIMD4(1, 1, 1, 0),
    ]
    let length = MemoryLayout<SIMD4<Float>>.stride * uniforms.count
    encoder.setRenderPipelineState(pipeline)
    encoder.setVertexTexture(rows, index: 0)
    encoder.setVertexBytes(uniforms, length: length, index: 0)
    encoder.setFragmentTexture(rows, index: 0)
    encoder.setFragmentBytes(uniforms, length: length, index: 0)
    encoder.setFragmentBuffer(palettes, offset: 0, index: 1)
    encoder.setFragmentBuffer(deeps, offset: 0, index: 2)
    encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4, instanceCount: faces)
  }

  /// One face's rows drawn offscreen, as `render(0, { frozen: true })` and `toDataURL` draw a still: a picture
  /// `round(box × scale)` pixels square, premultiplied RGBA, 8 bits a channel, in sRGB.
  public func picture(rows: [Float], box: Double, scale: Double) throws -> CGImage {
    let side = max(1, Int((box * scale).rounded()))
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: Self.stillFormat, width: side, height: side, mipmapped: false)
    descriptor.usage = .renderTarget
    descriptor.storageMode = .private
    let bytesPerRow = side * 4
    // drawn into the GPU's own memory and copied out to a buffer: a read-back every host allows, the simulator's too
    guard let target = device.makeTexture(descriptor: descriptor),
      let readBack = device.makeBuffer(length: bytesPerRow * side, options: .storageModeShared)
    else { throw SparkStarError.unavailable("a still's texture") }
    let rowsTexture = try rowsTexture(capacity: 1)
    Self.upload(rows, faces: 1, to: rowsTexture)
    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = target
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    pass.colorAttachments[0].storeAction = .store
    guard let buffer = queue.makeCommandBuffer(), let encoder = buffer.makeRenderCommandEncoder(descriptor: pass)
    else { throw SparkStarError.unavailable("a command buffer") }
    encode(
      encoder, format: Self.stillFormat, rows: rowsTexture, faces: 1, view: CGSize(width: box, height: box),
      scale: scale, time: 0)
    encoder.endEncoding()
    guard let blit = buffer.makeBlitCommandEncoder() else { throw SparkStarError.unavailable("a blit encoder") }
    blit.copy(
      from: target, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
      sourceSize: MTLSize(width: side, height: side, depth: 1), to: readBack, destinationOffset: 0,
      destinationBytesPerRow: bytesPerRow, destinationBytesPerImage: bytesPerRow * side)
    blit.endEncoding()
    buffer.commit()
    buffer.waitUntilCompleted()
    if let error = buffer.error { throw error }
    let pixels = Data(bytes: readBack.contents(), count: bytesPerRow * side)
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let provider = CGDataProvider(data: pixels as CFData),
      let image = CGImage(
        width: side, height: side, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: bytesPerRow, space: space,
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider,
        decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    else { throw SparkStarError.unavailable("a still's picture") }
    return image
  }
}
