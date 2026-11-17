import Testing

@testable import FieldSettings

/// RB-2 — the Developer page says DESIGN.md §9 "Developer"'s words (asked for 2026-11-12: D1–D4, the 23
/// states, and how a demo ends, A): the picker's 23 states in a person's words, in two
/// groups, and every other word on the page.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("the Developer page says §9's words")
struct DeveloperWordsTests {
  @Test("the picker: Your own, then 23 states in two groups, Your account and The way in")
  func picker() {
    let titles = [DeveloperWords.yourOwn, DeveloperWords.yourAccountTitle, DeveloperWords.theWayInTitle]
    #expect(titles == ["Your own", "Your account", "The way in"])
    let yours = DeveloperWords.yourAccount.map { [$0.key, $0.name] }
    #expect(
      yours == [
        ["signedin", "Signed in"],
        ["asleep", "Your desktops asleep"],
        ["attention", "Sign in to Tailscale again"],
        ["noface", "Signed in, no face"],
        ["guests", "Another account’s desktop nearby"],
        ["refused", "A desktop refused this phone"],
        ["firstrun", "Welcome"],
        ["failed-first", "Welcome, a first sign-in failed"],
        ["approval", "Waiting for approval"],
        ["none", "No desktops yet"],
        ["expecting", "Welcome, after a scanned code"],
        ["another", "Another account? (a scanned code)"],
        ["another-link", "Another account? (a link)"],
      ])
    let wayIn = DeveloperWords.theWayIn.map { [$0.key, $0.name] }
    #expect(
      wayIn == [
        ["joining", "Joining your network"],
        ["looking", "Looking for your computer"],
        ["tour-1", "How it works, 1 of 4"],
        ["tour-2", "How it works, 2 of 4"],
        ["tour-3", "How it works, 3 of 4"],
        ["tour-4", "How it works, 4 of 4"],
        ["none-found", "Found your desktop"],
        ["from-code", "Sent by a desktop’s code"],
        ["lock-offer", "The lock offered (Face ID)"],
        ["lock-offer-passcode", "The lock offered (passcode only)"],
      ])
  }

  @Test("every other word on the page: the row, Demo, the one open under Account, Labs, the tag and the foot")
  func words() {
    let words = [
      DeveloperWords.row, DeveloperWords.demoGroup, DeveloperWords.demoField, DeveloperWords.demoFieldLine,
      DeveloperWords.account, DeveloperWords.accountLine, DeveloperWords.demoFoot, DeveloperWords.labsGroup,
      DeveloperWords.swarmLab, DeveloperWords.inputCardStates, DeveloperWords.demoTag, DeveloperWords.demoTagSpoken,
      DeveloperWords.foot,
    ]
    #expect(
      words == [
        "Developer",
        "Demo",
        "Demo field",
        "A made-up field: studio and mini, their agents and History to read. No desktop needed.",
        "Account",
        "A state stands for one open; then your own account comes back.",
        "Changes take effect the next time VibeField opens.",
        "Labs",
        "Swarm lab",
        "Input card states",
        "Demo",
        "Demo. What you see is made up.",
        "For testing. TestFlight and development builds show this page; the build in the App Store does not.",
      ])
  }
}
