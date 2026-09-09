import AppKit
import CoreGraphics
import ScreenCaptureKit

struct DisplaySnapshot: @unchecked Sendable {
    let displayID: CGDirectDisplayID
    let screenFrame: CGRect
    let scale: CGFloat
    let image: CGImage
}

enum ScreenCaptureError: LocalizedError {
    case noDisplays
    case captureFailed(CGDirectDisplayID, String)

    var errorDescription: String? {
        switch self {
        case .noDisplays:
            return "No displays available"
        case let .captureFailed(id, message):
            return "Capture failed for display \(id): \(message)"
        }
    }
}

extension HostErrorCode {
    /// SNAP-D2 — map a capture failure onto the wire vocabulary. Only "no
    /// displays" has its own code; everything else the chain (ScreenCaptureKit,
    /// then the CoreGraphics fallback) can throw is a capture failure.
    static func forCapture(_ error: Error) -> HostErrorCode {
        if let captureError = error as? ScreenCaptureError, case .noDisplays = captureError {
            return .noDisplays
        }
        return .captureFailed
    }
}

enum ScreenCapture {
    static func captureAllDisplays() async throws -> [DisplaySnapshot] {
        let screens = NSScreen.screens
        guard !screens.isEmpty else { throw ScreenCaptureError.noDisplays }

        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )

        return try await withThrowingTaskGroup(of: DisplaySnapshot.self) { group in
            for screen in screens {
                let displayID = Geometry.displayID(for: screen)
                let frame = screen.frame
                let scale = screen.backingScaleFactor
                group.addTask {
                    try await captureDisplay(
                        displayID: displayID,
                        frame: frame,
                        scale: scale,
                        content: content
                    )
                }
            }
            var result: [DisplaySnapshot] = []
            for try await snapshot in group {
                result.append(snapshot)
            }
            return result
        }
    }

    private static func captureDisplay(
        displayID: CGDirectDisplayID,
        frame: CGRect,
        scale: CGFloat,
        content: SCShareableContent
    ) async throws -> DisplaySnapshot {
        let pixelWidth = max(Int(ceil(frame.width * scale)), 1)
        let pixelHeight = max(Int(ceil(frame.height * scale)), 1)

        if let display = content.displays.first(where: { $0.displayID == displayID }) {
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let config = SCStreamConfiguration()
            config.width = pixelWidth
            config.height = pixelHeight
            config.capturesAudio = false
            config.showsCursor = false
            config.captureResolution = .best
            do {
                let image = try await SCScreenshotManager.captureImage(
                    contentFilter: filter,
                    configuration: config
                )
                return DisplaySnapshot(
                    displayID: displayID,
                    screenFrame: frame,
                    scale: scale,
                    image: image
                )
            } catch {
                if let fallback = fallbackImage(displayID: displayID) {
                    return DisplaySnapshot(
                        displayID: displayID,
                        screenFrame: frame,
                        scale: scale,
                        image: fallback
                    )
                }
                throw ScreenCaptureError.captureFailed(displayID, error.localizedDescription)
            }
        }

        if let fallback = fallbackImage(displayID: displayID) {
            return DisplaySnapshot(
                displayID: displayID,
                screenFrame: frame,
                scale: scale,
                image: fallback
            )
        }
        throw ScreenCaptureError.captureFailed(displayID, "display not in SCShareableContent")
    }

    private static func fallbackImage(displayID: CGDirectDisplayID) -> CGImage? {
        CGDisplayCreateImage(displayID)
    }

    /// Sample one pixel into sRGB by drawing it, so BGRA/RGBA/skip-alpha all work.
    static func pixelColor(in image: CGImage, atPixelX x: Int, y: Int) -> NSColor? {
        guard x >= 0, y >= 0, x < image.width, y < image.height else { return nil }
        guard let cropped = image.cropping(to: CGRect(x: x, y: y, width: 1, height: 1)) else { return nil }
        var pixel = [UInt8](repeating: 0, count: 4)
        let drew = pixel.withUnsafeMutableBytes { ptr -> Bool in
            guard let ctx = CGContext(
                data: ptr.baseAddress,
                width: 1,
                height: 1,
                bitsPerComponent: 8,
                bytesPerRow: 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            ctx.interpolationQuality = .none
            ctx.draw(cropped, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            return true
        }
        guard drew else { return nil }
        return NSColor(
            srgbRed: CGFloat(pixel[0]) / 255,
            green: CGFloat(pixel[1]) / 255,
            blue: CGFloat(pixel[2]) / 255,
            alpha: 1
        )
    }
}
