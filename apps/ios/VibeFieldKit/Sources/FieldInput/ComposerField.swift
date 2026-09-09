import FieldDesign
import SwiftUI
import UIKit

/// The composer's text field, in UIKit on purpose.
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

  /// One line at rest, five before it starts scrolling. Past five the draft is
  /// long enough that the terminal underneath matters more than the text.
  static let maximumLines = 5

  func makeCoordinator() -> Coordinator { Coordinator(model: model, height: $height) }

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
    view.placeholder = "message or command"
    view.text = model.draft
    return view
  }

  func updateUIView(_ view: InputTextView, context: Context) {
    context.coordinator.model = model
    view.keyboardAppearance = keyboardAppearance
    view.textColor = UIColor(FieldPalette.textMain)
    view.tintColor = UIColor(FieldPalette.textMain)
    view.placeholderColor = UIColor(FieldPalette.textFaint)
    // The model is the draft's owner: `tapSend` clears it, and the field has
    // to follow rather than hold the last thing it rendered.
    if view.text != model.draft {
      view.text = model.draft
      view.refreshPlaceholder()
    }
    context.coordinator.applyFocus(model.fieldFocused, to: view)
    context.coordinator.reportHeight(of: view)
  }

  @MainActor
  final class Coordinator: NSObject, UITextViewDelegate {
    var model: InputCardModel
    private let height: Binding<CGFloat>
    /// The focus intent last acted on — see `TerminalSurface.applyFocus`; the
    /// same rule holds here, for the same reason.
    private var appliedFocus: Bool?
    private var reportedHeight: CGFloat?

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
      appliedFocus = true
      model.fieldFocused = true
    }

    func textViewDidEndEditing(_ textView: UITextView) {
      appliedFocus = false
      // Only Draft's field reports its own loss: in Live the terminal took the
      // keyboard on purpose, and saying "the field lost focus" there would
      // fight the mode for ownership of the same flag.
      if model.mode == .draft { model.fieldFocused = false }
    }

    /// Responder changes ride the next main turn — a keyboard raised from
    /// inside a SwiftUI update pass resizes this view's own ancestors mid-pass.
    func applyFocus(_ wanted: Bool, to view: UITextView) {
      guard appliedFocus != wanted else { return }
      appliedFocus = wanted
      Task { @MainActor in
        if wanted {
          guard !view.isFirstResponder else { return }
          view.becomeFirstResponder()
        } else if view.isFirstResponder {
          view.resignFirstResponder()
        }
      }
    }

    /// Measure, clamp, and report — on the next turn, because a binding written
    /// during `updateUIView` is a mutation inside the update it came from.
    func reportHeight(of view: UITextView) {
      guard let font = view.font, view.bounds.width > 0 else { return }
      let chrome = view.textContainerInset.top + view.textContainerInset.bottom
      let oneLine = (chrome + font.lineHeight).rounded(.up)
      let full = (chrome + font.lineHeight * CGFloat(maximumLines)).rounded(.up)
      let fitted = view.sizeThatFits(
        CGSize(width: view.bounds.width, height: .greatestFiniteMagnitude)
      ).height
      let clamped = min(max(fitted, oneLine), full)
      view.isScrollEnabled = fitted > full
      guard reportedHeight != clamped else { return }
      reportedHeight = clamped
      let binding = height
      Task { @MainActor in binding.wrappedValue = clamped }
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
  static let inset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)

  override init(frame: CGRect, textContainer: NSTextContainer?) {
    super.init(frame: frame, textContainer: textContainer)
    textContainerInset = Self.inset
    self.textContainer.lineFragmentPadding = 0
    font = .monospacedSystemFont(ofSize: 13, weight: .regular)
    placeholderLabel.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
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
}
