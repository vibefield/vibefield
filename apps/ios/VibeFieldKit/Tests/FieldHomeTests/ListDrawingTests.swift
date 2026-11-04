import CoreText
import FieldAgents
import Foundation
import Testing

#if canImport(UIKit)
  import UIKit
  private typealias PlatformFont = UIFont
#elseif canImport(AppKit)
  import AppKit
  private typealias PlatformFont = NSFont
#endif

@testable import FieldHome
@testable import FieldProduct

// PG-5 — THE LIST, DRAWN (host + kit; D3 kit only): the numbers and inks `ListView` draws with, held to list.css at
// puppeteer-views 0.3.3 (`52d09c8e`, `e79fc53d`; LC) and to the named deviations (ListPaint's header): no
// `＋ TERMINAL` (H11 in the model's suite), no hover, the lit border in text main (J-S4), a letter for a provider with
// no asset; the fifth, the empty hint's words, is the model suite's (H12, E1). The pixels themselves are the stills',
// by eye.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-5 — the list view, drawn")
struct ListDrawingTests {
  /// D1 — a row's weight (LC:101-113): shown 1, stale .58, receded .22, every row receded .07; a row both stale and
  /// receded weighs the recede's (the later rule); the dot's .4 when idle, and its ring when blocked (LC:115-128).
  @Test func theWeights() {
    let shown = ListPaint.weight(stale: false, receded: false, allReceded: false)
    #expect(shown == 1)
    let stale = ListPaint.weight(stale: true, receded: false, allReceded: false)
    #expect(stale == 0.58)
    let receded = ListPaint.weight(stale: false, receded: true, allReceded: false)
    #expect(receded == GodviewRecede.receded)
    let both = ListPaint.weight(stale: true, receded: true, allReceded: false)
    #expect(both == GodviewRecede.receded)
    let every = ListPaint.weight(stale: false, receded: true, allReceded: true)
    #expect(every == GodviewRecede.recededEmpty)
    let idle = ListPaint.dotWeight(.idle)
    #expect(idle == 0.4)
    let working = ListPaint.dotWeight(.working)
    #expect(working == 1)
    let rings = [MonitorRowStatus.idle, .working, .blocked].map(ListPaint.dotRinged)
    #expect(rings == [false, false, true])
  }

  /// D2 — a row wears its dealt colour, and the neutral (the faint ink) when the stage deals none: a terminal, an
  /// undealt project (`GodviewStageInput.colour`).
  @Test func theRowsColour() {
    let dealt = SwarmColor(r: 0.2, g: 0.4, b: 0.6, a: 1)
    let worn = ListPaint.ink(dealt)
    #expect(worn == .dealt(dealt))
    let none = ListPaint.ink(nil)
    #expect(none == .textFaint)
  }

  /// D4 — J-S4 (accept): the lit row's border is TEXT MAIN, not the row's colour (deviation 3), on the control hover
  /// ground; an unlit row draws neither; a pane's left border is the row's colour, and no phone row has a pane.
  @Test func theLitRow() {
    let border = ListPaint.litBorder(active: true)
    #expect(border == .textMain)
    let ground = ListPaint.litGround(active: true)
    #expect(ground == .controlHoverBg)
    let unlitBorder = ListPaint.litBorder(active: false)
    #expect(unlitBorder == nil)
    let unlitGround = ListPaint.litGround(active: false)
    #expect(unlitGround == nil)
    let dealt = SwarmColor(r: 0.2, g: 0.4, b: 0.6, a: 1)
    let linked = ListPaint.linkedBorder(linked: true, ink: .dealt(dealt))
    #expect(linked == .dealt(dealt))
    let unlinked = ListPaint.linkedBorder(linked: false, ink: .dealt(dealt))
    #expect(unlinked == nil)
  }

  /// D5 — the grid at the phone's width (LC:63-71, fd's Q8: the desktop's defaults). At 402 pt (the iPhone 17 Pro's
  /// portrait) the agent column is 43.04 and the detail 66.96: 402 − 2×13 (the rows' box) − 3 − 1 (the borders) −
  /// 2×9 (the inset) − 10 − 150 − 44 (the fixed columns) − 4×10 (the gaps) = 110, shared .9 : 1.4. Never below 0.
  @Test func theColumnsAtThePhonesWidth() {
    let phone = ListPaint.columns(width: 402, projectWidth: 150)
    #expect(abs(phone.agent - 110 * 0.9 / 2.3) < 1e-9)
    #expect(abs(phone.detail - 110 * 1.4 / 2.3) < 1e-9)
    let narrow = ListPaint.columns(width: 200, projectWidth: 150)
    #expect(narrow.agent == 0)
    #expect(narrow.detail == 0)
    let sizes = [ListPaint.dotColumn, ListPaint.contextColumn, ListPaint.columnGap, ListPaint.rowInset]
    #expect(sizes == [10, 44, 10, 9])
    let edges = [ListPaint.border, ListPaint.leftBorder, ListPaint.radius, ListPaint.dot, ListPaint.dotRing]
    #expect(edges == [1, 3, 6, 8, 3])
    let type = [ListPaint.projectSize, ListPaint.smallSize, ListPaint.accountSize, ListPaint.markSize]
    #expect(type == [11, 9, 8, 11])
    #expect(ListPaint.columnTop == 11)
  }

  /// D6 — the inks each cell wears (LC:137-197): the project and the host chip in text main, the branch, the model
  /// and the detail muted, the account, `terminal`, the context, the toolbar and the empty stage faint.
  @Test func theCellsInks() {
    let main = [ListPaint.projectInk, ListPaint.hostInk]
    #expect(main == [.textMain, .textMain])
    let muted = [ListPaint.branchInk, ListPaint.modelInk, ListPaint.detailInk]
    #expect(muted == [.textMuted, .textMuted, .textMuted])
    let faint = [
      ListPaint.accountInk, ListPaint.terminalInk, ListPaint.contextInk, ListPaint.toolbarInk, ListPaint.emptyInk,
    ]
    #expect(faint == [.textFaint, .textFaint, .textFaint, .textFaint, .textFaint])
  }

  /// V8 — `-vf-godview-view=list` names the list (the case PG-5 adds; V4 already admits `list`).
  @Test func theFlagNamesTheList() {
    let chosen = GodviewViewChoice.launch(["VibeField", "-vf-godview-view=list"])
    #expect(chosen == .list)
  }

  /// D7 — the cells' lines (VF-PM's (B), 2026-11-04, deviation 6): every cell is the desktop's ONE line with the tail
  /// ellipsis (LC:137-157, :180-186: `nowrap`, `text-overflow: ellipsis`), but the detail, TWO lines then the ellipsis,
  /// and the model, at most TWO lines broken only at a space.
  @Test func theCellsLines() {
    let cell = ListPaint.cellLines
    #expect(cell == 1)
    let detail = ListPaint.detailLines
    #expect(detail == 2)
    let model = ListPaint.modelLinesMax
    #expect(model == 2)
  }

  /// D8 — the model breaks ONLY at a space, two lines at most, never inside a word ("Haik|u", "Sonn|et" impossible):
  /// a word wider than the line stands alone and is cut, and a third line's words join the second, cut.
  @Test func theModelBreaksOnlyAtASpace() {
    let opus = ListPaint.modelLines("Opus 5.5", glyphs: 4)
    #expect(opus == ["Opus", "5.5"])
    let sonnet = ListPaint.modelLines("Sonnet 5.5", glyphs: 6)
    #expect(sonnet == ["Sonnet", "5.5"])
    let whole = ListPaint.modelLines("Sonnet 5.5", glyphs: 10)
    #expect(whole == ["Sonnet 5.5"])
    let hyphen = ListPaint.modelLines("GPT-5.5", glyphs: 4)
    #expect(hyphen == ["GPT-5.5"], "a hyphen is no space: the word stands alone, cut, never GPT- / 5.5")
    let three = ListPaint.modelLines("a b c", glyphs: 1)
    #expect(three == ["a", "b c"])
    let spaced = ListPaint.modelLines("Opus  5.5", glyphs: 4)
    #expect(spaced == ["Opus", "5.5"])
    let empty = ListPaint.modelLines("", glyphs: 4)
    #expect(empty == [""])
  }

  /// D9 — the agent column's FIXED floor (deviation 6, fd's ruling): the mark, its gap and 8 glyphs of the mono, 60.51
  /// pt at 9 pt, whatever the rows say (the grid never reflows with its data). At the phone's 402 pt it comes out of the
  /// detail's share (49.49 pt, 8 glyphs a line, 2 lines). At every witness step, every model line holds whole words
  /// that fit, and the terminal's and the host's words fit alone. 0 is still D5's desktop grid.
  @Test func theAgentColumnHasItsFixedFloor() throws {
    let advance = ListPaint.monoAdvanceEm * ListPaint.smallSize
    let fixed = ListPaint.markSize + ListPaint.agentGap + 8 * advance
    let glyphs = ListPaint.agentFloorGlyphs
    #expect(glyphs == 8)
    let floor = ListPaint.agentFloor
    #expect(abs(floor - fixed) < 1e-9)
    let phone = ListPaint.columns(width: 402, projectWidth: 150, agentFloor: floor)
    #expect(abs(phone.agent - fixed) < 1e-9)
    #expect(abs(phone.detail - (110 - fixed)) < 1e-9)
    let modelGlyphs = ListPaint.glyphs(fitting: phone.agent - ListPaint.markSize - ListPaint.agentGap)
    #expect(modelGlyphs == 8)
    let detailGlyphs = ListPaint.glyphs(fitting: phone.detail)
    #expect(detailGlyphs == 8)
    let aloneGlyphs = ListPaint.glyphs(fitting: phone.agent)
    let steps = try HomeFixture.witnessSteps()
    for step in steps where !step.gap {
      let model = ListModel.of(ListModel.inputs(rows: step.rows, activeId: nil, fieldIsLive: true))
      for row in model.rows {
        switch row.agent {
        case .agent(_, let label, _):
          let lines = ListPaint.modelLines(label, glyphs: modelGlyphs)
          #expect(lines.count <= 2, "step \(step.at): \(label)")
          #expect(lines.joined(separator: " ") == label, "step \(step.at): whole words, \(label)")
          for line in lines { #expect(line.count <= modelGlyphs, "step \(step.at): \(line) is cut") }
        case .terminal(let word), .host(let word):
          #expect(word.count <= aloneGlyphs, "step \(step.at): \(word) is cut")
        }
      }
    }
  }

  /// D10 (a pin) — the advance the lines are counted by is SF Mono's (SFNSMono.ttf's hmtx: every glyph 1266 of 2048
  /// units, regular and italic), as the platform's monospaced system font measures it at the list's 9 pt.
  @Test func theAdvanceIsSFMonos() {
    #expect(ListPaint.monoAdvanceEm == 1266.0 / 2048.0)
    let size = CGFloat(ListPaint.smallSize)
    let font = PlatformFont.monospacedSystemFont(ofSize: size, weight: .regular) as CTFont
    var character: UniChar = 0x30
    var glyph = CGGlyph()
    let found = CTFontGetGlyphsForCharacters(font, &character, &glyph, 1)
    #expect(found)
    var advance = CGSize.zero
    _ = CTFontGetAdvancesForGlyphs(font, .horizontal, &glyph, &advance, 1)
    let measured = Double(advance.width)
    #expect(abs(measured - ListPaint.monoAdvanceEm * ListPaint.smallSize) < 1e-6, "measured \(measured)")
  }

  #if canImport(UIKit)
    /// D3 (kit) — the mark: the witness's providers (claude, codex) have drawn assets, as the golden's `svg` says; a
    /// provider with none wears its letter (deviation 4: the SDK draws a path for six the phone letters), and no id
    /// wears `?`. On the main actor: `AgentGlyph.drawnAsset(for:)` is a View's static, main-actor-isolated (the early
    /// kit compile's four Swift 6 isolation warnings).
    @MainActor
    @Test func theMarks() {
      let claude = AgentGlyph.drawnAsset(for: "claude")
      #expect(claude != nil)
      let codex = AgentGlyph.drawnAsset(for: "codex")
      #expect(codex != nil)
      for letterOnly in ["kimi", "opencode", "hermes", "antigravity", "copilot", "pi"] {
        let asset = AgentGlyph.drawnAsset(for: letterOnly)
        #expect(asset == nil, "\(letterOnly)")
      }
      let kimi = AgentProvider(rawValue: "kimi").markLetter
      #expect(kimi == "K")
      let none = AgentGlyph.drawnAsset(for: "")
      #expect(none == nil)
      let unnamed = AgentProvider(rawValue: "").markLetter
      #expect(unnamed == "?")
    }
  #endif
}
