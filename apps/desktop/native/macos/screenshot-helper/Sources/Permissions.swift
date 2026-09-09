import AppKit
import CoreGraphics

enum Permissions {
    /// The one-line reason that rides the wire on a `permission-denied` error.
    /// Matches the contract fixture `screenshot-helper-event.error.json`.
    static let deniedMessage = "Screen Recording permission is required"

    static func hasScreenRecording() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    @discardableResult
    static func requestScreenRecording() -> Bool {
        CGRequestScreenCaptureAccess()
    }

    static func openScreenRecordingSettings() {
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        if let url {
            NSWorkspace.shared.open(url)
        }
    }

    /// SNAP-D6 — when Electron spawns the helper the grant attributes to the
    /// RESPONSIBLE process (the shell), so the alert names no row: it says what
    /// the permission is for and where to turn it on.
    static func promptIfNeeded(showAlert: Bool = true) -> Bool {
        if hasScreenRecording() {
            return true
        }
        requestScreenRecording()
        if hasScreenRecording() {
            return true
        }
        guard showAlert else {
            return false
        }
        let alert = NSAlert()
        alert.messageText = deniedMessage
        alert.informativeText = """
        VibeField needs Screen Recording to take screenshots of your screen.

        Turn it on in System Settings → Privacy & Security → Screen Recording, then take the screenshot again.
        """
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Open Settings")
        alert.addButton(withTitle: "Cancel")
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            openScreenRecordingSettings()
        }
        return hasScreenRecording()
    }
}
