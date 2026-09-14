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

  private init(node: MeshNode) {
    self.node = node
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
