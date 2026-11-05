import FieldAgents
import SwiftUI
import UIKit

/// The mark a bubble wears, chosen by what the bubble IS.
///
/// A peer's terminal session gets a prompt, not a vendor mark: the mesh told
/// us a shell is running, not who is driving it, and drawing Claude's mark on
/// a bare shell would be the projection claiming something discovery never
/// said. So does a bare terminal with neither facet (PG-3e, J-E3; it drew
/// nothing before the review's [1]): `FieldBubble.glyph` decides.
struct BubbleGlyph: View {
  let bubble: FieldBubble
  /// The size an undrawn mark's letter is set at (`AgentGlyph.letterSize`).
  var letterSize: CGFloat = 44

  var body: some View {
    switch bubble.glyph {
    case .terminalPrompt:
      Image(AgentGlyph.terminalAsset, bundle: .module)
        .renderingMode(.template)
        .resizable()
        .scaledToFit()
    case .agentMark(let mark):
      AgentGlyph(mark: mark, letterSize: letterSize)
    }
  }
}

/// Vendor glyphs. SVG geometry ships as template assets from LobeHub Lobe
/// Icons v5.14.0 (MIT) — the same set the desktop godview embeds — so the
/// two surfaces draw identical marks.
///
/// LP-4 (2026-11-05, the 0.9 launch): the folder keeps Claude's and Codex's
/// marks only — the two vendor logos James kept for v1. Grok's left it (a
/// third party's trademark the app has no leave to draw), so Grok wears its
/// letter here as it does in the swarm (`MarksAtlas`' `kept`).
///
/// A mark with no drawn glyph wears its LETTER, which is the reference's own
/// fallback (`AgentIcon.tsx`): an agent you can see and read, rather than one
/// that could not be drawn and therefore was not shown.
///
/// **WHICH marks have a glyph is the asset catalog's to say (AC-5).** An
/// `agent-<mark>` imageset exists in `Glyphs.xcassets` or it does not, looked
/// up by the catalog's mark key (the catalog id unless the row names another).
/// Until AC-5 that answer was `AgentProvider.hasDrawnMark`, a three-vendor list
/// in code that had to agree with this folder by hand — a roster of its own. It
/// is also NOT the swarm's atlas: `MarksAtlas` tiles nine marks and this folder
/// held three glyphs (two since LP-4), so "the atlas has a tile" would have sent
/// six agents to an image that is not here and drawn them as nothing.
struct AgentGlyph: View {
  let mark: String
  /// The letter's size. A drawn mark fits whatever frame it is given; the
  /// letter is type, so it is told: the card header's 44, the live card's
  /// badge its 11 (T1, 2026-10-19).
  var letterSize: CGFloat = 44

  /// The peer-terminal prompt. It lives in the same folder and is never an
  /// agent's mark, whatever an agent is called.
  static let terminalAsset = "agent-terminal"

  var body: some View {
    if let asset = Self.drawnAsset(for: mark) {
      Image(asset, bundle: .module)
        .renderingMode(.template)
        .resizable()
        .scaledToFit()
    } else {
      Text(AgentProvider(rawValue: mark).markLetter)
        .font(.system(size: letterSize, weight: .heavy, design: .monospaced))
    }
  }

  /// The imageset a mark key draws, or nil for the letter.
  static func drawnAsset(for mark: String) -> String? {
    guard !mark.isEmpty else { return nil }
    let name = "agent-\(mark)"
    guard name != terminalAsset else { return nil }
    return UIImage(named: name, in: .module, compatibleWith: nil) == nil ? nil : name
  }
}
