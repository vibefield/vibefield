import AppKit

/// The overlay's palette, projected from DESIGN.md — exactly the values the
/// overlay READS, each named after its token so a reviewer checks the number
/// against its source instead of guessing at a hex literal. The chrome (the
/// toolbar, the loupe card, the size badge) wears no color from here: it is the
/// glass / visual-effect material and AppKit's semantic colors, which is how it
/// stays legible over any freeze in either appearance. Add a member only with a
/// reader; an unread token is a claim the overlay does not keep.
enum Theme {
    /// `--vf-select` `#4A90D9` (§2.5) — the selection ring and the snap ring ONLY.
    /// Never status.
    static let select = NSColor(srgbRed: 74 / 255, green: 144 / 255, blue: 217 / 255, alpha: 1)
    /// `--vf-red` `#FF453A` (§2.5) — every mark. A mark is content, not chrome,
    /// so it wears the content red rather than a state color.
    static let mark = NSColor(srgbRed: 1, green: 69 / 255, blue: 58 / 255, alpha: 1)
    /// §5 backdrop dim, dark recipe (`black/40`) — the freeze is a covered stage.
    static let dim = NSColor.black.withAlphaComponent(0.40)
    /// The eight resize handles: opaque white on the dimmed freeze.
    static let handleFill = NSColor.white
    /// §2.3 — `1.5px` is the selection-ring and rim weight, and it is meaning,
    /// not decoration: nothing else in the overlay is drawn this heavy.
    static let ringWidth: CGFloat = 1.5
}
