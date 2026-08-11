import FieldAgents
import Foundation
import GhostteaTruffle
import Observation

/// THE REAL SOURCE (ported from the desktop's `remote-session-field.ts`),
/// beside `MockAgentField` behind the same seam.
///
/// `MockAgentField` invents a field; this one asks the mesh for one. Both answer
/// in records the projection turns into `FieldBubble`s, which is the whole shape
/// of the honesty split: two sources, two claims, one stage.
///
/// The transport is discovery's own — `candidates()` → `connect(to:)` →
/// `listSessions()` → `close()`, the control path upstream already publishes.
/// Nothing here opens a data plane and no terminal bytes come near it (EL2).

/// Upstream's own remote-palette cadence (2 s), kept deliberately: this asks the
/// same daemon the same question, and inventing a different number would only
/// mean two answers to "how fresh is the mesh".
public let remotePollInterval: Duration = .milliseconds(2_000)

/// How many consecutive failed asks it takes to stop believing the last answer.
///
/// One failure is a round trip, not a verdict — a peer list does not become
/// false because one request timed out, and dropping every bubble on a single
/// hiccup would make the stage flicker on a healthy mesh. Two in a row is a
/// standing condition, and standing conditions are told the truth about: the
/// rows leave and the state says UNAVAILABLE with the reason it was given.
public let remoteFailureTolerance = 2

/// What the field knows, honestly (the tolerant-reader law's UI half).
///
/// `noDoor` is the state before anyone has been asked — no mesh runtime, or a
/// stage that has never been opened far enough to build a source. It is
/// deliberately NOT the same as `serving` with zero rows: "nobody has been
/// asked" and "the mesh answered, and it is empty" are different facts, and
/// only the second one is an empty mesh.
public enum RemoteFieldState: Equatable, Sendable {
  case noDoor
  case serving
  /// The floor's own words when the ask failed.
  case unavailable(String)
}

public struct RemoteFieldSnapshot: Equatable, Sendable {
  public let rows: [RemoteSessionRow]
  /// Online peers the last GOOD answer named — and could ASK: a peer whose
  /// durable identity Truffle has not confirmed is not counted, because it is
  /// not a host this field can put a row under. So this can sit one below the
  /// mesh chip's peer count, and when it does, the difference is true.
  public let hosts: Int
  public let state: RemoteFieldState
  /// Bookkeeping for the tolerance rule above, carried ON the snapshot so the
  /// rule is a pure function of it and can be tested without a clock.
  public let failures: Int

  public init(rows: [RemoteSessionRow], hosts: Int, state: RemoteFieldState, failures: Int) {
    self.rows = rows
    self.hosts = hosts
    self.state = state
    self.failures = failures
  }

  public static let empty = RemoteFieldSnapshot(rows: [], hosts: 0, state: .noDoor, failures: 0)
}

/// The whole tolerance rule, as a PURE fold of the previous snapshot and one
/// answer — the desktop's own shape, and the reason this can be tested without
/// a clock or a mesh.
///
/// `hosts` is consulted only for a good answer: a failed ask named no hosts, so
/// the failure paths carry the last good count or zero, never the argument.
public func remoteFieldFold(
  previous: RemoteFieldSnapshot,
  result: Result<[RemoteSessionRow], any Error>,
  hosts: Int
) -> RemoteFieldSnapshot {
  switch result {
  case .success(let rows):
    // A good answer replaces everything, including the failure count.
    return RemoteFieldSnapshot(rows: rows, hosts: hosts, state: .serving, failures: 0)
  case .failure(let error):
    let failures = previous.failures + 1
    if failures < remoteFailureTolerance, previous.state == .serving {
      // Still believed: the rows stand, and the count remembers that they are
      // one failure short of being withdrawn. Only a field that WAS serving has
      // rows worth standing by — a first ask that fails from `.noDoor` has
      // nothing to keep believing in, and says so immediately.
      return RemoteFieldSnapshot(
        rows: previous.rows, hosts: previous.hosts, state: previous.state, failures: failures)
    }
    return RemoteFieldSnapshot(
      rows: [], hosts: 0, state: .unavailable(MeshModel.shortReason(error)), failures: failures)
  }
}

// MARK: - The source

/// Where a field's answers come from. Injectable so tests need no mesh.
public protocol RemoteSessionSource: Sendable {
  func listAll() async throws -> (rows: [RemoteSessionRow], hosts: Int)
}

/// The live source: the mesh's own peer directory, asked one host at a time.
public struct TruffleSessionSource: RemoteSessionSource {
  private let directory: GhostteaTrufflePeerDirectory

  public init(directory: GhostteaTrufflePeerDirectory) {
    self.directory = directory
  }

  public func listAll() async throws -> (rows: [RemoteSessionRow], hosts: Int) {
    // ONLINE hosts only — and upstream already applied the rule for us:
    // `candidates()` is `node.peers().filter(\.online)` with identity
    // confirmed along the way. The desktop had to filter `host.online` itself
    // because its floor handed it offline hosts too; here the rule is
    // upstream's and we inherit it rather than re-state it.
    var asked: [(candidate: GhostteaTruffleHostCandidate, host: RemoteHost)] = []
    for candidate in await directory.candidates() {
      guard
        let host = remoteHost(
          displayName: candidate.displayName, reference: candidate.persistentReference)
      else { continue }
      asked.append((candidate, host))
    }

    var rows: [RemoteSessionRow] = []
    var refusals: [any Error] = []
    for entry in asked {
      do {
        let summaries = try await Self.listSessions(of: entry.candidate, over: directory)
        rows.append(contentsOf: remoteSessionRows(host: entry.host, summaries: summaries))
      } catch {
        refusals.append(error)
      }
    }

    // The desktop's door "rejects when the floor cannot be asked AT ALL". Here
    // the doors are the peers themselves: one that refuses its listing is a
    // peer we cannot reach, which the online-only rule already treats as
    // absent — so it costs its own rows, not everyone's. Only when EVERY door
    // refused has the mesh failed to answer, and then the first refusal's words
    // are the ones the field carries.
    if !asked.isEmpty, refusals.count == asked.count, let first = refusals.first {
      throw first
    }
    return (rows, asked.count)
  }

  /// One short-lived connection per host: connect → list → close, on EVERY path.
  ///
  /// A compact connection carries one conversation, so discovery cannot share
  /// the attachment's. Upstream's own dialer
  /// (`GhostteaTruffleAttachmentDialer.listSessions`) is the model for this
  /// call and closes only on the success path — a listing that throws leaks its
  /// connection there. The do/catch is why ours cannot.
  private static func listSessions(
    of candidate: GhostteaTruffleHostCandidate,
    over directory: GhostteaTrufflePeerDirectory
  ) async throws -> [GhostteaSharedSessionSummary] {
    let client = try await directory.connect(to: candidate)
    do {
      let summaries = try await client.listSessions()
      await client.close()
      return summaries
    } catch {
      await client.close()
      throw error
    }
  }
}

// MARK: - The mapping (pure, test-pinned)

/// A candidate's identity, or nothing.
///
/// A nil `persistentReference` means Truffle's hello has not confirmed this
/// peer's durable app identity, and only the durable id is worth keeping: the
/// reconnect engine re-resolves the host on every dial, so a transient peer
/// value would keep dialing an address nobody is listening on — which the
/// engine reads as "still absent" forever. We skip the host rather than invent
/// an id for it.
public func remoteHost(
  displayName: String,
  reference: GhostteaTruffleHostReference?
) -> RemoteHost? {
  guard let reference else { return nil }
  return RemoteHost(deviceID: reference.deviceID, deviceName: displayName)
}

/// One host's summaries, flattened into rows (desktop `remoteSessionRows`).
///
/// Sessions that have STOPPED running are dropped: a bubble the user cannot
/// open is a control that does nothing. `attachable: false` is KEPT and shown,
/// because that one IS a fact about a live session the peer is deliberately not
/// sharing — the row says so and the card refuses honestly, rather than the
/// bubble vanishing.
public func remoteSessionRows(
  host: RemoteHost,
  summaries: [GhostteaSharedSessionSummary]
) -> [RemoteSessionRow] {
  summaries
    .filter(\.running)
    .map { summary in
      RemoteSessionRow(
        host: host,
        session: RemoteSessionInfo(
          sessionID: summary.sessionID,
          title: summary.title,
          cwdLabel: summary.cwdLabel,
          running: summary.running,
          attachable: summary.attachable,
          readWrite: summary.readWrite,
          createdAtMs: summary.createdAtMs,
          // The RAW kind, always. `classifyTerminalStatus` compares it to
          // upstream's own "foreground-job" string and this mapping is the only
          // place the two vocabularies meet, so it is pinned by a test. nil
          // would be inventing an absence: upstream's decoder already
          // substitutes `.unknown` when the peer said nothing about activity,
          // and that IS the peer's answer.
          activityKind: summary.activity.kind.rawValue))
    }
}

// MARK: - The field

/// The mesh's sessions, kept current for as long as a stage is watching.
@MainActor
@Observable
public final class RemoteSessionField {
  public private(set) var snapshot: RemoteFieldSnapshot = .empty

  @ObservationIgnored private let source: (any RemoteSessionSource)?
  @ObservationIgnored private let pollInterval: Duration
  @ObservationIgnored private var pollTask: Task<Void, Never>?
  /// In-flight guard. A slow mesh must not stack asks behind itself —
  /// upstream's remote palette holds the same latch for the same reason.
  @ObservationIgnored private var asking = false
  /// Bumped by `stop()`. An ask already in flight when the stage closed must
  /// not land on a field nobody is watching: this is the desktop effect's
  /// `alive` flag, in the shape a main-actor class can hold one.
  @ObservationIgnored private var generation = 0

  /// A nil source is a field with no door: nothing is ever asked and the
  /// snapshot stays `.noDoor` — which is not `.serving` with no rows.
  public init(source: (any RemoteSessionSource)?, pollInterval: Duration = remotePollInterval) {
    self.source = source
    self.pollInterval = pollInterval
  }

  /// Whether this field can be asked at all — the question a stage asks when it
  /// comes back from the background and needs to know whether its poll can just
  /// be resumed or whether the whole door has to be rebuilt.
  ///
  /// Not observable, and deliberately not "is polling": a parked field still
  /// has its door, and rebuilding one that does would empty the stage and
  /// re-spawn every bubble for nothing.
  public var hasDoor: Bool { source != nil }

  /// Whether the poll is running right now.
  public var isPolling: Bool { pollTask != nil }

  /// Begins polling. The poll belongs to the STAGE: nothing runs until a view
  /// asks for it, and `stop()` ends it — nothing here polls in the background.
  public func start() {
    guard source != nil, pollTask == nil else { return }
    let interval = pollInterval
    pollTask = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        await self.refreshNow()
        // The first ask is immediate and the interval sits AFTER it, exactly as
        // the desktop's `void ask()` before its `setInterval`: opening the
        // stage should not cost a poll period of blankness.
        try? await Task.sleep(for: interval)
      }
    }
  }

  public func stop() {
    pollTask?.cancel()
    pollTask = nil
    generation &+= 1
  }

  /// One ask, folded in. Public so a view can refresh on demand without owning
  /// the cadence.
  public func refreshNow() async {
    // A field with no door asks nobody. Folding a failure here would turn
    // "nobody has been asked" into a verdict about a mesh we never questioned.
    guard let source, !asking else { return }
    asking = true
    let token = generation
    defer { asking = false }
    do {
      let answer = try await source.listAll()
      guard token == generation else { return }
      snapshot = remoteFieldFold(
        previous: snapshot, result: .success(answer.rows), hosts: answer.hosts)
    } catch {
      guard token == generation else { return }
      // A tailnet with no desktop publishing REFUSES this ask, and that is an
      // ordinary state rather than an incident: no log line per tick, and the
      // stage renders it as UNAVAILABLE once it stands (see the tolerance).
      snapshot = remoteFieldFold(
        previous: snapshot, result: .failure(error), hosts: snapshot.hosts)
    }
  }
}
