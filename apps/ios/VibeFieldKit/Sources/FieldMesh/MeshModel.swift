import FieldFreeway
import FieldProduct
import Foundation
import Network
import Observation
import Truffle
import UIKit

/// One online peer, reduced to what the roster renders.
public struct MeshPeerView: Identifiable, Sendable, Equatable {
  public let id: String
  public let name: String
  public let address: String?

  public init(id: String, name: String, address: String?) {
    self.id = id
    self.name = name
    self.address = address
  }
}

/// The phone's mesh presence: an app-owned Truffle node with interactive
/// Tailscale login, wrapped as honest UI state.
///
/// It keeps itself up (2026-10-18, James: "the phone should automatically
/// connect to desktop as long as the account is logged in … it is auto
/// connected and maintained connection all the time"). While this phone
/// remembers a login, `keepUp()` — at launch, on coming to the front and when
/// the network returns — starts the node, replaces a dead one and re-dials a
/// drop on the product client's backoff. Signing in and signing out are the
/// person's acts; there is no connect and no disconnect. Every state still
/// renders as itself: sign-in is sign-in, a drop is `reconnecting` with its
/// reason, a first sign-in that failed carries its reason. The corpus law
/// stands: the phone is a client on the mesh, never a device row (it runs no
/// fieldd).
///
/// The node is `FieldTruffleRuntime`'s and not ghosttea's, for one reason
/// given in full at that declaration: the namespace a node joins is the app id
/// it was started with, and ghosttea's runtime can only ever join its own.
@MainActor
@Observable
public final class MeshModel {
  public enum State: Equatable, Sendable {
    case off
    case starting
    case needsLogin
    case needsMachineAuth
    case up
    case stopping
    case failed(String)
    /// The node dropped, or a start failed, on a phone that is signed in:
    /// another start waits on the backoff. The reason is the last failure's.
    case reconnecting(String)
  }

  /// A login page pending presentation (Safari sheet).
  public struct LoginPage: Identifiable, Equatable {
    public let url: URL
    public var id: URL { url }
  }

  public private(set) var state: State = .off
  public private(set) var peers: [MeshPeerView] = []
  public private(set) var loginPage: LoginPage?
  /// UA-P-1c — the tailnet this node is signed in to, as a drawable fact.
  ///
  /// The same string `magicDNSSuffix` computes, kept as observable state
  /// because a sheet cannot await a property. It had never been drawn anywhere:
  /// the phone computed its own tailnet domain to pin a peer's door to that
  /// peer and showed no part of the account chain to the person holding it.
  ///
  /// It was the INTERIM account line (UA-P-D3) — the domain is not the login.
  /// Since UA-P-5 it is the line's SECOND half, and `loginName` is the first;
  /// see `MeshDisplay.accountLine`. `nil` until the node is up.
  public private(set) var tailnetDomain: String?
  /// UA-P-5 — the tailnet login this node is signed in as (RFC 025 §3.6, D7),
  /// as a drawable fact.
  ///
  /// It is the WHO the account line could not say. `nil` until Layer 3 has
  /// reported it, and absent is absent: the Apple plane reads the login
  /// through a status overlay that can fail (RFC 024 §8.1.2), so a nil here
  /// means "this node cannot currently state who it is" and never "nobody".
  public private(set) var loginName: String?
  /// UA-P-5 — whether this node's mesh is gated on this account's login.
  ///
  /// `false` is the honest pre-login window: an ungated node is on the whole
  /// tailnet, which is why nothing content-bearing rides the store bus until
  /// this is true (UA-P-D2, and `FieldLink`'s `storeBus`).
  public private(set) var isGatedOnAccount = false
  /// A standing account note — why the gate could not be recorded, when it
  /// could not. Absent is the ordinary case.
  public private(set) var accountNote: String?
  /// IOS-8b — the login this phone REMEMBERS (`account.login` beside truffle's
  /// state), whether or not a node is running. The corner asks "who is this
  /// phone signed in as" before CONNECT, and the answer was on disk all along;
  /// `loginName` above is the running node's report and goes with the node.
  public private(set) var rememberedLogin: String?
  /// Where the remembered login lives, for the reads here and the sign-out at
  /// IOS-8d. Nil where the device has no state directory to keep one in.
  @ObservationIgnored private let stateDirectory: URL?
  /// The pre-rename directory a sign-out must also remove (see `SignOutSweep`);
  /// nil under an injected state directory, which has no legacy sibling.
  @ObservationIgnored private let legacyStateDirectory: URL?

  @ObservationIgnored private var runtime: FieldTruffleRuntime?
  @ObservationIgnored private var eventsTask: Task<Void, Never>?
  @ObservationIgnored private var lastLoginURL: URL?
  /// Whether a login page the node asks for is put in front of the person. A
  /// start the person made (`signIn()`) presents it; a start `keepUp()` made
  /// only records it, and the corner offers Sign in — Safari never opens on
  /// its own.
  @ObservationIgnored private var presentsLogin = false
  /// The next start after a drop, waiting on the backoff, and how many came
  /// before it since the mesh was last up.
  @ObservationIgnored private var retryTask: Task<Void, Never>?
  @ObservationIgnored private var retryAttempt = 0
  /// The network coming back is a reason to retry at once rather than at the
  /// end of the backoff.
  @ObservationIgnored private var pathMonitor: NWPathMonitor?
  /// UA-P-5's latch: one re-gate at a time. Set synchronously, because the
  /// account is re-read from several events and two restarts racing each
  /// other would leave a node nobody holds.
  @ObservationIgnored private var regating = false

  /// `stateDirectory` names the node's state for a test on a scratch
  /// directory; the app passes nothing and gets truffle's own.
  public init(stateDirectory: URL? = nil) {
    self.stateDirectory =
      stateDirectory ?? FieldTruffleRuntime.defaultStateDirectory(appID: FieldMeshContract.appID)
    legacyStateDirectory =
      stateDirectory == nil
      ? FieldTruffleRuntime.defaultStateDirectory(appID: FieldTruffleRuntime.legacyGhostteaAppID) : nil
    rememberedLogin = self.stateDirectory.map(AccountLoginStore.init(stateDirectory:))?.read()
  }

  /// The re-dial ladder's ceiling: the product client's 500 ms doubling, held
  /// at a minute.
  static let retryCeiling: Duration = .seconds(60)

  public var isRunning: Bool { runtime != nil && state != .stopping }

  /// The running node itself, for the surfaces that speak the mesh's own
  /// protocols rather than Ghosttea's (IOS-4b's synced-store reader).
  ///
  /// Same shape and same reason as `directory` above: `async` by the door's
  /// own convention, optional because "there is no runtime" is the only thing
  /// the optionality means, and not observable because it is a door rather
  /// than display state.
  public var node: MeshNode? {
    get async { runtime?.node }
  }

  /// UA-P-5 — the gate, asked of the RUNTIME rather than read from the
  /// observable copy above.
  ///
  /// The link is built in a task that already awaits `node`, and the
  /// observable copy is set by `refreshAccount()` on the same events that make
  /// the mesh look up. Reading the copy there is a race with a silent loser: a
  /// link built one beat early gets its store bus off and never re-arms it,
  /// because nothing re-builds a link that is already open. So the wiring asks
  /// the thing that knows.
  public var nodeIsGatedOnAccount: Bool {
    get async {
      guard let runtime else { return false }
      return await runtime.isGatedOnAccount
    }
  }

  /// This node's own login, asked of the runtime, for the same reason.
  public var nodeLoginName: String? {
    get async {
      guard let runtime else { return nil }
      return await runtime.loginName
    }
  }

  /// A `URLSession` factory bound to the MESH's own network, for the surfaces
  /// that dial a desktop over the tailnet (TM-5's terminal legs).
  ///
  /// It exists so a caller can hold the ability to dial without holding a
  /// truffle type: the phone's tailnet is a userspace netstack in this process,
  /// so a plain `URLSession` sends a `100.x` address nowhere, and this is the
  /// one session that routes. `nil` means there is no runtime — never "the node
  /// has no session".
  public var urlSessionProvider:
    (@Sendable (URLSessionConfiguration) async throws -> URLSession)?
  {
    get async {
      guard let node = runtime?.node else { return nil }
      return { configuration in try await node.urlSession(configuration: configuration) }
    }
  }

  /// F1 (FW-DF-11) — how the desktop `deviceId` is dialed for its freeway link: a RAW tailnet
  /// stream from the node to the desktop's freeway serve — never a URL through TailscaleKit's
  /// loopback SOCKS5 listener, which iOS can make stale while the app is suspended. The peer is
  /// looked up again at every dial: truffle generation-checks a peer snapshot before dialing, so a
  /// kept one would fail every redial after the peer re-announced. Nil while there is no runtime or
  /// the desktop is not in reach.
  public func freewayDialing(
    to deviceId: String, deviceName: String?,
    approve: @escaping @Sendable () async throws -> FieldProduct.JSONValue
  ) async -> FreewayDesktopLink.Dialing? {
    guard let runtime, let peer = await runtime.peers().first(where: { $0.deviceId == deviceId })
    else { return nil }
    let suffix = await magicDNSSuffix
    let host = suffix.map { "\(peer.hostname).\($0)" } ?? peer.tailnetIPs.first ?? peer.hostname
    return FreewayDesktopLink.Dialing(
      dial: {
        guard let live = await runtime.peers().first(where: { $0.deviceId == deviceId }) else {
          throw FreewayDialError.notInReach
        }
        return MeshFreewayStream(
          connection: try await runtime.node.dial(to: live, port: UInt16(FreewayContract.servePort)))
      },
      host: host, deviceId: deviceId, approve: approve, deviceName: deviceName)
  }

  /// This node's own tailnet domain (`studio.tail1234.ts.net` → `tail1234.ts.net`).
  ///
  /// It is a fact about the tailnet we are ON, which is what makes it usable
  /// as the suffix a peer's fully-qualified name must have: building the FQDN
  /// from it keeps every host comparison an equality instead of a prefix
  /// match, and a prefix match on a slug is how `studio.attacker.example` gets
  /// mistaken for `studio` (EL7 M1).
  public var magicDNSSuffix: String? {
    get async {
      guard let name = await runtime?.node.dnsName else { return nil }
      let labels = name.split(separator: ".", omittingEmptySubsequences: true)
      guard labels.count > 1 else { return nil }
      return labels.dropFirst().joined(separator: ".")
    }
  }

  /// What `keepUp()` does, pure (pinned by tests). A signed-in phone with no
  /// node starts one, a dead node is replaced, a living one is asked again, and
  /// one already moving — or mid re-gate — is left to move. Signed out, nothing:
  /// the first sign-in is the person's.
  enum KeepUpStep: Equatable, Sendable {
    case start, restart, refresh, nothing
  }

  nonisolated static func keepUpStep(
    signedIn: Bool, state: State, hasRuntime: Bool, regating: Bool
  ) -> KeepUpStep {
    guard signedIn, !regating else { return .nothing }
    switch state {
    case .starting, .stopping: return .nothing
    case .off, .failed, .reconnecting: return hasRuntime ? .restart : .start
    case .needsLogin, .needsMachineAuth, .up: return hasRuntime ? .refresh : .start
    }
  }

  /// Keep this phone on the mesh while it is signed in. Idempotent; the home
  /// screen calls it at launch and on coming to the front, and the network
  /// returning calls it while a re-dial waits.
  public func keepUp() {
    watchNetwork()
    let step = Self.keepUpStep(
      signedIn: rememberedLogin != nil, state: state, hasRuntime: runtime != nil, regating: regating)
    if step != .nothing {
      retryTask?.cancel()
      retryTask = nil
    }
    switch step {
    case .start: start(presentingLogin: false)
    case .restart: restart()
    case .refresh:
      guard let runtime else { return }
      Task {
        try? await runtime.refresh()
        await applyCurrentPhase()
      }
    case .nothing: break
    }
  }

  /// The person's SIGN IN: the first sign-in starts a node and puts its login
  /// page in front of them; a node already standing re-surfaces the page.
  public func signIn() {
    // `regating` as well as the runtime: UA-P-5's restart has a beat with no
    // runtime in hand, and a tap landing in it would start a second node.
    if runtime == nil, !regating {
      retryTask?.cancel()
      retryTask = nil
      start(presentingLogin: true)
    } else {
      requestLogin()
    }
  }

  /// The app went to the background. The node stays (a hello per app switch
  /// is the opposite of a budget); a waiting re-dial does not, and coming back
  /// to the front (`keepUp()`) dials at once.
  public func sceneDidEnterBackground() {
    retryTask?.cancel()
    retryTask = nil
  }

  private func start(presentingLogin: Bool) {
    presentsLogin = presentingLogin
    state = .starting
    Task { await startRuntime() }
  }

  /// A node that stopped or failed still holds its runtime: stop it for good,
  /// then start another. `self.runtime` points at the old node through the
  /// stop, so a `keepUp()` landing meanwhile sees `.starting` and waits.
  private func restart() {
    guard let old = runtime else {
      start(presentingLogin: false)
      return
    }
    eventsTask?.cancel()
    eventsTask = nil
    peers = []
    presentsLogin = false
    state = .starting
    Task {
      await old.stop()
      guard self.runtime === old, state == .starting else { return }
      self.runtime = nil
      await startRuntime()
    }
  }

  /// The node went away under a signed-in phone: say so, and dial again on
  /// the backoff. A first sign-in that failed is not retried by itself; its
  /// reason stands until the person signs in again.
  private func dropped(_ reason: String) {
    guard rememberedLogin != nil else {
      state = .failed(reason)
      return
    }
    let delay = FieldProductClient.backoff(attempt: retryAttempt, ceiling: Self.retryCeiling)
    retryAttempt += 1
    state = .reconnecting(reason)
    retryTask?.cancel()
    retryTask = Task { [weak self] in
      try? await Task.sleep(for: delay)
      guard let self, !Task.isCancelled else { return }
      self.retryTask = nil
      self.keepUp()
    }
  }

  /// The network coming back while a re-dial waits: dial now.
  private func watchNetwork() {
    guard pathMonitor == nil else { return }
    let monitor = NWPathMonitor()
    monitor.pathUpdateHandler = { [weak self] path in
      guard path.status == .satisfied else { return }
      Task { @MainActor in
        guard let self, case .reconnecting = self.state else { return }
        self.keepUp()
      }
    }
    monitor.start(queue: DispatchQueue(label: "vibefield.mesh.path"))
    pathMonitor = monitor
  }

  /// IOS-8d (AP-D4) — sign out: leave the mesh, forget this account's login
  /// and the node's keys, and clear what the field taught this phone. The
  /// sweep runs AFTER the node has stopped — a state directory removed under
  /// a running node is not a sign-out — and the observable account facts go
  /// at once, so the corner never draws a face it is about to forget.
  ///
  /// The next SIGN IN is a fresh node and a fresh Tailscale sign-in; there
  /// is no switch, because a phone holds one account at a time.
  public func signOut() {
    retryTask?.cancel()
    retryTask = nil
    retryAttempt = 0
    presentsLogin = false
    let sweep = SignOutSweep(
      login: rememberedLogin ?? loginName, stateDirectory: stateDirectory,
      legacyStateDirectory: legacyStateDirectory)
    lastLoginURL = nil
    loginPage = nil
    rememberedLogin = nil
    loginName = nil
    tailnetDomain = nil
    isGatedOnAccount = false
    accountNote = nil
    peers = []
    guard let runtime else {
      sweep.run()
      state = .off
      return
    }
    state = .stopping
    eventsTask?.cancel()
    eventsTask = nil
    self.runtime = nil
    Task {
      await runtime.stop()
      sweep.run()
      if state == .stopping { state = .off }
    }
  }

  /// Safari sheet dismissed — ask the node to re-check its auth state.
  public func loginSheetDismissed() {
    loginPage = nil
    guard let runtime else { return }
    Task {
      try? await runtime.refresh()
      await applyCurrentPhase()
    }
  }

  /// The SIGN IN act: re-surface the pending login page, or nudge the node
  /// to emit a fresh one.
  public func requestLogin() {
    presentsLogin = true
    if let url = lastLoginURL {
      loginPage = LoginPage(url: url)
    } else if let runtime {
      Task { try? await runtime.refresh() }
    }
  }

  // MARK: - Runtime plumbing

  private func startRuntime() async {
    do {
      let runtime = try await FieldTruffleRuntime.start(
        deviceName: UIDevice.current.name,
        stateDirectory: stateDirectory,
        onAuthRequired: { [weak self] url in
          guard let self else { return }
          self.lastLoginURL = url
          if self.presentsLogin { self.loginPage = LoginPage(url: url) }
        })
      self.runtime = runtime
      if let gated = runtime.gatedLogin { rememberedLogin = gated }
      await applyCurrentPhase()
      await refreshPeers()
      eventsTask = Task { [weak self] in
        guard let stream = await self?.runtime?.events() else { return }
        for await event in stream {
          guard let self, !Task.isCancelled else { return }
          switch event {
          case .phase(let phase):
            if await self.wentDown(Self.state(for: phase)) { return }
            await self.refreshAccount()
          case .authRequired(let url):
            self.lastLoginURL = url
            if self.presentsLogin { self.loginPage = LoginPage(url: url) }
          case .peersChanged:
            await self.refreshPeers()
            // UA-P-5 — the login is re-read HERE as well as on a phase change.
            // `MeshNode.apply(status:)` sets the login from the same snapshot
            // it sets the dns name from, but it emits `.phase` only when the
            // phase CHANGES: a login that arrives in a later refresh of an
            // already-running node moves no phase, and a machine that waited
            // for one would sit ungated with the answer in hand.
            await self.refreshAccount()
          case .health(let message):
            // Unit health lines join the sheet in a later slice. One class of
            // them is already load-bearing, though: RFC 025 §3.3 has a gated
            // node emit a one-shot notice when Layer 3 reports an app peer it
            // cannot name an owner for — which is the only warning that an
            // empty mesh is the status overlay failing rather than a quiet
            // tailnet. Carried as a note so the reason exists somewhere a face
            // can read it, instead of being dropped on the floor.
            self.accountNote = message
          }
        }
        // The stream ended without anyone cancelling it: the node is gone.
        guard let self, !Task.isCancelled, self.runtime === runtime else { return }
        await self.lost(runtime, reason: "the mesh runtime stopped")
      }
    } catch {
      runtime = nil
      dropped(Self.shortReason(error))
    }
  }

  /// A phase the node reports, applied; true when it says the node is down
  /// (stopped or failed with no one having asked), which is a drop.
  private func wentDown(_ next: State) async -> Bool {
    switch next {
    case .off, .failed:
      guard let runtime else { return true }
      let reason: String
      if case .failed(let why) = next { reason = why } else { reason = "the mesh runtime stopped" }
      await lost(runtime, reason: reason)
      return true
    default:
      state = next
      if next == .up { retryAttempt = 0 }
      return false
    }
  }

  /// Let a dead node go for good and dial again.
  private func lost(_ dead: FieldTruffleRuntime, reason: String) async {
    guard runtime === dead else { return }
    eventsTask?.cancel()
    eventsTask = nil
    runtime = nil
    peers = []
    await dead.stop()
    dropped(reason)
  }

  private func applyCurrentPhase() async {
    guard let runtime else { return }
    if await wentDown(Self.state(for: await runtime.phase)) { return }
    await refreshAccount()
  }

  /// UA-P-1c and UA-P-5 — the account line's facts, re-read whenever the node
  /// has anything new to say, and the gate driven from what they say.
  ///
  /// The dns name only exists once the backend has one, which is after a
  /// sign-in rather than at `start`, so this is asked at every phase change
  /// instead of once: a domain fetched at `starting` is nil forever, and a
  /// corner that never says who you are signed in as is the gap UA-P-1c is
  /// about. The login arrives on the same snapshot and gets the same
  /// treatment.
  private func refreshAccount() async {
    guard let runtime else { return }
    tailnetDomain = await magicDNSSuffix
    loginName = await runtime.loginName
    isGatedOnAccount = await runtime.isGatedOnAccount
    if let note = await runtime.accountNote { accountNote = note }
    await regateIfNeeded()
  }

  /// UA-P-5 — ONE restart per fresh sign-in, and one per account switch.
  ///
  /// The node's gate is fixed for its lifetime (RFC 025 §3.1), so the only way
  /// to gate a node that started ungated is to start another one. The runtime
  /// records the login first and answers `.nothing` if it could not, so a
  /// restart is never asked for unless it will stick.
  ///
  /// There is no browser round: the tailscale state lives in the node's state
  /// directory and outlives the node, so the replacement comes up signed in.
  /// What the person sees is the mesh chip going through `…` once.
  ///
  /// **It clears nothing.** An account switch re-gates the mesh and leaves
  /// every store, ledger and preference exactly where it was. Forgetting is
  /// `signOut()`'s (IOS-8d, AP-D4 — UA-P-D4's lean, implemented 2026-09-23):
  /// a deliberate act of the person's, never a side effect of a login
  /// arriving on a live node.
  private func regateIfNeeded() async {
    guard let runtime, !regating else { return }
    let step = await runtime.accountStep()
    guard let login = step.login else { return }
    // The runtime wrote it before answering; the observable copy follows.
    rememberedLogin = login
    regating = true
    defer { regating = false }

    eventsTask?.cancel()
    eventsTask = nil
    peers = []
    loginPage = nil
    // A note is about the node it came from, and that node is going. Carrying
    // it onto the replacement would be this app asserting a condition nobody
    // has observed on the thing now running.
    accountNote = nil
    state = .starting
    // `self.runtime` deliberately still points at the old node through the
    // stop. Nulling it first opens a window in which `keepUp()` or `signIn()`
    // sees no runtime and starts a SECOND one. Holding it means every act keeps
    // working on the thing that exists, and the identity check below is what
    // notices that one of them happened.
    await runtime.stop()
    guard self.runtime === runtime, state == .starting else { return }
    self.runtime = nil
    await startRuntime()
  }

  private func refreshPeers() async {
    guard let runtime else { return }
    peers = await runtime.peers().map(Self.peerView)
  }

  /// One peer, as the roster renders it. `tailscaleId` is what ROUTES, so it is
  /// the row's identity; the durable `deviceId` files a slice and is a
  /// different keyspace (RFC 017 §8), which is why neither is derived from the
  /// other.
  nonisolated static func peerView(_ peer: Peer) -> MeshPeerView {
    MeshPeerView(
      id: peer.tailscaleId, name: peer.displayName, address: peer.tailnetIPs.first)
  }

  /// Phase → state, pure (pinned by tests).
  ///
  /// Truffle's own `MeshPhase` since TM-5 — it was ghosttea's re-publication of
  /// the same seven cases, read through a mapping that existed only because the
  /// phone held a ghosttea runtime. The switch stays EXHAUSTIVE (upstream's own
  /// maps by raw value with a `?? .failed` fallback), so a phase truffle adds is
  /// a compile error here rather than a screen quietly claiming the mesh failed.
  public nonisolated static func state(for phase: MeshPhase) -> State {
    switch phase {
    case .starting: .starting
    case .needsLogin: .needsLogin
    case .needsMachineAuth: .needsMachineAuth
    case .running: .up
    case .stopping: .stopping
    case .stopped: .off
    case .failed: .failed("mesh runtime failed")
    }
  }

  /// One length of bad news for the whole app: the mesh leg, the store reader
  /// and the product client all render an error through this, so a screen
  /// never shows two shapes of the same kind of failure.
  public nonisolated static func shortReason(_ error: Error) -> String {
    let text = String(describing: error)
    return text.count > 120 ? String(text.prefix(117)) + "…" : text
  }
}
