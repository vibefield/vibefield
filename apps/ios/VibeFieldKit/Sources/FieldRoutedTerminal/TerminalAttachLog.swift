import Foundation
import os

/// fix8 — an attach's own lines, on the device console.
///
/// PJ-7's second phone run tapped ATTACH, minted one ticket, and then the card
/// read "connecting over the mesh…" for good with nothing in the phone's
/// console: the attach wrote no line anywhere, so where it stopped could only
/// be argued from the desktop's side. Each phase writes one line here — the
/// tap, the mint asked and answered, the budget waited for and granted, each
/// leg dialing, its socket made, its hello sent, accepted or refused, control
/// and frames acknowledged, the first frame, a deadline, a run's end.
///
/// What a line may carry: the phase, the channel, a session id, a cell boot id
/// (a path segment of the door's URL), a refusal's code, an error's domain and
/// number. Never a grant, a token, a MAC, a URL or its query.
///
/// Where it goes: the unified log, `com.jamesyong.vibefield.kit` / `attach`,
/// at the default level (persisted, shown by Console without "Include Info"),
/// every argument public — on a device a private interpolation reads
/// `<private>`, and a line that says nothing is the thing this exists to end.
/// A DEBUG build also prints it as `[attach] …`, as the swarm's compile line
/// is printed: a device console captured through `devicectl` carries the
/// process's stdout, not its unified log, and run 2's capture was exactly that.
public struct TerminalAttachLog: Sendable {
  public enum Level: Sendable, Equatable {
    case info
    case error
  }

  private let sink: @Sendable (Level, String) -> Void

  public init(_ sink: @escaping @Sendable (Level, String) -> Void) {
    self.sink = sink
  }

  public func callAsFunction(_ line: String) { sink(.info, line) }
  public func error(_ line: String) { sink(.error, line) }

  static let logger = Logger(subsystem: "com.jamesyong.vibefield.kit", category: "attach")

  /// The device's: the unified log, and stdout in DEBUG.
  public static let device = TerminalAttachLog { level, line in
    switch level {
    case .info: logger.notice("\(line, privacy: .public)")
    case .error: logger.error("\(line, privacy: .public)")
    }
    #if DEBUG
      print("[attach] \(line)")
    #endif
  }

  /// Nothing written — for the rows that do not read the lines.
  public static let silent = TerminalAttachLog { _, _ in }

  /// An error's domain and number, never its description: a URL error's
  /// description carries the URL it failed on.
  public static func reason(_ error: any Error) -> String {
    if error is CancellationError { return "cancelled" }
    let bridged = error as NSError
    return "\(bridged.domain) \(bridged.code)"
  }
}
