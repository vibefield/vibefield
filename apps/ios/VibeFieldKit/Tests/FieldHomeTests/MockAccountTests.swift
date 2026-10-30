import FieldDesign
import Foundation
import Testing

@testable import FieldHome
@testable import FieldMesh

/// IOS-9d — the mock's standings, through the shipping decision: what the
/// corner shows signed in, re-dialling and signed out, and that every act
/// in the menu moves the mock the way the real one would move the mesh.
@Suite("the mock account moves the way the real one does")
@MainActor
struct MockAccountTests {
  @Test("signed in: the fox, the name, the login line, studio quiet and mini asleep, nothing to connect")
  func signedIn() {
    let mock = MockAccount()
    let face = mock.face
    #expect(face.control == .face(AccountFixtures.fox))
    #expect(face.name == "James")
    #expect(face.detail == "me@jamesyong42.com · tail3f2a8c.ts.net")
    #expect(face.detailIsLogin)
    #expect(!face.wantsAttention)
    #expect(face.desktops.map(\.name) == ["studio", "mini"])
    #expect(face.desktops.map(\.word) == [nil, "asleep"])
    #expect(!face.offersSignIn)
    #expect(face.canSignOut)
    #expect(mock.desktopIsUp)
    #expect(mock.login == "me@jamesyong42.com")
  }

  @Test("a lost mesh puts both desktops to sleep and offers nothing: the phone re-dials by itself")
  func reconnecting() {
    let mock = MockAccount()
    mock.standing = .reconnecting
    #expect(!mock.desktopIsUp)
    let lost = mock.face
    #expect(lost.control == .face(AccountFixtures.fox))
    #expect(lost.detail == "reconnecting…")
    #expect(lost.desktops.map(\.word) == ["asleep", "asleep"])
    #expect(!lost.offersSignIn)
    #expect(lost.canSignOut)
  }

  @Test("Sign out empties the corner to the Sign in pill; Sign in fills it again with no login page")
  func signOutAndIn() {
    let mock = MockAccount()
    mock.signOut()
    #expect(mock.standing == .signedOut)
    let out = mock.face
    #expect(out.control == .signIn)
    #expect(!out.canSignOut)
    #expect(out.desktops.isEmpty)
    #expect(mock.login == nil)
    mock.signIn()
    #expect(mock.standing == .up)
    #expect(mock.face.control == .face(AccountFixtures.fox))
  }

  @Test("TS-7: the Field page's door follows the standing — the welcome signed out, the field signed in")
  func door() {
    let mock = MockAccount()
    #expect(mock.door == nil)
    mock.standing = .reconnecting
    #expect(mock.door == nil)
    mock.signOut()
    #expect(mock.door == .welcome(failure: nil))
  }

  @Test("TS-7: waiting for approval — the dot, the line, and the approval page with the console")
  func approval() {
    let mock = MockAccount()
    mock.standing = .approval
    #expect(mock.face.wantsAttention)
    #expect(mock.face.detail == "waiting for approval")
    #expect(mock.face.notice == "An admin of your Tailscale network approves new devices.")
    #expect(
      mock.door
        == .approval(
          machine: AccountFixtures.machine, adminConsole: URL(string: "https://login.tailscale.com/admin/machines")))
  }

  @Test("TS-7: the scripted fleet is the field only while no door stands — none under the welcome or the approval")
  func fleetOnlyWithoutADoor() {
    let mock = MockAccount()
    #expect(mock.fieldIsLive)
    mock.standing = .reconnecting
    #expect(mock.fieldIsLive)
    mock.standing = .approval
    #expect(!mock.fieldIsLive)
    mock.signOut()
    #expect(!mock.fieldIsLive)
    mock.signIn()
    #expect(mock.fieldIsLive)
  }
}
