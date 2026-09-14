import Foundation
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
/// Nothing here connects on its own — joining the tailnet is a user act
/// (`connect()`), and every state renders as itself: off is off, sign-in is
/// sign-in, failed carries its reason. The corpus law stands: the phone is a
/// client on the mesh, never a device row (it runs no fieldd).
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
  }

  /// A login page pending presentation (Safari sheet).
  public struct LoginPage: Identifiable, Equatable {
    public let url: URL
    public var id: URL { url }
  }

  public private(set) var state: State = .off
  public private(set) var peers: [MeshPeerView] = []
  public private(set) var loginPage: LoginPage?

  @ObservationIgnored private var runtime: FieldTruffleRuntime?
  @ObservationIgnored private var eventsTask: Task<Void, Never>?
  @ObservationIgnored private var lastLoginURL: URL?

  public init() {}

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

  /// The user's deliberate act of joining the tailnet.
  public func connect() {
    guard runtime == nil else { return }
    state = .starting
    Task { await startRuntime() }
  }

  public func disconnect() {
    guard let runtime else { return }
    state = .stopping
    eventsTask?.cancel()
    eventsTask = nil
    self.runtime = nil
    peers = []
    loginPage = nil
    Task {
      await runtime.stop()
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
        onAuthRequired: { [weak self] url in
          self?.lastLoginURL = url
          self?.loginPage = LoginPage(url: url)
        })
      self.runtime = runtime
      await applyCurrentPhase()
      await refreshPeers()
      eventsTask = Task { [weak self] in
        guard let stream = await self?.runtime?.events() else { return }
        for await event in stream {
          guard let self, !Task.isCancelled else { return }
          switch event {
          case .phase(let phase):
            self.state = Self.state(for: phase)
          case .authRequired(let url):
            self.lastLoginURL = url
            self.loginPage = LoginPage(url: url)
          case .peersChanged:
            await self.refreshPeers()
          case .health:
            // Unit health lines join the sheet in a later slice.
            break
          }
        }
      }
    } catch {
      runtime = nil
      state = .failed(Self.shortReason(error))
    }
  }

  private func applyCurrentPhase() async {
    guard let runtime else { return }
    state = Self.state(for: await runtime.phase)
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
