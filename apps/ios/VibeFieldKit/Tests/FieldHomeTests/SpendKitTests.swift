import FieldAgents
import FieldProduct
import FieldSwarm
import Foundation
import SwiftUI
import Testing
import UIKit

@testable import FieldHome

// PG-7 — THE SPEND VIEW IN THE KIT (kit-only: SwarmTheme and the swarm's sprites are UIKit's, so the host loop leaves
// this file out): its inks against the swarm's resolved theme and the stage's skin (K2), and the view itself on the
// phone's stage over the witness (K3). An extension of the one suite, so `-only-testing` by its name takes both. R1
// and R2 read the narrow hero and assert nothing: R1 prints its caption, R2 stills it at a set moment when
// `VF_STILL_DIR` is set (item 285). R3 asserts that at that moment the words stand apart in the phone's own
// fonts (item 291, puppeteer 0.4.1's #81).
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

extension SpendParityTests {
  private static func skinColour(_ skin: GodviewSkin, _ key: GodviewSkin.Key) -> SwarmColor? {
    SwarmColor(hex: String(format: "#%06X", skin.rgb(key)))
  }

  /// K2 — the inks, light and dark: spend's swarm inks are the swarm's own resolved theme (the ink, orange and blue,
  /// and the three state inks fit to be read), its ground, panel, muted and faint the stage's skin; the tag's words
  /// `--vf-card-deep` at 92 %; a row's colour the stage's deal, else the skin's faint ink, as the window's host deals
  /// an undealt project (Q11).
  @Test @MainActor func theInksAreTheSwarmsAndTheSkins() throws {
    for scheme in [ColorScheme.light, .dark] {
      let theme = SwarmTheme.resolve(scheme)
      let skin = GodviewSkin(scheme: scheme)
      let inks = SpendInks(theme: theme, skin: skin)
      #expect(inks.dark == (scheme == .dark), "\(scheme): dark")
      #expect(inks.ink == theme.ink && inks.orange == theme.orange && inks.blue == theme.blue, "\(scheme): swarm")
      #expect(inks.orangeInk == theme.stateInk.orange, "\(scheme): orange ink")
      #expect(inks.blueInk == theme.stateInk.blue, "\(scheme): blue ink")
      #expect(inks.greenInk == theme.stateInk.green, "\(scheme): green ink")
      let ground = Self.skinColour(skin, .monitorBg)
      let panel = Self.skinColour(skin, .panelBg)
      let muted = Self.skinColour(skin, .textMuted)
      let faint = Self.skinColour(skin, .textFaint)
      #expect(inks.ground == ground && inks.panel == panel, "\(scheme): ground and panel")
      #expect(inks.muted == muted && inks.faint == faint, "\(scheme): muted and faint")
      #expect(inks.base(nil) == inks.faint, "\(scheme): an undealt project's colour")
      let dealt = SwarmColor(r: 0.2, g: 0.4, b: 0.6)
      #expect(inks.base(dealt) == dealt, "\(scheme): the stage's deal")
    }
    #expect(SpendInks.deep == SwarmColor(r: 0, g: 0, b: 0, a: 0.92))
  }

  /// K3 — the view on the phone's stage: what it reads from the stage (the box under the reserve, the frozen clock,
  /// the rows as spend reads them) lays out the witness's open, and it renders, light and dark, at the stage's size.
  @Test @MainActor func theViewStandsOnTheStage() throws {
    let steps = try HomeFixture.witnessSteps()
    let rows = try #require(steps.first { $0.at == "open" }?.rows)
    let frozen = try #require(GodviewViewChoice.frozenNow(["-vf-godview-now=1790803300000"]))
    for scheme in [ColorScheme.light, .dark] {
      let input = GodviewStageInput(
        isActive: true, rows: rows, fieldIsLive: true, unreadIds: Set(rows.filter { $0.unread }.map { $0.id }),
        activeId: nil, colour: { _ in nil }, now: { frozen }, bandHeight: 93, topInset: 108,
        skin: GodviewSkin(scheme: scheme), isStill: true, onOpen: { _ in })
      let model = SpendView.modelInput(input, size: CGSize(width: 402, height: 781))
      #expect(model.width == 402 && model.height == 673, "\(scheme): the box under the reserve")
      #expect(model.nowMs == SpendWitness.nowMs, "\(scheme): the frozen clock")
      #expect(model.agents.count == rows.count, "\(scheme): every row")
      let frame = SpendModel.frame(model, SpendModel.State())
      let golden = try SpendGolden.step("open")["viewRows"]?.arrayValue?.count
      #expect(frame.rows.count == golden, "\(scheme): the witness's rows")
      let renderer = ImageRenderer(
        content: SpendView(input: input).frame(width: 402, height: 781).environment(\.colorScheme, scheme))
      let image = renderer.uiImage
      #expect(image?.size == CGSize(width: 402, height: 781), "\(scheme): it renders")
    }
  }

  /// R1 — A READ, NOT A ROW (VF-PM, 2026-11-09): it asserts nothing. At each witness step, on the phone's stage at the
  /// golden's three heights (and, at the open, at a set moment), it prints the narrow hero's caption as the phone's
  /// own fonts cut it (`SpendView.measure`), beside the room the number and the burn leave it. The view does not draw
  /// that caption at narrow; these words go to James with one question, whether it should and in what form. Each line
  /// starts `PG-HERO-WORDS `.
  @Test @MainActor func thePhonesNarrowHeroWordsAreRead() throws {
    let frozen = try #require(GodviewViewChoice.frozenNow(["-vf-godview-now=1790803300000"]))
    let moment = 1_790_803_000_000.0
    for step in try HomeFixture.witnessSteps() {
      let input = GodviewStageInput(
        isActive: true, rows: step.rows, fieldIsLive: true,
        unreadIds: Set(step.rows.filter { $0.unread }.map { $0.id }), activeId: nil, colour: { _ in nil },
        now: { frozen }, bandHeight: 93, topInset: 108, skin: GodviewSkin(scheme: .light), isStill: true,
        onOpen: { _ in })
      for height in [781.0, 588, 508] {
        var states = [("now", SpendModel.State())]
        if step.at == "open" {
          var held = SpendModel.State()
          held.held = moment
          states.append(("moment", held))
        }
        for (when, state) in states {
          let model = SpendView.modelInput(input, size: CGSize(width: 402, height: height))
          let frame = SpendModel.frame(model, state)
          let hero = frame.hero
          let room = SpendModel.heroRoom(frame.g, figure: hero.big, rate: hero.rate, measure: SpendView.measure)
          let said = hero.what ?? "(none)"
          let points = String(format: "%.1f", room.width)
          print(
            "PG-HERO-WORDS step=\(step.at) at=\(when) stage=402x\(Int(height)) narrow=\(hero.narrow) big=\(hero.big)"
              + " rate=\(hero.rate) room=\(points)pt what=\(said)")
        }
      }
    }
  }

  /// R2 — A STILL, NOT A ROW (item 285, 2026-11-10): with `VF_STILL_DIR` set, the shipping view on
  /// the phone's stage (402 × 781, light and dark) at a set moment, R1's `at=moment` (the witness's open, now frozen at
  /// 1790803300000, the moment held at 1790803000000), drawn by `ImageRenderer` at scale 3 into
  /// `spend-hero-moment-402x781-<scheme>.png` there. One `PG-HERO-MOMENT ` line per appearance gives the same measure
  /// R1 makes: the number's and the burn's widths, the hero's line and its room, and where the burn ends against the
  /// list's column and its head's words. It writes those two files and nothing else, nowhere but there. With the
  /// variable unset it returns at once; it asserts nothing either way.
  @Test @MainActor func theSpendHeroAtASetMomentIsStilled() throws {
    guard let dir = ProcessInfo.processInfo.environment["VF_STILL_DIR"], !dir.isEmpty else { return }
    let steps = try HomeFixture.witnessSteps()
    let rows = try #require(steps.first { $0.at == "open" }?.rows)
    let frozen = try #require(GodviewViewChoice.frozenNow(["-vf-godview-now=1790803300000"]))
    var seed = SpendModel.State()
    seed.held = 1_790_803_000_000
    func points(_ value: Double) -> String { String(format: "%.1f", value) }
    for scheme in [ColorScheme.light, .dark] {
      let name = scheme == .dark ? "dark" : "light"
      let input = GodviewStageInput(
        isActive: true, rows: rows, fieldIsLive: true, unreadIds: Set(rows.filter { $0.unread }.map { $0.id }),
        activeId: nil, colour: { _ in nil }, now: { frozen }, bandHeight: 93, topInset: 108,
        skin: GodviewSkin(scheme: scheme), isStill: true, onOpen: { _ in })
      let frame = SpendModel.frame(SpendView.modelInput(input, size: CGSize(width: 402, height: 781)), seed)
      let g = frame.g
      let hero = frame.hero
      let figure = SpendView.measure(hero.big, .heroFigure)
      let burn = SpendView.measure(hero.rate, .heroRate)
      let line = g.lx0 - SpendWords.NarrowHero.listInsetPx - g.x0
      let room = SpendModel.heroRoom(g, figure: hero.big, rate: hero.rate, measure: SpendView.measure).width
      let ends = g.x0 + figure + SpendWords.NarrowHero.gapPx + burn
      let renderer = ImageRenderer(
        content: SpendView(input: input, seed: seed).frame(width: 402, height: 781).environment(\.colorScheme, scheme))
      renderer.scale = 3
      let image = renderer.uiImage
      let png = try #require(image?.pngData(), "\(name): it renders")
      let file = "spend-hero-moment-402x781-\(name).png"
      try png.write(to: URL(fileURLWithPath: dir).appendingPathComponent(file))
      print(
        "PG-HERO-MOMENT scheme=\(name) big=\(hero.big) rate=\(hero.rate) figure=\(points(figure))pt"
          + " burn=\(points(burn))pt line=\(points(line))pt room=\(points(room))pt burnEnds=x\(points(ends))"
          + " listColumn=x\(points(g.lx0)) headWords=x\(points(g.lx0 + 10)) file=\(file)")
    }
  }

  /// R3 — AT A SET MOMENT THE WORDS STAND APART (item 291: puppeteer 0.4.1's #81).
  /// The phone's stage (402 × 781), the witness's open at R2's moment (now frozen at 1790803300000, the moment held
  /// at 1790803000000), measured in the phone's own fonts: `SpendView.measure` for the hero's two faces, and the
  /// caption's and the head's faces as `words` and `head` draw them (caps, tracked). The burn ends 10 pt short of
  /// the list's column, where its head's words begin; the head says only "Total by <clock>", which fits inside its
  /// padding; the chart's caption fits the plot; the Now pill stands 4 pt under the caption's 10 pt line; "$0"'s
  /// 14 pt line ends above now's chip. One `PG-CAP ` line says what the caption and the head measured. Red where
  /// the phone draws 0.4.0's forms, green with the port.
  @Test @MainActor func theSpendViewAtASetMomentKeepsItsWordsApart() throws {
    let steps = try HomeFixture.witnessSteps()
    let rows = try #require(steps.first { $0.at == "open" }?.rows)
    let frozen = try #require(GodviewViewChoice.frozenNow(["-vf-godview-now=1790803300000"]))
    var seed = SpendModel.State()
    seed.held = 1_790_803_000_000
    let input = GodviewStageInput(
      isActive: true, rows: rows, fieldIsLive: true, unreadIds: Set(rows.filter { $0.unread }.map { $0.id }),
      activeId: nil, colour: { _ in nil }, now: { frozen }, bandHeight: 93, topInset: 108,
      skin: GodviewSkin(scheme: .light), isStill: true, onOpen: { _ in })
    let frame = SpendModel.frame(SpendView.modelInput(input, size: CGSize(width: 402, height: 781)), seed)
    let g = frame.g
    let hero = frame.hero
    // words as a caps face draws them: 600 weight (semibold), in caps, tracked by `em` of the size
    func drawn(_ text: String, size: Double, em: Double) -> Double {
      guard !text.isEmpty else { return 0 }
      let attributes: [NSAttributedString.Key: Any] = [
        .font: UIFont.systemFont(ofSize: size, weight: .semibold), .kern: em * size,
      ]
      return Double((text.uppercased() as NSString).size(withAttributes: attributes).width)
    }
    let figure = SpendView.measure(hero.big, .heroFigure)
    let burn = SpendView.measure(hero.rate, .heroRate)
    let burnEnds = g.x0 + figure + SpendWords.NarrowHero.gapPx + burn
    #expect(burnEnds <= g.lx0 - 10, "the burn (\(hero.rate)) ends at x\(burnEnds), past x\(g.lx0 - 10)")
    // every agent of the witness's open was born before the moment (its rows' createdAt, 39 to 2,550 minutes
    // before), so the head says only what it must: no first label, and "Total by <clock>" whole (#81 · 2)
    #expect(frame.head.a.isEmpty, "the head's first label at the moment: \(frame.head.a)")
    let size = frame.head.slim ? 9.5 : 10.5
    let second = drawn(frame.head.b, size: size, em: 0.06)
    let headRoom = frame.head.width - 20
    // the spacer keeps its 8 before the second label, an empty first label or not
    #expect(8 + second <= headRoom, "the head's second label (\(frame.head.b)) takes 8 + \(second) of \(headRoom)")
    let caption = drawn(frame.colcap.text, size: 10, em: 0.07)
    let plot = g.x1 - g.x0
    #expect(caption <= plot, "the caption (\(frame.colcap.text)) takes \(caption) of the plot's \(plot)")
    let now = try #require(frame.now, "a held moment shows the Now pill")
    #expect(now.top >= frame.colcap.top + 10 + 4, "the Now pill at y\(now.top), the caption at y\(frame.colcap.top)")
    let zero = try #require(frame.yTicks.first { $0.text == "$0" }, "the money axis starts at $0")
    let chip = try #require(frame.chips.first, "now's chip")
    #expect(zero.top + 14 <= chip.top, "$0's line at y\(zero.top) runs into now's chip at y\(chip.top)")
    func points(_ value: Double) -> String { String(format: "%.1f", value) }
    print(
      "PG-CAP stage=402x781 at=moment text=\(frame.colcap.text) drawn=\(points(caption))pt plot=\(points(plot))pt"
        + " headB=\(points(second))pt headRoom=\(points(headRoom))pt")
  }
}
