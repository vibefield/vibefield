import Foundation

// IOS-12e (PC-D6 A; DESIGN.md §2.10, amended 2026-11-06) — THE NINETEEN STATUSES' RECIPES, transcribed from the
// desktop's vendored engine (`packages/design-kit/src/spark-face/vendor/sparks.js` :62–105, James's Agent Sparks byte
// for byte). A recipe is the pose a status's springs chase, its motion, its gaze and its signs. The engine keeps each
// status as `r` (the pose), `m` (its mouth, for a face that has one) and `b` (what a mouthless face uses instead), and
// `recipe(e, mouthSet)` (:108) resolves it: `r` then `m`, or `r` then `b` and no mouth. Spark faces are the mouthless
// set (James, 2026-10-29). Held field by field to the rows golden's `recipes` (SparkBuddyGoldenTests).
//
// Coding and Debugging are an agent's work and never a spark's face (§2.10), so they are not here.

/// One value of a recipe as the engine writes it: a number, a word (a motion, a gaze, a prop), or numbers (a blink's
/// range, a tint).
public enum SparkRecipeValue: Equatable, Sendable, ExpressibleByFloatLiteral, ExpressibleByIntegerLiteral,
  ExpressibleByStringLiteral, ExpressibleByArrayLiteral
{
  case number(Double)
  case word(String)
  case numbers([Double])

  public init(floatLiteral value: Double) { self = .number(value) }
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
  public init(stringLiteral value: String) { self = .word(value) }
  public init(arrayLiteral elements: Double...) { self = .numbers(elements) }
}

/// A resolved recipe: the engine's `rec`, looked up by key as the engine looks it up.
public struct SparkRecipe: Equatable, Sendable {
  public let fields: [String: SparkRecipeValue]

  public init(fields: [String: SparkRecipeValue]) { self.fields = fields }

  public func number(_ key: String) -> Double? {
    if case .number(let value)? = fields[key] { return value }
    return nil
  }

  /// A word, or nil where the recipe has none (the engine's `r.motion || 'float'` reads nil as its fallback).
  public func word(_ key: String) -> String? {
    if case .word(let value)? = fields[key], !value.isEmpty { return value }
    return nil
  }

  public func numbers(_ key: String) -> [Double]? {
    if case .numbers(let value)? = fields[key] { return value }
    return nil
  }
}

public enum SparkRecipes {
  struct Entry {
    let r: [String: SparkRecipeValue]
    let m: [String: SparkRecipeValue]
    let b: [String: SparkRecipeValue]
  }

  /// The engine's STATUSES, the spark's nineteen (sparks.js :62–105), in its order.
  static let table: [String: Entry] = [
    "ready": Entry(r: ["motion": "float"], m: ["mouth": "smile", "mouthSize": 0.55], b: [:]),
    "listening": Entry(
      r: [
        "eyeScale": 1.1, "eyeHm": 1.04, "perk": 0.3, "stretch": 1.03, "glow": 1.08, "motion": "nod",
        "gaze": "composer", "blink": [3, 6],
      ],
      m: ["mouth": "smile", "mouthSize": 0.62], b: ["eyeScale": 1.16]),
    "sleeping": Entry(
      r: [
        "lidY": -0.5, "droop": 0.5, "soft": 0.5, "stretch": 0.93, "glow": 0.62, "motion": "doze", "prop": "zzz",
        "acc": "nightcap", "gaze": "none", "blink": [99, 99], "badge": "moon",
      ],
      m: ["mouth": "o", "mouthSize": 0.42, "mouthOpen": 0.1], b: [:]),
    "offline": Entry(
      r: [
        "lidY": 0.14, "droop": 0.25, "stretch": 0.95, "glow": 0.2, "desat": 0.9, "lookY": -0.3, "motion": "still",
        "gaze": "none", "blink": [6, 10],
      ],
      m: ["mouth": "flat", "mouthSize": 0.45], b: ["lidY": 0.08]),
    "thinking": Entry(
      r: [
        "lookX": -0.5, "lookY": 0.7, "lidY": 0.92, "lidYR": 0.72, "curl": 0.12, "motion": "ponder", "prop": "thought",
        "gaze": "fixed", "blink": [3, 6], "ring": "spin",
      ],
      m: ["mouth": "smirk", "mouthSize": 0.55], b: ["scaleR": 0.9]),
    "planning": Entry(
      r: [
        "acc": "clipboard", "lookX": 0.5, "lookY": -0.55, "lidY": 0.85, "motion": "bob", "gaze": "fixed",
        "ring": "spin",
      ],
      m: ["mouth": "smile", "mouthSize": 0.45], b: [:]),
    "searching": Entry(
      r: ["acc": "magnifier", "eyeScale": 1.04, "motion": "scan", "gaze": "scan", "ring": "spin"],
      m: ["mouth": "o", "mouthSize": 0.45, "mouthOpen": 0.2], b: [:]),
    "reviewing": Entry(
      r: ["acc": "glasses", "lidY": 0.82, "motion": "still", "gaze": "read", "ring": "spin"],
      m: ["mouth": "flat", "mouthSize": 0.42], b: ["lidAng": 0.12]),
    "running": Entry(
      r: [
        "eyeScale": 1.08, "perk": 0.2, "motion": "antic", "prop": "progress", "gaze": "orbit", "blink": [3, 6],
        "ring": "spin",
      ],
      m: ["mouth": "o", "mouthSize": 0.45, "mouthOpen": 0.4], b: ["eyeScale": 1.14]),
    "focus": Entry(
      r: [
        "acc": "headphones", "lowLid": 0.9, "lidY": 0.9, "glow": 1.05, "motion": "groove", "prop": "notes",
        "gaze": "none", "blink": [99, 99], "ring": "spin",
      ],
      m: ["mouth": "smile", "mouthSize": 0.55], b: [:]),
    "asking": Entry(
      r: [
        "eyeScale": 1.14, "eyeHm": 1.06, "perk": 0.35, "wave": 1, "motion": "tilt", "prop": "question", "gaze": "user",
        "badge": "question", "ring": "pulse",
      ],
      m: ["mouth": "o", "mouthSize": 0.5, "mouthOpen": 0.3], b: ["eyeScale": 1.2, "offYL": 0.025]),
    "approval": Entry(
      r: [
        "eyeScale": 1.2, "eyeWm": 1.12, "lidAng": -0.22, "wave": 0.7, "blush": 0.25, "motion": "sway", "prop": "lock",
        "gaze": "user", "badge": "lock", "ring": "pulse",
      ],
      m: ["mouth": "smile", "mouthSize": 0.5], b: ["eyeScale": 1.28]),
    "stuck": Entry(
      r: [
        "glyph": "spiral", "eyeScale": 1.12, "droop": 0.3, "wiggleAmp": 0.12, "wiggleFreq": 3, "spin": -4.5,
        "motion": "wobble", "prop": "dizzy", "blink": [99, 99], "badge": "exclaim", "ring": "pulse",
      ],
      m: ["mouth": "wavy", "mouthSize": 0.75], b: [:]),
    "limited": Entry(
      r: [
        "acc": "coffee", "lidY": 0.42, "lookX": 0.5, "lookY": -0.35, "droop": 0.15, "glow": 0.9, "motion": "sip",
        "prop": "hourglass", "gaze": "fixed", "badge": "hourglass",
      ],
      m: ["mouth": "flat", "mouthSize": 0.45], b: ["lidY": 0.36]),
    "success": Entry(
      r: [
        "lowLid": 0.85, "eyeWm": 1.12, "perk": 0.5, "stretch": 1.06, "wiggleAmp": 0.05, "wiggleFreq": 5, "glow": 1.2,
        "blush": 0.3, "motion": "hop", "prop": "check", "badge": "check",
      ],
      m: ["mouth": "open", "mouthSize": 0.95, "mouthOpen": 0.8], b: ["lowLid": 0.92]),
    "shipped": Entry(
      r: [
        "acc": "sunglasses", "perk": 0.45, "stretch": 1.05, "glow": 1.3, "motion": "cool", "prop": "confetti",
        "badge": "up",
      ],
      m: ["mouth": "cat", "mouthSize": 0.85], b: [:]),
    "failed": Entry(
      r: [
        "lidAng": -0.5, "lidY": 0.55, "lookY": -0.4, "droop": 0.45, "stretch": 0.94, "glow": 0.85,
        "tint": [1, 0.3, 0.38, 0.4], "tears": 0.35, "motion": "sink", "prop": "cross", "badge": "cross",
      ],
      m: ["mouth": "frown", "mouthSize": 0.8], b: ["tears": 0.55, "lidAng": -0.56]),
    "thanked": Entry(
      r: [
        "glyph": "heart", "eyeScale": 1.18, "blush": 0.9, "soft": 0.6, "perk": 0.15, "tint": [1, 0.42, 0.68, 0.3],
        "glow": 1.15, "motion": "pulse", "prop": "hearts", "blink": [4, 7], "badge": "heart",
      ],
      m: ["mouth": "smile", "mouthSize": 0.8], b: [:]),
    "hello": Entry(
      r: [
        "lowLid": 0.7, "eyeWm": 1.08, "perk": 0.45, "wave": 1, "blush": 0.35, "glow": 1.2, "motion": "hop",
        "prop": "sparkles", "propAmt": 0.7,
      ],
      m: ["mouth": "open", "mouthSize": 0.85, "mouthOpen": 0.7], b: ["lowLid": 0.85]),
  ]

  /// The pose a face holds before its first status (`this.rec = ALL.calm.r`, sparks.js :934): a float.
  static let calm = SparkRecipe(fields: ["motion": "float"])

  /// `recipe(e, mouthSet)`: a status's `r`, then its `m` with a mouth, or its `b` and no mouth. Nil for a status the
  /// table does not hold; the engine's `feel` ignores such a name.
  public static func recipe(_ status: String, mouth: Bool) -> SparkRecipe? {
    guard let entry = table[status] else { return nil }
    if mouth { return SparkRecipe(fields: entry.r.merging(entry.m) { $1 }) }
    var fields = entry.r.merging(entry.b) { $1 }
    fields["mouth"] = "none"
    return SparkRecipe(fields: fields)
  }
}
