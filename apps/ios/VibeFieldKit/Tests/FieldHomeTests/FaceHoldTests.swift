import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// UM-4 (UM-D24 A; DESIGN.md §8 "The phone's corner": "Hold it", "With several", "The reach", "The words follow the
/// reach", "VoiceOver") — the held face, pure: where the profiles bloom about the face, what a finger reaches, what
/// the huge words and the mono line say, each bud's label and where it stands, what VoiceOver offers in place of the
/// hold, and the `-vf-mock-hold` door. The home is the meters fixture's over the budget batch, read at its stamp
/// (`AgentProfilesPageTests.reading`). Letting go is the lens's (`ProfileLensTests`). Since the U3 review: how the
/// held face stands and closes (a let-go, or a hold the system takes away), and the words for a home whose usage is
/// not read.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("the held face: where the profiles bloom, what a finger reaches, and what is said")
@MainActor
struct FaceHoldTests {
  static let face = CGPoint(x: 40, y: 800)
  static let now = MetersFixtureDoor.now

  @Test("the first four buds stand at −92°, −70°, −48° and −26°, 160 out; five to eight at 224, half a step on")
  func spots() throws {
    let spots = FaceHold.spots(10, face: Self.face)
    let angles = spots.map(\.angle)
    #expect(angles == [-92, -70, -48, -26, -81, -59, -37, -15])
    let radii = spots.map(\.r)
    #expect(radii == [160, 160, 160, 160, 224, 224, 224, 224])
    let first = try #require(spots.first)
    let a = -92 * Double.pi / 180
    #expect(abs(first.x - (40 + 160 * cos(a))) < 1e-9)
    #expect(abs(first.y - (800 + 160 * sin(a))) < 1e-9)
  }

  @Test("the reach: the hub within 30 of the face, the nearest bud within 58, the hub within 52, else open ground")
  func reach() throws {
    let ids = ["native", "work", "side"]
    let face = Self.face
    let spots = FaceHold.spots(3, face: face)
    let work = try #require(spots.dropFirst().first)
    #expect(FaceHold.reach(CGPoint(x: face.x + 20, y: face.y), face: face, profiles: ids) == .hub)
    #expect(FaceHold.reach(CGPoint(x: work.x, y: work.y - 10), face: face, profiles: ids) == .bud("work"))
    #expect(FaceHold.reach(CGPoint(x: face.x, y: face.y + 45), face: face, profiles: ids) == .hub)
    #expect(FaceHold.reach(CGPoint(x: face.x, y: face.y + 100), face: face, profiles: ids) == .open)
  }

  @Test("the words follow the reach: Usage with one profile; Show all, Show ‹profile› and Cancel with several")
  func words() throws {
    var one = try AgentProfilesPageTests.reading()
    one.sets = one.sets.filter { $0.kind == "native" }
    let usage = FaceHold.words(one, reach: .hub, home: "studio", now: Self.now)
    #expect(usage == FaceHold.Words(verb: nil, rest: "Usage", line: "3 read · none need you"))
    let several = try AgentProfilesPageTests.reading()
    let all = FaceHold.words(several, reach: .hub, home: "studio", now: Self.now)
    #expect(all.verb == "Show")
    #expect(all.rest == "all")
    #expect(all.line.hasSuffix(" · every profile"))
    let work = FaceHold.words(several, reach: .bud("work"), home: "studio", now: Self.now)
    #expect(work == FaceHold.Words(verb: "Show", rest: "Work", line: "1 read · 2 need you"))
    let open = FaceHold.words(several, reach: .open, home: "studio", now: Self.now)
    #expect(open == FaceHold.Words(verb: nil, rest: "Cancel", line: "let go here to leave the field as it is"))
  }

  @Test("one need is said as one: Show Side over \"0 read · 1 needs you\" (§9 \"The phone's hold\")")
  func oneNeed() throws {
    let reading = try AgentProfilesPageTests.reading()
    let side = FaceHold.words(reading, reach: .bud("side"), home: "studio", now: Self.now)
    #expect(side == FaceHold.Words(verb: "Show", rest: "Side", line: "0 read · 1 needs you"))
  }

  @Test("the hold says the home's usage as it stands — not shared, unavailable, a first read — never none need you")
  func wordsSayTheHome() throws {
    let refused = try AgentProfilesPageTests.reading(.notShared)
    let all = FaceHold.words(refused, reach: .hub, home: "studio", now: Self.now)
    #expect(all == FaceHold.Words(verb: "Show", rest: "all", line: "studio doesn't share usage yet"))
    let work = FaceHold.words(refused, reach: .bud("work"), home: "studio", now: Self.now)
    #expect(work == FaceHold.Words(verb: "Show", rest: "Work", line: "studio doesn't share usage yet"))
    let cancel = FaceHold.words(refused, reach: .open, home: "studio", now: Self.now)
    #expect(cancel == FaceHold.Words(verb: nil, rest: "Cancel", line: "let go here to leave the field as it is"))
    var alone = try AgentProfilesPageTests.reading(.unavailable)
    alone.sets = alone.sets.filter { $0.kind == "native" }
    let down = FaceHold.words(alone, reach: .hub, home: "studio", now: Self.now)
    #expect(down == FaceHold.Words(verb: nil, rest: "Usage", line: "Usage unavailable"))
    let raw = try #require(MetersFixtureDoor.fixture("agent-usage.empty"))
    let empty = try AgentAccountUsageBatch(json: raw)
    let first = try AgentProfilesPageTests.reading(.batch(empty))
    let reading = FaceHold.words(first, reach: .hub, home: "studio", now: Self.now)
    #expect(reading == FaceHold.Words(verb: "Show", rest: "all", line: "Reading usage…"))
  }

  @Test("a bud's label: its name over its tightest percent and window, READING, or NO METER — hot when it runs hot")
  func budLabels() throws {
    let reading = try AgentProfilesPageTests.reading()
    let labels = reading.profiles.map { FaceHold.budLabel($0, reading: reading, now: Self.now) }
    let names = labels.map(\.name)
    #expect(names == ["This Mac", "Work", "Side"])
    let work = try #require(labels.dropFirst().first)
    #expect(work.state.hasPrefix("64% · "))
    #expect(work.hot)
    let side = try #require(labels.last)
    #expect(side.state == "READING")
    #expect(!side.hot)
  }

  @Test("a bud's label stands outside it along its spoke: 160 + 33 + half × |cos a| + 12 × |sin a|, 38 reached")
  func labelRadius() throws {
    let spot = try #require(FaceHold.spots(1, face: Self.face).first)
    let a = -92 * Double.pi / 180
    let expected = 160 + 33 + 20 * abs(cos(a)) + 12 * abs(sin(a))
    #expect(abs(FaceHold.labelRadius(spot, letters: 4, reached: false) - expected) < 1e-9)
    #expect(abs(FaceHold.labelRadius(spot, letters: 4, reached: true) - (expected + 5)) < 1e-9)
    let long = FaceHold.labelRadius(spot, letters: 12, reached: false)
    #expect(abs(long - (160 + 33 + 34.2 * abs(cos(a)) + 12 * abs(sin(a)))) < 1e-9)
  }

  @Test("a bud says a model's own week by its group's word, \"104% · FABLE\", never the raw \"FABLE ONLY\"")
  func budGroupWord() throws {
    #expect(UsageLine.Group(id: "scope:fable", label: "Fable only").word == "Fable")
    #expect(UsageLine.Group(id: "scope:opus", label: "Opus").word == "Opus")
    var reading = MetersReading()
    reading.sets = try AgentProfileSetsResult(json: try HomeFixture.json("agents-profile-sets.valid")).sets
    reading.catalog = try AgentCatalogResult(json: try HomeFixture.json("agent-catalog.valid")).catalog
    let raw = Self.used(try HomeFixture.json("agent-usage.valid"), metric: "fable", 104)
    reading.usage = .batch(try AgentAccountUsageBatch(json: raw))
    let now = try #require(ISO8601DateFormatter().date(from: "2026-09-13T12:05:00Z"))
    let native = try #require(reading.profiles.first { $0.kind == "native" })
    let label = FaceHold.budLabel(native, reading: reading, now: now)
    #expect(label.state == "104% · FABLE")
    #expect(label.hot)
  }

  /// `json` with every metric `id`'s `usedPercent` set to `used`: a model's own week past its limit, so it is the
  /// tightest.
  static func used(_ json: JSONValue, metric id: String, _ used: Double) -> JSONValue {
    switch json {
    case .object(var fields):
      if fields["id"] == .string(id), fields["usedPercent"] != nil { fields["usedPercent"] = .double(used) }
      return .object(fields.mapValues { Self.used($0, metric: id, used) })
    case .array(let items):
      return .array(items.map { Self.used($0, metric: id, used) })
    default:
      return json
    }
  }

  @Test("with one profile no bud is drawn, so the finger reaches only the hub: no tick on nothing")
  func oneProfileReachesTheHub() throws {
    let face = Self.face
    let spot = try #require(FaceHold.spots(1, face: face).first)
    let onTheBud = FaceHold.reach(CGPoint(x: spot.x, y: spot.y), face: face, profiles: ["native"])
    #expect(onTheBud == .hub)
    let away = FaceHold.reach(CGPoint(x: face.x, y: face.y + 100), face: face, profiles: ["native"])
    #expect(away == .hub)
  }

  @Test("a hold the system takes away closes the held face and lets nothing go; a let-go releases its reach once")
  func cancelled() throws {
    let face = Self.face
    let ids = ["native", "work", "side"]
    let work = try #require(FaceHold.spots(3, face: face).dropFirst().first)
    let onWork = CGPoint(x: work.x, y: work.y)
    var stand = FaceHold.Stand()
    stand.open(face: face)
    #expect(stand.held == FaceHold.Held(face: face, reach: .hub))
    stand.move(onWork, profiles: ids)
    #expect(stand.held?.reach == .bud("work"))
    stand.cancel()
    #expect(stand.held == nil)
    let afterCancel = stand.letGo()
    #expect(afterCancel == nil)
    stand.open(face: face)
    stand.move(onWork, profiles: ids)
    let released = stand.letGo()
    #expect(released == .bud("work"))
    #expect(stand.held == nil)
    let again = stand.letGo()
    #expect(again == nil)
  }

  @Test("VoiceOver: the face says the hold, and offers the page, each profile and every profile — the first alone")
  func voiceOver() throws {
    #expect(FaceHold.faceLabel("James") == "James: account. Hold for your agents' usage.")
    #expect(FaceHold.faceLabel("") == "Account. Hold for your agents' usage.")
    let reading = try AgentProfilesPageTests.reading()
    let actions = FaceHold.actions(reading.profiles)
    let names = actions.map(\.name)
    #expect(names == ["Show your agents' usage", "Show This Mac", "Show Work", "Show Side", "Show every profile"])
    let acts = actions.map(\.act)
    #expect(acts == [.page, .show("native"), .show("work"), .show("side"), .showAll])
    let one = FaceHold.actions(reading.profiles.filter { $0.kind == "native" }).map(\.name)
    #expect(one == ["Show your agents' usage"])
  }

  @Test("the -vf-mock-hold door: the hub, a profile, or open ground; nothing without it")
  func mockDoor() {
    #expect(FaceHold.mockReach(["-vf-mock"]) == nil)
    #expect(FaceHold.mockReach(["-vf-mock", "-vf-mock-hold"]) == .hub)
    #expect(FaceHold.mockReach(["-vf-mock-hold=hub"]) == .hub)
    #expect(FaceHold.mockReach(["-vf-mock-hold=work"]) == .bud("work"))
    #expect(FaceHold.mockReach(["-vf-mock-hold=cancel"]) == .open)
  }
}
