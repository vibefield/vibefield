import AppKit
import ImageIO
import UniformTypeIdentifiers

enum ClipboardExport {
    static func write(image: CGImage, to pasteboard: NSPasteboard = .general) -> URL? {
        let png = data(from: image, type: .png)
        let tiff = data(from: image, type: .tiff)
        pasteboard.clearContents()
        if let png {
            pasteboard.setData(png, forType: .png)
        }
        if let tiff {
            pasteboard.setData(tiff, forType: .tiff)
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("vibefield-screenshot-\(Int(Date().timeIntervalSince1970 * 1000)).png")
        guard let png else { return nil }
        do {
            try png.write(to: url)
            return url
        } catch {
            return nil
        }
    }

    static func savePanel(image: CGImage, from window: NSWindow?) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.png]
        panel.nameFieldStringValue = "screenshot.png"
        panel.beginSheetModal(for: window ?? NSApp.mainWindow ?? NSWindow()) { response in
            guard response == .OK, let url = panel.url, let png = data(from: image, type: .png) else { return }
            try? png.write(to: url)
        }
    }

    static func data(from image: CGImage, type: UTType) -> Data? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil) else {
            return nil
        }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return data as Data
    }
}
