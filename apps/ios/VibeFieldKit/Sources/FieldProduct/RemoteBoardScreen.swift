import Foundation

/// PG-1b's screen (`field-app/src/godview/monitor/board-screen.ts`), on the phone: a row this build cannot read is
/// dropped, and its desktop reads `incompatible` while it holds one; the envelope stays whole and the chain is kept (a
/// delta loses its unreadable upserts, never its `since` or `revision`); once the desktop holds no unreadable row, it
/// reads as the wire last said.
///
/// A value with no clock and no I/O: `now` is the caller's ISO-8601 instant, used only where the window stamps
/// `new Date()`. No caller in PG-3c — 3d's fold calls `open` on every `agent.snapshot` (the PG-1c resync included) and
/// `frame` on every `agent.delta`.
///
/// One ordering differs from the window, and nothing may lean on it: the window's screen changes its memory BEFORE the
/// envelope's own parse, so an unreadable open still clears it there. Here an envelope that does not read throws in
/// its decoder and never reaches the screen — and the reopen that follows clears the memory all the same.
public struct RemoteBoardScreen: Sendable {
  struct Said: Sendable, Equatable {
    let state: AgentMeshDeviceState
    let asOf: String
  }

  /// The stand-in key of a refused row with none (`NO_KEY`): never a real key, so never a removal.
  static let noKey = "\u{0}"

  /// device → the keys of its rows this build cannot read, in the order first refused, each once.
  private var unreadable: [String: [String]] = [:]
  /// device → its standing as the wire last said it.
  private var said: [String: Said] = [:]

  public init() {}

  /// Whether the desktop holds a row this build cannot read (and so reads `incompatible`).
  public func holds(_ device: String) -> Bool { !(unreadable[device] ?? []).isEmpty }

  /// The open, screened. An open replaces everything, the screen's memory too.
  public mutating func open(_ open: AgentRemoteMeshOpen, now: String) -> AgentRemoteMeshOpen {
    unreadable = [:]
    said = [:]
    let devices = open.devices.map { entry -> AgentRemoteMeshDevice in
      said[entry.device] = Said(state: entry.state, asOf: entry.asOf)
      guard let snapshot = entry.snapshot, !snapshot.refused.isEmpty else { return entry }
      unreadable[entry.device] = Self.keys(snapshot.refused)
      return AgentRemoteMeshDevice(
        device: entry.device, state: .incompatible, asOf: now, snapshot: snapshot.readableOnly,
        unknownFields: entry.unknownFields)
    }
    return AgentRemoteMeshOpen(devices: devices, unknownFields: open.unknownFields)
  }

  /// One frame, screened: the frames to deliver, in order — the frame without its unreadable rows, then a state frame
  /// when the desktop's standing moved.
  public mutating func frame(_ frame: AgentRemoteMeshFrame, now: String) -> [AgentRemoteMeshFrame] {
    let device = frame.device
    let screened: AgentRemoteMeshFrame
    let before = holds(device)
    switch frame {
    case .state(_, let state, let asOf):
      said[device] = Said(state: state, asOf: asOf)
      return [before ? .state(device: device, .incompatible, asOf: asOf) : frame]
    case .snapshot(_, let snapshot):
      // a snapshot is the desktop's reset: what it holds is what this one refused, nothing older
      unreadable[device] = Self.keys(snapshot.refused)
      screened = snapshot.refused.isEmpty ? frame : .snapshot(device: device, snapshot.readableOnly)
    case .delta(_, let delta):
      let refused = Self.keys(delta.refused)
      var held = unreadable[device] ?? []
      // the window's order: a readable upsert clears its key, a refused one holds it, a removal clears it
      held.removeAll { key in delta.upserts.contains { $0.runtimeRunId == key } }
      for key in refused where !held.contains(key) { held.append(key) }
      held.removeAll { delta.removed.contains($0) }
      unreadable[device] = held
      if refused.isEmpty {
        screened = frame
      } else {
        // a row this build cannot read is no row, here as in an open: a key the fold holds from before leaves it
        // rather than standing frozen at its last readable version (the fold ignores a removal it does not hold)
        let gone = refused.filter { $0 != Self.noKey && !delta.removed.contains($0) }
        screened = .delta(device: device, delta.readableOnly(alsoRemoving: gone))
      }
    }
    let after = holds(device)
    if before == after { return [screened] }
    let last = said[device]
    // "another version" is established now; coming back is the wire's own word
    return [
      screened,
      .state(
        device: device, after ? .incompatible : (last?.state ?? .live),
        asOf: after ? now : (last?.asOf ?? now)),
    ]
  }

  /// Refused rows' keys as the screen holds them: each once, in order, a keyless row as `noKey`.
  private static func keys(_ refused: [AgentRemoteRowRefusal]) -> [String] {
    var keys: [String] = []
    for key in refused.map({ $0.key ?? noKey }) where !keys.contains(key) { keys.append(key) }
    return keys
  }
}
