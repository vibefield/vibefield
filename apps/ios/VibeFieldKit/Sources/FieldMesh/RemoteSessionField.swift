import FieldAgents
import Foundation
import Observation

/// The stage's remote rows, and the fold that keeps them honest.
///
/// **TM-5 took its live source away, and that is a stated loss.** This used to
/// ask every online peer for its sessions — `candidates()` → `connect(to:)` →
/// `listSessions()` → `close()`, a fresh TCP connection per host per two-second
/// poll to a compile-time port. Nothing has served that port since TM-1 retired
/// the in-process TSP1 adapter, and under T the phone's discovery is the JOIN:
/// a fold row names `terminal.runtimeSessionId`, the product door mints a
/// ticket for it (TM-D5). So the field's bubbles are the fold's AGENT runs, and
/// a plain shell on a desktop is no longer one of them — the honest shape of
/// v1, recorded here rather than papered over.
///
/// What is left is the vocabulary and the fold: the state machine that decides
/// what a field KNOWS (nobody asked · asked and empty · asked and refused), its
/// tolerance rule, and the seam a source plugs into. The DEBUG fixtures still
/// plug into it, which is what keeps the screenshot path honest about what it
/// is drawing.

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

/// Where a field's answers come from. Injectable so tests need no mesh — and
/// since TM-5, nothing in the shipping app implements it. A live field is built
/// with `source: nil` and reports `.noDoor`, which is the truthful state: nobody
/// has been asked.
public protocol RemoteSessionSource: Sendable {
  func listAll() async throws -> (rows: [RemoteSessionRow], hosts: Int)
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
