import CoreGraphics
import CoreText
import FieldAgents
import Metal
import UIKit

// The swarm's type, rasterised once per glyph and drawn as instanced quads —
// the reference's `gpu/glyph-atlas.ts`, with CoreText where it had Canvas2D.
//
// Glyphs come from the OS rasteriser at the screen scale, in the monospace
// face the reference asks for (`ui-monospace`: SF Mono on this platform), so
// the swarm's 7–14pt labels are the system's own pixels — the reference the
// design was approved against. A distance-field atlas was considered and
// rejected there for the same reason it is rejected here: at 7px hinting beats
// reconstruction. Pictures (the folder, the dot, the bar) rasterise into the
// same atlas from CoreGraphics paths, so text and marks share one draw.

/// One region of the atlas, in texture coordinates and points.
public struct AtlasRegion: Equatable, Sendable {
  public var u0: Double
  public var v0: Double
  public var u1: Double
  public var v1: Double
  /// Bitmap size in points.
  public var width: Double
  public var height: Double
  /// Bitmap origin relative to the pen (glyph) or the box (sprite), points.
  public var left: Double
  public var top: Double
  /// Pen advance in points, before letter spacing.
  public var advance: Double
}

public struct FontMetrics: Equatable, Sendable {
  public var ascent: Double
  public var descent: Double
}

@MainActor
public final class GlyphAtlas {
  public let texture: MTLTexture
  public let size: Int
  public private(set) var scale: CGFloat

  /// The bitmap's storage, freed with its holder: the atlas is main-actor
  /// isolated and a deinit is not, so the pointer lives in a box of its own.
  private final class Bytes: @unchecked Sendable {
    let pointer: UnsafeMutablePointer<UInt8>
    init(count: Int) {
      pointer = .allocate(capacity: count)
      pointer.initialize(repeating: 0, count: count)
    }
    deinit { pointer.deallocate() }
  }

  private let context: CGContext
  private let storage: Bytes
  private var bytes: UnsafeMutablePointer<UInt8> { storage.pointer }
  private var regions: [String: AtlasRegion] = [:]
  private var metrics: [String: FontMetrics] = [:]
  private var fonts: [String: CTFont] = [:]
  private var shelfX = padding
  private var shelfY = padding
  private var shelfHeight = 0
  private var dirty = false
  /// Bumped whenever the atlas is emptied, so cached quads know to relayout.
  public private(set) var epoch = 0

  private static let padding = 1

  public init(device: MTLDevice, scale: CGFloat, size: Int = 2048) throws {
    self.size = size
    self.scale = max(1, scale)
    storage = Bytes(count: size * size)
    guard
      let context = CGContext(
        data: storage.pointer, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
    else { throw SwarmGPUError.atlas("no 8-bit context for the glyph atlas") }
    // Row 0 at the top: the texture's space, and the shelf packer's.
    context.translateBy(x: 0, y: CGFloat(size))
    context.scaleBy(x: 1, y: -1)
    context.setAllowsAntialiasing(true)
    context.setShouldAntialias(true)
    context.setShouldSmoothFonts(true)
    self.context = context
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .r8Unorm, width: size, height: size, mipmapped: false)
    descriptor.usage = [.shaderRead]
    descriptor.storageMode = .shared
    guard let texture = device.makeTexture(descriptor: descriptor) else {
      throw SwarmGPUError.atlas("no texture for the glyph atlas")
    }
    texture.label = "swarm glyph atlas"
    self.texture = texture
  }

  public func setScale(_ next: CGFloat) {
    let clamped = max(1, next)
    if clamped == scale { return }
    scale = clamped
    reset()
  }

  private func reset() {
    bytes.initialize(repeating: 0, count: size * size)
    regions.removeAll()
    metrics.removeAll()
    fonts.removeAll()
    shelfX = Self.padding
    shelfY = Self.padding
    shelfHeight = 0
    epoch += 1
    dirty = true
  }

  private func allocate(width: Int, height: Int) -> (x: Int, y: Int)? {
    if shelfX + width + Self.padding > size {
      shelfX = Self.padding
      shelfY += shelfHeight + Self.padding
      shelfHeight = 0
    }
    if shelfY + height + Self.padding > size { return nil }
    let slot = (x: shelfX, y: shelfY)
    shelfX += width + Self.padding
    shelfHeight = max(shelfHeight, height)
    return slot
  }

  // MARK: - Fonts

  private static func styleKey(_ style: TextStyle) -> String {
    "\(style.weight)|\(style.italic ? "i" : "n")|\(style.size)"
  }

  private static func weight(_ weight: Int) -> UIFont.Weight {
    switch weight {
    case ..<550: .medium
    case 550..<700: .semibold
    default: .heavy
    }
  }

  private func font(for style: TextStyle) -> CTFont {
    let key = Self.styleKey(style)
    if let known = fonts[key] { return known }
    // `ui-monospace` is the system's monospaced face; the weights are the
    // design's 500/600/800 as the closest system steps.
    var font = UIFont.monospacedSystemFont(ofSize: style.size * scale, weight: Self.weight(style.weight))
    if style.italic, let descriptor = font.fontDescriptor.withSymbolicTraits(.traitItalic) {
      font = UIFont(descriptor: descriptor, size: style.size * scale)
    }
    let ctFont = font as CTFont
    fonts[key] = ctFont
    return ctFont
  }

  private func line(_ text: String, _ font: CTFont) -> CTLine {
    let attributed = NSAttributedString(
      string: text, attributes: [.font: font, .foregroundColor: UIColor.white])
    return CTLineCreateWithAttributedString(attributed)
  }

  public func fontMetrics(_ style: TextStyle) -> FontMetrics {
    let key = Self.styleKey(style)
    if let known = metrics[key] { return known }
    let font = font(for: style)
    let measured = FontMetrics(
      ascent: CTFontGetAscent(font) / scale, descent: CTFontGetDescent(font) / scale)
    metrics[key] = measured
    return measured
  }

  /// The glyph, rasterised on first sight. nil only when the atlas is full.
  public func glyph(_ character: Character, _ style: TextStyle) -> AtlasRegion? {
    let key = "g|\(Self.styleKey(style))|\(character)"
    if let known = regions[key] { return known }
    let font = font(for: style)
    let line = line(String(character), font)
    let advance = CTLineGetTypographicBounds(line, nil, nil, nil)
    // The ink's box relative to the pen, y up: the reference's actualBoundingBox*.
    let ink = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
    let left = ink.isNull ? 0 : Int(ceil(-ink.minX))
    let right = ink.isNull ? 0 : Int(ceil(ink.maxX))
    let ascent = ink.isNull ? 0 : Int(ceil(ink.maxY))
    let descent = ink.isNull ? 0 : Int(ceil(-ink.minY))
    let width = max(1, left + right + 2)
    let height = max(1, ascent + descent + 2)
    guard let slot = allocate(width: width, height: height) else { return nil }
    if !ink.isNull {
      context.saveGState()
      // CoreText draws y-up; the atlas is y-down. Flip the text matrix and
      // place the baseline where the y-down pen wants it.
      context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
      context.textPosition = CGPoint(x: CGFloat(slot.x + left + 1), y: CGFloat(slot.y + ascent + 1))
      context.setFillColor(gray: 1, alpha: 1)
      CTLineDraw(line, context)
      context.restoreGState()
    }
    let region = AtlasRegion(
      u0: Double(slot.x) / Double(size),
      v0: Double(slot.y) / Double(size),
      u1: Double(slot.x + width) / Double(size),
      v1: Double(slot.y + height) / Double(size),
      width: Double(width) / scale,
      height: Double(height) / scale,
      left: Double(-left - 1) / scale,
      top: Double(-ascent - 1) / scale,
      advance: advance / scale)
    regions[key] = region
    dirty = true
    return region
  }

  /// CSS `letter-spacing` semantics: spacing follows every character.
  public func measure(_ text: String, _ style: TextStyle) -> Double {
    var width = 0.0
    let spacing = style.letterSpacing * style.size
    for character in text {
      width += (glyph(character, style)?.advance ?? 0) + spacing
    }
    return width
  }

  // MARK: - Sprites

  /// A picture at a size in points, drawn by `draw` into a y-down context
  /// whose unit is the picture's own 24-box (the reference's SVG box), in
  /// white so the shader tints it.
  public func sprite(_ key: String, size: Double, box: CGFloat = 24, draw: (CGContext) -> Void) -> AtlasRegion? {
    let regionKey = "s|\(key)|\(size)"
    if let known = regions[regionKey] { return known }
    let devicePx = max(1, Int((size * scale).rounded()))
    guard let slot = allocate(width: devicePx, height: devicePx) else { return nil }
    context.saveGState()
    context.translateBy(x: CGFloat(slot.x), y: CGFloat(slot.y))
    context.scaleBy(x: CGFloat(devicePx) / box, y: CGFloat(devicePx) / box)
    context.setFillColor(gray: 1, alpha: 1)
    context.setStrokeColor(gray: 1, alpha: 1)
    draw(context)
    context.restoreGState()
    // `size` here is the sprite's; the atlas's own is `self.size` — shadowed,
    // and a UV against the wrong one put every mark off the texture.
    let atlasSize = Double(self.size)
    let region = AtlasRegion(
      u0: Double(slot.x) / atlasSize,
      v0: Double(slot.y) / atlasSize,
      u1: Double(slot.x + devicePx) / atlasSize,
      v1: Double(slot.y + devicePx) / atlasSize,
      width: Double(devicePx) / scale,
      height: Double(devicePx) / scale,
      left: 0,
      top: 0,
      advance: Double(devicePx) / scale)
    regions[regionKey] = region
    dirty = true
    return region
  }

  /// Upload what changed since the last frame. One copy of the whole bitmap:
  /// additions are rare after the first seconds, and a partial copy is not
  /// cheaper than a whole one on this path.
  public func flush() {
    guard dirty else { return }
    dirty = false
    texture.replace(
      region: MTLRegionMake2D(0, 0, size, size), mipmapLevel: 0, withBytes: bytes, bytesPerRow: size)
  }
}

/// The pictures the copy leads with, drawn in the reference's 24-box: the
/// folder mark (a stroked path from the proposals record), the unread dot,
/// and the project's tag bar. Paths rather than SVG text: the same picture
/// with no parser.
public enum SwarmSprites {
  public static func dot(_ context: CGContext) {
    context.fillEllipse(in: CGRect(x: 0, y: 0, width: 24, height: 24))
  }

  /// A rounded bar a quarter as wide as it is tall, standing in a square sprite.
  public static func bar(_ context: CGContext) {
    let path = CGPath(
      roundedRect: CGRect(x: 9, y: 0, width: 6, height: 24), cornerWidth: 3, cornerHeight: 3,
      transform: nil)
    context.addPath(path)
    context.fillPath()
  }

  /// `M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z`,
  /// stroked 2 wide with round joins and caps.
  public static func folder(_ context: CGContext) {
    let path = CGMutablePath()
    path.move(to: CGPoint(x: 3, y: 7))
    path.addArc(tangent1End: CGPoint(x: 3, y: 5), tangent2End: CGPoint(x: 5, y: 5), radius: 2)
    path.addLine(to: CGPoint(x: 9, y: 5))
    path.addLine(to: CGPoint(x: 11, y: 7))
    path.addLine(to: CGPoint(x: 19, y: 7))
    path.addArc(tangent1End: CGPoint(x: 21, y: 7), tangent2End: CGPoint(x: 21, y: 9), radius: 2)
    path.addLine(to: CGPoint(x: 21, y: 18))
    path.addArc(tangent1End: CGPoint(x: 21, y: 20), tangent2End: CGPoint(x: 19, y: 20), radius: 2)
    path.addLine(to: CGPoint(x: 5, y: 20))
    path.addArc(tangent1End: CGPoint(x: 3, y: 20), tangent2End: CGPoint(x: 3, y: 18), radius: 2)
    path.closeSubpath()
    context.setLineWidth(2)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    context.addPath(path)
    context.strokePath()
  }
}
