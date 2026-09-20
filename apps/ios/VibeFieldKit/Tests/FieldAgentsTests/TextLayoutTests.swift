import Testing

@testable import FieldAgents

// The reference's `text-layout.test.ts`, transcribed.

/// A monospace stand-in: every character is 0.6 em wide, plus the letter spacing.
private func measure(_ text: String, _ style: TextStyle) -> Double {
  let count = Double(text.count)
  return count * style.size * 0.6 + count * style.letterSpacing * style.size
}

private let name = TextStyle(size: 10, weight: 800)
private let label = TextStyle(size: 10, weight: 800, letterSpacing: 0.1, transform: .uppercase)

@Suite struct FitTextTests {
  @Test func returnsTheTextUntouchedWhenItFits() {
    #expect(fitText("puppeteer", name, maxWidth: 60, measure: measure) == "puppeteer")
  }

  @Test func cutsToTheLongestPrefixPlusAnEllipsis() {
    // 6 characters × 6px = 36px: five letters and the ellipsis.
    #expect(fitText("puppeteer", name, maxWidth: 36, measure: measure) == "puppe…")
  }

  @Test func appliesTheCaseTransformBeforeMeasuring() {
    #expect(fitText("fable 5.1", label, maxWidth: 200, measure: measure) == "FABLE 5.1")
    var lower = label
    lower.transform = .lowercase
    #expect(fitText("Fable 5.1 · High", lower, maxWidth: 200, measure: measure) == "fable 5.1 · high")
  }

  @Test func degradesToTheEllipsisAloneThenToNothing() {
    #expect(fitText("puppeteer", name, maxWidth: 6, measure: measure) == "…")
    #expect(fitText("puppeteer", name, maxWidth: 0, measure: measure) == "")
  }
}

@Suite struct ChordWidthTests {
  @Test func isTheDiameterOnTheCentreLineAndNothingAtTheRim() {
    #expect(abs(chordWidth(radius: 40, yTop: -5, yBottom: 5) - 2 * (40.0 * 40 - 25).squareRoot()) < 1e-6)
    #expect(chordWidth(radius: 40, yTop: 0, yBottom: 0) == 80)
    #expect(chordWidth(radius: 40, yTop: 30, yBottom: 40) == 0)
  }
}

@Suite struct LayoutCopyTests {
  private let lines: [CopyLine] = [
    CopyLine(key: "name", text: "puppeteer", style: name, opacity: 1, tone: .ink),
    CopyLine(key: "model", text: "fable 5.1", style: label, opacity: 0.58, tone: .ink, gapBefore: 3),
  ]

  @Test func stacksTheBlockAroundTheCentreWithTheDeclaredGaps() {
    let layout = layoutCopy(lines, radius: 40, measure: measure, maxWidthRatio: 0.84)
    // 10.5 + 3 + 10.5 = 24px tall, centred: top −12, bottom 12.
    #expect(abs(layout.top - -12) < 1e-6)
    #expect(abs(layout.bottom - 12) < 1e-6)
    #expect(abs(layout.lines[0].y - (-12 + 5.25)) < 1e-6)
    #expect(abs(layout.lines[1].y - (-12 + 10.5 + 3 + 5.25)) < 1e-6)
    #expect(layout.lines[1].text == "FABLE 5.1")
  }

  @Test func fitsEachLineToTheNarrowerOfTheMaxWidthAndTheCircleChord() {
    let layout = layoutCopy(
      [CopyLine(key: "name", text: "a very long folder name indeed", style: name, opacity: 1, tone: .ink)],
      radius: 20, measure: measure, maxWidthRatio: 0.84, inset: 2)
    let line = layout.lines[0]
    #expect(line.text.hasSuffix("…"))
    #expect(line.textWidth <= 0.84 * 40)
  }

  @Test func givesAMarkNarrowerThanItIsTallOnlyItsOwnWidth() {
    let measure: TextMeasure = { text, _ in Double(text.count) * 6 }
    // The project's folder: a 14pt sprite that takes 11pt of the line.
    let line = CopyLine(
      key: "name", text: "abc", style: TextStyle(size: 12, weight: 800), opacity: 1, tone: .ink,
      lead: CopyLead(kind: .icon("folder"), size: 14, width: 11, gap: 4, tone: .accent))
    let placed = layoutCopy([line], radius: 60, measure: measure, maxWidthRatio: 0.9).lines[0]
    #expect(placed.width == 18 + 11 + 4)
  }

  @Test func reservesRoomForALeadMarkAndReportsTheFullWidth() {
    let layout = layoutCopy(
      [
        CopyLine(
          key: "name", text: "jabali", style: name, opacity: 1, tone: .ink,
          lead: CopyLead(kind: .dot, size: 5, gap: 4))
      ],
      radius: 40, measure: measure, maxWidthRatio: 0.84)
    let line = layout.lines[0]
    #expect(line.textWidth == 36)
    #expect(line.width == 45)
  }

  @Test func letsAMarkOnlyLineCarryJustItsLead() {
    let layout = layoutCopy(
      [
        CopyLine(
          key: "folder", text: "", style: name, opacity: 0.6, tone: .ink,
          lead: CopyLead(kind: .icon("folder"), size: 14, gap: 0))
      ],
      radius: 40, measure: measure, maxWidthRatio: 0.84)
    #expect(layout.lines[0].width == 14)
  }
}
