import CoreGraphics
import FieldDesign
import Foundation
import Testing

@testable import FieldHome
@testable import FieldProduct

/// IOS-12f's f6 (PC-D8 A, Q2, Q3, Q5; DESIGN.md §8 "The phone's Chat", Created) — Create's order, on a recording
/// flight in place of the flight window (no Metal, no UIWindow):
/// - made, Chat's list reads again and holds the new spark (the feed's hatch asks it, under `-vf-mock`'s door);
/// - the face flies only once the new spark's row says where its face is, within 1,500 ms (the Mac's ROW_WAIT_MS), and
///   the sheet folds in that tick;
/// - the row's own face waits, unseen, until the face lands, and then Chat opens the thread.
/// With no row, nothing flies. Under reduced motion, or where nothing can fly, the row's face fades in, then the thread
/// opens. A refusal flies nothing.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("Created, the face flies to its row as the sheet folds, then Chat opens its thread")
@MainActor
struct NewSparkCreateTests {
  /// Records each flight and lands it when the test says.
  final class Flight: SparkFlying {
    var flights: [(seed: UInt32, from: SparkFlight.Start, to: CGRect?)] = []
    var landed: (@MainActor () -> Void)?
    var flies = true

    func fly(
      seed: UInt32, from start: SparkFlight.Start, cut: SIMD3<Double>, to: @escaping @MainActor () -> CGRect?,
      landed: @escaping @MainActor () -> Void
    ) -> Bool {
      guard flies else { return false }
      flights.append((seed, start, to()))
      self.landed = landed
      return true
    }
  }

  /// What the sheet and Chat are asked to do, in order.
  @MainActor
  final class Steps {
    var events: [String] = []
    var opened: [String] = []
    var hero: SparkFlight.Start? = SparkFlight.Start(x: 201, y: 214, R: 47.6)

    var steps: NewSparkLanding.Steps {
      NewSparkLanding.Steps(
        hero: {
          self.events.append("hero")
          return self.hero
        },
        fold: { self.events.append("fold") },
        open: { spark in
          self.events.append("open")
          self.opened.append(spark)
        })
    }
  }

  /// A door that answers as `-vf-mock`'s does and refuses every hatch as fieldd refuses a taken name.
  final class Refusing: ChatDoor {
    let inner = ChatFixtureDoor()
    var hatches = 0

    func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
      guard method == SparkHatch.method else { return try await inner.call(method, params: params) }
      hatches += 1
      throw FieldProductError(
        kind: "PRECONDITION_FAILED", message: "a spark named Vela already exists",
        details: .object(["reason": .string("name-taken")]))
    }

    func watch(
      _ method: String, params: JSONValue?, onFrame: @escaping @MainActor (JSONValue) -> Void
    ) async throws -> any ChatWatch {
      try await inner.watch(method, params: params, onFrame: onFrame)
    }

    func reader(spark: String, device: String?, whole: Bool, held: SparkTranscriptReading) -> any ChatThreadReader {
      inner.reader(spark: spark, device: device, whole: whole, held: held)
    }
  }

  static let box = CGRect(x: 16, y: 180, width: 48, height: 48)
  static let cut = SIMD3<Double>(1, 1, 1)

  static func made() throws -> SparkSummary {
    let spark = ChatFixtureDoor.fixture("compose-sparks-list.merged")?["sparks"]?.arrayValue?.first
    return try SparkSummary(json: spark ?? .null)
  }

  /// Until `done` holds, or two seconds.
  func until(_ done: () -> Bool) async {
    for _ in 0..<400 where !done() { try? await Task.sleep(for: .milliseconds(5)) }
  }

  /// The landing has begun: the new row's face waits.
  func begun(_ landing: NewSparkLanding, _ made: SparkSummary) async {
    await until { landing.face(of: made.id) == .waits }
  }

  @Test("made, Chat's list reads again and holds the new spark, and the face flies once its row says where it is")
  func readsAgain() async throws {
    let feed = ChatFeed()
    let door = ChatFixtureDoor()
    feed.attach(door, home: ChatFixtureDoor.home)
    await until { feed.reading.heard }
    let before = Set(feed.reading.sparks.map(\.id))
    let sheet = NewSparkSheet(taken: feed.reading.sparks.map(\.name))
    await sheet.open(on: feed)
    let flight = Flight()
    let steps = Steps()
    let landing = NewSparkLanding(flying: flight, rowWait: .seconds(2))
    let created = Task {
      await landing.create(sheet, on: feed, reducedMotion: false, cut: Self.cut, steps: steps.steps)
    }
    await until { feed.reading.sparks.contains { !before.contains($0.id) } }
    let made = feed.reading.sparks.first { !before.contains($0.id) }
    let id = try #require(made?.id)
    let name = made?.name
    #expect(name == sheet.trimmed)
    let waits = landing.face(of: id)
    #expect(waits == .waits)
    #expect(flight.flights.isEmpty)
    landing.row(id, box: Self.box)
    await created.value
    let seeds = flight.flights.map(\.seed)
    #expect(seeds == [sheet.seed])
    #expect(steps.events == ["hero", "fold"])
  }

  @Test("the face flies only once the new spark's row says where its face is, from the hero to that box")
  func fliesOnTheRow() async throws {
    let made = try Self.made()
    let flight = Flight()
    let steps = Steps()
    let landing = NewSparkLanding(flying: flight, rowWait: .seconds(2))
    let landed = Task { await landing.land(made, reducedMotion: false, cut: Self.cut, steps: steps.steps) }
    await begun(landing, made)
    try? await Task.sleep(for: .milliseconds(50))
    #expect(flight.flights.isEmpty)
    // another spark's row says nothing to this landing
    landing.row("sp-other", box: CGRect(x: 0, y: 0, width: 48, height: 48))
    try? await Task.sleep(for: .milliseconds(20))
    #expect(flight.flights.isEmpty)
    landing.row(made.id, box: Self.box)
    await landed.value
    let flights = flight.flights
    #expect(flights.count == 1)
    #expect(flights.first?.seed == made.seed)
    #expect(flights.first?.from == steps.hero)
    #expect(flights.first?.to == Self.box)
  }

  @Test("the sheet folds in the flight's own tick: the hero leaves the sky, then the fold, nothing between")
  func foldsAsItFlies() async throws {
    let made = try Self.made()
    let flight = Flight()
    let steps = Steps()
    let landing = NewSparkLanding(flying: flight, rowWait: .seconds(2))
    let landed = Task { await landing.land(made, reducedMotion: false, cut: Self.cut, steps: steps.steps) }
    await begun(landing, made)
    landing.row(made.id, box: Self.box)
    await landed.value
    #expect(steps.events == ["hero", "fold"])
    #expect(flight.flights.count == 1)
  }

  @Test("Chat opens the new spark's thread only once the face has landed")
  func opensOnLanding() async throws {
    let made = try Self.made()
    let flight = Flight()
    let steps = Steps()
    let landing = NewSparkLanding(flying: flight, rowWait: .seconds(2))
    let landed = Task { await landing.land(made, reducedMotion: false, cut: Self.cut, steps: steps.steps) }
    await begun(landing, made)
    landing.row(made.id, box: Self.box)
    await landed.value
    #expect(steps.opened.isEmpty)
    flight.landed?()
    #expect(steps.opened == [made.id])
    #expect(steps.events.last == "open")
  }

  @Test("the row's own face waits, unseen, while the face flies to it, and is the row's once it lands")
  func faceWaits() async throws {
    let made = try Self.made()
    let flight = Flight()
    let steps = Steps()
    let landing = NewSparkLanding(flying: flight, rowWait: .seconds(2))
    let landed = Task { await landing.land(made, reducedMotion: false, cut: Self.cut, steps: steps.steps) }
    await begun(landing, made)
    let before = landing.face(of: made.id)
    #expect(before == .waits)
    landing.row(made.id, box: Self.box)
    await landed.value
    let flying = landing.face(of: made.id)
    #expect(flying == .waits)
    let other = landing.face(of: "sp-other")
    #expect(other == nil)
    flight.landed?()
    let after = landing.face(of: made.id)
    #expect(after == nil)
  }

  @Test("no row within the wait: nothing flies, the sheet folds, and Chat opens the thread on the row")
  func noRow() async throws {
    let made = try Self.made()
    let flight = Flight()
    let steps = Steps()
    let landing = NewSparkLanding(flying: flight, rowWait: .milliseconds(30))
    await landing.land(made, reducedMotion: false, cut: Self.cut, steps: steps.steps)
    #expect(flight.flights.isEmpty)
    #expect(steps.events == ["fold", "open"])
    #expect(steps.opened == [made.id])
    let face = landing.face(of: made.id)
    #expect(face == nil)
  }

  enum Still: String, CaseIterable, CustomStringConvertible {
    case reducedMotion = "reduced motion"
    case noWindow = "no flight window (no Metal, or the gate is not .star)"
    case noHero = "a sky with no face to give (the flat star)"
    var description: String { rawValue }
  }

  @Test("nothing flies: the sheet folds, the row's face fades in, then its thread opens", arguments: Still.allCases)
  func fades(_ still: Still) async throws {
    let made = try Self.made()
    let flight = Flight()
    flight.flies = still != .noWindow
    let steps = Steps()
    if still == .noHero { steps.hero = nil }
    let landing = NewSparkLanding(flying: flight, rowWait: .seconds(2), fadeWait: .milliseconds(200))
    let landed = Task {
      await landing.land(made, reducedMotion: still == .reducedMotion, cut: Self.cut, steps: steps.steps)
    }
    await begun(landing, made)
    landing.row(made.id, box: Self.box)
    await until { steps.events.contains("fold") }
    let fading = landing.face(of: made.id)
    #expect(fading == .fades)
    #expect(steps.opened.isEmpty)
    await landed.value
    #expect(flight.flights.isEmpty)
    #expect(steps.opened == [made.id])
    #expect(steps.events.last == "open")
    let after = landing.face(of: made.id)
    #expect(after == nil)
  }

  @Test("a refusal flies nothing: the sheet stays, and the refusal stands where it asked")
  func refusal() async throws {
    let feed = ChatFeed()
    let door = Refusing()
    feed.attach(door, home: ChatFixtureDoor.home)
    await until { feed.reading.heard }
    let sheet = NewSparkSheet(taken: [])
    await sheet.open(on: feed)
    let flight = Flight()
    let steps = Steps()
    let landing = NewSparkLanding(flying: flight, rowWait: .seconds(2))
    await landing.create(sheet, on: feed, reducedMotion: false, cut: Self.cut, steps: steps.steps)
    #expect(door.hatches == 1)
    #expect(steps.events.isEmpty)
    #expect(flight.flights.isEmpty)
    let at = sheet.refusal?.at
    #expect(at == .name)
    #expect(!sheet.creating)
  }
}
