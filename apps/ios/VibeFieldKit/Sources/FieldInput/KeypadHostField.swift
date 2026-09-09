import SwiftUI
import UIKit

/// The keypad's carrier: a `UIInputView` with our SwiftUI page inside it.
///
/// An `inputView` is the one way to REPLACE the system keyboard rather than
/// stack something on it, which is the design's rule for `⋯` — the card must
/// not move when the two swap. `allowsSelfSizing` plus an intrinsic height is
/// what makes UIKit ask this view how tall it is instead of assuming the
/// keyboard's own metrics.
///
/// The hosting controller is held STRONGLY here: a `UIHostingController` whose
/// only reference is its own view is deallocated at the next turn of the run
/// loop, and what is left behind is a live view with no SwiftUI update engine
/// under it — a keypad that renders once and never changes page again.
@MainActor
final class KeypadInputView: UIInputView {
  private let host: UIHostingController<TerminalKeypad>

  // --- IOS-5e ---------------------------------------------------------------
  /// Whether the reader's text size is an accessibility one, which is what this
  /// view's HEIGHT depends on.
  ///
  /// **Why it is handed in rather than read from `traitCollection`.** It was
  /// read from the trait collection first, and the sweep caught what that
  /// costs: a view that is not yet in a window has no content size category to
  /// answer with, so the first `intrinsicContentSize` UIKit asked for came back
  /// at the base height — the keyboard's frame was committed at 260 pt, the
  /// trait arrived a moment later, and the keypad grew 52 pt UPWARD over the
  /// card's own rail. The card's SwiftUI side knows the size before any of this
  /// happens, so it says so.
  var isAccessibilitySize: Bool {
    didSet {
      guard isAccessibilitySize != oldValue else { return }
      invalidateIntrinsicContentSize()
    }
  }
  // --- end IOS-5e -----------------------------------------------------------

  init(model: InputCardModel, isAccessibilitySize: Bool) {
    self.isAccessibilitySize = isAccessibilitySize
    host = UIHostingController(rootView: TerminalKeypad(model: model))
    super.init(
      frame: CGRect(
        x: 0, y: 0, width: 320,
        height: InputCardMetrics.keypadHeight(accessibility: isAccessibilitySize)),
      inputViewStyle: .keyboard)
    allowsSelfSizing = true
    // The input view's own material is the ground, the way a system keyboard's
    // keys sit on its blur — so the SwiftUI layer paints nothing behind the
    // chips.
    host.view.backgroundColor = .clear
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
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  /// IOS-5e: the keypad's keys grow at accessibility text sizes and its FRAME
  /// has to grow with them, or the Keys page clips its last row — the row the
  /// design put the Alt latch on. An `inputView` is measured by this and by
  /// nothing else.
  override var intrinsicContentSize: CGSize {
    CGSize(
      width: UIView.noIntrinsicMetric,
      height: InputCardMetrics.keypadHeight(accessibility: isAccessibilitySize))
  }
}

/// The hidden responder the keypad rides in Live (K-D5).
///
/// **Why it exists.** In Draft the composer field is ours and can simply be
/// given an `inputView`. In Live the first responder is ghosttea's
/// `GhostteaTerminalMetalView`, which is `final` and exposes no way to override
/// its own input view — so there is nowhere to hang a keypad. The workaround
/// the design named is this: a zero-size view that is a text input client in
/// name only, which takes the keyboard off the Metal view and brings our
/// keypad up in its place. Its keys still reach the terminal, because they go
/// through the card's model and out of the host's sink exactly as the rail's
/// do; nothing about the path changes, only who is holding the keyboard.
///
/// **What it costs, honestly.** While the keypad is up the terminal is not the
/// first responder, so a hardware keyboard paired to the phone types into
/// nothing. The fix upstream is one line — a settable `customInputView` on the
/// Metal view — and K-D5 says to petition for it and batch the pin bump; this
/// is the fallback until then, and it is recorded rather than hidden.
@MainActor
final class KeypadResponderView: UIView, UIKeyInput {
  private var storedInputView: UIView?

  override var inputView: UIView? {
    get { storedInputView }
    set { storedInputView = newValue }
  }

  override var canBecomeFirstResponder: Bool { true }

  // MARK: - UIKeyInput
  //
  // Conformance is what makes UIKit treat this as a text input client and
  // raise an input view for it. Nothing types INTO it: every key on the keypad
  // emits an act through the card's model, and a stray character arriving here
  // (a paired hardware keyboard, a dictation commit) has no draft to land in
  // and is deliberately dropped rather than guessed at.

  var hasText: Bool { false }

  func insertText(_ text: String) {}

  func deleteBackward() {}
}

/// Puts the hidden responder in the card's hierarchy and drives it.
///
/// Zero-size and non-interactive: it is never seen and never hit. It has to be
/// IN the hierarchy all the same — `becomeFirstResponder` on a view with no
/// window returns false — which is why this is a view the card always renders
/// rather than something made on demand.
struct KeypadHost: UIViewRepresentable {
  let model: InputCardModel

  /// True while this responder should be holding the keyboard: the keypad is
  /// up AND the terminal is the one that would otherwise have the keys.
  private var wantsResponder: Bool { model.keypadShown && model.mode == .live }

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIView(context: Context) -> KeypadResponderView {
    let view = KeypadResponderView(frame: .zero)
    view.isUserInteractionEnabled = false
    return view
  }

  func updateUIView(_ view: KeypadResponderView, context: Context) {
    // --- IOS-5e: the text size, from the environment this representable sits
    // in — see `KeypadInputView.isAccessibilitySize` for why UIKit is told
    // rather than asked. A size change while the keypad is already up needs
    // `reloadInputViews` as well, or the keyboard keeps the frame it committed.
    let accessibility = context.environment.dynamicTypeSize.isAccessibilitySize
    if let keypad = view.inputView as? KeypadInputView, keypad.isAccessibilitySize != accessibility
    {
      keypad.isAccessibilitySize = accessibility
      Task { @MainActor in
        guard view.isFirstResponder else { return }
        view.reloadInputViews()
      }
    }
    // --- end IOS-5e
    let wanted = wantsResponder
    guard context.coordinator.applied != wanted else { return }
    context.coordinator.applied = wanted
    // The keypad is built on FIRST use, never at `makeUIView`. It is a
    // `UIHostingController`, and standing one up inside the SwiftUI update
    // pass that is already laying this card out is a nested host inside its
    // own parent's layout — which cost the whole card one silent render before
    // it was moved here.
    if wanted, view.inputView == nil {
      view.inputView = KeypadInputView(model: model, isAccessibilitySize: accessibility)
    }
    // The same discipline the composer and the terminal surface both follow:
    // a responder change made inside a SwiftUI update pass resizes this view's
    // own ancestors mid-pass.
    Task { @MainActor in
      if wanted {
        guard !view.isFirstResponder else { return }
        _ = view.becomeFirstResponder()
      } else if view.isFirstResponder {
        _ = view.resignFirstResponder()
      }
    }
  }

  static func dismantleUIView(_ view: KeypadResponderView, coordinator: Coordinator) {
    if view.isFirstResponder { _ = view.resignFirstResponder() }
  }

  @MainActor
  final class Coordinator {
    /// The intent last acted on, so an unchanged one is not re-applied — a
    /// `becomeFirstResponder` per update pass would fight the keyboard.
    var applied: Bool?
  }
}
