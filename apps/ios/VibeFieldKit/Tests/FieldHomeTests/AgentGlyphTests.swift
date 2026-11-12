import FieldAgents
import FieldProduct
import Testing

@testable import FieldHome

/// AC-5 — which agents the CARD draws a glyph for is the asset catalog's to
/// say. It was `AgentProvider.hasDrawnMark`, a three-vendor list in code that
/// had to agree with `Glyphs.xcassets` by hand; the folder itself is the table
/// now, looked up by the catalog's mark key. These rows read the real bundle.
@Suite struct AgentGlyphTests {
  /// A glyph the folder ships draws as itself.
  @Test func aMarkWithAnImagesetDrawsIt() {
    #expect(AgentGlyph.drawnAsset(for: "claude") == "agent-claude")
    #expect(AgentGlyph.drawnAsset(for: "codex") == "agent-codex")
  }

  /// Item 359 (James, 2026-11-12 17:50:31Z: "overturn this ruling, bring back
  /// those icons now") — LP-4's two-mark rule is overturned: every agent the
  /// catalog offers a phone draws its own mark (eight of the nine; Pi's is
  /// held, item 360), by the catalog's mark key. The
  /// roster is the catalog's fixture, so an agent admitted later with no
  /// imageset is red here until its mark is in the folder, or this row says
  /// why it wears a letter. (LP-4's row, `onlyTheKeptVendorMarksAreDrawn`,
  /// held Grok to its letter; it left with the ruling.) On the main actor:
  /// `drawnAsset(for:)` is a View's static (ListDrawingTests' note).
  @MainActor
  @Test func everyAgentThePhoneOffersDrawsItsOwnMark() throws {
    let rows = try AgentCatalogResult(json: try HomeFixture.json("agent-catalog.valid")).catalog
    // the phone's roster: every row except the ones that keep themselves off it (`surfaces.phone == false`)
    let roster = rows.filter { $0.phone != false }
    #expect(roster.count == 9, "the catalog's fixture offers a phone nine agents (ACP is the desktop's alone)")
    // ITEM 360 — Pi's mark is HELD (VF-PM, 2026-11-12 17:57:56Z): the set's `pi` icon may be Inflection's assistant's
    // and not the coding agent the catalog calls Pi. Unverified. Pi wears its letter on the phone until it is read
    // and VF-PM says; then this set empties and the folder gains `agent-pi`.
    let held: Set<String> = ["pi"]
    for row in roster {
      // the key a mark is drawn by: the row's `mark`, else its id
      let mark = row.mark ?? row.id
      if held.contains(row.id) {
        #expect(AgentGlyph.drawnAsset(for: mark) == nil, "\(row.id) is held (item 360)")
      } else {
        #expect(AgentGlyph.drawnAsset(for: mark) == "agent-\(mark)", "\(row.id)")
      }
    }
  }

  /// An agent no folder knows wears its letter: ACP (a protocol, with no mark
  /// of its own), an id no catalog names, and no id at all.
  @Test func aMarkWithNoImagesetWearsItsLetter() {
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
