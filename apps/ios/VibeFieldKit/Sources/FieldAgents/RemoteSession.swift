/// A peer's session, in OUR vocabulary.
///
/// Deliberately carries no Ghosttea type. FieldMesh maps upstream's
/// `GhostteaSharedSessionSummary` into these shapes at the seam, which is what
/// keeps the projection that makes bubbles — and every test over it — free of
/// the mesh stack and runnable without a tailnet.

/// The peer that owns a session.
public struct RemoteHost: Sendable, Equatable {
  /// The DURABLE device id, not the peer value discovery happened to see:
  /// upstream's reconnect engine re-resolves the host on every dial, so only
  /// the persistent handle survives a reconnect (thinking-ios-app §10.1).
  public let deviceID: String
  public let deviceName: String

  public init(deviceID: String, deviceName: String) {
    self.deviceID = deviceID
    self.deviceName = deviceName
  }
}

/// The peer's own summary of one shared session.
public struct RemoteSessionInfo: Sendable, Equatable {
  /// The id ON THE PEER. It names nothing in this device's floor.
  public let sessionID: String
  public let title: String
  /// A LABEL, never a path this side may act on — nothing here spawns in it.
  public let cwdLabel: String?
  public let running: Bool
  /// Kept even when false, and shown: a live session the peer is deliberately
  /// not sharing is a fact, and the card refuses honestly rather than the
  /// bubble vanishing (§10.2).
  public let attachable: Bool
  public let readWrite: Bool
  public let createdAtMs: UInt64
  /// Upstream's `SessionActivity.kind`, raw. Left a string because the only
  /// question asked of it is `classifyTerminalStatus`'s one, and modeling
  /// upstream's enum here would drag a Ghosttea type into this module.
  public let activityKind: String?

  public init(
    sessionID: String,
    title: String,
    cwdLabel: String? = nil,
    running: Bool,
    attachable: Bool,
    readWrite: Bool,
    createdAtMs: UInt64,
    activityKind: String? = nil
  ) {
    self.sessionID = sessionID
    self.title = title
    self.cwdLabel = cwdLabel
    self.running = running
    self.attachable = attachable
    self.readWrite = readWrite
    self.createdAtMs = createdAtMs
    self.activityKind = activityKind
  }
}

/// One attachable thing on the mesh. The host and the session travel together
/// because a session id is only unique WITHIN a peer — a row that lost its
/// host would be a session nobody owns.
public struct RemoteSessionRow: Sendable, Equatable, Identifiable {
  public let host: RemoteHost
  public let session: RemoteSessionInfo

  public var id: String { remoteRowID(deviceID: host.deviceID, sessionID: session.sessionID) }

  public init(host: RemoteHost, session: RemoteSessionInfo) {
    self.host = host
    self.session = session
  }
}

/// The field's id for a peer's session (desktop `remoteRowId`).
///
/// Prefixed and device-qualified because the field's ids are one flat
/// namespace shared with local sessions: two peers can each have a session
/// `1`, and one of them can collide with ours.
public func remoteRowID(deviceID: String, sessionID: String) -> String {
  "remote:\(deviceID):\(sessionID)"
}
