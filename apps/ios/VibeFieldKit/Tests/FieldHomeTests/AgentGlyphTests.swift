import FieldAgents
import Testing

@testable import FieldHome

/// AC-5 — which agents the CARD draws a glyph for is the asset catalog's to
/// say. It was `AgentProvider.hasDrawnMark`, a three-vendor list in code that
/// had to agree with `Glyphs.xcassets` by hand; the folder itself is the table
/// now, looked up by the catalog's mark key. These rows read the real bundle.
@Suite struct AgentGlyphTests {
  /// The two vendor glyphs the folder ships draw as themselves.
  @Test func aMarkWithAnImagesetDrawsIt() {
    #expect(AgentGlyph.drawnAsset(for: "claude") == "agent-claude")
    #expect(AgentGlyph.drawnAsset(for: "codex") == "agent-codex")
  }

  /// LP-4 (2026-11-05) — James kept Claude's and Codex's logos for v1 and no
  /// other: Grok's imageset left the folder, so Grok wears its letter, the
  /// card's own fallback, exactly as the swarm does. On the main actor:
  /// `drawnAsset(for:)` is a View's static (ListDrawingTests' note).
  @MainActor
  @Test func onlyTheKeptVendorMarksAreDrawn() {
    #expect(AgentGlyph.drawnAsset(for: "grok") == nil)
    #expect(AgentProvider(rawValue: "grok").markLetter == "G")
  }

  /// The card's glyphs are NOT the swarm's atlas: kimi has a tile there and no
  /// imageset here, and asking the atlas would have drawn it as nothing. Here
  /// it — like ACP and any agent no folder knows — wears its letter.
  @Test func aMarkWithNoImagesetWearsItsLetter() {
    #expect(AgentGlyph.drawnAsset(for: "kimi") == nil)
    #expect(AgentGlyph.drawnAsset(for: "acp") == nil)
    #expect(AgentGlyph.drawnAsset(for: "zed") == nil)
    #expect(AgentGlyph.drawnAsset(for: "") == nil)
  }

  /// The peer-terminal prompt lives in the same folder and is never an agent's
  /// mark, whatever an agent is called.
  @Test func thePromptIsNeverAnAgentsMark() {
    #expect(AgentGlyph.drawnAsset(for: "terminal") == nil)
  }
}
