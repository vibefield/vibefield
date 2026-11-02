// The splash's launch still (DESIGN.md §8 "The phone's splash"): the mark as the kit's vendored
// Metal runtime draws it in the splash's first frame (t = 0, its pose in motion), alone, in each
// appearance at 2× and 3×. Compiled and run by splash-stills.mjs with the kit's own
// `Splash/SplashRuntime.swift` and `Splash/SplashBake.swift`, so the still IS the live splash's
// first frame of the mark: the launch screen shows it, the splash shows it over its ground until
// the field is up, and the live field takes over on the same pixels.
//
//   splash-stills <metallib> <outDir>   writes mark-{light,dark}@{2,3}x.png (straight alpha, sRGB)

import CoreGraphics
import Foundation
import ImageIO
import Metal
import UniformTypeIdentifiers

@main
struct SplashStills {
  static func main() throws {
    let args = CommandLine.arguments
    guard args.count == 3, let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
      fatalError("usage: splash-stills <metallib> <outDir> (on a Mac with Metal)")
    }
    let library = try device.makeLibrary(URL: URL(fileURLWithPath: args[1]))
    let out = URL(fileURLWithPath: args[2])
    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    for (name, look) in [("light", SplashLook.light), ("dark", SplashLook.dark)] {
      let renderer = try SplashRenderer(device: device, library: library, look: look)
      for scale in [2, 3] {
        // any phone's screen: the mark's own texture is the logo's size at this scale alone
        try renderer.resize(width: 402, height: 874, scale: Double(scale))
        guard let g = renderer.geometry else { fatalError("no geometry") }
        let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: g.W, height: g.H, mipmapped: false)
        d.usage = [.renderTarget]
        d.storageMode = .private
        guard let target = device.makeTexture(descriptor: d), let cb = queue.makeCommandBuffer() else { fatalError("no target") }
        renderer.encode(seconds: 0, pose: look.logo.pose, into: target, commandBuffer: cb)
        guard let mark = renderer.markTexture, let blit = cb.makeBlitCommandEncoder(),
          let pixels = device.makeBuffer(length: mark.width * mark.height * 4, options: .storageModeShared)
        else { fatalError("no mark") }
        blit.copy(
          from: mark, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(),
          sourceSize: MTLSize(width: mark.width, height: mark.height, depth: 1), to: pixels, destinationOffset: 0,
          destinationBytesPerRow: mark.width * 4, destinationBytesPerImage: mark.width * mark.height * 4)
        blit.endEncoding()
        cb.commit()
        cb.waitUntilCompleted()
        if let error = cb.error { fatalError("the GPU refused the frame: \(error)") }
        // premultiplied (the mark's own texture) → straight, for a PNG
        let src = pixels.contents().bindMemory(to: UInt8.self, capacity: mark.width * mark.height * 4)
        var rgba = [UInt8](repeating: 0, count: mark.width * mark.height * 4)
        for i in 0..<(mark.width * mark.height) {
          let a = Int(src[i * 4 + 3])
          guard a > 0 else { continue }
          for c in 0..<3 { rgba[i * 4 + c] = UInt8(min(255, (Int(src[i * 4 + c]) * 255 + a / 2) / a)) }
          rgba[i * 4 + 3] = UInt8(a)
        }
        let file = out.appendingPathComponent("mark-\(name)@\(scale)x.png")
        try png(rgba, width: mark.width, height: mark.height, to: file)
        print("\(file.lastPathComponent) \(mark.width)x\(mark.height)")
      }
    }
  }

  static func png(_ rgba: [UInt8], width: Int, height: Int, to url: URL) throws {
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let provider = CGDataProvider(data: Data(rgba) as CFData),
      let image = CGImage(
        width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4, space: space,
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue), provider: provider, decode: nil,
        shouldInterpolate: false, intent: .defaultIntent),
      let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { fatalError("could not write \(url.path)") }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("could not write \(url.path)") }
  }
}
