import FieldDesign
import Testing

@testable import FieldHome
@testable import FieldMesh

/// IOS-9d — the mock's standings, through the shipping decision: what the
/// corner shows signed in, disconnected and signed out, and that every act
/// in the menu moves the mock the way the real one would move the mesh.
@Suite("the mock account moves the way the real one does")
@MainActor
struct MockAccountTests {
  @Test("signed in: the fox, the name, the login line, studio quiet and mini asleep, Disconnect on offer")
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
    #expect(face.connectionAct == .disconnect)
    #expect(face.canSignOut)
    #expect(mock.desktopIsUp)
    #expect(mock.login == "me@jamesyong42.com")
  }

  @Test("Disconnect puts both desktops to sleep and offers Connect; Connect wakes them")
  func disconnectAndConnect() {
    let mock = MockAccount()
    mock.perform(.disconnect)
    #expect(mock.standing == .off)
    #expect(!mock.desktopIsUp)
    let off = mock.face
    #expect(off.control == .face(AccountFixtures.fox))
    #expect(off.detail == "not connected")
    #expect(off.desktops.map(\.word) == ["asleep", "asleep"])
    #expect(off.connectionAct == .connect)
    #expect(off.canSignOut)
    mock.perform(.connect)
    #expect(mock.standing == .up)
    #expect(mock.face.connectionAct == .disconnect)
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
    mock.perform(.connect)
    #expect(mock.standing == .up)
    #expect(mock.face.control == .face(AccountFixtures.fox))
  }
}
