import FieldDesign
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-8 — THE RAIN'S FRAME, DICE AND CADENCE (pair 4, read-pg8 §7): G6 holds the still frame and the generator to
// `phone-rain.golden.json`; the hand rows hold what a still cannot show — a moving frame (H7), the weights (H8), the
// lit row's head (H6), a gone row (H11), the lifetime (H13), the wrap (H14), the tap (H15) and the loop (H16, its ticks
// computed by the shipping `createMotionLoop`: `lanes/pg8-rain/light/p4-probe.mjs`, its log beside it).

extension RainViewTests.Parity {
  /// G6 — the generator is the golden's (its first draws), and the still frame at the open is the desktop's, op for
  /// op: its drops rolled by mulberry32 at the golden's stage — every roll the rain made — then painted once where
  /// they stand, rolling nothing. A fill is compared as its channels and its opacity, the opacity as a `Double`.
  @Test func theStillFrameIsTheDesktops() throws {
    let open = try RainGolden.open()
    let seedValue = open["random"]?["seed"]?.intValue ?? -1
    let first = (open["random"]?["first"]?.arrayValue ?? []).map { $0.doubleValue ?? .nan }
    var generator = Mulberry32(seed: UInt32(truncatingIfNeeded: seedValue))
    let mine = first.map { _ in generator.next() }
    #expect(!first.isEmpty)
    #expect(mine == first, "mulberry32(\(seedValue)): the golden's first draws")

    let still = try #require(open["still"], "the golden's still")
    let width = still["width"]?.doubleValue ?? .nan
    let height = still["height"]?.doubleValue ?? .nan
    let seed = UInt32(truncatingIfNeeded: still["seed"]?.intValue ?? -1)
    let rainDraws = Int(still["rainDraws"]?.intValue ?? -1)
    let steps = try HomeFixture.witnessSteps()
    let rows = try #require(steps.first?.rows, "the open's rows")
    let agents = rows.map { RainAgent(row: $0) }
    let order = agents.map { $0.id }
    var random = CountedRandom(Mulberry32(seed: seed))
    var frame = RainFrame()
    frame.sync(
      width: width, height: height, fontSize: RainParameters.defaults.fontSize, order: order, random: &random)
    #expect(random.draws == rainDraws, "every roll the desktop's rain made: a row and a speed per drop")
    let ops = frame.plan(agents: agents, parameters: .defaults, palette: .rain, elapsed: nil, random: &random)
    #expect(random.draws == rainDraws, "a still rolls nothing")

    let theirs = try (open["ops"]?.arrayValue ?? []).map(RainGolden.op)
    #expect(ops.count == theirs.count, "the still's ops")
    for (index, (op, record)) in zip(ops, theirs).enumerated() {
      let recorded = RainGolden.recorded(op)
      #expect(recorded == record, "op \(index)")
    }
  }
}

extension RainViewTests {
  @Suite("hand rows: the frame, the dice, the cadence")
  struct Frame {
    /// The witness open's agents named, in the window's order; `activeId` lights one.
    static func agents(_ ids: [String], activeId: String? = nil, lightsOpenCard: Bool = true) throws -> [RainAgent] {
      let steps = try HomeFixture.witnessSteps()
      let rows = try #require(steps.first?.rows, "the open's rows")
      let named = rows.filter { ids.contains($0.id) }
      #expect(named.count == ids.count, "the witness draws \(ids)")
      return named.map { RainAgent(row: $0, activeId: activeId, lightsOpenCard: lightsOpenCard) }
    }

    /// A frame synced at the golden's nominal stage (402 × 781, 33 × 65 cells of 12: the full-bleed stage).
    static func synced(_ agents: [RainAgent], seed: UInt32 = 7) -> (RainFrame, CountedRandom<Mulberry32>) {
      var random = CountedRandom(Mulberry32(seed: seed))
      var frame = RainFrame()
      frame.sync(width: 402, height: 781, fontSize: 12, order: agents.map { $0.id }, random: &random)
      return (frame, random)
    }

    /// The glyphs drawn in a stream's column.
    static func glyphs(_ ops: [RainOp], column: Int, cell: Double = 12) -> [RainGlyph] {
      let x = Double(column) * cell + cell / 2
      return ops.compactMap { op in
        if case .glyph(let glyph) = op, glyph.x == x { return glyph }
        return nil
      }
    }

    static func isKatakana(_ unit: UInt16) -> Bool { (0x30A0...0x3100).contains(unit) }

    /// H6 — J-S4's frame half: the lit row heads in the dark text main with the active row's glow ×1.5; thrown, it
    /// heads in its status's colour at ×1. Nothing else moves. The goldens light nothing (PG:430).
    @Test func theLitRowHeadsInTextMain() throws {
      let ids = ["run-h-partial", "pty-h3"]
      let lit = try Self.agents(ids, activeId: "pty-h3")
      let thrown = try Self.agents(ids, activeId: "pty-h3", lightsOpenCard: false)
      var (litFrame, litRandom) = Self.synced(lit)
      var (thrownFrame, thrownRandom) = Self.synced(thrown)
      let litOps = litFrame.plan(agents: lit, parameters: .defaults, palette: .rain, elapsed: nil, random: &litRandom)
      let thrownOps = thrownFrame.plan(
        agents: thrown, parameters: .defaults, palette: .rain, elapsed: nil, random: &thrownRandom)
      let heads = { (ops: [RainOp]) -> [String: [RainGlyph]] in
        var out: [String: [RainGlyph]] = [:]
        for (column, drop) in litFrame.drops.entries {
          out[drop.agentId, default: []] += Self.glyphs(ops, column: column).filter { $0.blur > 0 }
        }
        return out
      }
      let litHeads = heads(litOps)
      let thrownHeads = heads(thrownOps)
      let litInks = (litHeads["pty-h3"] ?? []).map { $0.ink }
      let litBlurs = (litHeads["pty-h3"] ?? []).map { $0.blur }
      #expect(!litInks.isEmpty, "the lit stream draws its heads")
      #expect(litInks.allSatisfy { $0 == .solid(RainPalette.rain.litHead) }, "J-S4: the dark text main")
      #expect(litBlurs.allSatisfy { $0 == RainParameters.defaults.headGlow * 1.5 }, "the glow ×1.5")
      let thrownInks = (thrownHeads["pty-h3"] ?? []).map { $0.ink }
      let thrownBlurs = (thrownHeads["pty-h3"] ?? []).map { $0.blur }
      #expect(thrownInks.allSatisfy { $0 == .solid(RainPalette.rain.blocked.head) }, "thrown: blocked's head")
      #expect(thrownBlurs.allSatisfy { $0 == RainParameters.defaults.headGlow }, "thrown: the glow ×1")
      #expect(litHeads["run-h-partial"] == thrownHeads["run-h-partial"], "the unlit stream is untouched")
      let litTails = litOps.filter { if case .glyph(let glyph) = $0 { glyph.blur == 0 } else { true } }
      let thrownTails = thrownOps.filter { if case .glyph(let glyph) = $0 { glyph.blur == 0 } else { true } }
      #expect(litTails == thrownTails, "lighting touches no tail")
    }

    /// H7 — each status falls and scrambles as the desktop's: working at its drop's speed × the clock, blocked at
    /// 0.02, idle at 0.1; at scramble 1 every working glyph scrambles, a blocked one only past its text block, an idle
    /// one never; idle draws no head; and a moving frame rolls once per glyph, twice for a scrambled one.
    @Test func eachStatusFallsAndScramblesAsTheDesktops() throws {
      let agents = try Self.agents(["pty-h1", "run-h-partial", "pty-h3"])
      var (frame, random) = Self.synced(agents)
      let before = frame.drops.entries.map {
        (column: $0.column, id: $0.drop.agentId, y: $0.drop.y, speed: $0.drop.speed)
      }
      #expect(before.count == 6, "two streams each")
      let parameters = RainParameters.normalize(["scrambleWorking": 1, "scramblePending": 1, "speedMultiplier": 2])
      let rolled = random.draws
      let ops = frame.plan(agents: agents, parameters: parameters, palette: .rain, elapsed: 16, random: &random)
      let rolls = random.draws - rolled
      var glyphCount = 0
      var scrambled = 0
      for stream in before {
        guard let agent = agents.first(where: { $0.id == stream.id }),
          let drop = frame.drops.drop(at: stream.column)
        else {
          Issue.record("the stream at \(stream.column) is kept")
          continue
        }
        let fall: Double
        switch agent.status {
        case .working: fall = stream.speed * 2
        case .blocked: fall = 0.02
        case .idle: fall = 0.1
        }
        let expectedY = stream.y + fall
        #expect(drop.y == expectedY, "\(stream.id) at \(stream.column) falls \(fall)")
        let data = RainStreams.data(agent)
        let glyphs = Self.glyphs(ops, column: stream.column)
        glyphCount += glyphs.count
        let heads = glyphs.filter { $0.blur > 0 }
        #expect(heads.count == (agent.status == .idle ? 0 : 1), "\(stream.id): a head unless idle")
        for glyph in glyphs {
          let row = Int(glyph.y / 12)
          let plain = data[row % data.count]
          let distance = drop.y - Double(row)
          let shouldScramble: Bool
          switch agent.status {
          case .working: shouldScramble = true
          case .blocked: shouldScramble = glyph.blur == 0 && distance >= Double(data.count)
          case .idle: shouldScramble = false
          }
          if shouldScramble {
            #expect(Self.isKatakana(glyph.unit), "\(stream.id) row \(row): scrambled")
            scrambled += 1
          } else {
            #expect(glyph.unit == plain, "\(stream.id) row \(row): its data")
          }
        }
      }
      #expect(rolls == glyphCount + scrambled, "one roll per glyph, one more per scrambled glyph")
    }

    /// H8 — every weight is 1 on the phone (no row is receded), and the transcribed recede stands: a receded row sits
    /// at 0.22 in a still, every row receded at 0.07, a moving frame steps toward its target, and a gone row's weight
    /// is forgotten. `every` of no rows is false.
    @Test func everyWeightIsOneOnThePhone() throws {
      var agents = try Self.agents(["pty-h1", "run-h-partial", "pty-h3"])
      var (frame, random) = Self.synced(agents)
      let ops = frame.plan(agents: agents, parameters: .defaults, palette: .rain, elapsed: nil, random: &random)
      let alphas = ops.compactMap { op -> Double? in if case .glyph(let glyph) = op { glyph.alpha } else { nil } }
      #expect(!alphas.isEmpty && alphas.allSatisfy { $0 == 1 }, "the phone joins nothing: every weight is 1")
      #expect(!GodviewRecede.every([Bool]()))

      agents[1].receded = true
      _ = frame.plan(agents: agents, parameters: .defaults, palette: .rain, elapsed: 16, random: &random)
      let stepped = frame.recedes["run-h-partial"]
      let expectedStep = GodviewRecede.approach(1, toward: GodviewRecede.receded, deltaMs: 16)
      #expect(stepped == expectedStep, "a moving frame steps from 1 toward 0.22")
      _ = frame.plan(agents: agents, parameters: .defaults, palette: .rain, elapsed: nil, random: &random)
      #expect(frame.recedes["run-h-partial"] == GodviewRecede.receded, "a still sits at the weight")
      for index in agents.indices { agents[index].receded = true }
      _ = frame.plan(agents: agents, parameters: .defaults, palette: .rain, elapsed: nil, random: &random)
      let weights = Set(frame.recedes.values)
      #expect(weights == [GodviewRecede.recededEmpty], "every row receded")
      let first = Array(agents.prefix(1))
      _ = frame.plan(agents: first, parameters: .defaults, palette: .rain, elapsed: nil, random: &random)
      let kept = Set(frame.recedes.keys)
      #expect(kept == ["pty-h1"], "a gone row's weight is forgotten")
    }

    /// H11 — a stream whose row is gone is skipped (the transient between a reconcile and a draw), and a tap on it
    /// is no one.
    @Test func aStreamWithNoRowIsSkipped() throws {
      let agents = try Self.agents(["pty-h1", "run-h-partial"])
      var (frame, random) = Self.synced(agents)
      let kept = Array(agents.prefix(1))
      let ops = frame.plan(agents: kept, parameters: .defaults, palette: .rain, elapsed: nil, random: &random)
      #expect(frame.drops.count == 4, "both rows keep their two streams until the next reconcile")
      let glyphCount = ops.filter { if case .glyph = $0 { true } else { false } }.count
      #expect(glyphCount > 0, "the kept row draws")
      for (column, drop) in frame.drops.entries {
        let drawn = Self.glyphs(ops, column: column)
        let mine = drop.agentId == "pty-h1"
        #expect(drawn.isEmpty != mine, "column \(column) of \(drop.agentId)")
        let tapped = frame.agent(atX: Double(column) * 12 + 1, among: kept)?.id
        #expect(tapped == (mine ? "pty-h1" : nil))
      }
    }

    /// H13 — the lifetime: rows going to none (sign-out, a fresh copy) clear the streams and the weights, and rows
    /// coming back are born afresh, rolled again.
    @Test func rowsComingBackAreBornAfresh() throws {
      let agents = try Self.agents(["pty-h1", "run-h-partial"])
      var (frame, random) = Self.synced(agents)
      let born = frame.drops.entries.map { $0.drop }
      _ = frame.plan(agents: agents, parameters: .defaults, palette: .rain, elapsed: nil, random: &random)
      frame.sync(width: 402, height: 781, fontSize: 12, order: [], random: &random)
      let empty = frame.plan(agents: [], parameters: .defaults, palette: .rain, elapsed: nil, random: &random)
      #expect(frame.drops.isEmpty)
      #expect(frame.recedes.isEmpty)
      #expect(empty == [.stage(width: 402, height: 781, fill: RainPalette.rain.stage)], "the bare stage")
      let rolled = random.draws
      frame.sync(width: 402, height: 781, fontSize: 12, order: agents.map { $0.id }, random: &random)
      #expect(random.draws - rolled == 2 * frame.drops.count, "each new drop rolls its row and its speed")
      let reborn = frame.drops.entries.map { $0.drop }
      let shared = reborn.filter { drop in born.contains { $0 === drop } }
      #expect(shared.isEmpty, "no drop survives the empty window")
    }

    /// H14 — the wrap: a drop whose tail has left the stage starts again at row 0, in a still too.
    @Test func aDropPastTheStageWrapsEvenInAStill() throws {
      let agents = try Self.agents(["run-h-partial"])
      var (frame, random) = Self.synced(agents)
      let entry = try #require(frame.drops.entries.first)
      entry.drop.y = 1000
      let ops = frame.plan(agents: agents, parameters: .defaults, palette: .rain, elapsed: nil, random: &random)
      #expect(entry.drop.y == 0)
      let drawn = Self.glyphs(ops, column: entry.column)
      let rowsDrawn = drawn.map { $0.y }
      #expect(rowsDrawn == [0], "the head alone, at row 0's baseline")
    }

    /// H15 — a tap's x finds the stream under it: a column with a stream opens its row, one with none (or past the
    /// last whole column, or off the stage) is no one.
    @Test func aTapFindsTheStreamUnderIt() throws {
      let agents = try Self.agents(["pty-h1", "run-h-partial", "pty-h3"])
      let (frame, _) = Self.synced(agents)
      #expect(frame.geometry.columns == 33)
      for (column, drop) in frame.drops.entries {
        for offset in [0.0, 6, 11.999] {
          let tapped = frame.agent(atX: Double(column) * 12 + offset, among: agents)?.id
          #expect(tapped == drop.agentId, "column \(column) + \(offset)")
        }
      }
      let freeColumn = (0..<33).first { !frame.drops.has($0) }
      let free = try #require(freeColumn, "a column with no stream")
      let none = frame.agent(atX: Double(free) * 12 + 6, among: agents)
      #expect(none == nil, "column \(free) holds no stream")
      for x in [400.0, 33 * 12, -0.5, -.infinity, .nan] {
        let off = frame.agent(atX: x, among: agents)
        #expect(off == nil, "x \(x)")
      }
    }

    /// H16 — the loop, as the shipping `createMotionLoop` steps (p4-probe.log): at 30 fps a 120 Hz display draws on
    /// ticks 4, 8, 13, 16, 21 (the cap's float remainder, not a strict every 4th) and a 60 Hz one on 2, 4, 7, 8, 11;
    /// the delta counts from the (re)start; uncapped draws every tick; a paused loop wants no frame.
    @Test func theLoopStepsAsTheDesktops() {
      func run(hz: Double, ticks: Int, fps: Double?, start: Double = 0) -> (drawn: [Int], deltas: [Double]) {
        var motion = RainMotion(now: start, fps: fps)
        var drawn: [Int] = []
        var deltas: [Double] = []
        for k in 1...ticks {
          let time = start + (Double(k) * 1000) / hz
          if let delta = motion.tick(time) {
            drawn.append(k)
            deltas.append(delta)
          }
        }
        return (drawn, deltas)
      }
      let fast = run(hz: 120, ticks: 24, fps: 30)
      #expect(fast.drawn == [4, 8, 13, 16, 21])
      let fastDeltas = [
        33.333333333333336, 33.333333333333336, 41.66666666666666, 25.000000000000014, 41.66666666666666,
      ]
      #expect(fast.deltas == fastDeltas)
      let sixty = run(hz: 60, ticks: 12, fps: 30)
      #expect(sixty.drawn == [2, 4, 7, 8, 11])
      #expect(sixty.deltas == [33.333333333333336, 33.333333333333336, 50, 16.66666666666667, 50])
      let uncapped = run(hz: 120, ticks: 4, fps: nil)
      #expect(uncapped.drawn == [1, 2, 3, 4])
      #expect(uncapped.deltas == [8.333333333333334, 8.333333333333334, 8.333333333333332, 8.333333333333336])
      let full = run(hz: 60, ticks: 6, fps: 60)
      #expect(full.drawn == [1, 2, 4, 5, 6])
      let restarted = run(hz: 120, ticks: 12, fps: 30, start: 5000)
      #expect(restarted.drawn == [5, 8])
      #expect(restarted.deltas == [41.66666666666697, 25])
      #expect(!RainMotion.wanted(animations: true, reducedMotion: true), "reduced motion: no frame")
      #expect(!RainMotion.wanted(animations: false, reducedMotion: false), "animations off: no frame")
      #expect(RainMotion.wanted(animations: true, reducedMotion: false))
    }

    /// The dice's edges: the launch flag (matched with its `=`), and `matrixGlyph`'s truncation — a roll a hair under
    /// 1 lands on U+3100, past the katakana block, exactly as `String.fromCharCode` does (p4-glyph.log).
    @Test func theDiceAreTheDesktops() {
      let seeded = Mulberry32.launch(["-vf-godview-view=rain", "-vf-godview-rain-seed=1"])
      #expect(seeded == Mulberry32(seed: 1))
      #expect(Mulberry32.launch(["-vf-godview-rain-seed-x=1"]) == nil)
      #expect(Mulberry32.launch(["-vf-godview-rain-seed=one"]) == nil)
      #expect(Mulberry32.launch(["-vf-godview-rain-seed=4294967296"]) == nil)
      #expect(Mulberry32.launch([]) == nil)
      let glyphs = [0, 0.5, 0.9999999999999999, 0.99999999999999].map(RainFrame.matrixGlyph)
      #expect(glyphs == [0x30A0, 0x30D0, 0x3100, 0x30FF])
    }
  }
}

/// A generator that counts its rolls.
struct CountedRandom<Base: RainRandom>: RainRandom {
  var base: Base
  private(set) var draws = 0

  init(_ base: Base) { self.base = base }

  mutating func next() -> Double {
    draws += 1
    return base.next()
  }
}

extension RainGolden {
  /// A recorded op as the phone's: `{rect, fill}` is the stage; a glyph's fill is a head's colour or a tail's
  /// `rgba(<channels>, <opacity>)`; its glow is recorded only while it blurs.
  static func op(_ record: JSONValue) throws -> RainOp {
    let fill = record["fill"]?.stringValue ?? ""
    if let rect = record["rect"]?.arrayValue {
      let numbers = rect.map { $0.doubleValue ?? .nan }
      #expect(numbers.prefix(2) == [0, 0], "the stage's fill is the whole frame")
      let width = numbers.count > 2 ? numbers[2] : .nan
      let height = numbers.count > 3 ? numbers[3] : .nan
      return .stage(width: width, height: height, fill: fill)
    }
    let units = Array((record["glyph"]?.stringValue ?? "").utf16)
    let unit = try #require(units.count == 1 ? units.first : nil, "a glyph is one code unit")
    let blur = record["blur"]?.doubleValue ?? 0
    let shadow = record["shadow"]?.stringValue
    return .glyph(
      RainGlyph(
        unit: unit, x: record["x"]?.doubleValue ?? .nan, y: record["y"]?.doubleValue ?? .nan, ink: ink(fill),
        alpha: record["alpha"]?.doubleValue ?? .nan, blur: blur, glowRgb: shadow.map(channels)))
  }

  /// The phone's op as the golden's recorder writes it: a glow's colour only while it blurs.
  static func recorded(_ op: RainOp) -> RainOp {
    guard case .glyph(let glyph) = op, glyph.blur <= 0, glyph.glowRgb != nil else { return op }
    return .glyph(
      RainGlyph(
        unit: glyph.unit, x: glyph.x, y: glyph.y, ink: glyph.ink, alpha: glyph.alpha, blur: glyph.blur, glowRgb: nil))
  }

  /// `rgba(r, g, b, a)` → `.faded("r, g, b", a)`; anything else is a solid colour.
  static func ink(_ fill: String) -> RainInk {
    guard fill.hasPrefix("rgba("), fill.hasSuffix(")"), let comma = fill.range(of: ", ", options: .backwards)
    else { return .solid(fill) }
    let rgb = String(fill[fill.index(fill.startIndex, offsetBy: 5)..<comma.lowerBound])
    let opacity = Double(fill[comma.upperBound..<fill.index(before: fill.endIndex)]) ?? .nan
    return .faded(rgb: rgb, opacity: opacity)
  }

  /// `rgba(r, g, b, 1)` → `r, g, b`.
  static func channels(_ shadow: String) -> String {
    if case .faded(let rgb, 1) = ink(shadow) { return rgb }
    return "?\(shadow)"
  }
}
