// THE SAFETY GATE'S EYES — TP-S0c.
//
// The native control posts real CGEvents through the window server. They deliver
// to whichever window has keyboard focus, which on a machine somebody is using
// means typing into their editor, their browser, or their chat. This lists the
// normal-layer on-screen windows so the driver can REFUSE by default and require
// an explicit acknowledgement when it can see somebody else's work.
//
// One line per window: `<owner>\t<title>\t<w>x<h>`. Layer 0 only — menu bars,
// the dock, wallpaper and status items are not somebody's work.

import CoreGraphics
import Foundation

let info =
    CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []

for window in info {
    guard (window[kCGWindowLayer as String] as? Int) == 0 else { continue }
    let owner = window[kCGWindowOwnerName as String] as? String ?? "?"
    let title = window[kCGWindowName as String] as? String ?? ""
    let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let width = bounds["Width"] as? Double ?? 0
    let height = bounds["Height"] as? Double ?? 0
    // A zero-area window is not on anybody's screen in the sense that matters.
    if width < 2 || height < 2 { continue }
    print("\(owner)\t\(title)\t\(Int(width))x\(Int(height))")
}
