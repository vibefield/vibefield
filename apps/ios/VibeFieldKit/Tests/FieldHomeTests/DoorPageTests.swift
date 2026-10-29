import FieldDesign
import Foundation
import Testing

@testable import FieldHome
@testable import FieldMesh

/// TS-7 — which page of the account's door stands on the Field tab
/// (`FieldHomeModel.doorPage`; DESIGN.md §9 "The phone's door"), and the
/// found beat that hands "No desktops yet" to the field.
@Suite("the Field page's door is decided by the account, the mesh and the first listing")
@MainActor
struct DoorPageTests {
  private let login = "me@example.com"
  private let console = URL(string: "https://login.tailscale.com/admin/machines")

  private func page(
    fixture: Bool = false, _ state: MeshModel.State, remembered: String? = nil, login: String? = nil,
    gated: Bool = true, hasListed: Bool = true, listed: Int = 0, rememberedDesktops: Int = 0,
    machine: String? = "iphone-17-pro", note: String? = nil, found: FieldHomeModel.FoundDesktop? = nil
  ) -> FieldHomeModel.DoorPage? {
    FieldHomeModel.doorPage(
      fixtureOwnsTheField: fixture, meshState: state, rememberedLogin: remembered, login: login, isGated: gated,
      hasListed: hasListed, listed: listed, remembered: rememberedDesktops, machineName: machine,
      adminConsole: console, signInNote: note, found: found)
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

  @Test("an account remembered: no welcome while the phone re-dials on its own")
  func rememberedIsNotAWelcome() {
    for state: MeshModel.State in [.off, .starting, .stopping, .reconnecting("gone"), .failed("gone")] {
      #expect(page(state, remembered: login) == nil, "\(state)")
    }
  }

  @Test("signed in and waiting: the approval page names this phone and the console")
  func approval() {
    #expect(page(.needsMachineAuth, login: login) == .approval(machine: "iphone-17-pro", adminConsole: console))
    // Before Layer 3 has a name, and on a custom control server: the page,
    // with what it has.
    #expect(
      FieldHomeModel.doorPage(
        fixtureOwnsTheField: false, meshState: .needsMachineAuth, rememberedLogin: nil, login: nil, isGated: false,
        hasListed: false, listed: 0, remembered: 0, machineName: nil, adminConsole: nil, signInNote: nil, found: nil)
        == .approval(machine: nil, adminConsole: nil))
  }

  @Test("the tailnet asks a remembered account again: Sign in again, expired and removed as one page")
  func signInAgain() {
    #expect(page(.needsLogin, remembered: login) == .signInAgain(note: nil))
    #expect(page(.needsLogin, remembered: login, note: "a reason") == .signInAgain(note: "a reason"))
  }

  @Test("up, gated, answered, nothing listed and nothing remembered: No desktops yet")
  func noDesktops() {
    #expect(page(.up, login: login) == .noDesktops(login: login, found: nil))
    // The remembered login stands in until the node reports its own.
    #expect(page(.up, remembered: login) == .noDesktops(login: login, found: nil))
  }

  @Test("No desktops yet is an answer, never the blank before one")
  func noDesktopsWaitsForTheAnswer() {
    #expect(page(.up, login: login, hasListed: false) == nil)
    #expect(page(.up, login: login, gated: false) == nil)
    #expect(page(.up, login: login, listed: 1) == nil)
    #expect(page(.up, login: login, rememberedDesktops: 1) == nil)
    // Up with no login yet is the beat before the re-gate.
    #expect(page(.up) == nil)
  }

  @Test("the found beat holds the page with the desktop in its row")
  func foundHolds() {
    let found = FieldHomeModel.FoundDesktop(name: "studio", platform: "darwin")
    #expect(page(.up, login: login, listed: 1, rememberedDesktops: 1, found: found) == .noDesktops(login: login, found: found))
  }

  @Test("a fixture owns the field: no page over its photograph, in any state")
  func fixtureOwnsTheField() {
    for state: MeshModel.State in [.off, .needsLogin, .needsMachineAuth, .up, .failed("x")] {
      #expect(page(fixture: true, state) == nil, "\(state)")
    }
  }

  @Test("the beat begins only when No desktops yet yields to the field with a desktop listed")
  func foundBeat() {
    let studio = FieldDesktop(deviceId: "dev-1", name: "studio", platform: "darwin", state: .ready, feed: .door)
    let none = FieldHomeModel.DoorPage.noDesktops(login: login, found: nil)
    #expect(
      FieldHomeModel.foundDesktop(previous: none, next: nil, desktops: [studio])
        == .init(name: "studio", platform: "darwin"))
    #expect(FieldHomeModel.foundDesktop(previous: none, next: nil, desktops: []) == nil)
    #expect(FieldHomeModel.foundDesktop(previous: none, next: .welcome(failure: nil), desktops: [studio]) == nil)
    #expect(FieldHomeModel.foundDesktop(previous: .welcome(failure: nil), next: nil, desktops: [studio]) == nil)
    // The beat's own end yields to the field and does not begin another.
    let held = FieldHomeModel.DoorPage.noDesktops(login: login, found: .init(name: "studio", platform: "darwin"))
    #expect(FieldHomeModel.foundDesktop(previous: held, next: nil, desktops: [studio]) == nil)
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

  @Test("No desktops yet's sentence names the login and the Mac's own words")
  func noDesktopsLine() {
    let line = String(DoorPageView.noDesktopsLine(login: login).characters)
    #expect(
      line
        == "Signed in as me@example.com. On your Mac, open VibeField, click your face, then Connect your devices… with this same account."
    )
  }

  // MARK: TS-7b — the Mac's code

  private func expecting(_ login: String = "me@example.com", _ arrival: PhoneCodeExpectation.Arrival = .scanned)
    -> PhoneCodeExpectation
  {
    PhoneCodeExpectation(login: login, from: "Studio", arrival: arrival, at: Date(timeIntervalSince1970: 0))
  }

  private func expected(
    _ state: MeshModel.State, remembered: String? = nil, login: String? = nil, _ expectation: PhoneCodeExpectation
  ) -> FieldHomeModel.DoorPage? {
    FieldHomeModel.doorPage(
      fixtureOwnsTheField: false, meshState: state, rememberedLogin: remembered, login: login, isGated: true,
      hasListed: true, listed: 1, remembered: 1, machineName: nil, adminConsole: console, signInNote: nil, found: nil,
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

  @Test("no account yet: the welcome says which account to pick at Tailscale")
  func welcomeExpecting() {
    #expect(expected(.off, expecting()) == .welcome(failure: nil, expecting: "me@example.com"))
    #expect(expected(.needsLogin, expecting()) == .welcome(failure: nil, expecting: "me@example.com"))
  }

  @Test("only the node's own login settles the code, in any case")
  func settles() {
    #expect(FieldHomeModel.expectationSettles(expecting(), login: "ME@example.com"))
    #expect(!FieldHomeModel.expectationSettles(expecting(), login: "james@acme.dev"))
    #expect(!FieldHomeModel.expectationSettles(expecting(), login: nil))
    #expect(!FieldHomeModel.expectationSettles(expecting(), login: ""))
    #expect(!FieldHomeModel.expectationSettles(nil, login: "me@example.com"))
  }

  @Test("Another account? names both logins and how the code came")
  func anotherAccountLine() {
    #expect(
      DoorPageView.anotherAccountLine(current: "james@acme.dev", expected: "me@example.com", from: "Studio", byLink: false)
        == "This phone is signed in as james@acme.dev, but the code you scanned came from Studio, signed in as me@example.com.")
    #expect(
      DoorPageView.anotherAccountLine(current: "a@b", expected: "c@d", from: "Mini", byLink: true)
        == "This phone is signed in as a@b, but the link you opened came from Mini, signed in as c@d.")
  }

  @Test("every stamped account state stamps the page the phone would draw beside its corner")
  func fixtures() {
    let me = AccountFixtures.login
    let expected: [String: FieldHomeModel.DoorPage?] = [
      "signedin": nil, "asleep": nil, "noface": nil, "guests": nil, "refused": nil,
      "firstrun": .welcome(failure: nil),
      "failed-first": .welcome(failure: "the network went away"),
      "attention": .signInAgain(note: nil),
      "approval": .approval(machine: AccountFixtures.machine, adminConsole: console),
      "none": .noDesktops(login: me, found: nil),
      "none-found": .noDesktops(login: me, found: .init(name: "studio", platform: "darwin")),
      "expecting": .welcome(failure: nil, expecting: me),
      "another": .anotherAccount(current: AccountFixtures.otherLogin, expected: me, from: "Studio", byLink: false),
      "another-link": .anotherAccount(current: AccountFixtures.otherLogin, expected: me, from: "Studio", byLink: true),
    ]
    for (name, door) in expected {
      let demo = AccountFixtures.demo(named: name)
      #expect(demo != nil, "\(name)")
      #expect(demo?.door == door, "\(name)")
    }
    #expect(AccountFixtures.demo(named: "nonsense") == nil)
  }
}
