import FieldAgents
import Foundation
import Testing

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

  #if canImport(UIKit)
    /// D3 (kit) — the mark: the witness's providers (claude, codex) have drawn assets, as the golden's `svg` says; a
    /// provider with none wears its letter (deviation 4: the SDK draws a path for six the phone letters), and no id
    /// wears `?`.
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
