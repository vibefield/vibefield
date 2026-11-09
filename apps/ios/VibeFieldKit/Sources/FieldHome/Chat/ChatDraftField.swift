import FieldDesign
import FieldHistory
import SwiftUI
import UIKit

// IOS-12f's M-f2 (VF-PM 2026-11-09 02:24:16Z, Q1 (a); DESIGN.md §8 "The phone's Chat", the chip) — THE DRAFT'S FIELD:
// a `UITextView` behind `UIViewRepresentable`, as `ComposerField` is, because a SwiftUI `TextField` holds no token in
// its sentence and the kit's floor (iOS 18.1) is under the attributed `TextEditor`. Each chip is one
// `NSTextAttachment`, so Backspace takes it as one character for free. `ChatDraft`'s parts are the truth; the field
// draws them, and reads them back at every edit. It is prose (the system's own autocorrection and punctuation, unlike
// the terminal's composer), Return sends, and it grows to five lines.

/// What a chip's picture was drawn for.
struct ChatDraftLook {
  let scheme: ColorScheme
  let scale: CGFloat
  /// The widest a chip stands: the field's own width, once it has one.
  let width: CGFloat
}

/// A chip in the sentence, at the draft's 17 (DESIGN.md §8, the chip).
struct ChatDraftChipView: View {
  let chip: ChatDraftChip

  static let height: CGFloat = 26
  static let corner: CGFloat = 8

  private var agent: String {
    switch chip {
    case .agent(let agent): agent.agent
    case .session(let session): session.agent
    }
  }

  private var isSession: Bool {
    if case .session = chip { return true }
    return false
  }

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: Self.corner, style: .continuous)
    HStack(spacing: 5) {
      AgentMark(agent: agent, opacity: 1, size: 16)
      Text(ChatDraft.label(chip))
        .font(isSession ? ChromeType.mono(15, .medium) : ChromeType.sans(15, .medium))
        .foregroundStyle(ChromePalette.ink)
        .lineLimit(1)
    }
    .padding(.leading, 6)
    .padding(.trailing, 8)
    .frame(height: Self.height)
    .background(shape.fill(ChromePalette.menuSurface))
    .overlay(shape.strokeBorder(ChromePalette.menuHairline, lineWidth: 1))
  }
}

/// One chip in the text: the part it stands for, and its picture.
final class ChatChipAttachment: NSTextAttachment {
  let chip: ChatDraftChip

  init(chip: ChatDraftChip) {
    self.chip = chip
    super.init(data: nil, ofType: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }
}

struct ChatDraftField: UIViewRepresentable {
  @Binding var parts: [ChatDraftPart]
  /// The caret, counted as `ChatDraft` counts it; nil while the field holds none (not typing, or a range selected).
  @Binding var caret: Int?
  /// The measured height, reported upward so the composer grows with the draft (`ComposerField`).
  @Binding var height: CGFloat
  @Binding var typing: Bool
  let placeholder: String
  let onReturn: () -> Void
  /// A chip was tapped, at its place in the draft.
  let onChip: (Int) -> Void

  static let maximumLines = 5
  static var font: UIFont { .systemFont(ofSize: 17, weight: .regular) }
  static var oneLine: CGFloat { font.lineHeight.rounded(.up) }

  static var attributes: [NSAttributedString.Key: Any] {
    [.font: font, .foregroundColor: UIColor(ChromePalette.ink)]
  }

  /// The parts as the text view's text, each chip drawn for `look`.
  static func attributed(_ parts: [ChatDraftPart], look: ChatDraftLook) -> NSAttributedString {
    let out = NSMutableAttributedString()
    for part in parts {
      switch part {
      case .text(let text):
        out.append(NSAttributedString(string: text))
      case .chip(let chip):
        out.append(NSAttributedString(attachment: attachment(chip, look: look)))
      }
    }
    out.addAttributes(attributes, range: NSRange(location: 0, length: out.length))
    return out
  }

  private static func attachment(_ chip: ChatDraftChip, look: ChatDraftLook) -> ChatChipAttachment {
    let renderer = ImageRenderer(content: ChatDraftChipView(chip: chip).environment(\.colorScheme, look.scheme))
    renderer.scale = look.scale
    renderer.proposedSize = ProposedViewSize(width: look.width > 0 ? look.width : nil, height: nil)
    let attachment = ChatChipAttachment(chip: chip)
    attachment.image = renderer.uiImage
    attachment.accessibilityLabel = ChatDraft.label(chip)
    if let size = attachment.image?.size {
      // centred on the words' capitals, so a line with a chip stands 26 tall
      attachment.bounds = CGRect(x: 0, y: (font.capHeight - size.height) / 2, width: size.width, height: size.height)
    }
    return attachment
  }

  /// The text read back: runs of words, and a part for each chip. A stray object mark (a chip's mark pasted as a
  /// character) is no part, and leaves.
  static func parts(of text: NSAttributedString) -> [ChatDraftPart] {
    var out: [ChatDraftPart] = []
    var run: [UInt16] = []
    func flush() {
      guard !run.isEmpty else { return }
      out.append(.text(String(decoding: run, as: UTF16.self)))
      run = []
    }
    for (index, unit) in text.string.utf16.enumerated() {
      guard unit == 0xFFFC else {
        run.append(unit)
        continue
      }
      flush()
      if let attachment = text.attribute(.attachment, at: index, effectiveRange: nil) as? ChatChipAttachment {
        out.append(.chip(attachment.chip))
      }
    }
    flush()
    return ChatDraft.normalized(out)
  }

  func makeCoordinator() -> Coordinator { Coordinator(field: self) }

  /// The row decides how wide this field is, and the proposal is the width it is about to have (`ComposerField`).
  func sizeThatFits(_ proposal: ProposedViewSize, uiView: ChatDraftTextView, context: Context) -> CGSize? {
    guard let width = proposal.width, width.isFinite, width > 0 else {
      return CGSize(width: proposal.width ?? uiView.bounds.width, height: proposal.height ?? height)
    }
    let measured = context.coordinator.measure(uiView, width: width)
    return CGSize(width: width, height: proposal.height ?? measured)
  }

  func makeUIView(context: Context) -> ChatDraftTextView {
    let view = ChatDraftTextView()
    view.delegate = context.coordinator
    view.returnKeyType = .send
    view.backgroundColor = .clear
    view.isScrollEnabled = false
    view.font = Self.font
    let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
    tap.cancelsTouchesInView = false
    tap.delegate = context.coordinator
    view.addGestureRecognizer(tap)
    return view
  }

  func updateUIView(_ view: ChatDraftTextView, context: Context) {
    let coordinator = context.coordinator
    coordinator.field = self
    let scheme = context.environment.colorScheme
    view.placeholder = placeholder
    view.accessibilityLabel = placeholder
    view.placeholderColor = UIColor(ChromePalette.placeholder)
    view.tintColor = UIColor(ChromePalette.ink)
    view.keyboardAppearance = scheme == .dark ? .dark : .light
    coordinator.apply(
      to: view,
      look: ChatDraftLook(scheme: scheme, scale: context.environment.displayScale, width: view.bounds.width))
    coordinator.reportHeight(of: view)
  }

  @MainActor
  final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
    var field: ChatDraftField
    /// The parts the text stands for; nil while it holds what no part says (a stray mark), so it is drawn again.
    private var shown: [ChatDraftPart]?
    private var built: ChatDraftLook?
    /// The widest chip drawn: the field narrowing past it draws them again, and no other width does.
    private var widest: CGFloat = 0
    /// Set while the field writes its own text: those edits are not the person's.
    private var applying = false
    private var reportedHeight: CGFloat?

    init(field: ChatDraftField) {
      self.field = field
    }

    /// Draw the parts, when they are not what stands: never under a word the keyboard is still composing.
    func apply(to view: ChatDraftTextView, look: ChatDraftLook) {
      let parts = field.parts
      let hasChip = parts.contains { part in
        if case .chip = part { return true }
        return false
      }
      guard shown != parts || (hasChip && stale(look)), view.markedTextRange == nil else { return }
      applying = true
      defer { applying = false }
      let text = ChatDraftField.attributed(parts, look: look)
      view.attributedText = text
      view.typingAttributes = ChatDraftField.attributes
      view.selectedRange = NSRange(location: min(field.caret ?? text.length, text.length), length: 0)
      shown = parts
      built = look
      var drawn: CGFloat = 0
      text.enumerateAttribute(.attachment, in: NSRange(location: 0, length: text.length), options: []) { value, _, _ in
        if let attachment = value as? NSTextAttachment { drawn = max(drawn, attachment.bounds.width) }
      }
      widest = drawn
    }

    private func stale(_ look: ChatDraftLook) -> Bool {
      guard let built else { return true }
      return built.scheme != look.scheme || built.scale != look.scale || (look.width > 0 && widest > look.width)
    }

    /// Return sends: exactly one line break is the press, and a pasted text keeps its breaks.
    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
      guard text == "\n" else { return true }
      field.onReturn()
      return false
    }

    func textViewDidChange(_ textView: UITextView) {
      guard !applying else { return }
      let text: NSAttributedString = textView.attributedText
      let now = ChatDraftField.parts(of: text)
      shown = ChatDraft.length(now) == text.length ? now : nil
      if field.parts != now { field.parts = now }
      reportCaret(of: textView)
      (textView as? ChatDraftTextView)?.refreshPlaceholder()
      reportHeight(of: textView)
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
      guard !applying else { return }
      reportCaret(of: textView)
    }

    func textViewDidBeginEditing(_ textView: UITextView) {
      field.typing = true
      reportCaret(of: textView)
    }

    func textViewDidEndEditing(_ textView: UITextView) {
      field.typing = false
      field.caret = nil
    }

    private func reportCaret(of textView: UITextView) {
      let range = textView.selectedRange
      let now = textView.isFirstResponder && range.length == 0 ? range.location : nil
      if field.caret != now { field.caret = now }
    }

    /// A tap the text view also has: it still places the caret.
    func gestureRecognizer(
      _ gestureRecognizer: UIGestureRecognizer,
      shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
      true
    }

    @objc func tapped(_ recognizer: UITapGestureRecognizer) {
      guard recognizer.state == .ended, let view = recognizer.view as? UITextView else { return }
      let point = recognizer.location(in: view)
      let text: NSAttributedString = view.attributedText
      var found: Int?
      let whole = NSRange(location: 0, length: text.length)
      text.enumerateAttribute(.attachment, in: whole, options: []) { value, range, stop in
        guard value is ChatChipAttachment,
          let start = view.position(from: view.beginningOfDocument, offset: range.location),
          let end = view.position(from: start, offset: 1),
          let span = view.textRange(from: start, to: end),
          view.firstRect(for: span).contains(point)
        else { return }
        found = range.location
        stop.pointee = true
      }
      if let found { field.onChip(found) }
    }

    /// Measure at a width, clamp to one to five lines, and report on the next turn: a binding written during a layout
    /// pass is a mutation inside the update it came from (`ComposerField`).
    @discardableResult
    func measure(_ view: UITextView, width: CGFloat) -> CGFloat {
      guard width > 0 else { return reportedHeight ?? ChatDraftField.oneLine }
      let full = (ChatDraftField.font.lineHeight * CGFloat(ChatDraftField.maximumLines)).rounded(.up)
      let fitted = view.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
      let clamped = min(max(fitted, ChatDraftField.oneLine), full)
      view.isScrollEnabled = fitted > full
      guard reportedHeight != clamped else { return clamped }
      reportedHeight = clamped
      let binding = field.$height
      Task { @MainActor in binding.wrappedValue = clamped }
      return clamped
    }

    func reportHeight(of view: UITextView) {
      guard view.bounds.width > 0 else { return }
      measure(view, width: view.bounds.width)
    }
  }
}

/// A `UITextView` with a placeholder, flush with its own text: the composer's field holds the insets.
final class ChatDraftTextView: UITextView {
  private let placeholderLabel = UILabel()

  var placeholder = "" {
    didSet { placeholderLabel.text = placeholder }
  }

  var placeholderColor: UIColor = .placeholderText {
    didSet { placeholderLabel.textColor = placeholderColor }
  }

  override init(frame: CGRect, textContainer: NSTextContainer?) {
    super.init(frame: frame, textContainer: textContainer)
    textContainerInset = .zero
    self.textContainer.lineFragmentPadding = 0
    placeholderLabel.font = ChatDraftField.font
    placeholderLabel.numberOfLines = 1
    placeholderLabel.translatesAutoresizingMaskIntoConstraints = false
    addSubview(placeholderLabel)
    NSLayoutConstraint.activate([
      placeholderLabel.leadingAnchor.constraint(equalTo: leadingAnchor),
      placeholderLabel.topAnchor.constraint(equalTo: topAnchor),
      placeholderLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override var attributedText: NSAttributedString! {
    didSet { refreshPlaceholder() }
  }

  func refreshPlaceholder() {
    placeholderLabel.isHidden = attributedText.length > 0
  }
}
