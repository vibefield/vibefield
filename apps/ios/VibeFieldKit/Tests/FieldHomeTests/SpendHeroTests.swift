import Foundation
import Testing

@testable import FieldHome

// puppeteer 0.4.0 — A NARROW SPEND HERO SAYS WHO IT LEAVES OUT (#101, upstream `5a0ae86b` in `e6e4753de`):
// `spend-words.test.ts`'s two `heroCaption` rows, vector for vector, at its own 6 px a glyph (the ellipsis is one).
// H1 is "says who the hero's total leaves out: after its caption at full width, and at a narrow stage alone and in
// short"; H2 is "cuts a narrow hero's words to the room beside its number and burn: the name at a word, else how many,
// never the count". Both are red on assertions at the red's stub, which says 0.3.3's caption whole at every width;
// H1's three wide vectors and H2's last pass there by design (0.4.0 keeps the wide caption word for word).
//
// The names are written out as `spendNames` gives them upstream (`SpendName.one`), so these rows hold
// `heroCaption` alone; the names have their own rows (SpendParityTests).
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("puppeteer 0.4.0 — a narrow spend hero says who it leaves out")
struct SpendHeroTests {
  static func name(_ one: String) -> SpendWords.Name { SpendWords.Name(name: one, one: one, task: "", model: "") }

  /// `notes`, `swarm-lab`, `scratch`, and two `rosetta` rows told apart by their task's first words.
  static let names: [String: SpendWords.Name] = [
    "a": Self.name("notes"), "b": Self.name("swarm-lab"), "c": Self.name("scratch"),
    "d": Self.name("rosetta · Rebuilt the"), "e": Self.name("rosetta · Tidied the"),
  ]

  /// The room at 6 px a glyph (a UTF-16 unit, as JavaScript's `length`).
  static func room(_ width: Double) -> SpendWords.HeroRoom {
    SpendWords.HeroRoom(width: width, measure: { Double($0.utf16.count) * 6 })
  }

  static func caption(_ missing: [String], narrow: SpendWords.HeroRoom? = nil) -> String? {
    SpendWords.heroCaption(missing: missing, names: names, narrow: narrow)
  }

  /// H1 — wide and compact: what the figure is, then who it leaves out, word for word as before. Narrow: the caption
  /// goes and who it leaves out stays, one by name, several by how many in the rows' "no price"; nobody left out,
  /// nothing.
  @Test func itSaysWhoTheTotalLeavesOutWideAndNarrow() {
    let roomy = Self.room(600)
    #expect(Self.caption([]) == "since each agent started, at API prices")
    #expect(Self.caption(["b"]) == "since each agent started, at API prices · not counting swarm-lab")
    #expect(Self.caption(["b", "c"]) == "since each agent started, at API prices · not counting 2 agents with no price")
    #expect(Self.caption(["b"], narrow: roomy) == "not counting swarm-lab")
    #expect(Self.caption(["b", "c"], narrow: roomy) == "2 with no price")
    #expect(Self.caption(["a", "b", "c"], narrow: roomy) == "3 with no price")
    #expect(Self.caption([], narrow: roomy) == nil)
  }

  /// H2 — narrow, cut to the room: the name at a word while a word of it fits, else how many, whole while it fits and
  /// cut at a word where it does not, the count never cut ("N…" is the floor); a name with no words says how many.
  @Test func itCutsANarrowCaptionToTheRoomButNeverTheCount() {
    // whole, to the point: "not counting swarm-lab" is 132
    #expect(Self.caption(["b"], narrow: Self.room(132)) == "not counting swarm-lab")
    #expect(Self.caption(["d"], narrow: Self.room(190)) == "not counting rosetta · Rebuilt…")
    #expect(Self.caption(["d"], narrow: Self.room(130)) == "not counting rosetta…")
    // not one word of the name fits ("not counting…" would say nobody): how many instead
    #expect(Self.caption(["b"], narrow: Self.room(120)) == "1 with no price")
    #expect(Self.caption(["b"], narrow: Self.room(50)) == "1 with…")
    #expect(Self.caption(["b", "c"], narrow: Self.room(70)) == "2 with no…")
    // the floor: the count and its ellipsis are said even where they do not fit
    #expect(Self.caption(["a", "b", "c"], narrow: Self.room(10)) == "3…")
    #expect(Self.caption(["b"], narrow: Self.room(-40)) == "1…")
    let unnamed = SpendWords.heroCaption(missing: ["z"], names: ["z": Self.name("")], narrow: Self.room(200))
    #expect(unnamed == "1 with no price", "a name with no words names nobody")
    // wide keeps every word, however long the name
    #expect(Self.caption(["d"]) == "since each agent started, at API prices · not counting rosetta · Rebuilt the")
  }
}
