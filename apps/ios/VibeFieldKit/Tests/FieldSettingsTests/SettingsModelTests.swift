import FieldDesign
import Foundation
import Testing
import UIKit

@testable import FieldSettings

/// IOS-10a — Settings' decisions, one state at a time: which words each
/// standing says at the head and on Account, how a desktop's line reads, what
/// the phone can do with a desktop, and About's facts. The words are DESIGN.md
/// §9's and the corner's; what is pinned here is which, and where.
@Suite("Settings says each state in the door's words")
struct SettingsModelTests {
  private let fox = UserFace(emoji: "🦊")

  private func account(
    _ standing: SettingsAccount.Standing, face: UserFace? = nil, source: SettingsAccount.FaceSource = .none,
    desktops: [SettingsDesktop] = []
  ) -> SettingsAccount {
    SettingsAccount(
      standing: standing, name: "James", login: "me@jamesyong42.com", face: face, faceSource: source,
      seed: "me@jamesyong42.com", tailnet: "tail3f2a8c.ts.net", machineName: "iphone-17-pro",
      adminConsole: nil, desktops: desktops)
  }

  private func desktop(
    _ reach: SettingsDesktop.Reach, name: String = "studio", home: Bool = false, terminals: Bool? = true,
    watchable: Bool? = nil
  ) -> SettingsDesktop {
    SettingsDesktop(
      id: "dev-1", name: name, platform: "darwin", reach: reach, isHome: home, servesTerminals: terminals,
      watchable: watchable)
  }

  /// A fixed reader: British English (a 24-hour clock, no narrow spaces),
  /// Gregorian, UTC, so the dates are words a test can hold.
  private var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
  }

  private let locale = Locale(identifier: "en_GB")

  private func date(_ day: Int, _ hour: Int, _ minute: Int) -> Date {
    calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
  }

  // MARK: - The head

  @Test("the login is said once: under the name, or as the name until a desktop names you")
  func loginLine() {
    #expect(account(.connected).loginLine == "me@jamesyong42.com")
    var nameless = account(.connected)
    nameless.name = "me@jamesyong42.com"
    #expect(nameless.loginLine == nil)
  }

  @Test("signed in and well: the head is the name and the login, and no note")
  func headWhenConnected() {
    let lines = SettingsModel.headLines(account(.connected, face: fox))
    #expect(lines.status == nil)
    #expect(lines.note == nil)
    #expect(SettingsModel.headLines(account(.connecting)).status == nil)
    #expect(SettingsModel.headLines(account(.couldNotConnect("the network went away"))).status == nil)
  }

  @Test("the network asks again: TS-7's words, orange, and nothing is lost")
  func headWhenSignInAgain() {
    let lines = SettingsModel.headLines(account(.signInAgain, face: fox))
    #expect(lines.status == .init("Sign in to Tailscale again", wantsTheUser: true))
    #expect(lines.note == "This phone can’t reach your desktops until you do. Nothing here is lost.")
  }

  @Test("waiting for approval: who must act, in §9's words")
  func headWhenWaiting() {
    let lines = SettingsModel.headLines(account(.waitingForApproval))
    #expect(lines.status == .init("Waiting for approval", wantsTheUser: true))
    #expect(lines.note == "You’re signed in. An admin of your Tailscale network approves new devices.")
  }

  @Test("signed out: Settings has no head of its own, for it is never open signed out (WI-L1; item 163)")
  func headWhenSignedOut() {
    let lines = SettingsModel.headLines(account(.signedOut))
    #expect(lines.status == nil)
    #expect(lines.note == nil, "a Sign out leaves Settings first, and the way in stands alone")
  }

  // MARK: - Your desktops

  @Test("a desktop's line: the home says the field comes through it; asleep is grey, never offline")
  func desktopLines() {
    let now = date(31, 9, 0)
    func line(_ desktop: SettingsDesktop) -> SettingsModel.Line {
      SettingsModel.desktopLine(desktop, now: now, calendar: calendar, locale: locale)
    }
    #expect(line(desktop(.connected, home: true)) == .init("Connected · your field comes through it"))
    #expect(line(desktop(.connected)) == .init("Connected"))
    #expect(line(desktop(.working("reconnecting"))) == .init("Reconnecting"))
    #expect(line(desktop(.working("no field yet"))) == .init("No field yet"))
    #expect(line(desktop(.wantsYou("refused", reason: "FORBIDDEN_SCOPE"))) == .init("Refused", wantsTheUser: true))
    #expect(line(desktop(.asleep(lastHeard: nil))) == .init("Asleep"))
    #expect(line(desktop(.asleep(lastHeard: date(30, 18, 2)))) == .init("Asleep · last heard yesterday, 18:02"))
    #expect(!line(desktop(.asleep(lastHeard: nil))).text.lowercased().contains("offline"))
  }

  @Test("last heard: today, yesterday, or the day")
  func heard() {
    let now = date(31, 20, 0)
    #expect(SettingsModel.heard(date(31, 18, 2), now: now, calendar: calendar, locale: locale) == "today, 18:02")
    #expect(SettingsModel.heard(date(30, 18, 2), now: now, calendar: calendar, locale: locale) == "yesterday, 18:02")
    #expect(SettingsModel.heard(date(28, 18, 2), now: now, calendar: calendar, locale: locale) == "28 Oct")
  }

  // RETIRED 2026-11-02 (item 163): `noDesktopsFoot`'s row, with the foot it held. Settings' list is never empty.

  // MARK: - A desktop's page

  @Test("what the phone can do with a desktop: the same for every one; approving from the card not yet")
  func abilities() {
    let all = SettingsModel.abilities(desktop(.connected))
    #expect(all.map(\.title) == [
      "Watch its agents", "Start agents in its folders", "Open its agents’ terminals and type",
      "Read and search its History", "Approve from the card",
    ])
    #expect(all.map(\.can) == [true, true, true, true, false])
    // A desktop that said its terminals are not served: the row says so, in words.
    let closed = SettingsModel.abilities(desktop(.connected, terminals: false))
    #expect(
      closed[2]
        == .init(
          title: "Open its agents’ terminals and type", detail: "studio doesn’t serve its terminals to your devices.",
          can: false))
    // Not said is not a refusal.
    #expect(SettingsModel.abilities(desktop(.connected, terminals: nil))[2].can)
    // An agent's approval is answered by typing into its pane, which works,
    // so nothing here may say approvals cannot be answered at all.
    #expect(!all.contains { $0.title.localizedCaseInsensitiveContains("answer approvals") })
  }

  /// W1 (PG-3e, design v2 §5.3) — a desktop this phone cannot read says so on its page, in J-E1 (iii)'s words; not
  /// said, and readable, both read available.
  @Test("watching a desktop: one the phone cannot read says so; not said is not a refusal")
  func aDesktopThatCannotBeWatchedSaysSo() {
    let refused = SettingsModel.abilities(desktop(.connected, watchable: false)).first
    #expect(
      refused == .init(title: "Watch its agents", detail: "studio runs a VibeField this phone can’t read.", can: false))
    for said in [nil, true] as [Bool?] {
      let watch = SettingsModel.abilities(desktop(.connected, watchable: said)).first
      #expect(watch == .init(title: "Watch its agents", detail: nil, can: true), "watchable \(String(describing: said))")
    }
  }

  @Test("terminals: served, not served, or not drawn when not said")
  func terminalsValue() {
    #expect(SettingsModel.terminalsValue(desktop(.connected, terminals: true)) == "Served to your devices")
    #expect(SettingsModel.terminalsValue(desktop(.connected, terminals: false)) == "Not served")
    #expect(SettingsModel.terminalsValue(desktop(.connected, terminals: nil)) == nil)
  }

  @Test("an unreachable desktop says why, in words, and that what was read stays (DS-L8)")
  func asleepFoot() {
    let mini = desktop(.asleep(lastHeard: nil), name: "mini")
    let asleep = SettingsModel.asleepFoot(mini, standing: .connected)
    #expect(
      asleep
        == "Tailscale doesn’t list mini right now: it’s asleep, or VibeField isn’t running on it. "
        + "What you already opened from it stays on this phone; its terminals and search answer when it wakes.")
    #expect(
      SettingsModel.asleepFoot(mini, standing: .signInAgain)
        == "What you already opened from it stays on this phone. "
        + "Its terminals and search answer once you sign in to Tailscale again.")
    // A desktop is any OS: the words never assume a Mac.
    #expect(!asleep.contains("Mac"))
  }

  // MARK: - Account

  @Test("the Tailscale card: Connected, or who must act; no connect and no disconnect")
  func tailscaleState() {
    #expect(SettingsModel.tailscaleState(.connected) == .init("Connected"))
    #expect(SettingsModel.tailscaleState(.connecting) == .init("Connecting…"))
    #expect(SettingsModel.tailscaleState(.signInAgain) == .init("Sign in to Tailscale again", wantsTheUser: true))
    #expect(SettingsModel.tailscaleState(.waitingForApproval) == .init("Waiting for approval", wantsTheUser: true))
    #expect(
      SettingsModel.tailscaleState(.couldNotConnect("the network went away"))
        == .init("Couldn’t connect — the network went away.", wantsTheUser: true))
    #expect(SettingsModel.tailscaleFoot(.connected) == .init("While you’re signed in, this phone stays connected by itself."))
    #expect(SettingsModel.tailscaleFoot(.signInAgain).wantsTheUser)
    for standing: SettingsAccount.Standing in [.connected, .connecting, .signInAgain, .waitingForApproval] {
      let words = SettingsModel.tailscaleState(standing).text + SettingsModel.tailscaleFoot(standing).text
      #expect(!words.contains("Disconnect"))
      #expect(!words.lowercased().contains("tailnet"))
    }
  }

  @Test("your face: how it is framed; whose word it is rides on the tag, not the row")
  func faceWords() {
    #expect(SettingsModel.faceWords(.none, face: nil).value == "None yet")
    #expect(SettingsModel.faceWords(.dealt, face: fox).value == "Sticker")
    #expect(SettingsModel.faceWords(.dealt, face: UserFace(emoji: "🦊", frame: .coin)).value == "Coin")
    #expect(
      SettingsModel.faceWords(.dealt, face: fox).foot
        == "Dealt from your account, the way your computer deals it, until a desktop of yours says who you are.")
    let home = SettingsModel.faceWords(.home("studio"), face: fox)
    #expect(home.value == "Sticker")
    #expect(home.foot.hasPrefix("studio says who you are"))
    #expect(home.foot.contains("Change them on studio, in Settings › Account"))
  }

  @Test("the phone says computer, never Mac, in every word Settings says (DESIGN.md §9, amended 2026-11-02; item 163)")
  func computerNeverMac() {
    let standings: [SettingsAccount.Standing] = [
      .signedOut, .connected, .connecting, .signInAgain, .waitingForApproval, .couldNotConnect("the network went away"),
    ]
    var words: [String] = []
    for standing in standings {
      let head = SettingsModel.headLines(account(standing))
      words += [head.status?.text, head.note].compactMap { $0 }
      words += [SettingsModel.tailscaleState(standing).text, SettingsModel.tailscaleFoot(standing).text]
      words.append(SettingsModel.asleepFoot(desktop(.asleep(lastHeard: nil), name: "mini"), standing: standing))
    }
    let faces: [(SettingsAccount.FaceSource, UserFace?)] = [(.none, nil), (.dealt, fox), (.home("studio"), fox)]
    for (source, face) in faces {
      let said = SettingsModel.faceWords(source, face: face)
      words += [said.value, said.foot]
    }
    for word in words {
      #expect(!word.contains("Mac"), "\(word)")
    }
  }

  @Test("sign out is asked in one set of words, wherever it is asked")
  func signOutWords() {
    #expect(SettingsWords.signOutTitle(login: "me@jamesyong42.com") == "Sign out of me@jamesyong42.com?")
    #expect(SettingsWords.signOutTitle(login: nil) == "Sign out of this account?")
    // What a sign-out removes and keeps, said whole: the project colours and
    // the History read from your desktops go (item 130); this phone's look and
    // the terminal's look stay.
    #expect(
      SettingsWords.signOutMessage
        == "This phone forgets your Tailscale sign-in, your desktops and the History it read from them, your face "
        + "and your project colours. Appearance, the terminal’s look, snippets and clipboard history stay.")
  }

  // MARK: - About

  @Test("the version is the bundle's own: short version and build")
  func version() {
    #expect(SettingsModel.version(info: ["CFBundleShortVersionString": "0.1", "CFBundleVersion": "4"]) == "0.1 (4)")
    #expect(SettingsModel.version(info: ["CFBundleShortVersionString": "0.1"]) == "0.1")
    #expect(SettingsModel.version(info: nil) == "—")
  }

  @Test("the icon is the one the compiled Info.plist names")
  func iconName() {
    let files: [String: Any] = ["CFBundleIcons": ["CFBundlePrimaryIcon": ["CFBundleIconFiles": ["AppIcon60x60"], "CFBundleIconName": "AppIcon"]]]
    #expect(SettingsModel.iconName(info: files) == "AppIcon60x60")
    let named: [String: Any] = ["CFBundleIcons": ["CFBundlePrimaryIcon": ["CFBundleIconName": "AppIcon"]]]
    #expect(SettingsModel.iconName(info: named) == "AppIcon")
    #expect(SettingsModel.iconName(info: [:]) == nil)
  }

  @Test("every credit says what it is for and its licence; the trademark line is Tailscale's own")
  func credits() {
    #expect(!SettingsModel.credits.isEmpty)
    for credit in SettingsModel.credits {
      #expect(!credit.role.isEmpty)
      #expect(!credit.licence.isEmpty)
    }
    #expect(Set(SettingsModel.credits.map(\.name)).count == SettingsModel.credits.count)
    #expect(SettingsWords.trademark == "Tailscale is a registered trademark of Tailscale Inc.")
  }
}

/// IOS-10a — the phone's look: the Mac's three words, and Auto is the
/// system's own answer, not a copy of it.
@Suite("the phone's look")
struct PhoneAppearanceTests {
  @Test("Light · Dark · Auto, in the Mac's words and order")
  func words() {
    #expect(PhoneAppearance.allCases.map(\.word) == ["Light", "Dark", "Auto"])
  }

  @Test("Auto leaves the window to the system")
  func styles() {
    #expect(PhoneAppearance.light.interfaceStyle == .light)
    #expect(PhoneAppearance.dark.interfaceStyle == .dark)
    #expect(PhoneAppearance.auto.interfaceStyle == .unspecified)
  }

  /// The stored words are the contract with every earlier launch: a value
  /// this build does not know falls back to the default, Auto.
  @Test("stored as its raw word; an unknown word is no look at all")
  func storage() {
    #expect(PhoneAppearance(rawValue: "dark") == .dark)
    #expect(PhoneAppearance(rawValue: "system") == nil)
    #expect(PhoneAppearance.storageKey == "vibefield.phone.appearance")
  }
}
