import Observation
import UIKit

/// Whether the pasteboard holds something the user has not yet pasted here.
///
/// It reads the change COUNT and never the contents. That distinction is the
/// whole point: `changeCount` and `hasStrings` are metadata and cost nothing,
/// while reading `UIPasteboard.general.string` is what raises the system's
/// "allow paste?" alert. The design's paste chip exists so that paste is
/// available exactly when it matters without paying for a permanent button
/// (§4, "Where the clipboard button went"), and paying an alert for the
/// privilege would undo that — so the chip is a `UIPasteControl`, which reads
/// the contents under the system's own one-tap grant, and nothing on this path
/// ever asks the pasteboard what it holds.
///
/// Sampling is deliberately explicit rather than continuous: iOS gives no
/// change notification for the general pasteboard from the background, so the
/// only honest moments to look are the ones the host names — the card opening,
/// and the app becoming active.
@MainActor
@Observable
public final class PasteboardWatcher {
  /// The pasteboard moved since the last thing the user did about it, and it
  /// holds text this card could send.
  public private(set) var hasNewContent: Bool = false

  /// The change count as of the last paste or dismissal — `nil` while neither
  /// has happened.
  ///
  /// `nil` rather than "the count at launch" is a decision: a user who copies
  /// an error on the desktop, picks up the phone and opens a session has
  /// pasted nothing yet, so the chip belongs on screen. Seeding this with the
  /// launch-time count would hide the chip for exactly the trip it was
  /// designed for.
  @ObservationIgnored private var settledAt: Int?

  public init() {}

  /// Look now. The host calls this on card open and on `scenePhase == .active`.
  public func sample() {
    let board = UIPasteboard.general
    let count = board.changeCount
    hasNewContent = count != settledAt && board.hasStrings
  }

  /// The user pasted, or dismissed the chip. Either way this pasteboard has
  /// had its answer and the chip goes until something new is copied.
  public func markSeen() {
    settledAt = UIPasteboard.general.changeCount
    hasNewContent = false
  }
}

/// Lines the way a person counts them.
///
/// A trailing newline ENDS the last line rather than starting an empty one, so
/// `"a\nb\n"` is two lines. It matters because the review threshold is a count:
/// a four-line paste with a trailing newline copied out of a terminal would
/// otherwise be five and would open a sheet for nothing.
public func pasteLineCount(_ text: String) -> Int {
  guard !text.isEmpty else { return 0 }
  var body = Substring(text)
  if body.hasSuffix("\r\n") {
    body = body.dropLast(2)
  } else if body.hasSuffix("\n") || body.hasSuffix("\r") {
    body = body.dropLast()
  }
  guard !body.isEmpty else { return 1 }
  // `\r\n` counts once: `isNewline` is true for both halves, so splitting on
  // it directly would double-count a Windows line ending.
  return body.replacingOccurrences(of: "\r\n", with: "\n")
    .split(separator: "\n", omittingEmptySubsequences: false).count
}
