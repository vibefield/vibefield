import FieldDesign
import Foundation
import Testing

@testable import FieldHome
@testable import FieldMesh

/// WI-1 — the phone's two states (DESIGN.md §9 "The way in"; WI-L1, WI-L2): which page of the way in stands while
/// signed out (`FieldHomeModel.doorPage`), and nil — the three tabs — only for an account whose node is not
/// asking, with a VibeField desktop known. TS-7's pages and TS-7b's code keep their rules inside it.
@Suite("signed in is an account with a desktop known; everything else is a page of the way in")
@MainActor
struct DoorPageTests {
  private let login = "me@example.com"
  private let console = URL(string: "https://login.tailscale.com/admin/machines")

  private func page(
    fixture: Bool = false, _ state: MeshModel.State, remembered: String? = nil, login: String? = nil,
    gated: Bool = true, hasListed: Bool = true, listed: Int = 0, rememberedDesktops: Int = 0,
    machine: String? = "iphone-17-pro", note: String? = nil
  ) -> FieldHomeModel.DoorPage? {
    FieldHomeModel.doorPage(
      fixtureOwnsTheField: fixture, meshState: state, rememberedLogin: remembered, login: login, isGated: gated,
      hasListed: hasListed, listed: listed, remembered: rememberedDesktops, machineName: machine,
      adminConsole: console, signInNote: note)
  }

  @Test("no account: the welcome, before, during and after a first sign-in that has not answered")
  func welcome() {
    for state: MeshModel.State in [.off, .starting, .needsLogin, .stopping] {
      #expect(page(state) == .welcome(failure: nil), "\(state)")
    }
    // An empty login is no login.
    #expect(page(.off, remembered: "", login: "") == .welcome(failure: nil))
  }

  @Test("the welcome says why a first sign-in failed, and why the sheet could not be shown")
  func welcomeSaysWhy() {
    #expect(page(.failed("the network went away")) == .welcome(failure: "the network went away"))
    #expect(page(.needsLogin, note: "iOS did not open the sign-in sheet") == .welcome(failure: "iOS did not open the sign-in sheet"))
  }

  @Test("WI-L2: an account with a desktop remembered is signed in while its node re-dials, fails or reconnects")
  func rememberedIsSignedIn() {
    for state: MeshModel.State in [.off, .starting, .stopping, .reconnecting("gone"), .failed("gone"), .up] {
      #expect(page(state, remembered: login, rememberedDesktops: 1) == nil, "\(state)")
      #expect(page(state, login: login, listed: 1) == nil, "\(state)")
    }
  }

  @Test("WI-L2: an account with no desktop known is not signed in yet: joining, with why it is not up")
  func joining() {
    for state: MeshModel.State in [.off, .starting, .stopping, .reconnecting("gone")] {
      #expect(page(state, remembered: login) == .joining(login: login, note: nil), "\(state)")
    }
    #expect(page(.failed("the network went away"), remembered: login) == .joining(login: login, note: "the network went away"))
    // Up with no login yet is the beat before the re-gate: still joining, never the tabs.
    #expect(page(.up) == .joining(login: nil, note: nil))
    #expect(page(.up, listed: 1) == .joining(login: nil, note: nil))
  }

  @Test("signed in and waiting: the approval page names this phone and the console")
  func approval() {
    #expect(page(.needsMachineAuth, login: login) == .approval(machine: "iphone-17-pro", adminConsole: console))
    // Even with desktops remembered: an admin's approval is not signed in.
    #expect(page(.needsMachineAuth, login: login, rememberedDesktops: 2) == .approval(machine: "iphone-17-pro", adminConsole: console))
    // Before Layer 3 has a name, and on a custom control server: the page, with what it has.
    #expect(
      FieldHomeModel.doorPage(
        fixtureOwnsTheField: false, meshState: .needsMachineAuth, rememberedLogin: nil, login: nil, isGated: false,
        hasListed: false, listed: 0, remembered: 0, machineName: nil, adminConsole: nil, signInNote: nil)
        == .approval(machine: nil, adminConsole: nil))
  }

  @Test("WI-L2: the tailnet asking a remembered account again is signed out, desktops remembered or not")
  func signInAgain() {
    #expect(page(.needsLogin, remembered: login) == .signInAgain(note: nil))
    #expect(page(.needsLogin, remembered: login, rememberedDesktops: 2) == .signInAgain(note: nil))
    #expect(page(.needsLogin, remembered: login, note: "a reason") == .signInAgain(note: "a reason"))
  }

  @Test("up, gated, answered, nothing listed and nothing remembered: No desktops yet")
  func noDesktops() {
    #expect(page(.up, login: login) == .noDesktops(login: login))
    // The remembered login stands in until the node reports its own.
    #expect(page(.up, remembered: login) == .noDesktops(login: login))
  }

  @Test("No desktops yet is an answer, never the blank before one: looking until the gate and the listing answer")
  func lookingBeforeTheAnswer() {
    #expect(page(.up, login: login, hasListed: false) == .looking(login: login))
    #expect(page(.up, login: login, gated: false) == .looking(login: login))
    #expect(page(.up, login: login, gated: false, hasListed: false) == .looking(login: login))
  }

  @Test("a fixture owns the tabs: no page over its photograph, in any state")
  func fixtureOwnsTheField() {
    for state: MeshModel.State in [.off, .needsLogin, .needsMachineAuth, .up, .failed("x")] {
      #expect(page(fixture: true, state) == nil, "\(state)")
    }
  }

  @Test("WI-2: the found beat begins when a page that stood for a first sign-in yields to signed in, and only then")
  func wayInEnds() {
    let pages: [FieldHomeModel.DoorPage] = [
      .welcome(failure: nil), .approval(machine: nil, adminConsole: nil),
      .joining(login: login, note: nil), .looking(login: login), .noDesktops(login: login),
      .fromCode(desktop: "Studio", login: login),
    ]
    for previous in pages {
      #expect(FieldHomeModel.wayInEnds(previous: previous, next: nil), "\(previous)")
      #expect(!FieldHomeModel.wayInEnds(previous: previous, next: .welcome(failure: nil)), "\(previous)")
    }
    // A launch signed in from its first frame passes no page; "Another account?" kept is no arrival.
    #expect(!FieldHomeModel.wayInEnds(previous: nil, next: nil))
    // M4 — Sign in again goes back to the tabs with no beat: §9 sets the beat between the steps and the lock's offer.
    #expect(!FieldHomeModel.wayInEnds(previous: .signInAgain(note: nil), next: nil))
    #expect(!FieldHomeModel.wayInEnds(previous: .signInAgain(note: "the session expired"), next: nil))
    #expect(
      !FieldHomeModel.wayInEnds(
        previous: .anotherAccount(current: "a@b", expected: login, from: "Studio", byLink: false), next: nil))
  }

  @Test("M1: signed out, the tabs stay under the splash until it stands whole over them; signed in, they stand")
  func tabsStand() {
    #expect(FieldHomeModel.tabsStand(signedIn: true, splashCovers: true))
    #expect(FieldHomeModel.tabsStand(signedIn: true, splashCovers: false))
    #expect(FieldHomeModel.tabsStand(signedIn: false, splashCovers: false), "a sign-out's splash fades in over them")
    #expect(!FieldHomeModel.tabsStand(signedIn: false, splashCovers: true), "covered: the way in stands alone")
  }

  @Test("the found beat names the home when it is listed, else the first desktop, else none")
  func foundDesktop() {
    let studio = FieldDesktop(deviceId: "dev-1", name: "studio", platform: "darwin", state: .ready, feed: .door)
    let mini = FieldDesktop(deviceId: "dev-2", name: "mini", platform: "darwin", state: .ready, feed: .door)
    #expect(FieldHomeModel.foundDesktop(home: "dev-2", desktops: [studio, mini]) == .init(name: "mini", platform: "darwin"))
    #expect(FieldHomeModel.foundDesktop(home: nil, desktops: [studio, mini]) == .init(name: "studio", platform: "darwin"))
    #expect(FieldHomeModel.foundDesktop(home: "dev-9", desktops: [studio]) == .init(name: "studio", platform: "darwin"))
    #expect(FieldHomeModel.foundDesktop(home: "dev-1", desktops: []) == nil)
  }

  @Test("the menu's sign-in row: the act's words on a first sign-in, Sign in again for an account")
  func signInWord() {
    func face(remembered: String?) -> FieldHomeModel.AccountFace {
      FieldHomeModel.accountFace(
        meshState: .needsLogin, rememberedLogin: remembered, login: nil, domain: nil, name: nil, face: nil,
        desktops: [], asleep: [], foreignDoors: 0, isHearing: false)
    }
    #expect(face(remembered: nil).signInWord == "Continue with Tailscale")
    #expect(face(remembered: login).signInWord == "Sign in again")
  }

  // MARK: TS-7b — the desktop's code

  private func expecting(_ login: String = "me@example.com", _ arrival: PhoneCodeExpectation.Arrival = .scanned)
    -> PhoneCodeExpectation
  {
    PhoneCodeExpectation(login: login, from: "Studio", arrival: arrival, at: Date(timeIntervalSince1970: 0))
  }

  private func expected(
    _ state: MeshModel.State, remembered: String? = nil, login: String? = nil, failure: String? = nil,
    _ expectation: PhoneCodeExpectation
  ) -> FieldHomeModel.DoorPage? {
    FieldHomeModel.doorPage(
      fixtureOwnsTheField: false, meshState: state, rememberedLogin: remembered, login: login, isGated: true,
      hasListed: true, listed: 1, remembered: 1, machineName: nil, adminConsole: console, signInNote: failure,
      expected: expectation)
  }

  @Test("another account than the code named: Another account?, at once and over any other page")
  func anotherAccount() {
    let page = FieldHomeModel.DoorPage.anotherAccount(
      current: "james@acme.dev", expected: "me@example.com", from: "Studio", byLink: false)
    #expect(expected(.up, login: "james@acme.dev", expecting()) == page)
    #expect(expected(.needsMachineAuth, login: "james@acme.dev", expecting()) == page)
    // A remembered account counts: the phone is that account until it signs out.
    #expect(expected(.off, remembered: "james@acme.dev", expecting()) == page)
    // By a link, Keep this account leads (EL7).
    #expect(
      expected(.up, login: "james@acme.dev", expecting("me@example.com", .link))
        == .anotherAccount(current: "james@acme.dev", expected: "me@example.com", from: "Studio", byLink: true))
  }

  @Test("the account the code named, in any case, is no mismatch")
  func sameAccount() {
    #expect(expected(.up, login: "Me@Example.com", expecting()) == nil)
  }

  @Test("no account yet: a code scanned in the app puts the account to pick on the welcome")
  func welcomeExpecting() {
    #expect(expected(.off, expecting()) == .welcome(failure: nil, expecting: "me@example.com"))
    #expect(expected(.needsLogin, expecting()) == .welcome(failure: nil, expecting: "me@example.com"))
  }

  @Test("WI-2: no account, and a code that came by its link: the desktop that sent you, until a failure says why")
  func fromCode() {
    let link = expecting("me@example.com", .link)
    #expect(expected(.off, link) == .fromCode(desktop: "Studio", login: "me@example.com"))
    #expect(expected(.needsLogin, link) == .fromCode(desktop: "Studio", login: "me@example.com"))
    #expect(
      expected(.failed("the network went away"), link)
        == .welcome(failure: "the network went away", expecting: "me@example.com"))
  }

  @Test("only the node's own login settles the code, in any case")
  func settles() {
    #expect(FieldHomeModel.expectationSettles(expecting(), login: "ME@example.com"))
    #expect(!FieldHomeModel.expectationSettles(expecting(), login: "james@acme.dev"))
    #expect(!FieldHomeModel.expectationSettles(expecting(), login: nil))
    #expect(!FieldHomeModel.expectationSettles(expecting(), login: ""))
    #expect(!FieldHomeModel.expectationSettles(nil, login: "me@example.com"))
  }

  @Test("every stamped account state stamps the page the phone would draw, or the tabs")
  func fixtures() {
    let me = AccountFixtures.login
    let expected: [String: FieldHomeModel.DoorPage?] = [
      "signedin": nil, "asleep": nil, "noface": nil, "guests": nil, "refused": nil, "none-found": nil,
      "firstrun": .welcome(failure: nil),
      "failed-first": .welcome(failure: "the network went away"),
      "attention": .signInAgain(note: nil),
      "approval": .approval(machine: AccountFixtures.machine, adminConsole: console),
      "none": .noDesktops(login: me),
      "expecting": .welcome(failure: nil, expecting: me),
      "from-code": .fromCode(desktop: "Studio", login: me),
      "joining": .joining(login: me, note: nil),
      "looking": .looking(login: me),
      "tour-1": .welcome(failure: nil), "tour-4": .welcome(failure: nil),
      "another": .anotherAccount(current: AccountFixtures.otherLogin, expected: me, from: "Studio", byLink: false),
      "another-link": .anotherAccount(current: AccountFixtures.otherLogin, expected: me, from: "Studio", byLink: true),
    ]
    for (name, door) in expected {
      let demo = AccountFixtures.demo(named: name)
      #expect(demo != nil, "\(name)")
      #expect(demo?.door == door, "\(name)")
    }
    // the way in's own steps, stamped: the found beat over a phone already signed in, How it works over the welcome
    #expect(AccountFixtures.demo(named: "none-found")?.wayIn == .found(name: nil, desktop: "studio"))
    #expect(AccountFixtures.demo(named: "tour-1")?.wayIn == .tour(0))
    #expect(AccountFixtures.demo(named: "tour-4")?.wayIn == .tour(3))
    #expect(AccountFixtures.demo(named: "none")?.wayIn == nil)
    #expect(AccountFixtures.demo(named: "nonsense") == nil)
  }
}
