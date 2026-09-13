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

    func configure(exitOnFinish: Bool, showPermissionAlert: Bool = true) {
        self.exitOnFinish = exitOnFinish
        self.showPermissionAlert = showPermissionAlert
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
        if !Permissions.promptIfNeeded(showAlert: showPermissionAlert) {
            isActive = false
            HostProtocol.error(.permissionDenied, Permissions.deniedMessage)
            if exitOnFinish { NSApp.terminate(nil) }
            return
        }

        do {
            detector = WindowDetector(excludingPID: ProcessInfo.processInfo.processIdentifier)
            snapshots = try await ScreenCapture.captureAllDisplays()
        } catch {
            isActive = false
            HostProtocol.error(HostErrorCode.forCapture(error), error.localizedDescription)
            if exitOnFinish { NSApp.terminate(nil) }
            return
        }

        NSApp.activate(ignoringOtherApps: true)

        for snapshot in snapshots {
            let screen = NSScreen.screens.first { Geometry.displayID(for: $0) == snapshot.displayID }
            let frame = screen?.frame ?? snapshot.screenFrame
            let window = makeOverlayWindow(frame: frame)
            let view = OverlayView(snapshot: snapshot, detector: detector ?? WindowDetector(excludingPID: 0))
            view.delegate = self
            window.contentView = view
            window.setFrame(frame, display: true)
            window.makeKeyAndOrderFront(nil)
            windows.append(window)
            overlays.append(view)
        }
        overlays.first?.window?.makeFirstResponder(overlays.first)
        HostProtocol.ready()
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
        isActive = false
    }

    // SNAP-D6 — the prototype hid the spawning app with an AppleScript call to
    // System Events, which costs the Automation grant for a cosmetic effect.
    // The shell hides its own windows if it ever wants that.
    private func finish() {
        if exitOnFinish {
            NSApp.terminate(nil)
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
