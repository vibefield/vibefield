import GhostteaCore
import GhostteaTerminal
import SwiftUI
import UIKit

/// The Metal terminal wrapped for SwiftUI — our `GhostteaSharedTerminalSurface`.
///
/// Two deliberate departures from the reference:
/// - A Metal failure is surfaced through `onRenderFailure` instead of
///   `preconditionFailure`: we render one card in a field, not a whole app,
///   and a card degrades to an honest UNAVAILABLE face rather than taking the
///   app down.
/// - `frame` is optional: the card mounts the surface while the attachment is
///   still synchronizing, before a first frame exists.
public struct TerminalSurface: UIViewRepresentable {
  let frame: Data?
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
  /// The kit defaults `.dark`; the card is in both themes, so the host passes
  /// the scheme rather than letting a light-mode keyboard arrive black.
  let keyboardAppearance: UIKeyboardAppearance
  let accessibilityTitle: String
  let accessibilityConnectionState: String
  let onGridSize: (GhostteaTerminalGridSize) -> Void
  let onNeedsFullRefresh: () -> Void
  let onHardwareInput: (GhostteaHardwareKeyEvent) -> Bool
  let onSoftwareInput: (GhostteaSoftwareInputEvent) -> Void
  let onMouseInput: (GhostteaTerminalMouseEvent) -> Void
  let onScrollRows: (Int) -> Void
  let onClipboardWrite: (String) -> Void
  let onSelectionCommit: (GhostteaTerminalSelection) -> Void
  let onSelectAll: () -> Void
  let onRenderFailure: (String) -> Void

  public init(
    frame: Data?,
    visible: Bool,
    configuration: GhostteaTerminalPresentationConfig,
    controlsGridSize: Bool = true,
    showsKitAccessoryRow: Bool = false,
    wantsFocus: Bool = false,
    keyboardAppearance: UIKeyboardAppearance = .default,
    accessibilityTitle: String = "Remote terminal",
    accessibilityConnectionState: String = "Attached over the mesh",
    onGridSize: @escaping (GhostteaTerminalGridSize) -> Void = { _ in },
    onNeedsFullRefresh: @escaping () -> Void = {},
    onHardwareInput: @escaping (GhostteaHardwareKeyEvent) -> Bool = { _ in false },
    onSoftwareInput: @escaping (GhostteaSoftwareInputEvent) -> Void = { _ in },
    onMouseInput: @escaping (GhostteaTerminalMouseEvent) -> Void = { _ in },
    onScrollRows: @escaping (Int) -> Void = { _ in },
    onClipboardWrite: @escaping (String) -> Void = { _ in },
    onSelectionCommit: @escaping (GhostteaTerminalSelection) -> Void = { _ in },
    onSelectAll: @escaping () -> Void = {},
    onRenderFailure: @escaping (String) -> Void = { _ in }
  ) {
    self.frame = frame
    self.visible = visible
    self.configuration = configuration
    self.controlsGridSize = controlsGridSize
    self.showsKitAccessoryRow = showsKitAccessoryRow
    self.wantsFocus = wantsFocus
    self.keyboardAppearance = keyboardAppearance
    self.accessibilityTitle = accessibilityTitle
    self.accessibilityConnectionState = accessibilityConnectionState
    self.onGridSize = onGridSize
    self.onNeedsFullRefresh = onNeedsFullRefresh
    self.onHardwareInput = onHardwareInput
    self.onSoftwareInput = onSoftwareInput
    self.onMouseInput = onMouseInput
    self.onScrollRows = onScrollRows
    self.onClipboardWrite = onClipboardWrite
    self.onSelectionCommit = onSelectionCommit
    self.onSelectAll = onSelectAll
    self.onRenderFailure = onRenderFailure
  }

  @MainActor
  public final class Coordinator {
    var metalView: GhostteaTerminalMetalView?
    var appliedFrame: Data?
    /// The reference's own guard, coordinator-held: reapply the configuration
    /// only when its revision changed. Our revisions digest the renderer
    /// values, so this is exactly "reapply when the presentation changed".
    var appliedConfigurationRevision: String?
    /// The last focus intent this surface acted on, so a responder change is
    /// made once per FLIP rather than on every SwiftUI update — asking a view
    /// that already holds the keyboard to become first responder again is how
    /// a keyboard learns to flicker.
    var appliedFocus: Bool?
  }

  public func makeCoordinator() -> Coordinator { Coordinator() }

  public func makeUIView(context: Context) -> UIView {
    let container = UIView()
    container.backgroundColor = .clear
    do {
      let view = try GhostteaTerminalMetalView(terminalFrame: container.bounds)
      view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      configure(view)
      view.applyConfiguration(configuration)
      context.coordinator.appliedConfigurationRevision = configuration.revision
      container.addSubview(view)
      context.coordinator.metalView = view
    } catch {
      // Reported on the next main-actor turn so the honest error state never
      // mutates observable state from inside a SwiftUI update pass.
      let reason = "Metal terminal unavailable — \(String(describing: error))"
      let report = onRenderFailure
      Task { report(reason) }
    }
    return container
  }

  public func updateUIView(_ container: UIView, context: Context) {
    guard let view = context.coordinator.metalView else { return }
    configure(view)
    view.setTerminalVisible(visible)
    applyFocus(view, coordinator: context.coordinator)
    if context.coordinator.appliedConfigurationRevision != configuration.revision {
      view.applyConfiguration(configuration)
      context.coordinator.appliedConfigurationRevision = configuration.revision
    }
    guard let frame, context.coordinator.appliedFrame != frame else { return }
    // Recorded even when rejected, so one bad frame is retried zero times —
    // the repair is a fresh authoritative snapshot, not the same bytes again.
    context.coordinator.appliedFrame = frame
    do {
      try view.apply(frame: frame)
    } catch {
      // A frame the renderer cannot decode is a discontinuity only a full
      // snapshot repairs (the reference assertionFailures here; a card asks
      // for repair instead).
      let refresh = onNeedsFullRefresh
      Task { refresh() }
    }
  }

  public static func dismantleUIView(_ container: UIView, coordinator: Coordinator) {
    coordinator.metalView?.suspendGPU()
    coordinator.metalView = nil
  }

  /// Responder changes are made on the NEXT main turn, never inside the
  /// SwiftUI update pass: `becomeFirstResponder` raises the keyboard, which
  /// resizes this view's own ancestors, and UIKit is right to complain about a
  /// layout provoked from inside a layout.
  private func applyFocus(_ view: GhostteaTerminalMetalView, coordinator: Coordinator) {
    guard coordinator.appliedFocus != wantsFocus else { return }
    coordinator.appliedFocus = wantsFocus
    let wanted = wantsFocus
    Task { @MainActor in
      if wanted {
        guard view.canBecomeFirstResponder, !view.isFirstResponder else { return }
        _ = view.becomeFirstResponder()
      } else if view.isFirstResponder {
        _ = view.resignFirstResponder()
      }
    }
  }

  private func configure(_ view: GhostteaTerminalMetalView) {
    view.showsTerminalAccessoryRow = showsKitAccessoryRow
    view.keyboardAppearance = keyboardAppearance
    view.onGridSizeChange = controlsGridSize ? onGridSize : nil
    view.onNeedsFullRefresh = onNeedsFullRefresh
    view.onHardwareKeyEvent = onHardwareInput
    view.onSoftwareInputEvent = onSoftwareInput
    view.onMouseInputEvent = onMouseInput
    view.onScrollRows = onScrollRows
    view.onClipboardWrite = onClipboardWrite
    view.onSelectionCommit = onSelectionCommit
    view.onSelectAll = onSelectAll
    view.accessibilityTerminalTitle = accessibilityTitle
    view.accessibilityConnectionState = accessibilityConnectionState
  }
}
