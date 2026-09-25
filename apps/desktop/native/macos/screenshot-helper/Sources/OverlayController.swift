import AppKit
import Carbon.HIToolbox

@MainActor
final class OverlayController: NSObject {
    static let shared = OverlayController()

    private var windows: [NSWindow] = []
    private var overlays: [OverlayView] = []
    private var detector: WindowDetector?
    private var snapshots: [DisplaySnapshot] = []
    private var isActive = false
    private var exitOnFinish = true
    private var showPermissionAlert = true
    private var saveSheetOpen = false
    private var onIdle: (() -> Void)?

    func configure(exitOnFinish: Bool, showPermissionAlert: Bool = true, onIdle: (() -> Void)? = nil) {
        self.exitOnFinish = exitOnFinish
        self.showPermissionAlert = showPermissionAlert
        self.onIdle = onIdle
    }

    func registerStandaloneHotkey() {
        NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            Task { @MainActor in
                self?.handleHotkey(event)
            }
        }
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.handleHotkey(event)
            return event
        }
    }

    private func handleHotkey(_ event: NSEvent) {
        let cmdCtrl = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if cmdCtrl.contains([.command, .control]), event.keyCode == UInt16(kVK_ANSI_A) {
            Task { await self.start() }
        }
    }

    func start() async {
        guard !isActive else { return }
        isActive = true
        let started = ProcessInfo.processInfo.systemUptime
        var timings = HostCaptureTimings()
        if !Permissions.promptIfNeeded(showAlert: showPermissionAlert) {
            isActive = false
            HostProtocol.error(.permissionDenied, Permissions.deniedMessage)
            finish()
            return
        }
        timings.permissionMs = (ProcessInfo.processInfo.systemUptime - started) * 1000

        do {
            let windowsStarted = ProcessInfo.processInfo.systemUptime
            detector = WindowDetector(excludingPID: ProcessInfo.processInfo.processIdentifier)
            timings.windowListMs = (ProcessInfo.processInfo.systemUptime - windowsStarted) * 1000
            let captureStarted = ProcessInfo.processInfo.systemUptime
            snapshots = try await ScreenCapture.captureAllDisplays()
            timings.captureMs = (ProcessInfo.processInfo.systemUptime - captureStarted) * 1000
        } catch {
            tearDownOverlays()
            HostProtocol.error(HostErrorCode.forCapture(error), error.localizedDescription)
            finish()
            return
        }

        let overlayStarted = ProcessInfo.processInfo.systemUptime
        NSApp.unhideWithoutActivation()
        NSApp.activate(ignoringOtherApps: true)

        for snapshot in snapshots {
            let screen = NSScreen.screens.first { Geometry.displayID(for: $0) == snapshot.displayID }
            let frame = screen?.frame ?? snapshot.screenFrame
            let window = makeOverlayWindow(frame: frame)
            let view = OverlayView(snapshot: snapshot, detector: detector ?? WindowDetector(excludingPID: 0))
            view.delegate = self
            window.contentView = view
            window.setFrame(frame, display: true)
            window.orderFrontRegardless()
            windows.append(window)
            overlays.append(view)
        }
        // Task-group completion order is arbitrary. Keyboard focus belongs to
        // the display under the pointer, not whichever capture finished first.
        let focused = overlays.first { $0.snapshot.screenFrame.contains(NSEvent.mouseLocation) }
            ?? overlays.first
        focused?.window?.makeKeyAndOrderFront(nil)
        focused?.window?.makeFirstResponder(focused)
        timings.overlayMs = (ProcessInfo.processInfo.systemUptime - overlayStarted) * 1000
        timings.totalMs = (ProcessInfo.processInfo.systemUptime - started) * 1000
        HostProtocol.ready(timings: timings)
    }

    private func makeOverlayWindow(frame: CGRect) -> OverlayWindow {
        OverlayWindow.overlay(frame: frame)
    }

    private func tearDownOverlays() {
        for window in windows {
            window.orderOut(nil)
            window.close()
        }
        windows.removeAll()
        overlays.removeAll()
        snapshots.removeAll()
        detector = nil
        isActive = false
    }

    // SNAP-D6 — the prototype hid the spawning app with an AppleScript call to
    // System Events, which costs the Automation grant for a cosmetic effect.
    // The shell hides its own windows if it ever wants that.
    private func finish() {
        if exitOnFinish {
            NSApp.terminate(nil)
        } else {
            onIdle?()
        }
    }
}

extension OverlayController: OverlayViewDelegate {
    func overlayDidCancel() {
        guard !saveSheetOpen else { return }
        tearDownOverlays()
        HostProtocol.cancel()
        finish()
    }

    func overlayDidConfirm(_ view: OverlayView) {
        guard !saveSheetOpen else { return }
        confirm(from: view)
    }

    func overlayDidRequestSave(_ view: OverlayView, image: CGImage) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.png]
        panel.nameFieldStringValue = "screenshot.png"
        guard let window = view.window ?? windows.first else { return }
        saveSheetOpen = true
        panel.beginSheetModal(for: window) { [weak self] response in
            self?.saveSheetOpen = false
            guard response == .OK, let url = panel.url,
                  let data = ClipboardExport.data(from: image, type: .png)
            else { return }
            try? data.write(to: url)
        }
    }

    private func confirm(from view: OverlayView) {
        guard let image = view.renderedImage() else {
            overlayDidCancel()
            return
        }
        guard let path = ClipboardExport.write(image: image) else {
            HostProtocol.error(.writeFailed, "could not write the screenshot file")
            tearDownOverlays()
            finish()
            return
        }
        HostProtocol.ok(
            path: path.path,
            pixelSize: CGSize(width: image.width, height: image.height),
            scale: view.snapshot.scale,
            displayId: view.snapshot.displayID,
            bounds: view.selection ?? .zero
        )
        tearDownOverlays()
        finish()
    }
}
