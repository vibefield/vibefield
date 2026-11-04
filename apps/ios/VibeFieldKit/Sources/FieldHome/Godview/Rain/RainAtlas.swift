import CoreGraphics
import CoreText
import Foundation
import Metal

// PG-8 — THE RAIN'S GLYPHS, rasterised once: the canvas's `bold 12px "Courier New", Courier, monospace`
// (RainView.js:149) through CoreText at the screen's scale, into one r8 coverage atlas the shader tints. The set is
// closed (read-pg8 §5): what `rainDataString` keeps — ASCII letters and digits, `%` and `.` (JavaScript's whitespace
// draws nothing) — and what `matrixGlyph` rolls, U+30A0 up to and including U+3100 (its truncation's edge,
// p4-glyph.log). Courier New has no katakana; CoreText's cascade finds a face for them, as Chromium's does. CoreText
// and CoreGraphics only, so the host builds it (the swarm's `GlyphAtlas` is UIKit's).
//
// A head's glow is a sprite of its own: the glyph's coverage blurred once per blur. FROM MEMORY, not read from source
// (fd: so marked here and in the packet): Chromium paints a canvas shadow ignoring the transform
// (`DrawLooperBuilder::kShadowIgnoresTransforms`), so the blur is in DEVICE pixels, at Skia's σ = 0.288675 × blur
// + 0.5 (`BlurRadiusToStdDev`), not the spec's blur / 2 in points. The kit's still beside the desktop's settles it;
// if they differ, `glowSigma` is the one constant to fix, the stills its evidence.

/// One glyph's place in the atlas and on the stage, in points relative to the pen at the baseline (y down).
struct RainAtlasRegion: Equatable, Sendable {
  let u0: Float
  let v0: Float
  let u1: Float
  let v1: Float
  let left: Double
  let top: Double
  let width: Double
  let height: Double
  /// The pen's advance: `textAlign = 'center'` centres it on the cell.
  let advance: Double
}

@MainActor
final class RainAtlas {
  /// What the canvas asks for, by PostScript name.
  static let fontName = "CourierNewPS-BoldMT"

  /// Every unit the rain can draw with ink.
  static let units: [UInt16] = {
    var units = Array(UInt16(0x30)...UInt16(0x39)) + Array(UInt16(0x41)...UInt16(0x5A))
    units += Array(UInt16(0x61)...UInt16(0x7A)) + [0x25, 0x2E]
    units += Array(UInt16(0x30A0)...UInt16(0x3100))
    return units
  }()

  let texture: MTLTexture
  let size: Int
  let scale: Double
  /// The face the atlas drew with: Courier New Bold, or the system's monospace when this OS lacks it.
  let resolvedFontName: String

  private let font: CTFont
  private let context: CGContext
  private let storage: Bytes
  private var bytes: UnsafeMutablePointer<UInt8> { storage.pointer }
  private var glyphs: [UInt16: RainAtlasRegion] = [:]
  private var glows: [GlowKey: RainAtlasRegion] = [:]
  private var shelfX = 1
  private var shelfY = 1
  private var shelfHeight = 0
  private var dirty = true

  private struct GlowKey: Hashable {
    let unit: UInt16
    let blur: Double
  }

  /// The bitmap's storage, freed with its holder: the atlas is main-actor isolated and a deinit is not, so the
  /// pointer lives in a box of its own (the swarm's `GlyphAtlas.Bytes`).
  private final class Bytes: @unchecked Sendable {
    let pointer: UnsafeMutablePointer<UInt8>
    init(count: Int) {
      pointer = .allocate(capacity: count)
      pointer.initialize(repeating: 0, count: count)
    }
    deinit { pointer.deallocate() }
  }

  init(device: MTLDevice, scale: Double, fontSize: Double, size: Int = 2048) throws {
    self.size = size
    self.scale = max(1, scale)
    storage = Bytes(count: size * size)
    guard
      let context = CGContext(
        data: storage.pointer, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
    else { throw RainPaintError.atlas("no 8-bit context for the rain's atlas") }
    context.translateBy(x: 0, y: CGFloat(size))
    context.scaleBy(x: 1, y: -1)
    context.setShouldAntialias(true)
    self.context = context
    let named = CTFontCreateWithName(Self.fontName as CFString, fontSize * self.scale, nil)
    if CTFontCopyPostScriptName(named) as String == Self.fontName {
      font = named
    } else {
      let fallback = CTFontCreateUIFontForLanguage(.userFixedPitch, fontSize * self.scale, nil) ?? named
      font = CTFontCreateCopyWithSymbolicTraits(fallback, 0, nil, .traitBold, .traitBold) ?? fallback
    }
    resolvedFontName = ""
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .r8Unorm, width: size, height: size, mipmapped: false)
    descriptor.usage = [.shaderRead]
    guard let texture = device.makeTexture(descriptor: descriptor) else {
      throw RainPaintError.atlas("no texture for the rain's atlas")
    }
    texture.label = "rain atlas"
    self.texture = texture
  }

  /// The unit's glyph, rasterised on first sight; nil for a unit with no ink (whitespace) or a full atlas.
  func glyph(_ unit: UInt16) -> RainAtlasRegion? { nil }

  /// A head's glow at `blur` (the canvas's `shadowBlur`): the glyph's coverage blurred, padded by three σ.
  func glow(_ unit: UInt16, blur: Double) -> RainAtlasRegion? { nil }

  /// Upload the bitmap when a glyph or a glow was added since the last frame.
  func flush() {
    guard dirty else { return }
    dirty = false
    texture.replace(
      region: MTLRegionMake2D(0, 0, size, size), mipmapLevel: 0, withBytes: bytes, bytesPerRow: size)
  }

  /// Skia's σ for a canvas `shadowBlur`, in device pixels (Blink's `BlurRadiusToStdDev`, from memory: see the head).
  static func glowSigma(blur: Double) -> Double { blur * 0.288675 + 0.5 }

  private func line(_ unit: UInt16) -> CTLine? {
    let text = String(utf16CodeUnits: [unit], count: 1)
    let attributes: [NSAttributedString.Key: Any] = [
      NSAttributedString.Key(kCTFontAttributeName as String): font,
      NSAttributedString.Key(kCTForegroundColorFromContextAttributeName as String): true,
    ]
    return CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
  }

  private func region(
    _ slot: (x: Int, y: Int), width: Int, height: Int, left: Int, top: Int, line: CTLine
  ) -> RainAtlasRegion {
    let advance = CTLineGetTypographicBounds(line, nil, nil, nil)
    return RainAtlasRegion(
      u0: Float(slot.x) / Float(size), v0: Float(slot.y) / Float(size), u1: Float(slot.x + width) / Float(size),
      v1: Float(slot.y + height) / Float(size), left: Double(left) / scale, top: Double(top) / scale,
      width: Double(width) / scale, height: Double(height) / scale, advance: advance / scale)
  }

  private func allocate(width: Int, height: Int) -> (x: Int, y: Int)? {
    if shelfX + width + 1 > size {
      shelfX = 1
      shelfY += shelfHeight + 1
      shelfHeight = 0
    }
    if shelfY + height + 1 > size { return nil }
    let slot = (x: shelfX, y: shelfY)
    shelfX += width + 1
    shelfHeight = max(shelfHeight, height)
    return slot
  }

  /// A separable Gaussian over 8-bit coverage, the kernel cut at three σ.
  static func gaussian(_ source: [UInt8], width: Int, height: Int, sigma: Double) -> [UInt8] {
    let radius = Int(ceil(sigma * 3))
    var kernel = (-radius...radius).map { exp(-Double($0 * $0) / (2 * sigma * sigma)) }
    let total = kernel.reduce(0, +)
    kernel = kernel.map { $0 / total }
    var across = [Double](repeating: 0, count: width * height)
    for row in 0..<height {
      for column in 0..<width {
        var sum = 0.0
        for (index, weight) in kernel.enumerated() {
          let x = column + index - radius
          if x >= 0 && x < width { sum += weight * Double(source[row * width + x]) }
        }
        across[row * width + column] = sum
      }
    }
    var out = [UInt8](repeating: 0, count: width * height)
    for row in 0..<height {
      for column in 0..<width {
        var sum = 0.0
        for (index, weight) in kernel.enumerated() {
          let y = row + index - radius
          if y >= 0 && y < height { sum += weight * across[y * width + column] }
        }
        out[row * width + column] = UInt8(min(255, max(0, sum.rounded())))
      }
    }
    return out
  }
}

enum RainPaintError: Error, CustomStringConvertible {
  case noDevice
  case compile(String)
  case pipeline(String)
  case atlas(String)

  var description: String {
    switch self {
    case .noDevice: "no Metal device"
    case .compile(let why): "the rain's shader did not compile — \(why)"
    case .pipeline(let why): "the rain's pipeline was refused — \(why)"
    case .atlas(let why): why
    }
  }
}
