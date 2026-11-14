import CoreGraphics
import SwiftUI
import Testing

@testable import FieldDesign

/// Item 417b (2026-11-14; on James's item 417, 08:13:38Z, session qa-01: "message view initial loading should adopt
/// latest desktop design that uses our logo mark") — the phone draws the living mark itself, from the desktop's
/// generated SVG (`packages/design-kit/src/living-mark/living-mark-light.svg`, look "Wormhole · edited",
/// 517b24464e65), whose numbers are carried into LivingMarkData.swift.
///
/// These rows hold what a value can: the carried file's own numbers, that every key reads to one structure, and
/// the rules the drawing is made from (the reader, the mix, the clock, a light's run, the path). They do NOT read
/// the SVG: a regenerated SVG is seen here only once the carried file is made to follow it. How the mark looks is
/// his to see.
@Suite("item 417b — the phone's living mark is the desktop's generated SVG, read as a browser reads it")
struct LivingMarkTests {
  private typealias Place = LivingMarkClock.Place

  // MARK: - The carried numbers

  @Test("it names the generator's stamp, and its box is the SVG's: 99 by 44, a hundred units to the point")
  func theStampAndTheBox() {
    #expect(LivingMarkData.look == "Wormhole · edited")
    #expect(LivingMarkData.stamp == "517b24464e65")
    #expect(LivingMarkData.viewBox == CGRect(x: 1500, y: 1500, width: 9900, height: 4400))
    #expect(LivingMarkData.size == CGSize(width: 99, height: 44))
    #expect(LivingMarkData.viewBox.width == LivingMarkData.size.width * 100)
    #expect(LivingMarkData.viewBox.height == LivingMarkData.size.height * 100)
    #expect(LivingMarkData.hairline == 0.5)
  }

  @Test("the twist has thirteen keys, the edge, the cover, the hole and the lights' ride alike")
  func thirteenKeys() {
    let places: [Double] = [0, 10.1501, 14.8499, 25, 35.1501, 39.8499, 50, 60.1501, 64.8499, 75, 85.1501, 89.8499, 100]
    #expect(LivingMarkData.keys == places)
    #expect(LivingMarkData.loop.count == 13)
    #expect(LivingMarkData.cover.count == 13)
    #expect(LivingMarkData.hole.count == 13)
    #expect(LivingMarkData.twist.count == 13)
    for (before, after) in zip(LivingMarkData.keys, LivingMarkData.keys.dropFirst()) {
      #expect(before < after)
    }
  }

  @Test("a whole turn comes back to where it began: the last key is the first")
  func theTurnReturns() {
    #expect(LivingMarkData.loop.last == LivingMarkData.loop.first)
    #expect(LivingMarkData.cover.last == LivingMarkData.cover.first)
    #expect(LivingMarkData.hole.last == LivingMarkData.hole.first)
  }

  @Test("the periods are the SVG's: a turn of 9.52 s, a lap of 15.2672 s begun 14.2672 s in, an edge of 1000")
  func thePeriods() {
    #expect(LivingMarkData.twistPeriod == 9.52)
    #expect(LivingMarkData.travelPeriod == 15.2672)
    #expect(LivingMarkData.travelLead == 14.2672)
    #expect(LivingMarkData.edgeLength == 1000)
  }

  @Test("the three timing functions are the SVG's cubic-beziers, in turn from the first key")
  func theEases() {
    typealias Ease = LivingMarkData.Ease
    let eases = [
      Ease(x1: 0.3333, y1: 0.0731, x2: 0.6667, y2: 0.3175),
      Ease(x1: 0.3333, y1: 0.316, x2: 0.6667, y2: 0.684),
      Ease(x1: 0.3333, y1: 0.6825, x2: 0.6667, y2: 0.9269),
    ]
    #expect(LivingMarkData.eases == eases)
  }

  @Test("a light is five strokes, three glows and two cores, by the SVG's classes")
  func theStrokes() {
    typealias Stroke = LivingMarkData.Stroke
    let strokes = [
      Stroke(width: 170.01, opacity: 0.1334, dash: 80.05, lead: 40.02),
      Stroke(width: 170.01, opacity: 0.154, dash: 70.53, lead: 35.27),
      Stroke(width: 170.01, opacity: 0.182, dash: 60.06, lead: 30.03),
      Stroke(width: 40.48, opacity: 0.5, dash: 82.03, lead: 41.01),
      Stroke(width: 40.48, opacity: 1, dash: 69.92, lead: 34.96),
    ]
    #expect(LivingMarkData.strokes == strokes)
  }

  @Test("there are three lights, each with its colour and its place on the edge")
  func theLights() {
    typealias Light = LivingMarkData.Light
    let lights = [
      Light(color: "#FF0054", offset: 473.28),
      Light(color: "#00F59B", offset: 157),
      Light(color: "#083CFF", offset: 795.69),
    ]
    #expect(LivingMarkData.lights == lights)
  }

  // MARK: - The reader

  @Test("the reader takes a minus sign as the next number's own, and a line break as a space")
  func theReader() {
    let read = LivingMarkOutline(reading: "M11115 3410c30 486-110 975-395 1319s-714 533-1192 537z")
    let numbers: [Double] = [11115, 3410, 30, 486, -110, 975, -395, 1319, -714, 533, -1192, 537]
    #expect(String(read.commands) == "Mcsz")
    #expect(read.numbers == numbers)
    let broken = LivingMarkOutline(reading: "M1400 1400h10100\nv4600h-10100z")
    let box: [Double] = [1400, 1400, 10100, 4600, -10100]
    #expect(String(broken.commands) == "Mhvhz")
    #expect(broken.numbers == box)
  }

  @Test("every key of the edge, the cover and the hole reads to one structure, with every number taken")
  func oneStructure() {
    let edge = "Mc" + String(repeating: "s", count: 31) + "z"
    check(LivingMarkData.loop, "the edge", letters: edge, numbers: 132)
    check(LivingMarkData.cover, "the cover", letters: "McsLcsz", numbers: 24)
    check(LivingMarkData.hole, "the hole", letters: "MhvhzMcssLcssz", numbers: 37)
  }

  private func check(_ keys: [String], _ what: String, letters: String, numbers: Int) {
    for (key, text) in keys.enumerated() {
      let outline = LivingMarkOutline(reading: text)
      let taken = outline.commands.reduce(0) { $0 + LivingMarkOutline.takes($1) }
      #expect(String(outline.commands) == letters, "\(what), key \(key)")
      #expect(outline.numbers.count == numbers, "\(what), key \(key)")
      #expect(taken == outline.numbers.count, "\(what), key \(key)")
    }
  }

  @Test("at every key the edge returns to where it began: the ends of its thirty-two curves sum to nothing")
  func theEdgeCloses() throws {
    for (key, text) in LivingMarkData.loop.enumerated() {
      let numbers = LivingMarkOutline(reading: text).numbers
      try #require(numbers.count == 132, "the edge, key \(key)")
      // after M's two numbers the first curve ends on its fifth and sixth, and each `s` after it on its third
      // and fourth
      var x = numbers[6]
      var y = numbers[7]
      for curve in 0..<31 {
        x += numbers[8 + curve * 4 + 2]
        y += numbers[8 + curve * 4 + 3]
      }
      #expect(x == 0, "the edge, key \(key)")
      #expect(y == 0, "the edge, key \(key)")
    }
  }

  // MARK: - The mix

  @Test("two paths of one structure mix number for number, and paths of two structures do not mix")
  func mixing() {
    let from = LivingMarkOutline(commands: ["M", "L"], numbers: [0, 10, 20, 30])
    let to = LivingMarkOutline(commands: ["M", "L"], numbers: [10, 30, 40, 50])
    let half = LivingMarkOutline(commands: ["M", "L"], numbers: [5, 20, 30, 40])
    #expect(from.mixed(with: to, by: 0) == from)
    #expect(from.mixed(with: to, by: 1) == to)
    #expect(from.mixed(with: to, by: 0.5) == half)
    let other = LivingMarkOutline(commands: ["M", "h"], numbers: [10, 30, 40])
    #expect(from.mixed(with: other, by: 0.5) == from)
  }

  // MARK: - The clock

  @Test("a moment stands in the stretch its share of the 9.52 s turn falls in, and the turn comes round")
  func theStretch() {
    #expect(LivingMarkClock.place(at: 0.5).key == 0)
    #expect(LivingMarkClock.place(at: 1.2).key == 1)
    #expect(LivingMarkClock.place(at: 2.0).key == 2)
    #expect(LivingMarkClock.place(at: 3.0).key == 3)
    #expect(LivingMarkClock.place(at: 9.0).key == 11)
    #expect(LivingMarkClock.place(at: 10.02).key == 0)
    #expect(LivingMarkClock.place(at: 10.72).key == 1)
  }

  @Test("each stretch goes on its own timing function: at their middles the three stand at 27%, 50% and 73%")
  func theTimingFunctions() {
    #expect(abs(LivingMarkClock.place(at: 0).share) < 1e-9)
    let turn = LivingMarkData.twistPeriod
    // the middles of the first three stretches: 5.07505%, 12.5% and 19.92495% of the turn
    let first = LivingMarkClock.place(at: turn * 0.0507505)
    #expect(first.key == 0)
    #expect(abs(first.share - 0.2715) < 0.001)
    let second = LivingMarkClock.place(at: turn * 0.125)
    #expect(second.key == 1)
    #expect(abs(second.share - 0.5) < 0.001)
    let third = LivingMarkClock.place(at: turn * 0.1992495)
    #expect(third.key == 2)
    #expect(abs(third.share - 0.7285) < 0.001)
    // and the three come round again from the fourth key
    let fourth = LivingMarkClock.place(at: turn * 0.3007505)
    #expect(fourth.key == 3)
    #expect(abs(fourth.share - 0.2715) < 0.001)
  }

  @Test("the twist adds a twelfth of the edge to every stroke's offset by each key")
  func theTwist() {
    #expect(LivingMarkClock.twist(at: Place(key: 0, share: 0)) == 0)
    #expect(LivingMarkClock.twist(at: Place(key: 3, share: 0)) == -250)
    #expect(abs(LivingMarkClock.twist(at: Place(key: 0, share: 0.5)) + 41.665) < 1e-9)
    #expect(abs(LivingMarkClock.twist(at: Place(key: 6, share: 0.5)) + 541.665) < 1e-9)
    #expect(abs(LivingMarkClock.twist(at: Place(key: 11, share: 1)) + 1000) < 1e-9)
  }

  @Test("the lights lap the edge every 15.2672 s, and begin 14.2672 s into the lap")
  func theLap() {
    #expect(abs(LivingMarkClock.travel(at: 0) + 934.5) < 0.001)
    #expect(abs(LivingMarkClock.travel(at: 7.6336) + 434.5) < 0.001)
    #expect(abs(LivingMarkClock.travel(at: 15.2672) + 934.5) < 0.001)
    var seconds = 0.0
    while seconds < 40 {
      let added = LivingMarkClock.travel(at: seconds)
      #expect(added <= 0)
      #expect(added > -1000)
      seconds += 0.37
    }
  }

  // MARK: - A light's run

  @Test("at rest every stroke of a light stands about the light's place on the edge")
  func theRunAtRest() {
    for light in LivingMarkData.lights {
      // the SVG's dash begins `offset` and its lead BEFORE the edge's start, so it stands about 1000 less the offset
      let place = 1 - light.offset / 1000
      for stroke in LivingMarkData.strokes {
        let run = LivingMarkClock.run(of: stroke, at: light.offset, shift: 0)
        #expect(abs(run.length - stroke.dash / 1000) < 1e-12)
        // a lead is half its dash rounded to a hundredth of the edge's 1000
        #expect(abs(run.from + run.length / 2 - place) < 0.00001)
      }
    }
    let core = LivingMarkClock.run(of: LivingMarkData.strokes[4], at: 473.28, shift: 0)
    #expect(abs(core.from - 0.49176) < 1e-9)
    #expect(abs(core.length - 0.06992) < 1e-12)
  }

  @Test("what the twist and the lap add moves a stroke on along the edge, and it comes round at the edge's start")
  func theRunMoves() {
    let stroke = LivingMarkData.strokes[4]
    let rest = LivingMarkClock.run(of: stroke, at: 157, shift: 0)
    let quarter = LivingMarkClock.run(of: stroke, at: 157, shift: -250)
    // 0.80804 at rest; a quarter of the edge on is 1.05804, which is 0.05804 of the next lap
    #expect(abs(rest.from - 0.80804) < 1e-9)
    #expect(abs(quarter.from - 0.05804) < 1e-9)
    var shift = 0.0
    while shift > -3000 {
      for light in LivingMarkData.lights {
        let run = LivingMarkClock.run(of: stroke, at: light.offset, shift: shift)
        #expect(run.from >= 0)
        #expect(run.from < 1)
      }
      shift -= 37.5
    }
  }

  // MARK: - The pose and the path

  @Test("at rest the mark is its first key with nothing added; moving, it begins from that key")
  func thePose() {
    let first = LivingMarkOutline(reading: LivingMarkData.loop[0])
    #expect(first.numbers.count == 132)
    #expect(LivingMarkPose.rest.edge == first)
    #expect(LivingMarkPose.rest.cover == LivingMarkOutline(reading: LivingMarkData.cover[0]))
    #expect(LivingMarkPose.rest.hole == LivingMarkOutline(reading: LivingMarkData.hole[0]))
    #expect(LivingMarkPose.rest.shift == 0)
    let begun = LivingMarkPose.at(0)
    #expect(begun.edge == first)
    #expect(abs(begun.shift + 934.5) < 0.001)
    // half a turn on, the edge is the first key's again, begun at its middle: the same curve, so the same box
    let half = LivingMarkPose.at(LivingMarkData.twistPeriod / 2 + 0.000001)
    let drawn = half.edge.path().boundingRect
    let rested = first.path().boundingRect
    #expect(abs(drawn.minX - rested.minX) < 1)
    #expect(abs(drawn.maxX - rested.maxX) < 1)
    #expect(abs(drawn.minY - rested.minY) < 1)
    #expect(abs(drawn.maxY - rested.maxY) < 1)
  }

  @Test("the edge is drawn inside the SVG's box and across nearly all of it; the hole's box stands about both")
  func thePath() {
    let edge = LivingMarkOutline(reading: LivingMarkData.loop[0]).path()
    #expect(!edge.isEmpty)
    let bounds = edge.boundingRect
    #expect(LivingMarkData.viewBox.contains(bounds))
    #expect(bounds.width > 9000)
    #expect(bounds.height > 3000)
    let cover = LivingMarkOutline(reading: LivingMarkData.cover[0]).path().boundingRect
    #expect(bounds.contains(cover))
    // the hole's first part is a box of 10100 by 4600 from 1400, 1400, drawn with `h` and `v`
    let hole = LivingMarkOutline(reading: LivingMarkData.hole[0]).path().boundingRect
    #expect(abs(hole.minX - 1400) < 0.5)
    #expect(abs(hole.minY - 1400) < 0.5)
    #expect(abs(hole.width - 10100) < 0.5)
    #expect(abs(hole.height - 4600) < 0.5)
    #expect(hole.contains(LivingMarkData.viewBox))
  }
}
