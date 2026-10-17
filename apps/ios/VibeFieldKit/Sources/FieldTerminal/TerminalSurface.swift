import GhostteaCore
import GhostteaTerminal
import SwiftUI
import UIKit
import UIKit.UIGestureRecognizerSubclass

/// The Metal terminal wrapped for SwiftUI — our `GhostteaSharedTerminalSurface`.
///
/// Two deliberate departures from the reference:
/// - A Metal failure is surfaced through `onRenderFailure` instead of
///   `preconditionFailure`: we render one card in a field, not a whole app,
///   and a card degrades to an honest UNAVAILABLE face rather than taking the
///   app down.
/// - The surface HOSTS the view its `TerminalScene` owns and never applies a
///   frame itself (the second audit's D1 and B2, 2026-10-16): frames reach the
///   scene in order as they arrive, so one that lands between two SwiftUI
///   updates is applied rather than overwritten, and a view that outlives this
///   surface keeps its picture for the next one to host.
public struct TerminalSurface: UIViewRepresentable {
  let scene: TerminalScene
  let visible: Bool
  let configuration: GhostteaTerminalPresentationConfig
  let controlsGridSize: Bool
  /// The kit ships its own fifteen-key accessory row above the keyboard and
  /// defaults it ON. IOS-5a switches it off (K-D3): the input card's rail
  /// replaces it, and two rows of terminal keys stacked on each other would be
  /// two latches disagreeing about who armed Ctrl.
  let showsKitAccessoryRow: Bool
  /// Whether the Metal view should hold the keyboard. Live mode is exactly
  /// this: the terminal IS the `UITextInput`, so making it first responder is
  /// the whole of "typing goes straight through".
  let wantsFocus: Bool
  // --- IOS-5c
  /// A nonce the host bumps to ask for focus AGAIN at the same `wantsFocus`.
  /// The keyboard can go down without this view being told (an interactive
  /// dismissal resigns it), and a second request that carries no new value
  /// would otherwise be skipped by the guard below — which is right for every
  /// other caller and wrong for the KEYBOARD chip.
  let focusEpoch: Int
  /// What the responder calls above actually achieved. The card derives who
  /// owns the keyboard from this rather than from the mode, so a
  /// `becomeFirstResponder` that did not take is visible instead of assumed.
  let onFocusChange: (Bool) -> Void
  // --- end IOS-5c
  /// The kit defaults `.dark`; the card is in both themes, so the host passes
  /// the scheme rather than letting a light-mode keyboard arrive black.
  let keyboardAppearance: UIKeyboardAppearance
  let accessibilityTitle: String
  let accessibilityConnectionState: String
  /// The terminal's SETTLED grid, for the seat (`SettledGrid`).
  let onGridSize: (GhostteaTerminalGridSize) -> Void
  /// A grid measured and held — the keyboard moving, the card leaving — with
  /// the reason, for the host to say; never the seat's.
  let onGridHeld: (GhostteaTerminalGridSize, String) -> Void
  let onNeedsFullRefresh: () -> Void
  let onHardwareInput: (GhostteaHardwareKeyEvent) -> Bool
  let onSoftwareInput: (GhostteaSoftwareInputEvent) -> Void
  let onMouseInput: (GhostteaTerminalMouseEvent) -> Void
  let onScrollRows: (Int) -> Void
  let onClipboardWrite: (String) -> Void
  let onSelectionCommit: (GhostteaTerminalSelection) -> Void
  let onSelectAll: () -> Void
  let onRenderFailure: (String) -> Void
  /// A tap on the terminal, for the host to answer. The view never takes the
  /// keyboard on a tap of its own (`configure` turns ghosttea's tap focus
  /// off): the card owns the keyboard, and a second owner was the bare system
  /// keyboard James found under the designed one (2026-10-17).
  let onTap: () -> Void
  /// A touch of the terminal — any gesture's first finger down — for the host
  /// to answer: the device the person touched last has the size (James,
  /// 2026-10-17, "any touch takes").
  let onTouch: () -> Void

  public init(
    scene: TerminalScene,
    visible: Bool,
    configuration: GhostteaTerminalPresentationConfig,
    controlsGridSize: Bool = true,
    showsKitAccessoryRow: Bool = false,
    wantsFocus: Bool = false,
    focusEpoch: Int = 0,
    onFocusChange: @escaping (Bool) -> Void = { _ in },
    keyboardAppearance: UIKeyboardAppearance = .default,
    accessibilityTitle: String = "Remote terminal",
    accessibilityConnectionState: String = "Attached over the mesh",
    onGridSize: @escaping (GhostteaTerminalGridSize) -> Void = { _ in },
    onGridHeld: @escaping (GhostteaTerminalGridSize, String) -> Void = { _, _ in },
    onNeedsFullRefresh: @escaping () -> Void = {},
    onHardwareInput: @escaping (GhostteaHardwareKeyEvent) -> Bool = { _ in false },
    onSoftwareInput: @escaping (GhostteaSoftwareInputEvent) -> Void = { _ in },
    onMouseInput: @escaping (GhostteaTerminalMouseEvent) -> Void = { _ in },
    onScrollRows: @escaping (Int) -> Void = { _ in },
    onClipboardWrite: @escaping (String) -> Void = { _ in },
    onSelectionCommit: @escaping (GhostteaTerminalSelection) -> Void = { _ in },
    onSelectAll: @escaping () -> Void = {},
    onRenderFailure: @escaping (String) -> Void = { _ in },
    onTap: @escaping () -> Void = {},
    onTouch: @escaping () -> Void = {}
  ) {
    self.scene = scene
    self.visible = visible
    self.configuration = configuration
    self.controlsGridSize = controlsGridSize
    self.showsKitAccessoryRow = showsKitAccessoryRow
    self.wantsFocus = wantsFocus
    self.focusEpoch = focusEpoch
    self.onFocusChange = onFocusChange
    self.keyboardAppearance = keyboardAppearance
    self.accessibilityTitle = accessibilityTitle
    self.accessibilityConnectionState = accessibilityConnectionState
    self.onGridSize = onGridSize
    self.onGridHeld = onGridHeld
    self.onNeedsFullRefresh = onNeedsFullRefresh
    self.onHardwareInput = onHardwareInput
    self.onSoftwareInput = onSoftwareInput
    self.onMouseInput = onMouseInput
    self.onScrollRows = onScrollRows
    self.onClipboardWrite = onClipboardWrite
    self.onSelectionCommit = onSelectionCommit
    self.onSelectAll = onSelectAll
    self.onRenderFailure = onRenderFailure
    self.onTap = onTap
    self.onTouch = onTouch
  }

  @MainActor
  public final class Coordinator: NSObject {
    var metalView: GhostteaTerminalMetalView?
    /// The reference's own guard, coordinator-held: reapply the configuration
    /// only when its revision changed. Our revisions digest the renderer
    /// values, so this is exactly "reapply when the presentation changed".
    var appliedConfigurationRevision: String?
    /// The last focus intent this surface acted on, so a responder change is
    /// made once per FLIP rather than on every SwiftUI update — asking a view
    /// that already holds the keyboard to become first responder again is how
    /// a keyboard learns to flicker.
    var appliedFocus: Bool?
    /// IOS-5c's re-ask nonce, remembered beside the intent it qualifies.
    var appliedFocusEpoch: Int = 0
    /// FS-1 (focus session 2026-10-15) — the latest surface's handlers. The
    /// Metal view is handed TRAMPOLINES into this once, at make, and an update
    /// replaces only what they read: re-assigning the view's own closures on
    /// every SwiftUI update was the phone's frozen attach. Ghosttea's
    /// `onGridSizeChange` setter re-REPORTS the grid even when it is unchanged
    /// (`updateGridSize(notifyUnchanged: true)`), so every update called back
    /// into the attachment from inside the update pass, and the card's layout
    /// never settled — the main thread spun in `_UIHostingView.layoutSubviews`
    /// with both legs dialled and never read (run 3, PJ-7).
    var latest: TerminalSurface?
    /// Whether the grid callback was live at the last update: turning it on
    /// asks the view for the grid it already has, once (the reason the
    /// setter re-reports at all).
    var appliedControlsGridSize: Bool?

    /// The container's tap, forwarded like every other handler (FS-1). It
    /// cancels no touches, and UIKit's own exclusivity fails it whenever the
    /// view's long press or pan claims the touch, so a hold or a scroll is
    /// never also a tap.
    @objc func handleTap() {
      latest?.onTap()
    }

    /// Every touch of the terminal, at its first finger down (James,
    /// 2026-10-17: the last-touched device has the size). It recognizes beside
    /// the view's own gestures and claims and delays no touch.
    @objc func handleTouch() {
      latest?.onTouch()
    }

    /// What the seat has been told, and what waits (2026-10-17).
    var settledGrid = SettledGrid()
    /// UIKit's keyboard will- and did-notifications, observed while this
    /// surface hosts the view.
    var keyboardObservers: [NSObjectProtocol] = []
    /// A dismissal of this card that has begun, watched for being called off.
    var watchingDismissal = false
    /// The end of this run loop turn is already asked for (`SettledGrid`).
    var turnEndAsked = false

    /// A grid the Metal view measured: the seat's when it is settled. One at
    /// rest is told when this turn ends.
    func measured(_ size: GhostteaTerminalGridSize) {
      let leaving = metalView?.isInDismissingPresentation ?? false
      if leaving { watchDismissal() }
      report(settledGrid.measured(size, leaving: leaving))
      askForTheTurnEnd()
    }

    private func askForTheTurnEnd() {
      guard !turnEndAsked else { return }
      turnEndAsked = true
      DispatchQueue.main.async { [weak self] in
        MainActor.assumeIsolated {
          guard let self else { return }
          self.turnEndAsked = false
          self.report(self.settledGrid.turnEnded())
        }
      }
    }

    private func report(_ report: SettledGrid.Report) {
      guard let latest else { return }
      switch report {
      case .send(let grid): latest.onGridSize(grid)
      case .held(let grid, let because): latest.onGridHeld(grid, because)
      case .unchanged: break
      }
    }

    /// Observed on the POSTING thread (`queue: nil`; UIKit posts these on the
    /// main thread), synchronously: a block given to the main queue runs on a
    /// later turn, after the layout pass the keyboard's frame triggers has
    /// already measured the grid — the first build sent 45×10 that way on
    /// James's phone (2026-10-17 05:22Z).
    func observeKeyboard() {
      guard keyboardObservers.isEmpty else { return }
      let center = NotificationCenter.default
      keyboardObservers = [
        center.addObserver(
          forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: nil
        ) { [weak self] _ in
          MainActor.assumeIsolated {
            guard let self else { return }
            self.report(self.settledGrid.keyboardWillMove())
          }
        },
        center.addObserver(
          forName: UIResponder.keyboardDidChangeFrameNotification, object: nil, queue: nil
        ) { [weak self] _ in
          MainActor.assumeIsolated {
            guard let self else { return }
            self.report(self.settledGrid.keyboardDidMove())
          }
        },
      ]
    }

    func stopObservingKeyboard() {
      for observer in keyboardObservers { NotificationCenter.default.removeObserver(observer) }
      keyboardObservers = []
    }

    /// A dismissal the person calls off leaves the card at rest again, and its
    /// grid is the terminal's once more.
    private func watchDismissal() {
      guard !watchingDismissal, let transition = metalView?.presentedRoot?.transitionCoordinator
      else { return }
      watchingDismissal = true
      _ = transition.animate(alongsideTransition: nil) { [weak self] context in
        MainActor.assumeIsolated {
          guard let self else { return }
          self.watchingDismissal = false
          guard context.isCancelled, let grid = self.metalView?.currentGridSize else { return }
          self.measured(grid)
        }
      }
    }
  }

  public func makeCoordinator() -> Coordinator { Coordinator() }

  public func makeUIView(context: Context) -> UIView {
    let container = UIView()
    container.backgroundColor = .clear
    context.coordinator.latest = self
    let tap = UITapGestureRecognizer(
      target: context.coordinator, action: #selector(Coordinator.handleTap))
    tap.cancelsTouchesInView = false
    container.addGestureRecognizer(tap)
    let touch = TouchDownRecognizer(
      target: context.coordinator, action: #selector(Coordinator.handleTouch))
    touch.delegate = context.coordinator
    container.addGestureRecognizer(touch)
    guard let view = scene.hostedView() else {
      // Reported on the next main-actor turn so the honest error state never
      // mutates observable state from inside a SwiftUI update pass.
      let reason = scene.failure ?? "Metal terminal unavailable"
      let report = onRenderFailure
      Task { report(reason) }
      return container
    }
    // The scene's view may arrive from a surface that went away (its picture
    // kept, its GPU resources let go) — this one takes it over.
    view.removeFromSuperview()
    view.frame = container.bounds
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.resumeGPU()
    installHandlers(view, coordinator: context.coordinator)
    context.coordinator.observeKeyboard()
    configure(view, coordinator: context.coordinator)
    view.applyConfiguration(configuration)
    context.coordinator.appliedConfigurationRevision = configuration.revision
    container.addSubview(view)
    context.coordinator.metalView = view
    return container
  }

  public func updateUIView(_ container: UIView, context: Context) {
    context.coordinator.latest = self
    guard let view = context.coordinator.metalView else { return }
    configure(view, coordinator: context.coordinator)
    view.setTerminalVisible(visible)
    applyFocus(view, coordinator: context.coordinator)
    if context.coordinator.appliedConfigurationRevision != configuration.revision {
      view.applyConfiguration(configuration)
      context.coordinator.appliedConfigurationRevision = configuration.revision
    }
  }

  public static func dismantleUIView(_ container: UIView, coordinator: Coordinator) {
    // The scene keeps the view and its picture; only the GPU is let go.
    coordinator.stopObservingKeyboard()
    coordinator.metalView?.suspendGPU()
    coordinator.metalView?.removeFromSuperview()
    coordinator.metalView = nil
  }

  /// Responder changes are made on the NEXT main turn, never inside the
  /// SwiftUI update pass: `becomeFirstResponder` raises the keyboard, which
  /// resizes this view's own ancestors, and UIKit is right to complain about a
  /// layout provoked from inside a layout.
  private func applyFocus(_ view: GhostteaTerminalMetalView, coordinator: Coordinator) {
    // --- IOS-5c: the epoch joins the guard, so an unchanged intent can still
    // be re-asked; the outcome is reported either way.
    guard coordinator.appliedFocus != wantsFocus || coordinator.appliedFocusEpoch != focusEpoch
    else { return }
    coordinator.appliedFocusEpoch = focusEpoch
    // --- end IOS-5c
    coordinator.appliedFocus = wantsFocus
    let wanted = wantsFocus
    let report = onFocusChange
    Task { @MainActor in
      if wanted {
        if view.canBecomeFirstResponder, !view.isFirstResponder {
          _ = view.becomeFirstResponder()
        }
      } else if view.isFirstResponder {
        _ = view.resignFirstResponder()
      }
      // The RESULT, not the request: a view that cannot become first responder
      // says so here, and the card's closed row is that answer rendered.
      report(view.isFirstResponder)
    }
  }

  /// The view's handlers, ONCE: each forwards to the latest surface the
  /// coordinator holds, so an update never touches a property whose setter
  /// does work (FS-1).
  private func installHandlers(_ view: GhostteaTerminalMetalView, coordinator: Coordinator) {
    view.onNeedsFullRefresh = { [weak coordinator] in coordinator?.latest?.onNeedsFullRefresh() }
    view.onHardwareKeyEvent = { [weak coordinator] event in
      coordinator?.latest?.onHardwareInput(event) ?? false
    }
    view.onSoftwareInputEvent = { [weak coordinator] event in
      coordinator?.latest?.onSoftwareInput(event)
    }
    view.onMouseInputEvent = { [weak coordinator] event in coordinator?.latest?.onMouseInput(event) }
    view.onScrollRows = { [weak coordinator] rows in coordinator?.latest?.onScrollRows(rows) }
    view.onClipboardWrite = { [weak coordinator] text in coordinator?.latest?.onClipboardWrite(text) }
    view.onSelectionCommit = { [weak coordinator] selection in
      coordinator?.latest?.onSelectionCommit(selection)
    }
    view.onSelectAll = { [weak coordinator] in coordinator?.latest?.onSelectAll() }
  }

  /// What an update may change, each written only when it differs: the grid
  /// callback's presence (its setter re-reports the grid), the accessory row
  /// (its setter reloads the input views), the accessibility strings (their
  /// setters rebuild the elements). FS-1.
  private func configure(_ view: GhostteaTerminalMetalView, coordinator: Coordinator) {
    if view.showsTerminalAccessoryRow != showsKitAccessoryRow {
      view.showsTerminalAccessoryRow = showsKitAccessoryRow
    }
    // The view's own tap focus is the second keyboard owner: a tap made it
    // first responder and raised the bare system keyboard under the card's
    // designed one. The host answers taps (`onTap`). ghosttea's scroll,
    // long-press and pointer gestures still take focus on their own — its
    // focus policy is upstream's to fix (one ghosttea release, EL8).
    if view.focusesInputOnTap { view.focusesInputOnTap = false }
    if view.keyboardAppearance != keyboardAppearance {
      view.keyboardAppearance = keyboardAppearance
    }
    if coordinator.appliedControlsGridSize != controlsGridSize {
      coordinator.appliedControlsGridSize = controlsGridSize
      view.onGridSizeChange =
        controlsGridSize
        ? { [weak coordinator] size in coordinator?.measured(size) } : nil
    }
    if view.accessibilityTerminalTitle != accessibilityTitle {
      view.accessibilityTerminalTitle = accessibilityTitle
    }
    if view.accessibilityConnectionState != accessibilityConnectionState {
      view.accessibilityConnectionState = accessibilityConnectionState
    }
  }
}

extension UIView {
  /// The view controller PRESENTED around this view — the root of its nearest
  /// controller's parent chain — when the view is in a presentation at all.
  fileprivate var presentedRoot: UIViewController? {
    var responder = next
    while let current = responder, !(current is UIViewController) { responder = current.next }
    var controller = responder as? UIViewController
    while let parent = controller?.parent { controller = parent }
    return controller?.presentingViewController == nil ? nil : controller
  }

  /// Whether UIKit is dismissing the presentation this view is in: a sheet's
  /// swipe down from its first point — UIKit runs it as an interactive
  /// dismissal from the start of the drag and cancels it if the sheet springs
  /// back — or a dismissal asked in code.
  fileprivate var isInDismissingPresentation: Bool {
    guard let root = presentedRoot else { return false }
    if root.isBeingDismissed { return true }
    // A presented controller in an interactive transition that is not its own
    // presentation, with nothing presented over it, is being dragged away.
    return !root.isBeingPresented && root.presentedViewController == nil
      && root.transitionCoordinator?.isInteractive == true
  }
}

extension TerminalSurface.Coordinator: UIGestureRecognizerDelegate {
  /// The touch-down gesture recognizes beside every gesture the Metal view
  /// owns — its pan, its long press, the container's tap — never instead of one.
  public func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    gestureRecognizer is TouchDownRecognizer || otherGestureRecognizer is TouchDownRecognizer
  }
}

/// A gesture that recognizes at a touch's first finger down and claims nothing:
/// it never cancels or delays the touch it sees (2026-10-17).
final class TouchDownRecognizer: UIGestureRecognizer {
  override init(target: Any?, action: Selector?) {
    super.init(target: target, action: action)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    super.touchesBegan(touches, with: event)
    if state == .possible { state = .recognized }
  }
}
