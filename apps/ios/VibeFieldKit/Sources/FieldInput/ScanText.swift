import FieldDesign
import SwiftUI
import UIKit
import VisionKit

/// Scan Text: the camera reads a line and the draft takes it.
///
/// The case it exists for is the one the design names — an error on ANOTHER
/// screen. A stack trace on a laptop, a hostname on a whiteboard, a token
/// printed on a terminal that is not this one: text that has no clipboard to
/// travel through because it was never in a computer this phone can reach.
///
/// It is a full-screen cover rather than a sheet because a viewfinder behind a
/// detent is a viewfinder nobody can aim, and because the camera is the whole
/// surface while it is up.
public struct ScanTextCover: View {
  private let onText: (String) -> Void
  private let onClose: () -> Void

  public init(onText: @escaping (String) -> Void, onClose: @escaping () -> Void) {
    self.onText = onText
    self.onClose = onClose
  }

  /// Whether this device can scan at all. `isSupported` is the hardware
  /// question (a Neural Engine and a camera) and `isAvailable` is the
  /// permission one; a simulator answers false to the first, which is why the
  /// honest line below is the only thing a headless run will ever see.
  private var scannerReady: Bool {
    DataScannerViewController.isSupported && DataScannerViewController.isAvailable
  }

  public var body: some View {
    ZStack {
      // Black, in both themes and on purpose: this is a viewfinder, and the one
      // ground a camera image belongs on is the one that adds nothing to it.
      // On a simulator there is no image and the same ground carries the
      // honest-missing line instead.
      Color.black.ignoresSafeArea()
      if scannerReady {
        DataScannerView(onText: onText)
          .ignoresSafeArea()
      } else {
        unsupported
      }
      chrome
    }
  }

  /// The absence, said out loud.
  ///
  /// The menu item that opens this is PRESENT on a device with no scanner, and
  /// deliberately so: D-i6 forbids a control that is greyed out with no
  /// explanation, and an act that opens and then explains is the honest
  /// version of the same fact. Every simulator lands here.
  private var unsupported: some View {
    VStack(spacing: 10) {
      FieldGlyph(.scanText, size: FieldGlyph.box(for: 26))
        .foregroundStyle(ChromePalette.inkTertiary)
      Text("Text scanning needs a camera on this device")
        .font(ChromeType.sans(ChromeType.sheetTitleSize, .semibold))
        .foregroundStyle(ChromePalette.ink)
        .multilineTextAlignment(.center)
      Text("Nothing was captured")
        .font(ChromeType.sans(ChromeType.sheetBodySize))
        .foregroundStyle(ChromePalette.inkTertiary)
    }
    .padding(.horizontal, 40)
  }

  private var chrome: some View {
    VStack {
      HStack {
        Text("Scan text")
          .font(ChromeType.sans(ChromeType.stripSize, .semibold))
          .foregroundStyle(ChromePalette.ink)
          .padding(.horizontal, 16)
          .frame(height: 36)
          .background { Capsule().fill(ChromePalette.keyFill) }
        Spacer(minLength: 0)
        Button(action: onClose) {
          Text("Close")
        }
        .buttonStyle(ChromePillStyle(.secondary))
        .accessibilityLabel("Close the scanner")
      }
      Spacer(minLength: 0)
      if scannerReady {
        Text("Tap a line of text to take it")
          .font(ChromeType.sans(ChromeType.sheetBodySize))
          .foregroundStyle(ChromePalette.ink)
          .padding(.horizontal, 16)
          .frame(height: 36)
          .background { Capsule().fill(ChromePalette.keyFill) }
      }
    }
    .padding(16)
  }
}

/// VisionKit's own scanner, wrapped.
///
/// Tap-to-take rather than a DONE that sweeps up everything recognized: what
/// the camera sees is usually a whole screen of text and only one line of it
/// is the command, so taking everything would paste a page to delete most of.
/// The tap is also the grant — nothing leaves the viewfinder until a finger
/// picks it.
struct DataScannerView: UIViewControllerRepresentable {
  let onText: (String) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(onText: onText) }

  func makeUIViewController(context: Context) -> DataScannerViewController {
    let scanner = DataScannerViewController(
      recognizedDataTypes: [.text()],
      qualityLevel: .balanced,
      recognizesMultipleItems: true,
      isHighFrameRateTrackingEnabled: false,
      isGuidanceEnabled: true,
      isHighlightingEnabled: true)
    scanner.delegate = context.coordinator
    return scanner
  }

  func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
    context.coordinator.onText = onText
    // Scanning starts once, and after the controller is in a hierarchy —
    // `makeUIViewController` runs before it has a view to draw into.
    guard !context.coordinator.started else { return }
    context.coordinator.started = true
    try? scanner.startScanning()
  }

  static func dismantleUIViewController(
    _ scanner: DataScannerViewController, coordinator: Coordinator
  ) {
    scanner.stopScanning()
  }

  @MainActor
  final class Coordinator: NSObject, DataScannerViewControllerDelegate {
    var onText: (String) -> Void
    var started = false

    init(onText: @escaping (String) -> Void) {
      self.onText = onText
    }

    func dataScanner(
      _ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem
    ) {
      guard case .text(let text) = item else { return }
      onText(text.transcript)
    }
  }
}
