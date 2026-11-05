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

  // MARK: - S2: About

  @Test("About reaches the privacy policy and support, in Apple's own words, from the one pair")
  func aboutLinks() {
    let links = SettingsModel.aboutLinks
    let titles = links.map { $0.title }
    let urls = links.map { $0.url }
    #expect(titles == ["Privacy Policy", "Support"])
    #expect(urls == [VibeFieldSite.privacy, VibeFieldSite.support])
  }

  @Test("About's foot: Tailscale's trademark line, then the non-affiliation line, word for word")
  func aboutFoot() {
    #expect(
      SettingsModel.aboutFoot == [
        "Tailscale is a registered trademark of Tailscale Inc.",
        "VibeField names agents such as Claude Code and Codex to tell sessions apart. "
          + "It isn’t affiliated with or endorsed by Anthropic or OpenAI.",
      ])
  }
}
