import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let args = Array(CommandLine.arguments.dropFirst())
    private var service: HostService?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        if args.contains("--help") || args.contains("-h") {
            print(usage)
            NSApp.terminate(nil)
            return
        }

        let allowed: Set<String> = ["--once", "--service", "--standalone", "--capture-test"]
        guard args.allSatisfy({ allowed.contains($0) }) else {
            HostProtocol.error(.captureFailed, "unknown screenshot helper option")
            NSApp.terminate(nil)
            return
        }

        if args.contains("--capture-test") {
            Task { await runCaptureTest() }
            return
        }

        if args.contains("--service") {
            let service = HostService()
            self.service = service
            OverlayController.shared.configure(
                exitOnFinish: false,
                showPermissionAlert: false,
                onIdle: { [weak service] in service?.completed() }
            )
            service.start {
                Task { await OverlayController.shared.start() }
            }
            return
        }

        let standalone = args.contains("--standalone")
        Task { @MainActor in
            OverlayController.shared.configure(
                exitOnFinish: !standalone,
                showPermissionAlert: standalone
            )
            if standalone {
                OverlayController.shared.registerStandaloneHotkey()
            } else {
                await OverlayController.shared.start()
            }
        }
        if standalone {
            // Stdout carries protocol lines only, so the developer banner is a
            // diagnostic (the design record's §3).
            FileHandle.standardError.write(
                Data("Screenshot helper is running. Press Control+Command+A to capture.\n".utf8)
            )
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationWillTerminate(_ notification: Notification) {
        service?.stop()
    }

    /// No overlay: one PNG per display under the temporary directory, and an
    /// `ok` line naming the first. The gate that proves capture works on a
    /// machine without putting anything on screen.
    @MainActor
    private func runCaptureTest() async {
        if !Permissions.promptIfNeeded(showAlert: true) {
            HostProtocol.error(.permissionDenied, Permissions.deniedMessage)
            NSApp.terminate(nil)
            return
        }
        let snapshots: [DisplaySnapshot]
        do {
            snapshots = try await ScreenCapture.captureAllDisplays()
        } catch {
            HostProtocol.error(HostErrorCode.forCapture(error), error.localizedDescription)
            NSApp.terminate(nil)
            return
        }
        guard let first = snapshots.first else {
            HostProtocol.error(.noDisplays, "no display answered the capture")
            NSApp.terminate(nil)
            return
        }

        var firstPath: String?
        for snapshot in snapshots {
            guard let data = ClipboardExport.data(from: snapshot.image, type: .png) else { continue }
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("vibefield-capture-test-\(snapshot.displayID).png")
            do {
                try data.write(to: url)
            } catch {
                HostProtocol.error(.writeFailed, error.localizedDescription)
                NSApp.terminate(nil)
                return
            }
            if firstPath == nil { firstPath = url.path }
            FileHandle.standardError.write(
                Data("wrote \(url.path) \(snapshot.image.width)x\(snapshot.image.height)\n".utf8)
            )
        }

        guard let path = firstPath else {
            HostProtocol.error(.writeFailed, "no display produced a PNG")
            NSApp.terminate(nil)
            return
        }
        HostProtocol.ok(
            path: path,
            pixelSize: CGSize(width: first.image.width, height: first.image.height),
            scale: first.scale,
            displayId: first.displayID,
            bounds: first.screenFrame
        )
        NSApp.terminate(nil)
    }

    private var usage: String {
        """
        VibeField screenshot helper — freeze the screen, pick a region, copy it.

          field-screenshot-helper --once          Capture now (default)
          field-screenshot-helper --service       Wait for host commands; exit on stdin EOF
          field-screenshot-helper --standalone    Stay running; Control+Command+A captures
          field-screenshot-helper --capture-test  Write one PNG per display, no overlay
          field-screenshot-helper --help          Show this

        Confirming a selection copies it to the clipboard as PNG and TIFF, writes
        the PNG to the temporary directory, and prints one JSON line to stdout.
        """
    }
}
