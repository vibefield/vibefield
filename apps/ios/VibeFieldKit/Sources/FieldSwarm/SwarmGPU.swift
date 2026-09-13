import Foundation
import Metal
import QuartzCore

public enum SwarmGPUError: Error, CustomStringConvertible {
  case noDevice
  case shaderMissing(String)
  case compile(String, String)
  case pipeline(String, String)
  case atlas(String)

  public var description: String {
    switch self {
    case .noDevice: "no Metal device"
    case .shaderMissing(let name): "the \(name) shader is not in the bundle"
    case .compile(let name, let why): "the \(name) shader did not compile — \(why)"
    case .pipeline(let name, let why): "the \(name) pipeline was refused — \(why)"
    case .atlas(let why): why
    }
  }
}

/// Everything the swarm's renderers share on one device: the five pipelines
/// (the reference's field → shadows → bodies → light → type, in painter's
/// order), the sampler, the mark atlas, and the glyph atlas at the screen's
/// scale. Built once, at first use; every `SwarmRenderer` (the field, each
/// lab cell) draws through it with its own buffers.
///
/// The shaders ride as resources and compile here (D-i14): one library per
/// pipeline with the common prelude prepended, exactly as the reference
/// compiles its WGSL. The compile's cost is measured and kept, because the
/// alternative (`.metal` in the target) is the move if it ever shows.
@MainActor
public final class SwarmGPU {
  public let device: MTLDevice
  public let queue: MTLCommandQueue
  let fieldPipeline: MTLRenderPipelineState
  let shadowPipeline: MTLRenderPipelineState
  let bodyPipeline: MTLRenderPipelineState
  let glowPipeline: MTLRenderPipelineState
  let textPipeline: MTLRenderPipelineState
  let sampler: MTLSamplerState
  let marks: MTLTexture
  public let atlas: GlyphAtlas
  /// How long the five shaders took to compile, milliseconds.
  public let compileMs: Double

  public static let pixelFormat: MTLPixelFormat = .bgra8Unorm
  private static var cached: SwarmGPU?

  /// The one context for the process, or the reason there is none.
  public static func shared(scale: CGFloat) throws -> SwarmGPU {
    if let cached {
      cached.atlas.setScale(scale)
      return cached
    }
    guard let device = MTLCreateSystemDefaultDevice() else { throw SwarmGPUError.noDevice }
    let gpu = try SwarmGPU(device: device, scale: scale)
    cached = gpu
    return gpu
  }

  public init(device: MTLDevice, scale: CGFloat) throws {
    self.device = device
    guard let queue = device.makeCommandQueue() else { throw SwarmGPUError.noDevice }
    queue.label = "swarm"
    self.queue = queue

    let started = CACurrentMediaTime()
    let common = try Self.source("common")
    func library(_ name: String) throws -> MTLLibrary {
      let options = MTLCompileOptions()
      options.mathMode = .fast
      do {
        return try device.makeLibrary(source: common + "\n" + (try Self.source(name)), options: options)
      } catch {
        throw SwarmGPUError.compile(name, "\(error)")
      }
    }
    func pipeline(_ name: String, _ library: MTLLibrary) throws -> MTLRenderPipelineState {
      let descriptor = MTLRenderPipelineDescriptor()
      descriptor.label = "swarm \(name)"
      descriptor.vertexFunction = library.makeFunction(name: "vs")
      descriptor.fragmentFunction = library.makeFunction(name: "fs")
      let attachment = descriptor.colorAttachments[0]!
      attachment.pixelFormat = Self.pixelFormat
      // Premultiplied over: the shaders emit premultiplied colour and the
      // surface composites over the SwiftUI ground.
      attachment.isBlendingEnabled = true
      attachment.rgbBlendOperation = .add
      attachment.alphaBlendOperation = .add
      attachment.sourceRGBBlendFactor = .one
      attachment.sourceAlphaBlendFactor = .one
      attachment.destinationRGBBlendFactor = .oneMinusSourceAlpha
      attachment.destinationAlphaBlendFactor = .oneMinusSourceAlpha
      do {
        return try device.makeRenderPipelineState(descriptor: descriptor)
      } catch {
        throw SwarmGPUError.pipeline(name, "\(error)")
      }
    }
    fieldPipeline = try pipeline("field", library("field"))
    shadowPipeline = try pipeline("shadow", library("shadow"))
    bodyPipeline = try pipeline("body", library("body"))
    glowPipeline = try pipeline("glow", library("glow"))
    textPipeline = try pipeline("text", library("text"))
    compileMs = (CACurrentMediaTime() - started) * 1000
    #if DEBUG
      print("[swarm] five shaders compiled in \(Int(compileMs.rounded())) ms")
    #endif

    let samplerDescriptor = MTLSamplerDescriptor()
    samplerDescriptor.minFilter = .linear
    samplerDescriptor.magFilter = .linear
    samplerDescriptor.sAddressMode = .clampToEdge
    samplerDescriptor.tAddressMode = .clampToEdge
    guard let sampler = device.makeSamplerState(descriptor: samplerDescriptor) else {
      throw SwarmGPUError.atlas("no sampler")
    }
    self.sampler = sampler
    guard let marks = MarksAtlas.makeTexture(device: device) else {
      throw SwarmGPUError.atlas("no texture for the marks")
    }
    self.marks = marks
    atlas = try GlyphAtlas(device: device, scale: scale)
  }

  private static func source(_ name: String) throws -> String {
    guard let url = Bundle.module.url(forResource: name, withExtension: "metal", subdirectory: "Shaders"),
      let text = try? String(contentsOf: url, encoding: .utf8)
    else { throw SwarmGPUError.shaderMissing(name) }
    return text
  }
}
