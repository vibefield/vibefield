import FieldDesign
import FieldMesh
import SwiftUI
import UIKit
import VisionKit

/// TS-7b — "Scan the code on your computer" (since WI-1 the way in's own
/// cover): the in-app reader for the code a desktop's Add your phone shows
/// (`PhoneCode`). Scan Text's shape (FieldInput), for a QR: a full-screen
/// cover, black in both themes, VisionKit's own scanner, and the honest
/// absence on a device with none (every simulator). Its words are `Words`:
/// the phone says "computer" where it said "Mac" (DESIGN.md §9).
///
/// A code is taken the moment it is read — there is one on the computer's
/// screen and nothing to choose between. A QR that is not ours is said, once, and the
/// reader keeps looking; nothing leaves it but a parsed code.
struct MacCodeReader: View {
  let onCode: (PhoneCode) -> Void
  let onClose: () -> Void

  @State private var refused = false
  /// The scanner can hand the same code over more than once before the cover
  /// is gone: one code is taken, once.
  @State private var taken = false

  private var scannerReady: Bool {
    DataScannerViewController.isSupported && DataScannerViewController.isAvailable
  }

  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()
      if scannerReady {
        QRScannerView { payload in
          guard !taken else { return }
          switch PhoneCode.parse(payload) {
          case .success(let code):
            taken = true
            onCode(code)
          case .failure: refused = true
          }
        }
        .ignoresSafeArea()
      } else {
        unsupported
      }
      chrome
    }
  }

  private var unsupported: some View {
    VStack(spacing: 10) {
      Image(systemName: "qrcode.viewfinder")
        .font(.system(size: 26, weight: .regular))
        .foregroundStyle(ChromePalette.inkTertiary)
      Text(Words.noCamera)
        .font(ChromeType.sans(ChromeType.sheetTitleSize, .semibold))
        .foregroundStyle(ChromePalette.ink)
        .multilineTextAlignment(.center)
      Text(Words.nothingRead)
        .font(ChromeType.sans(ChromeType.sheetBodySize))
        .foregroundStyle(ChromePalette.inkTertiary)
    }
    .padding(.horizontal, 40)
  }

  private var chrome: some View {
    VStack {
      HStack {
        Text(Words.title)
          .font(ChromeType.sans(ChromeType.stripSize, .semibold))
          .foregroundStyle(ChromePalette.ink)
          .padding(.horizontal, 16)
          .frame(height: 36)
          .background { Capsule().fill(ChromePalette.keyFill) }
        Spacer(minLength: 0)
        Button(action: onClose) {
          Text(Words.close)
        }
        .buttonStyle(ChromePillStyle(.secondary))
        .accessibilityLabel(Words.closeLabel)
      }
      Spacer(minLength: 0)
      if scannerReady {
        Text(refused ? Words.refused : Words.point)
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

extension MacCodeReader {
  /// The reader's words, every one of them (WI-1's review, M2): the phone says "computer" where it said "Mac"
  /// (DESIGN.md §9), and the title is the welcome's own act.
  enum Words {
    static let title = "Scan the code on your computer"
    static let point = "Point the camera at Add your phone on your computer"
    static let refused = "That code isn’t from VibeField on a computer"
    static let noCamera = "Scanning needs a camera on this device"
    static let nothingRead = "Nothing was read"
    static let close = "Close"
    static let closeLabel = "Close the reader"

    static let all = [title, point, refused, noCamera, nothingRead, close, closeLabel]
  }
}

/// VisionKit's scanner, reading QR codes only, each payload handed on as it
/// is recognized.
private struct QRScannerView: UIViewControllerRepresentable {
  let onPayload: (String) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(onPayload: onPayload) }

  func makeUIViewController(context: Context) -> DataScannerViewController {
    let scanner = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: [.qr])],
      qualityLevel: .balanced,
      recognizesMultipleItems: false,
      isHighFrameRateTrackingEnabled: false,
      isGuidanceEnabled: true,
      isHighlightingEnabled: true)
    scanner.delegate = context.coordinator
    return scanner
  }

  func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
    context.coordinator.onPayload = onPayload
    guard !context.coordinator.started else { return }
    context.coordinator.started = true
    try? scanner.startScanning()
  }

  static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
    scanner.stopScanning()
  }

  @MainActor
  final class Coordinator: NSObject, DataScannerViewControllerDelegate {
    var onPayload: (String) -> Void
    var started = false

    init(onPayload: @escaping (String) -> Void) {
      self.onPayload = onPayload
    }

    func dataScanner(
      _ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]
    ) {
      for item in addedItems {
        if case .barcode(let barcode) = item, let payload = barcode.payloadStringValue {
          onPayload(payload)
        }
      }
    }
  }
}
