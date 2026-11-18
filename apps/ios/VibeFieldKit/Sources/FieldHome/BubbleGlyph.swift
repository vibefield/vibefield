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

/// Vendor glyphs. SVG geometry ships as template assets from Lobe Icons
/// (`@lobehub/icons-static-svg` 1.94.0, MIT), the same set the desktop embeds
/// (the godview's toolkit, `agentMark`, and History's room), so the surfaces
/// draw identical marks.
///
/// Item 359 (asked for 2026-11-12: that ruling overturned and those marks
/// brought back now, as many other apps in the App Store show such marks
/// and are fine; DECISIONS LP-D7, built by LP-4): every agent the catalog
/// offers a phone has its own mark in the folder, written from the toolkit's
/// path data by the recipe that wrote Codex's (every path argument separated:
/// Xcode misreads compact arc flags). Nine today: Grok's is restored, and
/// Kimi's, OpenCode's, Hermes', Antigravity's, Copilot's and Pi's are new to
/// the card, which never had them. ACP, a protocol with no mark, wears its
/// letter.
/// (Pi's was held for some minutes as item 360: the set's `pi` icon had
/// Inflection's as its neighbour in the swarm's bake. lobe-icons' own index
/// names it "Pi Agent", https://pi.dev, and lists Inflection apart, read
/// 2026-11-12 18:03:54Z; closed with no fault.)
///
/// *Corrected 2026-11-12 (item 359; at its source):* this said the mark set
/// was "Lobe Icons v5.14.0"; the notices and the toolkit name
/// `@lobehub/icons-static-svg` 1.94.0. And from LP-4 (2026-11-05, the 0.9
/// launch) until item 359 the folder kept Claude's and Codex's marks only,
/// the two vendor logos kept for v1, with Grok's removed and every
/// other agent wearing its letter; that ruling was overturned (item 359, 2026-11-12). The
/// swarm's atlas (`MarksAtlas`' `kept`) is item 359's second step.
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
/// held three glyphs then (two under LP-4, nine since item 359), so "the atlas
/// has a tile" would have sent six agents to an image that was not here and
/// drawn them as nothing.
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
