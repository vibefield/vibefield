#if DEBUG
  import FieldProduct
  import Foundation

  /// IOS-12b — Chat under `-vf-mock`: the feed's REAL reads over an in-process door that answers the contracts' own
  /// goldens, byte for byte (`compose-sparks-list.merged`, `needs-list.merged`; copies under `Fixtures/`, the gate
  /// keeps them identical), as `HistoryFixtureDoor` does for History. Vela asks you on studio, Kiwi sleeps on the
  /// loft, mini is asleep. Every step the live feed takes runs here; nothing downstream of the door knows the
  /// difference. A wake answers its spark. Cannot exist in Release.
  /// IOS-12c — a thread under `-vf-mock` reads the Mac fold's own golden inputs (`chat-flow.<case>.golden.json`, copies
  /// under `Fixtures/chat-flow/` the gate keeps identical to field-app's), read as the reader reads a line frame. The
  /// case is `-vf-chat-case=<case>` (at-rest by default); `reading` and `unreadable` are said as themselves.
  /// IOS-12d — the queue's cards under `-vf-needs-case=<cards|agents|away>` (the merged list with a held spawn and an
  /// agent's ask of Vela's from the contracts' own items, on studio; those two alone; or Vela and her spawn on mini,
  /// which answers until both lists are heard and then sleeps, so both are carried as a sleeping desktop's are), an
  /// answer as `-vf-needs-answer=<done|failed|unheard|refused|held>` says (done by default; held never returns), the
  /// home's catalog from the contracts' own copy. The stills press an act with `-vf-needs-press=<item>:<choice>`.
  /// IOS-12f — New spark's reads answer the contracts' own copies (`agent-providers.valid`, `agent-models.valid` for
  /// the agent it reads, under any profile, and the meters' `agents-profile-sets.meters`, so the sheet and the meters
  /// read one home). A hatch comes out as `-vf-hatch-answer=<made|taken|no-sign-in>` says (made by default). Made, the
  /// spark is the home's, hatched now and never worked, the list holds it from then on, and its thread reads an empty
  /// record. The home asleep is `-vf-mock-chat-away`'s (12b): the door is gone, so no ask reaches here.
  @MainActor
  final class ChatFixtureDoor: ChatDoor {
    /// The goldens' desktops, by the names the mock account says.
    static let names = [
      "dev-01HQ9S7UD1": "studio",
      "dev-01HQ9S7XZ2": "loft",
      "dev-01HQ9S7Y44": "mini",
    ]
    static let home = "dev-01HQ9S7UD1"
    /// One door for the app's life: the feed keeps a door it already holds.
    static let shared = ChatFixtureDoor()
    /// IOS-12d — `-vf-needs-case=away`'s desktop, where Vela lives there.
    static let mini = "dev-01HQ9S7Y44"
    static let vela = "sp-7k2m9q4x"
    /// A state, never a count of asks: the board can ask for the sparks again before their first answer lands, and the
    /// feed keeps only the last one, so a count would put mini to sleep unheard.
    private var miniAwake = true
    /// IOS-12f — the sparks this door has hatched, in their order, listed after the merge's own.
    private var hatched: [JSONValue] = []

    private final class Watch: ChatWatch {
      func cancel() {}
    }

    static func fixture(_ name: String, in folder: String = "Fixtures") -> JSONValue? {
      guard
        let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: folder),
        let data = try? Data(contentsOf: url)
      else { return nil }
      return try? JSONValue.parse(data)
    }

    private func answer(_ name: String) throws -> JSONValue {
      guard let value = Self.fixture(name) else {
        throw FieldProductError(kind: "NOT_FOUND", message: "the fixture door holds no \(name)")
      }
      return value
    }

    func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
      switch method {
      case "compose.sparks.list":
        if Self.needsCase == "away" { return withHatched(try Self.awaySparks(awake: miniAwake)) }
        return withHatched(try answer("compose-sparks-list.merged"))
      case "needs.list": return try needsList()
      case NeedsAnswerParams.method: return try await answerNeeds(params)
      case "agent.catalog": return try answer("agent-catalog.valid")
      case "agent.providers": return try answer("agent-providers.valid")
      case "agents.profileSets.list": return try answer("agents-profile-sets.meters")
      case "agent.models": return try models(params)
      case SparkHatch.method: return try hatch(params)
      case "compose.sparks.open":
        let sparks = (try answer("compose-sparks-list.merged")["sparks"]?.arrayValue ?? []) + hatched
        let asked = params?["spark"]?.stringValue
        guard let spark = sparks.first(where: { $0["id"]?.stringValue == asked }) else {
          throw FieldProductError(kind: "NOT_FOUND", message: "no such spark")
        }
        return .object(["spark": spark])
      case SparkSay.method:
        // IOS-12c — a say is queued, as fieldd answers one while the spark works
        return .object([
          "spark": params?["spark"] ?? .null, "requestId": params?["requestId"] ?? .null, "state": .string("queued"),
          "queued": .bool(true),
        ])
      default:
        throw FieldProductError(
          kind: "NOT_FOUND", message: "the fixture door does not answer \(method)", code: -32601)
      }
    }

    /// The queue under `-vf-needs-case=`: the merged list; with the contracts' held spawn and agent's ask of Vela's on
    /// studio beside it (`cards`) or alone (`agents`); or the spawn alone on mini (`away`, `awayNeeds`).
    private func needsList() throws -> JSONValue {
      let merged = try answer("needs-list.merged")
      guard let extra = Self.needsCase, case .object(var fields) = merged,
        let items = fields["items"]?.arrayValue
      else { return merged }
      let spawn = Self.item("needs-item.held-spawn", on: Self.home)
      let ask = Self.item("needs-item.agent-ask", on: Self.home)
      switch extra {
      case "agents":
        fields["items"] = .array([spawn, ask].compactMap { $0 })
      case "away":
        return try Self.awayNeeds(awake: miniAwake)
      default:
        fields["items"] = .array(items + [spawn, ask].compactMap { $0 })
      }
      return .object(fields)
    }

    /// `-vf-needs-case=away`: mini sleeps; what it said is carried from here on.
    func miniSleeps() { miniAwake = false }

    /// A sleeping desktop's rows only ever arrive carried (`ChatReading.carry`), so mini answers first. And an item is
    /// only ever its spark's own desktop's (`SparkEntries.items(of:)`), so Vela lives on mini here: with her on studio
    /// her entry refuses the spawn and its card reads as waiting on no one (d4d, S5; d4c's first go, S4, served it
    /// fresh and the feed dropped it). Awake, mini lists her; asleep, it lists neither her nor her spawn.
    static func awaySparks(awake: Bool) throws -> JSONValue {
      guard case .object(var fields)? = fixture("compose-sparks-list.merged"),
        let sparks = fields["sparks"]?.arrayValue
      else { throw FieldProductError(kind: "NOT_FOUND", message: "the fixture door holds no spark list") }
      guard awake else {
        fields["sparks"] = .array(sparks.filter { $0["id"]?.stringValue != vela })
        return .object(fields)
      }
      fields["sparks"] = .array(
        sparks.map { spark in
          guard case .object(var each) = spark, each["id"]?.stringValue == vela else { return spark }
          each["device"] = .string(mini)
          return .object(each)
        })
      fields["desktops"] = miniAnswers(fields["desktops"])
      return .object(fields)
    }

    /// The queue beside `awaySparks`: the held spawn on mini while it answers, and nothing once it sleeps.
    static func awayNeeds(awake: Bool) throws -> JSONValue {
      guard case .object(var fields)? = fixture("needs-list.merged") else {
        throw FieldProductError(kind: "NOT_FOUND", message: "the fixture door holds no queue")
      }
      fields["items"] = .array(awake ? [item("needs-item.held-spawn", on: mini)].compactMap { $0 } : [])
      if awake { fields["desktops"] = miniAnswers(fields["desktops"]) }
      return .object(fields)
    }

    /// The merge's desktops with mini answering.
    private static func miniAnswers(_ desktops: JSONValue?) -> JSONValue? {
      guard let rows = desktops?.arrayValue else { return desktops }
      return .array(
        rows.map { desktop in
          guard case .object(var each) = desktop, each["device"]?.stringValue == mini else { return desktop }
          each["state"] = .string("answered")
          return .object(each)
        })
    }

    /// One of the contracts' own items, on `device`.
    private static func item(_ name: String, on device: String) -> JSONValue? {
      guard case .object(var item)? = fixture(name) else { return nil }
      item["device"] = .string(device)
      return .object(item)
    }

    /// An answer, as `-vf-needs-answer=` says it came out: the item answered, or refused in fieldd's words, or held.
    private func answerNeeds(_ params: JSONValue?) async throws -> JSONValue {
      let id = params?["item"]?.stringValue
      let choice = params?["choice"]?.intValue ?? 0
      let items = try needsList()["items"]?.arrayValue ?? []
      guard case .object(var item)? = items.first(where: { $0["id"]?.stringValue == id }) else {
        throw FieldProductError(kind: "NOT_FOUND", message: "no such item")
      }
      var answer: [String: JSONValue] = ["choice": .int(choice), "at": .string("2026-10-31T16:12:30.940Z")]
      switch Self.needsAnswer {
      case "held":
        try await Task.sleep(for: .seconds(86_400))
        throw CancellationError()
      case "refused":
        let word = item["choices"]?.arrayValue?.first?.stringValue ?? "another act"
        throw FieldProductError(kind: "PRECONDITION_FAILED", message: "already answered: \(word)")
      case "failed":
        answer["outcome"] = .string("failed")
        answer["reason"] = .string("the agent's sign-in expired")
        answer["told"] = .bool(true)
      case "unheard":
        answer["outcome"] = .string("done")
        answer["told"] = .bool(false)
        answer["waits"] = .string("Vela's session is starting; it hears your answer when it wakes")
      default:
        answer["outcome"] = .string("done")
        answer["told"] = .bool(true)
      }
      item["state"] = .string("answered")
      item["answer"] = .object(answer)
      return .object(["item": .object(item)])
    }

    /// IOS-12f — the contracts' own picker, for the agent it is of; asked under any profile, as the sheet keys a
    /// picker by what it asked (the Mac's `NewSparkSheet.tsx`), never by the answer's `profileSet`.
    private func models(_ params: JSONValue?) throws -> JSONValue {
      let picker = try answer("agent-models.valid")
      guard let asked = params?["provider"]?.stringValue, asked == picker["provider"]?.stringValue else {
        throw FieldProductError(kind: "NOT_FOUND", message: "the fixture door holds no models for that agent")
      }
      return picker
    }

    /// IOS-12f — a hatch as `-vf-hatch-answer=` says it came out: made, or refused as fieldd refuses it
    /// (`SparkService.hatch`: PRECONDITION_FAILED, its reason in the details, in fieldd's words). Made, it is the
    /// spark the params name, on the home, hatched now and never worked (fieldd's `turnedAt: null`), its session live.
    private func hatch(_ params: JSONValue?) throws -> JSONValue {
      guard case .object(let asked)? = params, let name = asked["name"]?.stringValue,
        let thinksUnder = asked["thinksUnder"]?.stringValue
      else { throw FieldProductError(kind: "NOT_FOUND", message: "a hatch names its spark and its profile") }
      switch Self.hatchAnswer {
      case "taken":
        throw FieldProductError(
          kind: "PRECONDITION_FAILED", message: "another spark has that name",
          details: .object(["reason": .string("name-taken")]))
      case "no-sign-in":
        throw FieldProductError(
          kind: "PRECONDITION_FAILED", message: "\(thinksUnder) has no sign-in for that agent",
          details: .object([
            "reason": .string("no-sign-in"), "agent": asked["agent"] ?? .null, "profile": .string(thinksUnder),
          ]))
      default: break
      }
      let count = hatched.count + 1
      let now = Date.now.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
      let slug = String(name.lowercased().map { $0.isLetter || $0.isNumber ? $0 : "-" })
      var spark = asked
      spark["id"] = .string("sp-hatched\(count)")
      spark["folder"] = .string("/Users/you/Library/Application Support/VibeField/users/u-1f3a/sparks/\(slug)")
      spark["createdAt"] = .string(now)
      spark["updatedAt"] = .string(now)
      spark["turnedAt"] = .null
      spark["session"] = .object(["runtimeRunId": .string("run-hatched\(count)"), "live": .bool(true)])
      spark["device"] = .string(Self.home)
      hatched.append(.object(spark))
      return .object(["spark": .object(spark)])
    }

    /// A list with this door's hatched sparks after its own.
    private func withHatched(_ list: JSONValue) -> JSONValue {
      guard !hatched.isEmpty, case .object(var fields) = list else { return list }
      fields["sparks"] = .array((fields["sparks"]?.arrayValue ?? []) + hatched)
      return .object(fields)
    }

    /// IOS-12f — how a hatch comes out: `-vf-hatch-answer=<made|taken|no-sign-in>`, else made.
    static var hatchAnswer: String { flag("-vf-hatch-answer=") ?? "made" }

    /// IOS-12f — the stills' New spark: `-vf-open-new-spark` opens the sheet once Chat's list is heard, and
    /// `-vf-new-spark-create` presses Create once its reads are in (no OS input on the stills' host).
    static var openNewSpark: Bool { ProcessInfo.processInfo.arguments.contains("-vf-open-new-spark") }
    static var pressCreate: Bool { ProcessInfo.processInfo.arguments.contains("-vf-new-spark-create") }
    /// IOS-12f's f6 — the stills' row after the flight: `-vf-new-spark-hold` holds Chat's list once the face has
    /// landed, its thread unopened (no OS input on the stills' host).
    static var holdLanding: Bool { ProcessInfo.processInfo.arguments.contains("-vf-new-spark-hold") }
    /// IOS-12f's f6b — the stills' seed: `-vf-new-spark-seed=<n>` deals face n in New spark's sheet, the same every
    /// run, as 12e's stills were seeded (4211). Without it the sheet deals at random, as it ships.
    static var newSparkSeed: UInt32? { flag("-vf-new-spark-seed=").flatMap { UInt32($0) } }

    /// The queue's case: `-vf-needs-case=<cards|agents|away>`, else the merged list alone.
    static var needsCase: String? { flag("-vf-needs-case=") }

    /// How an answer comes out: `-vf-needs-answer=<…>`, else done.
    static var needsAnswer: String { flag("-vf-needs-answer=") ?? "done" }

    /// The stills' press: `-vf-needs-press=<item>:<choice>` presses that act once the queue holds its item.
    static var needsPress: (item: String, choice: Int)? {
      guard let given = flag("-vf-needs-press="), let colon = given.lastIndex(of: ":"),
        let choice = Int(given[given.index(after: colon)...])
      else { return nil }
      return (String(given[..<colon]), choice)
    }

    private static func flag(_ prefix: String) -> String? {
      ProcessInfo.processInfo.arguments.first { $0.hasPrefix(prefix) }.map { String($0.dropFirst(prefix.count)) }
    }

    func reader(
      spark: String, device: String?, whole: Bool, held: SparkTranscriptReading
    ) -> any ChatThreadReader {
      // IOS-12f — a spark this door hatched has no record yet: its thread reads an empty one, never another's case
      if hatched.contains(where: { $0["id"]?.stringValue == spark }) {
        return ChatFixtureReader(SparkTranscriptReading.of(runs: [], raw: [:], dropped: 0, whole: true))
      }
      return ChatFixtureReader(Self.threadReading(ChatFixtureDoor.threadCase))
    }

    /// The thread's case: `-vf-chat-case=<case>`, else at rest.
    static var threadCase: String {
      let flag = "-vf-chat-case="
      let given = ProcessInfo.processInfo.arguments.first { $0.hasPrefix(flag) }
      return given.map { String($0.dropFirst(flag.count)) } ?? "at-rest"
    }

    /// The stills' thread: `-vf-open-chat-thread=<spark>` opens that spark's thread once Chat's list holds it (no OS
    /// input on the stills' host: the 12c plan §5).
    static var openThread: String? {
      let flag = "-vf-open-chat-thread="
      return ProcessInfo.processInfo.arguments.first { $0.hasPrefix(flag) }.map { String($0.dropFirst(flag.count)) }
    }

    /// The stills' head of a long flow: `-vf-chat-at-top` opens the thread at its first row, as a scroll up would.
    static var atTop: Bool { ProcessInfo.processInfo.arguments.contains("-vf-chat-at-top") }

    /// The stills' tools still: `-vf-chat-open-tools` opens every turn's tools, as a press would.
    static var openTools: Bool { ProcessInfo.processInfo.arguments.contains("-vf-chat-open-tools") }

    /// The stills' held draft: `-vf-chat-draft=<words>` stands in the field, as typed.
    static var draft: String? {
      let flag = "-vf-chat-draft="
      return ProcessInfo.processInfo.arguments.first { $0.hasPrefix(flag) }.map { String($0.dropFirst(flag.count)) }
    }

    /// The stills' facts of their case's spark: under `-vf-chat-case=`, the golden's `facts`, what its spark was when
    /// the Mac's fold drew the case (new, awake, blocked, waiting, working, turnedAt), with the mock spark's name, seed
    /// and status kept, so the head and the flow's faces agree. The mock list's Vela has worked and its session is
    /// live, so without them the hello's case draws no hello. Without the flag, nil: the entry's own facts stand.
    static func caseFacts(over spark: ChatFlowSpark) -> ChatFlowSpark? {
      guard ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("-vf-chat-case=") }),
        let facts = fixture("chat-flow.\(threadCase).golden", in: "Fixtures/chat-flow")?["facts"]
      else { return nil }
      return ChatFlowSpark(
        name: spark.name, seed: spark.seed, status: spark.status, turnedAt: facts["turnedAt"]?.stringValue,
        isNew: facts["new"]?.boolValue ?? spark.isNew, awake: facts["awake"]?.boolValue ?? spark.awake,
        blocked: facts["blocked"]?.boolValue ?? spark.blocked, waiting: facts["waiting"]?.boolValue ?? spark.waiting,
        working: facts["working"]?.boolValue ?? spark.working)
    }

    /// The case's reading: the golden's input read as the reader reads it, or the two states said as themselves.
    static func threadReading(_ name: String) -> SparkTranscriptReading {
      switch name {
      case "reading": return .reading
      case "unreadable":
        return .unreadable(reason: "loft has not published its doors", device: "dev-01HQ9S7XZ2")
      default: break
      }
      guard
        let golden = fixture("chat-flow.\(name).golden", in: "Fixtures/chat-flow"),
        let input = golden["input"]?["reading"],
        let runs = try? (input["runs"]?.arrayValue ?? []).map(SparkTranscriptRun.init(json:)),
        case .object(let raw)? = input["raw"]
      else { return .unreadable(reason: "the fixture door holds no case \(name)", device: nil) }
      let lines = raw.mapValues { $0.arrayValue ?? [] }
      let dropped = Int(input["dropped"]?.intValue ?? 0)
      return SparkTranscriptReading.of(runs: runs, raw: lines, dropped: dropped, whole: true)
    }

    func watch(
      _ method: String, params: JSONValue?, onFrame: @escaping @MainActor (JSONValue) -> Void
    ) async throws -> any ChatWatch {
      guard method == "needs.subscribe" else {
        throw FieldProductError(
          kind: "NOT_FOUND", message: "the fixture door does not answer \(method)", code: -32601)
      }
      return Watch()
    }
  }

  /// A reader whose reading is the fixture's: nothing is dialled, and every ask is answered by what it holds.
  @MainActor
  final class ChatFixtureReader: ChatThreadReader {
    let reading: SparkTranscriptReading
    init(_ reading: SparkTranscriptReading) { self.reading = reading }
    func start() {}
    func readWhole() {}
    func reconnected() {}
    func cancel() {}
  }
#endif
