import Foundation

/// SNAP-D2 — the helper's stdout line protocol. One JSON object per line,
/// `\n`-terminated, `"v": 1` on every line, `status` the discriminant. The
/// shapes here are the Swift half of `packages/contracts/src/screenshot.ts`;
/// the fixtures under `packages/contracts/fixtures` pin both sides (EL9).
/// Stdout carries ONLY these lines — diagnostics go to stderr.
enum HostProtocolVersion {
    static let current = 1
}

/// Why the helper could not answer with a still. Typed at the source: the
/// prototype's host classified free text with a regex, so the knowledge lived
/// in the wrong process. The raw values are `ScreenshotHelperErrorCode`.
enum HostErrorCode: String, Codable {
    case permissionDenied = "permission-denied"
    case captureFailed = "capture-failed"
    case noDisplays = "no-displays"
    case writeFailed = "write-failed"
}

struct HostBounds: Codable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double
}

struct HostResult: Codable {
    var v: Int
    var status: String
    var path: String?
    var width: Int?
    var height: Int?
    var scale: Double?
    var displayId: UInt32?
    var bounds: HostBounds?
    var code: HostErrorCode?
    var message: String?
    var timings: HostCaptureTimings?
}

struct HostCaptureTimings: Codable {
    var permissionMs: Double = 0
    var windowListMs: Double = 0
    var captureMs: Double = 0
    var overlayMs: Double = 0
    var totalMs: Double = 0
}

enum HostProtocol {
    static func makeOK(
        path: String,
        pixelSize: CGSize,
        scale: CGFloat,
        displayId: UInt32,
        bounds: CGRect
    ) -> HostResult {
        HostResult(
            v: HostProtocolVersion.current,
            status: "ok",
            path: path,
            width: Int(pixelSize.width),
            height: Int(pixelSize.height),
            scale: Double(scale),
            displayId: displayId,
            bounds: HostBounds(
                x: bounds.origin.x,
                y: bounds.origin.y,
                width: bounds.width,
                height: bounds.height
            ),
            code: nil,
            message: nil
        )
    }

    static func makeReady(timings: HostCaptureTimings? = nil) -> HostResult {
        HostResult(v: HostProtocolVersion.current, status: "ready", timings: timings)
    }

    static func idle() {
        emit(HostResult(v: HostProtocolVersion.current, status: "idle"))
    }

    static func makeCancel() -> HostResult {
        HostResult(v: HostProtocolVersion.current, status: "cancel")
    }

    static func makeError(_ code: HostErrorCode, _ message: String) -> HostResult {
        HostResult(v: HostProtocolVersion.current, status: "error", code: code, message: message)
    }

    static func encode(_ result: HostResult) -> Data? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try? encoder.encode(result)
    }

    static func decode(_ data: Data) throws -> HostResult {
        try JSONDecoder().decode(HostResult.self, from: data)
    }

    static func emit(_ result: HostResult) {
        guard let data = encode(result),
              let line = String(data: data, encoding: .utf8)
        else {
            let fallback = """
            {"code":"capture-failed","message":"could not encode the result line",\
            "status":"error","v":\(HostProtocolVersion.current)}
            """
            FileHandle.standardOutput.write(Data((fallback + "\n").utf8))
            fflush(stdout)
            return
        }
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
        fflush(stdout)
    }

    static func ok(
        path: String,
        pixelSize: CGSize,
        scale: CGFloat,
        displayId: UInt32,
        bounds: CGRect
    ) {
        emit(makeOK(path: path, pixelSize: pixelSize, scale: scale, displayId: displayId, bounds: bounds))
    }

    static func ready(timings: HostCaptureTimings? = nil) {
        emit(makeReady(timings: timings))
    }

    static func cancel() {
        emit(makeCancel())
    }

    static func error(_ code: HostErrorCode, _ message: String) {
        emit(makeError(code, message))
    }
}
