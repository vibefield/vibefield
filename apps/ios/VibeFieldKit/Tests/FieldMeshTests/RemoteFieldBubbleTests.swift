import FieldAgents
import Foundation
import Testing

@testable import FieldMesh
@testable import FieldProduct

// PG-3e — one drawn row's bubble (`fieldBubble(from:fieldIsLive:catalog:suppressUnread:)`), row by row, for what the
// body golden cannot reach (the body read §5: every witness row is observed; none waits on a permission or an undrawn
// kind; none has an empty name, model or effort, a catalog, or an absurd context) and for what is not drawn at all:
// the three ids, the join the card and the keyring read, the phone-only grey. Each case is an EDIT of a witness row,
// and each row asserts its unedited baseline first, so a mapping that drew nothing could not pass.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite struct RemoteFieldBubbleTests {
  typealias R = RemoteRows
  static let now = Date(timeIntervalSince1970: 1_790_803_300)

  static func bubble(
    _ json: JSONValue, here: String = RemoteRows.home, fieldIsLive: Bool = true, catalog: AgentCatalog = .empty,
    visualId: String? = nil
  ) throws -> FieldBubble {
    let row = try R.fieldRow(json, here: here, visualId: visualId)
    return fieldBubble(from: row, fieldIsLive: fieldIsLive, catalog: catalog, suppressUnread: false)
  }

  static func body(_ bubble: FieldBubble) -> SwarmBodyModel { bodyModel(BodyModelInput(bubble: bubble, now: now)) }

  /// M1 — a row the runtime has not reported (`observed: false`) draws no cost, no reply, no wait and no effort, as
  /// the window's `observed()` reads them; its observed twin draws all four.
  @Test func anUnobservedRowDrawsNoCostReplyWaitOrEffort() throws {
    let ask = try R.row("run-p-ask")
    let seen = try Self.bubble(ask)
    let seenCost = seen.agent?.cost
    #expect(seenCost == AgentCost(usd: 1.24, coverage: "complete", burnPerHour: 0.6))
    let seenReply = seen.agent?.lastMessage
    #expect(seenReply == "The fold re-inserts a peer's rows. One question before I fix it.")
    let seenWait = seen.agent?.blocker
    #expect(seenWait?.kind == .question)
    #expect(seenWait?.header == "Peer order")
    let seenEffort = seen.agent?.effort
    #expect(seenEffort == AgentEffort(value: "high", intent: .observed))

    let unseen = try Self.bubble(R.monitor(ask, ["observed"], .bool(false)))
    let unseenCost = unseen.agent?.cost
    #expect(unseenCost == nil)
    let unseenReply = unseen.agent?.lastMessage
    #expect(unseenReply == nil)
    let unseenWait = unseen.agent?.blocker
    #expect(unseenWait == nil)
    let unseenEffort = unseen.agent?.effort
    #expect(unseenEffort == nil)
    #expect(unseen.status == .blocked)
    // the body says the bare word with the failure's mark, as the window does for a blocked row with no drawn wait
    let state = Self.body(unseen).copy.first { $0.key == "state" }
    #expect(state?.text == "blocked")
    #expect(state?.lead?.kind == .icon("failure"))
  }

  /// M2 — a wait of a kind the views do not draw (`DRAWN_WAITS`) is no blocker: the body says "blocked" with the
  /// failure's mark and no `blockerKind`, never the raw word as a failure.
  @Test func anUndrawnWaitIsBlockedWithoutItsMark() throws {
    let ask = R.monitor(try R.row("run-p-ask"), ["reply"], nil)
    let drawn = Self.body(try Self.bubble(ask))
    #expect(drawn.blockerKind == .question)
    let sandbox = try Self.bubble(R.monitor(ask, ["wait", "kind"], .string("sandbox")))
    let blocker = sandbox.agent?.blocker
    #expect(blocker == nil)
    let body = Self.body(sandbox)
    let state = body.copy.first { $0.key == "state" }
    #expect(state?.text == "blocked")
    #expect(state?.lead?.kind == .icon("failure"))
    #expect(body.blockerKind == nil)
    #expect(body.light == .orange)
  }

  /// M3 — 3d's V1: the launched agent drawn in the shell's body is three ids — the body's (the visual id, the
  /// golden's and the card's), the model's (a report's) and the board key (a resume's).
  @Test func aBodyIsItsVisualIdentity() throws {
    let rows = try R.handOff()
    let launched = try #require(rows.first { $0.id == "run-h-launch" })
    let bubble = fieldBubble(from: launched, fieldIsLive: true, catalog: .empty, suppressUnread: false)
    #expect(bubble.id == "pty-h2")
    #expect(bubble.modelId == "run-h-launch")
    #expect(bubble.runKey == "run-h-launch-key")
    #expect(bubble.agent != nil)
    let drawnIds = rows.map { $0.id }
    #expect(!drawnIds.contains("pty-h2"))
    // a row with no hand-off is its own id three ways but the key
    let turn = try #require(rows.first { $0.id == "pty-h1" })
    let plain = fieldBubble(from: turn, fieldIsLive: true, catalog: .empty, suppressUnread: false)
    #expect(plain.id == "pty-h1")
    #expect(plain.modelId == "pty-h1")
    #expect(plain.runKey == "run-h-turn")
  }

  /// M4 — the phone-only grey: while no live home answers for the copy, every body is stale and every join says its
  /// desktop is not live. With the home answering, the window's own stale stands, mixed.
  @Test func theHomeLinkDownGreysEveryBody() throws {
    let rows = try R.drawn()
    let live = rows.map { fieldBubble(from: $0, fieldIsLive: true, catalog: .empty, suppressUnread: false) }
    let liveStale = live.map { $0.stale }
    #expect(liveStale.contains(true))
    #expect(liveStale.contains(false))
    let windowStale = rows.map { $0.stale }
    #expect(liveStale == windowStale)
    let down = rows.map { fieldBubble(from: $0, fieldIsLive: false, catalog: .empty, suppressUnread: false) }
    let downStale = down.map { $0.stale }
    #expect(downStale.allSatisfy { $0 })
    #expect(downStale.count == rows.count)
    let joins = down.compactMap { $0.agent?.join }
    #expect(!joins.isEmpty)
    let liveJoins = joins.map { $0.deviceLive }
    #expect(liveJoins.allSatisfy { !$0 })
    // with the home answering: a home row's desktop is live whatever its owner's stale, a peer's by its standing
    let up = live.compactMap { bubble in bubble.agent?.join.map { (bubble.modelId ?? "?", $0.deviceLive) } }
    let upById = Dictionary(up, uniquingKeysWith: { first, _ in first })
    #expect(upById["pty-h3"] == true)
    #expect(upById["pty-p3"] == true)
    #expect(upById["run-a-idle"] == false)
  }

  /// M5 — the join is the board's terminal: the crashed run that keeps its pane is hosted on the home, attaches to its
  /// own session, and has exited; its hue keys by that session.
  @Test func theJoinIsTheBoardsTerminal() throws {
    let crash = try Self.bubble(try R.row("run-h-crash"))
    let join = crash.agent?.join
    #expect(join?.deviceID == R.home)
    #expect(join?.hosted == "local")
    #expect(join?.runtimeSessionID == "pty-h3")
    #expect(join?.exited == true)
    #expect(join?.pending == false)
    #expect(join?.nativeSessionID == "1f5b9d3e-6a0c-4e72-8b4f-2d6a0e8c4f95")
    #expect(crash.identityKey == "pty-h3")
    // a run with no pane: `none`, no session, its key for the hue
    let partial = try Self.bubble(try R.row("run-h-partial"))
    let none = partial.agent?.join
    #expect(none?.hosted == "none")
    #expect(none?.runtimeSessionID == nil)
    #expect(none?.exited == false)
    #expect(partial.identityKey == "run-h-partial")
    // a PENDING row is live and merely unobserved: its flag rides the join, and it has not exited (MF-1f)
    let pendingJSON = R.monitor(try R.row("run-h-crash"), ["pending"], .bool(true))
    let pending = try Self.bubble(pendingJSON).agent?.join
    #expect(pending?.pending == true)
    #expect(pending?.exited == false)
  }

  /// M6 — a bare terminal is a hollow with no facet; a peer's wears its host (Q-E8: no attach in 3e, so no join).
  @Test func aBareTerminalIsHollowAndAPeersWearsItsHost() throws {
    let shell = try Self.bubble(try R.row("pty-h2"))
    #expect(shell.agent == nil)
    #expect(shell.remote == nil)
    #expect(shell.host == nil)
    #expect(shell.status == .working)
    let shellBody = Self.body(shell)
    #expect(shellBody.hollow)
    #expect(shellBody.running)
    let peer = try Self.bubble(try R.row("pty-p1"))
    #expect(peer.agent == nil)
    #expect(peer.host == "Loft")
    #expect(peer.modelId == "pty-p1")
    let peerBody = Self.body(peer)
    #expect(peerBody.hollow)
    let host = peerBody.copy.last
    #expect(host?.key == "host")
    #expect(host?.text == "Loft")
    #expect(peerBody.accessibilityLabel == "on Loft, notes, remote session, idle")
    #expect(peerBody.title == "Loft · notes")
  }

  /// M6b (PG-3e, the review's [1]; J-E3 as James picked) — a bubble with neither facet, a bare terminal on the home or
  /// on a peer, wears the terminal prompt on its card's header and badge, never nothing; an agent wears its mark.
  @Test func aBareTerminalWearsThePrompt() throws {
    let shell = try Self.bubble(try R.row("pty-h2"))
    #expect(shell.glyph == .terminalPrompt)
    let peer = try Self.bubble(try R.row("pty-p1"))
    #expect(peer.glyph == .terminalPrompt)
    let agent = try Self.bubble(try R.row("run-h-partial"))
    let mark = try #require(agent.agent?.markKey)
    #expect(agent.glyph == .agentMark(mark))
  }

  /// M7 — the names are the owner's words (sdk `words.js`): an empty folder name is an agent's provider label or a
  /// terminal's `terminal`; an empty model is the provider label, never the catalog's; an empty effort is none.
  @Test func namesAreTheOwnersWords() throws {
    let turn = try R.row("run-h-turn")
    let named = try Self.bubble(turn)
    #expect(named.project == "vibe-field")
    #expect(named.agent?.modelName == "Opus 5.5")
    let unnamed = try Self.bubble(R.monitor(turn, ["project", "name"], .string("")))
    #expect(unnamed.project == "Claude Code")
    let shell = try Self.bubble(R.monitor(try R.row("pty-h2"), ["project", "name"], .string("")))
    #expect(shell.project == "terminal")
    let catalog = AgentCatalog(entries: [AgentCatalogEntry(id: .claude, label: "The Catalog's Claude", status: "supported")])
    let modelless = try Self.bubble(R.monitor(turn, ["model"], .string("")), catalog: catalog)
    #expect(modelless.agent?.modelName == "Claude Code")
    let modelLine = Self.body(modelless).copy.first { $0.key == "model" }
    #expect(modelLine?.text == "Claude Code · high")
    let effortless = try Self.bubble(R.monitor(turn, ["effort", "value"], .string("")))
    #expect(effortless.agent?.effort == nil)
    let bare = Self.body(effortless).copy.first { $0.key == "model" }
    #expect(bare?.text == "Opus 5.5")
    // a branch: named and non-empty only
    let branched = try Self.bubble(turn)
    #expect(branched.agent?.branch == "pg/3a")
    let unbranched = try Self.bubble(R.monitor(turn, ["project", "branch"], .string("")))
    #expect(unbranched.agent?.branch == nil)
  }

  /// M7b — the line under the name, by the toolkit's one rule (`detailLine`): a home agent's reply, else its status;
  /// a peer's leads with its desktop and prefers the question it asks; a terminal says the backend's own line.
  @Test func theDetailLineIsTheToolkitsRule() throws {
    let turn = try Self.bubble(try R.row("run-h-turn"))
    #expect(turn.detail == "Each desktop keeps its place in the order now; the fold's tests are green.")
    let ask = try Self.bubble(try R.row("run-p-ask"))
    #expect(ask.detail == "Loft · Keep each desktop's rows in the board's order, or sort them by birth?")
    let nocwd = try Self.bubble(try R.row("run-h-nocwd"))
    #expect(nocwd.detail == "idle")
    let pending = try Self.bubble(R.monitor(try R.row("run-h-nocwd"), ["pending"], .bool(true)))
    #expect(pending.detail == "unobserved · resumes when idle")
    let starting = try Self.bubble(R.monitor(try R.row("run-h-nocwd"), ["observed"], .bool(false)))
    #expect(starting.detail == "starting")
    let shell = try Self.bubble(try R.row("pty-h2"))
    #expect(shell.detail == "notes")
  }

  /// M8 — the catalog marks the body but does not name it: the watermark is the catalog's mark, the model line the
  /// owner's model.
  @Test func theCatalogMarksButDoesNotName() throws {
    let turn = try R.row("run-h-turn")
    let plain = try Self.bubble(turn)
    #expect(plain.agent?.catalogEntry == nil)
    #expect(Self.body(plain).watermark?.sprite == "claude")
    let entry = AgentCatalogEntry(id: .claude, label: "The Catalog's Claude", status: "supported", mark: "claude-next")
    let marked = try Self.bubble(turn, catalog: AgentCatalog(entries: [entry]))
    #expect(marked.agent?.catalogEntry == entry)
    let body = Self.body(marked)
    #expect(body.watermark?.sprite == "claude-next")
    let model = body.copy.first { $0.key == "model" }
    #expect(model?.text == "Opus 5.5 · high")
    #expect(!body.title.contains("The Catalog's Claude"))
  }

  /// M9 — a permission wait offers its chips (`permissions`, the card's reply chips): blocked, observed, and waiting
  /// on a permission names its tool once, however many wait; anything else offers none.
  @Test func aPermissionWaitOffersItsChips() throws {
    let wait = JSONValue.object([
      "kind": .string("permission"), "since": .int(1_790_803_040_000), "tool": .string("Bash"), "count": .int(3),
    ])
    let ask = R.monitor(try R.row("run-p-ask"), ["wait"], wait)
    let asking = try Self.bubble(ask)
    let chips = asking.agent?.permissions
    #expect(chips == [AgentPermission(tool: "Bash")])
    #expect(asking.agent?.blocker?.kind == .permission)
    #expect(asking.agent?.blocker?.tool == "Bash")
    let idle = try Self.bubble(R.monitor(ask, ["status"], .string("idle")))
    let idleChips = idle.agent?.permissions
    #expect(idleChips == [])
    let unseen = try Self.bubble(R.monitor(ask, ["observed"], .bool(false)))
    let unseenChips = unseen.agent?.permissions
    #expect(unseenChips == [])
    let question = try Self.bubble(try R.row("run-p-ask"))
    let questionChips = question.agent?.permissions
    #expect(questionChips == [])
  }

  /// M10 — an absurd context (`usedPercent` is an unbounded number on the wire) reads dashes and no ring, and never
  /// traps the floor.
  @Test func anAbsurdContextReadsDashes() throws {
    let partial = try R.row("run-h-partial")
    let sane = Self.body(try Self.bubble(partial))
    #expect(sane.figures?.top?.text == "83%")
    let absurd = Self.body(try Self.bubble(R.monitor(partial, ["context", "usedPercent"], .double(1e21))))
    #expect(absurd.figures?.top == SwarmFigure(text: "--", hot: false, none: true))
    #expect(absurd.ring == nil)
  }
}
