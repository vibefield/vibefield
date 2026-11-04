import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-8 — THE RAIN'S ROW, WORDS AND PALETTE (pair 3, read-pg8 §7): G4 and G7 read `phone-rain.golden.json`; the hand
// rows H6 (J-S4's lit row, its words), H9 and H10 edit one witness row and read it through the phone's own copy, their
// lines computed by the shipping toolkit the rain imports (`lanes/pg8-rain/light/p3-probe.mjs`, its log beside it).

extension RainViewTests.Parity {
  /// G4 — the rain's palette is the desktop reader's over `tokens.css`, string for string (`readMonitorPalette().rain`
  /// and `text.primary`), with `statusPresentation`'s speeds; the phone's lit head is the dark palette's text main.
  @Test func thePaletteIsTheDesktops() throws {
    let open = try RainGolden.open()
    var theirs: [String: String] = [:]
    RainWords.flatten(open["palette"] ?? .null, into: &theirs)
    let mine = RainWords.flat(RainPalette.rain)
    #expect(mine == theirs, "the rain's palette, entry for entry")
    let textMain = open["tokens"]?["--vf-godview-dark-text-main"]?.stringValue
    #expect(RainPalette.rain.litHead == textMain, "J-S4: the lit head is --vf-godview-dark-text-main")
  }

  /// G7 — what each row's accessible button says, at every step, and that none is current (the goldens keep `active`
  /// false: PG:430).
  @Test func everyRowIsSpokenAsTheDesktopSaysIt() throws {
    for (golden, phone) in try RainGolden.paired() {
      if phone.gap { continue }
      let rows = phone.rows
      let expected = golden["spoken"]?.arrayValue ?? []
      let agents = rows.map { RainAgent(row: $0) }
      let mine = agents.map(\.spoken)
      let theirs = expected.map { $0["label"]?.stringValue ?? "" }
      #expect(mine == theirs, "step \(phone.at): the buttons, in the window's order")
      let current = expected.map { $0["current"]?.boolValue ?? true }
      let myCurrent = agents.map { $0.accessibilityValue != nil }
      #expect(myCurrent == current, "step \(phone.at): no row is current")
    }
  }
}

extension RainViewTests.Hand {
  /// One witness row, edited, as the rain reads it.
  static func edited(_ id: String, _ edit: (inout [String: JSONValue]) -> Void) throws -> RainAgent {
    let rows = try RainGolden.witness(editing: id, edit)
    let found = rows.first { $0.id == id }
    let row = try #require(found, "the edited row \(id) is drawn")
    return RainAgent(row: row)
  }

  /// H6 — J-S4, ACCEPTED (James 01:12–01:14Z): the open card's row is lit, and only it; its button says the same words
  /// and is "open". The host's join finds it by the card's subject (`GodviewStageInput.activeId`). With the switch
  /// thrown nothing is lit. The goldens light nothing (PG:430); the frame's half (its head, its glow) is pair 4's.
  @Test func theOpenCardsRowIsLit() throws {
    let steps = try HomeFixture.witnessSteps()
    let rows = try #require(steps.first?.rows, "the open's rows")
    let row = rows.first { $0.id == "pty-h3" }
    let subject = try #require(row?.visualId, "pty-h3 is drawn")
    let active = GodviewStageInput.activeId(rows: rows, cardSubject: subject)
    #expect(active == "pty-h3")
    let agents = rows.map { RainAgent(row: $0, activeId: active) }
    let lit = agents.filter(\.lit).map(\.id)
    #expect(lit == ["pty-h3"], "the open card's row, alone")
    let values = agents.map { $0.accessibilityValue ?? "-" }
    let openOnly = rows.map { $0.id == "pty-h3" ? "open" : "-" }
    #expect(values == openOnly, "its button is \"open\"")
    let plain = rows.map { RainAgent(row: $0).spoken }
    let spoken = agents.map { $0.spoken }
    #expect(spoken == plain, "lighting a row changes none of its words")
    let thrown = rows.map { RainAgent(row: $0, activeId: active, lightsOpenCard: false) }
    let thrownLit = thrown.filter(\.lit).map(\.id)
    #expect(thrownLit.isEmpty, "the switch thrown lights nothing")
    let thrownValues = thrown.compactMap(\.accessibilityValue)
    #expect(thrownValues.isEmpty)
    #expect(RainAgent.lightsOpenCard, "J-S4 stands")
  }

  /// H9 — a row not heard from says so: a pending run is "unobserved · resumes when idle" (a peer's after its desktop's
  /// name), an unobserved one on the home is "starting", and a peer's unobserved run keeps its reply. The witness's
  /// every row is observed and none pending.
  @Test func anUnheardRowSaysSo() throws {
    let pendingPeer = try Self.edited("pty-p3") { $0["pending"] = .bool(true) }
    #expect(pendingPeer.spoken == "puppeteer, Opus 5.5, blocked: Loft · unobserved · resumes when idle")
    let pendingHome = try Self.edited("run-h-quiet") { $0["pending"] = .bool(true) }
    #expect(pendingHome.spoken == "rosetta, GPT-5.5, working: unobserved · resumes when idle")
    let startingHome = try Self.edited("run-h-quiet") { $0["observed"] = .bool(false) }
    #expect(startingHome.spoken == "rosetta, GPT-5.5, working: starting")
    let unheardPeer = try Self.edited("run-p-done") { $0["observed"] = .bool(false) }
    #expect(unheardPeer.spoken == "rosetta, GPT-5.5, idle: Loft · Pushed the lane; the gate is green.")
  }

  /// H10 — a wait the toolkit does not know is said as itself (`waitLine`, the tolerance), with its tool after it; a
  /// blocked row with no wait says "blocked". Its stream is still blocked's: the rain keys on the status, never the
  /// wait. An unknown STATUS is refused before the rain. The witness's waits are a failure and a question.
  @Test func aWaitTheToolkitDoesNotKnowIsSaidAsItself() throws {
    // a live home row made to wait (pty-h3 is a crashed run, shown only while its wait is the failure: the window's
    // rule, `RemoteVisibility`)
    let home = try Self.edited("run-h-quiet") {
      $0["status"] = .string("blocked")
      $0["wait"] = .object(["kind": .string("elicitation"), "since": .int(1_790_803_010_000)])
    }
    #expect(home.spoken == "rosetta, GPT-5.5, blocked: elicitation")
    let presentation = RainPalette.rain.presentation(home.status)
    let blocked = RainPalette.rain.presentation(.blocked)
    #expect(presentation == blocked, "its stream is blocked's")
    let tool = try Self.edited("run-h-quiet") {
      $0["status"] = .string("blocked")
      $0["wait"] = .object([
        "kind": .string("elicitation"), "since": .int(1_790_803_010_000), "tool": .string("bash"),
      ])
    }
    #expect(tool.spoken == "rosetta, GPT-5.5, blocked: elicitation · bash")
    let peer = try Self.edited("pty-p3") {
      $0["wait"] = .object(["kind": .string("elicitation"), "since": .int(1_790_803_040_000)])
    }
    #expect(peer.spoken == "puppeteer, Opus 5.5, blocked: Loft · elicitation")
    let bare = try Self.edited("pty-p3") { $0["wait"] = nil }
    #expect(bare.spoken == "puppeteer, Opus 5.5, blocked: Loft · blocked")
    // a STATUS this build does not know refuses the row at decode (AgentRemoteShapes.swift:181): the rain never holds
    // one, so no presentation is missing
    let unknown = try? RainGolden.witness(editing: "run-h-quiet") { $0["status"] = .string("paused") }
    let held = unknown?.contains { $0.id == "run-h-quiet" } ?? false
    #expect(!held, "a row with an unknown status never reaches the rain")
  }
}

/// The palette both ways as one flat map: `rain.status.blocked.speed` → `0.02`, the shape the golden writes.
enum RainWords {
  static func flat(_ palette: RainPalette) -> [String: String] {
    var out: [String: String] = [
      "rain.stage": palette.stage, "rain.activeHead": palette.activeHead, "rain.hoverTailRgb": palette.hoverTailRgb,
      "rain.ink.working": palette.inkWorking, "rain.ink.blocked": palette.inkBlocked, "rain.ink.idle": palette.inkIdle,
      "rain.focus": palette.focus, "textPrimary": palette.textPrimary,
    ]
    let statuses: [(String, MonitorRowStatus)] = [("working", .working), ("blocked", .blocked), ("idle", .idle)]
    for (name, status) in statuses {
      let presentation = palette.presentation(status)
      out["rain.status.\(name).head"] = presentation.head
      out["rain.status.\(name).tailRgb"] = presentation.tail
      if let speed = presentation.speed { out["rain.status.\(name).speed"] = "\(speed)" }
    }
    return out
  }

  static func flatten(_ value: JSONValue, prefix: String = "", into out: inout [String: String]) {
    switch value {
    case .object(let fields):
      for (key, field) in fields { flatten(field, prefix: prefix.isEmpty ? key : "\(prefix).\(key)", into: &out) }
    case .string(let text): out[prefix] = text
    case .double(let number): out[prefix] = "\(number)"
    case .int(let number): out[prefix] = "\(number)"
    default: out[prefix] = "\(value)"
    }
  }
}
