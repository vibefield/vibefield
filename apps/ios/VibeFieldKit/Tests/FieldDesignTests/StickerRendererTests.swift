import Testing
import UIKit

@testable import FieldDesign

/// The die-cut, witnessed on pixels: the sticker is the size the view lays
/// out, the figure is solid at its centre, the corners of the canvas stay
/// clear, and there is paper where the glyph's edge was.
@Suite("the sticker renders its die-cut")
@MainActor
struct StickerRendererTests {
  private func pixel(_ image: UIImage, x: Int, y: Int) -> (r: UInt8, g: UInt8, b: UInt8, a: UInt8)? {
    guard let cg = image.cgImage, let data = cg.dataProvider?.data,
      let bytes = CFDataGetBytePtr(data)
    else { return nil }
    let bytesPerPixel = cg.bitsPerPixel / 8
    let offset = y * cg.bytesPerRow + x * bytesPerPixel
    guard offset + 3 < CFDataGetLength(data) else { return nil }
    // Core Image hands back BGRA or RGBA depending on the context; alpha is
    // last in both, which is all these rows read.
    return (bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
  }

  @Test("a 34 pt sticker at 3× is a 55 pt canvas, solid at its centre and clear at its corner")
  func theCanvas() throws {
    let image = try #require(StickerRenderer.image(emoji: "🦊", size: 34, scale: 3))
    #expect(image.scale == 3)
    #expect(image.size.width == 55)
    #expect(image.size.height == 55)
    let cg = try #require(image.cgImage)
    #expect(cg.width == 165)
    let centre = try #require(pixel(image, x: cg.width / 2, y: cg.height / 2))
    #expect(centre.a == 255)
    let corner = try #require(pixel(image, x: 1, y: 1))
    #expect(corner.a == 0)
  }

  @Test("the paper is white just outside the figure")
  func thePaper() throws {
    // A solid square glyph makes the edge's position exact: figure 86 % of 40
    // = 34.4 pt on a 64 pt canvas at 1×, so the figure spans ~15…49 and the
    // edge (1 pt) plus the cut line sit just beyond it.
    let image = try #require(StickerRenderer.image(emoji: "⬛", size: 40, scale: 1))
    let cg = try #require(image.cgImage)
    let middle = cg.height / 2
    var sawPaper = false
    for x in 0..<cg.width {
      guard let p = pixel(image, x: x, y: middle) else { continue }
      // Paper: opaque-ish and light; the black glyph is dark.
      if p.a > 200 && p.r > 200 && p.g > 200 && p.b > 200 { sawPaper = true }
    }
    #expect(sawPaper)
  }

  @Test("the same sticker is served from the cache")
  func theCache() throws {
    let first = try #require(StickerRenderer.image(emoji: "🐙", size: 26, scale: 2))
    let second = try #require(StickerRenderer.image(emoji: "🐙", size: 26, scale: 2))
    #expect(first === second)
  }
}
