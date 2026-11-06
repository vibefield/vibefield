import Foundation

// IOS-12e (PC-D6 A; DESIGN.md §2.10, amended 2026-11-06) — A STATUS'S MOTION, transcribed from the desktop's vendored
// engine (`sparks.js` :843–885, `hopCurve` and `MOTION`). A motion is the body's offset at a moment: x and y in the
// star's radii, a turn, a squash and a stretch, a scale, a lift and a lid. `Buddy.write` blends the previous motion into
// the new one over 0.4 s. Each expression keeps the engine's order of operations, so the doubles are the engine's, and
// the rows golden holds them (SparkBuddyGoldenTests).
//
// Reduced motion is the engine's own switch (the kit's `holdReducedMotion`): every motion is still, so a face keeps
// its pose, its blinks and its status changes, and drops the hops and the shakes (M6).

/// A motion's offsets, over the engine's defaults (`motionAt`: x 0, y 0, rot 0, sx 1, sy 1, scale 1, lift 0, lid 0).
public struct SparkMotionPose: Equatable, Sendable {
  public var x = 0.0
  public var y = 0.0
  public var rot = 0.0
  public var sx = 1.0
  public var sy = 1.0
  public var scale = 1.0
  public var lift = 0.0
  public var lid = 0.0

  public init() {}
}

public enum SparkMotion {
  /// `MOTION[name](t, te, ph)` over the defaults; an unknown name is the float, and reduced motion is still.
  /// `t` is the face's time, `te` the time in its status, `ph` its phase.
  public static func pose(_ name: String, t: Double, te: Double, ph: Double, reduced: Bool = false)
    -> SparkMotionPose
  {
    var p = SparkMotionPose()
    if reduced { return p }
    switch name {
    case "hop":
      hop(&p, (t + ph).truncatingRemainder(dividingBy: 1.1) / 1.1, 0.2, 0.55)
    case "bounce":
      hop(&p, (t + ph).truncatingRemainder(dividingBy: 0.62) / 0.62, 0.17, 0.6)
      p.rot = 0.06 * sin(t * 5 + ph)
    case "giggle":
      p.y = 0.025 * abs(sin(t * 16))
      p.rot = 0.07 * sin(t * 8) + 0.05
      p.sx = 1 + 0.025 * sin(t * 32)
      p.sy = 1 - 0.025 * sin(t * 32)
    case "sway":
      p.x = -0.03
      p.y = 0.02 * sin(t * 1.7 + ph)
      p.rot = 0.12 + 0.05 * sin(t * 1.3 + ph)
    case "doze":
      let c = (t + ph).truncatingRemainder(dividingBy: 4.4) / 4.4
      let nod = c < 0.78 ? pow(c / 0.78, 2) : 1 - (c - 0.78) / 0.22
      p.y = -0.04 - 0.06 * nod + 0.015 * sin(t * 1.1)
      p.rot = 0.06 * sin(t * 0.6 + ph) + 0.1 * nod
      p.scale = 1 + 0.025 * sin(t * 1.1)
      p.lid = -0.75 * nod + (c > 0.78 && c < 0.86 ? 0.5 : 0)
    case "sink":
      let s = (t + ph).truncatingRemainder(dividingBy: 4.2) / 4.2
      let sigh = exp(-pow((s - 0.2) / 0.08, 2))
      p.y = -0.07 + 0.012 * sin(t * 1.3) + 0.03 * sigh
      p.sx = 1.05 - 0.03 * sigh
      p.sy = 0.94 + 0.04 * sigh
    case "sob":
      let u = (t + ph).truncatingRemainder(dividingBy: 0.85) / 0.85
      let k = exp(-u * 9)
      p.x = 0.008 * sin(t * 40)
      p.y = -0.04 + 0.055 * k
      p.sy = 0.95 + 0.07 * k
      p.sx = 1.04 - 0.05 * k
    case "fume":
      p.x = 0.012 * sin(t * 47) + 0.008 * sin(t * 31)
      p.y = 0.005 * sin(t * 37)
      p.scale = 1.04 + 0.015 * sin(t * 6)
      p.sy = 1.03
    case "jump":
      if te < 0.5 {
        let v = te / 0.5
        let s = abs(2 * v - 1)
        p.y = 0.32 * 4 * v * (1 - v)
        p.lift = 4 * v * (1 - v)
        p.sy = 1 + 0.12 * s
        p.sx = 1 - 0.08 * s
      } else {
        let g = te - 0.5
        let sq = 0.16 * exp(-g * 7) * cos(g * 14)
        p.y = 0
        p.sy = 1 - sq
        p.sx = 1 + sq * 0.8
        p.x = 0.005 * sin(t * 33)
      }
    case "shiver":
      p.x = 0.018 * sin(t * 58)
      p.y = -0.03 + 0.006 * sin(t * 43)
      p.rot = 0.02 * sin(t * 41)
    case "tilt":
      let s = sin(t * 0.9 + ph)
      p.y = 0.025 * sin(t * 1.6 + ph)
      p.rot = 0.24 * sign(s) * pow(abs(s), 0.35)
    case "wobble":
      p.x = 0.06 * sin(t * 1.15 + ph)
      p.y = 0.03 * sin(t * 2.3 + ph)
      p.rot = 0.22 * sin(t * 2.3 + ph)
    case "pulse":
      let u = (t + ph).truncatingRemainder(dividingBy: 1)
      let b = exp(-pow(u / 0.07, 2)) + 0.6 * exp(-pow((u - 0.22) / 0.07, 2))
      p.y = 0.03 * sin(t * 1.4 + ph)
      p.rot = 0.05 * sin(t * 1.2 + ph)
      p.scale = 1 + 0.065 * b
    case "lean":
      p.y = 0.02 * sin(t * 1.6 + ph)
      p.rot = -0.11 + 0.02 * sin(t * 1.3 + ph)
    case "hopOnce":
      if te < 0.5 {
        hop(&p, te / 0.7, 0.16, 0.7)
        p.rot = 0.08
      } else {
        p.y = 0.035 * sin(t * 1.7 + ph)
        p.rot = 0.08 + 0.03 * sin(t * 0.9 + ph)
      }
    case "nod":
      p.x = 0.03
      p.y = -0.01 + 0.015 * sin(t * 1.6 + ph) - 0.035 * pow(max(0, sin(t * 4.4)), 6)
      p.rot = -0.08
    case "still":
      p.y = 0.015 * sin(t * 1.3 + ph)
    case "ponder":
      p.y = 0.025 * sin(t * 1.1 + ph)
      p.rot = 0.1 + 0.05 * sin(t * 0.8 + ph)
    case "bob":
      p.y = 0.03 * sin(t * 2.2 + ph)
      p.rot = -0.04 + 0.02 * sin(t * 1.1 + ph)
    case "scan":
      p.x = 0.05 * sin(t * 1.2)
      p.y = 0.015 * sin(t * 2.4)
      p.rot = -0.06 * sin(t * 1.2)
    case "type":
      p.x = 0.004 * sin(t * 23)
      p.y = 0.012 * abs(sin(t * 14))
      p.rot = 0.015 * sin(t * 7)
    case "antic":
      hop(&p, (t + ph).truncatingRemainder(dividingBy: 0.9) / 0.9, 0.06, 0.35)
      p.rot = 0.03 * sin(t * 2 + ph)
    case "tense":
      p.x = 0.006 * sin(t * 31)
      p.y = -0.01
      p.rot = -0.04 + 0.01 * sin(t * 17)
      p.sy = 1.02
    case "groove":
      p.y = 0.035 * abs(sin(t * Double.pi * 2))
      p.rot = 0.08 * sin(t * Double.pi)
      p.sy = 1 - 0.02 * abs(sin(t * Double.pi * 2))
    case "sip":
      p.y = 0.02 * sin(t * 0.9 + ph)
      p.rot = 0.04 * sin(t * 0.6 + ph)
    case "cool":
      p.x = -0.02
      p.y = 0.012 * sin(t * 2.8 + ph)
      p.rot = 0.1 + 0.03 * sin(t * 1.4 + ph)
    default:  // "float", and any name the table does not hold (`MOTION[name] || MOTION.float`)
      p.y = 0.035 * sin(t * 1.7 + ph)
      p.rot = 0.035 * sin(t * 0.9 + ph * 1.3)
    }
    return p
  }

  /// `hopCurve(u, H, air)`: up and down over `air` of the cycle, then a damped squash while it lands.
  static func hop(_ p: inout SparkMotionPose, _ u: Double, _ height: Double, _ air: Double) {
    if u < air {
      let v = u / air
      let s = abs(2 * v - 1)
      p.y = height * 4 * v * (1 - v)
      p.lift = 4 * v * (1 - v)
      p.sy = 1 + 0.07 * s
      p.sx = 1 - 0.05 * s
      return
    }
    let g = (u - air) / (1 - air)
    let sq = 0.13 * exp(-g * 6) * cos(g * 9) - (g > 0.85 ? 0.05 * (g - 0.85) / 0.15 : 0)
    p.y = 0
    p.lift = 0
    p.sy = 1 - sq
    p.sx = 1 + sq * 0.8
  }

  /// `Math.sign`: 1, -1, or the zero itself.
  static func sign(_ value: Double) -> Double { value > 0 ? 1 : value < 0 ? -1 : value }
}
