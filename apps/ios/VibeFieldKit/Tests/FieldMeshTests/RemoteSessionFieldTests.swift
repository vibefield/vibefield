import FieldAgents
import GhostteaTruffle
import Testing

@testable import FieldMesh

/// The floor's refusal, with words we can assert on. `shortReason` renders an
/// error with `String(describing:)`, which honors `CustomStringConvertible`.
private struct FloorRefused: Error, CustomStringConvertible {
  let words: String
  var description: String { words }
}

private func row(device: String, session: String) -> RemoteSessionRow {
  RemoteSessionRow(
    host: RemoteHost(deviceID: device, deviceName: device.uppercased()),
    session: RemoteSessionInfo(
      sessionID: session,
      title: "work",
      cwdLabel: "/home/\(device)/repo",
      running: true,
      attachable: true,
      readWrite: false,
      createdAtMs: 1_700_000_000_000))
}

private func summary(
  id: String,
  running: Bool = true,
  attachable: Bool = true,
  activity: GhostteaSessionActivityKind = .shellIdle
) -> GhostteaSharedSessionSummary {
  GhostteaSharedSessionSummary(
    sessionID: id,
    title: "session \(id)",
    cwdLabel: "/srv/\(id)",
    running: running,
    attachable: attachable,
    readWrite: true,
    createdAtMs: 42,
    activity: GhostteaSessionActivity(
      kind: activity,
      source: .processGroup,
      confidence: .heuristic,
      rootProcessGroupID: nil,
      foregroundProcessGroupID: nil,
      observedAtMs: 0))
}

// MARK: - The fold (no clock, no mesh)

@Suite struct RemoteFieldFoldTests {
  @Test func aGoodAnswerReplacesEverythingIncludingTheFailureCount() {
    let stale = RemoteFieldSnapshot(
      rows: [row(device: "old", session: "1")], hosts: 9, state: .unavailable("timeout"),
      failures: 5)
    let folded = remoteFieldFold(
      previous: stale, result: .success([row(device: "mac", session: "7")]), hosts: 2)

    #expect(folded.rows == [row(device: "mac", session: "7")])
    #expect(folded.hosts == 2)
    #expect(folded.state == .serving)
    #expect(folded.failures == 0)
  }

  /// One failure is a round trip, not a verdict.
  @Test func oneFailureKeepsTheRowsAndDoesNotFlipTheState() {
    let serving = RemoteFieldSnapshot(
      rows: [row(device: "mac", session: "7")], hosts: 1, state: .serving, failures: 0)
    let folded = remoteFieldFold(
      previous: serving, result: .failure(FloorRefused(words: "connection reset")), hosts: 0)

    #expect(folded.rows == serving.rows)
    #expect(folded.hosts == 1, "the last good answer's host count stands with its rows")
    #expect(folded.state == .serving)
    #expect(folded.failures == 1)
  }

  /// Two in a row is a standing condition, and standing conditions are told the
  /// truth about — with the reason the floor gave, verbatim.
  @Test func twoConsecutiveFailuresDropTheRowsAndSayWhy() {
    let serving = RemoteFieldSnapshot(
      rows: [row(device: "mac", session: "7")], hosts: 1, state: .serving, failures: 0)
    let once = remoteFieldFold(
      previous: serving, result: .failure(FloorRefused(words: "connection reset")), hosts: 0)
    let twice = remoteFieldFold(
      previous: once, result: .failure(FloorRefused(words: "no route to host")), hosts: 0)

    #expect(twice.rows.isEmpty)
    #expect(twice.hosts == 0)
    #expect(twice.state == .unavailable("no route to host"))
    #expect(twice.failures == 2)
  }

  /// Nothing to keep believing in: a first ask that fails before anything has
  /// ever been served has no rows to stand by, so it says so at once.
  @Test func aFirstFailureFromNoDoorIsImmediatelyUnavailable() {
    let folded = remoteFieldFold(
      previous: .empty, result: .failure(FloorRefused(words: "mesh is off")), hosts: 0)

    #expect(folded.state == .unavailable("mesh is off"))
    #expect(folded.failures == 1)
  }

  @Test func recoveryAfterFailuresReturnsToServing() {
    var snapshot = RemoteFieldSnapshot(
      rows: [row(device: "mac", session: "7")], hosts: 1, state: .serving, failures: 0)
    for _ in 0..<4 {
      snapshot = remoteFieldFold(
        previous: snapshot, result: .failure(FloorRefused(words: "down")), hosts: 0)
    }
    #expect(snapshot.state == .unavailable("down"))

    let recovered = remoteFieldFold(
      previous: snapshot, result: .success([row(device: "mac", session: "7")]), hosts: 1)
    #expect(recovered.state == .serving)
    #expect(recovered.rows.count == 1)
    #expect(recovered.failures == 0, "the failure count is history, not a debt")
  }

  /// "Nobody has been asked" and "the mesh answered, and it is empty" are
  /// different facts, and only the second one is an empty mesh.
  @Test func noDoorIsNotServingWithZeroRows() {
    let answeredEmpty = remoteFieldFold(previous: .empty, result: .success([]), hosts: 0)

    #expect(RemoteFieldSnapshot.empty.state == .noDoor)
    #expect(answeredEmpty.state == .serving)
    #expect(answeredEmpty.state != RemoteFieldSnapshot.empty.state)
    #expect(answeredEmpty.rows.isEmpty && RemoteFieldSnapshot.empty.rows.isEmpty)
  }

  @Test func theToleranceIsTwo() {
    #expect(remoteFailureTolerance == 2)
  }

  /// Upstream's own remote-palette cadence, kept deliberately.
  @Test func theCadenceIsUpstreamsTwoSeconds() {
    #expect(remotePollInterval == .seconds(2))
  }
}

// MARK: - The mapping (pure, no mesh)

@Suite struct RemoteSessionMappingTests {
  private let host = RemoteHost(deviceID: "dev-1", deviceName: "studio")

  @Test func stoppedSessionsAreDropped() {
    let rows = remoteSessionRows(
      host: host,
      summaries: [summary(id: "a"), summary(id: "b", running: false), summary(id: "c")])

    #expect(rows.map(\.session.sessionID) == ["a", "c"])
  }

  /// A live session the peer is deliberately not sharing is a fact: the row
  /// stays and the card refuses honestly, rather than the bubble vanishing.
  @Test func unattachableSessionsAreKept() {
    let rows = remoteSessionRows(host: host, summaries: [summary(id: "a", attachable: false)])

    #expect(rows.count == 1)
    #expect(rows[0].session.attachable == false)
  }

  @Test func rowsCarryTheHostAndTheQualifiedID() {
    let rows = remoteSessionRows(host: host, summaries: [summary(id: "7")])

    #expect(rows[0].host == host)
    #expect(rows[0].id == "remote:dev-1:7")
  }

  /// THE SEAM: upstream's activity enum and `classifyTerminalStatus`'s string
  /// literal never see each other, and this mapping is the only place they
  /// meet. Pinned end to end so a rename upstream fails here, loudly.
  @Test func theActivityKindSurvivesIntoTheStatusClassifier() {
    let busy = remoteSessionRows(
      host: host, summaries: [summary(id: "a", activity: .foregroundJob)])
    let calm = remoteSessionRows(host: host, summaries: [summary(id: "b", activity: .shellIdle)])

    #expect(busy[0].session.activityKind == "foreground-job")
    #expect(classifyTerminalStatus(busy[0].session.activityKind) == .working)
    #expect(classifyTerminalStatus(calm[0].session.activityKind) == .idle)
  }

  /// The durable id or nothing: an unconfirmed peer is skipped rather than
  /// given an invented identity the reconnect engine could never re-resolve.
  @Test func anUnconfirmedHostIsSkippedRatherThanInvented() throws {
    #expect(remoteHost(displayName: "studio", reference: nil) == nil)

    let confirmed = try GhostteaTruffleHostReference(deviceID: "dev-1")
    #expect(
      remoteHost(displayName: "studio", reference: confirmed)
        == RemoteHost(deviceID: "dev-1", deviceName: "studio"))
  }
}

// MARK: - The field, driven through a fake source

private actor FakeSource: RemoteSessionSource {
  private var answers: [Result<(rows: [RemoteSessionRow], hosts: Int), any Error>]
  private(set) var asks = 0

  init(_ answers: [Result<(rows: [RemoteSessionRow], hosts: Int), any Error>]) {
    self.answers = answers
  }

  func listAll() async throws -> (rows: [RemoteSessionRow], hosts: Int) {
    asks += 1
    // The last answer repeats, so a poll that outlives the script keeps its
    // meaning instead of falling off the end.
    let answer = answers.count > 1 ? answers.removeFirst() : answers[0]
    return try answer.get()
  }
}

@MainActor
@Suite struct RemoteSessionFieldTests {
  @Test func aFieldWithNoDoorAsksNobody() async {
    let field = RemoteSessionField(source: nil)

    field.start()
    await field.refreshNow()

    #expect(field.snapshot == .empty)
    #expect(field.snapshot.state == .noDoor)
    field.stop()
  }

  @Test func oneGoodAnswerServesItsRows() async {
    let field = RemoteSessionField(
      source: FakeSource([.success((rows: [row(device: "mac", session: "7")], hosts: 3))]))

    await field.refreshNow()

    #expect(field.snapshot.state == .serving)
    #expect(field.snapshot.rows.count == 1)
    #expect(field.snapshot.hosts == 3)
  }

  @Test func theToleranceRuleHoldsThroughTheField() async {
    let source = FakeSource([
      .success((rows: [row(device: "mac", session: "7")], hosts: 1)),
      .failure(FloorRefused(words: "reset")),
      .failure(FloorRefused(words: "no route")),
    ])
    let field = RemoteSessionField(source: source)

    await field.refreshNow()
    #expect(field.snapshot.state == .serving)

    await field.refreshNow()
    #expect(field.snapshot.state == .serving, "one failure is a round trip, not a verdict")
    #expect(field.snapshot.rows.count == 1)

    await field.refreshNow()
    #expect(field.snapshot.state == .unavailable("no route"))
    #expect(field.snapshot.rows.isEmpty)
  }

  /// The poll belongs to the stage: it starts when asked and ENDS when stopped.
  @Test func pollingRunsOnlyBetweenStartAndStop() async throws {
    let source = FakeSource([.success((rows: [], hosts: 0))])
    let field = RemoteSessionField(source: source, pollInterval: .milliseconds(10))

    field.start()
    try await Task.sleep(for: .milliseconds(120))
    let whileRunning = await source.asks
    field.stop()

    // A tick may already be in flight when stop lands; let it finish, then
    // measure a window several periods long with nobody polling.
    try await Task.sleep(for: .milliseconds(30))
    let atStop = await source.asks
    try await Task.sleep(for: .milliseconds(120))

    #expect(whileRunning > 1, "the field polled while the stage was open")
    #expect(await source.asks == atStop, "and asked nothing at all once stopped")
  }

  @Test func startIsIdempotentSoAStageCannotDoubleThePoll() async throws {
    let source = FakeSource([.success((rows: [], hosts: 0))])
    let field = RemoteSessionField(source: source, pollInterval: .milliseconds(1_000))

    field.start()
    field.start()
    field.start()
    try await Task.sleep(for: .milliseconds(60))
    field.stop()

    #expect(await source.asks == 1, "three starts, one immediate ask")
  }

  /// A stopped field still HAS its door. The distinction is what lets a stage
  /// coming back from the background resume the poll it parked instead of
  /// rebuilding the field — which would empty the stage and re-spawn every
  /// bubble for nothing.
  @Test func aParkedFieldKeepsItsDoor() async throws {
    let source = FakeSource([.success((rows: [], hosts: 0))])
    let field = RemoteSessionField(source: source, pollInterval: .milliseconds(1_000))

    #expect(field.hasDoor)
    #expect(!field.isPolling)

    // The first ask is given time to land: `start()` only schedules the poll,
    // so stopping in the same turn would cancel it before it ever ran and the
    // resume below would be measuring nothing.
    field.start()
    try await Task.sleep(for: .milliseconds(40))
    #expect(field.isPolling)
    let parked = await source.asks
    #expect(parked == 1, "one immediate ask, and the interval is far away")

    field.stop()
    #expect(!field.isPolling, "the poll is parked")
    #expect(field.hasDoor, "but the door it was asking through is still good")

    // And it can be asked again through the same door — no rebuild needed.
    field.start()
    try await Task.sleep(for: .milliseconds(40))
    field.stop()
    #expect(await source.asks == parked + 1, "resumed through the one source")
  }

  @Test func aDoorlessFieldNeverPolls() async throws {
    let field = RemoteSessionField(source: nil, pollInterval: .milliseconds(10))

    #expect(!field.hasDoor)
    field.start()
    try await Task.sleep(for: .milliseconds(60))

    #expect(!field.isPolling, "start on a door-less field is a no-op")
    #expect(field.snapshot.state == .noDoor, "and nobody has been asked anything")
  }
}
