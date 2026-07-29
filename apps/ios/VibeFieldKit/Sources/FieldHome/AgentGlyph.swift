import FieldAgents
import FieldDesign
import SwiftUI

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
