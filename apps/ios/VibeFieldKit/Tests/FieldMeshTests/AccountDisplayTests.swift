import Testing

@testable import FieldMesh

/// IOS-8b — the corner's rows. The mesh's own vocabulary (`MeshDisplay`) is
/// untouched; what is pinned here is the word a 44 pt row carries for each
/// state the link can report, the memory's word for one it cannot, the one
/// sentence a guest leaves, and the notice at the top of the menu.
@Suite("the account corner's words")
struct AccountDisplayTests {
  private func desktop(
    state: FieldDesktop.State, feed: FieldFeedSource = .none, fieldRefusal: String? = nil
  ) -> FieldDesktop {
    FieldDesktop(
      deviceId: "dev-1", name: "studio", platform: "darwin", state: state, feed: feed,
      fieldRefusal: fieldRefusal)
  }

  @Test("a desktop that answers and feeds needs no word")
  func quietWhenFeeding() {
    #expect(AccountDisplay.desktopWord(desktop(state: .ready, feed: .door), isHearing: true) == .quiet)
    #expect(AccountDisplay.desktopWord(desktop(state: .ready, feed: .store), isHearing: true) == .quiet)
  }

  @Test("a desktop that answered and sent nothing says so, quietly")
  func noFieldYet() {
    let word = AccountDisplay.desktopWord(desktop(state: .ready), isHearing: false)
    #expect(word.word == "no field yet")
    #expect(!word.wantsTheUser)
  }

  @Test("the two refusals and the field's own are the rows that want the person")
  func refusalsWantTheUser() {
    #expect(AccountDisplay.desktopWord(desktop(state: .failed("FORBIDDEN_SCOPE")), isHearing: false) == .init(word: "refused", wantsTheUser: true))
    #expect(AccountDisplay.desktopWord(desktop(state: .refusedDoor("no address")), isHearing: false) == .init(word: "no door", wantsTheUser: true))
    #expect(
      AccountDisplay.desktopWord(desktop(state: .ready, feed: .door, fieldRefusal: "FORBIDDEN_SCOPE"), isHearing: true)
        == .init(word: "field refused", wantsTheUser: true))
    // Whatever MeshDisplay says wants the user, the row says too — one rule.
    for state: FieldDesktop.State in [.failed("x"), .refusedDoor("y"), .noDoor, .connecting, .reconnecting, .ready] {
      let row = desktop(state: state)
      #expect(AccountDisplay.desktopWord(row, isHearing: false).wantsTheUser == MeshDisplay.wantsTheUser(row))
    }
  }

  @Test("the pending and absent doors are words, not attention")
  func pendingWords() {
    #expect(AccountDisplay.desktopWord(desktop(state: .connecting), isHearing: false) == .init(word: "dialing", wantsTheUser: false))
    #expect(AccountDisplay.desktopWord(desktop(state: .reconnecting), isHearing: false) == .init(word: "reconnecting", wantsTheUser: false))
    #expect(AccountDisplay.desktopWord(desktop(state: .noDoor), isHearing: false) == .init(word: "not serving", wantsTheUser: false))
    #expect(AccountDisplay.asleep == "asleep")
  }

  @Test("a guest is one faint sentence, and only when there is one")
  func othersLine() {
    #expect(AccountDisplay.othersLine(count: 0) == nil)
    #expect(AccountDisplay.othersLine(count: 1) == "1 other account’s desktop on this tailnet — not yours, not shown.")
    #expect(AccountDisplay.othersLine(count: 3) == "3 other accounts’ desktops on this tailnet — not yours, not shown.")
  }

  @Test("the notice speaks only when the mesh needs the person")
  func notice() {
    #expect(AccountDisplay.notice(state: .needsLogin) == "Sign in to your tailnet to reach your desktops.")
    #expect(AccountDisplay.notice(state: .needsMachineAuth) == "This device awaits machine authorization on the tailnet.")
    #expect(AccountDisplay.notice(state: .failed("boom")) == "The mesh failed — boom.")
    for state: MeshModel.State in [.off, .starting, .up, .stopping] {
      #expect(AccountDisplay.notice(state: state) == nil)
    }
  }

  @Test("under the name, the connection's word while the mesh is not up")
  func connectionDetail() {
    #expect(AccountDisplay.connectionDetail(state: .off) == "not connected")
    #expect(AccountDisplay.connectionDetail(state: .starting) == "connecting…")
    #expect(AccountDisplay.connectionDetail(state: .needsLogin) == "sign in again")
    #expect(AccountDisplay.connectionDetail(state: .up) == nil)
  }
}
