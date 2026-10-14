import Foundation
import Testing

@testable import FieldSwarm

/// PJ-7 — the bloom on the phone (Q4 (a), SB §2.12): what a hold opens, what
/// the finger points at, what letting go chooses for the LAUNCH SHEET, the
/// words, and the haptics' moments. Over the transcribed geometry.
@Suite struct SpawnBloomTests {
  private let measure: BloomMeasure = { text, font in Double(text.utf16.count) * (font == .label ? 9.5 : 7.5) * 0.6 }
  private let field = BloomSize(w: 402, h: 874)
  private let chrome = [BloomRect(x: 0, y: 781, width: 402, height: 93)]
  private let P = BloomPoint(x: 201, y: 437)

  private let profiles = [
    BloomProfile(id: "native", label: "Default", isDefault: false),
    BloomProfile(id: "work", label: "Work", isDefault: true),
  ]
  private var desktops: [BloomDesktop] {
    [
      BloomDesktop(id: "laptop", name: "laptop", platform: "win32", asleep: false, sub: "IDLE", profiles: []),
      BloomDesktop(id: "studio", name: "studio", platform: "darwin", asleep: false, sub: "2 RUNNING", profiles: profiles),
      BloomDesktop(id: "box", name: "box", platform: "linux", asleep: true, sub: "ASLEEP · 2 H", profiles: profiles),
    ]
  }

  private func at(_ bloom: SpawnBloom, one i: Int, r: Double = BloomConstants.r1) -> BloomPoint {
    BloomGeometry.polar(bloom.P.x, bloom.P.y, r, bloom.one.items[i].a)
  }

  @Test func onlyRealChoicesBloom() {
    #expect(!SpawnBloom.blooms([]))
    #expect(!SpawnBloom.blooms([BloomDesktop(id: "a", name: "a", platform: nil, asleep: false, sub: "", profiles: [profiles[0]])]))
    #expect(SpawnBloom.blooms([BloomDesktop(id: "a", name: "a", platform: nil, asleep: false, sub: "", profiles: profiles)]))
    #expect(!SpawnBloom.blooms([BloomDesktop(id: "a", name: "a", platform: nil, asleep: true, sub: "", profiles: profiles)]))
    #expect(SpawnBloom.blooms(desktops))
    #expect(
      SpawnBloom(at: P, desktops: Array(desktops.prefix(1)), home: "laptop", field: field, chrome: chrome, measure: measure)
        == nil)
  }

  @Test func theHubIsTheHomeAndTheHomeLeadsTheRing() throws {
    let bloom = try #require(
      SpawnBloom(at: P, desktops: desktops, home: "studio", field: field, chrome: chrome, measure: measure))
    #expect(bloom.mode == .desktops)
    #expect(bloom.desktops.map(\.id) == ["studio", "laptop", "box"])
    #expect(bloom.one.items.count == 3)
    #expect(bloom.one.theta == -90, "it opens upward at the field's middle")
    #expect(bloom.target == .hub)
    #expect(bloom.release() == BloomChoice(desktop: "studio", profile: nil))
    #expect(bloom.words.noun == "studio" && bloom.words.verb == "New agent on ")
  }

  @Test func aDesktopReachedIsChosenWithAnOnlyTickForANewTarget() throws {
    var bloom = try #require(
      SpawnBloom(at: P, desktops: desktops, home: "studio", field: field, chrome: chrome, measure: measure))
    #expect(bloom.point(at(bloom, one: 1), now: 0) == .tick)
    #expect(bloom.point(at(bloom, one: 1, r: BloomConstants.r1 + 4), now: 10) == nil, "the same target: no tick")
    #expect(bloom.release() == BloomChoice(desktop: "laptop", profile: nil))
    #expect(bloom.open == nil, "a desktop with no profiles read is a leaf")
    #expect(bloom.words.detail == "ITS DEFAULT PROFILE · THEN WHERE, MODEL, EFFORT")
  }

  @Test func aSleepingDesktopOpensNothingAndSaysSo() throws {
    var bloom = try #require(
      SpawnBloom(at: P, desktops: desktops, home: "studio", field: field, chrome: chrome, measure: measure))
    _ = bloom.point(at(bloom, one: 2), now: 0)
    #expect(bloom.open == nil, "a sleeping desktop never opens its profiles")
    #expect(bloom.release() == nil)
    #expect(bloom.words.nounFirst && bloom.words.noun == "box" && bloom.words.verb == " is asleep")
    #expect(bloom.words.cancels)
  }

  @Test func reachingADesktopOpensItsProfilesAndLettingGoOnOneChoosesIt() throws {
    var bloom = try #require(
      SpawnBloom(at: P, desktops: desktops, home: "studio", field: field, chrome: chrome, measure: measure))
    _ = bloom.point(at(bloom, one: 0), now: 0)
    #expect(bloom.open == 0)
    let two = try #require(bloom.two)
    #expect(two.items.count == 2)
    // the new ring ignores the hand for its settle window
    let work = BloomGeometry.polar(bloom.one.items[0].x, bloom.one.items[0].y, BloomConstants.r2, two.items[1].a)
    _ = bloom.point(work, now: 50)
    #expect(bloom.target == .ring1(index: 0, d: nil))
    #expect(bloom.point(work, now: 200) == .tick)
    #expect(bloom.target == .ring2(index: 1))
    #expect(bloom.release() == BloomChoice(desktop: "studio", profile: "work"))
    #expect(bloom.words.verb == "New agent as " && bloom.words.noun == "Work")
    #expect(bloom.words.detail == "ON STUDIO · THEN WHERE, MODEL, EFFORT")
    // back inside the ring closes it again
    _ = bloom.point(BloomPoint(x: P.x, y: P.y - 20), now: 300)
    #expect(bloom.open == nil && bloom.two == nil)
    #expect(bloom.target == .hub)
  }

  @Test func openGroundCancels() throws {
    var bloom = try #require(
      SpawnBloom(at: P, desktops: desktops, home: "studio", field: field, chrome: chrome, measure: measure))
    #expect(bloom.point(BloomPoint(x: P.x, y: P.y + 150), now: 0) == nil)
    #expect(bloom.target == .none)
    #expect(bloom.release() == nil)
    #expect(bloom.words.noun == "Cancel" && bloom.words.cancels)
  }

  @Test func oneDesktopBloomsItsProfilesAtOnce() throws {
    let only = [desktops[1]]
    var bloom = try #require(
      SpawnBloom(at: P, desktops: only, home: "studio", field: field, chrome: chrome, measure: measure))
    #expect(bloom.mode == .profiles)
    #expect(bloom.one.items.count == 2)
    _ = bloom.point(at(bloom, one: 0), now: 0)
    #expect(bloom.release() == BloomChoice(desktop: "studio", profile: "native"))
    #expect(bloom.words.noun == "Default")
  }
}
