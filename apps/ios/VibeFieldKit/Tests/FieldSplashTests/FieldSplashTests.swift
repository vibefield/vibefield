import Foundation
import Metal
import Testing

@testable import FieldSplash

// The splash's Metal runtime is runtime.js in Swift. These hold it to runtime.js's own answers,
// which the bake wrote beside the shaders (`clock.json`, vendored as `splash-clock.json` by
// apps/ios/scripts/vendor-splash.mjs): the per-frame phases, the sizes, and the uniform blocks
// both modules read, for both appearances. Then both looks are drawn on this device's GPU.

private struct Golden: Decodable {
  struct Phase: Decodable {
    let t: Double
    let pose: String
    let values: [String: Double]
  }
  struct Geometry: Decodable {
    let size: [Double]
    let k: Double
    let W, H, LW, LH, MX, MY: Int
    let px, lpx: Double
  }
  struct Fill: Decodable {
    let t: Double
    let size: [Double]
    let pose: String
    let field: [Float]
    let mark: [Float]
  }
  struct Look: Decodable {
    let phases: [Phase]
    let geometry: [Geometry]
    let fill: [Fill]
  }
  let dark: Look
  let light: Look

  static func load() throws -> Golden {
    let url = try #require(Bundle.module.url(forResource: "splash-clock", withExtension: "json", subdirectory: "Fixtures"))
    return try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
  }
}

private let looks: [(String, SplashLook)] = [("dark", .dark), ("light", .light)]

private func golden(_ name: String, _ g: Golden) -> Golden.Look { name == "dark" ? g.dark : g.light }

/// Close in the way two IEEE doubles from two libms are: the same to a part in 10¹⁰.
private func close(_ a: Double, _ b: Double) -> Bool { abs(a - b) <= 1e-10 * max(1, abs(b)) }

/// The same float32, or its neighbour (a libm's last bit before the rounding to float).
private func sameFloat(_ a: Float, _ b: Float) -> Bool { a == b || abs(a - b) <= max(abs(b), 1) * Float.ulpOfOne }

@Test func theTwoLooksAreObsidianAndItsNegative() {
  #expect(SplashLook.dark.name == "Wormhole · Obsidian")
  #expect(SplashLook.light.name == "Wormhole · Obsidian Light")
  #expect(!SplashLook.dark.light && SplashLook.light.light)
  // one look, turned over: the same clock, the same logo, the same moving uniforms
  #expect(SplashLook.dark.phases == SplashLook.light.phases)
  #expect(SplashLook.dark.logo.w == SplashLook.light.logo.w && SplashLook.dark.logo.h == SplashLook.light.logo.h)
  #expect(SplashLook.dark.field.dyn == SplashLook.light.field.dyn)
  #expect(SplashLook.dark.mark.dyn == SplashLook.light.mark.dyn)
  #expect(SplashLook.for(.dark).hash == SplashLook.dark.hash)
  #expect(SplashLook.for(.light).hash == SplashLook.light.hash)
}

@Test(arguments: ["dark", "light"])
func phasesAreRuntimeJSs(_ name: String) throws {
  let g = golden(name, try Golden.load())
  let look = looks.first { $0.0 == name }!.1
  #expect(g.phases.count >= 16)
  for sample in g.phases {
    let pose = try #require(SplashPose(rawValue: sample.pose))
    var v = SplashValues()
    SplashClock.phases(look.phases, seconds: sample.t, pose: pose, into: &v)
    for value in SplashValue.allCases where sample.values[String(describing: value)] != nil {
      let want = sample.values[String(describing: value)]!
      #expect(close(v[value], want), "\(name) \(value) at t=\(sample.t) \(sample.pose): \(v[value]), runtime.js \(want)")
    }
  }
}

@Test(arguments: ["dark", "light"])
func sizesAreRuntimeJSs(_ name: String) throws {
  let g = golden(name, try Golden.load())
  let look = looks.first { $0.0 == name }!.1
  for want in g.geometry {
    let got = SplashGeometry(width: want.size[0], height: want.size[1], scale: want.size[2], look: look)
    let pixels: [Int] = [got.W, got.H, got.LW, got.LH, got.MX, got.MY]
    let wanted: [Int] = [want.W, want.H, want.LW, want.LH, want.MX, want.MY]
    #expect(pixels == wanted, "\(want.size): \(got)")
    #expect(close(got.k, want.k) && close(got.px, want.px) && close(got.lpx, want.lpx), "\(want.size): \(got)")
  }
}

@Test(arguments: ["dark", "light"])
func uniformsAreRuntimeJSs(_ name: String) throws {
  let g = golden(name, try Golden.load())
  let look = looks.first { $0.0 == name }!.1
  #expect(!g.fill.isEmpty)
  for want in g.fill {
    var v = SplashValues()
    SplashClock.phases(look.phases, seconds: want.t, pose: try #require(SplashPose(rawValue: want.pose)), into: &v)
    SplashGeometry(width: want.size[0], height: want.size[1], scale: want.size[2], look: look).write(into: &v)
    var field = [SIMD4<Float>](repeating: .zero, count: look.field.dyn.count)
    var mark = [SIMD4<Float>](repeating: .zero, count: look.mark.dyn.count)
    SplashClock.fill(look.field.dyn, v, into: &field)
    SplashClock.fill(look.mark.dyn, v, into: &mark)
    let gotField = field.flatMap { [$0.x, $0.y, $0.z, $0.w] }
    let gotMark = mark.flatMap { [$0.x, $0.y, $0.z, $0.w] }
    #expect(gotField.count == want.field.count && gotMark.count == want.mark.count)
    for (i, (a, b)) in zip(gotField, want.field).enumerated() {
      #expect(sameFloat(a, b), "\(name) field[\(i)] at t=\(want.t) \(want.size): \(a), runtime.js \(b)")
    }
    for (i, (a, b)) in zip(gotMark, want.mark).enumerated() {
      #expect(sameFloat(a, b), "\(name) mark[\(i)] at t=\(want.t) \(want.size): \(a), runtime.js \(b)")
    }
  }
}

/// Both looks drawn as the app draws them, one frame at t = 2 s on an iPhone 17 Pro's screen: the
/// pipelines build from the app's own metallib, the dust is spawned (the web splash's fast path
/// once drew none, its bounds never written), the field is its appearance's, and the mark stands in
/// its ink at the centre. The numbers are the Metal check's on an M4 (the splash project's
/// `npm run check:splash:metal`), with room for another GPU's rounding.
@Test(arguments: ["dark", "light"])
func looksDrawOnThisGPU(_ name: String) throws {
  let look = looks.first { $0.0 == name }!.1
  let device = try #require(MTLCreateSystemDefaultDevice())
  let renderer = try SplashRenderer(device: device, library: try SplashLibrary.make(device: device), look: look)
  try renderer.resize(width: 402, height: 874, scale: 3)
  let g = try #require(renderer.geometry)
  let size: [Int] = [g.W, g.H, g.LW, g.LH, g.MX, g.MY]
  #expect(size == [1206, 2622, 384, 231, 411, 1196])

  let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: g.W, height: g.H, mipmapped: false)
  d.usage = [.renderTarget]
  d.storageMode = .private
  let target = try #require(device.makeTexture(descriptor: d))
  let pixels = try #require(device.makeBuffer(length: g.W * g.H * 4, options: .storageModeShared))
  let counter = try #require(device.makeBuffer(length: 16, options: .storageModeShared))
  let queue = try #require(device.makeCommandQueue())
  let cb = try #require(queue.makeCommandBuffer())
  renderer.encode(seconds: 2, pose: look.logo.pose, into: target, commandBuffer: cb)
  let blit = try #require(cb.makeBlitCommandEncoder())
  blit.copy(
    from: target, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(), sourceSize: MTLSize(width: g.W, height: g.H, depth: 1),
    to: pixels, destinationOffset: 0, destinationBytesPerRow: g.W * 4, destinationBytesPerImage: g.W * g.H * 4)
  let args = try #require(renderer.dustDrawArguments)
  blit.copy(from: args, sourceOffset: 0, to: counter, destinationOffset: 0, size: 16)
  blit.endEncoding()
  cb.commit()
  cb.waitUntilCompleted()
  #expect(cb.error == nil, "\(String(describing: cb.error))")

  let particles = counter.contents().load(fromByteOffset: 4, as: UInt32.self)
  #expect(particles > 40_000, "\(name): \(particles) dust particles (the M4 spawns 58,756 at this moment)")

  let px = pixels.contents().bindMemory(to: UInt8.self, capacity: g.W * g.H * 4)
  func level(_ x: Int, _ y: Int) -> Double {
    let i = (y * g.W + x) * 4
    return (Double(px[i]) + Double(px[i + 1]) + Double(px[i + 2])) / 3
  }
  var sum = 0.0
  for y in stride(from: 0, to: g.H, by: 2) {
    for x in stride(from: 0, to: g.W, by: 2) { sum += level(x, y) }
  }
  let mean = sum / Double((g.W / 2) * (g.H / 2))
  // the field: dark rays on black by night (mean 27.5 on the M4), their negative by day (227.5)
  if look.light {
    #expect(mean > 210 && mean < 245, "\(name): the frame's mean level \(mean)")
  } else {
    #expect(mean > 10 && mean < 45, "\(name): the frame's mean level \(mean)")
  }
  // the mark: its ink (white by night, black by day) at the centre, and none in the field above it
  var ink = 0
  var fieldInk = 0
  for y in g.MY..<(g.MY + g.LH) {
    for x in g.MX..<(g.MX + g.LW) {
      let mark = level(x, y)
      let field = level(x, y - 600)
      if look.light ? mark < 25 : mark > 230 { ink += 1 }
      if look.light ? field < 25 : field > 230 { fieldInk += 1 }
    }
  }
  #expect(ink > 2_500, "\(name): \(ink) pixels of the mark's ink (3,437 on the M4)")
  #expect(fieldInk < 50, "\(name): \(fieldInk) pixels of ink in the field above the mark")
}
