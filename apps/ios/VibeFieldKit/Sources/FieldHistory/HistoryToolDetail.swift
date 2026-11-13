// Item 362f (James, 2026-11-12 18:40:35Z, of the phone's History session view against the desktop's: "i think all
// message type and views are different from desktop, needs thorough audit") — WHAT A TOOL LINE OPENS TO.
//
// In the room a tool line opens: a command to its folder and its source, an edit to its diff, a read to the files
// and ranges it named, a search to the paths it found (`LineDetail.tsx`, `detail-parts.tsx`). None of that is on
// the door's row, which is a line's facts and no more, so through the home desktop a tool line stays the line it
// was. Read straight from the desktop's index the phone holds the whole entry, and this is what it keeps of it for
// an opened line, bounded by the room's own figures when the entry is projected (`HistoryProjection.toolDetail`).
//
// It is kept beside the row (`HistoryLineDetail.tool`) and reaches the view beside the document, by the line's id.
// It is NOT in the document. The document is encoded and written to the cache at every rebuild, and these would
// ride in every one of those writes. So a detail lives while the app runs, and a document replayed from the cache
// has none until a direct read lands.
//
// What is never kept: a tool's output (no entry carries one), and a failure's diagnostic (item 371: the door's law
// names it, and it is a program's raw error text). A failed line opens to the summary its row already carries.
// A recorded text is the adversary's (EL7): everything here is drawn as text, and nothing opens anything.
// DESIGN.md §8 "The phone's session document" → a tool line opens.

/// What a tool line opens to. Empty is never kept: a line with nothing to open has no detail.
struct HistoryToolDetail: Equatable, Sendable {
  /// One line of a diff.
  struct DiffLine: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
      case add
      case del
      case context
    }

    let kind: Kind
    /// Its number in the new file, or in the old one for a line taken out; nil where the hunk gave no place.
    let number: Int?
    let text: String
  }

  /// One file of a change: its path, and the first lines of its diff.
  struct File: Equatable, Sendable {
    let path: String
    /// At most `diffLines`. None, with `more` 0: no diff was recorded.
    let lines: [DiffLine]
    /// How many more lines the diff holds.
    let more: Int
  }

  /// One path of a list: a file a read named, with its range, or a path a search found.
  struct Path: Equatable, Sendable {
    let path: String
    /// `L1–180` · `p3–4` · `L5`
    let range: String?
  }

  /// A command's working folder.
  var folder: String? = nil
  /// A command or its code, as the room previews it.
  var command: String? = nil
  /// A change's files: at most `changeFiles`, and how many more it holds.
  var files: [File] = []
  var moreFiles = 0
  /// A read's targets or a search's paths: at most `listed`, and how many more there are.
  var paths: [Path] = []
  var morePaths = 0
  /// A failed line's summary, as its row carries it: a sentence, never a kind and never a diagnostic.
  var failure: String? = nil

  var isEmpty: Bool {
    folder == nil && command == nil && files.isEmpty && paths.isEmpty && failure == nil
  }

  /// The room's `DIFF_LINE_CAP` (components/transcript/detail-parts.tsx): the lines drawn of one file's diff.
  static let diffLines = 12
  /// The files drawn of one change: the room's `deltas.slice(0, 4)` in `DiffDetail`, a figure it does not name.
  static let changeFiles = 4
  /// The room's `LIST_CAP`: the rows drawn of a list of paths.
  static let listed = 24
  /// The room's `COMMAND_PREVIEW_CHARACTER_LIMIT` (lib/transcript/families.ts), in code points: its three dots
  /// are inside it.
  static let commandChars = 42
}
