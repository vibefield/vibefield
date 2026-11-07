import FieldDesign
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// IOS-12f (PC-L1, one Chat; NS-D1 A, NS-D2 B, NS-D5; VF-PM 2026-11-07 12:35:44Z) — the phone's New spark sheet is the
/// Mac's. Each golden is written by field-app's own model (`packages/field-app/test/new-spark-goldens.test.ts`) and
/// copied here byte for byte (`pnpm check:ios-fixtures`): what the sheet reads, in (the home's `agent.providers` rows,
/// its Agent Profiles, an agent's `agent.models` answer, a hatch's refusal); what the model says, out. Each input is
/// the golden's own, decoded as the phone decodes one. The controller's choices and the sheet's phone words are held
/// to DESIGN.md §8 and §9 by the rows at the foot.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("IOS-12f — the phone's New spark sheet is the Mac's: the new-spark goldens")
struct NewSparkGoldenTests {
  @Test("the name it suggests: the first star no spark holds, without regard to case; and the faces it deals")
  func names() throws {
    let golden = try Self.golden("new-spark.names.golden")
    let listed = try #require(golden["starNames"]?.arrayValue)
    let starNames = listed.compactMap { $0.stringValue }
    #expect(NewSpark.starNames == starNames)
    let suggest = try #require(golden["suggest"]?.arrayValue)
    #expect(suggest.count == 5)
    for each in suggest {
      let taken = (each["taken"]?.arrayValue ?? []).compactMap { $0.stringValue }
      let name = NewSpark.suggestName(taken)
      #expect(.string(name) == each["name"], "taken \(taken)")
    }
    let deal = try #require(golden["deal"]?.arrayValue)
    #expect(deal.count == 4)
    for each in deal {
      let random = try #require(each["random"]?.doubleValue)
      let seed = NewSpark.dealSeed(random)
      #expect(.int(Int64(seed)) == each["seed"], "random \(random)")
    }
  }

  @Test("the agents its menu lists: sparks first, then the installed ones not yet, with why; and its sentences")
  func agents() throws {
    let golden = try Self.golden("new-spark.agents.golden")
    let words = try #require(golden["words"])
    #expect(.string(NewSparkWords.cannotTakeTools) == words["cannotTakeTools"])
    #expect(.string(NewSparkWords.cannotListAgents) == words["cannotListAgents"])
    #expect(.string(NewSparkWords.cannotListProfiles) == words["cannotListProfiles"])
    let cases = try #require(golden["cases"]?.arrayValue)
    #expect(cases.count == 8)
    for each in cases {
      let name = each["name"]?.stringValue ?? "?"
      let providers = try (each["providers"]?.arrayValue ?? []).map(AgentProviderSummary.init(json:))
      let agents = NewSpark.sparkAgents(providers)
      let drawn = JSONValue.array(agents.map { Self.json($0) })
      let want = try #require(each["agents"])
      #expect(drawn == want, "\(name)")
    }
  }

  @Test("the agent menu's rows, field by field: its own model first, then the picker's, or a word in their place")
  func menu() throws {
    let golden = try Self.golden("new-spark.menu.golden")
    let agents = try (golden["agents"]?.arrayValue ?? []).map(Self.agent)
    #expect(agents.count == 3)
    let answers = try #require(golden["answers"]?.objectValue)
    let cases = try #require(golden["menu"]?.arrayValue)
    #expect(cases.count == 12)
    for each in cases {
      let name = each["name"]?.stringValue ?? "?"
      let picker = try Self.picker(each["picker"], answers: answers)
      let selection = try each["selection"].map(AgentModelSelection.init(json:))
      let rows = NewSpark.menu(
        agents, chosen: each["chosen"]?.stringValue, picker: picker, selection: selection,
        under: each["under"]?.stringValue)
      let drawn = JSONValue.array(rows.map { Self.json($0) })
      let want = try #require(each["rows"])
      #expect(drawn == want, "\(name)")
    }
  }

  @Test("Effort, once a model is chosen: its values, the chosen or default one on")
  func effort() throws {
    let golden = try Self.golden("new-spark.menu.golden")
    let cases = try #require(golden["effort"]?.arrayValue)
    #expect(cases.count == 6)
    for each in cases {
      let name = each["name"]?.stringValue ?? "?"
      let model = try each["model"].map(AgentModelChoice.init(json:))
      let selection = try each["selection"].map(AgentModelSelection.init(json:))
      let effort = Self.json(NewSpark.effort(model, selection))
      let want = each["effort"]
      #expect(effort == want, "\(name)")
    }
  }

  @Test("the pill: the agent alone while untouched, then its model and effort")
  func pill() throws {
    let golden = try Self.golden("new-spark.menu.golden")
    let cases = try #require(golden["pill"]?.arrayValue)
    #expect(cases.count == 4)
    for each in cases {
      let name = each["name"]?.stringValue ?? "?"
      let agent = try each["agent"].map(Self.agent)
      let model = try each["model"].map(AgentModelChoice.init(json:))
      let selection = try each["selection"].map(AgentModelSelection.init(json:))
      let words = JSONValue.array(NewSpark.modelWords(model, selection).map { JSONValue.string($0) })
      let line = JSONValue.string(NewSpark.agentLine(agent, model, selection))
      let wantWords = each["words"]
      let wantLine = each["line"]
      #expect(words == wantWords, "\(name): words")
      #expect(line == wantLine, "\(name): line")
    }
  }

  @Test("the profiles: the default, the chips, what they start, what they see, and the reach")
  func profiles() throws {
    let golden = try Self.golden("new-spark.profiles.golden")
    let sets = try #require(golden["sets"])
    let two = try (sets["two"]?.arrayValue ?? []).map(AgentProfileSet.init(json:))
    let many = try (sets["many"]?.arrayValue ?? []).map(AgentProfileSet.init(json:))
    #expect(two.count == 2)
    #expect(many.count == 4)
    let named = { (key: String?) -> [AgentProfileSet] in
      switch key ?? "" {
      case "two": two
      case "two:first": Array(two.prefix(1))
      case "many": many
      default: []
      }
    }
    for each in golden["defaultOf"]?.arrayValue ?? [] {
      let id = NewSpark.defaultProfile(named(each["sets"]?.stringValue))?.id
      let said: JSONValue = id.map { JSONValue.string($0) } ?? .null
      let want = each["id"]
      let name = each["name"]?.stringValue ?? "?"
      #expect(said == want, "default of \(name)")
    }
    let agents = try (golden["agents"]?.arrayValue ?? []).map(Self.agent)
    let chips = try #require(golden["chips"]?.arrayValue)
    #expect(chips.count == 4)
    for each in chips {
      let name = each["name"]?.stringValue ?? "?"
      let these = named(each["sets"]?.stringValue)
      let chosen = (each["chosen"]?.arrayValue ?? []).compactMap { $0.stringValue }
      let under = each["thinksUnder"]?.stringValue
      let drawn = JSONValue.array(
        NewSpark.profileChips(these, chosen: chosen, thinksUnder: under).map { Self.json($0) })
      let starts = JSONValue.array(
        NewSpark.starts(these, chosen: chosen, thinksUnder: under, agents: agents).map { JSONValue.string($0) })
      let wantChips = each["chips"]
      let wantStarts = each["starts"]
      #expect(drawn == wantChips, "\(name): chips")
      #expect(starts == wantStarts, "\(name): starts")
    }
    let sessions = (golden["sessions"]?.arrayValue ?? []).map {
      RunProfileFacts(profileSet: $0["profileSet"]?.stringValue, profileId: $0["profileId"]?.stringValue)
    }
    #expect(sessions.count == 5)
    let seen = try #require(golden["seen"]?.arrayValue)
    #expect(seen.count == 5)
    for each in seen {
      let read = each["read"]?.boolValue ?? false
      let chosen = (each["chosen"]?.arrayValue ?? []).compactMap { $0.stringValue }
      let these = named(each["sets"]?.stringValue)
      let seenCount = NewSpark.sessionsSeen(read ? sessions : nil, sets: these, chosen: chosen)
      let count: JSONValue = seenCount.map { JSONValue.int(Int64($0)) } ?? .null
      let want = each["count"]
      let name = each["name"]?.stringValue ?? "?"
      #expect(count == want, "seen \(name)")
    }
    let reach = try #require(golden["reach"]?.arrayValue)
    #expect(reach.count == 6)
    for each in reach {
      let sessions = each["sessions"]?.intValue.map { Int($0) }
      let starts = (each["starts"]?.arrayValue ?? []).compactMap { $0.stringValue }
      let words = JSONValue.string(NewSpark.reach(sessions, starts: starts))
      let want = each["words"]
      #expect(words == want, "reach \(String(describing: sessions)) \(starts)")
    }
    for each in golden["list"]?.arrayValue ?? [] {
      let words = (each["words"]?.arrayValue ?? []).compactMap { $0.stringValue }
      let said = JSONValue.string(NewSpark.listWords(words))
      let want = each["said"]
      #expect(said == want, "list \(words)")
    }
  }

  @Test("a hatch's refusal: said where the sheet asked, in its words; anything else under the foot, in fieldd's")
  func refusals() throws {
    let golden = try Self.golden("new-spark.refusals.golden")
    let cases = try #require(golden["cases"]?.arrayValue)
    #expect(cases.count == 7)
    for each in cases {
      let name = each["name"]?.stringValue ?? "?"
      let thrown = try #require(each["thrown"])
      let ask = try #require(each["ask"])
      let refusal = Self.json(NewSpark.refusal(
        reason: thrown["reason"]?.stringValue, message: thrown["message"]?.stringValue ?? thrown.stringValue ?? "",
        ask: RefusalAsk(
          name: ask["name"]?.stringValue ?? "", agent: ask["agent"]?.stringValue,
          profile: ask["profile"]?.stringValue)))
      let want = try #require(each["refusal"])
      #expect(refusal == want, "\(name)")
    }
  }

  // MARK: - Reading the goldens

  static func golden(_ name: String) throws -> JSONValue {
    guard
      let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/new-spark")
    else { throw GoldenMissing(name: name) }
    return try JSONValue.parse(try Data(contentsOf: url))
  }

  struct GoldenMissing: Error {
    let name: String
  }

  static func agent(_ json: JSONValue) throws -> SparkAgent {
    let id = try #require(json["id"]?.stringValue)
    let label = try #require(json["label"]?.stringValue)
    let takes = try #require(json["takes"]?.boolValue as Bool?)
    return SparkAgent(id: id, label: label, takes: takes, why: json["why"]?.stringValue)
  }

  static func picker(_ json: JSONValue?, answers: [String: JSONValue]) throws -> ModelsReading? {
    guard let json else { return nil }
    switch json["state"]?.stringValue {
    case "reading": return .reading
    case "failed": return .failed(json["words"]?.stringValue ?? "")
    default:
      let key = try #require(json["answer"]?.stringValue)
      let answer = try #require(answers[key])
      return .read(try AgentModelsResult(json: answer))
    }
  }

  static func json(_ agent: SparkAgent) -> JSONValue {
    var fields: [String: JSONValue] = [
      "id": .string(agent.id), "label": .string(agent.label), "takes": .bool(agent.takes),
    ]
    if let why = agent.why { fields["why"] = .string(why) }
    return .object(fields)
  }

  static func json(_ row: AgentMenuRow) -> JSONValue {
    switch row {
    case .agent(let agent, let under):
      var fields: [String: JSONValue] = ["kind": .string("agent"), "agent": json(agent)]
      if let under { fields["under"] = .string(under) }
      return .object(fields)
    case .model(let id, let label, let on):
      return .object([
        "kind": .string("model"), "id": id.map { .string($0) } ?? .null, "label": .string(label), "on": .bool(on),
      ])
    case .note(let words):
      return .object(["kind": .string("note"), "words": .string(words)])
    }
  }

  static func json(_ effort: EffortChoice?) -> JSONValue {
    guard let effort else { return .null }
    return .object([
      "label": .string(effort.label),
      "values": .array(
        effort.values.map { .object(["id": .string($0.id), "label": .string($0.label), "on": .bool($0.on)]) }),
    ])
  }

  static func json(_ chip: ProfileChip) -> JSONValue {
    .object([
      "id": .string(chip.id), "label": .string(chip.label), "checked": .bool(chip.checked), "home": .bool(chip.home),
    ])
  }

  static func json(_ refusal: SheetRefusal) -> JSONValue {
    .object(["at": .string(refusal.at.rawValue), "words": .string(refusal.words)])
  }
}

/// The sheet's own choices (the Mac's `NewSparkSheet.tsx`) and its phone words, held to DESIGN.md §8 "The phone's
/// Chat" (New spark) and §9 "Chat on the phone" where no golden reaches.
@Suite("IOS-12f — the New spark sheet's choices and its phone words")
struct NewSparkSheetTests {
  /// Two Agent Profiles: the agents' own folders (not marked default) and Work (marked default).
  static func sets() throws -> [AgentProfileSet] {
    let golden = try NewSparkGoldenTests.golden("new-spark.profiles.golden")
    return try (golden["sets"]?["two"]?.arrayValue ?? []).map(AgentProfileSet.init(json:))
  }

  static let agents = [
    SparkAgent(id: "agent-a", label: "Agent A", takes: false, why: "can't take VibeField's tools yet"),
    SparkAgent(id: "agent-b", label: "Agent B", takes: true, why: nil),
    SparkAgent(id: "agent-c", label: "Agent C", takes: true, why: nil),
  ]

  @Test("as it opens: the first agent that takes, the default profile it thinks under, and that profile chosen")
  func opening() throws {
    let sets = try Self.sets()
    let opened = NewSpark.opening(agents: Self.agents, sets: sets)
    let want = NewSparkOpening(agent: "agent-b", thinksUnder: "work", profiles: ["work"], refusal: nil)
    #expect(opened == want)
  }

  @Test("a read that fails is said at the foot, the agents' first; Create waits and never in silence")
  func failedReads() throws {
    let sets = try Self.sets()
    let agentsFailed = NewSpark.opening(agents: nil, sets: sets)
    #expect(agentsFailed.agent == nil)
    #expect(agentsFailed.refusal == SheetRefusal(at: .foot, words: NewSparkWords.cannotListAgents))
    let profilesFailed = NewSpark.opening(agents: Self.agents, sets: nil)
    #expect(profilesFailed.thinksUnder == nil)
    #expect(profilesFailed.refusal == SheetRefusal(at: .foot, words: NewSparkWords.cannotListProfiles))
    let none = NewSpark.opening(agents: Self.agents, sets: [])
    #expect(none.refusal == SheetRefusal(at: .foot, words: NewSparkWords.cannotListProfiles))
    let both = NewSpark.opening(agents: nil, sets: nil)
    #expect(both.refusal == SheetRefusal(at: .foot, words: NewSparkWords.cannotListAgents))
    #expect(NewSparkWords.cannotListAgents == "VibeField can't list its agents right now")
  }

  @Test("the profiles it sees are the chosen ones and the one it thinks under, the chosen first")
  func seen() {
    #expect(NewSpark.seen(["work"], thinksUnder: "work") == ["work"])
    #expect(NewSpark.seen(["side"], thinksUnder: "work") == ["side", "work"])
    #expect(NewSpark.seen([], thinksUnder: nil) == [])
  }

  @Test("the phone calls the agents' own folders Default (PJ-7), on the chips, the pill and a refusal")
  func defaultsName() throws {
    let sets = try Self.sets()
    let nativeSet = sets.first { $0.kind == "native" }
    let workSet = sets.first { $0.id == "work" }
    let native = try #require(nativeSet)
    let work = try #require(workSet)
    #expect(NewSpark.label(native) == "Default")
    #expect(NewSpark.label(work) == "Work")
    #expect(NewSpark.under(sets, thinksUnder: "native") == "Default")
    #expect(NewSpark.under(sets, thinksUnder: "work") == "Work")
    #expect(NewSpark.under(Array(sets.prefix(1)), thinksUnder: "native") == nil)
    let refused = NewSpark.refusal(
      reason: "no-sign-in", message: "no sign-in",
      ask: RefusalAsk(name: "Vela", agent: "Claude Code", profile: NewSpark.label(native)))
    #expect(refused == SheetRefusal(at: .agent, words: "Default has no Claude Code sign-in"))
  }

  /// The witness's home agent (`run-h-turn`), edited: its key, its desktop, its spark, whether it lives, its profile.
  static func run(
    _ key: String, device: String = "dev-01HQ9S7UD1", spark: String? = nil, alive: Bool = true,
    profileSet: String? = nil
  ) throws -> AgentRemoteRow {
    let open = try HomeFixture.json("agent-remote-mesh-open.witness")
    let rows = open["devices"]?.arrayValue?.first?["snapshot"]?["rows"]?.arrayValue ?? []
    let turn = try #require(rows.first { $0["runtimeRunId"]?.stringValue == "run-h-turn" })
    guard case .object(var fields) = turn, case .object(var monitor)? = fields["monitorRow"] else {
      throw HomeFixture.MissingFixture(name: "run-h-turn")
    }
    fields["runtimeRunId"] = .string(key)
    fields["device"] = .string(device)
    if let spark { fields["spark"] = .string(spark) }
    monitor["alive"] = .bool(alive)
    monitor["profileSet"] = profileSet.map { JSONValue.string($0) }
    fields["monitorRow"] = .object(monitor)
    return try AgentRemoteRow(json: .object(fields))
  }

  @Test("the sessions it sees are the home's live runs that are no spark's own, under the profile the board says")
  func sessions() throws {
    let rows = [
      try Self.run("run-work", profileSet: "work"),
      try Self.run("run-unfiled"),
      try Self.run("run-spark", spark: "sp-7k2m9q4x", profileSet: "work"),
      try Self.run("run-gone", alive: false, profileSet: "work"),
      try Self.run("run-loft", device: "dev-01HQ9S7XZ2", profileSet: "work"),
    ]
    let counted = NewSpark.sessions(rows, home: "dev-01HQ9S7UD1")
    #expect(counted == [RunProfileFacts(profileSet: "work"), RunProfileFacts()])
    let noHome = NewSpark.sessions(rows, home: nil)
    #expect(noHome == [])
    let sets = try Self.sets()
    let seen = NewSpark.sessionsSeen(counted, sets: sets, chosen: ["work"])
    #expect(seen == 1)
  }

  @Test("§9: Runs on studio, your home; the home away in its three facts; Create and its name")
  func words() {
    #expect(NewSparkWords.runsOn("studio") == "Runs on studio, your home")
    #expect(NewSparkWords.away("studio", .asleep, device: .iPhone) == "studio is asleep · New spark waits for it")
    #expect(NewSparkWords.away("studio", .silent, device: .iPhone) == "studio isn't answering · New spark waits for it")
    #expect(
      NewSparkWords.away("studio", .incompatible, device: .iPhone)
        == "studio runs a build this iPhone can't read · New spark waits for it")
    #expect(NewSparkWords.create("Polaris") == "Create Polaris")
    #expect(NewSparkWords.create("  Vela ") == "Create Vela")
    #expect(NewSparkWords.create("") == "Create")
  }
}
