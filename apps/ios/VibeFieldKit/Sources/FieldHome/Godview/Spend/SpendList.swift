import Foundation

// PG-7 (red skeleton) — spend's watchlist order and fit. The transcription lands in the green.

enum SpendList {
  struct Entry: Equatable, Sendable {
    let id: String
    let value: Double
    let bornMs: Double
  }

  enum ScrubOrder: String, Sendable { case hold, sink, rank }

  struct Scrub {
    let t: Double
    let order: ScrubOrder
    let valueAt: (String) -> Double?
  }

  struct Fit: Equatable, Sendable {
    let fits: Int
    let offset: Int
    let maxOffset: Int
    let docked: [String]
    let more: Bool
    let below: Int
    let above: Int
    let waitingUnshown: Int
  }

  static func bySpend(_ entries: [Entry]) -> [String] { [] }
  static func listOrder(_ entries: [Entry], held: [String]? = nil, scrub: Scrub? = nil) -> [String] { [] }
  static func fitList(
    _ order: [String], cap: Int, offset: Int, waiting: [String: Double], dock: Bool = true
  ) -> Fit {
    Fit(fits: 0, offset: 0, maxOffset: 0, docked: [], more: false, below: 0, above: 0, waitingUnshown: 0)
  }
  static func moreWords(_ fit: Fit) -> String { "" }
}
