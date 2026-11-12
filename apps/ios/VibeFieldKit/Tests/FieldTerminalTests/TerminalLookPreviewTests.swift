import Foundation
import GhostteaAppearance
import Testing

@testable import FieldTerminal

/// Item 358 (James, 2026-11-12 17:50:31Z, of the phone's Settings › Terminal: "it is missing the preview window") —
/// the preview as values: the theme's colours as the picture uses them, a run's ink and ground, the sample, and the
/// caption's words. The picture itself, and whether it reads as the desktop's preview does, are James's to see.
@Suite("item 358 — Settings › Terminal's preview, as values")
struct TerminalLookPreviewTests {
  private typealias Model = TerminalLookPreviewModel

  private static let palette = (0..<16).map { String(format: "#%02x%02x%02x", $0, $0 * 2, $0 * 3) }

  private static func inks(background: String = "#101820", foreground: String = "#e0e0e0", palette: [String]? = nil)
    -> Model.Inks
  {
    Model.inks(
      background: background, foreground: foreground, cursor: "#ffcc00", cursorText: "#000000", selection: "#333333",
      selectionForeground: "#ffffff", palette: palette ?? Self.palette)
  }

  @Test("the picture's inks are the theme's own bytes")
  func theThemesOwn() {
    let inks = Self.inks()
    #expect(inks.ground == [0x10, 0x18, 0x20])
    #expect(inks.foreground == [0xE0, 0xE0, 0xE0])
    #expect(inks.cursor == [0xFF, 0xCC, 0x00] && inks.cursorText == [0, 0, 0])
    #expect(inks.selection == [0x33, 0x33, 0x33] && inks.selectionForeground == [0xFF, 0xFF, 0xFF])
    #expect(inks.palette.count == 16)
    #expect(inks.slot(2) == [2, 4, 6] && inks.slot(15) == [15, 30, 45])
  }

  @Test("a value the catalog's format does not bless falls back to the neutral pair, never to an invented colour")
  func fallbacks() {
    let inks = Model.inks(
      background: "black", foreground: "#fff", cursor: "", cursorText: "nope", selection: "#12345",
      selectionForeground: "", palette: ["#010203", "red"])
    #expect(inks.ground == Model.neutralGround && inks.foreground == Model.neutralText)
    #expect(inks.cursor == Model.neutralText && inks.cursorText == Model.neutralGround)
    #expect(inks.selection == Model.neutralText && inks.selectionForeground == Model.neutralGround)
    #expect(inks.palette == [[1, 2, 3], Model.neutralText])
    #expect(inks.slot(9) == Model.neutralText, "a slot the theme does not carry is its foreground")
    #expect(inks.slot(-1) == Model.neutralText)
  }

  @Test("the terminal's theme is the one drawn, and a name the catalog does not hold draws the neutral pair")
  func theThemeInUse() throws {
    let matte = try #require(GhostteaThemeCatalog.themes.first { $0.name == "Matte Black" })
    let inks = Model.inks(for: .default)
    #expect(inks.ground == parseHexColor(matte.background))
    #expect(inks.foreground == parseHexColor(matte.foreground))
    #expect(inks.palette.count == matte.palette.count)
    var unknown = TerminalAppearance.default
    unknown.themeName = "No Such Theme"
    let neutral = Model.inks(for: unknown)
    #expect(neutral.ground == Model.neutralGround && neutral.foreground == Model.neutralText)
    #expect(neutral.palette.isEmpty)
  }

  @Test("a run's colours: its slot on the ground, its slot on a slot, the selection's pair, the cursor's pair")
  func aRunsColours() {
    let inks = Self.inks()
    let plain = Model.colours(of: Model.Run("pnpm verify"), in: inks)
    #expect(plain.ink == inks.foreground && plain.ground == nil)
    let prompt = Model.colours(of: Model.Run("❯ ", fg: 2), in: inks)
    #expect(prompt.ink == [2, 4, 6] && prompt.ground == nil)
    let badge = Model.colours(of: Model.Run(" PASS ", fg: 0, bg: 2, bold: true), in: inks)
    #expect(badge.ink == [0, 0, 0] && badge.ground == [2, 4, 6])
    let selected = Model.colours(of: Model.Run("0e321805", fg: 3, selected: true), in: inks)
    #expect(selected.ink == inks.selectionForeground && selected.ground == inks.selection, "the selection outranks a slot")
    let cursor = Model.colours(of: Model.Run(" ", cursor: true), in: inks)
    #expect(cursor.ink == inks.cursorText && cursor.ground == inks.cursor)
  }

  @Test("the sample is the desktop preview's shell: ten lines, palette slots a theme has, the cursor last")
  func theSample() {
    #expect(Model.sample.count == 10)
    let runs = Model.sample.flatMap { $0 }
    #expect(runs.allSatisfy { ($0.fg ?? 0) >= 0 && ($0.fg ?? 0) < 16 && ($0.bg ?? 0) >= 0 && ($0.bg ?? 0) < 16 })
    #expect(runs.filter(\.cursor).count == 1)
    #expect(Model.sample.last?.last?.cursor == true)
    #expect(runs.contains { $0.selected })
    #expect(Model.sample.first?.first?.text == "~/Projects/vibe-field")
  }

  @Test("the caption names the theme and the size, and says what the picture is not")
  func theCaption() throws {
    var appearance = TerminalAppearance.default
    appearance.fontSize = 15
    let plain = Model.caption(appearance)
    #expect(plain.theme == "Matte Black" && plain.size == "15 pt" && plain.note == "Sample text")
    let shader = try #require(GhostteaShaderOption.available.first)
    appearance.shaderEffects = [shader.id]
    #expect(Model.caption(appearance).note == "Sample text · effects not drawn")
    appearance.shaderEffects = ["ghosttea:no-such-effect"]
    #expect(Model.caption(appearance).note == "Sample text", "an effect the renderer would drop is not claimed")
    appearance.fontSize = .nan
    #expect(Model.caption(appearance).size == "13 pt", "read through the clamp")
  }

  @Test("the picture is said as one sentence: the theme, the size, the opacity, and that the text is a sample")
  func spoken() {
    var appearance = TerminalAppearance.default
    appearance.backgroundOpacity = 0.55
    #expect(
      Model.spoken(appearance)
        == "Preview of the terminal’s look. Matte Black, 13 points, background 55%. The text is a sample.")
  }
}
