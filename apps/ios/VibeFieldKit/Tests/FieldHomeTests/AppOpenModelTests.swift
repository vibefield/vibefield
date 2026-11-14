import FieldProduct
import FieldWeb
import Foundation
import Testing

@testable import FieldHome

/// MA-5a — one app opening on the phone over the home's door: what it asks, late, starting, serving, refused in
/// words, superseded, warm, and shut in a build that may open no app (item 373).
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@MainActor
@Suite("MA-5a — opening an app")
struct AppOpenModelTests {
  /// The home's door, answering `artifact.open` from a queue the test fills; it can hold an answer at a gate.
  final class Door: ChatDoor {
    var asked: [JSONValue?] = []
    var answers: [Result<JSONValue, FieldProductError>] = []
    var gate: Gate?

    final class Watch: ChatWatch {
      func cancel() {}
    }

    func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
      guard method == "artifact.open" else { throw FieldProductError(kind: "NOT_FOUND", message: method) }
      asked.append(params)
      if let gate { await gate.wait() }
      guard !answers.isEmpty else { throw FieldProductError(kind: "UNAVAILABLE", message: "no answer") }
      return try answers.removeFirst().get()
    }

    func watch(
      _ method: String, params: JSONValue?, onFrame: @escaping @MainActor (JSONValue) -> Void
    ) async throws -> any ChatWatch {
      Watch()
    }

    func reader(spark: String, device: String?, whole: Bool, held: SparkTranscriptReading) -> any ChatThreadReader {
      ChatThreadTests.Reader(held)
    }
  }

  /// Holds a door's answer until the test lets it go.
  @MainActor
  final class Gate {
    private var waiting: CheckedContinuation<Void, Never>?
    private var open = false

    func wait() async {
      if open { return }
      await withCheckedContinuation { waiting = $0 }
    }

    func release() {
      open = true
      waiting?.resume()
      waiting = nil
    }
  }

  /// Every wait the model asked for, in order.
  actor Waits {
    var all: [Duration] = []
    func add(_ duration: Duration) { all.append(duration) }
  }

  /// A clock the test moves.
  final class Clock: @unchecked Sendable {
    var now = ContinuousClock().now
  }

  static let root = "https://studio.tail1234.ts.net:13377"

  static func serving(_ url: String = root, reach: [String] = ["unpkg.com"]) -> JSONValue {
    .object(["state": .string("serving"), "url": .string(url), "reach": .array(reach.map { .string($0) })])
  }

  static let starting: JSONValue = .object(["state": .string("starting")])

  static func refusal(_ state: String) -> FieldProductError {
    FieldProductError(
      kind: "UNAVAILABLE", message: "apps",
      details: .object(["service": .string("apps"), "state": .string(state)]))
  }

  static func row(_ key: String, device: String = "dev-studio", hosted: String? = nil) throws -> IndexAppRow {
    var fields: [String: JSONValue] = [
      "appKey": .string(key), "foldKey": .string("native:\(key)"), "device": .string(device),
      "appId": .string(String(repeating: String(key.prefix(1)), count: 64)),
      "presentationId": .string(String(repeating: "b", count: 64)),
      "title": .string("App \(key)"), "filename": .string("\(key).html"), "sessionId": .string("s-\(key)"),
      "timelineId": .string("t-\(key)"), "availability": .string("captured"), "openable": .bool(true),
    ]
    if let hosted { fields["hostedUrl"] = .string(hosted) }
    return try IndexAppRow(json: .object(fields))
  }

  static func source(_ device: String = "dev-studio", isSelf: Bool = false, state: String = "live") throws
    -> IndexAppsSource
  {
    try IndexAppsSource(
      json: .object([
        "device": .string(device), "name": .string("studio"), "self": .bool(isSelf), "state": .string(state),
        "rows": .int(1),
      ]))
  }

  private func model(_ waits: Waits = Waits(), clock: Clock = Clock()) -> AppOpenModel {
    let model = AppOpenModel()
    model.sleep = { await waits.add($0) }
    model.now = { clock.now }
    model.opensApps = true
    return model
  }

  private func settle(_ until: () -> Bool) async {
    for _ in 0..<500 where !until() { await Task.yield() }
  }

  @Test("a row that cannot open says why, and asks the door nothing")
  func asleep() async throws {
    let door = Door()
    let model = model()
    let app = try Self.row("a")
    let sources = [try Self.source(state: "asleep")]
    await model.open(app, sources: sources, here: "this desktop", door: door)
    let phase = model.phase
    guard case .refused(_, let honest) = phase else { Issue.record("not refused: \(phase)"); return }
    #expect(honest.title == "studio is asleep")
    #expect(door.asked.isEmpty)
  }

  @Test("serving: the URL to load and its rule; another desktop's app is asked with its device")
  func serving() async throws {
    let door = Door()
    door.answers = [.success(Self.serving(reach: ["unpkg.com", "cdn.jsdelivr.net"]))]
    let model = model()
    let app = try Self.row("a")
    await model.open(app, sources: [try Self.source()], here: "this desktop", door: door)
    let phase = model.phase
    guard case .serving(let key, let url, let policy) = phase else { Issue.record("not serving: \(phase)"); return }
    #expect(key == "a")
    #expect(url.absoluteString == Self.root)
    #expect(policy.origin.host == "studio.tail1234.ts.net")
    #expect(policy.reach == ["cdn.jsdelivr.net", "unpkg.com"])
    let asked = door.asked.first ?? nil
    #expect(asked?["device"]?.stringValue == "dev-studio")
    #expect(asked?["appId"]?.stringValue == app.appId)
    #expect(asked?["reveal"] == nil)
  }

  @Test("the home's own app is asked without a device")
  func homeApp() async throws {
    let door = Door()
    door.answers = [.success(Self.serving())]
    let model = model()
    await model.open(try Self.row("a"), sources: [try Self.source(isSelf: true)], here: "this desktop", door: door)
    let asked = door.asked.first ?? nil
    #expect(asked?["device"] == nil)
  }

  @Test("starting, then serving: asked again a second apart")
  func startingThenServing() async throws {
    let door = Door()
    door.answers = [.success(Self.starting), .success(Self.starting), .success(Self.serving())]
    let waits = Waits()
    let model = model(waits)
    await model.open(try Self.row("a"), sources: [try Self.source()], here: "this desktop", door: door)
    let phase = model.phase
    guard case .serving = phase else { Issue.record("not serving: \(phase)"); return }
    #expect(door.asked.count == 3)
    let seconds = await waits.all.filter { $0 == AppOpen.askAgainAfter }
    #expect(seconds.count == 2)
  }

  @Test("still starting after the bound: it says it cannot reach the desktop")
  func startingTooLong() async throws {
    let door = Door()
    door.answers = Array(repeating: .success(Self.starting), count: AppOpen.maxAsks + 2)
    let model = model()
    await model.open(try Self.row("a"), sources: [try Self.source()], here: "this desktop", door: door)
    let phase = model.phase
    guard case .refused(_, let honest) = phase else { Issue.record("not refused: \(phase)"); return }
    #expect(honest.title == "Can't reach studio")
    #expect(honest.detail == "It didn't start this app.")
    #expect(door.asked.count == AppOpen.maxAsks)
  }

  @Test("each refusal in its words, and anything else as the desktop out of reach")
  func refusals() async throws {
    let cases: [(FieldProductError, String)] = [
      (Self.refusal("not-kept"), "This page wasn't kept"),
      (Self.refusal("too-large"), "Too large to keep"),
      (Self.refusal("unsupported"), "This page can't be kept"),
      (Self.refusal("export-unbuilt"), "studio can't write this app out yet"),
      (Self.refusal("library-reading"), "studio is still reading its history"),
      (Self.refusal("export-failed"), AppsHonest.cannotRunYet),
      (Self.refusal("not-linked"), AppsHonest.cannotRunYet),
      (FieldProductError(kind: "UNAVAILABLE", message: "down"), "Can't reach studio"),
      (FieldProductError(kind: "TIMEOUT", message: "slow"), "Can't reach studio"),
    ]
    for (error, words) in cases {
      let door = Door()
      door.answers = [.failure(error)]
      let model = model()
      await model.open(try Self.row("a"), sources: [try Self.source()], here: "this desktop", door: door)
      let phase = model.phase
      guard case .refused(_, let honest) = phase else { Issue.record("not refused: \(phase)"); continue }
      #expect(honest.title == words, "\(error.kind) \(error.details.map { "\($0)" } ?? "")")
    }
  }

  @Test("serving with no root the phone can pin: it cannot run here")
  func noRoot() async throws {
    for answer in [
      JSONValue.object(["state": .string("serving")]), Self.serving("https://studio.tail1234.ts.net:13377/x"),
      Self.serving("http://studio.tail1234.ts.net:13377"),
    ] {
      let door = Door()
      door.answers = [.success(answer)]
      let model = model()
      await model.open(try Self.row("a"), sources: [try Self.source()], here: "this desktop", door: door)
      let phase = model.phase
      guard case .refused(_, let honest) = phase else { Issue.record("not refused: \(phase)"); continue }
      #expect(honest.title == AppsHonest.cannotRunYet)
    }
  }

  @Test("a refusal keeps the app's hosted link as its one act")
  func hostedAct() async throws {
    let door = Door()
    door.answers = [.failure(Self.refusal("not-kept"))]
    let model = model()
    let app = try Self.row("a", hosted: "https://claude.ai/code/artifact/review")
    await model.open(app, sources: [try Self.source()], here: "this desktop", door: door)
    let phase = model.phase
    guard case .refused(_, let honest) = phase else { Issue.record("not refused: \(phase)"); return }
    #expect(honest.act?.host == "claude.ai")
  }

  @Test("late: nothing said for 120 ms, then the words; then the answer")
  func late() async throws {
    let door = Door()
    let gate = Gate()
    door.gate = gate
    door.answers = [.success(Self.serving())]
    let model = model()
    let app = try Self.row("a")
    let sources = [try Self.source()]
    let opening = Task { await model.open(app, sources: sources, here: "this desktop", door: door) }
    await settle {
      if case .opening(_, _, true) = model.phase { return true }
      return false
    }
    let phase = model.phase
    #expect(phase == .opening(appKey: "a", desktop: "studio", late: true))
    #expect(AppOpen.openingWords(desktop: "studio") == "Opening on studio…")
    gate.release()
    await opening.value
    let after = model.phase
    guard case .serving = after else { Issue.record("not serving: \(after)"); return }
  }

  @Test("a second open supersedes the first: the first's answer is never drawn")
  func superseded() async throws {
    let slow = Door()
    let gate = Gate()
    slow.gate = gate
    slow.answers = [.success(Self.serving("https://studio.tail1234.ts.net:13377"))]
    let fast = Door()
    fast.answers = [.success(Self.serving("https://studio.tail1234.ts.net:13378"))]
    let model = model()
    let first = try Self.row("a")
    let second = try Self.row("b")
    let sources = [try Self.source()]
    let opening = Task { await model.open(first, sources: sources, here: "this desktop", door: slow) }
    await settle { !slow.asked.isEmpty }
    await model.open(second, sources: sources, here: "this desktop", door: fast)
    gate.release()
    await opening.value
    let phase = model.phase
    guard case .serving(let key, let url, _) = phase else { Issue.record("not serving: \(phase)"); return }
    #expect(key == "b")
    #expect(url.port == 13378)
  }

  @Test("the warm app reopens at once, asking nothing; after ten minutes it asks again")
  func warm() async throws {
    let door = Door()
    door.answers = [.success(Self.serving()), .success(Self.serving())]
    let clock = Clock()
    let model = model(clock: clock)
    let app = try Self.row("a")
    let sources = [try Self.source()]
    await model.open(app, sources: sources, here: "this desktop", door: door)
    model.left()
    clock.now = clock.now + .seconds(599)
    await model.open(app, sources: sources, here: "this desktop", door: door)
    #expect(door.asked.count == 1)
    model.left()
    clock.now = clock.now + .seconds(600)
    await model.open(app, sources: sources, here: "this desktop", door: door)
    #expect(door.asked.count == 2)
  }

  @Test("opening another app replaces the warm one")
  func replaced() async throws {
    let door = Door()
    door.answers = [.success(Self.serving()), .success(Self.serving()), .success(Self.serving())]
    let model = model()
    let sources = [try Self.source()]
    await model.open(try Self.row("a"), sources: sources, here: "this desktop", door: door)
    model.left()
    await model.open(try Self.row("b"), sources: sources, here: "this desktop", door: door)
    model.left()
    await model.open(try Self.row("a"), sources: sources, here: "this desktop", door: door)
    #expect(door.asked.count == 3)
  }

  @Test("a build that may open no app (item 373) opens none, and asks nothing")
  func shut() async throws {
    let door = Door()
    door.answers = [.success(Self.serving())]
    let model = model()
    model.opensApps = false
    await model.open(try Self.row("a"), sources: [try Self.source()], here: "this desktop", door: door)
    let phase = model.phase
    guard case .refused(_, let honest) = phase else { Issue.record("not refused: \(phase)"); return }
    #expect(honest.title == AppsHonest.cannotRunYet)
    #expect(door.asked.isEmpty)
    #expect(WebShipGate.relayBuilt == false)
  }
}
