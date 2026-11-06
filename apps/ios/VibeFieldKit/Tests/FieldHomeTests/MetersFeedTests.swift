import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// UM-4 (UM-D8 A; rulings 17 and 18) — the meters' feed reads the HOME's cached batch and the home's profiles through
/// the home's one door: `agents.usage` asked with no `refresh`, `agents.usage.subscribe` watched while the door is
/// held, the profiles and catalog read on attach and on every open; a home that refuses `agent.usage` is said, a door
/// that cannot answer is "usage unavailable" — still watched, and asked again when a meter view opens — and without a
/// door the last word stands, or "usage unavailable" when there is none (the U3 review).
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("the meters' feed reads the home's cached usage and its profiles, and says what is true")
@MainActor
struct MetersFeedTests {
  /// A door that answers the contracts' fixtures (the demo door's own copies) and records every ask.
  final class Door: ChatDoor {
    var calls: [(method: String, params: JSONValue?)] = []
    var watched: [(method: String, params: JSONValue?)] = []
    var frames: [@MainActor (JSONValue) -> Void] = []
    var usage: Result<JSONValue, FieldProductError> = .success(MetersFixtureDoor.fixture("agent-usage.budget") ?? .null)
    var cancelled = 0

    final class Watch: ChatWatch {
      let door: Door
      init(door: Door) { self.door = door }
      func cancel() { door.cancelled += 1 }
    }

    func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
      calls.append((method, params))
      switch method {
      case "agents.profileSets.list": return MetersFixtureDoor.fixture("agents-profile-sets.meters") ?? .null
      case "agent.catalog": return try HomeFixture.json("agent-catalog.valid")
      case "agents.usage": return try usage.get()
      default: throw FieldProductError(kind: "NOT_FOUND", message: method)
      }
    }

    func watch(
      _ method: String, params: JSONValue?, onFrame: @escaping @MainActor (JSONValue) -> Void
    ) async throws -> any ChatWatch {
      watched.append((method, params))
      frames.append(onFrame)
      return Watch(door: self)
    }

    func count(_ method: String) -> Int { calls.filter { $0.method == method }.count }

    /// M-c2's `ChatDoor` asks a door for a spark's reader; the meters open no thread (ChatFeedTests' door's reader).
    func reader(spark: String, device: String?, whole: Bool, held: SparkTranscriptReading) -> any ChatThreadReader {
      ChatThreadTests.Reader(held)
    }
  }

  /// Until `done` holds, or two seconds.
  func settle(_ done: () -> Bool) async {
    for _ in 0..<200 where !done() {
      try? await Task.sleep(for: .milliseconds(10))
    }
  }

  @Test("a door handed over asks the home's profiles, its catalog and its cached usage, and watches the usage")
  func attachAsks() async throws {
    let door = Door()
    let feed = MetersFeed()
    feed.attach(door, home: "dev-home")
    await settle { !feed.reading.sets.isEmpty && !feed.reading.catalog.isEmpty && !door.watched.isEmpty }
    #expect(feed.reading.connected)
    #expect(feed.reading.home == "dev-home")
    let ids = feed.reading.sets.map(\.id)
    #expect(ids == ["native", "work", "side", "new-profile"])
    let circles = feed.reading.profiles.map(\.id)
    #expect(circles == ["native", "work", "side"])
    #expect(door.count("agents.usage") == 1)
    let asked = door.calls.first { $0.method == "agents.usage" }?.params
    #expect(asked == .object([:]))
    #expect(asked?["refresh"] == nil)
    let watched = door.watched.map(\.method)
    #expect(watched == ["agents.usage.subscribe"])
    guard case .batch(let batch) = feed.reading.usage else {
      Issue.record("the usage is not the home's batch: \(feed.reading.usage)")
      return
    }
    #expect(batch.entries.count == 5)
  }

  @Test("a frame is the whole batch, and replaces it; a frame this build cannot read leaves it standing")
  func framesReplace() async throws {
    let door = Door()
    let feed = MetersFeed()
    feed.attach(door, home: "dev-home")
    await settle { !door.frames.isEmpty }
    let frame = try #require(door.frames.first)
    let empty = try #require(MetersFixtureDoor.fixture("agent-usage.empty"))
    frame(empty)
    let emptied = try AgentAccountUsageBatch(json: empty)
    #expect(feed.reading.usage == .batch(emptied))
    frame(.object(["entries": .string("none")]))
    #expect(feed.reading.usage == .batch(emptied))
  }

  @Test("a home that refuses agent.usage is said — not shared yet — and nothing is watched")
  func refusedIsSaid() async throws {
    let door = Door()
    door.usage = .failure(FieldProductError(kind: "FORBIDDEN_SCOPE", message: "agent.usage"))
    let feed = MetersFeed()
    feed.attach(door, home: "dev-home")
    await settle { feed.reading.usage != .waiting }
    #expect(feed.reading.usage == .notShared)
    #expect(door.watched.isEmpty)
    let readable = feed.reading.options.usageReadable
    #expect(!readable)
  }

  @Test("a door that cannot answer leaves the usage unavailable — the dashed circles, never a first read forever")
  func unavailableIsSaid() async throws {
    let door = Door()
    door.usage = .failure(FieldProductError(kind: "UNAVAILABLE", message: "down", retryable: true))
    let feed = MetersFeed()
    feed.attach(door, home: "dev-home")
    await settle { feed.reading.usage != .waiting }
    #expect(feed.reading.usage == .unavailable)
    await settle { !feed.reading.sets.isEmpty }
    let meters = feed.reading.meters(of: nil, now: MetersFixtureDoor.now)
    let kinds = Set(meters.entries.map(\.kind))
    #expect(kinds == [.noMeter])
  }

  @Test("a door that could not answer is still watched: the stream's open snapshot repairs it when the home answers")
  func unavailableIsWatched() async throws {
    let door = Door()
    door.usage = .failure(FieldProductError(kind: "UNAVAILABLE", message: "down", retryable: true))
    let feed = MetersFeed()
    feed.attach(door, home: "dev-home")
    await settle { feed.reading.usage != .waiting }
    #expect(feed.reading.usage == .unavailable)
    await settle { !door.frames.isEmpty }
    let watched = door.watched.map(\.method)
    #expect(watched == ["agents.usage.subscribe"])
    let frame = try #require(door.frames.first)
    let budget = try #require(MetersFixtureDoor.fixture("agent-usage.budget"))
    frame(budget)
    let batch = try AgentAccountUsageBatch(json: budget)
    #expect(feed.reading.usage == .batch(batch))
  }

  @Test("opening a meter view asks the cached usage again after a door could not answer — never after a refusal")
  func openAsksAgainWhenUnavailable() async throws {
    let door = Door()
    door.usage = .failure(FieldProductError(kind: "UNAVAILABLE", message: "down", retryable: true))
    let feed = MetersFeed()
    feed.attach(door, home: "dev-home")
    await settle { feed.reading.usage != .waiting }
    door.usage = .success(MetersFixtureDoor.fixture("agent-usage.budget") ?? .null)
    feed.open()
    await settle { door.count("agents.usage") == 2 && feed.reading.usage != .unavailable }
    #expect(door.count("agents.usage") == 2)
    guard case .batch(let batch) = feed.reading.usage else {
      Issue.record("the usage is not the home's batch after the open: \(feed.reading.usage)")
      return
    }
    #expect(batch.entries.count == 5)
    let refreshes = door.calls.filter { $0.params?["refresh"] != nil }
    #expect(refreshes.isEmpty)
    let refusing = Door()
    refusing.usage = .failure(FieldProductError(kind: "FORBIDDEN_SCOPE", message: "agent.usage"))
    let refused = MetersFeed()
    refused.attach(refusing, home: "dev-home")
    await settle { refused.reading.usage != .waiting }
    refused.open()
    await settle { refusing.count("agents.profileSets.list") == 2 }
    #expect(refusing.count("agents.usage") == 1)
  }

  // Correction (2026-11-06, M-phone's pre-light stills): this row attaches a home, so it never read a feed's first
  // attach with none. A phone signed in to no home said "reading…" for ever; `noHomeYetIsUnavailable` reads it.
  @Test("no door and no answer yet is usage unavailable — never a first read that never ends (ruling 10)")
  func noDoorIsUnavailable() async throws {
    let feed = MetersFeed()
    feed.attach(nil, home: "dev-home")
    #expect(feed.reading.usage == .unavailable)
    #expect(!feed.reading.connected)
    let words = AgentProfilesWords(
      reading: feed.reading, lens: ProfileLens(), home: "studio", now: MetersFixtureDoor.now)
    #expect(words.read == "Usage unavailable")
    let row = AgentProfilesMenuRow(reading: feed.reading, now: MetersFixtureDoor.now, open: {})
    #expect(row.word == nil)
    let door = Door()
    feed.attach(door, home: "dev-home")
    await settle { feed.reading.usage != .unavailable }
    guard case .batch = feed.reading.usage else {
      Issue.record("a door handed over did not read the home's batch: \(feed.reading.usage)")
      return
    }
  }

  @Test("a phone with no home yet is usage unavailable too — the first attach is never skipped (ruling 10)")
  func noHomeYetIsUnavailable() {
    let feed = MetersFeed()
    feed.attach(nil, home: nil)
    #expect(feed.reading.usage == .unavailable)
    #expect(!feed.reading.connected)
    #expect(feed.reading.home == nil)
    let row = AgentProfilesMenuRow(reading: feed.reading, now: MetersFixtureDoor.now, open: {})
    #expect(row.word == nil)
    // a true repeat changes nothing: the word stands
    feed.attach(nil, home: nil)
    #expect(feed.reading.usage == .unavailable)
  }

  @Test("opening a meter view reads the home's profiles again; the usage is never asked fresh")
  func openRereads() async throws {
    let door = Door()
    let feed = MetersFeed()
    feed.attach(door, home: "dev-home")
    await settle { door.count("agents.profileSets.list") == 1 && !door.watched.isEmpty }
    feed.open()
    await settle { door.count("agents.profileSets.list") == 2 }
    #expect(door.count("agents.profileSets.list") == 2)
    #expect(door.count("agents.usage") == 1)
    let refreshes = door.calls.filter { $0.params?["refresh"] != nil }
    #expect(refreshes.isEmpty)
  }

  @Test("the door taken back (the background) ends the watch and keeps the last word; another home starts afresh")
  func detachKeepsTheLastWord() async throws {
    let door = Door()
    let feed = MetersFeed()
    feed.attach(door, home: "dev-home")
    await settle { !door.watched.isEmpty && !feed.reading.sets.isEmpty }
    await settle { door.frames.count == 1 }
    try await Task.sleep(for: .milliseconds(50))
    feed.attach(nil, home: "dev-home")
    #expect(door.cancelled == 1)
    #expect(!feed.reading.connected)
    #expect(!feed.reading.sets.isEmpty)
    #expect(feed.reading.usage != .waiting)
    feed.attach(Door(), home: "dev-other")
    #expect(feed.reading.sets.isEmpty)
    #expect(feed.reading.usage == .waiting)
  }

  @Test("the demo door answers the mirrored fixtures at their own stamp, and each usage state as its door says")
  func fixtureDoor() async throws {
    let readings = MetersFixtureDoor.launched(["-vf-mock"])
    #expect(readings.usage == .readings)
    let batch = try AgentAccountUsageBatch(json: try await readings.call("agents.usage", params: nil))
    #expect(batch.generatedAt == "2026-09-16T11:59:30.000Z")
    let first = MetersFixtureDoor.launched(["-vf-mock", "-vf-mock-usage=first-read"])
    let empty = try AgentAccountUsageBatch(json: try await first.call("agents.usage", params: nil))
    #expect(empty.entries.isEmpty)
    let refused = MetersFixtureDoor.launched(["-vf-mock-usage=refused"])
    await #expect(throws: FieldProductError.self) { _ = try await refused.call("agents.usage", params: nil) }
    let sets = try AgentProfileSetsResult(json: try await readings.call("agents.profileSets.list", params: nil))
    #expect(sets.sets.count == 4)
    let catalog = try AgentCatalogResult(json: try await readings.call("agent.catalog", params: nil))
    #expect(!catalog.catalog.isEmpty)
    #expect(MetersFixtureDoor.now == ISO8601DateFormatter().date(from: "2026-09-16T12:00:00Z"))
  }
}
