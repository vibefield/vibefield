import FieldDesign
import Testing

@testable import FieldHome
@testable import FieldMesh

/// IOS-8b — the corner's whole answer, one state at a time. The words are
/// `MeshDisplay`'s and `AccountDisplay`'s and stay pinned there; what is
/// pinned HERE is which face the corner wears, when it wears the dot, what the
/// line under the name says, which rows the menu holds and which act it
/// offers — the page's seven states, as decisions.
@Suite("the corner is the account")
struct AccountFaceTests {
  private let login = "me@example.com"
  private let domain = "example.ts.net"
  private let fox = UserFace(emoji: "🦊")

  private func desktop(
    id: String = "dev-1", name: String = "studio", state: FieldDesktop.State,
    feed: FieldFeedSource = .none, fieldRefusal: String? = nil
  ) -> FieldDesktop {
    FieldDesktop(
      deviceId: id, name: name, platform: "darwin", state: state, feed: feed, fieldRefusal: fieldRefusal)
  }

  private func face(
    meshState: MeshModel.State, remembered: String? = nil, login: String? = nil, domain: String? = nil,
    name: String? = nil, face: UserFace? = nil, desktops: [FieldDesktop] = [],
    asleep: [FieldHomeModel.AsleepDesktop] = [], foreignDoors: Int = 0, isHearing: Bool = false,
    restarting: Set<String> = []
  ) -> FieldHomeModel.AccountFace {
    FieldHomeModel.accountFace(
      meshState: meshState, rememberedLogin: remembered, login: login, domain: domain, name: name,
      face: face, desktops: desktops, asleep: asleep, foreignDoors: foreignDoors, isHearing: isHearing,
      restarting: restarting)
  }

  /// DS — the ruled pick (behaviour only): a remembered desktop the tailnet no longer lists, whose own slice
  /// announces an update restart that holds, is drawn as a desktop that answers (no word), never asleep; the one
  /// beside it that announced nothing is asleep as before.
  @Test("a remembered desktop mid-update reads as it did while it answered, never asleep")
  func rememberedMidUpdateIsNotAsleep() {
    let corner = face(
      meshState: .up, login: login, domain: domain,
      asleep: [.init(deviceId: "dev-2", name: "mini"), .init(deviceId: "dev-3", name: "studio")],
      isHearing: true, restarting: ["dev-3"])
    #expect(corner.desktops.first { $0.id == "dev-3" }?.word == nil)
    #expect(corner.desktops.first { $0.id == "dev-3" }?.wantsTheUser == false)
    #expect(corner.desktops.first { $0.id == "dev-2" }?.word == AccountDisplay.asleep)
  }

  @Test("not signed in: the corner is the act, and there is nothing to sign out of")
  func notSignedIn() {
    let corner = face(meshState: .off)
    #expect(corner.control == .signIn)
    #expect(!corner.wantsAttention)
    #expect(corner.desktops.isEmpty)
    #expect(!corner.offersSignIn)
    #expect(!corner.canSignOut)
    #expect(corner.notice == nil)
  }

  @Test("signed in and everything reachable: the face, the login line, quiet rows, no dot")
  func signedIn() {
    let corner = face(
      meshState: .up, login: login, domain: domain, name: "James", face: fox,
      desktops: [desktop(state: .ready, feed: .door)], isHearing: true)
    #expect(corner.control == .face(fox))
    #expect(!corner.wantsAttention)
    #expect(corner.name == "James")
    #expect(corner.detail == "me@example.com · example.ts.net")
    #expect(corner.detailIsLogin)
    #expect(corner.desktops == [.init(id: "dev-1", name: "studio", word: nil, wantsTheUser: false, platform: "darwin")])
    #expect(corner.othersLine == nil)
    #expect(!corner.offersSignIn)
    #expect(corner.canSignOut)
  }

  @Test("first sign-in, before any desktop answered: a plain circle, and the login stands in for the name")
  func noFaceYet() {
    let corner = face(meshState: .up, login: login, domain: domain)
    #expect(corner.control == .blank)
    #expect(corner.name == login)
    #expect(corner.detail == "signed in to example.ts.net")
    #expect(!corner.detailIsLogin)
  }

  @Test("the mesh off with a remembered login: the face, the desktops asleep, and no act — it re-dials by itself")
  func desktopsAsleep() {
    let corner = face(
      meshState: .off, remembered: login, face: fox,
      asleep: [.init(deviceId: "dev-2", name: "mini"), .init(deviceId: "dev-1", name: "studio")])
    #expect(corner.control == .face(fox))
    #expect(!corner.wantsAttention)
    #expect(corner.detail == "not connected")
    #expect(corner.desktops.map(\.name) == ["mini", "studio"])
    #expect(corner.desktops.allSatisfy { $0.word == "asleep" && !$0.wantsTheUser })
    #expect(!corner.offersSignIn)
    #expect(corner.canSignOut)
  }

  @Test("a remembered desktop that is live again is one row, not two")
  func liveOutranksMemory() {
    let corner = face(
      meshState: .up, login: login, domain: domain, face: fox,
      desktops: [desktop(id: "dev-1", state: .ready, feed: .door)],
      asleep: [.init(deviceId: "dev-1", name: "studio"), .init(deviceId: "dev-2", name: "mini")],
      isHearing: true)
    #expect(corner.desktops.map(\.id) == ["dev-1", "dev-2"])
    #expect(corner.desktops[0].word == nil)
    #expect(corner.desktops[1].word == "asleep")
  }

  @Test("sign in again: the dot, the notice, the orange line, the act")
  func signInAgain() {
    let corner = face(meshState: .needsLogin, remembered: login, face: fox)
    #expect(corner.control == .face(fox))
    #expect(corner.wantsAttention)
    #expect(corner.notice == "Sign in to Tailscale again to reach your desktops.")
    #expect(corner.detail == "sign in again")
    #expect(corner.detailWantsAttention)
    #expect(corner.offersSignIn)
  }

  @Test("a refused desktop is the other cause of the dot, and its row says so")
  func refusedDesktop() {
    let corner = face(
      meshState: .up, login: login, domain: domain, face: fox,
      desktops: [desktop(id: "a", name: "studio", state: .ready, feed: .door), desktop(id: "b", name: "mini", state: .failed("FORBIDDEN_SCOPE"))],
      isHearing: true)
    #expect(corner.wantsAttention)
    #expect(corner.notice == nil)
    #expect(corner.desktops[1] == .init(id: "b", name: "mini", word: "refused", wantsTheUser: true, platform: "darwin"))
  }

  @Test("another account's desktop nearby is one faint sentence and no dot")
  func guests() {
    let corner = face(meshState: .up, login: login, domain: domain, face: fox, foreignDoors: 1, isHearing: true)
    #expect(!corner.wantsAttention)
    #expect(corner.othersLine == "1 other account’s desktop on this tailnet — not yours, not shown.")
  }

  @Test("connecting: nothing to act on yet, the line says so")
  func connecting() {
    let corner = face(meshState: .starting, remembered: login)
    #expect(corner.control == .blank)
    #expect(corner.detail == "connecting…")
    #expect(!corner.offersSignIn)
  }

  @Test("a drop while signed in: the face stays, no dot, the line says reconnecting…, and nothing to tap")
  func reconnecting() {
    // 2026-10-18 — the phone stays connected by itself: a lost mesh is the
    // mesh's own news, re-dialled on its backoff, never a button for the person.
    let corner = face(meshState: .reconnecting("the network went away"), remembered: login, face: fox)
    #expect(corner.control == .face(fox))
    #expect(!corner.wantsAttention)
    #expect(corner.detail == "reconnecting…")
    #expect(!corner.detailWantsAttention)
    #expect(corner.notice == nil)
    #expect(!corner.offersSignIn)
    #expect(corner.canSignOut)
  }

  @Test("the pre-login window with no account remembered is not the sign-in pill")
  func preLoginWindow() {
    // A node is up and waiting for Tailscale's answer; the corner holds a
    // plain circle and the notice says what to do — the pill is only for a
    // phone with no node and no account at all.
    let corner = face(meshState: .needsLogin)
    #expect(corner.control == .blank)
    #expect(corner.offersSignIn)
    #expect(!corner.canSignOut)
  }

  // MARK: - WI-W2e A (asked for on the page The Way In, 2026-11-14; DESIGN.md §9 "The way in", ruled that day)

  @Test("a start that failed says Couldn’t connect. and offers its next step, Try again, in Sign in's place")
  func couldNotConnect() {
    // The one Couldn’t connect. a corner with an account stands in: the node reported its login, the phone could not
    // keep it, and the start failed (`MeshModel.dropped` re-dials only a kept login, as `.reconnecting`).
    let corner = face(meshState: .failed("tsnet: dial tcp 100.64.0.1:443: i/o timeout"), login: login, face: fox)
    #expect(corner.notice == "Couldn’t connect.")
    #expect(corner.offersTryAgain)
    #expect(corner.tryAgainWord == "Try again")
    #expect(!corner.offersSignIn)
    #expect(corner.canSignOut)
    let rows = AccountCornerView.menuRows(
      canSignOut: corner.canSignOut, offersSignIn: corner.offersSignIn, offersTryAgain: corner.offersTryAgain,
      lockOn: false)
    #expect(rows == [.signOut, .tryAgain, .theme, .settings])
  }

  @Test("Try again stands only under Couldn’t connect.: a drop re-dials by itself, and Tailscale asking is Sign in's")
  func tryAgainOnlyWhenFailed() {
    let states: [MeshModel.State] = [
      .off, .starting, .needsLogin, .needsMachineAuth, .up, .stopping, .reconnecting("the network went away"),
    ]
    for state in states {
      let corner = face(meshState: state, remembered: login, face: fox)
      #expect(!corner.offersTryAgain, "\(state)")
    }
    // in Sign in's place, above Theme, and Lock now keeps its place just above Settings…
    let rows = AccountCornerView.menuRows(canSignOut: true, offersSignIn: false, offersTryAgain: true, lockOn: true)
    #expect(rows == [.signOut, .tryAgain, .theme, .lockNow, .settings])
  }
}
