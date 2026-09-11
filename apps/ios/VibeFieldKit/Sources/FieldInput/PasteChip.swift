import FieldDesign
import SwiftUI
import UIKit

/// The paste chip: the system's own paste control, re-shaped into the chips row.
///
/// **Why a system control and not a chip we draw.** Reading
/// `UIPasteboard.general.string` raises the "allow paste?" alert every single
/// time. `UIPasteControl` is the one path that hands an app the pasteboard's
/// text with no alert at all: the user's tap on the system's own control IS
/// the grant, and UIKit delivers the item providers straight to our target.
/// The design puts paste here precisely because it is episodic (§4, "Where the
/// clipboard button went") — an alert on every occurrence would cost more than
/// the permanent button the chip replaced.
///
/// **What we give up for that, honestly.** The label is the system's, in the
/// system font, localized — and IOS-5v is the release where that stopped being
/// a compromise: the rest of the row is SF now too, so the system's own label is
/// the right typeface rather than the wrong one. What the configuration allows
/// is the shape and the ink, and both are the canvas's `.chip.paste`: capsule
/// corners at the chips row's own 36 pt, the pill's fill, the row's ink. The
/// gradient, the blur and the hairline it cannot take are approximated by a
/// solid fill and a border drawn over it by `ChipsRow`. The design's "preview of
/// the first line" is absent for the same reason the alert is: a preview means
/// reading the contents before the user has asked to paste them.
struct PasteChip: UIViewRepresentable {
  /// Delivered on the main actor once the provider has loaded.
  let onText: (String) -> Void

  /// The chips row's height (`.chip`, 36 pt), as a FLOOR rather than a pin —
  /// the row grows to whatever the control needs (see `sizeThatFits`), and
  /// `ChipsRow` follows.
  static let height: CGFloat = ChipsRow.height
  /// A guard against a zero intrinsic width before the control has laid out:
  /// a chip with no width is a chip nobody can hit.
  private static let minimumWidth: CGFloat = 92

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIView(context: Context) -> UIPasteControl {
    let configuration = UIPasteControl.Configuration()
    configuration.displayMode = .iconAndLabel
    // A pill, like every other chip on the row (DESIGN.md §4: "pills/buttons —
    // fully round").
    configuration.cornerStyle = .capsule
    configuration.baseBackgroundColor = UIColor(ChromePalette.pasteChipFill)
    configuration.baseForegroundColor = UIColor(ChromePalette.ink)
    let control = UIPasteControl(configuration: configuration)
    // `target` is a WEAK reference on UIPasteControl, so the receiver has to
    // be owned by something that outlives the view — the coordinator is that
    // something. Left to the responder chain instead, the paste would arrive
    // somewhere in SwiftUI's hosting hierarchy and be dropped.
    context.coordinator.receiver.onText = onText
    control.target = context.coordinator.receiver
    return control
  }

  func updateUIView(_ control: UIPasteControl, context: Context) {
    context.coordinator.receiver.onText = onText
  }

  /// The control sizes ITSELF, both ways. Squashing it is not a styling
  /// choice the system honours: a protected control that is asked for less
  /// than it needs stops drawing its own label and falls back to a plain
  /// system fill (witnessed in the simulator, both themes — a bare accent-blue
  /// rectangle with no icon and no text).
  func sizeThatFits(
    _ proposal: ProposedViewSize, uiView: UIPasteControl, context: Context
  ) -> CGSize? {
    let intrinsic = uiView.intrinsicContentSize
    return CGSize(
      width: max(intrinsic.width, Self.minimumWidth), height: max(intrinsic.height, Self.height))
  }

  @MainActor
  final class Coordinator {
    let receiver = PasteReceiver()
  }
}

/// The paste control's target.
///
/// It is a bare `UIResponder` rather than a view because it is not on screen
/// and is not in the responder chain: the control holds it directly. The
/// `pasteConfiguration` is what tells UIKit which item providers this target
/// can take, and without one the control has no reason to believe a tap would
/// go anywhere.
@MainActor
final class PasteReceiver: UIResponder {
  var onText: ((String) -> Void)?

  override init() {
    super.init()
    pasteConfiguration = UIPasteConfiguration(forAccepting: NSString.self)
  }

  override func canPaste(_ itemProviders: [NSItemProvider]) -> Bool {
    itemProviders.contains { $0.canLoadObject(ofClass: String.self) }
  }

  override func paste(itemProviders: [NSItemProvider]) {
    guard let provider = itemProviders.first(where: { $0.canLoadObject(ofClass: String.self) })
    else { return }
    // The load is asynchronous and answers on an arbitrary queue — the hop
    // back is not ceremony, it is the only way this touches the card's state
    // legally.
    _ = provider.loadObject(ofClass: String.self) { text, _ in
      guard let text, !text.isEmpty else { return }
      Task { @MainActor in self.onText?(text) }
    }
  }
}
