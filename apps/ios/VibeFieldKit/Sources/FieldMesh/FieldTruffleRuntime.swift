import Foundation
import GhostteaTruffle
import Truffle
import TruffleTailscale

/// The phone's Truffle node, composed by VibeField instead of by Ghosttea.
///
/// One reason, and it is the whole of it: a node sees only peers in its OWN
/// application namespace. `MeshNode.upsertFromLayer3` admits a peer into the
/// registry only when its Tailscale hostname starts with `truffle-{appId}-`
/// (RFC 017 §4). Ghosttea's `GhostteaTruffleRuntime.start` hardcodes
/// `GhostteaTruffleContract.appID` — "ghosttea-terminal" — and its
/// `init(node:)` is private, so there is no way to ask that runtime for a
/// different namespace. The phone therefore joined `ghosttea-terminal` while
/// every desktop floor joins `vibefield`, and a signed-in phone beside a
/// serving desktop read `online · 0 peers in reach`: James's QA of
/// 2026-09-13, finding 1, blocking W2 and W3.
///
/// This is a COMPOSITION and not a fork. Every piece it assembles is
/// upstream's own public surface — `MeshNode.startTailscale`,
/// `MeshConfiguration`, and `GhostteaTrufflePeerDirectory(node:)`, whose init
/// is public precisely so a node the app started can be handed to it. Nothing
/// downstream changes: the attach path (IOS-3) takes the same directory type,
/// dials the same `compactTerminalPort`, and speaks the same TSP1 hello to the
/// same Ghosttea host. Only the tailnet this node joins is ours.
///
/// It retires the day ghosttea's runtime takes an app id of its own — the
/// roadmap's unfiled "G14 injectable mesh runtime" petition, whose concrete
/// ask is `GhostteaTruffleRuntime.start(appId:…)` or a public `init(node:)`.
/// On that day this file becomes one call and deletes itself.
public actor FieldTruffleRuntime {
  /// The running node itself, for the surfaces that speak the mesh's own
  /// protocols rather than Ghosttea's (`FieldStore`, `FieldLink`).
  public let node: MeshNode

  /// Ghosttea's own peer directory, over our node. The whole attach path
  /// takes this and nothing else, which is why the composition is possible at
  /// all: `GhostteaTrufflePeerDirectory(node:)` is public.
  public let directory: GhostteaTrufflePeerDirectory

  private init(node: MeshNode) {
    self.node = node
    directory = GhostteaTrufflePeerDirectory(node: node)
  }

  /// Join the tailnet in VibeField's namespace. Mirrors ghosttea's `start`
  /// step for step — same backend, same interactive auth, same durable node —
  /// differing only in the app id and in resolving the state directory here
  /// rather than leaving it to truffle's derivation (see below).
  public static func start(
    deviceName: String,
    stateDirectory: URL? = nil,
    controlURL: URL? = nil,
    onAuthRequired: @MainActor @escaping @Sendable (URL) async -> Void
  ) async throws -> FieldTruffleRuntime {
    let node = try await MeshNode.startTailscale(
      configuration(
        deviceName: deviceName,
        stateDirectory: stateDirectory ?? resolvedStateDirectory(),
        controlURL: controlURL,
        onAuthRequired: onAuthRequired))
    return FieldTruffleRuntime(node: node)
  }

  /// The configuration a node WOULD be started with, as a value.
  ///
  /// Split out of `start` because it is the only seam a test can hold:
  /// `startTailscale` wants a tailnet and a hand sign-in, which no simulator
  /// has, but the app id a node is configured with is assertable without
  /// starting one — and the app id is the whole defect.
  static func configuration(
    deviceName: String,
    stateDirectory: URL? = nil,
    controlURL: URL? = nil,
    onAuthRequired: @MainActor @escaping @Sendable (URL) async -> Void = { _ in }
  ) -> MeshConfiguration {
    MeshConfiguration(
      appId: FieldMeshContract.appID,
      deviceName: deviceName,
      stateDirectory: stateDirectory,
      controlURL: controlURL,
      ephemeral: false,
      auth: .interactive(onAuthRequired: onAuthRequired))
  }

  // MARK: - Lifecycle, as the app already asks for it

  public var phase: GhostteaTruffleRuntimePhase {
    get async { Self.phase(for: await node.phase) }
  }

  public func refresh() async throws {
    try await node.refresh()
  }

  public func candidates() async -> [GhostteaTruffleHostCandidate] {
    await directory.candidates()
  }

  public func stop() async {
    await node.stop()
  }

  /// The node's events in the app's vocabulary — peer arrivals and departures
  /// flattened to one `peersChanged`, node-to-node messages dropped. Identical
  /// to ghosttea's mapping on purpose: `FieldStoreDoors` already reads
  /// `node.events` directly when it needs the whole `Peer`, and two different
  /// flattenings of one stream would be two different truths.
  public func events() async -> AsyncStream<GhostteaTruffleRuntimeEvent> {
    let upstream = await node.events
    return AsyncStream(bufferingPolicy: .bufferingNewest(128)) { continuation in
      let task = Task {
        for await event in upstream {
          switch event {
          case .phase(let phase):
            continuation.yield(.phase(Self.phase(for: phase)))
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

  /// `MeshPhase` → the phase the app renders, as an EXHAUSTIVE switch.
  ///
  /// Upstream maps these by raw value with a `?? .failed` fallback. This maps
  /// them case by case, so a phase truffle adds is a compile error here rather
  /// than a screen that quietly claims the mesh failed.
  static func phase(for phase: MeshPhase) -> GhostteaTruffleRuntimePhase {
    switch phase {
    case .starting: .starting
    case .needsLogin: .needsLogin
    case .needsMachineAuth: .needsMachineAuth
    case .running: .running
    case .stopping: .stopping
    case .stopped: .stopped
    case .failed: .failed
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
    if let previous = defaultStateDirectory(appID: GhostteaTruffleContract.appID) {
      migrateStateDirectory(from: previous, to: current)
    }
    return current
  }
}
