#if DEBUG
  import FieldProduct
  import FieldWorkspace
  import Foundation

  /// UM-4 — the meters under `-vf-mock`: the feed's REAL reads over an in-process door that answers the contracts' own
  /// goldens, byte for byte (copies under `Fixtures/`, `pnpm check:ios-fixtures` keeps them identical), as
  /// `ChatFixtureDoor` does for Chat. The home's profiles are `agents-profile-sets.meters` (This Mac, Work, Side and a
  /// draft), its usage `agent-usage.budget` (a hot five hours, a budget, a kept reading, a shared plan) read at its own
  /// stamp (`now`), and its catalog the workspace door's `agent-catalog.valid`. No agent is named here: every id is the
  /// fixtures'. Cannot exist in Release.
  ///
  /// The usage-state doors (`-vf-mock-usage=`): `first-read` answers the empty batch, `refused` refuses `agent.usage`
  /// as an older desktop does (`FORBIDDEN_SCOPE`), `unavailable` cannot answer; none is the batch above, which runs hot.
  @MainActor
  final class MetersFixtureDoor: ChatDoor {
    enum Usage: String, Sendable {
      case readings
      case firstRead = "first-read"
      case refused
      case unavailable
    }

    static let argument = "-vf-mock-usage="
    /// The instant the batch is read at: `agent-usage.budget`'s, half a minute after its last reading (the golden's
    /// `nows`).
    static let now = Date(timeIntervalSince1970: 1_789_560_000)

    let usage: Usage

    init(usage: Usage) { self.usage = usage }

    /// The door the launch arguments name.
    static func launched(_ arguments: [String] = ProcessInfo.processInfo.arguments) -> MetersFixtureDoor {
      let word = arguments.first { $0.hasPrefix(argument) }.map { String($0.dropFirst(argument.count)) }
      return MetersFixtureDoor(usage: word.flatMap(Usage.init(rawValue:)) ?? .readings)
    }

    private final class Watch: ChatWatch {
      func cancel() {}
    }

    static func fixture(_ name: String) -> JSONValue? {
      guard
        let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"),
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
      case "agents.profileSets.list": return try answer("agents-profile-sets.meters")
      case "agent.catalog": return try WorkspaceFixtureDoor.fixture("agent-catalog.valid")
      case "agents.usage": return try usageAnswer()
      default:
        throw FieldProductError(
          kind: "NOT_FOUND", message: "the fixture door does not answer \(method)", code: -32601)
      }
    }

    private func usageAnswer() throws -> JSONValue {
      switch usage {
      case .readings: return try answer("agent-usage.budget")
      case .firstRead: return try answer("agent-usage.empty")
      case .refused:
        throw FieldProductError(kind: "FORBIDDEN_SCOPE", message: "agent.usage is not granted to this device")
      case .unavailable:
        throw FieldProductError(kind: "UNAVAILABLE", message: "the usage door could not answer", retryable: true)
      }
    }

    func watch(
      _ method: String, params: JSONValue?, onFrame: @escaping @MainActor (JSONValue) -> Void
    ) async throws -> any ChatWatch {
      guard method == "agents.usage.subscribe" else {
        throw FieldProductError(
          kind: "NOT_FOUND", message: "the fixture door does not answer \(method)", code: -32601)
      }
      return Watch()
    }

    /// M-c2's `ChatDoor` asks a door for a spark's reader (IOS-12c). The meters open no thread, so this door
    /// dials nothing: its reader holds the reading it is handed, as Chat's fixture reader does.
    func reader(
      spark: String, device: String?, whole: Bool, held: SparkTranscriptReading
    ) -> any ChatThreadReader {
      ChatFixtureReader(held)
    }
  }
#endif
