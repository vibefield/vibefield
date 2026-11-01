// VibeField · the splash, the Metal runtime (splash/metal, 2026-11-01).
//
// runtime.js in Swift, for the iPhone app: the same per-frame phases, the same sizes, the same
// passes, drawing the shaders bake-metal.mjs translated from the bake's WGSL (SplashShaders.metal)
// with the numbers it wrote beside them (SplashBake.swift). What a frame costs is runtime.js's:
//
//   - the strips' tables once (gasInit), the well's march once per size into a texture of
//     depths (the depth pass), and with it the dust's range (dustRangeArgs)
//   - per frame: the dust spawned on the GPU and drawn as sprites, the mark in a 4× multisampled
//     pass the mark's size (its targets memoryless where the GPU keeps them in tile memory), and
//     one pass over the screen (the field, then the mark laid over) — two small uniform blocks
//     written inline, no allocation, one command buffer
//
// It knows nothing of UIKit: the caller owns the drawable, the clock and the frame rate, so the
// app's surface and the parity check (check.swift) run this one file. Regenerate the shaders and
// the numbers, never edit them; this file is the source, its copy in the app is vendored.

import Foundation
import Metal

// ------------------------------------------------------------------ the phases (runtime.js phases())

public enum SplashPose: String, Sendable {
  case atRest = "at rest"
  case inMotion = "in motion"
  case slowLap = "slow lap"
}

/// The look's values the phases are computed from (BAKED.phases).
public struct SplashPhaseConfig: Sendable, Equatable {
  public var loopSeconds, flowSpin, palSpin, lines, accents, grainFps, halfTwists, twistSpin, twistEase: Double
  public var pulseSync, pulseSpeed, palCount, riseSync, riseRate, ringRadial, ringSync, ringFlow: Double
  public var livSpeed, livEdgeSpeed, livDrift, livBreathe, livRestTwist, livRestLights, livRoll, livLinger: Double

  public init(
    loopSeconds: Double, flowSpin: Double, palSpin: Double, lines: Double, accents: Double, grainFps: Double,
    halfTwists: Double, twistSpin: Double, twistEase: Double, pulseSync: Double, pulseSpeed: Double,
    palCount: Double, riseSync: Double, riseRate: Double, ringRadial: Double, ringSync: Double, ringFlow: Double,
    livSpeed: Double, livEdgeSpeed: Double, livDrift: Double, livBreathe: Double, livRestTwist: Double,
    livRestLights: Double, livRoll: Double, livLinger: Double
  ) {
    self.loopSeconds = loopSeconds
    self.flowSpin = flowSpin
    self.palSpin = palSpin
    self.lines = lines
    self.accents = accents
    self.grainFps = grainFps
    self.halfTwists = halfTwists
    self.twistSpin = twistSpin
    self.twistEase = twistEase
    self.pulseSync = pulseSync
    self.pulseSpeed = pulseSpeed
    self.palCount = palCount
    self.riseSync = riseSync
    self.riseRate = riseRate
    self.ringRadial = ringRadial
    self.ringSync = ringSync
    self.ringFlow = ringFlow
    self.livSpeed = livSpeed
    self.livEdgeSpeed = livEdgeSpeed
    self.livDrift = livDrift
    self.livBreathe = livBreathe
    self.livRestTwist = livRestTwist
    self.livRestLights = livRestLights
    self.livRoll = livRoll
    self.livLinger = livLinger
  }
}

/// A value a frame supplies: a phase, or a size (runtime.js's `values`, by its names).
public enum SplashValue: Int, Sendable, CaseIterable {
  case flow, palRot, pulse, rise, ring, runClock, grainSeed, livTwist, livTravel, livDrift, livBreath
  case k, W, H, LW, LH, MX, MY, px, lpx
}

/// One entry of a moving uniform slot: the look's own number, or a value the frame supplies.
public enum SplashEntry: Sendable, Equatable {
  case constant(Float)
  case value(SplashValue)
}

/// One vec4 of a module's moving uniforms (its `Dyn` struct, in order).
public struct SplashSlot: Sendable, Equatable {
  public let name: String
  public let entries: [SplashEntry]
  public init(_ name: String, _ entries: [SplashEntry]) {
    precondition(entries.count == 4, "a slot is a vec4")
    self.name = name
    self.entries = entries
  }
}

/// Every value a frame supplies, in one array indexed by `SplashValue` (no dictionary a frame).
public struct SplashValues: Sendable {
  public var storage = [Double](repeating: 0, count: SplashValue.allCases.count)
  public init() {}
  public subscript(_ v: SplashValue) -> Double {
    get { storage[v.rawValue] }
    set { storage[v.rawValue] = newValue }
  }
}

/// JavaScript's arithmetic where Swift's differs.
enum JS {
  /// Math.round: the nearest integer, a half toward +∞.
  static func round(_ x: Double) -> Double {
    guard x.isFinite else { return x }
    let r = x.rounded(.down)
    return x - r >= 0.5 ? r + 1 : r
  }
  /// The % operator on numbers (the sign of the dividend).
  static func rem(_ a: Double, _ b: Double) -> Double { a.truncatingRemainder(dividingBy: b) }
  static func sign(_ x: Double) -> Double { x > 0 ? 1 : x < 0 ? -1 : x }
  static func gcd(_ a: Double, _ b: Double) -> Double { b == 0 ? a : gcd(b, rem(a, b)) }
}

public enum SplashClock {
  static let deg = Double.pi / 180
  static let tau = 2 * Double.pi
  static func wrapTau(_ a: Double) -> Double { a - tau * (a / tau).rounded(.down) }

  /// runtime.js phases(), line for line (its operations in its order: the uniforms are its own
  /// to the last bit of a float, which the splash's tests hold against goldens it wrote).
  public static func phases(_ C: SplashPhaseConfig, seconds: Double, pose: SplashPose, into v: inout SplashValues) {
    let L = C.loopSeconds
    let t = L > 0 ? seconds - L * (seconds / L).rounded(.down) : seconds
    func quant(_ degPerSec: Double, _ period: Double) -> Double {
      L > 0 ? (JS.round((degPerSec * L) / period) * period) / L : degPerSec
    }
    func rot(_ degPerSec: Double, _ period: Double = 360) -> Double { wrapTau(quant(degPerSec, period) * t * deg) }
    func hz(_ f: Double) -> Double { L > 0 ? JS.round(f * L) / L : f }
    func osc(_ f: Double) -> Double { sin(2 * Double.pi * hz(f) * t) }
    func cyc(_ f: Double) -> Double {
      let x = hz(f) * t
      return x - x.rounded(.down)
    }
    func turns(_ degPerSec: Double, _ period: Double = 720) -> Double {
      let x = (quant(degPerSec, period) * t) / period
      return x - x.rounded(.down)
    }
    let linePeriod = 360 / JS.gcd(C.lines, C.accents > 0 ? C.accents : C.lines)
    let flow = rot(C.flowSpin, linePeriod)
    let palRot = wrapTau(rot(C.flowSpin + C.palSpin) - flow)
    var grainSeed = C.grainFps > 0 ? (t * C.grainFps).rounded(.down) : 0
    if L > 0 && C.grainFps > 0 { grainSeed = JS.rem(grainSeed, max(1, JS.round(L * C.grainFps))) }

    let k = max(C.halfTwists, 1)
    let travel = quant(C.twistSpin, 720 / k) * t * deg
    let eased = travel - C.twistEase * sin(2 * travel)
    let moving = C.twistSpin != 0
    let pulse = C.pulseSync > 0 && moving ? -((travel / Double.pi) * C.pulseSync) : cyc(C.pulseSpeed)
    let m = max(1, JS.round(C.palCount))
    let crossings = L > 0 ? JS.round((quant(C.twistSpin, 720 / k) * L) / 180) : 0
    func perCrossing(_ step: Double, _ turn: Double) -> Double {
      crossings > 0 ? (turn * max(1, JS.round((crossings * step) / turn))) / crossings : step
    }
    var rise: Double
    if C.riseSync > 0 && moving {
      rise = (eased / Double.pi) * perCrossing(C.riseSync, m)
    } else {
      var r = C.riseRate
      if L > 0 && r != 0 { r = (JS.sign(r) * max(1, JS.round((abs(r) * L) / m)) * m) / L }
      rise = r * t
    }
    rise -= m * 256 * (rise / (m * 256)).rounded(.down)
    var ring = 0.0
    if C.ringRadial > 0 {
      let turn = 1 / C.ringRadial
      var tr: Double
      if C.ringSync > 0 && moving {
        tr = (eased / Double.pi) * perCrossing(C.ringSync / m, 1)
      } else {
        var r = C.ringFlow / turn
        if L > 0 && r != 0 { r = (JS.sign(r) * max(1, JS.round(abs(r) * L))) / L }
        tr = r * t
      }
      ring = (tr - tr.rounded(.down)) * turn
    }
    let runPeriod = L > 0 ? L : 3600
    let runClock = (t - runPeriod * (t / runPeriod).rounded(.down)) / runPeriod

    let ls = C.livSpeed
    let restTwist = 1.5 * Double.pi
    var livTwist: Double
    var livTravel = turns(ls * C.livEdgeSpeed * 0.025 * 360, 360)
    var livDrift = turns(ls * C.livDrift * 0.09 * 360, 360)
    var livBreath = 1 + osc((0.72 * ls) / (2 * Double.pi)) * C.livBreathe * 0.035
    switch pose {
    case .atRest:
      livTwist = wrapTau(restTwist + C.livRestTwist * deg)
      livTravel = C.livRestLights - C.livRestLights.rounded(.down)
      livDrift = 0
      livBreath = 1
    case .slowLap:
      livTwist = wrapTau(restTwist + quant((ls * 0.175 * 180) / Double.pi, 360) * t * deg)
    case .inMotion:
      let half = (quant((ls * C.livRoll * 180) / Double.pi, 360) * t) / 180
      let kk = half.rounded(.down)
      let f = half - kk
      livTwist = wrapTau(restTwist + Double.pi * (kk + f - (C.livLinger * sin(2 * Double.pi * f)) / (2 * Double.pi)))
    }
    v[.flow] = flow
    v[.palRot] = palRot
    v[.pulse] = pulse - pulse.rounded(.down)
    v[.rise] = rise
    v[.ring] = ring
    v[.runClock] = runClock
    v[.grainSeed] = grainSeed + 1
    v[.livTwist] = livTwist
    v[.livTravel] = livTravel
    v[.livDrift] = livDrift
    v[.livBreath] = livBreath
  }

  /// A module's moving uniforms (runtime.js fill()): each slot's four entries, the look's own
  /// number or the frame's value, as float32.
  public static func fill(_ layout: [SplashSlot], _ values: SplashValues, into out: inout [SIMD4<Float>]) {
    for (i, slot) in layout.enumerated() {
      var s = SIMD4<Float>()
      for j in 0..<4 {
        switch slot.entries[j] {
        case .constant(let x): s[j] = x
        case .value(let name): s[j] = Float(values[name])
        }
      }
      out[i] = s
    }
  }
}

// ------------------------------------------------------------------ the sizes (runtime.js geometry())

/// What a surface of `points` × `scale` draws at: the scale, capped so the field's backing store
/// stays under the budget; the mark's place and size in those pixels.
public struct SplashGeometry: Sendable, Equatable {
  public let k: Double
  public let W, H, LW, LH, MX, MY: Int
  public let px, lpx: Double

  public init(width: Double, height: Double, scale: Double, look: SplashLook) {
    let k = min(scale, (look.budget / max(1, width * height)).squareRoot())
    let W = max(1, JS.round(width * k))
    let H = max(1, JS.round(height * k))
    let LW = max(1, JS.round(Double(look.logo.w) * k))
    let LH = max(1, JS.round(Double(look.logo.h) * k))
    self.k = k
    self.W = Int(W)
    self.H = Int(H)
    self.LW = Int(LW)
    self.LH = Int(LH)
    MX = Int(JS.round((W - LW) / 2))
    MY = Int(JS.round((H - LH) / 2))
    px = 2 / min(W, H) / look.fieldZoom
    lpx = 2 / min(LW, LH) / look.logo.zoom
  }

  func write(into v: inout SplashValues) {
    v[.k] = k
    v[.W] = Double(W)
    v[.H] = Double(H)
    v[.LW] = Double(LW)
    v[.LH] = Double(LH)
    v[.MX] = Double(MX)
    v[.MY] = Double(MY)
    v[.px] = px
    v[.lpx] = lpx
  }
}

// ------------------------------------------------------------------ the look (written by the bake)

/// An entry point and what it binds: each resource the runtime holds, at its Metal index.
public struct SplashFunction: Sendable {
  /// What a binding is, by the WGSL var it was (the field's and the mark's `dyn` told apart).
  public enum Resource: String, Sendable {
    case fieldDyn, markDyn
    case gasOct, gasStrip, gasCut, gasNoise
    case particles, drawArgs, dustBounds, dustRange, spawnArgs
    case depthTex, markTex, dustAcc
  }
  public struct Binding: Sendable {
    public let resource: Resource
    public let index: Int
    public init(_ resource: Resource, _ index: Int) {
      self.resource = resource
      self.index = index
    }
  }
  public let name: String
  public let bindings: [Binding]
  /// A compute entry point's threadgroup width (WGSL's workgroup_size), else 0.
  public let threads: Int
  public init(_ name: String, _ bindings: [Binding], threads: Int = 0) {
    self.name = name
    self.bindings = bindings
    self.threads = threads
  }
}

/// One look as the bake fixed it: its shaders' entry points (in SplashShaders.metal) and the
/// numbers the runtime reads (runtime.js's BAKED).
public struct SplashLook: Sendable {
  public struct Logo: Sendable {
    public let w, h: Int
    public let zoom: Double
    public let pose: SplashPose
  }
  public struct Mark: Sendable {
    public let dyn: [SplashSlot]
    public let ribbonVertices: Int
    public let edgeVertices: Int
    public let rim: Bool
    public let edges: Bool
    public let ribbon: (vertex: SplashFunction, fragment: SplashFunction)
    public let rimFunctions: (vertex: SplashFunction, fragment: SplashFunction)
    public let edge: (vertex: SplashFunction, fragment: SplashFunction)
  }
  public struct Field: Sendable {
    public let dyn: [SplashSlot]
    public let vs: SplashFunction
    public let depth: SplashFunction
    public let field: SplashFunction
    public let overVertex: SplashFunction
    public let overFragment: SplashFunction
    public let gasInit: SplashFunction
    public let dust: Dust?
  }
  public struct Dust: Sendable {
    public let cap: Int
    public let range: SplashFunction
    public let spawn: SplashFunction
    public let spriteVertex: SplashFunction
    public let spriteFragment: SplashFunction
  }
  public struct Gas: Sendable {
    public let oct, strips, cuts, noise, threads: Int
  }

  public let name: String
  public let hash: String
  /// The field turned over (Obsidian Light): light ground, black mark.
  public let light: Bool
  public let budget: Double
  public let fieldZoom: Double
  public let phases: SplashPhaseConfig
  public let logo: Logo
  public let field: Field
  public let mark: Mark
  public let gas: Gas
}

// ------------------------------------------------------------------ the renderer

/// The pipelines' compiles, run at once (each job on a thread of its own, Metal compiling them in
/// parallel) and kept as they finish; the first refusal is the answer. It is handed whole to the
/// threads that run it, so it is Sendable by its lock.
private final class PipelineJobs: @unchecked Sendable {
  private let device: MTLDevice
  private let renderJobs: [(String, MTLRenderPipelineDescriptor)]
  private let computeJobs: [(String, MTLFunction)]
  private let lock = NSLock()
  private var renders: [MTLRenderPipelineState?]
  private var computes: [MTLComputePipelineState?]
  private var failure: Error?

  init(device: MTLDevice, renders: [(String, MTLRenderPipelineDescriptor)], computes: [(String, MTLFunction)]) {
    self.device = device
    renderJobs = renders
    computeJobs = computes
    self.renders = Array(repeating: nil, count: renders.count)
    self.computes = Array(repeating: nil, count: computes.count)
  }

  func run() throws -> ([MTLRenderPipelineState], [MTLComputePipelineState]) {
    DispatchQueue.concurrentPerform(iterations: renderJobs.count + computeJobs.count) { i in job(i) }
    return try lock.withLock {
      if let failure { throw failure }
      return (renders.map { $0! }, computes.map { $0! })
    }
  }

  private func job(_ i: Int) {
    do {
      if i < renderJobs.count {
        let p = try device.makeRenderPipelineState(descriptor: renderJobs[i].1)
        lock.withLock { renders[i] = p }
      } else {
        let p = try device.makeComputePipelineState(function: computeJobs[i - renderJobs.count].1)
        lock.withLock { computes[i - renderJobs.count] = p }
      }
    } catch {
      let label = i < renderJobs.count ? renderJobs[i].0 : computeJobs[i - renderJobs.count].0
      lock.withLock { if failure == nil { failure = SplashError.pipeline(label, "\(error)") } }
    }
  }
}

public enum SplashError: Error, CustomStringConvertible {
  case missingFunction(String)
  case pipeline(String, String)
  case resource(String)

  public var description: String {
    switch self {
    case .missingFunction(let name): "the splash's shader has no \(name)"
    case .pipeline(let name, let why): "the splash's \(name) pipeline was refused: \(why)"
    case .resource(let what): "the splash could not make its \(what)"
    }
  }
}

/// The splash on one Metal device: its pipelines, its tables, its targets at one size. Not
/// thread-safe — make it, size it and encode with it on one thread (the surface's render thread).
public final class SplashRenderer {
  public let device: MTLDevice
  public let look: SplashLook
  public let pixelFormat: MTLPixelFormat
  public private(set) var geometry: SplashGeometry?

  static let markFormat: MTLPixelFormat = .rgba8Unorm
  static let msaa = 4

  private let depthPipe, fieldPipe, overPipe, ribbonPipe, rimPipe, edgePipe: MTLRenderPipelineState
  private let ribbonDepth, overlayDepth: MTLDepthStencilState
  private let gasInit: MTLComputePipelineState
  private let gas: (oct: MTLBuffer, strip: MTLBuffer, cut: MTLBuffer, noise: MTLBuffer)
  private var gasReady = false
  private struct Dust {
    let range, spawn: MTLComputePipelineState
    let sprite: MTLRenderPipelineState
    let particles, drawArgs, bounds, rangeBuf, spawnArgs, resets: MTLBuffer
  }
  private let dust: Dust?

  // what one size holds
  private var depthTex, markMsaa, markDepth, markTex, dustAcc: MTLTexture?
  private var depthsReady = false

  private var values = SplashValues()
  private var fieldData: [SIMD4<Float>]
  private var markData: [SIMD4<Float>]

  /// Builds every pipeline. Its cost is their compile, which Metal caches across launches; they
  /// compile at once, each on a thread of its own, so a cold launch waits for the slowest of them
  /// rather than for their sum.
  public init(device: MTLDevice, library: MTLLibrary, look: SplashLook, pixelFormat: MTLPixelFormat = .bgra8Unorm) throws {
    self.device = device
    self.look = look
    self.pixelFormat = pixelFormat
    fieldData = Array(repeating: .zero, count: max(1, look.field.dyn.count))
    markData = Array(repeating: .zero, count: max(1, look.mark.dyn.count))

    func function(_ f: SplashFunction) throws -> MTLFunction {
      guard let fn = library.makeFunction(name: f.name) else { throw SplashError.missingFunction(f.name) }
      return fn
    }
    func render(
      _ label: String, _ vertex: SplashFunction, _ fragment: SplashFunction, format: MTLPixelFormat,
      blend: Blend = .none, samples: Int = 1, depth: Bool = false
    ) throws -> MTLRenderPipelineDescriptor {
      let d = MTLRenderPipelineDescriptor()
      d.label = "splash-\(label)"
      d.vertexFunction = try function(vertex)
      d.fragmentFunction = try function(fragment)
      d.rasterSampleCount = samples
      let c = d.colorAttachments[0]!
      c.pixelFormat = format
      switch blend {
      case .none: c.isBlendingEnabled = false
      case .premultiplied, .add:
        c.isBlendingEnabled = true
        c.rgbBlendOperation = .add
        c.alphaBlendOperation = .add
        c.sourceRGBBlendFactor = .one
        c.sourceAlphaBlendFactor = .one
        let dst: MTLBlendFactor = blend == .add ? .one : .oneMinusSourceAlpha
        c.destinationRGBBlendFactor = dst
        c.destinationAlphaBlendFactor = dst
      }
      if depth { d.depthAttachmentPixelFormat = .depth32Float }
      return d
    }
    func depthState(write: Bool, compare: MTLCompareFunction) throws -> MTLDepthStencilState {
      let d = MTLDepthStencilDescriptor()
      d.isDepthWriteEnabled = write
      d.depthCompareFunction = compare
      guard let s = device.makeDepthStencilState(descriptor: d) else { throw SplashError.resource("depth state") }
      return s
    }
    func buffer(_ label: String, _ length: Int, shared: Bool = false) throws -> MTLBuffer {
      guard let b = device.makeBuffer(length: max(16, length), options: shared ? .storageModeShared : .storageModePrivate) else {
        throw SplashError.resource(label)
      }
      b.label = "splash-\(label)"
      return b
    }

    let F = look.field
    let M = look.mark
    var renders: [(String, MTLRenderPipelineDescriptor)] = [
      ("depth", try render("depth", F.vs, F.depth, format: .r32Float)),
      ("field", try render("field", F.vs, F.field, format: pixelFormat)),
      ("over", try render("over", F.overVertex, F.overFragment, format: pixelFormat, blend: .premultiplied)),
      ("ribbon", try render("ribbon", M.ribbon.vertex, M.ribbon.fragment, format: Self.markFormat, blend: .premultiplied, samples: Self.msaa, depth: true)),
      ("rim", try render("rim", M.rimFunctions.vertex, M.rimFunctions.fragment, format: Self.markFormat, blend: .premultiplied, samples: Self.msaa, depth: true)),
      ("edge", try render("edge", M.edge.vertex, M.edge.fragment, format: Self.markFormat, blend: .premultiplied, samples: Self.msaa, depth: true)),
    ]
    var computes: [(String, MTLFunction)] = [("gas-init", try function(F.gasInit))]
    if let D = F.dust {
      renders.append(("dust-sprite", try render("dust-sprite", D.spriteVertex, D.spriteFragment, format: .rgba16Float, blend: .add)))
      computes += [("dust-range", try function(D.range)), ("dust-spawn", try function(D.spawn))]
    }
    let (r, c) = try PipelineJobs(device: device, renders: renders, computes: computes).run()
    depthPipe = r[0]
    fieldPipe = r[1]
    overPipe = r[2]
    ribbonPipe = r[3]
    rimPipe = r[4]
    edgePipe = r[5]
    gasInit = c[0]
    ribbonDepth = try depthState(write: true, compare: .less)
    overlayDepth = try depthState(write: false, compare: .lessEqual)
    let G = look.gas
    gas = (
      try buffer("gas-octaves", G.oct * 4), try buffer("gas-strips", G.strips * 32),
      try buffer("gas-cuts", G.cuts * 16), try buffer("gas-noise", G.noise * 4)
    )
    if let D = F.dust {
      // the resets the frame copies in before the GPU writes: the sprites' draw (4 vertices, no
      // instances yet) and the range's bounds (the least key above the most)
      let resets = try buffer("dust-resets", 32, shared: true)
      let words = resets.contents().bindMemory(to: UInt32.self, capacity: 8)
      for (i, x) in [4, 0, 0, 0, 0xFFFF_FFFF, 0, 0, 0].enumerated() { words[i] = UInt32(x) }
      dust = Dust(
        range: c[1],
        spawn: c[2],
        sprite: r[6],
        particles: try buffer("dust-particles", D.cap * 48),
        drawArgs: try buffer("dust-draw", 16),
        bounds: try buffer("dust-bounds", 8),
        rangeBuf: try buffer("dust-range", 16),
        spawnArgs: try buffer("dust-spawn-args", 12),
        resets: resets
      )
    } else {
      dust = nil
    }
  }

  private enum Blend { case none, premultiplied, add }

  /// The dust's draw arguments as the last frame left them (its particles are the second word):
  /// for measuring, never read in a frame.
  public var dustDrawArguments: MTLBuffer? { dust?.drawArgs }

  /// The mark as the last frame drew it, alone: LW × LH, premultiplied RGBA. The app's launch
  /// screen shows it before the field can draw (its still, from this runtime's own first frame).
  public var markTexture: MTLTexture? { markTex }

  /// Sizes the splash for a surface `width` × `height` points at `scale` pixels a point. Returns
  /// whether its pixels changed (the drawable's size is then `geometry`'s W × H).
  @discardableResult
  public func resize(width: Double, height: Double, scale: Double) throws -> Bool {
    let g = SplashGeometry(width: width, height: height, scale: scale, look: look)
    if let geometry, geometry == g { return false }
    func texture(_ label: String, _ format: MTLPixelFormat, _ w: Int, _ h: Int, samples: Int = 1, read: Bool = true) throws -> MTLTexture {
      let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: format, width: w, height: h, mipmapped: false)
      d.usage = read ? [.renderTarget, .shaderRead] : [.renderTarget]
      if samples > 1 {
        d.textureType = .type2DMultisample
        d.sampleCount = samples
      }
      // never read back nor kept past its pass: tile memory where the GPU has it (and the GPU's
      // own memory where it refuses one, as a simulator may)
      d.storageMode = !read && device.supportsFamily(.apple2) ? .memoryless : .private
      var made = device.makeTexture(descriptor: d)
      if made == nil, d.storageMode == .memoryless {
        d.storageMode = .private
        made = device.makeTexture(descriptor: d)
      }
      guard let t = made else { throw SplashError.resource(label) }
      t.label = "splash-\(label)"
      return t
    }
    depthTex = try texture("depths", .r32Float, g.W, g.H)
    markMsaa = try texture("mark-msaa", Self.markFormat, g.LW, g.LH, samples: Self.msaa, read: false)
    markDepth = try texture("mark-depth", .depth32Float, g.LW, g.LH, samples: Self.msaa, read: false)
    markTex = try texture("mark", Self.markFormat, g.LW, g.LH)
    dustAcc = dust == nil ? nil : try texture("dust-light", .rgba16Float, g.W, g.H)
    geometry = g
    depthsReady = false
    return true
  }

  /// Encodes one frame at `seconds` into `target` (W × H, `pixelFormat`): runtime.js encode().
  public func encode(seconds: Double, pose: SplashPose, into target: MTLTexture, commandBuffer cb: MTLCommandBuffer) {
    guard let g = geometry, let depthTex, let markMsaa, let markDepth, let markTex else { return }
    SplashClock.phases(look.phases, seconds: seconds, pose: pose, into: &values)
    g.write(into: &values)
    SplashClock.fill(look.field.dyn, values, into: &fieldData)
    SplashClock.fill(look.mark.dyn, values, into: &markData)
    let F = look.field

    if !gasReady, let c = cb.makeComputeCommandEncoder() {
      c.label = "splash-gas-init"
      c.setComputePipelineState(gasInit)
      bind(F.gasInit, compute: c)
      let groups = (look.gas.threads + 63) / 64
      c.dispatchThreadgroups(MTLSize(width: groups, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: F.gasInit.threads, height: 1, depth: 1))
      c.endEncoding()
      gasReady = true
    }
    if !depthsReady {
      if let dust, let b = cb.makeBlitCommandEncoder() {
        b.copy(from: dust.resets, sourceOffset: 16, to: dust.bounds, destinationOffset: 0, size: 8)
        b.endEncoding()
      }
      let pass = MTLRenderPassDescriptor()
      pass.colorAttachments[0].texture = depthTex
      pass.colorAttachments[0].loadAction = .clear
      pass.colorAttachments[0].storeAction = .store
      pass.colorAttachments[0].clearColor = MTLClearColor(red: -1, green: 0, blue: 0, alpha: 1)
      if let r = cb.makeRenderCommandEncoder(descriptor: pass) {
        r.label = "splash-depths"
        r.setRenderPipelineState(depthPipe)
        bind(F.vs, vertex: r)
        bind(F.depth, fragment: r)
        r.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        r.endEncoding()
      }
      if let dust, let D = F.dust, let c = cb.makeComputeCommandEncoder() {
        c.label = "splash-dust-range"
        c.setComputePipelineState(dust.range)
        bind(D.range, compute: c)
        c.dispatchThreadgroups(MTLSize(width: 1, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: max(1, D.range.threads), height: 1, depth: 1))
        c.endEncoding()
      }
      depthsReady = true
    }
    if let dust, let D = F.dust, let dustAcc {
      if let b = cb.makeBlitCommandEncoder() {
        b.copy(from: dust.resets, sourceOffset: 0, to: dust.drawArgs, destinationOffset: 0, size: 16)
        b.endEncoding()
      }
      if let c = cb.makeComputeCommandEncoder() {
        c.label = "splash-dust-spawn"
        c.setComputePipelineState(dust.spawn)
        bind(D.spawn, compute: c)
        c.dispatchThreadgroups(indirectBuffer: dust.spawnArgs, indirectBufferOffset: 0, threadsPerThreadgroup: MTLSize(width: D.spawn.threads, height: 1, depth: 1))
        c.endEncoding()
      }
      let pass = MTLRenderPassDescriptor()
      pass.colorAttachments[0].texture = dustAcc
      pass.colorAttachments[0].loadAction = .clear
      pass.colorAttachments[0].storeAction = .store
      pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
      if let r = cb.makeRenderCommandEncoder(descriptor: pass) {
        r.label = "splash-dust-sprites"
        r.setRenderPipelineState(dust.sprite)
        bind(D.spriteVertex, vertex: r)
        bind(D.spriteFragment, fragment: r)
        r.drawPrimitives(type: .triangleStrip, indirectBuffer: dust.drawArgs, indirectBufferOffset: 0)
        r.endEncoding()
      }
    }

    // the mark, 4× multisampled, resolved into its own texture
    let markPass = MTLRenderPassDescriptor()
    markPass.colorAttachments[0].texture = markMsaa
    markPass.colorAttachments[0].resolveTexture = markTex
    markPass.colorAttachments[0].loadAction = .clear
    markPass.colorAttachments[0].storeAction = .multisampleResolve
    markPass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    markPass.depthAttachment.texture = markDepth
    markPass.depthAttachment.loadAction = .clear
    markPass.depthAttachment.storeAction = .dontCare
    markPass.depthAttachment.clearDepth = 1
    if let r = cb.makeRenderCommandEncoder(descriptor: markPass) {
      r.label = "splash-mark"
      let M = look.mark
      r.setRenderPipelineState(ribbonPipe)
      r.setDepthStencilState(ribbonDepth)
      bind(M.ribbon.vertex, vertex: r)
      bind(M.ribbon.fragment, fragment: r)
      r.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: M.ribbonVertices)
      r.setDepthStencilState(overlayDepth)
      if M.rim {
        r.setRenderPipelineState(rimPipe)
        bind(M.rimFunctions.vertex, vertex: r)
        bind(M.rimFunctions.fragment, fragment: r)
        r.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: M.edgeVertices, instanceCount: 2)
      }
      if M.edges {
        r.setRenderPipelineState(edgePipe)
        bind(M.edge.vertex, vertex: r)
        bind(M.edge.fragment, fragment: r)
        r.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: M.edgeVertices, instanceCount: 2)
      }
      r.endEncoding()
    }

    // the screen: the field, then the mark laid over at its place
    let main = MTLRenderPassDescriptor()
    main.colorAttachments[0].texture = target
    main.colorAttachments[0].loadAction = .clear
    main.colorAttachments[0].storeAction = .store
    main.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
    if let r = cb.makeRenderCommandEncoder(descriptor: main) {
      r.label = "splash-main"
      r.setRenderPipelineState(fieldPipe)
      bind(F.vs, vertex: r)
      bind(F.field, fragment: r)
      r.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
      r.setRenderPipelineState(overPipe)
      bind(F.overVertex, vertex: r)
      bind(F.overFragment, fragment: r)
      r.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
      r.endEncoding()
    }
  }

  // ---- each entry point's resources, bound by the bake's own list for it (what the shader
  // reaches, at the index it was given), so nothing is bound by a guess

  private enum Bound {
    case bytes(UnsafeRawPointer, Int)
    case buffer(MTLBuffer)
    case texture(MTLTexture)
    case none
  }

  /// One binding's resource now. The two uniform blocks are passed inline (setBytes copies them
  /// into the command buffer), so a frame allocates nothing and races nothing it wrote before.
  private func bound(_ r: SplashFunction.Resource, _ body: (Bound) -> Void) {
    switch r {
    case .fieldDyn: fieldData.withUnsafeBytes { body(.bytes($0.baseAddress!, $0.count)) }
    case .markDyn: markData.withUnsafeBytes { body(.bytes($0.baseAddress!, $0.count)) }
    case .gasOct: body(.buffer(gas.oct))
    case .gasStrip: body(.buffer(gas.strip))
    case .gasCut: body(.buffer(gas.cut))
    case .gasNoise: body(.buffer(gas.noise))
    case .particles: body(dust.map { .buffer($0.particles) } ?? .none)
    case .drawArgs: body(dust.map { .buffer($0.drawArgs) } ?? .none)
    case .dustBounds: body(dust.map { .buffer($0.bounds) } ?? .none)
    case .dustRange: body(dust.map { .buffer($0.rangeBuf) } ?? .none)
    case .spawnArgs: body(dust.map { .buffer($0.spawnArgs) } ?? .none)
    case .depthTex: body(depthTex.map { .texture($0) } ?? .none)
    case .markTex: body(markTex.map { .texture($0) } ?? .none)
    case .dustAcc: body(dustAcc.map { .texture($0) } ?? .none)
    }
  }

  private func bind(_ entry: SplashFunction, vertex r: MTLRenderCommandEncoder) {
    for b in entry.bindings {
      bound(b.resource) {
        switch $0 {
        case .bytes(let p, let n): r.setVertexBytes(p, length: n, index: b.index)
        case .buffer(let buf): r.setVertexBuffer(buf, offset: 0, index: b.index)
        case .texture(let t): r.setVertexTexture(t, index: b.index)
        case .none: break
        }
      }
    }
  }

  private func bind(_ entry: SplashFunction, fragment r: MTLRenderCommandEncoder) {
    for b in entry.bindings {
      bound(b.resource) {
        switch $0 {
        case .bytes(let p, let n): r.setFragmentBytes(p, length: n, index: b.index)
        case .buffer(let buf): r.setFragmentBuffer(buf, offset: 0, index: b.index)
        case .texture(let t): r.setFragmentTexture(t, index: b.index)
        case .none: break
        }
      }
    }
  }

  private func bind(_ entry: SplashFunction, compute c: MTLComputeCommandEncoder) {
    for b in entry.bindings {
      bound(b.resource) {
        switch $0 {
        case .bytes(let p, let n): c.setBytes(p, length: n, index: b.index)
        case .buffer(let buf): c.setBuffer(buf, offset: 0, index: b.index)
        case .texture(let t): c.setTexture(t, index: b.index)
        case .none: break
        }
      }
    }
  }
}
