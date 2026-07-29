import Foundation
import GhostteaTruffle
import Observation
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

  @ObservationIgnored private var runtime: GhostteaTruffleRuntime?
  @ObservationIgnored private var eventsTask: Task<Void, Never>?
  @ObservationIgnored private var lastLoginURL: URL?

  public init() {}

  public var isRunning: Bool { runtime != nil && state != .stopping }

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
      let runtime = try await GhostteaTruffleRuntime.start(
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
    let candidates = await runtime.candidates()
    peers = candidates.map { candidate in
      MeshPeerView(
        id: String(describing: candidate.id),
        name: candidate.displayName,
        address: candidate.peer.tailnetIPs.first)
    }
  }

  /// Phase → state, pure (pinned by tests).
  public nonisolated static func state(for phase: GhostteaTruffleRuntimePhase) -> State {
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

  nonisolated static func shortReason(_ error: Error) -> String {
    let text = String(describing: error)
    return text.count > 120 ? String(text.prefix(117)) + "…" : text
  }
}
