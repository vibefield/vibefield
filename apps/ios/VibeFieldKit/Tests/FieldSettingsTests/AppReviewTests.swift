import Foundation
import Testing

@testable import FieldSettings

/// IOS-13a — Settings for App Review (the 0.9 launch's phase 3; DESIGN.md §8 "The phone's Settings" and §9 "The
/// phone's legal words", 2026-11-05): the site's addresses as one pair, About's links and its foot, the
/// acknowledgements the app carries, and the device named as its platform names it.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("Settings says what App Review asks, in DESIGN.md's words")
struct AppReviewTests {
  // MARK: - S1: the site's addresses

  @Test("the site's addresses are one pair beside its home, and nothing else in the app names them")
  func site() {
    let home = VibeFieldSite.home.absoluteString
    let privacy = VibeFieldSite.privacy.absoluteString
    let support = VibeFieldSite.support.absoluteString
    #expect(home == "https://vibefield.dev")
    #expect(privacy == "https://vibefield.dev/privacy")
    #expect(support == "https://vibefield.dev/support")
  }
}
