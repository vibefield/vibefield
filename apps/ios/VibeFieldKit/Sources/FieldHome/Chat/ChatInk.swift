import FieldDesign
import FieldProduct
import SwiftUI

// IOS-12c (DESIGN.md §8 "The phone's Chat" → the thread; the Mac's `.vf-chat-bubble-chip` and `.vf-chat-reply-text
// code`, at touch pitch) — WORDS WITH THEIR MARKS: a chip you sent, drawn as a chip in your words (padded 1 6, corners
// 6, 14/500 mono, on solid chrome ringed by the strong hairline), and a spark's inline code (padded 1 5, corners 5,
// 15/500 mono, on the fill). A chip is read from the record's spans (UTF-16, as the wire counts them), never from
// words that look like one; spans that don't fit the words draw none, and the words stand as typed.
//
// SwiftUI draws no background behind part of a Text, so a marked run carries `ChatInkMark` and `ChatInkRenderer`
// fills its box before the glyphs. Its side padding is room in the line itself: an en space at twice the padding's
// size (an en is half an em), held to the run by word joiners so a line never breaks between a mark and its room.

/// A marked run of a Text: a chip you sent, or a spark's inline code. `index` keeps two marks side by side apart.
struct ChatInkMark: TextAttribute {
  enum Kind: Hashable {
    case chip
    case code
  }

  let kind: Kind
  let index: Int

  var corners: CGFloat { kind == .chip ? 6 : 5 }
}

enum ChatInk {
  /// Your words in runs: a chip's (`true`) where a span says so. Spans out of order, overlapping or past the words
  /// (`composeChipsFit`'s rule) give one run of the words alone.
  static func runs(_ text: String, chips: [SparkTranscriptChip]) -> [(words: String, chip: Bool)] {
    let units = Array(text.utf16)
    var end = 0
    for chip in chips {
      if chip.start < end || chip.start + chip.length > units.count { return [(text, false)] }
      end = chip.start + chip.length
    }
    var runs: [(words: String, chip: Bool)] = []
    var at = 0
    for chip in chips {
      if chip.start > at { runs.append((String(decoding: units[at..<chip.start], as: UTF16.self), false)) }
      runs.append((String(decoding: units[chip.start..<(chip.start + chip.length)], as: UTF16.self), true))
      at = chip.start + chip.length
    }
    if at < units.count || runs.isEmpty {
      runs.append((String(decoding: units[at...], as: UTF16.self), false))
    }
    return runs
  }

  /// Your words, inked: drawn with `.textRenderer(ChatInkRenderer())`, or the chips are words on nothing.
  static func text(_ text: String, chips: [SparkTranscriptChip]) -> Text {
    var index = 0
    return runs(text, chips: chips).reduce(Text(verbatim: "")) { inked, run in
      guard run.chip else { return Text("\(inked)\(Text(verbatim: run.words))") }
      index += 1
      let chip = marked(Text(verbatim: run.words).font(ChromeType.mono(14, .medium)), .chip, index, room: 6)
      return Text("\(inked)\(chip)")
    }
  }

  /// A mark's run: its words with room either side, `room` points wide, all of it carrying the mark.
  static func marked(_ words: Text, _ kind: ChatInkMark.Kind, _ index: Int, room: CGFloat) -> Text {
    let side = Text(verbatim: "\u{2002}").font(ChromeType.sans(2 * room))
    let joiner = Text(verbatim: "\u{2060}")
    return Text("\(side)\(joiner)\(words)\(joiner)\(side)").customAttribute(ChatInkMark(kind: kind, index: index))
  }
}

/// Draws each marked run's box (its runs on one line joined, padded 1 above and below), then the glyphs over them.
struct ChatInkRenderer: TextRenderer {
  func draw(layout: Text.Layout, in context: inout GraphicsContext) {
    for line in layout {
      var boxes: [(mark: ChatInkMark, box: CGRect)] = []
      for run in line {
        guard let mark = run[ChatInkMark.self] else { continue }
        let box = run.typographicBounds.rect
        if let last = boxes.last, last.mark == mark {
          boxes[boxes.count - 1].box = last.box.union(box)
        } else {
          boxes.append((mark, box))
        }
      }
      for (mark, box) in boxes {
        let shape = Path(roundedRect: box.insetBy(dx: 0, dy: -1), cornerRadius: mark.corners, style: .continuous)
        switch mark.kind {
        case .chip:
          context.fill(shape, with: .color(ChromePalette.menuSurface))
          context.stroke(shape, with: .color(ChromePalette.ruleStrong), lineWidth: 1)
        case .code:
          context.fill(shape, with: .color(ChromePalette.fill))
        }
      }
    }
    for line in layout {
      context.draw(line)
    }
  }
}
