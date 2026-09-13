import AppKit
import CoreGraphics

struct DetectedWindow {
    let name: String
    let windowID: CGWindowID
    let layer: Int
    let frame: CGRect
}

struct WindowDetector {
    private let windows: [DetectedWindow]

    init(windows: [DetectedWindow]) {
        self.windows = windows
    }

    init(excludingPID: pid_t) {
        let selectable: Set<Int> = [
            Int(CGWindowLevelForKey(.normalWindow)),
            Int(CGWindowLevelForKey(.floatingWindow)),
            Int(CGWindowLevelForKey(.modalPanelWindow)),
            Int(CGWindowLevelForKey(.utilityWindow)),
        ]

        let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        let list = (raw as? [[String: Any]]) ?? []
        let displayBounds = NSScreen.screens.map { Geometry.cocoaToCG($0.frame) }

        windows = list.compactMap { info in
            guard
                let pid = info[kCGWindowOwnerPID as String] as? pid_t,
                pid != excludingPID,
                let bounds = info[kCGWindowBounds as String] as? NSDictionary,
                let layer = info[kCGWindowLayer as String] as? Int,
                layer >= 0,
                selectable.contains(layer)
            else { return nil }

            if let alpha = info[kCGWindowAlpha as String] as? Double, alpha <= 0 {
                return nil
            }

            var rect = CGRect.zero
            guard CGRectMakeWithDictionaryRepresentation(bounds as CFDictionary, &rect) else { return nil }
            guard rect.width > 8, rect.height > 8 else { return nil }
            if Self.coversMostOfADisplay(rect, displays: displayBounds) {
                return nil
            }

            let name = info[kCGWindowOwnerName as String] as? String ?? ""
            let windowID = info[kCGWindowNumber as String] as? CGWindowID ?? 0
            return DetectedWindow(name: name, windowID: windowID, layer: layer, frame: rect)
        }
    }

    func window(atCGPoint point: CGPoint) -> DetectedWindow? {
        Self.frontmost(at: point, in: windows)
    }

    /// Front-to-back: first frame that contains the point wins (CGWindowList order).
    static func frontmost(at point: CGPoint, in windows: [DetectedWindow]) -> DetectedWindow? {
        windows.first { $0.frame.contains(point) }
    }

    static func coversMostOfADisplay(_ rect: CGRect, displays: [CGRect]) -> Bool {
        let windowArea = rect.width * rect.height
        for display in displays {
            let area = display.width * display.height
            guard area > 0 else { continue }
            let overlap = rect.intersection(display)
            guard !overlap.isNull, overlap.width * overlap.height > area * 0.5 else { continue }
            if windowArea > area * 0.98 {
                return true
            }
        }
        return false
    }
}
