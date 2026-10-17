import FieldDesign
import FieldTerminal
import SwiftUI
import UIKit

/// The composer's text field, in UIKit on purpose.
///
/// IOS-5v: it wears the canvas's `.field` — SF 17/22 in `ChromePalette.ink`,
/// the placeholder at 42%, no fill and no hairline of its own. The card's glass
/// is the surface a draft is written on; a box drawn around the text would make
/// the one part of this card that is prose look like a tenth key.
///
/// The kit's Metal view already declares the whole terminal trait set —
/// autocorrection, spell check, smart quotes/dashes/insert and
/// autocapitalization all off — so nothing typed straight into the terminal
/// can be "corrected". A SwiftUI `TextField` would hand back every one of
/// those defaults, and the predictive bar with them: `git status` capitalized,
/// quotes curled, `--flag` turned into an en dash. That regression is the
/// reason this is a `UIViewRepresentable` and not three lines of SwiftUI.
struct ComposerField: UIViewRepresentable {
  let model: InputCardModel
  /// The measured height, reported upward so the card grows with the draft.
  @Binding var height: CGFloat
  let keyboardAppearance: UIKeyboardAppearance
  // --- IOS-5e ---------------------------------------------------------------
  /// The draft's point size, from `InputCardMetrics.composerTextSize`.
  ///
  /// It is passed IN rather than read from the environment here because a
  /// `UIViewRepresentable` has no `body` to read it in, and because the card is
  /// the one place that should decide how big anything on it is.
  let textSize: CGFloat
  // --- end IOS-5e -----------------------------------------------------------

  /// One line at rest, five before it starts scrolling. Past five the draft is
  /// long enough that the terminal underneath matters more than the text.
  static let maximumLines = 5

  func makeCoordinator() -> Coordinator { Coordinator(model: model, height: $height) }

  // --- IOS-5e ---------------------------------------------------------------
  /// The ROW decides how wide this field is. It must never ask.
  ///
  /// **The defect this fixes**, found by IOS-5e's screenshot sweep and visible
  /// in both themes: with a long single-line draft, the whole card overflowed
  /// the screen — the `+` clipped off the left edge, Send off the right, and
  /// the rail's `>_` and `⋯` with them. A `UITextView` with scrolling off has
  /// an intrinsic content size that grows to fit its text on ONE line, and
  /// without a `sizeThatFits` SwiftUI takes that intrinsic width as the
  /// representable's whole answer — as its minimum as well as its ideal. So
  /// the `HStack` could not shrink the field below the width of the sentence
  /// in it, and pushed everything else past both edges.
  ///
  /// Answering the proposal makes the field fully flexible: zero when the row
  /// asks for its minimum, everything when the row asks for its maximum, and
  /// the leftover after the three fixed-width keys in practice.
  ///
  /// It is also where the HEIGHT is measured, for a reason the first fix
  /// exposed: `updateUIView` runs BEFORE layout, so `view.bounds.width` there
  /// is the width from the last pass — which, on the pass that first narrows
  /// this field, is the old wide one. Measured there, a wrapping sentence
  /// still reports one line and the field clips its own text instead of
  /// growing. The proposal is the width this view is ABOUT to have, so it is
  /// the only honest thing to measure against.
  func sizeThatFits(
    _ proposal: ProposedViewSize, uiView: InputTextView, context: Context
  ) -> CGSize? {
    // `.zero` and `.infinity` are SwiftUI asking how flexible this view is, not
    // how tall it would be at a real width. Answer the width; measure nothing.
    guard let width = proposal.width, width.isFinite, width > 0 else {
      return CGSize(
        width: proposal.width ?? uiView.bounds.width, height: proposal.height ?? height)
    }
    let measured = context.coordinator.measure(uiView, width: width)
    return CGSize(width: width, height: proposal.height ?? measured)
  }
  // --- end IOS-5e -----------------------------------------------------------

  func makeUIView(context: Context) -> InputTextView {
    let view = InputTextView()
    view.delegate = context.coordinator
    // The kit's trait set, copied rather than approximated.
    view.autocorrectionType = .no
    view.spellCheckingType = .no
    view.smartQuotesType = .no
    view.smartDashesType = .no
    view.smartInsertDeleteType = .no
    view.autocapitalizationType = .none
    view.keyboardType = .default
    // Return inserts a newline; Send is a button. A `.send` return key would
    // put two different commits on the same gesture.
    view.returnKeyType = .default
    view.inputAccessoryView = nil
    view.backgroundColor = .clear
    view.isScrollEnabled = false
    // IOS-5v: the canvas's own copy, verbatim (`.field .ph`), in sentence case.
    view.placeholder = "Message the agent…"
    view.text = model.draft
    // --- IOS-5e ---------------------------------------------------------------
    // The field's spoken name. VoiceOver reads a text view's placeholder as
    // its value, not its label — so without this the composer announces itself
    // as "text field" and nothing else. It is set on the UIKit view rather than
    // as a SwiftUI modifier because the `UITextView` is its own accessibility
    // element and a label hung on the representable does not always reach it.
    view.accessibilityLabel = "Message or command"
    // --- end IOS-5e -----------------------------------------------------------
    return view
  }

  func updateUIView(_ view: InputTextView, context: Context) {
    context.coordinator.model = model
    view.keyboardAppearance = keyboardAppearance
    // --- IOS-5e: the reader's text size reached the card, and the draft is the
    // one thing on it that is prose. The placeholder follows the same size, or
    // the empty field would be a different type ramp from the full one.
    view.applyTextSize(textSize)
    // --- end IOS-5e
    view.textColor = UIColor(ChromePalette.ink)
    view.tintColor = UIColor(ChromePalette.ink)
    view.placeholderColor = UIColor(ChromePalette.placeholder)
    // The model is the draft's owner: `tapSend` clears it, and the field has
    // to follow rather than hold the last thing it rendered.
    if view.text != model.draft {
      view.text = model.draft
      view.refreshPlaceholder()
    }
    context.coordinator.applyFocus(model.responderRole(for: .composer), to: view)
    // --- IOS-5d: the `⋯` keypad rises in the system keyboard's place.
    // --- IOS-5e: and it is told the reader's text size, because its height
    // depends on it and a `UIInputView` that is not in a window yet cannot ask.
    context.coordinator.applyKeypad(
      model.keypadShown && model.mode == .draft,
      accessibility: context.environment.dynamicTypeSize.isAccessibilitySize,
      to: view)
    // --- end IOS-5e
    // --- end IOS-5d
    context.coordinator.reportHeight(of: view)
  }

  @MainActor
  final class Coordinator: NSObject, UITextViewDelegate {
    var model: InputCardModel
    private let height: Binding<CGFloat>
    /// The focus intent last acted on — see `TerminalSurface.applyFocus`; the
    /// same rule holds here, for the same reason.
    private var appliedFocus: ResponderRole?
    private var reportedHeight: CGFloat?
    // --- IOS-5d ------------------------------------------------------------
    /// The keypad, made once and kept.
    ///
    /// Rebuilding it per toggle would throw away the SwiftUI hosting
    /// controller that draws it — and with it the page the design says the
    /// keypad remembers.
    private var keypad: KeypadInputView?
    private var appliedKeypad: Bool?
    // --- end IOS-5d ----------------------------------------------------------

    init(model: InputCardModel, height: Binding<CGFloat>) {
      self.model = model
      self.height = height
    }

    /// A single typed character while the latch is armed is a control byte,
    /// not text — and the character must not ALSO land in the draft, which is
    /// what returning false here prevents.
    ///
    /// Newlines are deliberately exempt: `.character("\n")` has no key on this
    /// layout, so intercepting Return would swallow it and give nothing back.
    /// A latched Return is a keystroke IOS-5b's Live path owns.
    func textView(
      _ textView: UITextView,
      shouldChangeTextIn range: NSRange,
      replacementText text: String
    ) -> Bool {
      guard range.length == 0, text.count == 1, let character = text.first,
        !character.isNewline
      else { return true }
      return !model.interceptCharacter(character)
    }

    func textViewDidChange(_ textView: UITextView) {
      model.draft = textView.text
      (textView as? InputTextView)?.refreshPlaceholder()
      reportHeight(of: textView)
    }

    func textViewDidBeginEditing(_ textView: UITextView) {
      appliedFocus = .take
      model.fieldFocused = true
    }

    func textViewDidEndEditing(_ textView: UITextView) {
      appliedFocus = .release
      // Only Draft's field reports its own loss: in Live the terminal took the
      // keyboard on purpose, and saying "the field lost focus" there would
      // fight the mode for ownership of the same flag.
      if model.mode == .draft { model.fieldFocused = false }
    }

    /// Responder changes ride the next main turn — a keyboard raised from
    /// inside a SwiftUI update pass resizes this view's own ancestors mid-pass.
    /// A yield is no call: the new owner's take moves the keyboard
    /// (`ResponderRole`).
    func applyFocus(_ role: ResponderRole, to view: UITextView) {
      guard appliedFocus != role else { return }
      appliedFocus = role
      guard role != .yield else { return }
      Task { @MainActor in
        if role == .take {
          guard !view.isFirstResponder else { return }
          view.becomeFirstResponder()
        } else if view.isFirstResponder {
          view.resignFirstResponder()
        }
      }
    }

    // --- IOS-5d ------------------------------------------------------------
    /// Swap the keyboard for our keypad, or back.
    ///
    /// This is Draft's whole half of K-D5: the field is OURS, so replacing
    /// what rises under it is one property. (Live has no such field — the
    /// Metal view is `final` and exposes no input view — which is why the
    /// other half is a hidden responder.)
    ///
    /// `reloadInputViews` is what makes the swap visible while the keyboard is
    /// already up, and it is deferred for the same reason the responder calls
    /// are: it re-lays the keyboard, and doing that inside a SwiftUI update
    /// pass resizes this view's own ancestors mid-pass.
    func applyKeypad(_ wanted: Bool, accessibility: Bool, to view: UITextView) {
      // IOS-5e: a text-size change while the keypad is already up is its own
      // reason to reload — the keyboard keeps whatever frame it committed until
      // it is asked again.
      var sizeChanged = false
      if let keypad, keypad.isAccessibilitySize != accessibility {
        keypad.isAccessibilitySize = accessibility
        sizeChanged = true
      }
      guard appliedKeypad != wanted || sizeChanged else { return }
      if appliedKeypad != wanted {
        appliedKeypad = wanted
        if wanted {
          if keypad == nil {
            keypad = KeypadInputView(model: model, isAccessibilitySize: accessibility)
          }
          view.inputView = keypad
        } else {
          view.inputView = nil
        }
      }
      Task { @MainActor in
        guard view.isFirstResponder else { return }
        view.reloadInputViews()
      }
    }
    // --- end IOS-5d ----------------------------------------------------------

    /// Measure at a width, clamp to the 1→5-line range, and report — on the
    /// next turn, because a binding written during a layout pass is a mutation
    /// inside the update it came from.
    ///
    /// IOS-5e made the width a PARAMETER rather than reading `view.bounds`:
    /// `sizeThatFits` knows the width this view is about to have, and
    /// `updateUIView` only knows the width it used to have. Both call in here.
    @discardableResult
    func measure(_ view: UITextView, width: CGFloat) -> CGFloat {
      guard let font = view.font, width > 0 else { return reportedHeight ?? 0 }
      let chrome = view.textContainerInset.top + view.textContainerInset.bottom
      let oneLine = (chrome + font.lineHeight).rounded(.up)
      let full = (chrome + font.lineHeight * CGFloat(maximumLines)).rounded(.up)
      let fitted = view.sizeThatFits(
        CGSize(width: width, height: .greatestFiniteMagnitude)
      ).height
      let clamped = min(max(fitted, oneLine), full)
      view.isScrollEnabled = fitted > full
      guard reportedHeight != clamped else { return clamped }
      reportedHeight = clamped
      let binding = height
      Task { @MainActor in binding.wrappedValue = clamped }
      return clamped
    }

    /// The typing path: the view is laid out by now, so its own bounds are the
    /// width to measure against.
    func reportHeight(of view: UITextView) {
      guard view.bounds.width > 0 else { return }
      measure(view, width: view.bounds.width)
    }
  }
}

/// A `UITextView` with a placeholder, which UIKit still does not give one.
final class InputTextView: UITextView {
  var placeholder: String = "" {
    didSet {
      placeholderLabel.text = placeholder
      refreshPlaceholder()
    }
  }

  var placeholderColor: UIColor = .placeholderText {
    didSet { placeholderLabel.textColor = placeholderColor }
  }

  private let placeholderLabel = UILabel()

  /// The text inset is set HERE rather than by the caller, because the
  /// placeholder is pinned against it: setting it afterwards left the label at
  /// the old inset and the placeholder rendered half a character left of the
  /// caret, clipped by the field's own edge.
  /// IOS-5v: the canvas's `.field` padding — `5px 6px` around 17/22 text, which
  /// centres one line in the 44 pt row the `.target`s beside it stand in.
  static let inset = UIEdgeInsets(top: 11, left: 6, bottom: 11, right: 6)

  override init(frame: CGRect, textContainer: NSTextContainer?) {
    super.init(frame: frame, textContainer: textContainer)
    textContainerInset = Self.inset
    self.textContainer.lineFragmentPadding = 0
    font = .systemFont(ofSize: ChromeType.fieldSize, weight: .regular)
    placeholderLabel.font = .systemFont(ofSize: ChromeType.fieldSize, weight: .regular)
    placeholderLabel.numberOfLines = 1
    placeholderLabel.translatesAutoresizingMaskIntoConstraints = false
    addSubview(placeholderLabel)
    NSLayoutConstraint.activate([
      placeholderLabel.leadingAnchor.constraint(
        equalTo: leadingAnchor, constant: Self.inset.left),
      placeholderLabel.topAnchor.constraint(equalTo: topAnchor, constant: Self.inset.top),
      placeholderLabel.trailingAnchor.constraint(
        lessThanOrEqualTo: trailingAnchor, constant: -Self.inset.right),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override var text: String! {
    didSet { refreshPlaceholder() }
  }

  func refreshPlaceholder() {
    placeholderLabel.isHidden = !(text ?? "").isEmpty
  }

  // --- IOS-5e ---------------------------------------------------------------
  /// Take the card's text size, for the draft and the placeholder together.
  ///
  /// Guarded on the current size because setting `font` on a `UITextView`
  /// re-lays its whole text storage, and `updateUIView` runs on every card
  /// update — a re-layout per keystroke would be a stutter with no cause on
  /// screen.
  func applyTextSize(_ size: CGFloat) {
    guard font?.pointSize != size else { return }
    font = .systemFont(ofSize: size, weight: .regular)
    placeholderLabel.font = .systemFont(ofSize: size, weight: .regular)
  }
  // --- end IOS-5e -----------------------------------------------------------
}
