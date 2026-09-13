import FieldAgents
import SwiftUI

/// The mark a bubble wears, chosen by what the bubble IS.
///
/// A peer's terminal session gets a prompt, not a vendor mark: the mesh told
/// us a shell is running, not who is driving it, and drawing Claude's mark on
/// a bare shell would be the projection claiming something discovery never
/// said.
struct BubbleGlyph: View {
  let bubble: FieldBubble

  var body: some View {
    if bubble.remote != nil {
      Image("agent-terminal", bundle: .module)
        .renderingMode(.template)
        .resizable()
        .scaledToFit()
    } else if let provider = bubble.agent?.provider {
      AgentGlyph(provider: provider)
    }
  }
}

/// Vendor glyphs. SVG geometry ships as template assets from LobeHub Lobe
/// Icons v5.14.0 (MIT) — the same set the desktop godview embeds — so the
/// two surfaces draw identical marks.
///
/// A provider with no drawn mark wears its LETTER, which is the reference's
/// own fallback (`AgentIcon.tsx`) and not a special case for ACP: `acp` is
/// simply the one override in the table. Since `AgentProvider` opened, this is
/// also what an unfamiliar vendor gets — an agent you can see and read,
/// rather than one that could not be drawn and therefore was not shown.
struct AgentGlyph: View {
  let provider: AgentProvider

  var body: some View {
    if provider.hasDrawnMark {
      Image("agent-\(provider.rawValue)", bundle: .module)
        .renderingMode(.template)
        .resizable()
        .scaledToFit()
    } else {
      Text(provider.markLetter)
        .font(.system(size: 44, weight: .heavy, design: .monospaced))
    }
  }
}
