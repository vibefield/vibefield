import Foundation

// UM-4 (UM-D16 = E, "Bands") — THE BANDS CIRCLE'S GEOMETRY ON THE PHONE, PURE: the desktop's
// (`packages/field-app/src/usage/bands.ts`: `bandsOf`, `bandsGeometry`, `bandsLabel`, `bandsSay`, `windowOf`), every
// number transcribed, held to the usage bands golden (BandsParityTests, within a hundredth). Every plan of one profile
// (or of every profile, `MeterModel.everyPlan`) on one circle: five hours on the inner band, the week on the outer, a
// model's own week as a hairline outside them at full size, a budget filling both. The detail follows the size: level
// 0 below 38, 1 to 71, 2 to 149, 3 from 150. Drawn AROUND the face (96 across, the hole 34, the band 8), the bands
// take the hole's measure and draw at level 1 with nothing in the middle.
//
// No view and no colour: arcs, lit heads, notches, need threads, marks, the centre and the hot dot are numbers and
// TONES (`BandsPaint`), which `BandsDial` draws in ChromePalette's inks (DESIGN.md §8 "The Bands circle": "Its paints
// are tones, never literals"). Angles are degrees, 0 at three o'clock and -90 at the top, clockwise; lengths are points
// in a box `size` square.

/// A tone, never a colour: the ink at a share, the hot fill at a share, white at a share (a hot fill's lit head), or
/// the attention ink of words and marks.
enum BandsPaint: Equatable, Sendable {
  case ink(Double)
  case hot(Double)
  case light(Double)
  case attention
}

struct BandsArc: Equatable, Sendable {
  enum Band: String, Sendable { case outer, inner, both, hairline }
  enum Part: String, Sendable { case track, fill, head, thread, breath, empty }
  enum Cap: String, Sendable { case round, butt }

  var band: Band
  var part: Part
  var r: Double
  var from: Double
  var to: Double
  var width: Double
  var cap: Cap
  var paint: BandsPaint
  var opacity: Double
  /// a dash and its gap, along the arc
  var dash: [Double]? = nil
}

/// The time gone, across a window's band.
struct BandsNotch: Equatable, Sendable {
  let x1: Double
  let y1: Double
  let x2: Double
  let y2: Double
  let width: Double
  let paint: BandsPaint
  let opacity: Double
}

/// A plan's agent mark (levels 2 and 3, outside the bands; and the centre's).
struct BandsMark: Equatable, Sendable {
  struct Badge: Equatable, Sendable {
    let need: MeterNeed
    let x: Double
    let y: Double
    let r: Double
  }

  struct Glyph: Equatable, Sendable {
    let x: Double
    let y: Double
    let size: Double
    let paint: BandsPaint
    let profile: MeterProfile
  }

  let provider: String
  let x: Double
  let y: Double
  let size: Double
  let paint: BandsPaint
  let opacity: Double
  /// what the plan needs, on a disc at its upper right (a sign-in under way wears none)
  var badge: Badge? = nil
  /// UM-D12 — an agent with more than one plan in view wears its profile's glyph under its mark
  var glyph: Glyph? = nil
}

/// One plan's segment: what it draws, and where a touch finds it.
struct BandsPlan: Equatable, Sendable {
  struct Hit: Equatable, Sendable {
    let r: Double
    let width: Double
    let from: Double
    let to: Double
  }

  let key: String
  let from: Double
  let span: Double
  /// another plan is focused
  let dim: Bool
  var arcs: [BandsArc] = []
  var notches: [BandsNotch] = []
  var mark: BandsMark? = nil
  var hit: Hit? = nil
  /// the plan in words, for VoiceOver
  let words: String
}

/// What the middle holds.
enum BandsCentreItem: Equatable, Sendable {
  case glyph(x: Double, y: Double, size: Double, paint: BandsPaint)
  case mark(BandsMark)
  case text(BandsText)
}

struct BandsText: Equatable, Sendable {
  enum Role: String, Sendable { case figure, ellipsis, bang, act, sub, say }
  enum Font: String, Sendable { case display, sans }

  let role: Role
  let text: String
  /// its middle across, and its baseline
  let x: Double
  let y: Double
  let size: Double
  let font: Font
  let weight: Double
  let paint: BandsPaint
  /// a "%" after the figure at half its size
  let percent: Bool
}

struct BandsGeometry: Equatable, Sendable {
  struct Centre: Equatable, Sendable {
    let x: Double
    let y: Double
    let r: Double
    let items: [BandsCentreItem]
  }

  struct Empty: Equatable, Sendable {
    let r: Double
    let width: Double
    let paint: BandsPaint
    let dash: [Double]
  }

  struct HotDot: Equatable, Sendable {
    let x: Double
    let y: Double
    let r: Double
    let ring: Double
  }

  let size: Double
  let level: Int
  let centre: Centre
  let plans: [BandsPlan]
  /// nothing meters and nothing needs you, or the usage cannot be read: one dashed ring
  var empty: Empty? = nil
  /// some plan runs hot: a dot at -45°, ringed in the circle's ground
  var hotDot: HotDot? = nil
  /// "Usage: …", "‹profile›: usage unavailable", "Usage unavailable" or "No meters"
  let label: String
}

struct BandsOptions: Equatable, Sendable {
  enum Centre: String, Sendable { case plan, glyph, none }

  /// what the middle shows: the deciding plan, the profile's glyph, or nothing (the Me menu's row)
  var centre: Centre = .plan
  /// the hot dot (a profile's circle at a small size)
  var hotDot = false
  /// the plan a touch is on (its key): the others dim, and the middle speaks for it
  var focus: String? = nil
  /// each plan answers a touch: its hit arc
  var hit = false
  /// several profiles in view: an agent with more than one entry wears its profile's glyph (UM-D12)
  var crowd = false
  /// drawn around something round already there (the face): the hole's radius and the band's depth
  var around: (hole: Double, band: Double)? = nil
  /// the circle stands for every profile at once (`everyPlan`)
  var every = false

  static func == (a: BandsOptions, b: BandsOptions) -> Bool {
    a.centre == b.centre && a.hotDot == b.hotDot && a.focus == b.focus && a.hit == b.hit && a.crowd == b.crowd
      && a.around?.hole == b.around?.hole && a.around?.band == b.around?.band && a.every == b.every
  }
}

/// A plan's bands: the inner its first window of five hours or less; the outer its most pressed longer window that
/// meters the whole plan; the hairline a window that meters part of it; a budget fills both.
struct PlanBands: Equatable, Sendable {
  var short: MeterWindow?
  var long: MeterWindow?
  var group: MeterWindow?
  var budget: MeterWindow?
}

enum BandsLayout {
  /// The inner band's reach: a window of five hours or less.
  static let shortWindowMinutes = 300

  static func levelOf(_ size: Double) -> Int { size >= 150 ? 3 : size >= 72 ? 2 : size >= 38 ? 1 : 0 }

  static func bandsOf(_ entry: PlanMeter) -> PlanBands {
    guard let reading = entry.reading else { return PlanBands() }
    var bands = PlanBands()
    bands.short = reading.windows.first { window in
      guard let minutes = window.metric.durationMinutes else { return false }
      return !window.budget && minutes <= shortWindowMinutes
    }
    for window in reading.windows {
      guard let minutes = window.metric.durationMinutes, !window.budget, minutes > shortWindowMinutes,
        window.line.group == nil
      else { continue }
      // the most pressed, one still running before one read before its reset (bands.ts' `bandsOf`)
      if let long = bands.long, !MeterRules.outranks(window, long) { continue }
      bands.long = window
    }
    bands.group = reading.windows.first { $0.line.group != nil }
    bands.budget = reading.windows.first { $0.budget }
    return bands
  }

  // MARK: - The plans' words

  /// "of 7 days", "of 5 hours", "of 7 days · Fable", "of credits".
  static func windowOf(_ window: MeterWindow) -> String {
    if window.budget { return "of credits" }
    let part = window.line.group.map { group in
      group.label.hasSuffix(" only") ? String(group.label.dropLast(" only".count)) : group.label
    }
    return "of \(window.lengthWords)\(part.map { " · \($0)" } ?? "")"
  }

  /// What the middle says under a plan at full size, and the end of its words.
  static func say(_ entry: PlanMeter) -> (words: String, hot: Bool) {
    switch entry.state {
    case .firstRead:
      return ("reading…", false)
    case .needsYou(let need):
      switch need {
      case .signIn: return ("sign in", false)
      case .signingIn: return ("signing in…", false)
      case .retry: return ("couldn't read", false)
      }
    case .noMeter:
      return ("", false)
    case .reading(let reading):
      let window = reading.tightest
      // a kept reading's age, and so a reading's with a window read before its reset (bands.ts' `bandsSay`)
      if let right = entry.right, right.kind == .kept || right.kind == .passed { return (right.words, false) }
      if let forecast = window.forecast { return (forecast.short, true) }
      guard let reset = window.line.reset, window.resetForm == .length else { return ("", window.line.hot) }
      return ("resets in \(reset)", window.line.hot)
    }
  }

  /// A plan in words: "Claude Max: 64% of 5 hours, out in ~35m"; "Kimi Code: not signed in"; "Codex: signing in".
  static func planWords(_ entry: PlanMeter) -> String {
    switch entry.state {
    case .needsYou(let need):
      return need == .signingIn ? "\(entry.title): signing in" : "\(entry.title): \(entry.right?.words ?? "")"
    case .firstRead:
      return "\(entry.title): reading"
    case .noMeter:
      return entry.title
    case .reading(let reading):
      let said = say(entry).words
      return "\(entry.title): \(wholeWords(reading.tightest.line.usedPercent))% \(windowOf(reading.tightest))"
        + (said.isEmpty ? "" : ", \(said)")
    }
  }

  /// The circle in words: "Usage: " and each plan on it; while the usage cannot be read, "‹profile›: usage
  /// unavailable", or "Usage unavailable" for every profile's circle; else "No meters".
  static func circleWords(_ entries: [PlanMeter], every: Bool) -> String {
    let onCircle = entries.filter { $0.kind != .noMeter }
    if !onCircle.isEmpty { return "Usage: " + onCircle.map(planWords).joined(separator: "; ") }
    guard let unread = entries.first(where: { $0.why == .unavailable }) else { return "No meters" }
    guard !every, let profile = unread.profiles.first else { return "Usage unavailable" }
    return "\(profile.label): usage unavailable"
  }

  // MARK: - The geometry

  private static let deg = Double.pi / 180
  /// the opacity of a plan another plan's focus dims, and of a kept reading's fill or a window's read before its reset
  private static let dimmed = 0.28
  private static let kept = 0.5
  private static let headSteps: [Double] = [9, 19, 29, 39, 49, 58]
  private static let hotHeadSteps: [Double] = [6, 12, 19, 26, 33, 40]
  private static let hotBody = BandsPaint.hot(88)

  private static func clamp(_ value: Double, _ low: Double, _ high: Double) -> Double { min(high, max(low, value)) }

  static func at(_ c: Double, _ r: Double, _ angle: Double) -> (x: Double, y: Double) {
    (c + r * cos(angle * deg), c + r * sin(angle * deg))
  }

  /// An arc too short to see is not drawn; a whole turn stops just short of closing.
  private static func push(_ arcs: inout [BandsArc], _ arc: BandsArc) {
    let sweep = arc.to - arc.from
    if sweep <= 0.05 { return }
    var drawn = arc
    if sweep > 359.9 { drawn.to = arc.from + 359.9 }
    arcs.append(drawn)
  }

  private struct ArcContext {
    let c: Double
    let level: Int
    let dim: Bool
    let stale: Bool
  }

  /// One window as a meter on an arc — Settings' C1 bent round (the drawing's `meterOnArc`).
  private static func meterOnArc(
    _ plan: inout BandsPlan, _ context: ArcContext, _ band: BandsArc.Band, _ r: Double, _ width: Double,
    _ window: MeterWindow?, need: MeterNeed? = nil, firstRead: Bool = false, notch: Bool = true
  ) {
    let c = context.c
    let level = context.level
    let round = level <= 1
    let capDeg = round ? min(plan.span / 2.2, width / 2 / r / deg) : 0
    let cap: BandsArc.Cap = round ? .round : .butt
    let v0 = plan.from + capDeg
    let length = max(0.2, plan.span - 2 * capDeg)
    let dim = context.dim ? dimmed : 1
    if let need {
      let thread = max(1.15, width * 0.24)
      let inset = thread / 2 / r / deg
      push(
        &plan.arcs,
        BandsArc(
          band: band, part: .thread, r: r, from: plan.from + inset, to: plan.from + plan.span - inset, width: thread,
          cap: .round, paint: .ink(need == .retry ? 38 : 46), opacity: dim, dash: [0.01, max(2.5, thread * 2.6)]))
      return
    }
    if firstRead {
      // the breath owns its opacity
      push(
        &plan.arcs,
        BandsArc(
          band: band, part: .breath, r: r, from: v0, to: v0 + length, width: width, cap: cap, paint: .ink(16),
          opacity: 1))
      return
    }
    push(
      &plan.arcs,
      BandsArc(
        band: band, part: .track, r: r, from: v0, to: v0 + length, width: width, cap: cap,
        paint: .ink(level >= 2 ? 8 : 12), opacity: dim))
    guard let window else { return }
    let used = clamp(window.line.usedPercent, 0, 100)
    let hot = window.line.hot
    let fill = length * used / 100
    // a kept reading's fill, and a window's read before its reset (DESIGN.md §8 "A window read before its reset"), at
    // half; the track untouched
    let fade = dim * (context.stale || window.passed ? kept : 1)
    if used > 0.4 {
      if round {
        push(
          &plan.arcs,
          BandsArc(
            band: band, part: .fill, r: r, from: v0, to: v0 + max(0.3, fill), width: width, cap: .round,
            paint: hot ? hotBody : .ink(64), opacity: fade))
      } else {
        push(
          &plan.arcs,
          BandsArc(
            band: band, part: .fill, r: r, from: v0, to: v0 + fill, width: width, cap: .butt,
            paint: hot ? hotBody : .ink(28), opacity: fade))
        // Settings' lit head: the fill's last 12 brighten in six steps, as C1's gradient does
        let head = min(fill * 0.7, 12 / r / deg)
        let steps = hot ? hotHeadSteps : headSteps
        for (k, step) in steps.enumerated() {
          let start = v0 + fill - head + head * Double(k) / 6
          let end = v0 + fill - head + head * Double(k + 1) / 6
          push(
            &plan.arcs,
            BandsArc(
              band: band, part: .head, r: r, from: start, to: end + (k < steps.count - 1 ? 0.1 : 0), width: width,
              cap: .butt, paint: hot ? .light(step) : .ink(step), opacity: fade))
        }
      }
    }
    if level >= 1, notch, let elapsed = window.line.elapsedPercent {
      let angle = plan.from + 2 * capDeg + length * clamp(elapsed, 0, 100) / 100
      let reach = level >= 3 ? 3 : level == 2 ? 2.2 : 1.5
      let inner = at(c, r - width / 2 - reach, angle)
      let outer = at(c, r + width / 2 + reach, angle)
      plan.notches.append(
        BandsNotch(
          x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, width: level >= 3 ? 2 : level == 2 ? 1.6 : 1.25,
          paint: .ink(84), opacity: dim))
    }
  }

  /// The plan that decides the middle: the most pressed reading (its tightest by `MeterRules.outranks`, so a plan whose
  /// tightest was read before its reset gives way to one still running), else the first read, else what needs you.
  private static func deciding(_ onCircle: [PlanMeter]) -> PlanMeter? {
    var best: PlanMeter?
    for entry in onCircle {
      guard let reading = entry.reading else { continue }
      if let held = best?.reading, !MeterRules.outranks(reading.tightest, held.tightest) { continue }
      best = entry
    }
    return best ?? onCircle.first { $0.kind == .firstRead } ?? onCircle.first { $0.kind == .needsYou }
      ?? onCircle.first
  }

  private static func mark(
    _ entry: PlanMeter, _ x: Double, _ y: Double, _ size: Double, dim: Bool, badge: Bool = false,
    glyph: MeterProfile? = nil
  ) -> BandsMark {
    var mark = BandsMark(
      provider: entry.provider, x: x, y: y, size: size,
      paint: entry.kind == .needsYou ? .ink(46) : entry.hot ? .attention : .ink(84), opacity: dim ? dimmed : 1)
    if badge, let need = entry.need, need != .signingIn {
      mark.badge = BandsMark.Badge(need: need, x: x + size * 0.52, y: y - size * 0.46, r: max(4.2, size * 0.3))
    }
    if let glyph {
      mark.glyph = BandsMark.Glyph(x: x, y: y + size * 0.87, size: size * 0.64, paint: .ink(60), profile: glyph)
    }
    return mark
  }

  private static func text(
    _ role: BandsText.Role, _ words: String, _ x: Double, _ y: Double, _ size: Double, _ font: BandsText.Font,
    _ weight: Double, _ paint: BandsPaint, percent: Bool = false
  ) -> BandsCentreItem {
    .text(
      BandsText(
        role: role, text: words, x: x, y: y, size: size, font: font, weight: weight, paint: paint, percent: percent))
  }

  /// The middle (the drawing's `centreSvg`).
  private static func centre(
    _ c: Double, _ r: Double, _ level: Int, _ onCircle: [PlanMeter], _ options: BandsOptions
  ) -> [BandsCentreItem] {
    if options.centre == .none || r < 6.5 { return [] }
    let focused = options.focus.flatMap { focus in onCircle.first { $0.key == focus } }
    if options.centre == .glyph, focused == nil {
      if level <= 1 || r < 16 { return [.glyph(x: c, y: c, size: min(r * 1.18, 20), paint: .ink(86))] }
      let size = min(r * 0.62, 24)
      var items: [BandsCentreItem] = [.glyph(x: c, y: c - size * 0.42, size: size, paint: .ink(86))]
      if let top = deciding(onCircle), let reading = top.reading {
        items.append(
          text(
            .figure, "\(wholeWords(reading.tightest.line.usedPercent))%", c, c + size * 0.62 + 2, min(r * 0.42, 13),
            .display, 800, onCircle.contains { $0.hot } ? .attention : .ink(70)))
      }
      return items
    }
    guard let plan = focused ?? deciding(onCircle) else { return [] }
    let figurePaint: BandsPaint = plan.hot ? .attention : .ink(90)
    let used = plan.reading.map { wholeWords($0.tightest.line.usedPercent) }
    let act = plan.need.map { $0 == .signIn ? "Sign in" : "Retry" } ?? ""
    if level <= 1 || r < 15 {
      if plan.waiting { return [text(.ellipsis, "…", c, c + r * 0.32, min(r, 14), .display, 800, .ink(50))] }
      guard let used else { return [text(.bang, "!", c, c + r * 0.36, min(r, 13), .display, 800, .ink(60))] }
      let size = min(r * 0.98, 15)
      return [text(.figure, used, c, c + size * 0.36, size, .display, 800, figurePaint)]
    }
    if level == 2 || r < 46 {
      let markSize = min(r * 0.6, 19)
      let size = min(r * 0.62, 26)
      let top = c - (markSize + 3 + size * 0.72) / 2
      var items: [BandsCentreItem] = [.mark(mark(plan, c, top + markSize / 2, markSize, dim: false))]
      let baseline = top + markSize + 3
      if plan.waiting {
        items.append(text(.ellipsis, "…", c, baseline + size * 0.72, size, .display, 800, .ink(50)))
      } else if let used {
        items.append(text(.figure, used, c, baseline + size * 0.72, size, .display, 800, figurePaint, percent: true))
      } else {
        items.append(text(.act, act, c, baseline + size * 0.6, size * 0.56, .sans, 700, .ink(70)))
      }
      return items
    }
    let markSize = clamp(r * 0.3, 13, 21)
    let size = clamp(r * 0.48, 20, 38)
    let small = clamp(r * 0.17, 9.5, 11.5)
    let top = c - (markSize + 6 + size * 0.72 + 7 + small + 4 + small) / 2
    var items: [BandsCentreItem] = [.mark(mark(plan, c, top + markSize / 2, markSize, dim: false, badge: true))]
    let figure = top + markSize + 6 + size * 0.72
    if plan.waiting {
      items.append(text(.ellipsis, "…", c, figure, size, .display, 800, .ink(46)))
    } else if let used {
      items.append(text(.figure, used, c, figure, size, .display, 800, figurePaint, percent: true))
    } else {
      items.append(text(.act, act, c, figure - size * 0.12, size * 0.5, .display, 750, .ink(86)))
    }
    let sub: String =
      plan.reading.map { windowOf($0.tightest) } ?? (plan.kind == .needsYou ? plan.agent : plan.title)
    let subline = figure + 7 + small * 0.8
    items.append(text(.sub, sub, c, subline, small, .sans, 500, .ink(62)))
    let said = say(plan)
    if plan.kind == .reading, !said.words.isEmpty {
      items.append(
        text(
          .say, said.words, c, subline + 4 + small, small, .sans, said.hot ? 650 : 500,
          said.hot ? .attention : .ink(62)))
    }
    return items
  }

  /// A circle's rings at a size (the drawing's `drawBands` measures).
  private struct Rings {
    let draw: Int
    let markSize: Double
    let markZone: Double
    let band: Double
    let gap: Double
    let hairline: Double
    let rim: Double
    let rOuter: Double
    let rInner: Double
    let rBoth: Double
    let gapDeg: Double
    let hole: Double
  }

  private static func rings(_ size: Double, _ level: Int, _ count: Int, _ options: BandsOptions) -> Rings {
    let around = options.around
    let draw = around != nil ? 1 : level
    let markSize: Double = draw >= 3 ? 16 : 10.5
    let markZone: Double = around != nil ? 0 : draw >= 3 ? markSize + 9 : draw == 2 ? markSize + 5 : 0
    let band: Double =
      around.map { max(2.2, ($0.band - 1.2) / 2) }
      ?? (draw >= 3
        ? clamp(size * 0.046, 8, 11) : draw == 2 ? clamp(size * 0.052, 4, 5.6) : clamp(size * 0.066, 2.6, 3.4))
    let gap: Double = around != nil ? 1.2 : draw >= 3 ? 2.6 : draw == 2 ? 1.6 : 1.1
    let hairline: Double = around == nil && draw >= 3 ? 3 : 0
    let rim: Double =
      around.map { $0.hole + $0.band }
      ?? size / 2 - markZone - (hairline > 0 ? hairline + 3.5 : 0) - (draw >= 1 ? 0.8 : 0.5)
    let rInner = rim - band - gap - band / 2
    let gapPoints = count > 1 ? clamp(size * 0.032, 2.8, 8) : 0
    return Rings(
      draw: draw, markSize: markSize, markZone: markZone, band: band, gap: gap, hairline: hairline, rim: rim,
      rOuter: rim - band / 2, rInner: rInner, rBoth: rim - band - gap / 2, gapDeg: gapPoints / rInner / deg,
      hole: around?.hole ?? rInner - band / 2 - (draw >= 3 ? 7 : draw == 2 ? 5 : 2.5))
  }

  /// UM-D12 — the agents with more than one entry in view, a plan with no meter counted.
  private static func crowded(_ entries: [PlanMeter]) -> Set<String> {
    var seen = Set<String>()
    var crowded = Set<String>()
    for entry in entries {
      if seen.contains(entry.provider) { crowded.insert(entry.provider) }
      seen.insert(entry.provider)
    }
    return crowded
  }

  /// One profile's Bands circle at a size, or every profile's: its plans' segments in the entries' order (a plan with
  /// no meter is left off; with none left, the dashed ring, the profile's glyph kept in its middle), the centre, the
  /// hot dot, and the words.
  static func geometry(_ size: Double, _ entries: [PlanMeter], _ options: BandsOptions = BandsOptions()) -> BandsGeometry
  {
    // RED STUB (UM-4 PH-2): no plan, no centre, no words
    return BandsGeometry(size: size, level: -1, centre: .init(x: 0, y: 0, r: 0, items: []), plans: [], label: "")
    let sized = levelOf(size)
    let level = options.around != nil ? min(2, sized) : sized
    let c = size / 2
    let onCircle = entries.filter { $0.kind != .noMeter }
    let label = circleWords(entries, every: options.every)
    let ring = rings(size, level, onCircle.isEmpty ? 1 : onCircle.count, options)
    if onCircle.isEmpty {
      // the glyph stays where one plan's circle puts it, so it does not jump as the meters come and go
      let items: [BandsCentreItem] =
        options.centre == .glyph && options.around == nil && ring.hole >= 6.5
        ? [.glyph(x: c, y: c, size: min(ring.hole * 1.18, 20), paint: .ink(86))] : []
      return BandsGeometry(
        size: size, level: level, centre: .init(x: c, y: c, r: ring.hole, items: items), plans: [],
        empty: .init(r: size / 2 - 3, width: 1.2, paint: .ink(14), dash: [2, 3]), label: label)
    }
    let count = Double(onCircle.count)
    let span = (360 - count * ring.gapDeg) / count
    let crowd = options.crowd ? crowded(entries) : []
    let plans = onCircle.enumerated().map { index, entry -> BandsPlan in
      let from = -90 + ring.gapDeg / 2 + Double(index) * (span + ring.gapDeg)
      let dim = options.focus != nil && options.focus != entry.key
      var plan = BandsPlan(key: entry.key, from: from, span: span, dim: dim, words: planWords(entry))
      let context = ArcContext(c: c, level: ring.draw, dim: dim, stale: entry.reading?.stale ?? false)
      let both = ring.band * 2 + ring.gap
      switch entry.state {
      case .needsYou(let need):
        meterOnArc(&plan, context, .both, ring.rBoth, both, nil, need: need)
      case .firstRead:
        meterOnArc(&plan, context, .both, ring.rBoth, both, nil, firstRead: true)
      case .reading, .noMeter:
        let bands = bandsOf(entry)
        if let budget = bands.budget {
          meterOnArc(&plan, context, .both, ring.rBoth, both, budget)
        } else {
          for (which, r, window) in [(BandsArc.Band.outer, ring.rOuter, bands.long), (.inner, ring.rInner, bands.short)]
          {
            if let window {
              meterOnArc(&plan, context, which, r, ring.band, window)
            } else {
              push(
                &plan.arcs,
                BandsArc(
                  band: which, part: .empty, r: r, from: from + 1, to: from + span - 1, width: ring.band, cap: .butt,
                  paint: .ink(5), opacity: dim ? dimmed : 1))
            }
          }
          if ring.hairline > 0, let group = bands.group {
            meterOnArc(
              &plan, ArcContext(c: c, level: 1, dim: dim, stale: context.stale), .hairline,
              ring.rim + 3.5 + ring.hairline / 2, ring.hairline, group, notch: false)
          }
        }
      }
      if ring.markZone > 0 {
        let spot = at(
          c, ring.rim + (ring.hairline > 0 ? ring.hairline + 3.5 : 0) + 4.5 + ring.markSize / 2, from + span / 2)
        let profile = crowd.contains(entry.provider) ? entry.profiles.first : nil
        plan.mark = mark(entry, spot.x, spot.y, ring.markSize, dim: dim, badge: ring.draw >= 3, glyph: profile)
      }
      if options.hit {
        plan.hit = BandsPlan.Hit(
          r: (ring.rInner + ring.rim + ring.markZone) / 2,
          width: ring.rim + ring.markZone - ring.rInner + ring.band + 8, from: from, to: from + span)
      }
      return plan
    }
    var geometry = BandsGeometry(
      size: size, level: level,
      centre: .init(
        x: c, y: c, r: ring.hole,
        items: options.around != nil ? [] : centre(c, ring.hole, ring.draw, onCircle, options)),
      plans: plans, label: label)
    if options.hotDot, onCircle.contains(where: { $0.hot }) {
      let spot = at(c, size / 2 - 3, -45)
      geometry.hotDot = .init(x: spot.x, y: spot.y, r: max(3.6, size * 0.085), ring: 1.6)
    }
    return geometry
  }
}
