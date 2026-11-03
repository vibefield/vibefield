import FieldTerminal
import Observation
import SwiftUI
import UIKit

/// Docked system-keyboard measurements belong to the card, so Draft and Live
/// use the same size when handing their input views to each other. Floating
/// keyboards and hardware-keyboard accessory bars never replace this measurement.
@MainActor
@Observable
final class KeypadGeometry {
  private(set) var height: CGFloat = 308
  private(set) var bottomInset: CGFloat = 34
  private(set) var hasNativeMeasurement = false
  @ObservationIgnored private var viewport = CGSize.zero
  @ObservationIgnored private var measured: [String: CGFloat] = [:]

  private var key: String { "\(Int(viewport.width.rounded()))x\(Int(viewport.height.rounded()))" }

  func updateViewport(_ size: CGSize, bottomInset: CGFloat) {
    guard size.width > 0, size.height > 0 else { return }
    if self.bottomInset != bottomInset { self.bottomInset = bottomInset }
    guard viewport != size else { return }
    viewport = size
    // Used only before this window size has shown a native keyboard. Once it
    // has, UIKit's actual measurement wins, including language/predictive bars.
    height = measured[key] ?? (size.width > size.height ? 216 : 274 + bottomInset)
    hasNativeMeasurement = measured[key] != nil
  }

  func recordNativeKeyboard(_ frame: CGRect, in bounds: CGRect) {
    guard frame.width >= bounds.width * 0.9,
      abs(frame.maxY - bounds.maxY) < 2
    else { return }
    let overlap = bounds.intersection(frame).height
    guard overlap >= 160, overlap <= bounds.height * 0.65 else { return }
    measured[key] = overlap
    height = overlap
    hasNativeMeasurement = true
  }

  func recordAutomaticHeight(_ height: CGFloat) {
    guard !hasNativeMeasurement, height >= 160, abs(height - self.height) > 0.5 else { return }
    self.height = height
  }
}

/// UIKit owns keyboard placement. SwiftUI draws strictly inside that frame:
/// it must not add a second keyboard safe area or grow above the input view.
@MainActor
final class KeypadInputView: UIInputView {
  private let model: InputCardModel
  private let host: UIHostingController<TerminalKeypad>
  private var requestedHeight: CGFloat
  var isAccessibilitySize: Bool {
    didSet {
      guard oldValue != isAccessibilitySize else { return }
      host.rootView = TerminalKeypad(model: model, isAccessibilitySize: isAccessibilitySize)
    }
  }

  init(model: InputCardModel, isAccessibilitySize: Bool) {
    self.model = model
    self.isAccessibilitySize = isAccessibilitySize
    requestedHeight = model.keypadGeometry.height
    host = UIHostingController(
      rootView: TerminalKeypad(model: model, isAccessibilitySize: isAccessibilitySize))
    super.init(
      frame: CGRect(x: 0, y: 0, width: 320, height: requestedHeight), inputViewStyle: .keyboard)
    allowsSelfSizing = model.keypadGeometry.hasNativeMeasurement
    autoresizingMask = [.flexibleHeight]
    backgroundColor = .clear
    clipsToBounds = true
    host.safeAreaRegions = []
    host.sizingOptions = []
    host.view.backgroundColor = .clear
    host.view.clipsToBounds = true
    host.view.translatesAutoresizingMaskIntoConstraints = false
    addSubview(host.view)
    NSLayoutConstraint.activate([
      host.view.leadingAnchor.constraint(equalTo: leadingAnchor),
      host.view.trailingAnchor.constraint(equalTo: trailingAnchor),
      host.view.topAnchor.constraint(equalTo: topAnchor),
      host.view.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  @discardableResult
  func updateHeight() -> Bool {
    let height = model.keypadGeometry.height
    let measured = model.keypadGeometry.hasNativeMeasurement
    guard abs(height - requestedHeight) > 0.5 || allowsSelfSizing != measured else { return false }
    requestedHeight = height
    allowsSelfSizing = measured
    if measured { frame.size.height = height }
    invalidateIntrinsicContentSize()
    return true
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard let window else { return }
    let viewport = window.bounds.size
    let automaticHeight = allowsSelfSizing ? nil : bounds.height
    Task { @MainActor [weak self] in
      guard let self, self.window != nil else { return }
      self.model.keypadGeometry.updateViewport(
        viewport, bottomInset: self.model.keypadGeometry.bottomInset)
      if let automaticHeight { self.model.keypadGeometry.recordAutomaticHeight(automaticHeight) }
    }
  }

  override var intrinsicContentSize: CGSize {
    CGSize(
      width: UIView.noIntrinsicMetric,
      height: allowsSelfSizing ? requestedHeight : UIView.noIntrinsicMetric)
  }

  override func systemLayoutSizeFitting(_ targetSize: CGSize) -> CGSize {
    var size = super.systemLayoutSizeFitting(targetSize)
    if allowsSelfSizing { size.height = requestedHeight }
    return size
  }

  override func systemLayoutSizeFitting(
    _ targetSize: CGSize,
    withHorizontalFittingPriority horizontalFittingPriority: UILayoutPriority,
    verticalFittingPriority: UILayoutPriority
  ) -> CGSize {
    var size = super.systemLayoutSizeFitting(
      targetSize, withHorizontalFittingPriority: horizontalFittingPriority,
      verticalFittingPriority: verticalFittingPriority)
    if allowsSelfSizing { size.height = requestedHeight }
    return size
  }
}

/// Live uses a hidden input client because the terminal view owns its own
/// inputView. It forwards text and hardware keys through the card's normal
/// terminal sink instead of swallowing them while the keypad is visible.
@MainActor
final class KeypadResponderView: UIView, UIKeyInput {
  weak var model: InputCardModel?
  private var storedInputView: UIView?
  private var handledPresses = Set<UIPress>()
  var autocorrectionType: UITextAutocorrectionType = .no
  var spellCheckingType: UITextSpellCheckingType = .no
  var smartQuotesType: UITextSmartQuotesType = .no
  var smartDashesType: UITextSmartDashesType = .no
  var smartInsertDeleteType: UITextSmartInsertDeleteType = .no
  var autocapitalizationType: UITextAutocapitalizationType = .none

  override var inputView: UIView? {
    get { storedInputView }
    set { storedInputView = newValue }
  }
  override var canBecomeFirstResponder: Bool { true }
  var hasText: Bool { true }
  func insertText(_ text: String) { model?.typeKeypadText(text) }
  func deleteBackward() { model?.sendKeypadHardware(TerminalKeystroke(.backspace)) }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    var remaining = presses
    for press in presses {
      guard let key = press.key, let stroke = Self.stroke(for: key) else { continue }
      model?.sendKeypadHardware(stroke)
      handledPresses.insert(press)
      remaining.remove(press)
    }
    if !remaining.isEmpty { super.pressesBegan(remaining, with: event) }
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let remaining = presses.subtracting(handledPresses)
    handledPresses.subtract(presses)
    if !remaining.isEmpty { super.pressesEnded(remaining, with: event) }
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let remaining = presses.subtracting(handledPresses)
    handledPresses.subtract(presses)
    if !remaining.isEmpty { super.pressesCancelled(remaining, with: event) }
  }

  static func stroke(for key: UIKey) -> TerminalKeystroke? {
    // Keep system Command shortcuts in the responder chain.
    guard !key.modifierFlags.contains(.command) else { return nil }
    var modifiers: TerminalModifiers = []
    if key.modifierFlags.contains(.control) { modifiers.insert(.control) }
    if key.modifierFlags.contains(.alternate) { modifiers.insert(.option) }
    if key.modifierFlags.contains(.shift) { modifiers.insert(.shift) }
    let named: [Int: TerminalKey] = [
      0x28: .enter, 0x29: .escape, 0x2a: .backspace, 0x2b: .tab,
      0x4a: .home, 0x4b: .pageUp, 0x4c: .deleteForward, 0x4d: .end,
      0x4e: .pageDown, 0x4f: .arrowRight, 0x50: .arrowLeft,
      0x51: .arrowDown, 0x52: .arrowUp,
    ]
    let usage = key.keyCode.rawValue
    if let key = named[usage] { return TerminalKeystroke(key, modifiers: modifiers) }
    if (0x3a...0x45).contains(usage) {
      return TerminalKeystroke(.function(usage - 0x39), modifiers: modifiers)
    }
    if !modifiers.intersection([.control, .option]).isEmpty,
      let character = key.charactersIgnoringModifiers.first
    {
      return TerminalKeystroke(.character(character), modifiers: modifiers)
    }
    // Ordinary text, composed Unicode, and dictation use UIKeyInput exactly once.
    return nil
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateViewport()
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    updateViewport()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    updateViewport()
  }

  func updateViewport() {
    guard let window else { return }
    let size = window.bounds.size
    let bottom = window.safeAreaInsets.bottom
    Task { @MainActor [weak self] in
      self?.model?.keypadGeometry.updateViewport(size, bottomInset: bottom)
    }
  }
}

struct KeypadHost: UIViewRepresentable {
  let model: InputCardModel
  func makeCoordinator() -> Coordinator { Coordinator(model: model) }
  func makeUIView(context: Context) -> KeypadResponderView {
    let view = KeypadResponderView(frame: .zero)
    view.model = model
    view.isUserInteractionEnabled = false
    context.coordinator.view = view
    return view
  }

  func updateUIView(_ view: KeypadResponderView, context: Context) {
    let accessibility = context.environment.dynamicTypeSize.isAccessibilitySize
    _ = model.keypadGeometry.height
    if let keypad = view.inputView as? KeypadInputView {
      keypad.isAccessibilitySize = accessibility
      if keypad.updateHeight() {
        Task { @MainActor in
          if view.isFirstResponder { view.reloadInputViews() }
        }
      }
    }
    let role = model.responderRole(for: .keypadHost)
    guard context.coordinator.applied != role else { return }
    context.coordinator.applied = role
    if role == .take, view.inputView == nil {
      view.inputView = KeypadInputView(model: model, isAccessibilitySize: accessibility)
    }
    guard role != .yield else { return }
    Task { @MainActor in
      guard model.responderRole(for: .keypadHost) == role else { return }
      if role == .take {
        if !view.isFirstResponder { _ = view.becomeFirstResponder() }
      } else if view.isFirstResponder {
        _ = view.resignFirstResponder()
      }
    }
  }

  static func dismantleUIView(_ view: KeypadResponderView, coordinator: Coordinator) {
    coordinator.stop()
    if view.isFirstResponder { _ = view.resignFirstResponder() }
  }

  @MainActor
  final class Coordinator: NSObject {
    weak var view: KeypadResponderView?
    private let model: InputCardModel
    var applied: ResponderRole?
    init(model: InputCardModel) {
      self.model = model
      super.init()
      NotificationCenter.default.addObserver(
        self, selector: #selector(keyboardFrame(_:)),
        name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
      NotificationCenter.default.addObserver(
        self, selector: #selector(keyboardFrame(_:)),
        name: UIResponder.keyboardDidChangeFrameNotification, object: nil)
    }
    func stop() { NotificationCenter.default.removeObserver(self) }
    @objc private func keyboardFrame(_ notification: Notification) {
      guard let window = view?.window,
        let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
      else { return }
      model.keypadGeometry.updateViewport(
        window.bounds.size, bottomInset: window.safeAreaInsets.bottom)
      guard !model.keypadShown, model.keyboardOwner != .none else { return }
      let local = window.convert(frame, from: window.screen.coordinateSpace)
      model.keypadGeometry.recordNativeKeyboard(local, in: window.bounds)
    }
  }
}
