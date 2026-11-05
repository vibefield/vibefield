#if DEBUG
  import FieldProduct
  import Foundation

  /// IOS-12b — Chat under `-vf-mock`: the feed's REAL reads over an in-process door that answers the contracts' own
  /// goldens, byte for byte (`compose-sparks-list.merged`, `needs-list.merged`; copies under `Fixtures/`, the gate
  /// keeps them identical), as `HistoryFixtureDoor` does for History. Vela asks you on studio, Kiwi sleeps on the
  /// loft, mini is asleep. Every step the live feed takes runs here; nothing downstream of the door knows the
  /// difference. A wake answers its spark. Cannot exist in Release.
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
      case "compose.sparks.list": return try answer("compose-sparks-list.merged")
      case "needs.list": return try answer("needs-list.merged")
      case "compose.sparks.open":
        let sparks = try answer("compose-sparks-list.merged")["sparks"]?.arrayValue ?? []
        let asked = params?["spark"]?.stringValue
        guard let spark = sparks.first(where: { $0["id"]?.stringValue == asked }) else {
          throw FieldProductError(kind: "NOT_FOUND", message: "no such spark")
        }
        return .object(["spark": spark])
      default:
        throw FieldProductError(
          kind: "NOT_FOUND", message: "the fixture door does not answer \(method)", code: -32601)
      }
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
#endif
