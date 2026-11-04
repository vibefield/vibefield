import Foundation

// PG-7 — THE WATCHLIST BESIDE THE CHART (design B): its order and what fits, transcribed from puppeteer-views 0.3.3
// at the pin `52d09c8e` (the spend module `5abe8f75`): `src/views/spend/spend-list.ts` :18-135 (dist `spend-list.js`
// :8-92). Rows run most spent first and hold still while the pointer is on the list (SV-D12); while you point back in
// time the list holds now's order (SV-D16, 'sink' and 'rank' kept as options); with more rows than fit, the list
// scrolls by whole rows and the waiting rows the scroll leaves out dock at its foot (SV-D19). JavaScript's sorts are
// stable, so every sort here breaks a tie by the input's place. Held to `phone-spend.golden.json` (SpendParityTests
// P4a, V4).

enum SpendList {
  /// `OrderEntry`: a row's id, its value (its total, or what it read at a moment) and its birth.
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

  /// `ListFit`.
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

  /// Array.prototype.sort with a numeric comparator: stable, a zero (or NaN) keeping the input's order.
  static func stableSorted<T>(_ items: [T], by compare: (T, T) -> Double) -> [T] {
    items.enumerated()
      .sorted { left, right in
        let order = compare(left.element, right.element)
        return order < 0 || (!(order > 0) && left.offset < right.offset)
      }
      .map(\.element)
  }

  /// `a || b` over two numbers: the first unless it is 0 or NaN.
  static func or(_ first: Double, _ second: Double) -> Double { first != 0 && !first.isNaN ? first : second }

  /// `bySpend` (:18): most spent first; equal spend, the elder first.
  static func bySpend(_ entries: [Entry]) -> [String] {
    stableSorted(entries) { a, b in or(b.value - a.value, a.bornMs - b.bornMs) }.map(\.id)
  }

  /// `listOrder` (:28): the order the list shows. `held` is the order it showed while the pointer rests on it;
  /// otherwise most spent at the head. While scrubbing at `t`, 'hold' keeps that order, 'sink' sends the rows not yet
  /// started below the rest (by start), 'rank' re-ranks by `valueAt(t)`.
  static func listOrder(_ entries: [Entry], held: [String]? = nil, scrub: Scrub? = nil) -> [String] {
    let order = bySpend(entries)
    if let held {
      var index: [String: Double] = [:]
      for (place, id) in held.enumerated() { index[id] = Double(place) }
      return stableSorted(order) { a, b in (index[a] ?? 1e9) - (index[b] ?? 1e9) }
    }
    guard let scrub, scrub.order != .hold else { return order }
    var born: [String: Double] = [:]
    for entry in entries { born[entry.id] = entry.bornMs }
    var at: [String: Double] = [:]
    for (place, id) in order.enumerated() { at[id] = Double(place) }
    let started = { (id: String) -> Double in scrub.t >= (born[id] ?? 0) ? 1 : 0 }
    return stableSorted(order) { a, b in
      let s = started(b) - started(a)
      if s != 0 { return s }
      if started(a) == 0 { return (born[a] ?? 0) - (born[b] ?? 0) }
      if scrub.order == .rank {
        let d = (scrub.valueAt(b) ?? 0) - (scrub.valueAt(a) ?? 0)
        if d != 0 && !d.isNaN { return d }
      }
      return (at[a] ?? 0) - (at[b] ?? 0)
    }
  }

  /// `fitList` (:80): what fits in `cap` row slots. With more rows than slots one slot says how many more; waiting
  /// rows the scroll leaves out dock under the sequence, at most ⌊(cap−1)/3⌋ of them, the longest wait first.
  static func fitList(
    _ order: [String], cap: Int, offset: Int, waiting: [String: Double], dock: Bool = true
  ) -> Fit {
    let slots = Swift.max(1, cap)
    let more = order.count > slots
    // the slots the sequence and the dock share: all but the "more" row's
    let shared = more ? slots - 1 : slots
    var fits = shared
    let max = Swift.max(1, (slots - 1) / 3)
    func out(_ count: Int, _ off: Int) -> [String] {
      guard dock && more else { return [] }
      return order.enumerated()
        .filter { ($0.offset < off || $0.offset >= off + count) && waiting[$0.element] != nil }
        .map(\.element)
    }
    func dockOf(_ count: Int, _ off: Int) -> [String] {
      Array(stableSorted(out(count, off)) { a, b in (waiting[a] ?? 0) - (waiting[b] ?? 0) }.prefix(max))
    }
    func offOf(_ count: Int) -> Int { Swift.min(Swift.max(0, offset), Swift.max(0, order.count - count)) }
    var off = offOf(fits)
    var docked = dockOf(fits, off)
    // each docked row takes a slot from the sequence, and a shorter sequence can leave another waiting row out:
    // shorten until the dock fits beside it
    while !docked.isEmpty && fits > 1 && fits + docked.count > shared {
      fits = Swift.max(1, shared - docked.count)
      off = offOf(fits)
      docked = dockOf(fits, off)
    }
    // the smallest lists: what still does not fit beside one row stays out of sight, counted as waiting
    docked = Array(docked.prefix(Swift.max(0, shared - fits)))
    let dockSet = Set(docked)
    let below = order.enumerated().filter { $0.offset >= off + fits && !dockSet.contains($0.element) }.count
    let above = order.enumerated().filter { $0.offset < off && !dockSet.contains($0.element) }.count
    return Fit(
      fits: Swift.min(fits, order.count), offset: off, maxOffset: Swift.max(0, order.count - fits), docked: docked,
      more: more, below: below, above: above, waitingUnshown: out(fits, off).count - docked.count)
  }

  /// `moreWords` (:127): the "more" row's words.
  static func moreWords(_ fit: Fit) -> String {
    if fit.below > 0 { return "\(fit.below) more below\(fit.above > 0 ? ", \(fit.above) above" : "") · scroll" }
    return "\(fit.above) above · scroll back"
  }
}
