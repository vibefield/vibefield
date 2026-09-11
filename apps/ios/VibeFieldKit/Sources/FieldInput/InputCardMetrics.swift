import CoreGraphics
import SwiftUI

/// Every size on the card, as a function of the reader's text size.
///
/// **Why a pure function and not a `@ScaledMetric`.** The card is a keyboard.
/// Its labels are key faces — `Ctrl`, `Tab`, `^C` — and prose type ramps do to
/// them what they would do to the legend on a fader: at `accessibility5` a
/// `@ScaledMetric` 13 pt label is nearly 40 pt, and nine of those keys do not
/// fit a phone in any orientation. So the card takes exactly ONE step, at the
/// boundary the system itself calls accessibility (`isAccessibilitySize`), and
/// takes it in the dimension that matters for a key you have to HIT: the row
/// grows 44 → 52 pt and the label 13 → 15 pt.
///
/// The design says the number outright (§4's trade-offs: "about 110 pt of
/// chrome whenever the keyboard is up (Rail is 52)").
///
/// **IOS-5v — the base sizes are now the canvas's.** The card wears DESIGN.md's
/// chrome family as the KeyboardLab canvas draws it, so a key's label is SF 13
/// semibold rather than mono 9 heavy, the field is 17/22, a chip is a 36 pt
/// pill and the fan's keys are the rail's own 44. The STEP is unchanged — one
/// step, at the same boundary, for the same reason — and only the floor moved.
///
/// **Why it is a value and not a view.** A geometry decision that only exists
/// inside a `body` cannot be tested without a simulator, and this is the sort
/// of rule that fails silently: nothing crashes when a key is 44 pt at
/// `accessibility5`, it is just wrong for the reader who needed it. So the
/// whole step lives here and `InputCardMetricsTests` calls it.
public enum InputCardMetrics {

  // MARK: - The step

  /// The design's row, and the canvas's `.key` height. Nine equal keys across a
  /// phone at this height. It is also the canvas's `.target`: the 44 pt box a
  /// 28 pt circle is centred in.
  public static let baseRowHeight: CGFloat = 44
  /// The accessibility row (§4's "Rail is 52").
  public static let accessibilityRowHeight: CGFloat = 52

  /// A key's row height — the composer row and the rail both.
  public static func rowHeight(for size: DynamicTypeSize) -> CGFloat {
    rowHeight(accessibility: size.isAccessibilitySize)
  }

  /// The same answer for UIKit, which has a content size CATEGORY rather than
  /// a `DynamicTypeSize` — the keypad's input view is a `UIInputView` and asks
  /// this from `traitCollection`.
  public static func rowHeight(accessibility: Bool) -> CGFloat {
    accessibility ? accessibilityRowHeight : baseRowHeight
  }

  /// A key's label: the canvas's `.key` 13 semibold, 15 at accessibility sizes.
  ///
  /// Fifteen and never more. `Ctrl` at 17 pt is wider than a ninth of a phone,
  /// and the first thing that gives is the equal-key grid the whole rail is
  /// read by.
  public static func labelSize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 15 : 13
  }

  /// A key whose face is an SF Symbol rather than a word — the arrows, the
  /// terminal glyph, `⋯`. The canvas's `.key svg` is 16 square and its
  /// `.key.nav` arrows are set at 15; a symbol rides one step above a word so a
  /// glyph and a label on the same rail read as the same weight of mark.
  public static func glyphSize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 18 : 16
  }

  /// The glyph inside a round control — `.circle svg`, 14 square: `+`, the mic,
  /// Send.
  public static func actionGlyphSize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 16 : 14
  }

  /// A fan key's second line — the one-word gloss under `^C` (`.pk small`).
  public static func subtitleSize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 11 : 9
  }

  /// A combo's second line, which the canvas sets one step above a fan's
  /// because a combo key is wider and carries two words (`.ck small`).
  public static func comboSubtitleSize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 12 : 10
  }

  /// The draft's own text — `.field`, 17/22. The one piece of prose on the
  /// card, so it is the one size here that scales as prose.
  public static func composerTextSize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 20 : 17
  }

  /// The strip's sentence in Live (`.strip`, 15 semibold).
  public static func stripSize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 17 : 15
  }

  /// A `+` menu item (`.mi`, 17 regular) — prose on a floating surface, so it
  /// scales like the draft rather than like a key face.
  public static func menuItemSize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 20 : 17
  }

  /// The contextual row above the card: `.chip` is a 36 pt pill, and it stays
  /// shorter than a key at both steps because it is context rather than an
  /// instrument.
  public static func chipHeight(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 44 : 36
  }

  /// A chip's word (`.chip`, 14 semibold).
  public static func chipLabelSize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 16 : 14
  }

  /// The round control inside a `.target` — `.circle`, 28 pt.
  public static func circleDiameter(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 32 : 28
  }

  /// A long-press fan's keys. The canvas draws `.pk` at the rail's own 44 — a
  /// fan key is a key, and the fan is two rows at most.
  public static func fanKeyHeight(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 52 : 44
  }

  /// The `⋯` keypad's keys. One step under the rail's, because the Keys page is
  /// five rows of them plus a page picker.
  public static func keypadKeyHeight(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 50 : 42
  }

  /// A keypad key's face (`.kb.keypad .key`, 15; a `.special` key's 13 is
  /// `labelSize`).
  public static func keypadKeySize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 17 : 15
  }

  /// The whole keypad, which must stay close to a system keyboard's height or
  /// the card jumps when the two swap. At the base step this is within a few
  /// points of the canvas's own 291 pt keyboard.
  ///
  /// It grows by five key steps plus the page picker's, because that is what
  /// the Keys page holds; a keypad that grew its keys and not its frame would
  /// clip the latch row, which is the row the design put the Alt latch on.
  public static func keypadHeight(accessibility: Bool) -> CGFloat {
    accessibility ? 330 : 284
  }

  /// The page picker at the top of the keypad (`.seg`, 32 pt).
  public static func keypadHeaderHeight(accessibility: Bool) -> CGFloat {
    accessibility ? 38 : 32
  }

  // MARK: - Width

  /// The card's widest, centred in whatever it is given.
  ///
  /// **Why 720 and why at all (IOS-5e's iPad sweep).** The card is a keyboard,
  /// and a keyboard's keys have to be reachable from where the hands are. On a
  /// 13-inch iPad the bottom inset is 1024 pt wide in landscape: nine equal
  /// keys across it are 108 pt each — the size of a button, not a key — and the
  /// arrows land under the middle of the screen, where no thumb is. 720 pt is
  /// the width of the iPad's own floating-keyboard-plus-margins region and
  /// close to a 13-inch phone-sized reading column; at it the rail's keys stay
  /// the size they are on a phone and the row stays one row.
  ///
  /// It is one rule rather than an iPad branch, and it does bite on a phone in
  /// LANDSCAPE, where the inset is ~870 pt wide: there too the card centres at
  /// 720 rather than stretching its nine keys to 97 pt each. That is the same
  /// answer for the same reason, and one rule that is right on both devices
  /// beats a size-class test that can be wrong on either. In portrait, on every
  /// phone, the cap is not a constraint and the card is untouched.
  public static let maximumWidth: CGFloat = 720
}
