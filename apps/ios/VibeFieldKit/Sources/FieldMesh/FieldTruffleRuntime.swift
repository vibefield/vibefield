import Foundation
import Truffle
import TruffleTailscale

/// This phone's node on the tailnet.
///
/// It exists because a node sees only peers in its OWN application namespace:
/// `MeshNode.upsertFromLayer3` admits a peer into the registry only when its
/// Tailscale hostname starts with `truffle-{appId}-` (RFC 017 §4). Ghosttea's
/// Swift runtime hardcoded its own app id and kept its `init(node:)` private,
/// so the phone joined `ghosttea-terminal` while every desktop floor joins
/// `vibefield`, and a signed-in phone beside a serving desktop read
/// `online · 0 peers in reach` — James's QA of 2026-09-13, finding 1.
///
/// **TM-5 emptied the rest of it.** This was a COMPOSITION of upstream's
/// pieces around a ghosttea peer directory, because the phone's attach path
/// dialed TSP1 through that directory. The attach is a routed T1 client now, so
/// the directory, the host candidates, the phase and event mappings and the
/// `GhostteaTruffle` product itself are gone from this target: what is left is
/// truffle's own node, which is all the phone ever needed. **Petition G14 —
/// "an injectable mesh runtime", asking ghosttea for `start(appId:)` or a
/// public `init(node:)` — is MOOT and withdrawn**: there is no ghosttea runtime
/// here to inject a namespace into.
public actor FieldTruffleRuntime {
  /// The running node itself, for the surfaces that speak the mesh's own
  /// protocols (`FieldStore`, `FieldLink`, the terminal legs' `URLSession`).
  public let node: MeshNode

  /// UA-P-5 — the login this node was STARTED gated on, or nil for the
  /// pre-login window. Read from `account.login` beside truffle's state at
  /// `start`; it never changes under a running node, because the gate never
  /// does (RFC 025 §3.1 — the list is fixed for the node's lifetime).
  public let gatedLogin: String?

  /// Where the remembered login lives, or nil when this device has no state
  /// directory to keep one in. A runtime with no store can never gate: it
  /// stays on the whole tailnet and `isGatedOnAccount` says so, which keeps
  /// the store bus off rather than publishing to an audience nobody chose.
  private let loginStore: AccountLoginStore?

  /// Why the gate could not be recorded, if it could not. Held rather than
  /// thrown: the node is running and useful, and the only consequence is that
  /// this launch stays in the pre-login window.
  public private(set) var accountNote: String?

  private init(node: MeshNode, gatedLogin: String?, loginStore: AccountLoginStore?) {
    self.node = node
    self.gatedLogin = gatedLogin
    self.loginStore = loginStore
  }

  /// Join the tailnet in VibeField's namespace. Mirrors ghosttea's `start`
  /// step for step — same backend, same interactive auth, same durable node —
  /// differing only in the app id and in resolving the state directory here
  /// rather than leaving it to truffle's derivation (see below).
  ///
  /// **UA-P-5 — it starts GATED when it can.** If this app remembers a login
  /// for this node's state directory, the node starts with that login as its
  /// whole `loginAllow`, so the mesh it joins is this account's from the first
  /// packet, with no window in which a stranger is a peer. With nothing
  /// remembered it starts UNGATED and the caller drives `accountStep()` until
  /// the login is known — one restart, and the machine is at that declaration.
  public static func start(
    deviceName: String,
    stateDirectory: URL? = nil,
    controlURL: URL? = nil,
    onAuthRequired: @MainActor @escaping @Sendable (URL) async -> Void
  ) async throws -> FieldTruffleRuntime {
    let plan = startPlan(
      deviceName: deviceName, stateDirectory: stateDirectory, controlURL: controlURL,
      onAuthRequired: onAuthRequired)
    let node = try await MeshNode.startTailscale(plan.configuration)
    return FieldTruffleRuntime(
      node: node, gatedLogin: plan.rememberedLogin, loginStore: plan.loginStore)
  }

  /// Everything `start` decides BEFORE it touches a tailnet: which directory,
  /// which login it remembers there, and therefore which gate.
  ///
  /// Split out for the reason `configuration` was — `startTailscale` wants a
  /// tailnet and a hand sign-in, which no simulator has, while the gate a node
  /// comes up with is decidable on a scratch directory and is the whole of
  /// UA-P-5's first move. The machine's rows drive this and the file store in
  /// sequence, which is the same sequence two launches make.
  struct StartPlan {
    let configuration: MeshConfiguration
    let rememberedLogin: String?
    let loginStore: AccountLoginStore?

    /// Whether this plan starts a GATED node. The pre-login window is `false`.
    var isGated: Bool { !configuration.loginAllow.isEmpty }
  }

  static func startPlan(
    deviceName: String,
    stateDirectory: URL? = nil,
    controlURL: URL? = nil,
    onAuthRequired: @MainActor @escaping @Sendable (URL) async -> Void = { _ in }
  ) -> StartPlan {
    let directory = stateDirectory ?? resolvedStateDirectory()
    let store = directory.map(AccountLoginStore.init(stateDirectory:))
    let remembered = store?.read()
    return StartPlan(
      configuration: configuration(
        deviceName: deviceName,
        stateDirectory: directory,
        controlURL: controlURL,
        loginAllow: AccountGate.allowList(for: remembered),
        onAuthRequired: onAuthRequired),
      rememberedLogin: remembered,
      loginStore: store)
  }

  /// The configuration a node WOULD be started with, as a value.
  ///
  /// Split out of `start` because it is the only seam a test can hold:
  /// `startTailscale` wants a tailnet and a hand sign-in, which no simulator
  /// has, but the app id a node is configured with is assertable without
  /// starting one — and the app id is the whole defect. UA-P-5 puts a second
  /// load-bearing value through the same seam: the gate.
  static func configuration(
    deviceName: String,
    stateDirectory: URL? = nil,
    controlURL: URL? = nil,
    loginAllow: [String] = [],
    onAuthRequired: @MainActor @escaping @Sendable (URL) async -> Void = { _ in }
  ) -> MeshConfiguration {
    MeshConfiguration(
      appId: FieldMeshContract.appID,
      deviceName: deviceName,
      stateDirectory: stateDirectory,
      controlURL: controlURL,
      ephemeral: false,
      auth: .interactive(onAuthRequired: onAuthRequired),
      loginAllow: loginAllow)
  }

  // MARK: - The account gate (UA-P-5)

  /// This node's own tailnet login, as Layer 3 last reported it. `nil` until
  /// known — never fabricated (RFC 022, RFC 025 §3.6 D7).
  public var loginName: String? {
    get async { await node.loginName }
  }

  /// Whether this node's running gate is exactly this account's login.
  ///
  /// It asks the NODE for its list rather than trusting `gatedLogin`, because
  /// the list the node is running is the thing that gates and our copy of it
  /// is only a claim. It is what `FieldLink`'s store bus is keyed to: an
  /// ungated node reads and publishes nothing, because an ungated node is on
  /// the whole tailnet and a synced store reaches every node in the app's
  /// namespace (UA-P-D2).
  public var isGatedOnAccount: Bool {
    get async {
      guard let gatedLogin, !gatedLogin.isEmpty else { return false }
      return AccountGate.gates(await node.loginAllow, login: gatedLogin)
    }
  }

  /// What this node's current login asks of the gate it started with — and
  /// the remembering, done here, before the caller acts on it.
  ///
  /// The caller's contract is one line: on `.remember` or `.regate`, STOP this
  /// runtime and start a new one. The new one reads the file this wrote and
  /// comes up gated on it. Nothing else re-gates a node, because nothing else
  /// can: `loginAllow` is fixed for a node's lifetime (RFC 025 §3.1).
  ///
  /// Two properties make the restart safe to drive from an event:
  ///
  /// - **the write precedes the restart**, so a launch that dies between them
  ///   comes back gated rather than repeating the window;
  /// - **a write that fails answers `.nothing`**, so the caller does not
  ///   restart. A restart we cannot make stick is a loop — the new node would
  ///   read no file, come up ungated, learn the same login and ask again —
  ///   and a phone spinning its tailnet node is worse than one that stays in
  ///   the pre-login window with the reason recorded.
  public func accountStep() async -> AccountStep {
    let step = AccountGate.step(gatedOn: gatedLogin, reports: await node.loginName)
    guard let login = step.login else { return .nothing }
    guard let loginStore else {
      accountNote = "no state directory to remember this account's login in"
      return .nothing
    }
    do {
      try loginStore.write(login)
      accountNote = nil
      return step
    } catch {
      accountNote = "could not record this account's login: \(MeshModel.shortReason(error))"
      return .nothing
    }
  }

  // MARK: - Lifecycle, as the app already asks for it

  public var phase: MeshPhase {
    get async { await node.phase }
  }

  public func refresh() async throws {
    try await node.refresh()
  }

  /// The peers this node can currently see, online only.
  ///
  /// It was ghosttea's `candidates()` — online peers with their durable
  /// identity confirmed, because the attachment DIALED one and needed a
  /// reference that survives a re-dial. Nothing dials a peer any more (the
  /// terminal legs dial a URL the ticket names), so the roster is the plain
  /// question the chip asks: who is in reach.
  public func peers() async -> [Peer] {
    await node.peers().filter(\.online)
  }

  public func stop() async {
    await node.stop()
  }

  /// The node's events in the app's vocabulary — peer arrivals and departures
  /// flattened to one `peersChanged`, node-to-node messages dropped.
  ///
  /// `FieldStoreDoors` reads `node.events` directly when it needs the whole
  /// `Peer`; this one is for the surfaces that only need to know SOMETHING
  /// changed, and the two must stay one flattening of one stream.
  public func events() async -> AsyncStream<FieldMeshRuntimeEvent> {
    let upstream = await node.events
    return AsyncStream(bufferingPolicy: .bufferingNewest(128)) { continuation in
      let task = Task {
        for await event in upstream {
          switch event {
          case .phase(let phase):
            continuation.yield(.phase(phase))
          case .authRequired(let url):
            continuation.yield(.authRequired(url))
          case .peerUpsert, .peerLeft:
            continuation.yield(.peersChanged)
          case .health(let message):
            continuation.yield(.health(message))
          case .message:
            break
          }
        }
        continuation.finish()
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  // MARK: - State directory

  /// Where truffle keeps a node's state when the caller names none:
  /// `Application Support/truffle/{appId}` — derived identically and
  /// independently by `MeshNode.init` (for `device-id.txt`) and by
  /// `TailscaleKitBackend.start` (for the Tailscale keys).
  ///
  /// Recomputed here because the app id MOVED and the derivation moves the
  /// directory with it: the node's durable ULID and the keys that make this
  /// phone a signed-in machine both sit under the old name.
  static func defaultStateDirectory(appID: String) -> URL? {
    guard
      let support = FileManager.default
        .urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    else { return nil }
    return
      support
      .appendingPathComponent("truffle", isDirectory: true)
      .appendingPathComponent(appID, isDirectory: true)
  }

  /// What carrying the state across the rename did. Three outcomes, no fourth.
  enum StateMigration: Equatable {
    /// Either this app id already has state, or the previous one never did.
    case notNeeded
    case moved
    case failed(String)
  }

  /// Carry the node's state across the app id's rename, ONCE.
  ///
  /// The phone signed in under `ghosttea-terminal`, so its Tailscale keys and
  /// its device ULID live in that directory; starting under `vibefield` on
  /// truffle's derived default would find an empty one and ask James to sign
  /// in again. A single `moveItem` is a `rename(2)` within one volume —
  /// atomic, so there is no half-moved state anyone has to recover from — and
  /// it runs only when the destination is absent, which makes it idempotent.
  ///
  /// A failure is neither fatal nor hidden: the node then starts on an empty
  /// directory and the app renders `needsLogin`, which is the honest face for
  /// "this phone is not signed in" and the one a fresh install already shows.
  /// That is also the worst case of not migrating at all, which is what makes
  /// the move safe to attempt.
  ///
  /// UNWITNESSED on a live tailnet: that tailscaled accepts state registered
  /// under the old hostname and re-registers it as `truffle-vibefield-…`
  /// without a fresh login. Node authorisation is keyed by node key rather
  /// than hostname, so it should; if it does not, the cost is the sign-in
  /// above.
  @discardableResult
  static func migrateStateDirectory(from previous: URL, to current: URL) -> StateMigration {
    let fileManager = FileManager.default
    guard !fileManager.fileExists(atPath: current.path) else { return .notNeeded }
    guard fileManager.fileExists(atPath: previous.path) else { return .notNeeded }
    do {
      try fileManager.createDirectory(
        at: current.deletingLastPathComponent(), withIntermediateDirectories: true)
      try fileManager.moveItem(at: previous, to: current)
      return .moved
    } catch {
      return .failed(String(describing: error))
    }
  }

  /// The directory this app's node starts on, once the rename has been
  /// carried across. `nil` means "no Application Support directory", where
  /// truffle's own derivation is as good as ours and gets to answer.
  static func resolvedStateDirectory() -> URL? {
    guard let current = defaultStateDirectory(appID: FieldMeshContract.appID) else { return nil }
    if let previous = defaultStateDirectory(appID: legacyGhostteaAppID) {
      migrateStateDirectory(from: previous, to: current)
    }
    return current
  }

  /// The app id this phone's node was started under before IOS-4i, spelled out
  /// rather than read from `GhostteaTruffleContract` — which left with the
  /// product at TM-5.
  ///
  /// It is a historical fact about a DIRECTORY ON DISK, not a live dependency:
  /// a phone that signed in before 2026-09-13 has its Tailscale keys and its
  /// durable ULID under this name, and the one-time rename above is what
  /// carries them across. It never changes again, which is why a literal is the
  /// honest way to hold it.
  static let legacyGhostteaAppID = "ghosttea-terminal"
}

/// What the app asks the node about itself. Ghosttea's runtime published its
/// own copy of this and the phone read it through that; with the product gone
/// this is the same flattening, owned here.
public enum FieldMeshRuntimeEvent: Sendable {
  case phase(MeshPhase)
  case authRequired(URL)
  case peersChanged
  case health(String)
}
