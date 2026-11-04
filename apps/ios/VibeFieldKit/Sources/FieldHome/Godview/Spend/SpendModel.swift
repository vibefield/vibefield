import FieldAgents
import FieldMesh
import FieldProduct
import Foundation

// PG-7 — THE SPEND VIEW'S COMPOSITION: what it lays out from its input and its own state, and its acts, transcribed
// from puppeteer-views 0.3.3 at the pin `52d09c8e` (the spend module `5abe8f75`): `src/views/spend/SpendView.tsx`
// (dist `SpendView.js` :38-643). Held to `phone-spend.golden.json` (SpendParityTests P7, V10, H1…H9).
// RED SKELETON (pair 4): placeholder returns, so the rows fail by assertion.

enum SpendModel {
  /// A line within this many points of the finger is the one pointed at; further, a tap sets the moment (`REACH_PX`).
  static let reachPx = 16.0
  /// Under this height the rows go to one line of 30 pt (`COMPACT_BELOW`).
  static let compactBelow = 418.0

  // The view's fixed words (`SpendView.js` :616-643), the window's.
  static let colcapText = "Spent in the last 10 minutes"
  static let emptyTitle = "NO ACTIVE AGENTS"
  static let emptyHint = "Launch an agent from a terminal pane."
  /// The key that lets go of a set moment (`NOW_KEY`), and its legend from the toolkit's one table (`keys.js` :16).
  static let nowKey = "End"
  static let nowLegend = "↘"
  static let nowWords = "Now"
  static let nowLabel = "Back to now"
  static let nowTitle = "Back to now (End)"
  /// The window's own label for the view.
  static let windowLabel =
    "Spend: what each agent spent in the last ten minutes, a line each from $0, and each run's total in the list. "
    + "Up and down move between agents, Return opens one, End lets go of a set moment."

  /// `geometryFor`'s layout.
  struct Geometry: Equatable, Sendable {
    let width: Double
    let height: Double
    let compact: Bool
    let narrow: Bool
    let x0: Double
    let x1: Double
    let y0: Double
    let y1: Double
    let lx0: Double
    let listW: Double
    let ly0: Double
    let ly1: Double
    let rowH: Double
    let axisY: Double
  }

  static func geometryFor(width: Double, height: Double) -> Geometry {
    Geometry(
      width: 0, height: 0, compact: false, narrow: false, x0: 0, x1: 0, y0: 0, y1: 0, lx0: 0, listW: 0, ly0: 0, ly1: 0,
      rowH: 0, axisY: 0)
  }

  /// The two weights the rows measure words in (`600 12px` the state, `400 12px` the task).
  enum TextStyle: Sendable { case state, row }

  /// What the view lays out from: the rows as spend reads them, now, its own box, and how it measures and says time.
  struct Input {
    let agents: [SpendAgent]
    let nowMs: Double
    let width: Double
    let height: Double
    let timeZone: TimeZone
    let measure: (String, TextStyle) -> Double
  }

  /// The view's own state (its `useState`s and its press ref).
  struct State: Equatable, Sendable {
    struct Pointer: Equatable, Sendable {
      let t: Double
      let near: String?
    }
    struct Press: Equatable, Sendable {
      let x: Double
      let y: Double
    }
    var pointer: Pointer?
    var held: Double?
    var hover: String?
    var listHeld: [String]?
    var listOffset = 0
    var yShown: Double?
    var press: Press?
  }

  struct Hero: Equatable, Sendable {
    let big: String
    let rate: String
    let what: String
    let compact: Bool
    let narrow: Bool
    let left: Double
  }

  struct Label: Equatable, Sendable {
    let text: String
    let left: Double
    let top: Double
  }

  struct Head: Equatable, Sendable {
    let a: String
    let b: String
    let slim: Bool
    let x: Double
    let y: Double
    let width: Double
  }

  struct Chip: Equatable, Sendable {
    let text: String
    let moment: Bool
    let held: Bool
    let left: Double
    let top: Double
  }

  /// The Now pill: back to now, from the plot's right edge.
  struct NowPill: Equatable, Sendable {
    let right: Double
    let top: Double
  }

  /// The tag at the pointed line's head: what it spent by then; `trailing`, its right edge 10 pt before `x`.
  struct Tag: Equatable, Sendable {
    let id: String
    let text: String
    let x: Double
    let y: Double
    let trailing: Bool
  }

  /// A row's classes, by the window's names.
  enum Flag: String, CaseIterable, Sendable {
    case one = "is-one"
    case none = "is-none"
    case unrecorded = "is-unrecorded"
    case hot = "is-hot"
    case dim = "is-dim"
    case before = "is-before"
    case docked = "is-docked"
    case dockFirst = "is-dock-first"
    case mounted = "is-mounted"
    case active = "is-active"
  }

  struct Row: Equatable, Sendable {
    enum Dir: String, Sendable { case up, down }
    let id: String
    let state: SpendWords.State
    let dir: Dir?
    let hidden: Bool
    let flags: Set<Flag>
    let x: Double
    let top: Double
    let width: Double
    let height: Double
    let hollow: Bool
    let name: String
    /// Another desktop's agent: its desktop's name.
    let peer: String?
    /// The one-line form's state glyph and its tone.
    let stg: Stg?
    let figure: String
    /// The two-line form's second line: its task (or "no price"), its state words, their tone and glyph.
    let task: String?
    let stateText: String?
    let stateTone: SpendWords.Tone?
    let glyph: SpendWords.Glyph?
    let title: String
    let label: String

    struct Stg: Equatable, Sendable {
      let tone: SpendWords.Tone
      let glyph: SpendWords.Glyph
    }
  }

  /// The "more" row: how many more, and how many of them wait on the person.
  struct More: Equatable, Sendable {
    let top: Double
    let words: String
    let waiting: String
    let attention: Bool
  }

  /// One frame of the view: everything it lays out, and what its acts read.
  struct Frame {
    let g: Geometry
    let span: SpendScale.Window
    let pinned: Double?
    let tCross: Double?
    let lines: [SpendSeries.Meter]
    let order: [String]
    let target: (step: Double, max: Double)
    let yMax: Double
    let sib: [String: Int]
    let fit: SpendList.Fit
    let hero: Hero
    let colcap: Label
    let head: Head
    let yTicks: [Label]
    let xTicks: [Label]
    let chips: [Chip]
    let now: NowPill?
    let tag: Tag?
    let rows: [Row]
    let more: More?
    let empty: Bool
  }

  static func frame(_ input: Input, _ state: State) -> Frame {
    let g = geometryFor(width: input.width, height: input.height)
    return Frame(
      g: g, span: SpendScale.Window(ta: 0, tb: 0), pinned: nil, tCross: nil, lines: [], order: [], target: (0, 0),
      yMax: 0, sib: [:],
      fit: SpendList.Fit(
        fits: 0, offset: 0, maxOffset: 0, docked: [], more: false, below: 0, above: 0, waitingUnshown: 0),
      hero: Hero(big: "", rate: "", what: "", compact: false, narrow: false, left: 0),
      colcap: Label(text: "", left: 0, top: 0), head: Head(a: "", b: "", slim: false, x: 0, y: 0, width: 0), yTicks: [],
      xTicks: [], chips: [], now: nil, tag: nil, rows: [], more: nil, empty: false)
  }

  // MARK: - Acts

  /// A finger on the chart moves (`onHitMove`).
  static func point(_ frame: Frame, _ state: inout State, x: Double, y: Double) {}

  /// A finger comes down on the chart (`onHitDown`).
  static func press(_ state: inout State, x: Double, y: Double) {}

  /// A finger lifts from the chart (`onHitUp`): the id of a line in reach to open, or nil.
  static func lift(_ frame: Frame, _ state: inout State, x: Double, y: Double) -> String? { nil }

  /// The touch is cancelled (`onPointerCancel`).
  static func cancel(_ state: inout State) {}

  /// The finger leaves the chart (`onHitLeave`).
  static func leave(_ state: inout State) {}

  /// The Now pill: let go of the moment (`release`).
  static func release(_ state: inout State) {}

  /// A finger on the list holds its order (`onPointerEnter`), and lets go of it as it leaves.
  static func holdList(_ frame: Frame, _ state: inout State) {}
  static func letGoOfList(_ state: inout State) {}

  /// A step of the list by whole rows (`wheel`: the sign of `deltaY`).
  static func scrollList(_ frame: Frame, _ state: inout State, deltaY: Double) {}

  /// The view's effects after a frame: the top eases toward its target (still: lands at once), and a set moment the
  /// window has slid past lets go.
  static func settle(_ frame: Frame, _ state: inout State, motion: Bool) {}
}
