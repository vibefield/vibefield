import CoreGraphics
import SwiftUI

// PG-4t — THE VIEWS' FACES AS THEIR MANIFESTS AUTHOR THEM (DESIGN.md §8 "The phone's Stories row"; MV-D6: "each view
// supplies its filled mark … the host has no view mark table"): every view's label and mark, transcribed ONCE from
// puppeteer-views' manifests (`views/<id>/index.ts`, `mark:`) in their authoring form — the bar's 1.6 monoline on the
// 24 grid, round-capped strokes and rings — so the phone draws the manifests' own drawings, never an SF Symbol. All
// five are here before their views land: a PG-5…8 lane adds its case and nothing else.
//
// Held to the manifests by the marks golden (`phone-marks.golden.json`): `outlines` writes each path exactly as the
// view SDK's `mark-outline.js` writes the manifest's filled outline, and a host row compares the two strings. No `#if`.

/// A view's face on the Stories row: its manifest's label and its mark.
struct GodviewViewFace: Equatable, Sendable {
  /// One stroke of a mark on the 24 grid.
  enum Part: Equatable, Sendable {
    /// A straight, round-capped stroke `width` wide (the bar's 1.6); one of no length is a dot as wide as it.
    case stroke(from: CGPoint, to: CGPoint, width: CGFloat)
    /// A stroked circle, the bar's 1.6 wide.
    case ring(center: CGPoint, radius: CGFloat)
  }

  /// The manifest's label (SWARM); the row says it in sentence case (`GodviewStories.name(label:)`).
  let label: String
  /// The manifest's `mark.paths`, in order, each its parts. Empty for a view whose manifest draws no mark: the row
  /// shows its label's initial.
  let paths: [[Part]]
}

/// Every view's face, keyed by manifest id.
enum GodviewViewMarks {
  /// The bar's mark grid: a mark's `viewBox` is `0 0 24 24`.
  static let grid: CGFloat = 24
  /// The bar's monoline weight, in grid units.
  static let weight: CGFloat = 1.6

  /// The five manifests' faces (puppeteer-views `views/{swarm,list,rain,timeline,spend}/index.ts`).
  static let faces: [String: GodviewViewFace] = [:]
}

extension GodviewViewChoice {
  /// This view's face: its manifest's, or its id's capitals with no mark (the row then shows the initial), so the
  /// lookup is total. Every case has its manifest's face (a host row pins it).
  var face: GodviewViewFace {
    GodviewViewMarks.faces[rawValue] ?? GodviewViewFace(label: rawValue.uppercased(), paths: [])
  }
}

extension GodviewViewFace {
  /// Each path as the view SDK writes the manifest's filled outline (`mark-outline.js`): what the marks golden holds.
  var outlines: [String] {
    []
  }

  /// One part's filled outline, as `strokeOutline` / `ringOutline` write it.
  static func outline(_ part: Part) -> String {
    ""
  }

  /// A coordinate as `mark-outline.js`'s `unit` writes it: to four places, rounded as `Math.round` rounds (a tie
  /// toward +∞), with no `-0`, in JavaScript's digits.
  static func unit(_ value: Double) -> String {
    ""
  }
}
