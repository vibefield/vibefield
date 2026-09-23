import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

/// The sticker's die-cut, drawn the way the kit draws it (`face.tsx`'s
/// `dieCutFilter`) with Core Image standing in for the SVG filter — which is
/// what DESIGN.md §2.8 already prescribes for iOS: "dilate with
/// `CIMorphologyMaximum`".
///
/// The recipe, step for step: the glyph's alpha is THRESHOLDED (slope 4,
/// intercept −2) — an emoji bitmap carries faint anti-aliased pixels at its
/// corners, and a plain dilation grows them into grey squares that show only
/// on a dark ground — then dilated by the edge width plus one pixel and softened
/// half a pixel for the CUT line (black/12), dilated by the edge width for the
/// PAPER (white), and the glyph is laid over both. The canvas is 160 % of the
/// size, the filter's own region, so the edge has room.
///
/// The result is theme-independent — the paper is white in both themes and the
/// cut line is a black veil — so one render serves both, and it is cached per
/// (emoji, size, scale). The shadow, the tilt and the lift are the view's, in
/// SwiftUI, where they animate.
@MainActor
public enum StickerRenderer {
  /// The canvas as a multiple of the size (the SVG filter region: 160 %).
  public static let canvasRatio: CGFloat = 1.6
  /// The figure as a fraction of the size (§2.8: 86 %).
  public static let figureRatio: CGFloat = 0.86

  private static let cache = NSCache<NSString, UIImage>()
  private static let context = CIContext(options: [.cacheIntermediates: false])

  /// The sticker for `emoji` at `size` points on a `scale`× screen, or nil
  /// where Core Image could not produce one (a headless host with no GPU and
  /// no software path — the view then draws the bare emoji, honest and
  /// unframed, rather than nothing).
  public static func image(emoji: String, size: CGFloat, scale: CGFloat) -> UIImage? {
    let key = "\(emoji)|\(size)|\(scale)" as NSString
    if let hit = cache.object(forKey: key) { return hit }
    guard let made = render(emoji: emoji, size: size, scale: scale) else { return nil }
    cache.setObject(made, forKey: key)
    return made
  }

  /// The canvas edge in points for a size.
  public static func canvas(for size: CGFloat) -> CGFloat {
    (size * canvasRatio).rounded(.up)
  }

  static func render(emoji: String, size: CGFloat, scale: CGFloat) -> UIImage? {
    let canvas = canvas(for: size)
    let glyph = glyphImage(emoji: emoji, fontSize: size * figureRatio, canvas: canvas, scale: scale)
    guard let cgGlyph = glyph.cgImage else { return nil }
    let source = CIImage(cgImage: cgGlyph)
    let extent = source.extent
    let edge = CGFloat(FaceDeck.stickerEdge(size: size)) * scale
    let solid = thresholdedAlpha(source)
    let cut = paper(solid, radius: edge + scale, blur: 0.5 * scale, color: FaceTokens.stickerCutCI, extent: extent)
    let edgePaper = paper(solid, radius: edge, blur: 0.5 * scale, color: FaceTokens.stickerEdgeCI, extent: extent)
    let composed = source.composited(over: edgePaper.composited(over: cut)).cropped(to: extent)
    guard let output = context.createCGImage(composed, from: extent) else { return nil }
    return UIImage(cgImage: output, scale: scale, orientation: .up)
  }

  /// The emoji, drawn by the system font — which is Apple Color Emoji for an
  /// emoji — centred on the canvas, nudged down 0.035 em the way the kit's
  /// `.vf-face-glyph` is, because emoji glyphs sit a touch high in their em box.
  static func glyphImage(emoji: String, fontSize: CGFloat, canvas: CGFloat, scale: CGFloat) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = scale
    format.opaque = false
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: canvas, height: canvas), format: format)
    return renderer.image { _ in
      let font = UIFont.systemFont(ofSize: fontSize)
      let string = NSAttributedString(string: emoji, attributes: [.font: font])
      let bounds = string.boundingRect(
        with: CGSize(width: canvas, height: canvas), options: [.usesLineFragmentOrigin], context: nil)
      let origin = CGPoint(
        x: ((canvas - bounds.width) / 2).rounded(),
        y: ((canvas - bounds.height) / 2 + fontSize * 0.035).rounded())
      string.draw(at: origin)
    }
  }

  /// `feComponentTransfer` slope 4 intercept −2 on the alpha, colour zeroed:
  /// a solid black shape wherever the glyph is at least half opaque.
  private static func thresholdedAlpha(_ source: CIImage) -> CIImage {
    let matrix = CIFilter.colorMatrix()
    matrix.inputImage = source
    matrix.rVector = CIVector(x: 0, y: 0, z: 0, w: 0)
    matrix.gVector = CIVector(x: 0, y: 0, z: 0, w: 0)
    matrix.bVector = CIVector(x: 0, y: 0, z: 0, w: 0)
    matrix.aVector = CIVector(x: 0, y: 0, z: 0, w: 4)
    matrix.biasVector = CIVector(x: 0, y: 0, z: 0, w: -2)
    let clamp = CIFilter.colorClamp()
    clamp.inputImage = matrix.outputImage
    clamp.minComponents = CIVector(x: 0, y: 0, z: 0, w: 0)
    clamp.maxComponents = CIVector(x: 1, y: 1, z: 1, w: 1)
    return clamp.outputImage ?? source
  }

  /// `feMorphology dilate` by `radius`, `feGaussianBlur` by `blur`, then the
  /// flood colour composited IN the shape — one layer of paper or cut line.
  private static func paper(
    _ solid: CIImage, radius: CGFloat, blur: CGFloat, color: CIColor, extent: CGRect
  ) -> CIImage {
    let dilate = CIFilter.morphologyMaximum()
    dilate.inputImage = solid
    dilate.radius = Float(radius)
    let soften = CIFilter.gaussianBlur()
    soften.inputImage = dilate.outputImage
    soften.radius = Float(blur)
    let shape = (soften.outputImage ?? solid).cropped(to: extent)
    let mask = CIFilter.blendWithAlphaMask()
    mask.inputImage = CIImage(color: color).cropped(to: extent)
    mask.backgroundImage = CIImage.empty()
    mask.maskImage = shape
    return (mask.outputImage ?? shape).cropped(to: extent)
  }
}
