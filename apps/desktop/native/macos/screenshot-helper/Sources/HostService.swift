import AppKit
import Darwin

struct HostCommand: Decodable {
    let v: Int
    let action: String
}

enum HostCommandError: Error {
    case tooLong
    case invalid
}

/// Bound the host pipe just like stdout. Commands can arrive split across reads
/// or several per read; EOF always terminates the helper, even during capture.
struct HostCommandReader {
    static let maxLineBytes = 4096
    private var buffer = Data()

    static func readAvailableChunk(from handle: FileHandle) -> Data? {
        var bytes = [UInt8](repeating: 0, count: maxLineBytes)
        // FileHandle.read(upToCount:) may wait to fill its buffer on a pipe.
        // One POSIX read returns the command already available, without waiting
        // for more commands or EOF. It also bounds each allocation/read.
        let count = bytes.withUnsafeMutableBytes {
            Darwin.read(handle.fileDescriptor, $0.baseAddress, $0.count)
        }
        guard count > 0 else { return nil }
        return Data(bytes.prefix(count))
    }

    mutating func push(_ data: Data) throws -> [HostCommand] {
        var commands: [HostCommand] = []
        for byte in data {
            if byte == 0x0a {
                guard !buffer.isEmpty else { continue }
                let command = try JSONDecoder().decode(HostCommand.self, from: buffer)
                guard command.v == HostProtocolVersion.current, command.action == "capture" else {
                    throw HostCommandError.invalid
                }
                commands.append(command)
                buffer.removeAll(keepingCapacity: true)
            } else {
                guard buffer.count < Self.maxLineBytes else { throw HostCommandError.tooLong }
                buffer.append(byte)
            }
        }
        return commands
    }
}

@MainActor
final class HostService {
    private var reader = HostCommandReader()
    private var capturing = false

    func start(onCapture: @escaping @MainActor () -> Void) {
        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
            let data = HostCommandReader.readAvailableChunk(from: handle)
            if data == nil || data?.isEmpty == true {
                handle.readabilityHandler = nil
            }
            Task { @MainActor in
                guard let self else { return }
                guard let data, !data.isEmpty else {
                    NSApp.terminate(nil)
                    return
                }
                do {
                    for _ in try self.reader.push(data) {
                        guard !self.capturing else { throw HostCommandError.invalid }
                        self.capturing = true
                        onCapture()
                    }
                } catch {
                    HostProtocol.error(.captureFailed, "invalid screenshot host command")
                    NSApp.terminate(nil)
                }
            }
        }
        // Loading AppKit never reads screen pixels or asks for Screen Recording.
        HostProtocol.idle()
    }

    func completed() {
        capturing = false
        // The service has no window between requests; give the previous app
        // its keyboard focus back just as exiting --once did.
        NSApp.hide(nil)
        HostProtocol.idle()
    }

    func stop() {
        FileHandle.standardInput.readabilityHandler = nil
    }
}
