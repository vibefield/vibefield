import FieldAgents
import FieldProduct
import Foundation

// PG-5 — THE LIST'S PAINT: the numbers the phone draws the list with, transcribed from puppeteer-views 0.3.3 at the
// pin `52d09c8e`, `src/views/list/list.css` (`e79fc53d`, 2026-10-28; LC below), rules :1-227 (the spawn menu's
// :229-376 are not transcribed, PG-D10 (a)). CSS px are points (the kit device is 3×, as the stills are). Every colour
// is the skin's (`GodviewSkin`, PG-4t's, the SDK's MONITOR_SKIN) or the row's dealt one, named here by role and
// resolved by `ListView`; no hex literal here (DESIGN.md).
//
// THE NAMED DEVIATIONS (each from the desktop's list, on purpose; the packet carries them):
//   1. no `＋ TERMINAL` (fd's Q1, PG-D10 (a)): the toolbar keeps the button's height, so the rows stand where the
//      desktop's do;
//   2. no hover (fd's Q2/Q3: touch has none), LC:81-84 and :45-49 are not drawn, and no press look is added;
//   3. the lit row's border is TEXT MAIN (James's J-S4 drawing, accepted 2026-11-04 01:14Z), not the row's colour
//      (LC:90-94); its ground stays the skin's control hover;
//   4. a provider the phone's glyph catalog has no asset for wears its letter (fd's Q4; AgentGlyph).

enum ListPaint {
  /// A colour by its role: the skin's, or the row's own.
  enum Ink: Equatable {
    case textMain, textMuted, textFaint, panelBorder, controlHoverBg
    /// The row's dealt project colour (`input.colour(row)`).
    case dealt(SwarmColor)
  }

  // MARK: - The column, the toolbar and the rows' box (LC:8-57)

  /// LC:15 — the words start 11 below the stage's top inset (the phone's `input.insets(.flow).top`, the Stories
  /// row's reserve, PG-4t: insets are data).
  static let columnTop = 11.0
  /// LC:25 — the toolbar's sides and foot.
  static let toolbarSide = 13.0
  static let toolbarFoot = 6.0
  /// LC:27-29 — the count: 9, bold, tracking .06em, in the faint ink (:26).
  static let toolbarSize = 9.0
  static let toolbarTracking = 0.06
  /// The omitted button's height (LC:33-38: a 9 pt line, 3 pt above and below, a 1 pt border each side), kept so the
  /// rows stand where the desktop's do (deviation 1).
  static let toolbarHeight = 19.0
  /// LC:54 — the rows' box: 13 at the sides and the foot.
  static let rowsSide = 13.0
  static let rowsFoot = 13.0

  // MARK: - A row (LC:59-128)

  /// LC:63-67 — the grid: the dot's column, the project's (the parameter), the agent's and the detail's shares of
  /// what is left, the context's, 10 between each.
  static let dotColumn = 10.0
  static let contextColumn = 44.0
  static let columnGap = 10.0
  static let agentShare = 0.9
  static let detailShare = 1.4
  /// LC:68-71 — 9 inside, a 1 pt border, 3 pt on the left, corners 6.
  static let rowInset = 9.0
  static let border = 1.0
  static let leftBorder = 3.0
  static let radius = 6.0
  /// LC:76-78 — what changes fades: the border and ground in 120 ms, the weight in 240 ms (DESIGN.md §6's plain
  /// `ease`, `FieldMotion.plainEase`).
  static let fadeBorder = 0.12
  static let fadeWeight = 0.24

  /// The agent and detail columns' widths at a stage `width` wide (LC:63-65's `minmax(0, .9fr)` and
  /// `minmax(0, 1.4fr)`): what the rows' box, the row's border and inset, the three fixed columns and the four gaps
  /// leave, shared .9 : 1.4, never below 0.
  static func columns(width: Double, projectWidth: Double) -> (agent: Double, detail: Double) {
    let box = width - 2 * rowsSide
    let content = box - leftBorder - border - 2 * rowInset
    let free = content - dotColumn - projectWidth - contextColumn - 4 * columnGap
    let fr = max(0, free) / (agentShare + detailShare)
    return (agent: fr * agentShare, detail: fr * detailShare)
  }

  /// LC:101-113 — a row's weight. A receded row's rule comes after the stale one's at the same specificity, so a row
  /// both stale and receded weighs the recede's; every row receded is the faintest (`GodviewRecede`).
  static let staleWeight = 0.58
  static func weight(stale: Bool, receded: Bool, allReceded: Bool) -> Double {
    if receded { return GodviewRecede.target(receded: true, every: allReceded) }
    return stale ? staleWeight : 1
  }

  /// LC:115-128 — the dot: 8, in the row's colour; an idle one at .4; a blocked one ringed 3 pt in its colour at 30%.
  static let dot = 8.0
  static let dotRing = 3.0
  static let dotRingWeight = 0.3
  static func dotWeight(_ status: MonitorRowStatus) -> Double { status == .idle ? 0.4 : 1 }
  static func dotRinged(_ status: MonitorRowStatus) -> Bool { status == .blocked }

  /// The row's colour: its dealt one, else the neutral (the desktop's palette `neutral` is `--text-faint`,
  /// puppeteer-views `monitor/palette.js:70`; the swarm's too, SwarmTheme).
  static func ink(_ dealt: SwarmColor?) -> Ink { dealt.map(Ink.dealt) ?? .textFaint }

  /// LC:90-94 — the lit row (J-S4): its border TEXT MAIN (deviation 3), its ground the control hover. An unlit row
  /// draws neither.
  static func litBorder(active: Bool) -> Ink? { active ? .textMain : nil }
  static func litGround(active: Bool) -> Ink? { active ? .controlHoverBg : nil }
  /// LC:86-88 — a pane's row: the left border in the row's colour. Never on the phone (no panes), drawn if it were.
  static func linkedBorder(linked: Bool, ink: Ink) -> Ink? { linked ? ink : nil }

  // MARK: - The cells' words (LC:130-197)

  /// LC:137-144 — the project: 11, bold, in the row's ink (inherited, text main).
  static let projectSize = 11.0
  /// LC:146-157 — the branch, the agent, the detail, the context, the terminal and the host chip: 9, muted.
  static let smallSize = 9.0
  /// LC:159-169 — the agent: the mark at 11, 5 before the model.
  static let markSize = 11.0
  static let agentGap = 5.0
  /// LC:180-186 — the account: 8, faint.
  static let accountSize = 8.0
  /// LC:134 — the project's two lines, 1 apart.
  static let projectGap = 1.0
  /// The ink each cell's words wear.
  static let projectInk = Ink.textMain
  static let branchInk = Ink.textMuted
  static let modelInk = Ink.textMuted
  static let accountInk = Ink.textFaint
  /// LC:174-176 — the host chip stands in text main.
  static let hostInk = Ink.textMain
  /// LC:188-191 — `terminal`: faint, italic.
  static let terminalInk = Ink.textFaint
  static let detailInk = Ink.textMuted
  /// LC:193-197 — the context: faint, right-aligned, tabular.
  static let contextInk = Ink.textFaint
  static let toolbarInk = Ink.textFaint

  // MARK: - The empty stage (LC:199-227)

  /// The column, 6 apart, in the faint ink, its tracking .08em; the title 11, heavy (800), .18em; the hint 9.
  static let emptyGap = 6.0
  static let emptyTitleSize = 11.0
  static let emptyTitleTracking = 0.18
  static let emptyHintSize = 9.0
  static let emptyTracking = 0.08
  static let emptyInk = Ink.textFaint
}
