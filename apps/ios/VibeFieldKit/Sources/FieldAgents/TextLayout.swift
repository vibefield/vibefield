// Fitting a body's copy inside its circle — the reference's `text-layout.ts`.
// Pure, so the ellipsis and the chord arithmetic are testable with a fake
// measurer; the renderer supplies the real one from its glyph atlas.

public struct TextStyle: Equatable, Hashable, Sendable {
  /// CSS px, which on the phone are points.
  public var size: Double
  /// 500, 600 or 800 — the three weights the design uses.
  public var weight: Int
  public var italic: Bool
  /// In em, as CSS `letter-spacing`.
  public var letterSpacing: Double
  /// As CSS `text-transform`, applied before measuring.
  public var transform: TextTransform?

  public init(
    size: Double, weight: Int, italic: Bool = false, letterSpacing: Double = 0,
    transform: TextTransform? = nil
  ) {
    self.size = size
    self.weight = weight
    self.italic = italic
    self.letterSpacing = letterSpacing
    self.transform = transform
  }

  public func italicised() -> TextStyle {
    var style = self
    style.italic = true
    return style
  }
}

public enum TextTransform: Equatable, Hashable, Sendable {
  case uppercase
  case lowercase
}

/// Advance width of `text` in points, letter spacing included.
public typealias TextMeasure = @Sendable (String, TextStyle) -> Double

public enum CopyTone: Equatable, Sendable {
  case ink
  case orange
  case green
  case blue
  case accent
}

public struct CopyLead: Equatable, Sendable {
  public enum Kind: Equatable, Sendable {
    /// The unread mark.
    case dot
    /// A sprite the renderer draws by name.
    case icon(String)
    /// The project's tag before the name.
    case bar
  }

  public var kind: Kind
  /// The sprite's height, and its width unless `width` narrows it.
  public var size: Double
  /// The horizontal room the lead takes, for a mark narrower than it is tall.
  public var width: Double?
  /// Space between the lead and the text.
  public var gap: Double
  public var opacity: Double?
  public var tone: CopyTone?

  public init(
    kind: Kind, size: Double, width: Double? = nil, gap: Double, opacity: Double? = nil,
    tone: CopyTone? = nil
  ) {
    self.kind = kind
    self.size = size
    self.width = width
    self.gap = gap
    self.opacity = opacity
    self.tone = tone
  }

  /// The room a lead takes along the line.
  public var advance: Double { width ?? size }
}

public struct CopyLine: Equatable, Sendable {
  public var key: String
  public var text: String
  public var style: TextStyle
  public var opacity: Double
  public var tone: CopyTone
  /// Space above this line.
  public var gapBefore: Double
  /// Line box height as a multiple of the size; the copy's `line-height: 1.05`.
  public var lineHeight: Double?
  /// A mark before the lead: the project's bar stands ahead of the unread dot.
  public var tag: CopyLead?
  public var lead: CopyLead?

  public init(
    key: String, text: String, style: TextStyle, opacity: Double, tone: CopyTone,
    gapBefore: Double = 0, lineHeight: Double? = nil, tag: CopyLead? = nil, lead: CopyLead? = nil
  ) {
    self.key = key
    self.text = text
    self.style = style
    self.opacity = opacity
    self.tone = tone
    self.gapBefore = gapBefore
    self.lineHeight = lineHeight
    self.tag = tag
    self.lead = lead
  }
}

public struct PlacedLine: Equatable, Sendable {
  public var line: CopyLine
  /// The text after fitting, the transform applied.
  public var text: String
  /// Total width, lead included.
  public var width: Double
  public var textWidth: Double
  /// Centre of the line box relative to the body centre, down positive.
  public var y: Double
  public var height: Double
}

public struct CopyLayout: Equatable, Sendable {
  public var lines: [PlacedLine]
  public var top: Double
  public var bottom: Double
}

private let ellipsis = "…"
private let defaultLineHeight = 1.05

public func displayText(_ text: String, _ style: TextStyle) -> String {
  switch style.transform {
  case .uppercase: return text.uppercased()
  case .lowercase: return text.lowercased()
  case nil: return text
  }
}

/// `text-overflow: ellipsis` for one line: the longest prefix plus `…` that fits.
public func fitText(_ text: String, _ style: TextStyle, maxWidth: Double, measure: TextMeasure) -> String {
  let shown = displayText(text, style)
  if maxWidth <= 0 || shown.isEmpty { return "" }
  if measure(shown, style) <= maxWidth { return shown }
  let characters = Array(shown)
  var low = 0
  var high = characters.count - 1
  while low < high {
    let middle = (low + high + 1) >> 1
    let candidate = String(characters[0..<middle]) + ellipsis
    if measure(candidate, style) <= maxWidth {
      low = middle
    } else {
      high = middle - 1
    }
  }
  if low == 0 {
    return measure(ellipsis, style) <= maxWidth ? ellipsis : ""
  }
  return String(characters[0..<low]) + ellipsis
}

/// The widest horizontal span the circle offers to a box spanning `yTop..yBottom`.
public func chordWidth(radius: Double, yTop: Double, yBottom: Double) -> Double {
  let reach = max(abs(yTop), abs(yBottom))
  if reach >= radius { return 0 }
  return 2 * (radius * radius - reach * reach).squareRoot()
}

public func layoutCopy(
  _ lines: [CopyLine], radius: Double, measure: TextMeasure, maxWidthRatio: Double,
  centerY: Double = 0, inset: Double = 2
) -> CopyLayout {
  let heights = lines.map { $0.style.size * ($0.lineHeight ?? defaultLineHeight) }
  let total = zip(lines, heights).reduce(0) { $0 + $1.0.gapBefore + $1.1 }
  let top = centerY - total / 2
  var cursor = top
  var placed: [PlacedLine] = []
  for (line, height) in zip(lines, heights) {
    cursor += line.gapBefore
    let y = cursor + height / 2
    cursor += height
    let leadWidth =
      (line.tag.map { $0.advance + $0.gap } ?? 0) + (line.lead.map { $0.advance + $0.gap } ?? 0)
    let available = min(
      maxWidthRatio * radius * 2,
      chordWidth(radius: radius, yTop: y - height / 2, yBottom: y + height / 2) - inset * 2)
    let text = fitText(line.text, line.style, maxWidth: available - leadWidth, measure: measure)
    let textWidth = text.isEmpty ? 0 : measure(text, line.style)
    let width: Double
    if text.isEmpty, let lead = line.lead, line.tag == nil {
      width = lead.advance
    } else {
      width = textWidth + leadWidth
    }
    placed.append(
      PlacedLine(line: line, text: text, width: width, textWidth: textWidth, y: y, height: height))
  }
  return CopyLayout(lines: placed, top: top, bottom: top + total)
}
