import FieldDesign
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
}
