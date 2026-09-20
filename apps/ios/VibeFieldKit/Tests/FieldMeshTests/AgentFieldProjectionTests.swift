import FieldAgents
import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

/// The golden board, built in Swift rather than read from a file: this bundle
/// has no fixture resources, and the SHAPE is pinned against the contracts'
/// real goldens in `FieldProductTests`. What is under test here is the FOLD —
/// what a row becomes once the field has it — so the rows are written for the
/// fold's questions and named after them.
private func rowJSON(
  id: String,
  kind: String = "claude",
  status: String = "idle",
  alive: Bool = true,
  pending: String? = nil,
  blockers: [JSONValue] = [],
  folder: String? = "vibe-field",
  branch: JSONValue = .string("main"),
  model: JSONValue? = .object(["id": .string("claude-opus-5"), "displayName": .string("Opus 5")]),
  effort: JSONValue? = .object(["value": .string("high"), "intent": .string("observed")]),
  usage: JSONValue? = .object(["cumulativeTokens": .int(1000)]),
  context: JSONValue? = .object(["usedPercent": .int(38)]),
  terminal: JSONValue? = .object([
    "hosted": .string("local"), "runtimeSessionId": .string("pty-a41f"),
  ]),
  lastActivityAt: String? = "2026-09-13T18:42:11.000Z"
) -> JSONValue {
  var fields: [String: JSONValue] = [
    "runtimeRunId": .string(id),
    "revision": .int(1),
    "kind": .string(kind),
    "label": .string("Claude Code"),
    "tier": .string("managed"),
    "device": .string("dev-01HQ8ZK4M7"),
    "status": .string(status),
    "statusSince": .string("2026-09-13T18:42:11.000Z"),
    "stateChangedAt": .string("2026-09-13T18:42:11.000Z"),
    "createdAt": .string("2026-09-13T18:03:52.000Z"),
    "alive": .bool(alive),
    "blockers": .array(blockers),
  ]
  if let pending { fields["pending"] = .string(pending) }
  if let lastActivityAt { fields["lastActivityAt"] = .string(lastActivityAt) }
  if let folder { fields["project"] = .object(["name": .string(folder), "branch": branch]) }
  if let model { fields["model"] = model }
  if let effort { fields["effort"] = effort }
  if let usage { fields["usage"] = usage }
  if let context { fields["context"] = context }
  if let terminal { fields["terminal"] = terminal }
  return .object(fields)
}

/// The same, decoded. Two spellings because the board tests need the JSON to
/// put inside a slice and the fold tests need the row itself.
private func row(
  id: String,
  kind: String = "claude",
  status: String = "idle",
  alive: Bool = true,
  pending: String? = nil,
  blockers: [JSONValue] = [],
  folder: String? = "vibe-field",
  branch: JSONValue = .string("main"),
  model: JSONValue? = .object(["id": .string("claude-opus-5"), "displayName": .string("Opus 5")]),
  effort: JSONValue? = .object(["value": .string("high"), "intent": .string("observed")]),
  usage: JSONValue? = .object(["cumulativeTokens": .int(1000)]),
  context: JSONValue? = .object(["usedPercent": .int(38)]),
  terminal: JSONValue? = .object([
    "hosted": .string("local"), "runtimeSessionId": .string("pty-a41f"),
  ]),
  lastActivityAt: String? = "2026-09-13T18:42:11.000Z"
) throws -> AgentFieldRow {
  try AgentFieldRow(
    json: rowJSON(
      id: id, kind: kind, status: status, alive: alive, pending: pending, blockers: blockers,
      folder: folder, branch: branch, model: model, effort: effort, usage: usage,
      context: context,
      terminal: terminal, lastActivityAt: lastActivityAt))
}

private func permission(tool: String) -> JSONValue {
  .object([
    "id": .string("perm-1"), "kind": .string("permission"),
    "since": .string("2026-09-13T18:42:11.000Z"), "tool": .string(tool),
  ])
}

private func blocker(kind: String) -> JSONValue {
  .object([
    "id": .string("b-1"), "kind": .string(kind),
    "since": .string("2026-09-13T18:42:11.000Z"),
  ])
}

@Suite struct AgentFieldProjectionTests {
  /// THE property this fold exists to keep (AR-D4): fieldd derives `status`
  /// once and no view re-derives it. The phone HAS a classifier, so the rule
  /// is to reproduce — if these two ever disagree, it is a red here rather
  /// than a wrong body on a phone.
  @Test func theClassifierReproducesFielddsOwnWord() throws {
    let cases: [(String, AgentVisualStatus)] = [
      ("idle", .idle), ("working", .working), ("blocked", .blocked),
    ]
    for (wire, expected) in cases {
      let blockers = wire == "blocked" ? [permission(tool: "Bash")] : []
      let snapshot = try #require(agentSnapshot(from: try row(id: "r", status: wire, blockers: blockers)))
      #expect(classifyAgentStatus(snapshot.state) == expected)
    }
  }

  /// `unknown` has no word in the phone's three, and the honest reading is a
  /// body at rest: nothing is claimed about it, so nothing is drawn as burning.
  @Test func anUnknownStatusDrawsAsAtRest() throws {
    let snapshot = try #require(agentSnapshot(from: try row(id: "r", status: "unknown")))
    #expect(classifyAgentStatus(snapshot.state) == .idle)
  }

  /// fieldd's word is the last word IN BOTH DIRECTIONS. A board that says
  /// `blocked` while carrying no blocker still draws blocked, and one that says
  /// `working` while carrying a stale blocker still draws working.
  @Test func thStatusOutranksTheBlockerListBothWays() throws {
    let blockedWithNothing = try #require(
      agentSnapshot(from: try row(id: "r", status: "blocked", blockers: [])))
    #expect(classifyAgentStatus(blockedWithNothing.state) == .blocked)

    let workingWithABlocker = try #require(
      agentSnapshot(from: try row(id: "r", status: "working", blockers: [permission(tool: "Bash")])))
    #expect(classifyAgentStatus(workingWithABlocker.state) == .working)
  }

  @Test func aPermissionKeepsItsToolAndReachesTheDetailLine() throws {
    let snapshot = try #require(
      agentSnapshot(from: try row(id: "r", status: "blocked", blockers: [permission(tool: "Bash")])))
    #expect(snapshot.state?.permissions.first?.tool == "Bash")
    #expect(agentBlockerKind(snapshot.state) == .permission)
    #expect(agentDetail(snapshot.state, status: .blocked) == "permission · Bash")
  }

  @Test func aQuestionBlocksAsAQuestion() throws {
    let snapshot = try #require(
      agentSnapshot(from: try row(id: "r", status: "blocked", blockers: [blocker(kind: "question")])))
    #expect(agentBlockerKind(snapshot.state) == .question)
    #expect(agentDetail(snapshot.state, status: .blocked) == "question")
  }

  /// A blocker kind this build has no word for still BLOCKS, because fieldd
  /// said so, and the raw word rides in `detail` rather than being thrown away.
  @Test func anUnheardOfBlockerKindStillBlocksAndKeepsItsWord() throws {
    let snapshot = try #require(
      agentSnapshot(from: try row(id: "r", status: "blocked", blockers: [blocker(kind: "quota")])))
    #expect(classifyAgentStatus(snapshot.state) == .blocked)
    #expect(snapshot.state?.blockers.first?.detail == "quota")
  }

  /// AR-4's pending row as the golden ships it since MF-1e: ALIVE, and
  /// unobserved. It draws, and it draws at rest — nothing is claimed about it,
  /// so nothing is drawn as burning.
  @Test func aPendingRowDrawsAtRest() throws {
    let snapshot = try agentSnapshot(
      from: row(id: "r", status: "unknown", alive: true, pending: "resume-when-idle"))
    #expect(snapshot != nil)
    #expect(classifyAgentStatus(snapshot?.state) == .idle)
  }

  /// And the OLD spelling still draws. The first cut of that golden shipped
  /// `alive: false` beside `pending`, this lane reported the contradiction, and
  /// MF-1e settled it the other way — but a producer somewhere may still be on
  /// the old reading, and dropping a parked row would take a live agent off the
  /// field. That is the one mistake here a person would notice and could not
  /// explain, so the tolerance is kept and pinned.
  @Test func aPendingRowDrawsUnderTheOldSpellingToo() throws {
    let snapshot = try agentSnapshot(
      from: row(id: "r", status: "unknown", alive: false, pending: "resume-when-idle"))
    #expect(snapshot != nil)
  }

  /// A run leaves when it is dead AND has no pane — which since MF-1f is the
  /// only exit. A dead run whose PTY the floor still lists KEEPS its row, so
  /// §07's "resume after an exit" has something to live on and the pane stays
  /// readable.
  @Test func onlyADeadRunWithNoPaneLeavesTheField() throws {
    #expect(try agentSnapshot(from: row(id: "r", alive: false, terminal: nil)) == nil)
    #expect(
      try agentSnapshot(
        from: row(id: "r", alive: false, terminal: .object(["hosted": .string("none")]))) == nil)
    // The pane is still on the floor: the row stays, and says it exited.
    let kept = try #require(agentSnapshot(from: row(id: "r", alive: false)))
    #expect(kept.join?.exited == true)
  }

  /// MF-1i: the wire sends the FOLDER now, so the fold uses it as it stands —
  /// running a basename over a name that is already one only finds new ways to
  /// be wrong. The label stands in when the producer named nothing (a root, a
  /// bare drive letter, no path at all).
  @Test func theHeadlineIsTheProjectsNameAndTheFallbackIsTheLabel() throws {
    let named = try #require(agentSnapshot(from: try row(id: "r")))
    #expect(named.project == "vibe-field")

    let unnamed = try #require(agentSnapshot(from: try row(id: "r", folder: nil)))
    #expect(unnamed.project == "Claude Code")

    // An empty name is "the producer looked and found none", not a headline.
    let empty = try #require(agentSnapshot(from: try row(id: "r", folder: "")))
    #expect(empty.project == "Claude Code")

    // And a name with separators in it is NOT re-reduced: whatever the
    // producer called the project is what the field draws.
    let odd = try #require(agentSnapshot(from: try row(id: "r", folder: "a/b")))
    #expect(odd.project == "a/b")
  }

  @Test func theRowsFactsReachTheFieldsOwnFields() throws {
    let snapshot = try #require(agentSnapshot(from: try row(id: "run-1")))
    #expect(snapshot.id == "run-1")
    // The PTY is the better alias when there is one — it is what a card will
    // attach to (IOS-4c).
    #expect(snapshot.runtimeSessionID == "pty-a41f")
    #expect(snapshot.provider == .claude)
    #expect(snapshot.state?.modelName == "Opus 5")
    #expect(snapshot.state?.branch == "main")
    #expect(snapshot.state?.contextUsedPercent == 38)
    #expect(snapshot.state?.effort == AgentEffort(value: "high", intent: .observed))
    #expect(snapshot.state?.usage?.cumulativeTokens == 1000)
    #expect(snapshot.createdAt == parseWireDate("2026-09-13T18:03:52.000Z"))
    #expect(snapshot.state?.statusSince == parseWireDate("2026-09-13T18:42:11.000Z"))
    #expect(snapshot.state?.lastEvidenceAt == parseWireDate("2026-09-13T18:42:11.000Z"))
  }

  /// A row with no PTY falls back to the run id rather than to nothing: the
  /// card header's hue is dealt from this and a blank would deal one colour to
  /// every exited body.
  @Test func theUSDLaneRidesWhenTheRowCarriesItAndIsMissingNotZeroWhenItDoesNot() throws {
    // Today's wire: tokens only. The lane is absent — no coverage, no rate — and
    // the body will draw it unread rather than calm.
    let bare = try #require(agentSnapshot(from: try row(id: "run-usd")))
    #expect(bare.state?.usage?.cumulativeTokens == 1000)
    #expect(bare.state?.usage?.costCoverage == nil)
    #expect(bare.state?.usage?.costUsd == nil)
    // The day fieldd projects RFC 008's three fields, they reach the model unchanged.
    let priced = try #require(
      agentSnapshot(
        from: try row(
          id: "run-usd",
          usage: .object([
            "cumulativeTokens": .int(1000), "costUsd": .double(1.25), "costCoverage": .string("complete"),
            "costRatePerMin": .double(0.4),
          ]))))
    #expect(priced.state?.usage?.costUsd == 1.25)
    #expect(priced.state?.usage?.costCoverage == .complete)
    #expect(priced.state?.usage?.costRatePerMin == 0.4)
    // A coverage word this build has no case for is tolerated and reads as no coverage.
    let odd = try #require(
      agentSnapshot(from: try row(id: "run-usd", usage: .object(["costUsd": .double(2), "costCoverage": .string("estimated")]))))
    #expect(odd.state?.usage?.costUsd == 2)
    #expect(odd.state?.usage?.costCoverage == nil)
  }

  @Test func aRowWithNoTerminalStillHasAnAlias() throws {
    let snapshot = try #require(agentSnapshot(from: try row(id: "run-9", terminal: nil)))
    #expect(snapshot.runtimeSessionID == "run-9")
  }

  /// §10.1's absence, kept on this side too: no reply text rides the field, so
  /// a body shows no line rather than a stale one. The card fetches it.
  @Test func theFoldCarriesNoReplyText() throws {
    let snapshot = try #require(agentSnapshot(from: try row(id: "r")))
    #expect(snapshot.state?.lastAssistantMessage == nil)
  }

  /// `configured` is launch INTENT and the body sets it in italics so a reading
  /// never mistakes it for evidence; anything else is observed.
  @Test func effortIntentSurvivesTheFold() throws {
    let configured = try #require(
      agentSnapshot(
        from: row(
          id: "r",
          effort: .object(["value": .string("low"), "intent": .string("configured")]))))
    #expect(configured.state?.effort?.intent == .configured)

    let bare = try #require(
      agentSnapshot(from: try row(id: "r", effort: .object(["value": .string("low")]))))
    #expect(bare.state?.effort?.intent == .observed)
  }

  @Test func bothWireDateSpellingsParseAndNonsenseDoesNot() {
    #expect(parseWireDate("2026-09-13T18:42:11.000Z") != nil)
    #expect(parseWireDate("2026-09-13T18:42:11Z") != nil)
    #expect(parseWireDate("not a date") == nil)
    #expect(parseWireDate(nil) == nil)
    #expect(parseWireDate("") == nil)
  }
}

@Suite struct AgentFieldBoardTests {
  /// A provider this build has no MARK for still draws — it wears its letter,
  /// which is the reference's own fallback and which the Metal renderer here
  /// had already transcribed. The earlier cut of this refused such a row and
  /// counted it; that hid a whole agent behind a closed enum.
  @Test func anUnfamiliarProviderDrawsWithItsLetter() throws {
    let projection = try projectAgentField(rows: [
      try row(id: "a", kind: "claude"), try row(id: "b", kind: "hermes"),
      try row(id: "c", kind: "opencode"),
    ])
    #expect(projection.agents.map(\.id) == ["a", "b", "c"])
    #expect(projection.agents.map(\.provider.rawValue) == ["claude", "hermes", "opencode"])
  }

  /// The letter rule, clause for clause with `AgentIcon.tsx`'s `agentMark`:
  /// the one override first, then the id's first character uppercased, then
  /// `?` for an id with no characters at all.
  @Test func theLetterRuleIsTheReferences() {
    #expect(AgentProvider.acp.markLetter == "A")
    #expect(AgentProvider(rawValue: "hermes").markLetter == "H")
    #expect(AgentProvider(rawValue: "opencode").markLetter == "O")
    #expect(AgentProvider(rawValue: "kimi").markLetter == "K")
    #expect(AgentProvider(rawValue: "").markLetter == "?")
    // The three with drawn marks never fall back.
    for provider in [AgentProvider.claude, .codex, .grok] {
      #expect(provider.hasDrawnMark)
    }
    #expect(!AgentProvider.acp.hasDrawnMark)
    #expect(!AgentProvider(rawValue: "hermes").hasDrawnMark)
  }

  /// An unfamiliar provider is called what the wire called it — the only
  /// honest name there is.
  @Test func anUnfamiliarProviderIsNamedByItsId() {
    #expect(AgentProvider.claude.displayName == "Claude")
    #expect(AgentProvider(rawValue: "hermes").displayName == "hermes")
  }

  @Test func endedRunsAreCountedSoAnEmptyBoardAndAGraveyardReadDifferently() throws {
    let gone = JSONValue.object(["hosted": .string("none")])
    let projection = try projectAgentField(rows: [
      try row(id: "a"),
      try row(id: "b", alive: false, terminal: gone),
      try row(id: "c", alive: false, terminal: gone),
    ])
    #expect(projection.agents.map(\.id) == ["a"])
    #expect(projection.ended == 2)
  }

  @Test func aBoardPastItsExpiryDoesNotDraw() throws {
    let published: Int64 = 1_757_808_000_000
    let slice = try sliceOf(rows: [rowJSON(id: "a")], published: published)
    let alive = Date(timeIntervalSince1970: Double(published + 29_000) / 1000)
    let stale = Date(timeIntervalSince1970: Double(published + 31_000) / 1000)
    #expect(projectAgentSlices([slice], now: alive).agents.count == 1)
    #expect(projectAgentSlices([slice], now: stale).agents.isEmpty)
  }

  /// Device order, then the board's own: a field that reshuffled because a
  /// dictionary rehashed would respawn every body on the screen.
  @Test func slicesFoldInADeterministicOrder() throws {
    let published: Int64 = 1_757_808_000_000
    let now = Date(timeIntervalSince1970: Double(published + 1000) / 1000)
    let first = try sliceOf(
      rows: [rowJSON(id: "a"), rowJSON(id: "b")], device: "dev-a", published: published)
    let second = try sliceOf(rows: [rowJSON(id: "c")], device: "dev-b", published: published)
    #expect(projectAgentSlices([second, first], now: now).agents.map(\.id) == ["a", "b", "c"])
    #expect(projectAgentSlices([first, second], now: now).agents.map(\.id) == ["a", "b", "c"])
  }

  private func sliceOf(
    rows: [JSONValue], device: String = "dev-01HQ8ZK4M7", published: Int64
  ) throws -> AgentFieldSlice {
    try AgentFieldSlice(
      json: .object([
        "v": .int(1),
        "deviceId": .string(device),
        "publishedAt": .int(published),
        "expiresAt": .int(published + 30_000),
        "revision": .int(1),
        "rows": .array(rows),
      ]))
  }
}
