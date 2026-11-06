import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// UM-4's seam (UM-D24, UM-D26, UM-D27 A; SE-D2 A) — the phone's ONE lens: the held face's let-go, the Agent Profiles
/// page's Profiles rows, the token's menu and its ×, and search's desktop token all set this one value. It keys on the
/// home's profiles; with one profile nothing names a profile (UM-D12).
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("the phone's one lens: set, clear, the hold's let-go and the page's pick")
struct ProfileLensTests {
  /// A home profile as `agents.profileSets.list` names it (its personas are the meters', not the lens's).
  static func set(_ id: String, kind: String = "managed") throws -> AgentProfileSet {
    try AgentProfileSet(
      json: .object([
        "id": .string(id), "kind": .string(kind), "label": .string(id.capitalized), "default": .bool(kind == "native"),
        "personas": .array([]),
      ]))
  }

  /// The home's three: This Mac, Work and Side.
  static func three() throws -> [AgentProfileSet] {
    [try set("native", kind: "native"), try set("work"), try set("side")]
  }

  static func lens(_ sets: [AgentProfileSet]) -> ProfileLens {
    var lens = ProfileLens()
    lens.adopt(sets)
    return lens
  }

  @Test("set: a profile the home holds is chosen, and the lens says which")
  func setShows() throws {
    var lens = Self.lens(try Self.three())
    #expect(lens.offersProfiles)
    lens.show("work")
    #expect(lens.profile == "work")
    let chosen = lens.chosen?.id
    #expect(chosen == "work")
  }

  @Test("clear: every profile again — the token's ×, the menu's Every profile, the page's All profiles")
  func clearShowsEvery() throws {
    var lens = Self.lens(try Self.three())
    lens.show("side")
    #expect(lens.profile == "side")
    lens.show(nil)
    #expect(lens.profile == nil)
    #expect(lens.chosen == nil)
  }

  @Test("a profile the home does not hold changes nothing")
  func unknownProfile() throws {
    var lens = Self.lens(try Self.three())
    lens.show("work")
    lens.show("elsewhere")
    #expect(lens.profile == "work")
  }

  @Test("the hold's let-go: the hub shows every profile, a bud that profile, open ground leaves the field as it is")
  func letGo() throws {
    var lens = Self.lens(try Self.three())
    lens.letGo(.bud("side"))
    #expect(lens.profile == "side")
    lens.letGo(.open)
    #expect(lens.profile == "side")
    lens.letGo(.hub)
    #expect(lens.profile == nil)
    lens.letGo(.bud("work"))
    #expect(lens.profile == "work")
  }

  @Test("the page's pick: a profile row chooses it and the page stays; All profiles shows every profile")
  func pagePick() throws {
    var lens = Self.lens(try Self.three())
    lens.show("native")
    #expect(lens.profile == "native")
    let chosen = lens.chosen?.kind
    #expect(chosen == "native")
    lens.show(nil)
    #expect(lens.profile == nil)
  }

  @Test("with one profile nothing names a profile: no pick, no let-go chooses one (UM-D12)")
  func oneProfile() throws {
    var lens = Self.lens([try Self.set("native", kind: "native")])
    #expect(!lens.offersProfiles)
    lens.show("native")
    #expect(lens.profile == nil)
    lens.letGo(.bud("native"))
    #expect(lens.profile == nil)
    let held = lens.profiles.map(\.id)
    #expect(held == ["native"])
  }

  @Test("the home's profiles read again: a chosen profile the home lost, or a home down to one, lets the lens go")
  func adoptLetsGo() throws {
    let three = try Self.three()
    var lens = Self.lens(three)
    lens.show("side")
    lens.adopt(three.filter { $0.id != "side" })
    #expect(lens.profile == nil)
    lens.show("work")
    lens.adopt(three.filter { $0.id == "work" })
    #expect(lens.profile == nil)
    lens.adopt(three)
    lens.show("work")
    lens.adopt(three)
    #expect(lens.profile == "work")
  }

  @Test("search's desktop: kept to one, and cleared when search closes while the profile outlives it (ruling 21)")
  func deskClearsOnClose() throws {
    var lens = Self.lens(try Self.three())
    lens.show("work")
    lens.keep(desk: "dev-2")
    #expect(lens.desk == "dev-2")
    lens.searchClosed()
    #expect(lens.desk == nil)
    #expect(lens.profile == "work")
    lens.keep(desk: "dev-1")
    lens.keep(desk: nil)
    #expect(lens.desk == nil)
  }
}
