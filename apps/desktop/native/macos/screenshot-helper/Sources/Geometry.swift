import AppKit
import CoreGraphics

enum Geometry {
    static var mainDisplayHeight: CGFloat {
        CGDisplayBounds(CGMainDisplayID()).height
    }

    static func displayID(for screen: NSScreen) -> CGDirectDisplayID {
        let key = NSDeviceDescriptionKey("NSScreenNumber")
        return screen.deviceDescription[key] as? CGDirectDisplayID ?? CGMainDisplayID()
    }

    static func cgToCocoa(_ rect: CGRect) -> CGRect {
        CGRect(
            x: rect.origin.x,
            y: mainDisplayHeight - rect.origin.y - rect.height,
            width: rect.width,
            height: rect.height
        )
    }

    static func cocoaToCG(_ rect: CGRect) -> CGRect {
        CGRect(
            x: rect.origin.x,
            y: mainDisplayHeight - rect.origin.y - rect.height,
            width: rect.width,
            height: rect.height
        )
    }

    static func cocoaPointToCG(_ point: NSPoint) -> CGPoint {
        CGPoint(x: point.x, y: mainDisplayHeight - point.y)
    }

    /// View point on an overlay that fills `screenFrame` → CGWindowList space.
    /// Uses the screen origin so secondary displays are not treated as (0, 0).
    static func viewPointToCG(_ point: CGPoint, screenFrame: CGRect) -> CGPoint {
        cocoaPointToCG(
            CGPoint(x: point.x + screenFrame.origin.x, y: point.y + screenFrame.origin.y)
        )
    }

    static func viewRect(fromCGWindowFrame cgRect: CGRect, screenFrame: CGRect) -> CGRect {
        let cocoa = cgToCocoa(cgRect)
        return CGRect(
            x: cocoa.origin.x - screenFrame.origin.x,
            y: cocoa.origin.y - screenFrame.origin.y,
            width: cocoa.width,
            height: cocoa.height
        )
    }

    static func normalizedRect(from a: CGPoint, to b: CGPoint) -> CGRect {
        CGRect(
            x: min(a.x, b.x),
            y: min(a.y, b.y),
            width: abs(a.x - b.x),
            height: abs(a.y - b.y)
        )
    }

    static func clamp(_ rect: CGRect, to bounds: CGRect) -> CGRect {
        var r = rect
        if r.width > bounds.width { r.size.width = bounds.width }
        if r.height > bounds.height { r.size.height = bounds.height }
        r.origin.x = min(max(r.origin.x, bounds.minX), bounds.maxX - r.width)
        r.origin.y = min(max(r.origin.y, bounds.minY), bounds.maxY - r.height)
        return r
    }
}

enum Handle: CaseIterable {
    case topLeft, top, topRight, right, bottomRight, bottom, bottomLeft, left

    func rect(in selection: CGRect, size: CGFloat = 8) -> CGRect {
        let mid = CGPoint(x: selection.midX, y: selection.midY)
        let point: CGPoint
        switch self {
        case .topLeft: point = CGPoint(x: selection.minX, y: selection.maxY)
        case .top: point = CGPoint(x: mid.x, y: selection.maxY)
        case .topRight: point = CGPoint(x: selection.maxX, y: selection.maxY)
        case .right: point = CGPoint(x: selection.maxX, y: mid.y)
        case .bottomRight: point = CGPoint(x: selection.maxX, y: selection.minY)
        case .bottom: point = CGPoint(x: mid.x, y: selection.minY)
        case .bottomLeft: point = CGPoint(x: selection.minX, y: selection.minY)
        case .left: point = CGPoint(x: selection.minX, y: mid.y)
        }
        return CGRect(x: point.x - size / 2, y: point.y - size / 2, width: size, height: size)
    }

    func apply(to rect: CGRect, delta: CGPoint, bounds: CGRect) -> CGRect {
        var r = rect
        switch self {
        case .topLeft:
            r.origin.x += delta.x
            r.size.width -= delta.x
            r.size.height += delta.y
        case .top:
            r.size.height += delta.y
        case .topRight:
            r.size.width += delta.x
            r.size.height += delta.y
        case .right:
            r.size.width += delta.x
        case .bottomRight:
            r.origin.y += delta.y
            r.size.width += delta.x
            r.size.height -= delta.y
        case .bottom:
            r.origin.y += delta.y
            r.size.height -= delta.y
        case .bottomLeft:
            r.origin.x += delta.x
            r.origin.y += delta.y
            r.size.width -= delta.x
            r.size.height -= delta.y
        case .left:
            r.origin.x += delta.x
            r.size.width -= delta.x
        }
        if r.width < 4 {
            r.size.width = 4
        }
        if r.height < 4 {
            r.size.height = 4
        }
        return Geometry.clamp(r, to: bounds)
    }

    var cursor: NSCursor {
        if #available(macOS 15.0, *) {
            let position: NSCursor.FrameResizePosition
            switch self {
            case .topLeft: position = .topLeft
            case .top: position = .top
            case .topRight: position = .topRight
            case .right: position = .right
            case .bottomRight: position = .bottomRight
            case .bottom: position = .bottom
            case .bottomLeft: position = .bottomLeft
            case .left: position = .left
            }
            return NSCursor.frameResize(position: position, directions: .all)
        }
        switch self {
        case .topLeft, .bottomRight, .topRight, .bottomLeft:
            return .crosshair
        case .top, .bottom:
            return .resizeUpDown
        case .left, .right:
            return .resizeLeftRight
        }
    }
}
