#if DEBUG
  import FieldProduct
  import Foundation

  /// MA-6c — the apps under `-vf-mock`: the feed's REAL reads over an in-process door that answers the contracts' own
  /// goldens. `-vf-mock-apps=` names the state: `empty` (the default, so every older still stands as it was), `one`,
  /// `many`, `reading` (a library still reading) and `off` (no home answers: the mock hands the feed no door). `many`
  /// repeats one fixture row under invented titles, with no preview, so its icons are the fallback's. No agent is named
  /// here: every id is the fixture's. Cannot exist in Release.
  @MainActor
  final class AppsFixtureDoor: ChatDoor {
    enum State: String, Sendable {
      case empty, one, many, reading, off
    }

    static let argument = "-vf-mock-apps="

    let state: State

    init(state: State) { self.state = state }

    /// The door the launch arguments name.
    static func launched(_ arguments: [String] = ProcessInfo.processInfo.arguments) -> AppsFixtureDoor {
      let word = arguments.first { $0.hasPrefix(argument) }.map { String($0.dropFirst(argument.count)) }
      return AppsFixtureDoor(state: word.flatMap(State.init(rawValue:)) ?? .empty)
    }

    private final class Watch: ChatWatch {
      func cancel() {}
    }

    private static let titles = [
      "Launch checklist", "Release notes", "Checkout review", "Sound board", "Pricing sketch", "Field notes",
      "Onboarding map", "Weekly chart", "Menu ideas",
    ]

    /// `index-apps.valid`'s first row under `title`, its identities made its own and its preview taken away.
    private static func row(_ template: [String: JSONValue], title: String) -> JSONValue {
      var fields = template
      let id = title.lowercased().replacingOccurrences(of: " ", with: "-")
      fields["appKey"] = .string("studio:\(id)")
      fields["foldKey"] = .string("app:\(id)")
      fields["appId"] = .string(id)
      fields["title"] = .string(title)
      fields["preview"] = nil
      return .object(fields)
    }

    private func rows(matching words: String?) throws -> [JSONValue] {
      guard
        let page = MetersFixtureDoor.fixture("index-apps.valid"),
        let template = page["rows"]?.arrayValue?.first?.objectValue
      else { throw FieldProductError(kind: "NOT_FOUND", message: "the fixture door holds no index-apps.valid") }
      let titles: [String]
      switch state {
      case .one: titles = Array(Self.titles.prefix(1))
      case .many: titles = Self.titles
      case .empty, .reading, .off: titles = []
      }
      return titles.filter { title in
        words.map { title.localizedCaseInsensitiveContains($0) } ?? true
      }.map { Self.row(template, title: $0) }
    }

    func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
      switch method {
      case "index.apps.list":
        if state == .reading {
          throw FieldProductError(
            kind: "UNAVAILABLE", message: "the library is still reading", retryable: true,
            details: MetersFixtureDoor.fixture("error-data.apps-reading")?["details"])
        }
        let sources = MetersFixtureDoor.fixture("index-apps.valid")?["sources"] ?? .array([])
        return .object(["rows": .array(try rows(matching: params?["q"]?.stringValue)), "sources": sources])
      case "project.list":
        guard let list = MetersFixtureDoor.fixture("project-list.valid") else {
          throw FieldProductError(kind: "NOT_FOUND", message: "the fixture door holds no project-list.valid")
        }
        return list
      default:
        throw FieldProductError(kind: "NOT_FOUND", message: "the fixture door does not answer \(method)", code: -32601)
      }
    }

    func watch(
      _ method: String, params: JSONValue?, onFrame: @escaping @MainActor (JSONValue) -> Void
    ) async throws -> any ChatWatch {
      Watch()
    }

    /// `ChatDoor` asks a door for a spark's reader; the apps open no thread.
    func reader(
      spark: String, device: String?, whole: Bool, held: SparkTranscriptReading
    ) -> any ChatThreadReader {
      ChatFixtureReader(held)
    }
  }
#endif
