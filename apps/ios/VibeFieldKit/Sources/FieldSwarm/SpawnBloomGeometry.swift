import Foundation

// PJ-7 (2026-10-14; SB §2.12, DESIGN.md §8 "Hold, reach, let go") — the spawn
// bloom's geometry and targeting on the phone, TRANSCRIBED from the reference:
// puppeteer's `views/swarm/bloom/{constants,geometry,targeting}.ts` (the module
// DESIGN.md §8 names as the numbers), the same arithmetic in the same order so
// its audited numbers carry over. Held to them by `SpawnBloomGeometryTests`
// over `spawn-bloom-geometry.lane.json`, which `apps/ios/scripts/
// spawn-bloom-goldens.mjs` generates from the pinned checkout. Points, y down;
// angles in degrees, 0 = right, 90 = down. Pure: no UIKit, no clock.

/// The bloom's one table of numbers (puppeteer's `BLOOM`), as it is.
public enum BloomConstants {
  public static let holdMs = 520.0
  public static let holdSlop = 8.0
  public static let hubR = 16.0
  public static let deadR = 22.0
  public static let r1 = 92.0
  public static let bud1 = 48.0
  public static let step1 = 42.0
  public static let r2 = 80.0
  public static let bud2 = 42.0
  public static let step2 = 40.0
  public static let settle = 90.0
  public static let reach = 12.0
  public static let backOut = 34.0
  public static let sectorMax = 26.0
  public static let slack = 64.0
  public static let labelGap = 8.0
  public static let clearBud = 8.0
  public static let clearWord = 4.0
  public static let clearSpoke = 6.0
  public static let inset = 14.0
  public static let hot = 1.16
  public static let pop = 280.0
  public static let stagger = 26.0
  public static let lift = 180.0
  public static let retract = 180.0
  public static let reveal = 140.0
  public static let veil = 0.8
  public static let sayHold = 460.0
}

public struct BloomPoint: Equatable, Sendable {
  public var x: Double
  public var y: Double
  public init(x: Double, y: Double) {
    self.x = x
    self.y = y
  }
}

public struct BloomSize: Equatable, Sendable {
  public var w: Double
  public var h: Double
  public init(w: Double, h: Double) {
    self.w = w
    self.h = h
  }
}

public struct BloomRect: Equatable, Sendable {
  public var x: Double
  public var y: Double
  public var width: Double
  public var height: Double
  public init(x: Double, y: Double, width: Double, height: Double) {
    self.x = x
    self.y = y
    self.width = width
    self.height = height
  }
}

public enum BloomAlign: String, Equatable, Sendable { case left, center, right }

/// A bud's words, placed.
public struct BloomBox: Equatable, Sendable {
  public var x: Double
  public var y: Double
  public var w: Double
  public var h: Double
  public var align: BloomAlign
}

public struct BloomDisc: Equatable, Sendable {
  public var x: Double
  public var y: Double
  public var r: Double
}

public struct BloomSeg: Equatable, Sendable {
  public var a: BloomPoint
  public var b: BloomPoint
}

/// What a label must keep clear of.
public struct BloomRoom: Sendable {
  public var field: BloomSize
  public var rects: [BloomRect] = []
  public var discs: [BloomDisc] = []
  public var segs: [BloomSeg] = []
}

/// A bud's words: its name, and a desktop's state line under it.
public struct BloomLabelText: Equatable, Sendable {
  public var name: String
  public var sub: String?
  public init(name: String, sub: String? = nil) {
    self.name = name
    self.sub = sub
  }
}

/// The two fonts a bud's words are drawn in: the name (9.5 pt mono 700) and
/// the state line (7.5 pt mono 800). Injected, so the geometry never touches
/// a font: the shipping measure is CoreText's, a test's is synthetic.
public enum BloomFont: Sendable { case label, sub }
public typealias BloomMeasure = @Sendable (String, BloomFont) -> Double

public struct BloomSeat: Equatable, Sendable {
  public var box: BloomBox
  public var cost: Double
  public var short: Bool
}

public enum BloomGeometry {
  static func rad(_ deg: Double) -> Double { deg * .pi / 180 }

  public static func polar(_ cx: Double, _ cy: Double, _ r: Double, _ deg: Double) -> BloomPoint {
    BloomPoint(x: cx + r * cos(rad(deg)), y: cy + r * sin(rad(deg)))
  }

  /// The direction of (dx, dy), in degrees (−180..180].
  public static func angleOf(_ dx: Double, _ dy: Double) -> Double { atan2(dy, dx) * 180 / .pi }

  /// The unsigned difference of two directions, 0..180 (JavaScript's `%`, which
  /// keeps the dividend's sign, is `truncatingRemainder`).
  public static func angDiff(_ a: Double, _ b: Double) -> Double {
    abs((((a - b).truncatingRemainder(dividingBy: 360) + 540).truncatingRemainder(dividingBy: 360)) - 180)
  }

  public static func labelSize(_ label: BloomLabelText, _ measure: BloomMeasure) -> BloomSize {
    let w1 = measure(label.name, .label) + Double(label.name.count) * 0.57
    var w2 = 0.0
    if let sub = label.sub, !sub.isEmpty { w2 = measure(sub, .sub) + Double(sub.count) * 0.75 }
    let hasSub = !(label.sub ?? "").isEmpty
    return BloomSize(w: (max(w1, w2)).rounded(.up) + 4, h: hasSub ? 23 : 12)
  }

  public enum Force { case left, right }

  /// Where a bud's words go: beside it when the spoke runs sideways, over or
  /// under it when it runs up or down.
  public static func labelBox(
    _ x: Double, _ y: Double, _ deg: Double, _ d: Double, _ size: BloomSize, _ force: Force? = nil
  ) -> BloomBox {
    let ux = cos(rad(deg))
    let uy = sin(rad(deg))
    let gap = BloomConstants.labelGap
    if force == .left { return BloomBox(x: x - d / 2 - gap - size.w, y: y - size.h / 2, w: size.w, h: size.h, align: .right) }
    if force == .right { return BloomBox(x: x + d / 2 + gap, y: y - size.h / 2, w: size.w, h: size.h, align: .left) }
    if abs(ux) < 0.42 {
      return BloomBox(
        x: x - size.w / 2, y: uy < 0 ? y - d / 2 - gap - size.h : y + d / 2 + gap, w: size.w, h: size.h,
        align: .center)
    }
    if ux > 0 { return BloomBox(x: x + d / 2 + gap, y: y - size.h / 2, w: size.w, h: size.h, align: .left) }
    return BloomBox(x: x - d / 2 - gap - size.w, y: y - size.h / 2, w: size.w, h: size.h, align: .right)
  }

  public static func rectGap(_ box: BloomBox, _ x: Double, _ y: Double) -> Double {
    let dx = max(box.x - x, 0, x - (box.x + box.w))
    let dy = max(box.y - y, 0, y - (box.y + box.h))
    return hypot(dx, dy)
  }

  public static func pointSeg(_ px: Double, _ py: Double, _ a: BloomPoint, _ b: BloomPoint) -> Double {
    let dx = b.x - a.x
    let dy = b.y - a.y
    let len = dx * dx + dy * dy
    let t = len != 0 ? max(0, min(1, ((px - a.x) * dx + (py - a.y) * dy) / len)) : 0
    return hypot(px - (a.x + t * dx), py - (a.y + t * dy))
  }

  /// How near a box comes to the segment a–b (0 when it passes through it).
  public static func segGap(_ box: BloomBox, _ a: BloomPoint, _ b: BloomPoint) -> Double {
    var t0 = 0.0
    var t1 = 1.0
    let dx = b.x - a.x
    let dy = b.y - a.y
    let p = [-dx, dx, -dy, dy]
    let q = [a.x - box.x, box.x + box.w - a.x, a.y - box.y, box.y + box.h - a.y]
    var hit = true
    var k = 0
    while k < 4 && hit {
      let pk = p[k]
      let qk = q[k]
      if pk == 0 {
        if qk < 0 { hit = false }
      } else {
        let r = qk / pk
        if pk < 0 {
          if r > t1 { hit = false } else if r > t0 { t0 = r }
        } else if r < t0 {
          hit = false
        } else if r < t1 {
          t1 = r
        }
      }
      k += 1
    }
    if hit { return 0 }
    var near = min(rectGap(box, a.x, a.y), rectGap(box, b.x, b.y))
    for corner in [(box.x, box.y), (box.x + box.w, box.y), (box.x, box.y + box.h), (box.x + box.w, box.y + box.h)] {
      near = min(near, pointSeg(corner.0, corner.1, a, b))
    }
    return near
  }

  /// A bud's words toward any direction, then out until clear of the bud. Whole points.
  public static func labelToward(_ x: Double, _ y: Double, _ deg: Double, _ d: Double, _ size: BloomSize) -> BloomBox {
    let ux = cos(rad(deg))
    let uy = sin(rad(deg))
    let need = d / 2 + BloomConstants.labelGap
    var box = BloomBox(
      x: x + ux * need - (size.w * (1 - ux)) / 2, y: y + uy * need - (size.h * (1 - uy)) / 2, w: size.w, h: size.h,
      align: .center)
    var i = 0
    while i < 40 && rectGap(box, x, y) < need - 0.25 {
      box.x += ux
      box.y += uy
      i += 1
    }
    return BloomBox(
      x: jsRound(box.x), y: jsRound(box.y), w: box.w, h: box.h,
      align: abs(ux) < 0.42 ? .center : ux > 0 ? .left : .right)
  }

  /// JavaScript's `Math.round`: halves go toward +∞.
  static func jsRound(_ v: Double) -> Double { (v + 0.5).rounded(.down) }

  public static func labelCost(_ box: BloomBox, _ room: BloomRoom) -> Double {
    let inset = BloomConstants.inset
    let f = room.field
    var c = 0.0
    let out =
      max(0, inset - box.x) + max(0, inset - box.y) + max(0, box.x + box.w - (f.w - inset))
      + max(0, box.y + box.h - (f.h - inset))
    if out > 0 { c += out + 8 }
    let word = BloomConstants.clearWord
    for r in room.rects {
      let ix = min(box.x + box.w, r.x + r.width + word) - max(box.x, r.x - word)
      let iy = min(box.y + box.h, r.y + r.height + word) - max(box.y, r.y - word)
      if ix > 0 && iy > 0 { c += min(ix, iy) + 8 }
    }
    for o in room.discs {
      let g = rectGap(box, o.x, o.y) - o.r
      if g < BloomConstants.clearBud { c += BloomConstants.clearBud - g + 8 }
    }
    for sg in room.segs {
      let g = segGap(box, sg.a, sg.b)
      if g < BloomConstants.clearSpoke { c += BloomConstants.clearSpoke - g + 8 }
    }
    return c
  }

  /// Where a bud's words sit: their natural place if clear, else the nearest
  /// clear place round their own bud (15° at a time), else the name alone,
  /// else the least crowded place and what it costs.
  public static func seatLabel(
    _ x: Double, _ y: Double, _ d: Double, _ natural: BloomBox, _ sizes: [BloomSize?], _ room: BloomRoom,
    naturalShort: Bool = false
  ) -> BloomSeat {
    let c0 = labelCost(natural, room)
    if c0 == 0 { return BloomSeat(box: natural, cost: 0, short: naturalShort) }
    var best = BloomSeat(box: natural, cost: c0, short: naturalShort)
    let deg0 = angleOf(natural.x + natural.w / 2 - x, natural.y + natural.h / 2 - y)
    for (si, size) in sizes.enumerated() {
      guard let size else { continue }
      for k in 0...23 {
        let box = labelToward(x, y, deg0 + turnAt(k), d, size)
        let c = labelCost(box, room)
        if c == 0 { return BloomSeat(box: box, cost: 0, short: si > 0) }
        if c < best.cost { best = BloomSeat(box: box, cost: c, short: si > 0) }
      }
    }
    return best
  }

  public static func overflow(_ box: BloomBox, _ field: BloomSize, _ obstacles: [BloomRect]) -> Double {
    let inset = BloomConstants.inset
    var o = 0.0
    o += max(0, inset - box.x)
    o += max(0, inset - box.y)
    o += max(0, box.x + box.w - (field.w - inset))
    o += max(0, box.y + box.h - (field.h - inset))
    for r in obstacles {
      let ix = min(box.x + box.w, r.x + r.width + 6) - max(box.x, r.x - 6)
      let iy = min(box.y + box.h, r.y + r.height + 6) - max(box.y, r.y - 6)
      if ix > 0 && iy > 0 { o += min(ix, iy) + 8 }
    }
    return o
  }

  /// A ring round (cx, cy): `r` out, buds `d` across, `step`° apart, facing `prefer`°.
  public struct ArcSpec: Sendable {
    public var cx: Double
    public var cy: Double
    public var r: Double
    public var d: Double
    public var step: Double
    public var prefer: Double
    public var field: BloomSize
    public var obstacles: [BloomRect] = []
    public var discs: [BloomDisc] = []
    public var segs: [BloomSeg] = []
  }

  public struct ArcPoint: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var a: Double
  }

  public static func budsCost(_ pts: [ArcPoint], _ spec: ArcSpec, _ hotR: Double) -> Double {
    var cost = 0.0
    for pt in pts {
      cost += overflow(
        BloomBox(x: pt.x - spec.d / 2, y: pt.y - spec.d / 2, w: spec.d, h: spec.d, align: .center), spec.field,
        spec.obstacles)
      for o in spec.discs {
        let g = hypot(pt.x - o.x, pt.y - o.y) - o.r - hotR
        if g < 6 { cost += 14 - g }
      }
      for sg in spec.segs {
        let g = pointSeg(pt.x, pt.y, sg.a, sg.b) - hotR
        if g < 6 { cost += 14 - g }
      }
    }
    return cost
  }

  public static func arcPoints(_ spec: ArcSpec, _ theta: Double, _ step: Double, _ n: Int) -> [ArcPoint] {
    (0..<n).map { i in
      let a = theta + (Double(i) - Double(n - 1) / 2) * step
      let p = polar(spec.cx, spec.cy, spec.r, a)
      return ArcPoint(x: p.x, y: p.y, a: a)
    }
  }

  /// The spacing for n buds, narrowed so the arc spans at most 220°.
  public static func arcStep(_ spec: ArcSpec, _ n: Int) -> Double {
    n > 1 ? min(spec.step, 220 / Double(n - 1)) : spec.step
  }

  /// The k-th turn tried: 0, +15, −15, +30, −30, …
  public static func turnAt(_ k: Int) -> Double {
    k == 0 ? 0 : Double(k % 2 == 1 ? 1 : -1) * (Double(k) / 2).rounded(.up) * 15
  }

  public static func arcFits(_ spec: ArcSpec, _ n: Int, _ maxTurn: Double) -> Bool {
    let step = arcStep(spec, n)
    let hotR = (spec.d * BloomConstants.hot) / 2
    for k in 0...24 {
      if abs(turnAt(k)) > maxTurn { break }
      if budsCost(arcPoints(spec, spec.prefer + turnAt(k), step, n), spec, hotR) == 0 { return true }
    }
    return false
  }

  /// One more bud's words a ring leaves room for: the open desktop's.
  public struct ArcExtra: Sendable {
    public var x: Double
    public var y: Double
    public var d: Double
    public var natural: BloomBox
    public var short: Bool
    public var sizes: [BloomSize?]
  }

  public struct ArcItem: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var a: Double
    public var label: BloomBox
    public var short: Bool
  }

  public struct ArcLayout: Equatable, Sendable {
    public var theta: Double
    public var items: [ArcItem]
    public var step: Double
    public var turn: Double
    public var kept: Bool
    public var bud: Double
    public var word: Double
    public var also: Double
    public var cost: Double
  }

  /// n buds round (cx, cy): the preferred direction first, then turned 15°
  /// at a time either way until everything fits, in STRICT order — the buds
  /// fit, then the words, then `also`, then `extra`. Items come back in reading
  /// order: item i carries `labels[i]`.
  public static func layoutArc(
    _ spec: ArcSpec, labels: [BloomLabelText], measure: BloomMeasure, also: (([ArcPoint]) -> Double)? = nil,
    extra: ArcExtra? = nil
  ) -> ArcLayout {
    let n = labels.count
    let step = arcStep(spec, n)
    let sizes = labels.map { labelSize($0, measure) }
    let shorts: [BloomSize?] = labels.map { ($0.sub ?? "").isEmpty ? nil : labelSize(BloomLabelText(name: $0.name), measure) }
    let hotR = (spec.d * BloomConstants.hot) / 2
    var tried: [ArcLayout] = []
    for k in 0...24 {
      let turn = turnAt(k)
      let theta = spec.prefer + turn
      var pts = arcPoints(spec, theta, step, n)
      var tx = -sin(rad(theta))
      var ty = cos(rad(theta))
      if tx < -0.01 || (abs(tx) <= 0.01 && ty < 0) {
        tx = -tx
        ty = -ty
      }
      pts = stableSorted(pts) { u, v in (u.x * tx + u.y * ty) - (v.x * tx + v.y * ty) }
      let budCost = budsCost(pts, spec, hotR)
      let alsoCost = also?(pts) ?? 0
      var wordCost = 0.0
      let ringDiscs = pts.map { BloomDisc(x: $0.x, y: $0.y, r: hotR) }
      let segs = spec.segs + pts.map { BloomSeg(a: BloomPoint(x: spec.cx, y: spec.cy), b: BloomPoint(x: $0.x, y: $0.y)) }
      let vertical = abs(sin(rad(theta))) > 0.7
      let chord = 2 * spec.r * sin(rad(step / 2)) - 6
      var seated: [BloomRect] = []
      var items: [ArcItem] = []
      for (j, pt) in pts.enumerated() {
        let centred = abs(cos(rad(pt.a))) < 0.42
        let force: Force? = vertical && n >= 2 && centred ? (j == 0 ? .left : j == n - 1 ? .right : nil) : nil
        let full = sizes[j]
        var size = full
        if centred && force == nil && n >= 2 { size = BloomSize(w: min(size.w, chord), h: size.h) }
        let natural = labelBox(pt.x, pt.y, pt.a, spec.d, size, force)
        let seat = seatLabel(
          pt.x, pt.y, spec.d, natural, [full, shorts[j]],
          BloomRoom(
            field: spec.field, rects: spec.obstacles + seated,
            discs: spec.discs + ringDiscs.enumerated().filter { $0.offset != j }.map(\.element), segs: segs))
        wordCost += seat.cost
        seated.append(BloomRect(x: seat.box.x, y: seat.box.y, width: seat.box.w, height: seat.box.h))
        items.append(ArcItem(x: pt.x, y: pt.y, a: pt.a, label: seat.box, short: seat.short))
      }
      var kept = true
      if let ex = extra {
        let exSeat = seatLabel(
          ex.x, ex.y, ex.d, ex.natural, ex.sizes,
          BloomRoom(
            field: spec.field, rects: spec.obstacles + seated,
            discs: spec.discs.filter { $0.x != ex.x || $0.y != ex.y } + ringDiscs, segs: segs),
          naturalShort: ex.short)
        kept = exSeat.cost == 0
      }
      let here = ArcLayout(
        theta: theta, items: items, step: step, turn: turn, kept: kept, bud: budCost, word: wordCost, also: alsoCost,
        cost: budCost + wordCost + alsoCost)
      let clearBefore = tried.contains { $0.cost == 0 }
      if here.cost == 0 && kept && !clearBefore { return here }
      tried.append(here)
    }
    func keepExtra(_ list: [ArcLayout]) -> ArcLayout {
      let first = list[0]
      return list.first { $0.kept && angDiff($0.turn, first.turn) <= 45 } ?? first
    }
    func least(_ list: [ArcLayout], _ key: (ArcLayout) -> Double) -> ArcLayout {
      list.dropFirst().reduce(list[0]) { a, b in key(b) < key(a) - 0.5 ? b : a }
    }
    let clear = tried.filter { $0.cost == 0 }
    if !clear.isEmpty { return keepExtra(clear) }
    let fits = tried.filter { $0.bud == 0 && $0.word == 0 }
    if !fits.isEmpty {
      let lo = least(fits) { $0.also }.also
      return keepExtra(fits.filter { $0.also <= lo + 0.5 })
    }
    let budsFit = tried.filter { $0.bud == 0 }
    if !budsFit.isEmpty { return least(budsFit) { $0.word + $0.also } }
    return least(tried) { $0.bud * 1000 + $0.word + $0.also }
  }

  /// JavaScript's `Array.prototype.sort` is stable: ties keep their order.
  static func stableSorted<T>(_ items: [T], by key: (T, T) -> Double) -> [T] {
    items.enumerated().sorted { a, b in
      let c = key(a.element, b.element)
      return c < 0 || (c == 0 && a.offset < b.offset)
    }.map(\.element)
  }
}

// MARK: - The two rings, as puppeteer's model lays them

public enum BloomRings {
  /// Ring one (`openLevel1`): up first (-90°), the hub solid, and each bud
  /// that blooms (`profiles[i] ≥ 2`) needing room for its own ring onward —
  /// within 90° of its spoke, else 180° at a cost, else more.
  public static func one(
    at P: BloomPoint, labels: [BloomLabelText], profiles: [Int], field: BloomSize, chrome: [BloomRect],
    measure: BloomMeasure
  ) -> BloomGeometry.ArcLayout {
    let hub = BloomDisc(x: P.x, y: P.y, r: BloomConstants.hubR + 2)
    let spec = BloomGeometry.ArcSpec(
      cx: P.x, cy: P.y, r: BloomConstants.r1, d: BloomConstants.bud1, step: BloomConstants.step1, prefer: -90,
      field: field, obstacles: chrome, discs: [hub])
    return BloomGeometry.layoutArc(
      spec, labels: labels, measure: measure,
      also: { pts in
        var c = 0.0
        for (j, pt) in pts.enumerated() {
          let n = j < profiles.count ? profiles[j] : 0
          guard n >= 2 else { continue }
          let discs = [hub] + pts.map { BloomDisc(x: $0.x, y: $0.y, r: BloomConstants.bud1 * BloomConstants.hot / 2) }
          let room = BloomGeometry.ArcSpec(
            cx: pt.x, cy: pt.y, r: BloomConstants.r2, d: BloomConstants.bud2, step: BloomConstants.step2, prefer: pt.a,
            field: field, obstacles: chrome, discs: discs, segs: [BloomSeg(a: P, b: BloomPoint(x: pt.x, y: pt.y))])
          if !BloomGeometry.arcFits(room, n, 90) { c += BloomGeometry.arcFits(room, n, 180) ? 20 : 40 }
        }
        return c
      })
  }

  /// Ring two (`openLevel2`) round ring one's bud `open`: along its stroke, the
  /// hub, the open bud and its siblings solid, the siblings' words obstacles,
  /// and room left for the open bud's own words.
  public static func two(
    at P: BloomPoint, ring one: BloomGeometry.ArcLayout, open: Int, openLabel: BloomLabelText, names: [String],
    field: BloomSize, chrome: [BloomRect], measure: BloomMeasure
  ) -> BloomGeometry.ArcLayout {
    let bud = one.items[open]
    let hotR = BloomConstants.bud1 * BloomConstants.hot / 2
    var obstacles = chrome
    var discs = [BloomDisc(x: P.x, y: P.y, r: BloomConstants.hubR + 2), BloomDisc(x: bud.x, y: bud.y, r: hotR)]
    for (i, o) in one.items.enumerated() where i != open {
      discs.append(BloomDisc(x: o.x, y: o.y, r: hotR))
      obstacles.append(BloomRect(x: o.label.x, y: o.label.y, width: o.label.w, height: o.label.h))
    }
    let sizes: [BloomSize?] = [
      BloomGeometry.labelSize(openLabel, measure), BloomGeometry.labelSize(BloomLabelText(name: openLabel.name), measure),
    ]
    let spec = BloomGeometry.ArcSpec(
      cx: bud.x, cy: bud.y, r: BloomConstants.r2, d: BloomConstants.bud2, step: BloomConstants.step2, prefer: bud.a,
      field: field, obstacles: obstacles, discs: discs, segs: [BloomSeg(a: P, b: BloomPoint(x: bud.x, y: bud.y))])
    return BloomGeometry.layoutArc(
      spec, labels: names.map { BloomLabelText(name: $0) }, measure: measure,
      extra: .init(x: bud.x, y: bud.y, d: BloomConstants.bud1, natural: bud.label, short: bud.short, sizes: sizes))
  }
}

// MARK: - Targeting (puppeteer's `targeting.ts`)

/// What letting go would do right now.
public enum BloomTarget: Equatable, Sendable {
  case hub
  case none
  /// a first-ring bud (a desktop, or a profile when one desktop blooms its own), at `d` from the hub
  case ring1(index: Int, d: Double?)
  /// a second-ring bud: one of the open desktop's profiles
  case ring2(index: Int)
}

public struct BloomTargetState: Sendable {
  public var P: BloomPoint
  /// each first-ring bud's spoke direction, in ring order
  public var l1: [Double]
  public var l1step: Double
  public var l2: [Double]
  public var l2step: Double
  /// the open first-ring bud: its index, where it stands, when its ring starts listening (ms)
  public var open: (index: Int, pos: BloomPoint, readyAt: Double)?

  public init(P: BloomPoint, l1: [Double], l1step: Double, l2: [Double] = [], l2step: Double = BloomConstants.step2,
    open: (index: Int, pos: BloomPoint, readyAt: Double)? = nil)
  {
    self.P = P
    self.l1 = l1
    self.l1step = l1step
    self.l2 = l2
    self.l2step = l2step
    self.open = open
  }
}

public enum BloomTargeting {
  /// The bud whose spoke is nearest the pointer's direction.
  static func nearest(_ angles: [Double], _ a: Double) -> (index: Int, delta: Double)? {
    var best: (index: Int, delta: Double)?
    for (i, bud) in angles.enumerated() {
      let delta = BloomGeometry.angDiff(a, bud)
      if best == nil || delta < best!.delta { best = (i, delta) }
    }
    return best
  }

  static func level1(_ s: BloomTargetState, _ d: Double, _ dx: Double, _ dy: Double) -> BloomTarget {
    if d <= BloomConstants.deadR { return .hub }
    let best = nearest(s.l1, BloomGeometry.angleOf(dx, dy))
    let half = min(BloomConstants.sectorMax, s.l1step / 2 + 4)
    if let best, best.delta <= half, d <= BloomConstants.r1 + BloomConstants.slack { return .ring1(index: best.index, d: d) }
    return .none
  }

  /// Where the pointer is, read against what is open; `collapse` asks the
  /// caller to close the second ring and read again.
  public static func resolve(_ s: BloomTargetState, _ p: BloomPoint, now: Double) -> (collapse: Bool, target: BloomTarget) {
    let dx = p.x - s.P.x
    let dy = p.y - s.P.y
    let d = hypot(dx, dy)
    guard let open = s.open else { return (false, level1(s, d, dx, dy)) }
    if d < BloomConstants.r1 - BloomConstants.backOut { return (true, level1(s, d, dx, dy)) }
    let dx2 = p.x - open.pos.x
    let dy2 = p.y - open.pos.y
    let d2 = hypot(dx2, dy2)
    if d2 <= BloomConstants.deadR { return (false, .ring1(index: open.index, d: nil)) }
    if now < open.readyAt { return (false, .ring1(index: open.index, d: nil)) }
    let a2 = BloomGeometry.angleOf(dx2, dy2)
    let half2 = min(BloomConstants.sectorMax, s.l2step / 2 + 4)
    if let best = nearest(s.l2, a2), best.delta <= half2, d2 <= BloomConstants.r2 + BloomConstants.slack {
      return (false, .ring2(index: best.index))
    }
    let other = level1(s, d, dx, dy)
    if case .ring1(let index, _) = other, index != open.index, d >= BloomConstants.r1 - BloomConstants.reach - 10,
      d <= BloomConstants.r1 + 30
    {
      return (true, other)
    }
    return (false, .none)
  }
}
