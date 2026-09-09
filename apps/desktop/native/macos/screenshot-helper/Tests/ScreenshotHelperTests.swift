import AppKit
import CoreGraphics
import Foundation
import UniformTypeIdentifiers

@main
enum ScreenshotHelperTests {
    static func main() {
        testNormalizedRect()
        testClamp()
        testHandleResize()
        testWindowFrontmostHit()
        testCoversMostOfADisplay()
        testViewPointToCGOnSecondaryDisplay()
        testOverlayWindowCanBecomeKey()
        testCompositorMarksEachTool()
        testPNGAndTIFFEncode()
        testHostJSON()
        testHostJSONCarriesVersionAndCode()
        testContractFixturesDecode()
        print("ALL PASSED")
    }

    static func testNormalizedRect() {
        let rect = Geometry.normalizedRect(from: CGPoint(x: 30, y: 10), to: CGPoint(x: 10, y: 40))
        expect(rect.origin.x == 10 && rect.origin.y == 10, "normalizedRect origin")
        expect(rect.width == 20 && rect.height == 30, "normalizedRect size")
        let same = Geometry.normalizedRect(from: CGPoint(x: 5, y: 5), to: CGPoint(x: 5, y: 5))
        expect(same.width == 0 && same.height == 0, "normalizedRect zero")
    }

    static func testClamp() {
        let bounds = CGRect(x: 0, y: 0, width: 100, height: 80)
        let clamped = Geometry.clamp(CGRect(x: -20, y: -10, width: 40, height: 30), to: bounds)
        expect(clamped.origin.x == 0 && clamped.origin.y == 0, "clamp origin into bounds")
        expect(clamped.width == 40 && clamped.height == 30, "clamp keeps size when it fits")
        let tooWide = Geometry.clamp(CGRect(x: 10, y: 10, width: 400, height: 10), to: bounds)
        expect(tooWide.width == 100, "clamp shrinks width to bounds")
        expect(tooWide.origin.x == 0, "clamp recenters x after shrink")
        let slid = Geometry.clamp(CGRect(x: 0, y: 70, width: 10, height: 40), to: bounds)
        expect(slid.height == 40, "clamp keeps height when it fits")
        expect(slid.origin.y == 40, "clamp slides y so the rect stays in bounds")
        let tooTall = Geometry.clamp(CGRect(x: 0, y: 0, width: 10, height: 400), to: bounds)
        expect(tooTall.height == 80, "clamp shrinks height to bounds")
        expect(tooTall.origin.y == 0, "clamp y after height shrink")
    }

    static func testHandleResize() {
        let bounds = CGRect(x: 0, y: 0, width: 200, height: 200)
        let rect = CGRect(x: 40, y: 50, width: 60, height: 40)
        let right = Handle.right.apply(to: rect, delta: CGPoint(x: 15, y: 3), bounds: bounds)
        expect(right.width == 75, "right handle grows width")
        expect(right.origin.x == 40 && right.height == 40, "right handle keeps origin and height")
        let left = Handle.left.apply(to: rect, delta: CGPoint(x: 10, y: 0), bounds: bounds)
        expect(left.origin.x == 50, "left handle moves origin")
        expect(left.width == 50, "left handle shrinks width")
        let top = Handle.top.apply(to: rect, delta: CGPoint(x: 0, y: 8), bounds: bounds)
        expect(top.height == 48, "top handle grows height")
        expect(top.origin.y == 50, "top handle keeps minY")
        let tiny = Handle.right.apply(to: rect, delta: CGPoint(x: -1000, y: 0), bounds: bounds)
        expect(tiny.width >= 4, "handle enforces min width")
    }

    static func testWindowFrontmostHit() {
        let front = DetectedWindow(name: "front", windowID: 1, layer: 0, frame: CGRect(x: 10, y: 10, width: 40, height: 40))
        let back = DetectedWindow(name: "back", windowID: 2, layer: 0, frame: CGRect(x: 0, y: 0, width: 100, height: 100))
        let list = [front, back]
        let hitFront = WindowDetector.frontmost(at: CGPoint(x: 20, y: 20), in: list)
        expect(hitFront?.name == "front", "frontmost window wins overlap")
        let hitBack = WindowDetector.frontmost(at: CGPoint(x: 80, y: 80), in: list)
        expect(hitBack?.name == "back", "uncovered back window is hit")
        let miss = WindowDetector.frontmost(at: CGPoint(x: 400, y: 400), in: list)
        expect(miss == nil, "point outside all frames misses")
        let detector = WindowDetector(windows: list)
        expect(detector.window(atCGPoint: CGPoint(x: 20, y: 20))?.windowID == 1, "instance hit-test uses the list")
    }

    static func testCoversMostOfADisplay() {
        let laptop = CGRect(x: 0, y: 0, width: 1440, height: 900)
        let studio = CGRect(x: 1440, y: 0, width: 5120, height: 2880)
        let midOnStudio = CGRect(x: 1600, y: 100, width: 1600, height: 1000)
        expect(
            !WindowDetector.coversMostOfADisplay(midOnStudio, displays: [laptop, studio]),
            "mid-size window on a large display is not dropped because of the laptop"
        )
        let fullLaptop = CGRect(x: 0, y: 0, width: 1440, height: 900)
        expect(
            WindowDetector.coversMostOfADisplay(fullLaptop, displays: [laptop, studio]),
            "fullscreen on its own display is dropped"
        )
    }

    static func testViewPointToCGOnSecondaryDisplay() {
        let screenFrame = CGRect(x: 1920, y: -120, width: 1440, height: 900)
        let viewPoint = CGPoint(x: 80, y: 40)
        let naive = Geometry.cocoaPointToCG(viewPoint)
        let mapped = Geometry.viewPointToCG(viewPoint, screenFrame: screenFrame)
        expect(mapped.x == viewPoint.x + screenFrame.origin.x, "CG x includes screen origin")
        expect(mapped.x != naive.x, "non-zero screen origin is not treated as primary")
        expect(
            mapped.y == Geometry.mainDisplayHeight - (viewPoint.y + screenFrame.origin.y),
            "CG y flips from screen-space cocoa"
        )

        let windowFrame = CGRect(
            x: mapped.x - 10,
            y: mapped.y - 10,
            width: 40,
            height: 40
        )
        let listed = [
            DetectedWindow(name: "external", windowID: 9, layer: 0, frame: windowFrame),
        ]
        expect(
            WindowDetector.frontmost(at: mapped, in: listed)?.name == "external",
            "snap hits the window at the screen-mapped CG point"
        )
        expect(
            WindowDetector.frontmost(at: naive, in: listed) == nil,
            "unmapped view point must not hit a window on another display"
        )
    }

    static func testOverlayWindowCanBecomeKey() {
        _ = NSApplication.shared
        let overlay = OverlayWindow.overlay(frame: NSRect(x: 0, y: 0, width: 200, height: 120))
        expect(overlay.styleMask.contains(.borderless), "overlay is borderless")
        expect(overlay.canBecomeKey, "borderless overlay canBecomeKey")
        expect(overlay.canBecomeMain, "borderless overlay canBecomeMain")

        let stock = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 200, height: 120),
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        expect(!stock.canBecomeKey, "stock borderless NSWindow cannot become key")
        overlay.close()
        stock.close()
    }

    static func testCompositorMarksEachTool() {
        let viewSize = CGSize(width: 200, height: 120)
        let snapshot = makeGradientImage(width: 200, height: 120)
        let selection = CGRect(x: 40, y: 20, width: 80, height: 60)
        guard let unmarked = ImageCompositor.composite(
            snapshot: snapshot,
            selection: selection,
            viewSize: viewSize,
            annotations: []
        ) else {
            fail("unmarked composite returned nil")
            return
        }
        expect(unmarked.width > 0 && unmarked.height > 0, "unmarked crop has pixels")

        let tools: [(Tool, Annotation)] = [
            (.rectangle, Annotation(tool: .rectangle, start: CGPoint(x: 45, y: 25), end: CGPoint(x: 110, y: 70), points: [], color: .systemRed, lineWidth: 4)),
            (.ellipse, Annotation(tool: .ellipse, start: CGPoint(x: 48, y: 28), end: CGPoint(x: 108, y: 72), points: [], color: .systemBlue, lineWidth: 4)),
            (.arrow, Annotation(tool: .arrow, start: CGPoint(x: 50, y: 30), end: CGPoint(x: 110, y: 70), points: [], color: .systemYellow, lineWidth: 4)),
            (.pen, Annotation(tool: .pen, start: CGPoint(x: 50, y: 30), end: CGPoint(x: 110, y: 70), points: [CGPoint(x: 50, y: 30), CGPoint(x: 70, y: 55), CGPoint(x: 110, y: 70)], color: .systemPurple, lineWidth: 5)),
            (.mosaic, Annotation(tool: .mosaic, start: CGPoint(x: 42, y: 22), end: CGPoint(x: 118, y: 78), points: [], color: .black, lineWidth: 1)),
        ]

        for (tool, annotation) in tools {
            guard let marked = ImageCompositor.composite(
                snapshot: snapshot,
                selection: selection,
                viewSize: viewSize,
                annotations: [annotation]
            ) else {
                fail("composite nil for \(tool)")
                continue
            }
            expect(marked.width == unmarked.width && marked.height == unmarked.height, "\(tool) crop size matches unmarked")
            expect(!samePixels(marked, unmarked), "\(tool) markup changes crop pixels")
        }
    }

    static func testPNGAndTIFFEncode() {
        let image = makeGradientImage(width: 32, height: 24)
        guard let png = ClipboardExport.data(from: image, type: .png) else {
            fail("PNG encode returned nil")
            return
        }
        guard let tiff = ClipboardExport.data(from: image, type: .tiff) else {
            fail("TIFF encode returned nil")
            return
        }
        expect(!png.isEmpty, "PNG data non-empty")
        expect(!tiff.isEmpty, "TIFF data non-empty")
        expect(png.starts(with: [0x89, 0x50, 0x4E, 0x47]), "PNG magic 89 50 4E 47")
        let tiffLE = tiff.starts(with: [0x49, 0x49, 0x2A, 0x00])
        let tiffBE = tiff.starts(with: [0x4D, 0x4D, 0x00, 0x2A])
        expect(tiffLE || tiffBE, "TIFF magic II* or MM*")
    }

    static func testHostJSON() {
        let ok = HostProtocol.makeOK(
            path: "/tmp/example.png",
            pixelSize: CGSize(width: 12, height: 8),
            scale: 2,
            displayId: 1,
            bounds: CGRect(x: 1, y: 2, width: 3, height: 4)
        )
        let cancel = HostProtocol.makeCancel()
        let error = HostProtocol.makeError(.captureFailed, "boom")
        expect(ok.status == "ok", "ok status string")
        expect(cancel.status == "cancel", "cancel status string")
        expect(error.status == "error", "error status string")

        for result in [ok, cancel, error] {
            guard let data = HostProtocol.encode(result) else {
                fail("encode nil for \(result.status)")
                continue
            }
            expect(String(data: data, encoding: .utf8) != nil, "\(result.status) is UTF-8 JSON")
            do {
                let decoded = try HostProtocol.decode(data)
                expect(decoded.status == result.status, "decode preserves \(result.status)")
                if result.status == "ok" {
                    expect(decoded.path == "/tmp/example.png", "ok path round-trips")
                    expect(decoded.width == 12 && decoded.height == 8, "ok size round-trips")
                    expect(decoded.scale == 2, "ok scale round-trips")
                }
                if result.status == "error" {
                    expect(decoded.code == .captureFailed, "error code round-trips")
                    expect(decoded.message == "boom", "error message round-trips")
                }
            } catch {
                fail("decode \(result.status): \(error)")
            }
        }
    }

    /// SNAP-D2 — every emitted line carries the version, and an error carries a
    /// typed `code` + `message` where the prototype carried free-text `error`.
    static func testHostJSONCarriesVersionAndCode() {
        let ok = HostProtocol.makeOK(
            path: "/tmp/example.png",
            pixelSize: CGSize(width: 12, height: 8),
            scale: 2,
            displayId: 1,
            bounds: CGRect(x: 1, y: 2, width: 3, height: 4)
        )
        guard let okData = HostProtocol.encode(ok),
              let okLine = String(data: okData, encoding: .utf8)
        else {
            fail("ok encode returned nil")
            return
        }
        expect(okLine.contains("\"v\":1"), "ok line carries the protocol version")

        guard let errorData = HostProtocol.encode(HostProtocol.makeError(.permissionDenied, "x")),
              let errorLine = String(data: errorData, encoding: .utf8)
        else {
            fail("error encode returned nil")
            return
        }
        expect(errorLine.contains("\"v\":1"), "error line carries the protocol version")
        expect(errorLine.contains("\"code\":\"permission-denied\""), "error line carries the typed code")
        expect(errorLine.contains("\"message\":\"x\""), "error line carries the message")
        expect(!errorLine.contains("\"error\":"), "the prototype's free-text `error` key is gone")

        for result in [HostProtocol.makeReady(), HostProtocol.makeCancel()] {
            guard let data = HostProtocol.encode(result),
                  let line = String(data: data, encoding: .utf8)
            else {
                fail("encode returned nil for \(result.status)")
                continue
            }
            expect(line.contains("\"v\":1"), "\(result.status) line carries the protocol version")
        }
    }

    /// EL9 — the SAME fixtures zod parses in `packages/contracts` are decoded
    /// here. `VF_CONTRACT_FIXTURES` names the directory; an unset variable or a
    /// short directory is a failure, never a silent skip.
    static func testContractFixturesDecode() {
        guard let directory = ProcessInfo.processInfo.environment["VF_CONTRACT_FIXTURES"],
              !directory.isEmpty
        else {
            fail("VF_CONTRACT_FIXTURES is unset — the fixture test must not silently skip")
            return
        }
        let names: [String]
        do {
            names = try FileManager.default.contentsOfDirectory(atPath: directory)
        } catch {
            fail("could not read VF_CONTRACT_FIXTURES \(directory): \(error)")
            return
        }
        let fixtures = names
            .filter { $0.hasPrefix("screenshot-helper-event.") && $0.hasSuffix(".json") }
            .sorted()
        if fixtures.count < 6 {
            fail("expected at least 6 helper-event fixtures in \(directory), found \(fixtures.count)")
            return
        }

        for name in fixtures {
            let url = URL(fileURLWithPath: directory).appendingPathComponent(name)
            let decoded: HostResult
            do {
                decoded = try HostProtocol.decode(try Data(contentsOf: url))
            } catch {
                fail("decode \(name): \(error)")
                continue
            }
            expect(decoded.v == 1, "\(name) carries v 1")

            let segment = name.split(separator: ".").dropFirst().first.map(String.init) ?? ""
            let expected: String
            switch segment {
            case "ready", "ok", "cancel", "error": expected = segment
            default: expected = "ok"
            }
            expect(decoded.status == expected, "\(name) decodes as \(expected)")

            if expected == "ok" {
                expect(!(decoded.path ?? "").isEmpty, "\(name) names a still")
                expect((decoded.width ?? 0) > 0 && (decoded.height ?? 0) > 0, "\(name) has pixels")
                expect((decoded.scale ?? 0) > 0, "\(name) has a positive scale")
                expect(decoded.bounds != nil, "\(name) carries bounds")
            }
            if expected == "error" {
                expect(decoded.code == .permissionDenied, "\(name) decodes the typed code")
                expect(!(decoded.message ?? "").isEmpty, "\(name) carries a message")
            }
            if name.contains("ok-windows") {
                expect((decoded.path ?? "").contains("\\"), "\(name) keeps the Windows path separator")
            }
        }
        print("ok  decoded \(fixtures.count) contract fixtures from \(directory)")
    }

    static func makeGradientImage(width: Int, height: Int) -> CGImage {
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        for y in 0..<height {
            for x in 0..<width {
                let i = (y * width + x) * 4
                bytes[i + 0] = UInt8((x * 255) / max(width - 1, 1))
                bytes[i + 1] = UInt8((y * 255) / max(height - 1, 1))
                bytes[i + 2] = UInt8(((x + y) * 255) / max(width + height - 2, 1))
                bytes[i + 3] = 255
            }
        }
        let data = Data(bytes)
        let provider = CGDataProvider(data: data as CFData)!
        return CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
        )!
    }

    static func samePixels(_ a: CGImage, _ b: CGImage) -> Bool {
        rgba(a) == rgba(b)
    }

    static func rgba(_ image: CGImage) -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        bytes.withUnsafeMutableBytes { ptr in
            guard let ctx = CGContext(
                data: ptr.baseAddress,
                width: image.width,
                height: image.height,
                bitsPerComponent: 8,
                bytesPerRow: image.width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return }
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        return bytes
    }

    static func expect(_ condition: Bool, _ message: String) {
        if condition {
            print("ok  \(message)")
        } else {
            fail(message)
        }
    }

    static func fail(_ message: String) {
        fputs("FAIL \(message)\n", stderr)
        exit(1)
    }
}
