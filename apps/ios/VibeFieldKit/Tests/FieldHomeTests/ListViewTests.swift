import FieldMesh
import Foundation
import Testing

@testable import FieldHome
@testable import FieldProduct

// PG-5 — THE LIST VIEW (host + kit): the phone's list model held to `phone-list.golden.json` (puppeteer-views' list,
// the shipping view, over the home's window at every step of PG-3a's witness: `packages/field-app/perf/lib/
// phone-goldens-list.ts`), copied here byte for byte (`pnpm check:ios-fixtures`). The copy is replayed by
// `HomeFixture.witnessSteps` (PG-4t's, fd's Q7 ruling), and at every step `ListModel` over the drawn rows is compared
// field by field with what the desktop's list drew. The hand rows cover what the witness lacks (an account, a pending
// run, one not yet observed, a permission's tool, receding, the lit row, a dead link, the empty list), each said.
// The mark's drawing is the kit's (the drawn suite); here a mark is its provider's id.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-5 — the list view")
struct ListViewTests {
  /// The home of the witness: Studio.
  static let home = "dev-01HQ9S7UD1"

  // MARK: - The golden

  /// A golden row's fields as strings, so a failure prints the row whole.
  static func words(_ golden: JSONValue) -> [String: String] {
    func text(_ key: String) -> String { golden[key]?.stringValue ?? "missing" }
    func flag(_ key: String) -> String { golden[key]?.boolValue.map { "\($0)" } ?? "missing" }
    let agent = golden["agent"]
    let cell: String =
      if let host = agent?["host"]?.stringValue {
        "host=\(host)"
      } else if let terminal = agent?["terminal"]?.stringValue {
        "terminal=\(terminal)"
      } else {
        "model=\(agent?["model"]?.stringValue ?? "missing") account=\(nullable(agent?["account"]))"
      }
    return [
      "id": text("id"), "status": text("status"), "active": flag("active"), "stale": flag("stale"),
      "linked": flag("linked"), "remote": flag("remote"), "receded": flag("receded"), "current": flag("current"),
      "project": text("project"), "branch": nullable(golden["branch"]), "agent": cell, "detail": text("detail"),
      "context": text("context"), "label": text("label"),
    ]
  }

  static func nullable(_ value: JSONValue?) -> String {
    guard let value else { return "missing" }
    return value.isNull ? "null" : (value.stringValue ?? "missing")
  }

  /// The phone's row, in the golden's words.
  static func words(_ row: ListRowModel) -> [String: String] {
    let cell: String =
      switch row.agent {
      case .agent(_, let model, let account): "model=\(model) account=\(account ?? "null")"
      case .host(let host): "host=\(host)"
      case .terminal(let word): "terminal=\(word)"
      }
    return [
      "id": row.id, "status": row.status.rawValue, "active": "\(row.active)", "stale": "\(row.stale)",
      "linked": "\(row.linked)", "remote": "\(row.remote)", "receded": "\(row.receded)", "current": "\(row.current)",
      "project": row.project, "branch": row.branch ?? "null", "agent": cell, "detail": row.detail,
      "context": row.context, "label": row.label,
    ]
  }

  static func px(_ value: Double) -> String { "\(Int(value))px" }

  /// One drawn step against the golden's.
  static func compare(_ model: ListModel, _ recorded: JSONValue, at: String) {
    let section = recorded["section"]
    let count = section?["count"]?.stringValue
    #expect(model.count == count, "step \(at): the count")
    let allReceded = section?["allReceded"]?.boolValue
    #expect(model.allReceded == allReceded, "step \(at): every row receded")
    let defaults = ListModel.Parameters.defaults
    let rowHeight = section?["rowHeight"]?.stringValue
    #expect(rowHeight == px(defaults.rowHeight), "step \(at): the row height")
    let projectWidth = section?["projectWidth"]?.stringValue
    #expect(projectWidth == px(defaults.projectWidth), "step \(at): the project column")
    let toolbar = recorded["toolbar"]?.stringValue
    #expect(toolbar == ListModel.newTerminalWord, "step \(at): the toolbar's word, recorded (not drawn)")
    let empty = recorded["empty"]
    if model.isEmpty {
      let title = empty?["title"]?.stringValue
      let hint = empty?["hint"]?.stringValue
      #expect(title == ListModel.emptyTitle, "step \(at)")
      #expect(hint == ListModel.emptyHint, "step \(at)")
    } else {
      let none = empty?.isNull
      #expect(none == true, "step \(at): no empty state while rows stand")
    }
    let rows = recorded["rows"]?.arrayValue ?? []
    #expect(model.rows.count == rows.count, "step \(at): the rows drawn")
    for (index, (row, golden)) in zip(model.rows, rows).enumerated() {
      let mine = words(row)
      let theirs = words(golden)
      #expect(mine == theirs, "step \(at), row \(index)")
    }
  }

  /// P1 — the whole golden, every step and every row, through the copy and the model.
  @Test func theListGoldenStepByStep() throws {
    let golden = try HomeFixture.json("phone-list.golden")
    let view = golden["view"]?.stringValue
    #expect(view == "list")
    let selfWord = golden["self"]?.stringValue
    #expect(selfWord == "home")
    let nowMs = golden["nowMs"]?.intValue
    #expect(nowMs == HomeFixture.nowMs)
    let recorded = golden["steps"]?.arrayValue ?? []
    let steps = try HomeFixture.witnessSteps()
    #expect(steps.count == 11)
    #expect(steps.count == recorded.count)
    for (step, entry) in zip(steps, recorded) {
      let at = entry["at"].map { $0.stringValue ?? "\($0.intValue ?? -1)" }
      #expect(at == step.at)
      let frame = entry["frame"]?.stringValue
      #expect(frame == step.frame, "step \(step.at): the frame")
      let gap = entry["gap"]?.boolValue ?? false
      #expect(gap == step.gap, "step \(step.at): the gap")
      if step.gap {
        let rows = entry["rows"]
        #expect(rows == nil, "step \(step.at): a gap draws no rows")
        continue
      }
      let model = ListModel.of(ListModel.inputs(rows: step.rows, activeId: nil, fieldIsLive: true))
      Self.compare(model, entry, at: step.at)
    }
    let last = steps.last
    #expect(last?.gap == true, "the old chain's delta ends the run")
  }

  /// P2 — the parameters: the manifest's defaults, as the golden's section says them, and `normalizeListParameters`'
  /// clamp (`list-parameters.ts:25-35`): a finite value into its range, anything else the default.
  @Test func theParametersAreTheDefaultsClampedIntoTheirRanges() throws {
    let golden = try HomeFixture.json("phone-list.golden")
    let first = golden["steps"]?.arrayValue?.first
    let rowHeight = first?["section"]?["rowHeight"]?.stringValue
    let projectWidth = first?["section"]?["projectWidth"]?.stringValue
    let defaults = ListModel.Parameters.defaults
    #expect(rowHeight == Self.px(defaults.rowHeight))
    #expect(projectWidth == Self.px(defaults.projectWidth))
    #expect(ListModel.Parameters.rowHeightRange == 26...72)
    #expect(ListModel.Parameters.projectWidthRange == 90...280)
    let clampedLow = ListModel.Parameters.normalize(["rowHeight": 10, "projectWidth": 1000])
    #expect(clampedLow == ListModel.Parameters(rowHeight: 26, projectWidth: 280))
    let inside = ListModel.Parameters.normalize(["rowHeight": 50, "projectWidth": 120])
    #expect(inside == ListModel.Parameters(rowHeight: 50, projectWidth: 120))
    let none = ListModel.Parameters.normalize([:])
    #expect(none == defaults)
    let nonFinite = ListModel.Parameters.normalize(["rowHeight": .nan, "projectWidth": .infinity])
    #expect(nonFinite == defaults)
    let foreign = ListModel.Parameters.normalize(["rowHeight": -.infinity, "rowheight": 40])
    #expect(foreign == defaults)
  }

  // MARK: - Hand rows: what the witness does not carry

  /// A witness open row's `monitorRow`, by model id, with `edits` applied (nil removes a key), decoded as the remote
  /// cut decodes it.
  static func monitor(_ id: String, _ edits: [String: JSONValue?] = [:]) throws -> MonitorAgentRow {
    let open = try HomeFixture.json("agent-remote-mesh-open.witness")
    let rows = (open["devices"]?.arrayValue ?? []).flatMap { $0["snapshot"]?["rows"]?.arrayValue ?? [] }
    let found = rows.compactMap { $0["monitorRow"] }.first { $0["id"]?.stringValue == id }
    var fields = try #require(found?.objectValue, "no witness row \(id)")
    for (key, value) in edits { fields[key] = value }
    return try MonitorAgentRow(json: .object(fields))
  }

  /// A hand row as the phone joins it: on the home or not by its device, greyed, lit or receded as told.
  static func input(
    _ id: String, _ edits: [String: JSONValue?] = [:], stale: Bool = false, active: Bool = false,
    receded: Bool = false
  ) throws -> ListRowInput {
    let monitor = try monitor(id, edits)
    return ListRowInput(
      monitor: monitor, isSelf: monitor.device.id == home, stale: stale, active: active, receded: receded)
  }

  static func row(_ id: String, _ edits: [String: JSONValue?] = [:]) throws -> ListRowModel {
    ListModel.row(try input(id, edits))
  }

  static func wait(_ kind: String, tool: String? = nil, question: String? = nil) -> JSONValue {
    var fields: [String: JSONValue] = ["kind": .string(kind), "since": .int(1_790_803_000_000)]
    if let tool { fields["tool"] = .string(tool) }
    if let question { fields["question"] = .string(question) }
    return .object(fields)
  }

  /// H1 — an account stands beside the model, in its name and its own small word; an empty one is no account.
  @Test func anAccountStandsBesideTheModel() throws {
    let bound = try Self.row("pty-h1", ["account": .string("work")])
    #expect(bound.agent == .agent(providerId: "claude", model: "Opus 5.5", account: "work"))
    #expect(bound.label.hasPrefix("vibe-field, Opus 5.5, work, idle: "))
    let blank = try Self.row("pty-h1", ["account": .string("")])
    #expect(blank.agent == .agent(providerId: "claude", model: "Opus 5.5", account: nil))
    #expect(blank.label.hasPrefix("vibe-field, Opus 5.5, idle: "))
  }

  /// H2 — a run nothing drives yet says so, a peer's after its desktop.
  @Test func aPendingRunSaysItResumesWhenIdle() throws {
    let home = try Self.row("pty-h1", ["pending": .bool(true)])
    #expect(home.detail == "unobserved · resumes when idle")
    let peer = try Self.row("run-p-done", ["pending": .bool(true)])
    #expect(peer.detail == "Loft · unobserved · resumes when idle")
  }

  /// H3 — a home run the runtime has not reported is `starting`.
  @Test func anUnobservedHomeRunIsStarting() throws {
    let starting = try Self.row("pty-h1", ["observed": .bool(false)])
    #expect(starting.detail == "starting")
  }

  /// H4 — a blocked row says what it waits on: a permission's tool; a peer's after its desktop, its question first;
  /// with no wait at all, `blocked`.
  @Test func aBlockedRowSaysWhatItWaitsOn() throws {
    let blocked: [String: JSONValue?] = ["status": .string("blocked")]
    let permission = try Self.row(
      "pty-h1", blocked.merging(["wait": Self.wait("permission", tool: "Bash")]) { $1 })
    #expect(permission.detail == "permission · Bash")
    let peer = try Self.row(
      "run-p-done", blocked.merging(["wait": Self.wait("permission", tool: "Bash")]) { $1 })
    #expect(peer.detail == "Loft · permission · Bash")
    let asked = try Self.row(
      "run-p-done", blocked.merging(["wait": Self.wait("question", question: "  Ship it?  ")]) { $1 })
    #expect(asked.detail == "Loft · Ship it?")
    let bare = try Self.row("pty-h1", blocked)
    #expect(bare.detail == "blocked")
    #expect(bare.status == .blocked)
  }

  /// H5 — a blank reply is no reply (the status word); a wait the toolkit does not know is said as it came.
  @Test func aBlankReplyAndAnUnknownWait() throws {
    let blank = try Self.row("pty-h1", ["reply": .object(["text": .string("  ")])])
    #expect(blank.detail == "idle")
    let unknown = try Self.row("pty-h1", ["status": .string("blocked"), "wait": Self.wait("sandbox")])
    #expect(unknown.detail == "sandbox")
  }

  /// H6 — context: unmeasured is `—`, a share is floored, and a terminal never prints one.
  @Test func theContextColumn() throws {
    let unmeasured = try Self.row("pty-h1", ["context": nil])
    #expect(unmeasured.context == "—")
    let nearlyFull = try Self.row("pty-h1", ["context": .object(["usedPercent": .double(99.9)])])
    #expect(nearlyFull.context == "99%")
    let terminal = try Self.row("pty-h2", ["context": .object(["usedPercent": .int(50)])])
    #expect(terminal.context == "—")
  }

  /// H7 — a branch is an agent's, and an empty one is none; an agent in no folder goes by its provider's label, a
  /// terminal in none by `terminal`.
  @Test func theProjectColumn() throws {
    func project(_ name: String, branch: JSONValue? = nil) -> [String: JSONValue?] {
      var fields: [String: JSONValue] = ["name": .string(name)]
      if let branch { fields["branch"] = branch }
      return ["project": .object(fields)]
    }
    let emptyBranch = try Self.row("pty-h1", project("vibe-field", branch: .string("")))
    #expect(emptyBranch.branch == nil)
    let noBranch = try Self.row("pty-h1", project("vibe-field", branch: .null))
    #expect(noBranch.branch == nil)
    let named = try Self.row("pty-h1", project("vibe-field", branch: .string("pg/5-list")))
    #expect(named.branch == "pg/5-list")
    let terminalBranch = try Self.row("pty-h2", project("notes", branch: .string("main")))
    #expect(terminalBranch.branch == nil)
    let folderless = try Self.row("pty-h1", project(""))
    #expect(folderless.project == "Claude Code")
    let bareTerminal = try Self.row("pty-h2", project(""))
    #expect(bareTerminal.project == "terminal")
    #expect(bareTerminal.agent == .terminal("terminal"))
  }

  /// H8 — the order (`compareAgents`): what the host shows first, agents before terminals, blocked, working, idle,
  /// then by birth; equal births keep the window's order (the stable sort). Receding is the desktop's: the phone joins
  /// `receded: false`, and these rows hold the transcription whole.
  @Test func theOrderIsAttentionThenBirth() throws {
    func made(_ id: String, kind: String = "agent", status: String, born: Int64, receded: Bool = false) throws
      -> ListRowInput
    {
      try Self.input(
        "pty-h1",
        ["id": .string(id), "kind": .string(kind), "status": .string(status), "createdAt": .int(born)],
        receded: receded)
    }
    // puppeteer's own case (`AgentList.test.tsx` at the pin): terminal, idle, working (9), working (3), blocked
    let mixed = [
      try made("t", kind: "terminal", status: "working", born: 1), try made("i", status: "idle", born: 2),
      try made("w2", status: "working", born: 9), try made("w1", status: "working", born: 3),
      try made("b", status: "blocked", born: 8),
    ]
    let order = ListModel.of(mixed).rows.map(\.id)
    #expect(order == ["b", "w1", "w2", "i", "t"])
    // equal births keep the order they came in, either way round
    let x = try made("x", status: "idle", born: 5)
    let y = try made("y", status: "idle", born: 5)
    let forward = ListModel.of([x, y]).rows.map(\.id)
    #expect(forward == ["x", "y"])
    let backward = ListModel.of([y, x]).rows.map(\.id)
    #expect(backward == ["y", "x"])
    // a receded row keeps its order below the shown ones, and the count says both
    let receding = [
      try made("b", status: "blocked", born: 1, receded: true), try made("w", status: "working", born: 2),
      try made("i", status: "idle", born: 3),
    ]
    let some = ListModel.of(receding)
    let someIds = some.rows.map(\.id)
    #expect(someIds == ["w", "i", "b"])
    #expect(some.count == "2 OF 3 SESSIONS")
    #expect(some.allReceded == false)
    let every = ListModel.of([
      try made("b", status: "blocked", born: 1, receded: true),
      try made("w", status: "working", born: 2, receded: true),
    ])
    #expect(every.count == "0 OF 2 SESSIONS")
    #expect(every.allReceded == true)
  }

  /// H9 — J-S4 (accept): the open card's row is lit, and only it.
  @Test func theOpenCardsRowIsLit() throws {
    let rows = try HomeFixture.witnessRows()
    #expect(ListModel.lightsOpenCard == true)
    let lit = ListModel.of(ListModel.inputs(rows: rows, activeId: "pty-h3", fieldIsLive: true))
    let litIds = lit.rows.filter(\.active).map(\.id)
    #expect(litIds == ["pty-h3"])
    let current = lit.rows.filter(\.current).map(\.id)
    #expect(current == ["pty-h3"])
    let none = ListModel.of(ListModel.inputs(rows: rows, activeId: nil, fieldIsLive: true))
    let noneLit = none.rows.filter(\.active).count
    #expect(noneLit == 0)
    let unknown = ListModel.of(ListModel.inputs(rows: rows, activeId: "run-nowhere", fieldIsLive: true))
    let unknownLit = unknown.rows.filter(\.active).count
    #expect(unknownLit == 0)
  }

  /// H10 — a home that does not answer greys every row (fd's Q10: `row.stale || !fieldIsLive`).
  @Test func aDeadLinkGreysEveryRow() throws {
    let rows = try HomeFixture.witnessRows()
    let dead = ListModel.inputs(rows: rows, activeId: nil, fieldIsLive: false)
    let greyed = dead.allSatisfy(\.stale)
    #expect(greyed)
    let live = ListModel.inputs(rows: rows, activeId: nil, fieldIsLive: true)
    let liveStale = live.map(\.stale)
    let owners = rows.map(\.stale)
    #expect(liveStale == owners)
  }

  /// H11 — `＋ TERMINAL` is recorded and not drawn (fd's Q1: a named deviation, PG-D10 (a)).
  @Test func theNewTerminalButtonIsNotDrawn() throws {
    let golden = try HomeFixture.json("phone-list.golden")
    let toolbar = golden["steps"]?.arrayValue?.first?["toolbar"]?.stringValue
    #expect(toolbar == ListModel.newTerminalWord)
    #expect(ListModel.drawsNewTerminal == false)
  }

  // MARK: - The empty list, the refused row, self and peer, the lifetime

  /// E1 — no rows: the empty state's two lines (`AgentList.tsx:116-119`), `0 SESSIONS`, nothing drawn. The mock fleet
  /// and a stopped link both hand the list no rows (HS:373; FieldLink.swift:692).
  @Test func noRowsDrawTheEmptyState() {
    let empty = ListModel.of([])
    #expect(empty.isEmpty)
    #expect(empty.count == "0 SESSIONS")
    #expect(empty.allReceded == false)
    #expect(ListModel.emptyTitle == "NO ACTIVE AGENTS")
    #expect(ListModel.emptyHint == "Launch an agent from a terminal pane.")
  }

  /// E2 — a row the cut refuses (a status this build does not know) never reaches the list: it draws the rest, and
  /// the refusing desktop greys by its standing (`incompatible`, RemoteBoardScreen).
  @Test func aRefusedRowLeavesTheRestDrawn() throws {
    var open = try HomeFixture.json("agent-remote-mesh-open.witness")
    guard case .object(var top) = open, case .array(var devices) = top["devices"] ?? .null else {
      Issue.record("the witness open's shape")
      return
    }
    for (d, device) in devices.enumerated() {
      guard case .object(var entry) = device, case .object(var snapshot) = entry["snapshot"] ?? .null,
        case .array(var rows) = snapshot["rows"] ?? .null
      else { continue }
      for (r, row) in rows.enumerated() {
        guard case .object(var board) = row, case .object(var monitor) = board["monitorRow"] ?? .null,
          monitor["id"]?.stringValue == "run-p-done"
        else { continue }
        monitor["status"] = .string("sleeping")
        board["monitorRow"] = .object(monitor)
        rows[r] = .object(board)
      }
      snapshot["rows"] = .array(rows)
      entry["snapshot"] = .object(snapshot)
      devices[d] = .object(entry)
    }
    top["devices"] = .array(devices)
    open = .object(top)
    var copy = RemoteMeshCopy()
    let decoded = try AgentRemoteMeshOpen(json: open)
    let outcome = copy.open(decoded, now: HomeFixture.now)
    #expect(outcome == .applied)
    _ = copy.publish()
    let list = ListModel.of(ListModel.inputs(rows: copy.drawn(), activeId: nil, fieldIsLive: true))
    #expect(list.count == "10 SESSIONS")
    let ids = list.rows.map(\.id)
    #expect(!ids.contains("run-p-done"))
    let loft = list.rows.filter { $0.id == "pty-p3" || $0.id == "pty-p1" }.map(\.stale)
    #expect(loft == [true, true])
  }

  /// S1 — self and peer, one named row each way: a home agent names no desktop, a peer's leads with its own; a home
  /// terminal says `terminal`, a peer's wears its desktop's name.
  @Test func selfAndPeer() throws {
    let rows = try HomeFixture.witnessRows()
    let list = ListModel.of(ListModel.inputs(rows: rows, activeId: nil, fieldIsLive: true))
    let byId = Dictionary(uniqueKeysWithValues: list.rows.map { ($0.id, $0) })
    #expect(byId["pty-h1"]?.remote == false)
    #expect(byId["pty-h1"]?.label.hasPrefix("vibe-field, ") == true)
    #expect(byId["pty-p3"]?.remote == true)
    #expect(byId["pty-p3"]?.label.hasPrefix("on Loft, ") == true)
    #expect(byId["pty-h2"]?.agent == .terminal("terminal"))
    #expect(byId["pty-p1"]?.agent == .host("Loft"))
  }
}
