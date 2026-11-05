import Foundation

/// mulberry32, transcribed in UInt32's wrapping arithmetic: `| 0`, `>>> 0`, `Math.imul` and `^` agree with it bit for
/// bit, because JavaScript's 32-bit operators read a signed and an unsigned word alike. The desktop's generator for the
/// spark face (`packages/design-kit/src/spark-face/vendor/sparks.js:7`) and for the Godview rain's goldens
/// (`phone-goldens-rain.ts`). IOS-12b moved it here from FieldHome's rain (PG-8), so the spark face and the rain deal
/// from one transcription; the rain keeps its `RainRandom` conformance and its launch flag in FieldHome.
public struct Mulberry32: Equatable, Sendable {
  public private(set) var state: UInt32

  public init(seed: UInt32) { state = seed }

  public mutating func next() -> Double {
    state &+= 0x6d2b_79f5
    var t = (state ^ (state >> 15)) &* (1 | state)
    t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
    return Double(t ^ (t >> 14)) / 4_294_967_296
  }
}
