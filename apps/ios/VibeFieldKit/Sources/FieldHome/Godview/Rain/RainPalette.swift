import FieldProduct
import Foundation

// PG-8 — THE RAIN'S PALETTE, the Swift twins of DESIGN.md §2.7 "The rain's palette" (C0 `f4c75022d`): the values the
// desktop's host hands its rain, `readMonitorPalette()`'s `rain` (puppeteer-views 0.3.3 `monitor/palette.js:86-112`
// at the pin `52d09c8e`; views `e79fc53d`, SDK words `e79fc53d`, state-words and motion `5abe8f75`), kept in the
// reader's own spelling — a head as `#rrggbb`, a tail as the `"r, g, b"` a canvas `rgba()` takes (`hexToRgb255`) — so
// `phone-rain.golden.json`'s `palette` and `tokens` hold them string for string. And `statusPresentation`
// (`views/rain/RainView.tsx:66-74`, dist `RainView.js:29-35`): a status's head, tail and the speed the view gives it.
//
// The rain paints the dark material in BOTH themes, so nothing here is keyed per mode. The phone's lit stream (J-S4,
// James 2026-11-04; VF-PM 01:40Z) heads in the DARK palette's text main, `--vf-godview-dark-text-main` (`litHead`),
// never `#111111`: by day that would be black on black.

struct RainPalette: Equatable, Sendable {
  /// A status's stream: its head's colour, its tail's channels.
  struct Stream: Equatable, Sendable {
    let head: String
    let tailRgb: String
  }

  /// `statusPresentation`'s entry: a head, a tail and, for blocked and idle, their own fall in rows per frame.
  struct Presentation: Equatable, Sendable {
    let head: String
    let tail: String
    let speed: Double?
  }

  /// `rain.stage` — `--vf-card-deep`.
  let stage: String
  /// `rain.activeHead` — `--vf-godview-rain-working-head`: the desktop's lit (and hovered) head.
  let activeHead: String
  /// `rain.hoverTailRgb` — `--vf-godview-rain-hover-tail`: the desktop's hovered tail.
  let hoverTailRgb: String
  /// `rain.status.*` — the heads and tails by status.
  let working: Stream
  let blocked: Stream
  let idle: Stream
  /// `rain.ink.*` — the rain's own words over its stage, by status.
  let inkWorking: String
  let inkBlocked: String
  let inkIdle: String
  /// `rain.focus` — a focused control's ring.
  let focus: String
  /// `text.primary` — the reader's white ramp at 1 (the desktop tooltip's name).
  let textPrimary: String
  /// The phone's lit stream's head (J-S4): `--vf-godview-dark-text-main`.
  let litHead: String
  /// The empty stage's words (rain.css:183): `--vf-godview-rain-green` at this opacity.
  let emptyInkOpacity: Double

  /// DESIGN.md §2.7's table, as `tokens.css` declares it.
  static let rain = RainPalette(
    stage: "#000000",
    activeHead: "#ffffff",
    hoverTailRgb: "217, 70, 239",
    working: Stream(head: "#ffffff", tailRgb: "0, 255, 0"),
    blocked: Stream(head: "#fef08a", tailRgb: "234, 179, 8"),
    idle: Stream(head: "#94a3b8", tailRgb: "71, 85, 105"),
    inkWorking: "#4ade80",
    inkBlocked: "#fde047",
    inkIdle: "#cbd5e1",
    focus: "#22c55e",
    textPrimary: "rgba(255,255,255,1)",
    litHead: "#ffffff",
    emptyInkOpacity: 0.65)

  /// `statusPresentation` (RainView.tsx:66-74): blocked crawls (stuck, and impossible to miss where everything else
  /// moves), idle drifts, working runs at its own drop's speed.
  func presentation(_ status: MonitorRowStatus) -> Presentation {
    switch status {
    case .working: Presentation(head: working.head, tail: working.tailRgb, speed: nil)
    case .blocked: Presentation(head: blocked.head, tail: blocked.tailRgb, speed: 0.02)
    case .idle: Presentation(head: idle.head, tail: idle.tailRgb, speed: 0.1)
    }
  }
}
