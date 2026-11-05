import FieldDesign
import FieldLock
import FieldSettings
import Foundation
import Testing

@testable import FieldHome

/// WI-1/WI-2 — what each screen of the way in draws (`FieldHomeModel.wayInScreen`; DESIGN.md §9 "The way in",
/// §8 "The phone's way in"): the words as ruled, the primary always first in the acts' glass, the steps, and what
/// stands in the mark's place.
@Suite("the way in's screens say DESIGN.md's words, with the primary act first")
@MainActor
struct WayInScreenTests {
  private let login = "me@example.com"
  private typealias Screen = FieldHomeModel.WayInScreen

  private func screen(_ page: FieldHomeModel.DoorPage) -> Screen {
    FieldHomeModel.wayInScreen(.page(page), device: .iPhone)
  }

  private func line(_ screen: Screen) -> String? {
    screen.words.line.map { String($0.characters) }
  }

  @Test("the welcome: the bible's subtitle, its line, the note, and Continue with Tailscale leading (WI-D1, WI-D2 A)")
  func welcome() {
    let s = screen(.welcome(failure: nil))
    #expect(s.words.title == "Your agents, in your pocket.")
    #expect(line(s) == "See what needs you and open your agents’ terminals, while VibeField runs on your computer.")
    #expect(s.words.note == "Use the same Tailscale account as VibeField on your computer.")
    #expect(s.picture == .mark)
    #expect(s.steps == nil)
    #expect(
      s.acts == [
        .primary("Continue with Tailscale", .continueWithTailscale),
        .secondary("Scan the code on your computer", .scanCode, glyph: "qrcode.viewfinder"),
        .link("New to VibeField? See how it works", .seeHowItWorks),
        .legal(SettingsModel.aboutLinks),
      ])
  }

  @Test("IOS-13a: the welcome's glass ends with Privacy Policy · Support, and no other screen's does")
  func legal() {
    let welcome = screen(.welcome(failure: nil))
    let last = welcome.acts.last
    #expect(last == .legal(SettingsModel.aboutLinks))
    let titles = SettingsModel.aboutLinks.map { $0.title }
    #expect(titles == ["Privacy Policy", "Support"])
    // a code that named the account, or a first sign-in that failed: still the welcome, still its foot
    let named = screen(.welcome(failure: nil, expecting: login)).acts.last
    #expect(named == .legal(SettingsModel.aboutLinks))
    // every other screen of the way in: no legal line (Q3, VF-PM 02:29Z; WI-L4's three places stand)
    var steps: [FieldHomeModel.WayInStep] = (0...3).map { .tour($0) }
    steps += [
      .page(.fromCode(desktop: "Studio", login: login)), .page(.signInAgain(note: nil)),
      .page(.noDesktops(login: login)), .page(.joining(login: login, note: nil)), .page(.looking(login: login)),
      .page(.approval(machine: "iphone-17-pro", adminConsole: nil)), .found(name: "James", desktop: "studio"),
      .lockOffer(.faceID), .locked(.faceID),
    ]
    for step in steps {
      let acts = FieldHomeModel.wayInScreen(step, device: .iPhone).acts
      let legal = acts.contains { act in
        if case .legal = act { return true }
        return false
      }
      #expect(!legal, "\(step)")
    }
  }

  /// IOS-13a S3b (VF-PM 23:38Z) — what the acts' glass DRAWS, not only what the screen holds: the glass has three
  /// slots and a foot. The welcome's legal line is its foot, under the third slot (§8, amended 2026-11-05); before
  /// S3b the glass drew `acts.prefix(3)` and the welcome's fourth act, the legal line, was never on the screen (the
  /// stills at ea3e37465 were the first witness that could see it). No screen may hold an act its glass drops.
  @Test("IOS-13a: the acts' glass draws three slots and the welcome's legal line under them; no act is ever dropped")
  func glass() {
    let welcome = screen(.welcome(failure: nil))
    let drawn = WayInView.glass(welcome.acts)
    let slots = Array(welcome.acts.prefix(3))
    #expect(drawn == WayInView.Glass(slots: slots, foot: .legal(SettingsModel.aboutLinks)))
    let console = URL(string: "https://login.tailscale.com/admin/machines")
    var steps: [FieldHomeModel.WayInStep] = (0...3).map { .tour($0) }
    steps += [
      .page(.welcome(failure: nil)), .page(.welcome(failure: "Sign-in didn’t finish.")),
      .page(.welcome(failure: nil, expecting: login)), .page(.fromCode(desktop: "Studio", login: login)),
      .page(.approval(machine: "iphone-17-pro", adminConsole: nil)),
      .page(.approval(machine: "iphone-17-pro", adminConsole: console)), .page(.signInAgain(note: nil)),
      .page(.anotherAccount(current: "a@b", expected: "c@d", from: "Mini", byLink: true)),
      .page(.anotherAccount(current: "a@b", expected: "c@d", from: "Mini", byLink: false)),
      .page(.joining(login: login, note: nil)), .page(.looking(login: login)), .page(.noDesktops(login: login)),
      .found(name: "James", desktop: "studio"),
    ]
    for method in [LockMethod.faceID, .touchID, .passcode] {
      steps += [.lockOffer(method), .locked(method)]
    }
    for step in steps {
      let acts = FieldHomeModel.wayInScreen(step, device: .iPhone).acts
      let glass = WayInView.glass(acts)
      let shown = glass.slots.count + (glass.foot == nil ? 0 : 1)
      #expect(glass.slots.count <= 3, "\(step)")
      #expect(shown == acts.count, "\(step): the glass drops an act")
    }
  }

  /// An act's own words; approval's row carries Tailscale's machine name, which is not ours to say.
  private func said(_ act: Screen.Act) -> String {
    switch act {
    case .primary(let words, _, _), .secondary(let words, _, _): return words
    case .share(let words, _): return words
    case .link(let words, _): return words
    case .note(let words), .tailscale(let words): return words
    case .legal(let links): return links.map { $0.title }.joined(separator: " · ")
    case .thisPhone, .computerWaiting: return ""
    }
  }

  @Test("IOS-13a: the way in names the device as its platform does (Q1); the lock's words are L4's to bring")
  func deviceNamed() {
    var steps: [FieldHomeModel.WayInStep] = (0...3).map { .tour($0) }
    steps += [
      .page(.welcome(failure: nil)), .page(.fromCode(desktop: "Studio", login: login)), .page(.signInAgain(note: nil)),
      .page(.anotherAccount(current: "a@b", expected: "c@d", from: "Mini", byLink: true)),
      .page(.anotherAccount(current: "a@b", expected: "c@d", from: "Mini", byLink: false)),
      .page(.noDesktops(login: login)), .page(.joining(login: login, note: nil)), .page(.looking(login: login)),
      .page(.approval(machine: "iphone-17-pro", adminConsole: nil)), .found(name: "James", desktop: "studio"),
    ]
    for device in [DeviceWord.iPad, .unknown] {
      for step in steps {
        let s = FieldHomeModel.wayInScreen(step, device: device)
        let words = [s.words.title, line(s) ?? "", s.words.note ?? ""] + s.acts.map(said)
        for word in words {
          #expect(!word.localizedCaseInsensitiveContains("phone"), "\(device) \(step): \(word)")
        }
      }
    }
    let iPad = line(FieldHomeModel.wayInScreen(.page(.signInAgain(note: nil)), device: .iPad))
    #expect(iPad == "This iPad can’t reach your desktops until you do. Nothing here is lost.")
    let device = line(FieldHomeModel.wayInScreen(.tour(2), device: .unknown))
    #expect(
      device
        == "This device reaches your computer over your own Tailscale network, encrypted end to end. "
        + "VibeField runs no session relay.")
  }

  @Test("the welcome's note: the account a code named, or why a first sign-in failed")
  func welcomeNote() {
    #expect(screen(.welcome(failure: nil, expecting: login)).words.note == "At Tailscale, pick me@example.com.")
    #expect(screen(.welcome(failure: "the network went away", expecting: login)).words.note == "the network went away")
  }

  @Test("opened from the desktop's code: the desktop that sent you, the account named, Not yours? Start over")
  func fromCode() {
    let s = screen(.fromCode(desktop: "studio", login: login))
    #expect(s.words.title == "Connect to studio.")
    #expect(line(s) == "studio sent you here. It uses Tailscale as me@example.com, so sign in with that account.")
    #expect(s.picture == .art(.desktop("studio")))
    #expect(s.acts == [.primary("Continue with Tailscale", .continueWithTailscale), .link("Not yours? Start over", .startOver)])
  }

  @Test("the steps say where you are: Sign in, then Your computer, and the lock's third only while it will be offered")
  func steps() {
    #expect(screen(.joining(login: login, note: nil)).steps == .step(1))
    #expect(screen(.approval(machine: nil, adminConsole: nil)).steps == .step(1))
    #expect(screen(.looking(login: login)).steps == .step(2))
    #expect(screen(.noDesktops(login: login)).steps == .step(2))
    #expect(FieldHomeModel.wayInScreen(.found(name: "James", desktop: "studio"), device: .iPhone).steps == .step(2))
    let two = ["Sign in", "Your computer"]
    #expect(FieldHomeModel.WayInWords.steps == two)
    #expect(screen(.looking(login: login)).stepNames == two, "no lock to offer: never a step that does not come")
    #expect(FieldHomeModel.wayInSteps(lock: nil) == two)
    #expect(FieldHomeModel.wayInSteps(lock: .faceID) == ["Sign in", "Your computer", "Face ID"])
    #expect(FieldHomeModel.wayInSteps(lock: .touchID) == ["Sign in", "Your computer", "Touch ID"])
    #expect(FieldHomeModel.wayInSteps(lock: .passcode) == ["Sign in", "Your computer", "Passcode"])
    #expect(FieldHomeModel.wayInSteps(lock: LockMethod.none) == two, "a phone that cannot lock has two steps")
    for page: FieldHomeModel.DoorPage in [.joining(login: login, note: nil), .looking(login: login)] {
      #expect(
        FieldHomeModel.wayInScreen(.page(page), lock: .faceID, device: .iPhone).stepNames == ["Sign in", "Your computer", "Face ID"])
    }
    #expect(
      FieldHomeModel.wayInScreen(.found(name: "James", desktop: "studio"), lock: .faceID, device: .iPhone).stepNames.count == 3)
    #expect(StepsCapsule.name(2, of: two) == "Your computer")
    #expect(StepsCapsule.name(3, of: two) == "Your computer")
    #expect(StepsCapsule.name(3, of: FieldHomeModel.wayInSteps(lock: .faceID)) == "Face ID")
  }

  @Test("the lock's offer, the way in's last step: Lock with Face ID leading, Not now, and where to change it (WI-D3 A)")
  func lockOffer() {
    let s = FieldHomeModel.wayInScreen(.lockOffer(.faceID), lock: .faceID, device: .iPhone)
    #expect(s.steps == .step(3))
    #expect(s.stepNames == ["Sign in", "Your computer", "Face ID"])
    #expect(s.picture == .mark)
    #expect(s.words.title == "Lock VibeField with Face ID.")
    #expect(line(s) == "This phone can type into your agents’ terminals. Face ID keeps that to you.")
    #expect(s.words.note == nil)
    #expect(!s.words.hold)
    #expect(
      s.acts == [
        .primary("Lock with Face ID", .lockOn), .secondary("Not now", .notNow),
        .note("You can change this in Settings › Lock."),
      ])
    let passcode = FieldHomeModel.wayInScreen(.lockOffer(.passcode), lock: .passcode, device: .iPhone)
    #expect(passcode.words.title == "Lock VibeField with your passcode.")
    #expect(passcode.stepNames.last == "Passcode")
    #expect(passcode.acts.first == .primary("Lock with passcode", .lockOn))
  }

  @Test("the curtain after a miss: VibeField is locked., Unlock with Face ID, and the passcode's note (WI-D5 A)")
  func locked() {
    let s = FieldHomeModel.wayInScreen(.locked(.faceID), device: .iPhone)
    #expect(s.steps == nil, "the lock is not a step of the way in")
    #expect(s.picture == .mark)
    #expect(s.words.title == "VibeField is locked.")
    #expect(s.words.line == nil)
    #expect(s.acts == [.primary("Unlock with Face ID", .unlock), .note("Your iPhone passcode works too.")])
    let touch = FieldHomeModel.wayInScreen(.locked(.touchID), device: .iPhone)
    #expect(touch.acts == [.primary("Unlock with Touch ID", .unlock), .note("Your iPhone passcode works too.")])
    let passcode = FieldHomeModel.wayInScreen(.locked(.passcode), device: .iPhone)
    #expect(passcode.acts == [.primary("Unlock with passcode", .unlock)], "the passcode is the method: no “too”")
  }

  @Test("after the found beat: the lock's offer while the phone can lock and the lock is off, else the hand-over")
  func afterFoundBeat() {
    #expect(FieldHomeModel.afterFoundBeat(offer: .faceID) == .lockOffer(.faceID))
    #expect(FieldHomeModel.afterFoundBeat(offer: .passcode) == .lockOffer(.passcode))
    #expect(FieldHomeModel.afterFoundBeat(offer: nil) == nil)
    #expect(FieldHomeModel.afterFoundBeat(offer: LockMethod.none) == nil)
  }

  @Test("the holds: a status line and no acts, so the glass steps away")
  func holds() {
    let joining = screen(.joining(login: login, note: "the network went away"))
    #expect(joining.words == .init(
      title: "Joining your network…", line: AttributedString("Signed in as me@example.com"),
      note: "Couldn’t connect — the network went away.", hold: true))
    #expect(joining.acts.isEmpty)
    let looking = screen(.looking(login: login))
    #expect(looking.words.title == "Looking for your computer…")
    #expect(line(looking) == "Open VibeField on your computer, signed in to Tailscale as me@example.com.")
    #expect(looking.words.hold)
    #expect(looking.acts.isEmpty)
  }

  @Test("No desktops yet: TS-7's words with “computer”, its row, and the link to send")
  func noDesktops() {
    let s = screen(.noDesktops(login: login))
    #expect(s.words.title == "No desktops yet.")
    #expect(
      line(s)
        == "Signed in as me@example.com. On your computer, open VibeField, click your face, then Connect your devices… with this same account.")
    #expect(s.picture == .art(.computerWaiting))
    #expect(s.acts == [.computerWaiting, .share("Send the link to my computer", primary: false)])
  }

  @Test("approval keeps TS-7's words, this phone's row, and the console when there is one")
  func approval() {
    let console = URL(string: "https://login.tailscale.com/admin/machines")!
    let s = screen(.approval(machine: "iphone-17-pro", adminConsole: console))
    #expect(s.words.title == "Waiting for approval.")
    #expect(line(s) == "You’re signed in. An admin of your Tailscale network approves new devices.")
    #expect(s.acts == [.thisPhone(machine: "iphone-17-pro"), .secondary("Open the admin console", .openAdminConsole(console))])
    #expect(screen(.approval(machine: nil, adminConsole: nil)).acts == [.thisPhone(machine: nil)])
  }

  @Test("Tailscale asking again: your face in the mark's place, Sign in again, Use another account (WI-D8 A)")
  func signInAgain() {
    let s = screen(.signInAgain(note: nil))
    #expect(s.words.title == "Sign in to Tailscale again.")
    #expect(line(s) == "This iPhone can’t reach your desktops until you do. Nothing here is lost.")
    #expect(s.picture == .face)
    #expect(s.acts == [.primary("Sign in again", .signInAgain), .link("Use another account", .useAnotherAccount)])
  }

  @Test("Another account?: TS-7b's words; a code by link leads with Keep this account (EL7)")
  func anotherAccount() {
    let scanned = screen(.anotherAccount(current: "james@acme.dev", expected: login, from: "Studio", byLink: false))
    #expect(scanned.words.title == "Another account?")
    #expect(
      line(scanned)
        == "This iPhone is signed in as james@acme.dev, but the code you scanned came from Studio, signed in as me@example.com.")
    #expect(scanned.acts.first == .primary("Sign in again", .switchAccount))
    #expect(scanned.acts.last == .note("At Tailscale, pick me@example.com."))
    let byLink = screen(.anotherAccount(current: "a@b", expected: "c@d", from: "Mini", byLink: true))
    #expect(line(byLink) == "This iPhone is signed in as a@b, but the link you opened came from Mini, signed in as c@d.")
    #expect(byLink.acts.first == .primary("Keep this account", .keepAccount))
  }

  @Test("the found beat: your face, Hi with your name when a desktop has said it, and the desktop reached")
  func found() {
    let s = FieldHomeModel.wayInScreen(.found(name: "James", desktop: "studio"), device: .iPhone)
    #expect(s.picture == .face)
    #expect(s.words.title == "Hi, James.")
    #expect(line(s) == "Connected to studio.")
    #expect(s.words.hold)
    #expect(s.acts.isEmpty)
    let unnamed = FieldHomeModel.wayInScreen(.found(name: nil, desktop: nil), device: .iPhone)
    #expect(unnamed.words.title == "Hi.")
    #expect(unnamed.words.line == nil)
  }

  @Test("How it works: four pages, their dots, back to the welcome from the first, no Allow and no notification")
  func tour() {
    let titles = (0...3).map { FieldHomeModel.wayInScreen(.tour($0), device: .iPhone).words.title }
    #expect(
      titles == [
        "Your agents run on your computer.", "Keep up when you step away.", "No VibeField account.",
        "Start on your computer.",
      ])
    for page in 0...3 {
      let s = FieldHomeModel.wayInScreen(.tour(page), device: .iPhone)
      let back: FieldHomeModel.WayInAct = page == 0 ? .welcome : .tour(page - 1)
      #expect(s.steps == .dots(page))
      #expect(s.back == back)
      #expect(s.picture == .art(.tour(page)))
      let words = [s.words.title, line(s) ?? "", s.words.note ?? ""].joined(separator: " ")
      #expect(!words.contains("Allow") && !words.contains("approve") && !words.contains("notif"), "\(page)")
    }
    #expect(
      line(FieldHomeModel.wayInScreen(.tour(0), device: .iPhone))
        == "VibeField is a control room for coding agents: Claude Code, Codex and others, each in its own terminal.")
    let three = FieldHomeModel.wayInScreen(.tour(2), device: .iPhone)
    #expect(
      line(three)
        == "This iPhone reaches your computer over your own Tailscale network, encrypted end to end. VibeField runs no session relay.")
    #expect(three.acts.last == .tailscale("Connecting your devices requires a Tailscale account."))
    let four = FieldHomeModel.wayInScreen(.tour(3), device: .iPhone)
    #expect(
      line(four) == "Get VibeField at vibefield.dev. When its setup connects your devices, it shows a code for this iPhone.")
    #expect(four.words.note == "Your agents run there, so keep it awake and connected while you’re away.")
    #expect(four.acts == [.share("Send the link to my computer", primary: true), .secondary("I already have VibeField", .welcome)])
  }

  @Test("the bible's retired lines are said nowhere in the way in")
  func retiredLines() {
    var steps: [FieldHomeModel.WayInStep] = (0...3).map { .tour($0) }
    steps += [
      .page(.welcome(failure: nil)), .page(.signInAgain(note: nil)), .page(.noDesktops(login: login)),
      .page(.joining(login: login, note: nil)), .page(.looking(login: login)), .found(name: "James", desktop: "studio"),
      .lockOffer(.faceID), .lockOffer(.passcode), .locked(.faceID), .locked(.touchID),
    ]
    for step in steps {
      let s = FieldHomeModel.wayInScreen(step, device: .iPhone)
      let words = [s.words.title, line(s) ?? "", s.words.note ?? ""].joined(separator: " ")
      for retired in ["never what they send", "no servers", "device to device", "your Mac", "free for personal use"] {
        #expect(!words.localizedCaseInsensitiveContains(retired), "\(step): \(retired)")
      }
    }
  }

  @Test("M2: the reader, the way in's own cover, says computer where it said Mac, and its title is the welcome's act")
  func readerWords() {
    for word in MacCodeReader.Words.all {
      #expect(!word.contains("Mac"), "\(word)")
    }
    #expect(MacCodeReader.Words.title == "Scan the code on your computer")
    #expect(
      screen(.welcome(failure: nil)).acts.contains(
        .secondary(MacCodeReader.Words.title, .scanCode, glyph: "qrcode.viewfinder")))
  }

  @Test(
    "WI-L3: through its door a face takes the mark's place when there is one, a drawing always; shut, the mark stays",
    arguments: [false, true])
  func theMarkFadesOnlyThroughItsDoor(markFades: Bool) {
    func shown(_ picture: Screen.Picture, face: Bool) -> Screen.Picture {
      WayInView.shownPicture(picture, hasFace: face, markFades: markFades)
    }
    #expect(shown(.mark, face: true) == .mark)
    #expect(shown(.face, face: false) == .mark, "no face to show: the mark keeps its place")
    #expect(shown(.face, face: true) == (markFades ? .face : .mark))
    #expect(shown(.art(.tour(1)), face: false) == (markFades ? .art(.tour(1)) : .mark))
    #expect(shown(.art(.computerWaiting), face: true) == (markFades ? .art(.computerWaiting) : .mark))
  }

  @Test("a bold run in a line is inked: the words the eye looks for elsewhere")
  func inked() {
    let line = WayInView.inked(FieldHomeModel.noDesktopsLine(login: login))
    #expect(String(line.characters).contains("Connect your devices…"))
    #expect(line.runs.allSatisfy { $0.inlinePresentationIntent == nil })
  }
}
