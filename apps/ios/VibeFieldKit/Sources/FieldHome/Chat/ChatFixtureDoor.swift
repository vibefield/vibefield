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
      case "needs.list": return try answer("needs-list.merged")
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
