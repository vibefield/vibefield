import AppKit
import CoreGraphics

/// Borderless overlay must override these — AppKit otherwise refuses key status,
/// so Esc / Enter / Space / ⌘Z never reach the view.
final class OverlayWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    static func overlay(frame: CGRect) -> OverlayWindow {
        let window = OverlayWindow(
            contentRect: frame,
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.screenSaverWindow)) + 2)
        window.collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .stationary,
            .ignoresCycle,
            .transient,
        ]
        window.sharingType = .none
        window.ignoresMouseEvents = false
        window.acceptsMouseMovedEvents = true
        window.isReleasedWhenClosed = false
        window.animationBehavior = .none
        if #available(macOS 11.0, *) {
            window.titlebarAppearsTransparent = true
        }
        return window
    }
}
