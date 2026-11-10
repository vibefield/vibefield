import FieldAgents
import FieldProduct
import FieldSwarm
import Foundation
import SwiftUI
import Testing

@testable import FieldHome

// PG-7 — THE SPEND VIEW IN THE KIT (kit-only: SwarmTheme and the swarm's sprites are UIKit's, so the host loop leaves
// this file out): its inks against the swarm's resolved theme and the stage's skin (K2), and the view itself on the
// phone's stage over the witness (K3). An extension of the one suite, so `-only-testing` by its name takes both.
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
}
