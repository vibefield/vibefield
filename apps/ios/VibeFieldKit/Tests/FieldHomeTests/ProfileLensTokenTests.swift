import CoreGraphics
import FieldDesign
import FieldHistory
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// SE-2 (UM-D27 A; DESIGN.md §8 "The phone's profile token", the drawing's `round4.css` `.ltok`, `.lmenu` and
/// `p4f-frames.js` `lensMark`, `lensMenu`) — the chosen profile stands beside search as a token of its own glass, and
/// its menu picks the lens: the measure, where it stands, when it shows, what its rows say and what it is called.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("the profile token above search, and its menu")
struct ProfileLensTokenTests {
  /// A run on the field: the home's under a profile, or a peer's (which carries none; the lens is self-only).
  static func run(
    _ id: String, profile: String?, home: Bool = true, state: PhoneSearch.LiveState = .working
  ) -> PhoneSearch.LiveSession {
    PhoneSearch.LiveSession(
      id: id, title: id, folder: nil, agent: nil, state: state, profileSet: home ? profile : nil,
      device: home ? "dev-home" : "dev-loft", deviceName: home ? "studio" : "loft", platform: "darwin", isHome: home,
      nativeSessionId: nil)
  }

  /// Eight runs: two under Native (one waiting), three under Work, one under Side, two on the loft.
  static func field() throws -> PhoneSearch.Live {
    PhoneSearch.Live(
      sessions: [
        run("n1", profile: "native", state: .blocked), run("n2", profile: "native"),
        run("w1", profile: "work"), run("w2", profile: "work"), run("w3", profile: "work", state: .idle),
        run("s1", profile: "side"),
        run("l1", profile: nil, home: false), run("l2", profile: nil, home: false),
      ],
      desks: [], profiles: try ProfileLensTests.three())
  }

  @Test("the token: 40 tall, corners 20, at most 250 wide, padded 4 and 7, its parts 2 apart")
  func theToken() {
    #expect(LensToken.height == 40)
    #expect(LensToken.radius == 20)
    #expect(LensToken.maxWidth == 250)
    #expect(LensToken.leading == 4 && LensToken.trailing == 7)
    #expect(LensToken.parts == 2)
  }

  @Test("its name is a 32 button, corners 16, padded 10 and 7, the glyph 15 and 7 on the name at 15; its × a 26 round")
  func itsNameAndItsX() {
    #expect(LensToken.nameHeight == 32 && LensToken.nameRadius == 16)
    #expect(LensToken.nameLeading == 10 && LensToken.nameTrailing == 7)
    #expect(LensToken.nameGlyph == 15 && LensToken.nameGap == 7 && LensToken.nameText == 15)
    #expect(LensToken.close == 26 && LensToken.closeGlyph == 10)
  }

  /// Its right edge on the search circle's, its foot 10 above the circle — the bar's band, 93 on this phone. Ten is
  /// inside the bar's melt (12), so the token keeps a glass container of its own.
  @Test("it stands on the circle's right edge, its foot at the band, 10 above the circle: inside the bar's melt")
  func whereItStands() {
    #expect(LensToken.right == AppBar.margin)
    #expect(LensToken.right == 21)
    #expect(LensToken.bottom(homeInset: 34) == 93)
    #expect(LensToken.bottom(homeInset: 34) == AppBar.band(homeInset: 34))
    #expect(LensToken.aboveCircle == 10)
    #expect(LensToken.bottom(homeInset: 34) - AppBar.bottomGap(homeInset: 34) - AppBar.height == LensToken.aboveCircle)
    #expect(LensToken.aboveCircle < AppBar.meltSpacing)
  }

  /// It grows out of the search circle's middle (31 in from its right edge, 10 + 31 below its foot), from 0.35.
  @Test("it grows from 0.35 out of the search circle's middle")
  func itGrowsFromTheCircle() {
    #expect(LensToken.growFrom == 0.35)
    #expect(LensToken.growOrigin == CGSize(width: -31, height: 41))
  }

  @Test("the menu: 262 wide, corners 26, its foot 8 above the token (141 up), popping from 0.55 over 380ms")
  func theMenu() {
    #expect(LensToken.menuWidth == 262 && LensToken.menuRadius == 26)
    #expect(LensToken.menuGap == 8)
    #expect(LensToken.menuBottom(homeInset: 34) == 141)
    #expect(LensToken.menuFoot == 6)
    #expect(LensToken.menuPopFrom == 0.55 && LensToken.menuPop == 0.38)
    #expect(LensToken.menuOrigin == CGSize(width: -50, height: 20))
    #expect(LensToken.checkColumn == 34 && LensToken.checkGlyph == 14)
    #expect(LensToken.everyGlyph == 19 && LensToken.profileGlyph == 18)
    // Agent Profiles…'s view lead is the Me menu's own row's circle (`AgentProfilesMenuRow`), at 26
    #expect(AgentProfilesMenuRow.size == 26)
    // Reduce Motion (M6): the token and its menu fade in over 120ms at full size
    #expect(LensToken.reducedFade == 0.12)
    #expect(LensToken.reducedFade == SearchSheet.reducedFade)
  }

  /// From the bottom, nearest first: Every profile with every session; each profile, the home's first nearest, with
  /// its sessions; a check on the one shown.
  @Test("the menu's rows: each profile with its sessions, the home's first nearest, then Every profile, a check on one")
  func menuItems() throws {
    let field = try Self.field()
    var lens = ProfileLensTests.lens(try ProfileLensTests.three())
    lens.show("work")
    let items = LensToken.items(lens, live: field)
    let labels = items.map { $0.label }
    #expect(labels == ["Side", "Work", "Native", "Every profile"])
    let words = items.map { $0.word }
    #expect(words == ["1 session", "3 sessions", "2 sessions", "8 sessions"])
    let checked = items.filter { $0.checked }.map { $0.pick }
    #expect(checked == ["work"])
    let every = try #require(items.last)
    #expect(every.pick == nil)
    #expect(every.lead == nil)
    let work = try #require(items.first { $0.pick == "work" })
    #expect(work.lead == PhoneSearch.Lead.profile(glyph: nil, native: false, filled: false))
    // This Mac is the default here (`ProfileLensTests.set`): its lead is filled (the laptop draws the same either way)
    let native = try #require(items.first { $0.pick == "native" })
    #expect(native.lead == PhoneSearch.Lead.profile(glyph: nil, native: true, filled: true))

    lens.show(nil)
    let none = LensToken.items(lens, live: field)
    let checkedNone = none.filter { $0.checked }.map { $0.label }
    #expect(checkedNone == ["Every profile"])
  }

  /// It shows on Field at rest only: never without a chosen profile, nor while the face is held, a menu or a page is
  /// open, or search is open.
  @Test("it shows on Field at rest only, while a profile is chosen")
  func showsAtRestOnly() throws {
    var lens = ProfileLensTests.lens(try ProfileLensTests.three())
    #expect(
      !LensToken.shows(lens, onField: true, searchOpen: false, faceHeld: false, menuOpen: false, pageOpen: false))
    lens.show("work")
    #expect(LensToken.shows(lens, onField: true, searchOpen: false, faceHeld: false, menuOpen: false, pageOpen: false))
    #expect(
      !LensToken.shows(lens, onField: false, searchOpen: false, faceHeld: false, menuOpen: false, pageOpen: false))
    #expect(!LensToken.shows(lens, onField: true, searchOpen: true, faceHeld: false, menuOpen: false, pageOpen: false))
    #expect(!LensToken.shows(lens, onField: true, searchOpen: false, faceHeld: true, menuOpen: false, pageOpen: false))
    #expect(!LensToken.shows(lens, onField: true, searchOpen: false, faceHeld: false, menuOpen: true, pageOpen: false))
    #expect(!LensToken.shows(lens, onField: true, searchOpen: false, faceHeld: false, menuOpen: false, pageOpen: true))
    // with one profile no lens can be chosen, so no token stands (UM-D12)
    var one = ProfileLensTests.lens([try ProfileLensTests.set("native", kind: "native")])
    one.show("native")
    #expect(!LensToken.shows(one, onField: true, searchOpen: false, faceHeld: false, menuOpen: false, pageOpen: false))
  }

  @Test("its words: \"Showing only Work\", its × \"Show every profile\", Show, Every profile, Agent Profiles…")
  func itsWords() throws {
    let work = try ProfileLensTests.set("work")
    #expect(LensToken.spoken(work) == "Showing only Work")
    #expect(LensToken.clearWords == "Show every profile")
    #expect(LensToken.eyebrow == "Show")
    #expect(LensToken.everyWord == "Every profile")
    #expect(LensToken.pageWord == "Agent Profiles…")
  }

  /// UM-5b (§8 "A plan chosen", ‹for James›) — the token also stands for a plan, for everyone, with one profile too:
  /// the plan's agent's mark and title, its name opens the page where **Showing** stands, and its × clears the plan
  /// alone. With a lens and a plan both it names the plan, and the × brings back the profile's form.
  @Test("a plan's form: its mark and title, the name opens the page, the × clears only the plan")
  func planForm() throws {
    let options = MetersOptions(catalog: MeterCatalog(rows: []))
    var lens = ProfileLensTests.lens(try ProfileLensTests.planned())
    lens.show("work")
    let profileForm = try #require(LensToken.form(lens, options: options))
    // `planned()`'s sets carry no label, so a profile is called by its id (`AgentProfileSet.label`)
    #expect(profileForm.spoken == "Showing only work")
    #expect(profileForm.clearWords == "Show every profile")
    #expect(profileForm.nameOpens == .menu)
    #expect(profileForm.clears == .profile)

    lens.showPlan("work/plan:openai")
    let chosen = lens.chosenPlan(options: options)
    let choice = try #require(chosen)
    let planForm = try #require(LensToken.form(lens, options: options))
    #expect(planForm.lead == .agent("codex"))
    #expect(planForm.label == choice.label)
    #expect(planForm.spoken == "Showing only \(choice.label)")
    #expect(planForm.clearWords == "Show every plan")
    #expect(planForm.nameOpens == .page)
    #expect(planForm.clears == .plan)

    // the × takes the plan and leaves the lens: the profile's form again
    lens.showPlan(nil)
    let back = try #require(LensToken.form(lens, options: options))
    #expect(back.clears == .profile)
    #expect(lens.profile == "work")

    var none = ProfileLensTests.lens(try ProfileLensTests.planned())
    none.show(nil)
    #expect(LensToken.form(none, options: options) == nil)
  }

  @Test("a plan's token stands with one profile too, where no lens can")
  func planShowsWithOneProfile() throws {
    let planned = try ProfileLensTests.planned()
    var lens = ProfileLensTests.lens(planned.filter { $0.id == "work" })
    lens.show("work")
    #expect(!LensToken.shows(lens, onField: true, searchOpen: false, faceHeld: false, menuOpen: false, pageOpen: false))
    lens.showPlan("work/plan:openai")
    #expect(LensToken.shows(lens, onField: true, searchOpen: false, faceHeld: false, menuOpen: false, pageOpen: false))
    #expect(!LensToken.shows(lens, onField: true, searchOpen: true, faceHeld: false, menuOpen: false, pageOpen: false))
  }

  /// SE-P5b (§8 "The phone's profile token": **Agent Profiles…**, its glyph a Bands circle at 26 of every plan) — the
  /// token's menu leads its page row with the Me menu's own row (UM-D25 A, `AgentProfilesMenuRow`): one value, so the
  /// two menus draw one circle. Its act folding the menu and opening the page is HomeScreen's wiring, which no row
  /// reaches: the build and the stills witness it.
  @MainActor
  @Test("Agent Profiles… leads with the Me menu's circle: 26 across, every plan, nothing in its middle")
  func pageRowIsTheMeMenus() throws {
    let reading = try AgentProfilesPageTests.reading()
    let now = AgentProfilesPageTests.now
    let row = AgentProfilesMenuRow(reading: reading, now: now, open: {})
    let size = row.geometry.size
    #expect(size == AgentProfilesMenuRow.size)
    let middle = row.geometry.centre.items
    #expect(middle.isEmpty)
    let every = reading.meters(of: nil, now: now)
    let drawn = BandsLayout.geometry(AgentProfilesMenuRow.size, every.entries, .menuRow(every: true))
    #expect(row.geometry == drawn)
  }

  /// SE-P5b (ruling 20; the S2 review's finding 10) — search's leads (a chip, a token, an offer, a pill, the token's
  /// menu) draw a profile through the phone's ONE glyph table, as the bloom's buds do (`SpawnBloomOverlay.symbol`):
  /// This Mac the laptop, a token the vocabulary's symbol — outlined, and filled for the default profile (DESIGN.md §8,
  /// the M-phone review's m2) — and one this build does not draw, or none, the star (puppeteer's `profileMarkName`),
  /// never a person. `SearchLeadGlyph` is a view, so the row runs on the main actor.
  @MainActor
  @Test("search's leads draw a profile through the one glyph table: the laptop, the vocabulary's symbol, else the star")
  func leadsDrawTheOneTable() {
    let tokens: [String?] = ProfileGlyphSymbols.symbols.keys.sorted().map { Optional($0) } + [nil, "no-such-glyph"]
    for token in tokens {
      for filled in [false, true] {
        let drawn = SearchLeadGlyph.profileSymbol(glyph: token, native: false, filled: filled)
        let table = ProfileGlyphSymbols.symbol(glyph: token, native: false, filled: filled)
        let name = "\(token ?? "no glyph")\(filled ? ", filled" : "")"
        #expect(drawn == table, "\(name)")
      }
    }
    let native = SearchLeadGlyph.profileSymbol(glyph: "briefcase", native: true, filled: true)
    #expect(native == ProfileGlyphSymbols.laptop)
  }
}
