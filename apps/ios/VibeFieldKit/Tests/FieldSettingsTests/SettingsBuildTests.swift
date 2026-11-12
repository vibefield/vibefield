import FieldDesign
import Testing

@testable import FieldSettings

/// RB-1 — the review-build switch (DESIGN.md §8 "The phone's Settings", amended 2026-11-12; §9 "Notifications, before
/// push"): which builds draw Notifications, where it stands under This phone, and its words.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("Notifications stands in TestFlight and development builds, never in the review build")
struct SettingsBuildTests {
  private let builds: [SettingsBuild] = [.review, .testFlight, .development]

  @Test("a test build is a development build")
  func current() {
    let build = SettingsBuild.current
    #expect(build == .development)
  }

  @Test("every build but the review build draws Notifications")
  func drawsNotifications() {
    let drawn = builds.map { $0.drawsNotifications }
    #expect(drawn == [false, true, true])
  }

  @Test("This phone: Appearance, Terminal, Notifications where the build draws it, then Lock where a lock is held")
  func thisPhone() {
    let withLock = builds.map { SettingsModel.thisPhoneRows(build: $0, hasLock: true) }
    let noLock = builds.map { SettingsModel.thisPhoneRows(build: $0, hasLock: false) }
    let wantWithLock: [[SettingsRoute]] = [
      [.appearance, .terminal, .lock],
      [.appearance, .terminal, .notifications, .lock],
      [.appearance, .terminal, .notifications, .lock],
    ]
    let wantNoLock: [[SettingsRoute]] = [
      [.appearance, .terminal],
      [.appearance, .terminal, .notifications],
      [.appearance, .terminal, .notifications],
    ]
    #expect(withLock == wantWithLock)
    #expect(noLock == wantNoLock)
  }

  @Test("the page says §9's words, and the device as its platform names it")
  func words() {
    #expect(SettingsWords.notificationsRow == "Notifications")
    let preview = [
      SettingsWords.previewApp, SettingsWords.previewWhen, SettingsWords.previewDesktop, SettingsWords.previewLine,
    ]
    #expect(preview == ["VIBEFIELD", "now", "studio", "An agent is waiting on you"])
    #expect(
      SettingsWords.notificationsCaption == "A title and nothing more: what your agents said stays on your desktop.")
    #expect(SettingsWords.tellMeWhen == "Tell me when")
    let switches = [SettingsWords.notifyNeedsYou, SettingsWords.notifyFinishes, SettingsWords.notifyAsleep]
    #expect(switches == ["An agent needs you", "A session finishes", "A desktop goes to sleep"])
    #expect(SettingsWords.notifyNeedsYouDetail == "An approval or a question")
    let feet = [DeviceWord.iPhone, .iPad].map { SettingsWords.notificationsFoot($0) }
    #expect(
      feet == [
        "Not built yet. When it is, a desktop tells this iPhone only that something happened, never what your "
          + "agents said. Until then, the orange count on the Field tab is how this iPhone tells you.",
        "Not built yet. When it is, a desktop tells this iPad only that something happened, never what your "
          + "agents said. Until then, the orange count on the Field tab is how this iPad tells you.",
      ])
  }
}
