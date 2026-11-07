import SwiftUI
import Testing
import UIKit

@testable import FieldDesign

/// Item 241 (DESIGN.md §7 "Off", ruled 2026-11-07, James 20:53:00Z): a pill that is off gives up its own look for
/// the quiet pill's, the quiet fill and its hairline, so a primary loses its inversion, and its words wear t4 at full
/// opacity: black at 50% by day, white at 38% by night. Read on pixels: each kind drawn live and `.disabled(true)` on
/// the sheet's paper at 2×, in both looks; its fill sampled clear of its words and its hairline, its hairline on its
/// top edge, and its words at their inkiest pixel.
@Suite("a pill that is off draws §7's Off")
@MainActor
struct ChromePillOffTests {
  /// The wide pill at New spark's foot, wide enough that its fill shows clear of "Create Polaris" at either end.
  static let size = CGSize(width: 240, height: ChromePillStyle.wideHeight)
  static let scale: CGFloat = 2
  static let kinds: [ChromePillStyle.Kind] = [.primary, .secondary]
  static let schemes: [ColorScheme] = [.light, .dark]

  /// A colour in sRGB, its channels 0…1.
  struct RGBA: CustomStringConvertible {
    var r: Double
    var g: Double
    var b: Double
    var a: Double

    init(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) {
      self.r = r
      self.g = g
      self.b = b
      self.a = a
    }

    /// This colour laid over an opaque ground, as the bitmap composites it.
    func over(_ ground: RGBA) -> RGBA {
      RGBA(r * a + ground.r * (1 - a), g * a + ground.g * (1 - a), b * a + ground.b * (1 - a))
    }

    /// The widest channel's gap, in 8-bit steps.
    func distance(_ other: RGBA) -> Double {
      max(abs(r - other.r), abs(g - other.g), abs(b - other.b)) * 255
    }

    var description: String {
      "rgb(\(Int((r * 255).rounded())), \(Int((g * 255).rounded())), \(Int((b * 255).rounded())))"
    }
  }

  /// DESIGN.md §7's t4 for an off pill's words, as its row names them for the phone.
  static func faint(_ scheme: ColorScheme) -> RGBA {
    scheme == .dark ? RGBA(1, 1, 1, 0.38) : RGBA(0, 0, 0, 0.50)
  }

  /// A kit colour in one look (TerminalGroundTests' and AppBarTests' pattern).
  static func colour(_ color: Color, _ scheme: ColorScheme) -> RGBA {
    var environment = EnvironmentValues()
    environment.colorScheme = scheme
    let resolved = color.resolve(in: environment)
    return RGBA(Double(resolved.red), Double(resolved.green), Double(resolved.blue), Double(resolved.opacity))
  }

  struct Picture {
    let bytes: [UInt8]
    let width: Int

    /// One pixel. The paper is opaque, so premultiplied RGBA reads as it is.
    func at(_ x: Int, _ y: Int) -> RGBA {
      let i = (y * width + x) * 4
      return RGBA(Double(bytes[i]) / 255, Double(bytes[i + 1]) / 255, Double(bytes[i + 2]) / 255)
    }
  }

  static func draw(_ kind: ChromePillStyle.Kind, off: Bool, _ scheme: ColorScheme) throws -> Picture {
    let pill = Button("Create Polaris") {}
      .buttonStyle(ChromePillStyle(kind, wide: true))
      .disabled(off)
      .frame(width: size.width, height: size.height)
      .background(ChromePalette.paper)
      .environment(\.colorScheme, scheme)
    let renderer = ImageRenderer(content: pill)
    renderer.scale = scale
    let image = try #require(renderer.cgImage)
    return Picture(bytes: try SparkStarStillTests.pixels(image), width: image.width)
  }

  /// The fill, 14 in from the pill's leading end on its middle line: inside the capsule, clear of its words.
  static func fill(_ picture: Picture) -> RGBA {
    picture.at(Int(14 * scale), Int(size.height / 2 * scale))
  }

  /// The hairline, on the top edge at the middle, where the capsule is straight: one pixel at 2×.
  static func hairline(_ picture: Picture) -> RGBA {
    picture.at(Int(size.width / 2 * scale), 0)
  }

  /// The words at their inkiest: the pixel farthest from the fill in the words' box.
  static func words(_ picture: Picture, from fill: RGBA) -> RGBA {
    var inkiest = fill
    var far = -1.0
    for y in Int(13 * scale)..<Int(37 * scale) {
      for x in Int(50 * scale)..<Int(190 * scale) {
        let pixel = picture.at(x, y)
        let gap = pixel.distance(fill)
        if gap > far {
          far = gap
          inkiest = pixel
        }
      }
    }
    return inkiest
  }

  @Test("the pictures are in their looks: the paper beyond the pill's corner is the paper's own")
  func thePaper() throws {
    for scheme in Self.schemes {
      let picture = try Self.draw(.primary, off: false, scheme)
      let paper = Self.colour(ChromePalette.paper, scheme)
      #expect(picture.at(1, 1).distance(paper) <= 2, "\(scheme): \(picture.at(1, 1)), the paper \(paper)")
    }
  }

  @Test("a live pill keeps its own look: the primary inverted, the quiet on its fill")
  func live() throws {
    for scheme in Self.schemes {
      let paper = Self.colour(ChromePalette.paper, scheme)
      let quiet = Self.colour(ChromePalette.keyFill, scheme).over(paper)

      let primary = try Self.draw(.primary, off: false, scheme)
      let solid = Self.colour(ChromePalette.keyOnFill, scheme)
      let primaryFill = Self.fill(primary)
      #expect(primaryFill.distance(solid) <= 3, "primary \(scheme): the fill \(primaryFill), \(solid)")
      let primaryWords = Self.words(primary, from: primaryFill)
      let onInk = Self.colour(ChromePalette.keyOnInk, scheme)
      #expect(primaryWords.distance(onInk) <= 10, "primary \(scheme): the words \(primaryWords), \(onInk)")

      let secondary = try Self.draw(.secondary, off: false, scheme)
      let secondaryFill = Self.fill(secondary)
      #expect(secondaryFill.distance(quiet) <= 3, "secondary \(scheme): the fill \(secondaryFill), \(quiet)")
      let secondaryWords = Self.words(secondary, from: secondaryFill)
      let ink = Self.colour(ChromePalette.ink, scheme).over(quiet)
      #expect(secondaryWords.distance(ink) <= 10, "secondary \(scheme): the words \(secondaryWords), \(ink)")
    }
  }

  @Test("a pill that is off takes the quiet fill and its hairline, its words in t4 at full opacity")
  func off() throws {
    for kind in Self.kinds {
      for scheme in Self.schemes {
        let paper = Self.colour(ChromePalette.paper, scheme)
        let quiet = Self.colour(ChromePalette.keyFill, scheme).over(paper)
        let picture = try Self.draw(kind, off: true, scheme)

        let fill = Self.fill(picture)
        #expect(fill.distance(quiet) <= 3, "\(kind) \(scheme): the fill \(fill), the quiet fill \(quiet)")
        let edge = Self.hairline(picture)
        let hairline = Self.colour(ChromePalette.keyHairline, scheme).over(quiet)
        #expect(edge.distance(hairline) <= 3, "\(kind) \(scheme): the top edge \(edge), the hairline \(hairline)")
        let words = Self.words(picture, from: fill)
        let faint = Self.faint(scheme).over(quiet)
        #expect(words.distance(faint) <= 10, "\(kind) \(scheme): the words \(words), t4 on the quiet fill \(faint)")
      }
    }
  }
}
