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
/// two surfaces draw identical marks. ACP has no mark and uses a letter,
/// as on the desktop.
struct AgentGlyph: View {
  let provider: AgentProvider

  var body: some View {
    switch provider {
    case .acp:
      Text("A")
        .font(.system(size: 44, weight: .heavy, design: .monospaced))
    case .claude, .codex, .grok:
      Image("agent-\(provider.rawValue)", bundle: .module)
        .renderingMode(.template)
        .resizable()
        .scaledToFit()
    }
  }
}
