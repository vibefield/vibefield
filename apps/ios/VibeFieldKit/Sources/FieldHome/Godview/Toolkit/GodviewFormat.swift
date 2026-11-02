import Foundation

// PG-4s — THE NUMBERS THE VIEWS PRINT, transcribed from puppeteer-view-sdk 0.3.2 at the pin `95a70aa7`,
// `src/toolkit/format.ts` (`5abe8f75`): `pad2` :15, `formatShort` :66, `formatWords` :76, `formatClock` :89,
// `formatPercent` :110. Namespaced: FieldAgents exports `formatUsd`, `formatTokens` and `formatElapsed(since:now:)` at
// file scope (CostFormat.swift, SwarmBodyModel.swift), and none of these may collide with or be picked for them.
// SDK `formatElapsed(ms)` is the timeline's own (a different contract from FieldAgents'), and `formatRatePerHour` /
// `formatTokens` have no caller among the four views (the design's §0.1).
//
// The inputs are `Double` ms, as JavaScript's arithmetic is. Every word is held to `phone-toolkit.golden.json`.

enum GodviewFormat {
  /// `formatShort`: a length, compact — `45s`, `11m`, `2h 14m`, `2h`.
  static func formatShort(ms: Double) -> String {
    // PG-4s (red)
    ""
  }

  /// `formatWords`: a length as a screen reader says it — `under a minute`, `1 hour 4 minutes`.
  static func formatWords(ms: Double) -> String {
    // PG-4s (red)
    ""
  }

  /// `formatClock`: the wall clock in `timeZone` (the phone passes `.current`, as JavaScript reads the local zone) —
  /// `14:05`, or `14:05:09`.
  static func formatClock(ms: Double, withSeconds: Bool = false, timeZone: TimeZone) -> String {
    // PG-4s (red)
    ""
  }

  /// `formatPercent`: a share floored — `42%`; `missing` when unknown.
  static func formatPercent(_ value: Double?, missing: String = "—") -> String {
    // PG-4s (red)
    ""
  }
}
