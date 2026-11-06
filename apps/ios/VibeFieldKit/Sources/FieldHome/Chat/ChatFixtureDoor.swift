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
  /// agent's ask of Vela's from the contracts' own items, on studio; those two alone; or the spawn alone on mini,
  /// which answers the first ask and sleeps from the second, so its item is carried as a sleeping desktop's are), an
  /// answer as `-vf-needs-answer=<done|failed|unheard|refused|held>` says (done by default; held never returns), the
  /// home's catalog from the contracts' own copy. The stills press an act with `-vf-needs-press=<item>:<choice>`.
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
    /// IOS-12d — the queue's asks so far, for `-vf-needs-case=away` (mini answers the first, then sleeps).
    private var needsAsked = 0

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
      case "compose.sparks.list": return try answer("compose-sparks-list.merged")
      case "needs.list":
        needsAsked += 1
        return try needsList()
      case NeedsAnswerParams.method: return try await answerNeeds(params)
      case "agent.catalog": return try answer("agent-catalog.valid")
      case "compose.sparks.open":
        let sparks = try answer("compose-sparks-list.merged")["sparks"]?.arrayValue ?? []
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
    /// studio beside it (`cards`) or alone (`agents`); or the spawn alone on mini (`away`). A sleeping desktop's items
    /// only ever arrive carried (`ChatReading.carry`), so under `away` mini answers the first ask with its item, and
    /// from the second the merge says it is asleep and lists none (d4c, S4: served fresh from an asleep mini, the feed
    /// rightly dropped it).
    private func needsList() throws -> JSONValue {
      let merged = try answer("needs-list.merged")
      guard let extra = Self.needsCase, case .object(var fields) = merged,
        let items = fields["items"]?.arrayValue
      else { return merged }
      let mini = "dev-01HQ9S7Y44"
      let spawn = Self.item("needs-item.held-spawn", on: Self.home)
      let ask = Self.item("needs-item.agent-ask", on: Self.home)
      switch extra {
      case "agents":
        fields["items"] = .array([spawn, ask].compactMap { $0 })
      case "away":
        let first = needsAsked <= 1
        fields["items"] = .array(first ? [Self.item("needs-item.held-spawn", on: mini)].compactMap { $0 } : [])
        if first, let desktops = fields["desktops"]?.arrayValue {
          fields["desktops"] = .array(
            desktops.map { desktop in
              guard case .object(var each) = desktop, each["device"]?.stringValue == mini else { return desktop }
              each["state"] = .string("answered")
              return .object(each)
            })
        }
      default:
        fields["items"] = .array(items + [spawn, ask].compactMap { $0 })
      }
      return .object(fields)
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
      ChatFixtureReader(Self.threadReading(ChatFixtureDoor.threadCase))
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
