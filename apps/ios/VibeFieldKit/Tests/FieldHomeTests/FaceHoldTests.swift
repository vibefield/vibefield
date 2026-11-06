import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// UM-4 (UM-D24 A; DESIGN.md §8 "The phone's corner": "Hold it", "With several", "The reach", "The words follow the
/// reach", "VoiceOver") — the held face, pure: where the profiles bloom about the face, what a finger reaches, what
/// the huge words and the mono line say, each bud's label and where it stands, what VoiceOver offers in place of the
/// hold, and the `-vf-mock-hold` door. The home is the meters fixture's over the budget batch, read at its stamp
/// (`AgentProfilesPageTests.reading`). Letting go is the lens's (`ProfileLensTests`).
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
    let usage = FaceHold.words(one, reach: .hub, now: Self.now)
    #expect(usage == FaceHold.Words(verb: nil, rest: "Usage", line: "3 read · none need you"))
    let several = try AgentProfilesPageTests.reading()
    let all = FaceHold.words(several, reach: .hub, now: Self.now)
    #expect(all.verb == "Show")
    #expect(all.rest == "all")
    #expect(all.line.hasSuffix(" · every profile"))
    let work = FaceHold.words(several, reach: .bud("work"), now: Self.now)
    #expect(work == FaceHold.Words(verb: "Show", rest: "Work", line: "1 read · 2 need you"))
    let open = FaceHold.words(several, reach: .open, now: Self.now)
    #expect(open == FaceHold.Words(verb: nil, rest: "Cancel", line: "let go here to leave the field as it is"))
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
