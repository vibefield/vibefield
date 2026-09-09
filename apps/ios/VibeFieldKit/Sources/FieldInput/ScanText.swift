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
      FieldPalette.monitorBackground.ignoresSafeArea()
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
      Image(systemName: "text.viewfinder")
        .font(.system(size: 22, weight: .heavy))
        .foregroundStyle(FieldPalette.textMuted)
      Text("text scanning needs a camera on this device")
        .font(FieldType.mono(11))
        .foregroundStyle(FieldPalette.textMain)
        .multilineTextAlignment(.center)
      Text("nothing was captured")
        .font(FieldType.mono(9))
        .foregroundStyle(FieldPalette.textFaint)
    }
    .padding(.horizontal, 40)
  }

  private var chrome: some View {
    VStack {
      HStack {
        Text("SCAN TEXT")
          .font(FieldType.mono(9, .heavy))
          .tracking(FieldType.tracking(0.18, of: 9))
          .foregroundStyle(FieldPalette.textMain)
          .padding(.horizontal, 10)
          .padding(.vertical, 7)
          .background(
            RoundedRectangle(cornerRadius: 6)
              .fill(FieldPalette.panelBackground.opacity(0.8)))
        Spacer(minLength: 0)
        Button(action: onClose) {
          Text("CLOSE")
            .font(FieldType.mono(9, .heavy))
            .tracking(FieldType.tracking(0.12, of: 9))
            .foregroundStyle(FieldPalette.textMain)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(
              RoundedRectangle(cornerRadius: 6)
                .fill(FieldPalette.panelBackground.opacity(0.8))
            )
            .overlay(
              RoundedRectangle(cornerRadius: 6)
                .strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close the scanner")
      }
      Spacer(minLength: 0)
      if scannerReady {
        Text("tap a line of text to take it")
          .font(FieldType.mono(9))
          .foregroundStyle(FieldPalette.textMain)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(
            RoundedRectangle(cornerRadius: 6)
              .fill(FieldPalette.panelBackground.opacity(0.8)))
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
