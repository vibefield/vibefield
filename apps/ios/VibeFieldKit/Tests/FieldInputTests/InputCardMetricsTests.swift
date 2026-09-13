import FieldDesign
import SwiftUI
import Testing

@testable import FieldInput

/// The card's one size step, pinned.
///
/// Dynamic Type is the accessibility rule that fails SILENTLY: nothing crashes
/// when a key stays 44 pt at `accessibility5`, it is simply wrong for the one
/// reader who asked for it, and no screenshot at the default size can show
/// that. So the whole step is a pure function and this suite calls it at every
/// size the system has.
///
/// IOS-5v moved the FLOOR of every one of these to the KeyboardLab canvas's own
/// values — the card wears DESIGN.md's chrome family now — and left the step
/// itself exactly where it was: one step, at `isAccessibilitySize`, 44 → 52.
@Suite("the card's metrics")
struct InputCardMetricsTests {

  /// Every size below the accessibility boundary, and every one at or above it.
  /// Written out rather than derived from `isAccessibilitySize` — a test that
  /// asks the same question as the code it is testing proves nothing.
  private static let ordinary: [DynamicTypeSize] = [
    .xSmall, .small, .medium, .large, .xLarge, .xxLarge, .xxxLarge,
  ]
  private static let accessibility: [DynamicTypeSize] = [
    .accessibility1, .accessibility2, .accessibility3, .accessibility4, .accessibility5,
  ]

  @Test("the rail is 44 pt at every ordinary size", arguments: ordinary)
  func ordinaryRow(_ size: DynamicTypeSize) {
    #expect(InputCardMetrics.rowHeight(for: size) == 44)
  }

  /// §4's trade-offs say it outright: "about 110 pt of chrome whenever the
  /// keyboard is up (Rail is 52)".
  @Test("the rail is 52 pt at every accessibility size", arguments: accessibility)
  func accessibilityRow(_ size: DynamicTypeSize) {
    #expect(InputCardMetrics.rowHeight(for: size) == 52)
  }

  /// One step and only one. `accessibility5` is not bigger than
  /// `accessibility1`: a rail is nine keys wide and there is no width for a
  /// ramp, so the card takes the step the system asks for and then stops.
  @Test("there is exactly one step, not a ramp")
  func oneStep() {
    let heights = Set(
      (Self.ordinary + Self.accessibility).map { InputCardMetrics.rowHeight(for: $0) })
    #expect(heights == [44, 52])
    let labels = Set(
      (Self.ordinary + Self.accessibility).map { InputCardMetrics.labelSize(for: $0) })
    #expect(labels == [13, 15])
  }

  /// Key faces, not prose. Fifteen is the ceiling the design's own grid can
  /// carry — `Ctrl` at 17 pt is wider than a ninth of a phone, and the
  /// equal-key rail is what the rule protects.
  @Test("a key's label never passes 15 pt", arguments: ordinary + accessibility)
  func labelCeiling(_ size: DynamicTypeSize) {
    #expect(InputCardMetrics.labelSize(for: size) <= 15)
  }

  /// Every size on the card moves together or not at all. A row that grew while
  /// its label did not would be a key with a hole in it, and a label that grew
  /// while its row did not would be a label that clips.
  @Test("nothing shrinks when the reader asks for bigger", arguments: accessibility)
  func nothingShrinks(_ size: DynamicTypeSize) {
    #expect(InputCardMetrics.rowHeight(for: size) > InputCardMetrics.rowHeight(for: .large))
    #expect(InputCardMetrics.labelSize(for: size) > InputCardMetrics.labelSize(for: .large))
    #expect(InputCardMetrics.glyphSize(for: size) > InputCardMetrics.glyphSize(for: .large))
    #expect(
      InputCardMetrics.chipHeight(for: size) > InputCardMetrics.chipHeight(for: .large))
    #expect(
      InputCardMetrics.fanKeyHeight(for: size) > InputCardMetrics.fanKeyHeight(for: .large))
    #expect(
      InputCardMetrics.keypadKeyHeight(for: size)
        > InputCardMetrics.keypadKeyHeight(for: .large))
    #expect(
      InputCardMetrics.composerTextSize(for: size)
        > InputCardMetrics.composerTextSize(for: .large))
    #expect(
      InputCardMetrics.subtitleSize(for: size) > InputCardMetrics.subtitleSize(for: .large))
    #expect(
      InputCardMetrics.comboSubtitleSize(for: size)
        > InputCardMetrics.comboSubtitleSize(for: .large))
    #expect(
      InputCardMetrics.circleDiameter(for: size)
        > InputCardMetrics.circleDiameter(for: .large))
    #expect(InputCardMetrics.stripSize(for: size) > InputCardMetrics.stripSize(for: .large))
    #expect(
      InputCardMetrics.chipLabelSize(for: size) > InputCardMetrics.chipLabelSize(for: .large))
    #expect(
      InputCardMetrics.menuItemSize(for: size) > InputCardMetrics.menuItemSize(for: .large))
    #expect(
      InputCardMetrics.keypadKeySize(for: size) > InputCardMetrics.keypadKeySize(for: .large))
  }

  /// The proportions the card is read by, at both steps: a chip is context and
  /// stays shorter than a key; a fan key is a key and stands exactly as tall as
  /// the rail's; a keypad key is under both, because the Keys page is five rows
  /// of them plus a picker.
  @Test("the card's own ranking holds at both steps", arguments: [false, true])
  func ranking(_ accessibility: Bool) {
    let size: DynamicTypeSize = accessibility ? .accessibility3 : .large
    let row = InputCardMetrics.rowHeight(for: size)
    #expect(InputCardMetrics.chipHeight(for: size) < row)
    #expect(InputCardMetrics.fanKeyHeight(for: size) == row)
    #expect(InputCardMetrics.keypadKeyHeight(for: size) < InputCardMetrics.fanKeyHeight(for: size))
    // A circle is drawn INSIDE a 44 pt target and must never fill it: the air
    // around it is what makes the composer row read as three controls rather
    // than as three more keys.
    #expect(InputCardMetrics.circleDiameter(for: size) < row)
  }

  /// IOS-5v: the canvas's own base sizes, pinned against the shared geometry
  /// tokens so a change to either has to be a change to both.
  ///
  /// These are the numbers a reader can check against the artboard: the card is
  /// `.glass.card` at 26, a key is `.key` at 44 pt and radius 9, a chip is a
  /// 36 pt `.chip` pill, a `.circle` is 28 inside a 44 pt `.target`.
  @Test("the base sizes are the canvas's")
  func canvasBaseSizes() {
    #expect(InputCardMetrics.rowHeight(for: .large) == 44)
    #expect(InputCardMetrics.chipHeight(for: .large) == 36)
    #expect(InputCardMetrics.circleDiameter(for: .large) == 28)
    #expect(InputCardMetrics.labelSize(for: .large) == 13)
    #expect(InputCardMetrics.composerTextSize(for: .large) == 17)
    #expect(ChromeRadius.card == 26)
    #expect(ChromeRadius.key == 9)
    #expect(ChromeRadius.keypadKey == 7)
    // A 36 pt pill IS radius 18 — the chip token and the chip height are one
    // fact said twice, and this is where they are held together.
    #expect(ChromeRadius.chip == InputCardMetrics.chipHeight(for: .large) / 2)
  }

  /// The UIKit door, which the keypad's `UIInputView` uses because it has a
  /// content size CATEGORY and no `DynamicTypeSize`. Both doors must answer the
  /// same thing or the keypad and the card would step apart.
  @Test("the UIKit and SwiftUI doors agree")
  func doorsAgree() {
    #expect(InputCardMetrics.rowHeight(accessibility: false) == InputCardMetrics.rowHeight(for: .large))
    #expect(
      InputCardMetrics.rowHeight(accessibility: true)
        == InputCardMetrics.rowHeight(for: .accessibility1))
  }

  /// The keypad's frame grows with its keys. Five rows plus the picker: a frame
  /// that stayed at 260 pt would clip the last row, and the last row is the one
  /// carrying the Alt latch.
  @Test("the keypad's frame grows with its keys")
  func keypadFrame() {
    let base = InputCardMetrics.keypadHeight(accessibility: false)
    let large = InputCardMetrics.keypadHeight(accessibility: true)
    #expect(base == TerminalKeypad.height)
    let keyGrowth =
      InputCardMetrics.keypadKeyHeight(for: .accessibility1)
      - InputCardMetrics.keypadKeyHeight(for: .large)
    let headerGrowth =
      InputCardMetrics.keypadHeaderHeight(accessibility: true)
      - InputCardMetrics.keypadHeaderHeight(accessibility: false)
    // Five key rows on the Keys page, plus the page picker.
    #expect(large - base >= keyGrowth * 5 + headerGrowth)
  }

  /// The iPad rule (and a landscape phone's). It has to be wider than the
  /// widest phone in portrait, or it would reshape the device the card was
  /// designed on, and narrower than an iPad's landscape inset, or it would do
  /// nothing at all.
  @Test("the width cap is a cap on tablets and never on a portrait phone")
  func widthCap() {
    #expect(InputCardMetrics.maximumWidth == 720)
    #expect(InputCardMetrics.maximumWidth > 440)  // the widest phone in portrait
    #expect(InputCardMetrics.maximumWidth < 1024)  // a 13-inch iPad in landscape
  }
}
