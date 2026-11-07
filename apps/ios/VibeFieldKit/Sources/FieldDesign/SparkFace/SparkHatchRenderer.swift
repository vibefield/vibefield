import CoreGraphics
import Foundation

// IOS-12f's f5e (red) — THE HATCH'S METAL, A SKELETON: the API SparkHatchFramesTests is written against. It draws no
// sky yet: every frame is opaque black at the frame's size. f5f transcribes the star engine's programs into
// `SparkHatch.metal` (the night ground, the trail, the body's burst, the particles, the bloom and the composite) and
// draws them here, as `SparkEngine.render(t)` draws a frame (star-spark.js :633).

/// The hatch's Metal on one device.
public final class SparkHatchRenderer: @unchecked Sendable {
  /// The system's GPU, built once.
  public static let system = Result<SparkHatchRenderer, any Error> { SparkHatchRenderer() }

  init() {}

  /// One frame of the sky drawn offscreen, as `render(t)` and `toDataURL` draw one: `stars` stars' rows (128 floats
  /// each, in slot order), on a sky `size` points in size at `scale` pixels a point, at `time`, with `grain`.
  public func frame(
    rows: [Float], stars: Int, size: CGSize, scale: Double, time: Double, grain: Double
  ) throws -> CGImage {
    let width = max(1, Int((Double(size.width) * scale).rounded()))
    let height = max(1, Int((Double(size.height) * scale).rounded()))
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    for pixel in 0..<(width * height) { pixels[pixel * 4 + 3] = 255 }
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let provider = CGDataProvider(data: Data(pixels) as CFData),
      let image = CGImage(
        width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4, space: space,
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider,
        decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    else { throw SparkStarError.unavailable("a frame's picture") }
    return image
  }
}
