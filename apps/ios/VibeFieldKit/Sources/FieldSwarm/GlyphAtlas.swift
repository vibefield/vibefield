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
// reconstruction. Pictures (the folder, the state marks, the dot, the flames)
// rasterise into the same atlas from CoreGraphics paths, so text and marks
// share one draw.

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
/// folder mark outlined and solid, the state marks (permission · question ·
/// failure · message), the dot, and the two flames of the burn ladder. Paths
/// rather than SVG text: the same picture with no parser. Strokes are 2 wide
/// with round caps and joins, as the reference's `stroke-width="2"`.
public enum SwarmSprites {
  /// The picture for a lead's name, or nil for a name this build has no path for.
  public static func icon(_ name: String) -> ((CGContext) -> Void)? {
    switch name {
    case "folder": folder
    case "folder-solid": folderSolid
    case "message": message
    case "permission": permission
    case "question": question
    case "failure": failure
    default: nil
    }
  }

  private static func stroked(_ context: CGContext, width: CGFloat = 2) {
    context.setLineWidth(width)
    context.setLineCap(.round)
    context.setLineJoin(.round)
  }

  public static func dot(_ context: CGContext) {
    context.fillEllipse(in: CGRect(x: 0, y: 0, width: 24, height: 24))
  }

  /// `M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z`.
  private static func folderPath() -> CGPath {
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
    return path
  }

  /// The folder, stroked 2 wide with round joins and caps.
  public static func folder(_ context: CGContext) {
    stroked(context)
    context.addPath(folderPath())
    context.strokePath()
  }

  /// The same silhouette filled: the project's mark once its name has stepped back.
  public static func folderSolid(_ context: CGContext) {
    context.addPath(folderPath())
    context.fillPath()
  }

  /// `M20 14a2 2 0 0 1-2 2H9l-4.5 3.5V6a2 2 0 0 1 2-2h11.5a2 2 0 0 1 2 2z`: the chat mark.
  public static func message(_ context: CGContext) {
    let path = CGMutablePath()
    path.move(to: CGPoint(x: 20, y: 14))
    path.addArc(tangent1End: CGPoint(x: 20, y: 16), tangent2End: CGPoint(x: 18, y: 16), radius: 2)
    path.addLine(to: CGPoint(x: 9, y: 16))
    path.addLine(to: CGPoint(x: 4.5, y: 19.5))
    path.addLine(to: CGPoint(x: 4.5, y: 6))
    path.addArc(tangent1End: CGPoint(x: 4.5, y: 4), tangent2End: CGPoint(x: 6.5, y: 4), radius: 2)
    path.addLine(to: CGPoint(x: 18, y: 4))
    path.addArc(tangent1End: CGPoint(x: 20, y: 4), tangent2End: CGPoint(x: 20, y: 6), radius: 2)
    path.closeSubpath()
    stroked(context)
    context.addPath(path)
    context.strokePath()
  }

  /// `<circle cx="8" cy="8" r="3.5"/><path d="M10.5 10.5L19 19M15.5 15.5l2-2M13 13l2-2"/>`: the key.
  public static func permission(_ context: CGContext) {
    stroked(context)
    context.strokeEllipse(in: CGRect(x: 4.5, y: 4.5, width: 7, height: 7))
    context.move(to: CGPoint(x: 10.5, y: 10.5))
    context.addLine(to: CGPoint(x: 19, y: 19))
    context.move(to: CGPoint(x: 15.5, y: 15.5))
    context.addLine(to: CGPoint(x: 17.5, y: 13.5))
    context.move(to: CGPoint(x: 13, y: 13))
    context.addLine(to: CGPoint(x: 15, y: 11))
    context.strokePath()
  }

  /// `M9 9.5a3 3 0 1 1 4.2 2.7c-.8.4-1.2 1-1.2 1.8v.5` and a dot at (12, 17.75), r 1.35 —
  /// the Instrument drawing (DESIGN.md §13).
  public static func question(_ context: CGContext) {
    stroked(context)
    // The hook: a large clockwise arc of radius 3 about (12, 9.5), from the
    // left over the top to the lower right. The atlas context is y-down, so
    // increasing angles read clockwise on screen — the SVG's sweep flag.
    context.move(to: CGPoint(x: 9, y: 9.5))
    context.addArc(
      center: CGPoint(x: 12, y: 9.5), radius: 3, startAngle: .pi, endAngle: atan2(2.7, 1.2), clockwise: false)
    context.addCurve(to: CGPoint(x: 12, y: 14), control1: CGPoint(x: 12.4, y: 12.6), control2: CGPoint(x: 12, y: 13.2))
    context.addLine(to: CGPoint(x: 12, y: 14.5))
    context.strokePath()
    context.fillEllipse(in: CGRect(x: 10.65, y: 16.4, width: 2.7, height: 2.7))
  }

  /// `M12 5v9` and a dot at (12, 18): the exclamation.
  public static func failure(_ context: CGContext) {
    stroked(context)
    context.move(to: CGPoint(x: 12, y: 5))
    context.addLine(to: CGPoint(x: 12, y: 14))
    context.strokePath()
    context.fillEllipse(in: CGRect(x: 10.65, y: 16.65, width: 2.7, height: 2.7))
  }

  /// The burn mark: a leaning flame with a sharp tip, so it reads as fire and
  /// not as a droplet at thirteen pixels.
  /// `M12.2 1.8C14.6 5.6 18 8.6 18 13.4a6 6 0 0 1-12 0c0-2.7 1.1-4.5 2.5-5.8.2 1.8 1 2.9 2.1 3.3C9.3 7.5 10.1 4.1 12.2 1.8z`.
  private static func flamePath() -> CGPath {
    let path = CGMutablePath()
    path.move(to: CGPoint(x: 12.2, y: 1.8))
    path.addCurve(to: CGPoint(x: 18, y: 13.4), control1: CGPoint(x: 14.6, y: 5.6), control2: CGPoint(x: 18, y: 8.6))
    // The base: a half circle of radius 6 about (12, 13.4), clockwise on
    // screen from the right round the bottom to the left.
    path.addArc(center: CGPoint(x: 12, y: 13.4), radius: 6, startAngle: 0, endAngle: .pi, clockwise: false)
    path.addCurve(to: CGPoint(x: 8.5, y: 7.6), control1: CGPoint(x: 6, y: 10.7), control2: CGPoint(x: 7.1, y: 8.9))
    path.addCurve(to: CGPoint(x: 10.6, y: 10.9), control1: CGPoint(x: 8.7, y: 9.4), control2: CGPoint(x: 9.5, y: 10.5))
    path.addCurve(to: CGPoint(x: 12.2, y: 1.8), control1: CGPoint(x: 9.3, y: 7.5), control2: CGPoint(x: 10.1, y: 4.1))
    path.closeSubpath()
    return path
  }

  /// Filled when lit.
  public static func flame(_ context: CGContext) {
    context.addPath(flamePath())
    context.fillPath()
  }

  /// Outlined where there is no price to read (`stroke-width="1.7"`).
  public static func flameHollow(_ context: CGContext) {
    stroked(context, width: 1.7)
    context.addPath(flamePath())
    context.strokePath()
  }
}
