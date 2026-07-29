/// SplitMix64 — a tiny, high-quality, seedable generator. The field uses
/// randomness only decoratively (spawn phase, tap nudges), but seeding it
/// makes the whole simulation reproducible in tests.
public struct SplitMix64: RandomNumberGenerator, Sendable {
  private var state: UInt64

  public init(seed: UInt64) {
    state = seed
  }

  public mutating func next() -> UInt64 {
    state &+= 0x9E37_79B9_7F4A_7C15
    var z = state
    z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
    z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
    return z ^ (z >> 31)
  }
}

/// Concrete box over any generator, so `SwarmWorld` can hold one stored
/// generator without existential-opening at every `random(using:)` call site.
public struct AnyRandomSource: RandomNumberGenerator {
  private var nextValue: () -> UInt64

  public init(_ base: some RandomNumberGenerator) {
    var generator = base
    nextValue = { generator.next() }
  }

  public mutating func next() -> UInt64 { nextValue() }
}
