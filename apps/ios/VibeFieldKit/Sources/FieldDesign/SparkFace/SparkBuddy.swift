import Foundation

// IOS-12e (PC-D6 A; DESIGN.md §2.10, amended 2026-11-06) — A SPARK'S FACE, ALIVE: the desktop's vendored engine's
// `Buddy` (`sparks.js` :898–1128) transcribed, the parts a spark's face uses. It is the state machine behind a face:
// springs chasing a status's pose, blinks, a gaze, a motion. Each frame `write` lays the face out as 32 vec4 rows
// (128 float32s), and `SparkStar.metal` reads nothing else about it. Held float for float to the rows golden
// (`spark-rows.golden.json`, SparkBuddyGoldenTests).
//
// A face is built as the product builds one, the kit's adapter (`engine.ts`'s `sparkBuddyOptions` and
// `placeSparkBuddy`): the seed's DNA, the glow, mouthless, at rest in its status, framed on its disc or free.
// The engine draws its phases, blinks and glances from `Math.random`. On the phone a face draws them from Mulberry32
// on its own seed (§2.10's amendment), in the engine's order: a reordered draw is a different face.
//
// Not here, because a spark's face never uses them: a cast character, a pointer to watch, `play` and `poke`, a mouth
// and `motionScale`. IOS-12f's f5 added what New spark's sky asks of a face (hatch.tsx :199–238): `birth` (:975) with
// its sequence's holds and queue, `leave` (:981), and the alpha, the fade and the death that `update` (:1044) and
// `write` (:1099, :1101) read. A face no hatch touches is never born late and never leaves, so its rows are 12e's.

public struct SparkBuddy: Sendable {
  /// One face's rows: 32 vec4s.
  public static let floats = 128

  /// The disc a framed face sits on (`engine.ts`'s SPARK_FRAME): 1.26 of the star's radius, the star 6% of it below
  /// the centre.
  static let frameC = (0.0, 0.06)
  static let frameH = 1.26

  // MARK: - The springs (`KEYS`: rest, omega, zeta)

  enum Key: Int, CaseIterable {
    case eyeScale, eyeWm, eyeHm, lidAng, lidYL, lidYR, lowLidL, lowLidR, scaleL, scaleR, offYL, offYR, mouthSize
    case mouthOpen, blush, tears, sweat, propAmt, perk, stretch, sharp, curl, droop, wiggleAmp, wiggleFreq, soft
    case glow, tintR, tintG, tintB, tintA, scale, grow, spin, accAmt, badgeAmt, ringAmt, desat, waveAmp, faceY

    var name: String { SparkBuddy.keyNames[rawValue] }
  }

  static let keyNames = [
    "eyeScale", "eyeWm", "eyeHm", "lidAng", "lidYL", "lidYR", "lowLidL", "lowLidR", "scaleL", "scaleR", "offYL",
    "offYR", "mouthSize", "mouthOpen", "blush", "tears", "sweat", "propAmt", "perk", "stretch", "sharp", "curl",
    "droop", "wiggleAmp", "wiggleFreq", "soft", "glow", "tintR", "tintG", "tintB", "tintA", "scale", "grow", "spin",
    "accAmt", "badgeAmt", "ringAmt", "desat", "waveAmp", "faceY",
  ]

  static let springs: [(rest: Double, omega: Double, zeta: Double)] = [
    (1, 18, 0.5), (1, 18, 0.6), (1, 18, 0.6), (0, 16, 0.75), (1, 16, 0.75), (1, 16, 0.75), (0, 16, 0.65),
    (0, 16, 0.65), (1, 16, 0.55), (1, 16, 0.55), (0, 16, 0.7), (0, 16, 0.7), (1, 16, 0.55), (0, 16, 0.6),
    (0, 8, 0.9), (0, 6, 1), (0, 8, 0.9), (0, 7, 1), (0, 9, 0.45), (1, 10, 0.38), (0, 9, 0.6), (0, 9, 0.55),
    (0, 7, 0.6), (0, 8, 0.8), (0, 6, 1), (0, 8, 0.7), (1, 6, 0.9), (1, 6, 1), (1, 6, 1), (1, 6, 1), (0, 6, 0.9),
    (1, 10, 0.45), (1, 11, 0.62), (0, 5, 1), (0, 14, 0.55), (0, 16, 0.42), (0, 8, 1), (0, 5, 1), (0, 9, 0.6),
    (0, 10, 0.7),
  ]

  /// The keys a recipe sets straight (`DIRECT`).
  static let direct: [Key] = [
    .eyeScale, .eyeWm, .eyeHm, .scaleL, .scaleR, .offYL, .offYR, .mouthSize, .mouthOpen, .blush, .tears, .sweat,
    .perk, .stretch, .sharp, .curl, .droop, .wiggleAmp, .wiggleFreq, .soft, .glow, .scale, .spin, .desat, .faceY,
  ]

  // MARK: - The signs, as the shader numbers them

  static let glyphs = ["pill": 0, "star": 1, "heart": 2, "x": 3, "spiral": 4, "chevron": 5, "ring": 6]
  static let mouths = [
    "none": 0, "smile": 1, "open": 2, "o": 3, "flat": 4, "frown": 5, "wavy": 6, "cat": 7, "smirk": 8, "tongue": 9,
  ]
  static let props = [
    "none": 0, "hearts": 1, "zzz": 2, "sparkles": 3, "anger": 4, "question": 5, "exclaim": 6, "dizzy": 7,
    "thought": 8, "check": 9, "cross": 10, "code": 11, "progress": 12, "bug": 13, "lock": 14, "hourglass": 15,
    "notes": 16, "confetti": 17,
  ]
  static let accessories = [
    "none": 0, "sunglasses": 1, "laptop": 2, "magnifier": 3, "glasses": 4, "headphones": 5, "coffee": 6,
    "clipboard": 7, "nightcap": 8,
  ]
  static let badges = [
    "none": 0, "check": 1, "cross": 2, "question": 3, "lock": 4, "up": 5, "heart": 6, "moon": 7, "hourglass": 8,
    "exclaim": 9,
  ]
  static let rings = ["none": 0, "spin": 1, "pulse": 2]

  // MARK: - The face

  public let seed: UInt32
  let body: SparkBody
  let eyes: SparkEyes
  let palette: Int
  let framed: Bool
  /// Props (thought dots, Zzz, hearts) are drawn on a free face only (`props ?? !frame`).
  let propsOn: Bool
  let seedF: Double
  let ph: Double
  let waveIdx: Int
  let topIdx: Int

  public private(set) var x = 0.0
  public private(set) var y = 0.0
  public private(set) var R = 40.0
  public private(set) var faceScale = 1.0
  /// The scroll view's visible rect in the stage's space (left, top, right, bottom): the shader draws nothing outside.
  public var clip: SIMD4<Double>?
  /// The ground behind a framed face, for its cut ring.
  public var cut: SIMD3<Double>?
  /// The status a face returns to.
  public var rest: String

  var random: Mulberry32
  var t = 0.0
  var st: [Double]
  var vel: [Double]
  var look = [0.0, 0.0]
  var lookV = [0.0, 0.0]
  var sac = (0.0, 0.0)
  var nextSac = 0.0
  var glyph = 0
  var pendingGlyph: Int?
  var mouthA = 0
  var mouthB = 0
  var mouthMix = 1.0
  var propA = 0
  var propB = 0
  var propMix = 1.0
  var propStart = 0.0
  var acc = 0
  var accWant = 0
  var badge = 0
  var badgeWant = 0
  var ring = 0
  var ringWant = 0
  var blinkT0 = -9.0
  var blinkDur = 0.16
  var nextBlink: Double
  var wigPhase: Double
  var spinPhase = 0.0
  var motion = "float"
  var motionPrev = "float"
  var motionFade = 1.0
  var emoStart = 0.0
  var emotion: String?
  var rec = SparkRecipes.calm
  /// When the status held now gives way (`until`): to the queue's next, or to the rest.
  var until = Double.infinity
  var queue: [(String, Double?)] = []
  /// The hatch's: when the face is born (it is not drawn before), when its eyes open, and when it began to leave.
  var bornAt: Double?
  var wakeAt: Double?
  var fade: Double?
  /// How much of the face is drawn: 0 before its birth, falling to 0 as it leaves.
  public private(set) var alpha = 1.0
  /// Gone: it has left, and the engine draws it no more.
  public private(set) var dead = false

  /// `new Buddy(sparkBuddyOptions(engine, { seed, status, framed }, cut))`: the seed's DNA, the glow, mouthless, at
  /// rest in `status`. `random` deals every draw the engine takes from `Math.random`, in its order.
  public init(seed: UInt32, status: String, framed: Bool, cut: SIMD3<Double>?, random: Mulberry32) {
    let dna = SparkEngine.agentDNA(seed)
    self.seed = seed
    body = SparkEngine.makeBody(seed, dna.body)
    eyes = SparkEngine.makeEyes(seed, dna.eyes)
    palette = dna.palette
    rest = status
    self.framed = framed
    propsOn = !framed
    self.cut = cut
    seedF = 1 + (Double(seed) * 0.618034).truncatingRemainder(dividingBy: 1) * 97
    var random = random
    ph = random.next() * 10
    waveIdx = Self.nearestPoint(body.points, 0.35)
    topIdx = Self.nearestPoint(body.points, Double.pi / 2)
    st = Self.springs.map(\.rest)
    vel = [Double](repeating: 0, count: Self.springs.count)
    nextBlink = 1 + random.next() * (4 - 1)
    wigPhase = random.next() * 6
    self.random = random
    feel(status)
    settle()
  }

  /// `placeSparkBuddy`: centred on its box, the star 6% below the disc's centre when framed, the eyes larger at
  /// small sizes.
  public mutating func place(centreX: Double, centreY: Double, size: Double, framed: Bool) {
    let R = size / 2 / Self.frameH
    self.R = R
    x = centreX - (framed ? Self.frameC.0 * R : 0)
    y = centreY + (framed ? Self.frameC.1 * R : 0)
    faceScale = Self.faceScale(size: size)
  }

  /// IOS-12f's f6 — a frame of its flight (hatch.tsx :304–316). The red's skeleton: it does nothing yet.
  public mutating func fly(_ pose: SparkFlight.Pose) {}

  /// `sparkFaceScale`: at 32 and below a face's eyes are drawn 1.25× larger, and up to 48 1.12×.
  public static func faceScale(size: Double) -> Double { size <= 32 ? 1.25 : size <= 48 ? 1.12 : 1 }

  // MARK: - The state machine

  /// `feel(name, hold)`: chase a status's pose, for `hold` seconds when one is given (then the queue's next, or the
  /// rest). A status the recipes do not hold is ignored, as the engine ignores it; the one held now keeps its pose and
  /// takes the new hold.
  public mutating func feel(_ status: String, hold: Double? = nil) {
    guard let recipe = SparkRecipes.recipe(status, mouth: false) else { return }
    until = hold.map { t + $0 } ?? .infinity
    guard status != emotion else { return }
    emotion = status
    emoStart = t
    rec = recipe
    motionPrev = motion
    motion = rec.word("motion") ?? "float"
    motionFade = 0
    applyDiscrete()
    let gap = blinkGap()
    nextBlink = min(nextBlink, t + gap)
  }

  /// `birth(at, seq)`: the face is born at `at`, small and ungrown, its eyes shut for the first 0.55 s, and it plays
  /// `sequence` (each status for its hold) before its rest. Before `at` it is not drawn.
  public mutating func birth(at: Double, sequence: [(String, Double?)]) {
    t = at
    bornAt = at
    wakeAt = at + 0.55
    st[Key.grow.rawValue] = 0
    vel[Key.grow.rawValue] = 0
    st[Key.scale.rawValue] = 0.55
    vel[Key.scale.rawValue] = 0
    queue = Array(sequence.dropFirst())
    emotion = nil
    if let first = sequence.first { feel(first.0, hold: first.1) }
  }

  /// `leave(at)`: from `at` the face fades and shrinks over 0.45 s, then it is gone.
  public mutating func leave(at: Double) {
    fade = at
  }

  mutating func applyDiscrete() {
    let g = Self.glyphs[rec.word("glyph") ?? "pill"] ?? 0
    if g != (pendingGlyph ?? glyph) {
      pendingGlyph = g
      blinkNow(0.2)
    }
    let m = Self.mouths[rec.word("mouth") ?? "none"] ?? 0
    if m != mouthB {
      mouthA = mouthMix > 0.5 ? mouthB : mouthA
      mouthB = m
      mouthMix = 0
    }
    let pr = Self.props[rec.word("prop") ?? "none"] ?? 0
    if pr != propB {
      propA = propMix > 0.5 ? propB : propA
      propB = pr
      propMix = 0
      propStart = t
    }
    accWant = Self.accessories[rec.word("acc") ?? "none"] ?? 0
    badgeWant = Self.badges[rec.word("badge") ?? "none"] ?? 0
    ringWant = Self.rings[rec.word("ring") ?? "none"] ?? 0
  }

  mutating func rnd(_ a: Double, _ b: Double) -> Double { a + random.next() * (b - a) }

  mutating func blinkGap() -> Double {
    let range = rec.numbers("blink") ?? [2.2, 5.2]
    return rnd(range[0], range[1])
  }

  mutating func blinkNow(_ duration: Double) {
    if t - blinkT0 > blinkDur {
      blinkT0 = t
      blinkDur = duration
    }
  }

  func blinkValue() -> Double {
    let u = (t - blinkT0) / blinkDur
    if u < 0 || u > 1 { return 0 }
    return u < 0.4 ? u / 0.4 : u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45
  }

  /// What the springs chase now (`targets()`).
  func targets() -> [Double] {
    var target = Self.springs.map(\.rest)
    func set(_ key: Key, _ value: Double) { target[key.rawValue] = value }
    let lidY = rec.number("lidY") ?? eyes.lidY
    set(.lidYL, lidY)
    set(.lidYR, lidY)
    set(.lidAng, rec.number("lidAng") ?? eyes.lidAng)
    let lowLid = rec.number("lowLid") ?? 0
    set(.lowLidL, lowLid)
    set(.lowLidR, lowLid)
    if let value = rec.number("lidYL") { set(.lidYL, value) }
    if let value = rec.number("lidYR") { set(.lidYR, value) }
    if let value = rec.number("lowLidL") { set(.lowLidL, value) }
    if let value = rec.number("lowLidR") { set(.lowLidR, value) }
    for key in Self.direct {
      if let value = rec.number(key.name) { set(key, value) }
    }
    if let value = rec.number("wave") { set(.waveAmp, value) }
    if let tint = rec.numbers("tint"), tint.count == 4 {
      set(.tintR, tint[0])
      set(.tintG, tint[1])
      set(.tintB, tint[2])
      set(.tintA, tint[3])
    } else {
      set(.tintR, st[Key.tintR.rawValue])
      set(.tintG, st[Key.tintG.rawValue])
      set(.tintB, st[Key.tintB.rawValue])
    }
    set(.propAmt, rec.word("prop") != nil ? (rec.number("propAmt") ?? 1) : 0)
    set(.accAmt, acc != 0 && acc == accWant ? 1 : 0)
    set(.badgeAmt, badge != 0 && badge == badgeWant ? 1 : 0)
    set(.ringAmt, ring != 0 && ring == ringWant ? 1 : 0)
    return target
  }

  /// `settle()`: straight to the pose, no springing.
  mutating func settle() {
    acc = accWant
    badge = badgeWant
    ring = ringWant
    st = targets()
    vel = [Double](repeating: 0, count: Self.springs.count)
    if let pending = pendingGlyph {
      glyph = pending
      pendingGlyph = nil
    }
    mouthMix = 1
    propMix = 1
    motionFade = 1
    blinkT0 = -9
    look = lookTarget()
    lookV = [0, 0]
  }

  /// `lookTarget()`: where the eyes want to be. A spark watches no pointer (`watch: false`), so `user` is straight
  /// ahead.
  mutating func lookTarget() -> [Double] {
    var tx: Double = eyes.lookX + (rec.number("lookX") ?? 0)
    var ty: Double = eyes.lookY + (rec.number("lookY") ?? 0)
    switch rec.word("gaze") {
    case "scan":
      tx = 0.62 * sin(t * 1.2)
      ty = -0.05
    case "read":
      let u = (t * 0.65).truncatingRemainder(dividingBy: 1)
      let line = floor(t * 0.65).truncatingRemainder(dividingBy: 3)
      tx = -0.6 + 1.2 * min(1, u * 1.3)
      ty = -0.25 - line * 0.14
    case "orbit":
      let a = t * 2.4 + seedF
      tx = cos(a) * 0.9
      ty = sin(a) * 0.9
    case "bug":
      let a = -t * 0.8 + seedF * 0.7
      tx = cos(a) * 0.9
      ty = sin(a) * 0.85
    case "composer":
      tx = 0.55
      ty = -0.45
    case "fixed":
      if t > nextSac {
        let sx = rnd(-0.07, 0.07)
        let sy = rnd(-0.05, 0.05)
        sac = (sx, sy)
        nextSac = t + rnd(0.6, 1.8)
      }
      tx += sac.0
      ty += sac.1
    case "none":
      break
    case "user":
      tx = 0
      ty = 0
    default:
      if t > nextSac {
        let sx = rnd(-0.35, 0.35)
        let sy = rnd(-0.22, 0.22)
        sac = (sx, sy)
        nextSac = t + rnd(0.8, 2.8) * (rec.fields["fastEyes"] != nil ? 0.25 : 1)
      }
      tx += sac.0
      ty += sac.1
    }
    let length: Double = hypot(tx, ty)
    return length > 1 ? [tx / length, ty / length] : [tx, ty]
  }

  /// `update(t, dt)`: one step of the face's clock.
  public mutating func update(t: Double, dt: Double) {
    self.t = t
    if let bornAt, t < bornAt {
      alpha = 0
      if let fade, t > fade { dead = true }
      return
    }
    alpha = 1
    if let fade {
      let f = Self.clamp((t - fade) / 0.45, 0, 1)
      alpha = 1 - f
      st[Key.scale.rawValue] = 1 - 0.6 * f
      if f >= 1 { dead = true }
    }
    if t > until {
      if queue.isEmpty {
        feel(rest)
      } else {
        let next = queue.removeFirst()
        feel(next.0, hold: next.1)
      }
    }
    let dt = min(dt, 1.0 / 30)
    let target = targets()
    for k in 0..<Self.springs.count {
      // a face that is leaving shrinks on its fade, not on its spring
      if fade != nil && k == Key.scale.rawValue { continue }
      let w = Self.springs[k].omega
      let z = Self.springs[k].zeta
      let a = w * w * (target[k] - st[k]) - 2 * z * w * vel[k]
      vel[k] += a * dt
      st[k] += vel[k] * dt
    }
    // accessories, badges and rings swap only once the old one has gone
    swapWhenGone(\.acc, \.accWant, .accAmt)
    swapWhenGone(\.badge, \.badgeWant, .badgeAmt)
    swapWhenGone(\.ring, \.ringWant, .ringAmt)
    if let wakeAt, t < wakeAt {
      // just born: the eyes held shut, a slow blink that opens as `wakeAt` passes
      blinkT0 = t - blinkDur * 0.45
      blinkDur = 0.3
    } else if t > nextBlink {
      blinkNow(emotion == "sleepy" ? 0.5 : 0.16)
      let gap = blinkGap()
      let quick = random.next() < 0.2
      nextBlink = t + gap * (quick ? 0.12 : 1)
    }
    if let pending = pendingGlyph, blinkValue() > 0.85 || self.t - blinkT0 > blinkDur {
      glyph = pending
      pendingGlyph = nil
      if glyph == 1 || glyph == 2 { vel[Key.eyeScale.rawValue] += 6 }
    }
    mouthMix = min(1, mouthMix + dt / 0.18)
    propMix = min(1, propMix + dt / 0.3)
    motionFade = min(1, motionFade + dt / 0.4)
    let lk = lookTarget()
    for i in 0..<2 {
      let a = 24 * 24 * (lk[i] - look[i]) - 2 * 0.78 * 24 * lookV[i]
      lookV[i] += a * dt
      look[i] += lookV[i] * dt
    }
    wigPhase += st[Key.wiggleFreq.rawValue] * dt
    spinPhase += st[Key.spin.rawValue] * dt
  }

  private mutating func swapWhenGone(
    _ shown: WritableKeyPath<SparkBuddy, Int>, _ wanted: WritableKeyPath<SparkBuddy, Int>, _ amount: Key
  ) {
    if self[keyPath: shown] != self[keyPath: wanted] && st[amount.rawValue] < 0.04 {
      self[keyPath: shown] = self[keyPath: wanted]
      st[amount.rawValue] = 0
      vel[amount.rawValue] = 0
    }
  }

  // MARK: - The rows

  /// Where the top point's tip is now, so a nightcap sits on it (`capAnchor`, body space, R units).
  func capAnchor(_ grow: Double) -> (Double, Double, Double, Double) {
    let s = st
    let point = body.points[topIdx]
    let perk = s[Key.perk.rawValue]
    let droop = s[Key.droop.rawValue]
    let sharp = s[Key.sharp.rawValue]
    let a = point.angle + (perk - droop * 0.5) * 0.3 * sin(Double.pi / 2 - point.angle)
    let dx = cos(a)
    let dy = sin(a)
    let qx = -dy
    let qy = dx
    let hw =
      point.halfWidth * Self.lerp(1, 0.74, sharp) * Self.lerp(1, 1.1, s[Key.soft.rawValue]) * Self.lerp(0.55, 1, grow)
    let tip = hw * Self.lerp(body.tip, 0.22, sharp)
    let L = max(point.length * s[Key.stretch.rawValue] * grow, hw - tip + 0.002)
    let bend = point.bend - droop * dx * 0.45 + s[Key.curl.rawValue] * 0.7
    return (
      dx * L + qx * bend * L * L, dy * L + qy * bend * L * L, atan2(dy + qy * 2 * bend * L, dx + qx * 2 * bend * L),
      tip
    )
  }

  /// `write(f, o)`: the face as 32 vec4 rows at `offset`. Under reduced motion every motion is still.
  public func write(into rows: inout [Float], at offset: Int, reducedMotion: Bool) {
    let s = st
    func k(_ key: Key) -> Double { s[key.rawValue] }
    let e = eyes
    let fs = faceScale
    let a = SparkMotion.pose(motionPrev, t: t, te: t - emoStart, ph: ph, reduced: reducedMotion)
    let m = SparkMotion.pose(motion, t: t, te: t - emoStart, ph: ph, reduced: reducedMotion)
    let w = motionFade
    var mv = SparkMotionPose()
    mv.x = Self.lerp(a.x, m.x, w)
    mv.y = Self.lerp(a.y, m.y, w)
    mv.rot = Self.lerp(a.rot, m.rot, w)
    mv.sx = Self.lerp(a.sx, m.sx, w)
    mv.sy = Self.lerp(a.sy, m.sy, w)
    mv.scale = Self.lerp(a.scale, m.scale, w)
    mv.lift = Self.lerp(a.lift, m.lift, w)
    mv.lid = Self.lerp(a.lid, m.lid, w)
    // a spark's motionScale is 1, so the engine's `ms !== 1` branch never runs
    let sy = mv.sy
    let sx = mv.sx
    let grow = Self.clamp(k(.grow), 0, 1.1)
    func set(_ i: Int, _ x: Double, _ y: Double, _ z: Double, _ w: Double) {
      let at = offset + i * 4
      rows[at] = Float(x)
      rows[at + 1] = Float(y)
      rows[at + 2] = Float(z)
      rows[at + 3] = Float(w)
    }
    let reach = Self.frameH * 1.32
    let S = framed ? max(2.25, abs(Self.frameC.0) + reach, abs(Self.frameC.1) + reach) : 2.25
    set(0, x, y, alpha > 0 ? R : 0, seedF)
    set(1, 2, Double(palette), framed ? 1 : 0, S)
    set(2, Self.frameC.0, Self.frameC.1, Self.frameH, alpha)
    set(3, mv.x, mv.y - (1 - sy) * 0.85, mv.rot, max(0.01, k(.scale) * mv.scale))
    set(4, sx, sy, mv.lift, grow)
    set(5, Double(body.n), body.core, body.k, body.tip)
    set(6, k(.perk), k(.stretch), k(.sharp), k(.curl))
    set(7, k(.wiggleAmp), wigPhase, k(.droop), k(.soft))
    set(
      8, e.gap * (1 + (fs - 1) * 0.6), e.y, e.w * k(.eyeWm) * k(.eyeScale) * fs, e.h * k(.eyeHm) * k(.eyeScale) * fs)
    set(9, e.tilt, k(.lidAng), blinkValue(), 1)
    set(10, k(.lidYL) + mv.lid, k(.lidYR) + mv.lid, k(.lowLidL), k(.lowLidR))
    set(11, k(.scaleL), k(.scaleR), k(.offYL), k(.offYR))
    set(12, look[0], look[1], Double(glyph), Double(e.shape))
    set(13, Double(mouthA), Double(mouthB), mouthMix, k(.mouthSize) * 1.4 * fs)
    set(14, k(.mouthOpen), e.mouthY * fs, k(.blush), k(.tears))
    set(15, k(.sweat), Double(propA), Double(propB), propMix)
    set(16, k(.tintR), k(.tintG), k(.tintB), k(.tintA))
    set(17, k(.glow), 0, spinPhase, k(.propAmt))
    set(18, propStart, Self.clamp(k(.accAmt), 0, 1.2), Double(acc), k(.faceY))
    set(19, Double(badge), max(0, k(.badgeAmt)), Double(ring), Self.clamp(k(.ringAmt), 0, 1))
    // a point the star does not have leaves its row as it was, as the engine leaves it
    for (i, point) in body.points.prefix(8).enumerated() {
      set(20 + i, point.angle, point.length, point.halfWidth, point.bend)
    }
    set(28, Self.clamp(k(.desat), 0, 1), Double(waveIdx), k(.waveAmp), propsOn ? 1 : 0)
    set(29, clip?.x ?? -1e5, clip?.y ?? -1e5, clip?.z ?? 1e5, clip?.w ?? 1e5)
    let cap = acc == 8 ? capAnchor(grow) : (0, 0, 0, 0)
    set(30, cap.0, cap.1, cap.2, cap.3)
    set(31, cut?.x ?? 0, cut?.y ?? 0, cut?.z ?? 0, cut == nil ? 0 : 1)
  }

  // MARK: - The engine's arithmetic

  static func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

  static func clamp(_ value: Double, _ low: Double, _ high: Double) -> Double { max(low, min(high, value)) }

  static func angDist(_ a: Double, _ b: Double) -> Double {
    let tau = Double.pi * 2
    return abs(((a - b).truncatingRemainder(dividingBy: tau) + tau + Double.pi).truncatingRemainder(dividingBy: tau)
      - Double.pi)
  }

  /// The point nearest an angle (`nearestPoint`): the one that waves, the one a nightcap sits on.
  static func nearestPoint(_ points: [SparkPoint], _ target: Double) -> Int {
    var best = 0
    var bestDistance = 9.0
    for (i, point) in points.enumerated() {
      let distance = angDist(point.angle, target)
      if distance < bestDistance {
        bestDistance = distance
        best = i
      }
    }
    return best
  }
}
