import CoreGraphics
import SwiftUI

/// Every size on the card, as a function of the reader's text size.
///
/// **Why a pure function and not a `@ScaledMetric`.** The card is a keyboard.
/// Its labels are instrument markings — `CTRL`, `^C`, `PGDN` — and prose type
/// ramps do to them what they would do to the legend on a fader: at
/// `accessibility5` a `@ScaledMetric` mono 9 is 27 pt, and nine of those keys
/// do not fit a phone in any orientation. So the card takes exactly ONE step,
/// at the boundary the system itself calls accessibility (`isAccessibilitySize`),
/// and takes it in the dimension that matters for a key you have to HIT: the
/// row grows 44 → 52 pt and the label 9 → 11 pt. Bigger targets, legible
/// markings, and a rail that is still one row of nine equal keys.
///
/// The design says the number outright (§4's trade-offs: "about 110 pt of
/// chrome whenever the keyboard is up (Rail is 52)"), and §3's card note gives
/// the whole card's two heights — 134 pt, 182 pt at accessibility sizes.
///
/// **Why it is a value and not a view.** A geometry decision that only exists
/// inside a `body` cannot be tested without a simulator, and this is the sort
/// of rule that fails silently: nothing crashes when a key is 44 pt at
/// accessibility5, it is just wrong for the reader who needed it. So the whole
/// step lives here and `InputCardMetricsTests` calls it.
public enum InputCardMetrics {

  // MARK: - The step

  /// The design's row. Nine equal keys across a phone at this height.
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

  /// A key's label: mono 9 heavy, 11 at accessibility sizes.
  ///
  /// Eleven and never more. `CTRL` at 13 pt with the design's 0.08 em tracking
  /// is wider than a ninth of a phone, and the first thing that gives is the
  /// equal-key grid the whole rail is read by.
  public static func labelSize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 11 : 9
  }

  /// A key whose face is an SF Symbol rather than a word — the arrows, the
  /// terminal glyph, `⋯`. It rides one step above the label so a glyph and a
  /// word on the same rail read as the same weight of mark.
  public static func glyphSize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 15 : 13
  }

  /// Send and the mic, the two 15 pt glyphs on the composer row.
  public static func actionGlyphSize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 17 : 15
  }

  /// A fan key's second line, and a combo's — the one-word gloss under `^C`.
  public static func subtitleSize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 9 : 7
  }

  /// The draft's own text. The one prose-sized mono on the card (K-D7), so it
  /// is the one size here that scales as prose rather than as a marking.
  public static func composerTextSize(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 15 : 13
  }

  /// The contextual row above the card: chips are context and the design draws
  /// them shorter than a key, at both steps.
  public static func chipHeight(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 40 : 32
  }

  /// A long-press fan's keys. Shorter than the rail at both steps, for the
  /// reason `KeyFanView` gives: two rows of full-height keys plus the popover's
  /// own chrome would stand taller than the card they belong to.
  public static func fanKeyHeight(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 48 : 40
  }

  /// The `⋯` keypad's keys — five rows of them, so they sit one step under the
  /// rail's.
  public static func keypadKeyHeight(for size: DynamicTypeSize) -> CGFloat {
    size.isAccessibilitySize ? 46 : 38
  }

  /// The whole keypad, which must stay close to a system keyboard's height or
  /// the card jumps when the two swap.
  ///
  /// It grows by five key steps plus the page picker's, because that is what
  /// the Keys page holds; a keypad that grew its keys and not its frame would
  /// clip the latch row, which is the row the design put the Alt latch on.
  public static func keypadHeight(accessibility: Bool) -> CGFloat {
    accessibility ? 312 : 260
  }

  /// The page picker at the top of the keypad.
  public static func keypadHeaderHeight(accessibility: Bool) -> CGFloat {
    accessibility ? 34 : 28
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
