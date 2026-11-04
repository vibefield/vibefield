import FieldAgents
import FieldProduct
import Foundation

// PG-5 — THE LIST'S PAINT: list.css's numbers and inks (puppeteer-views 0.3.3, `52d09c8e`, `list.css` `e79fc53d`).
//
// SKELETON (PG-5 (red)): every number 0, every ink text main, nothing lit, nothing ringed.

enum ListPaint {
  enum Ink: Equatable {
    case textMain, textMuted, textFaint, panelBorder, controlHoverBg
    case dealt(SwarmColor)
  }

  static let columnTop = 0.0
  static let toolbarSide = 0.0
  static let toolbarFoot = 0.0
  static let toolbarSize = 0.0
  static let toolbarTracking = 0.0
  static let toolbarHeight = 0.0
  static let rowsSide = 0.0
  static let rowsFoot = 0.0

  static let dotColumn = 0.0
  static let contextColumn = 0.0
  static let columnGap = 0.0
  static let agentShare = 0.0
  static let detailShare = 0.0
  static let rowInset = 0.0
  static let border = 0.0
  static let leftBorder = 0.0
  static let radius = 0.0
  static let fadeBorder = 0.0
  static let fadeWeight = 0.0

  static func columns(width: Double, projectWidth: Double) -> (agent: Double, detail: Double) { (0, 0) }

  static let staleWeight = 1.0
  static func weight(stale: Bool, receded: Bool, allReceded: Bool) -> Double { 1 }

  static let dot = 0.0
  static let dotRing = 0.0
  static let dotRingWeight = 0.0
  static func dotWeight(_ status: MonitorRowStatus) -> Double { 1 }
  static func dotRinged(_ status: MonitorRowStatus) -> Bool { false }

  static func ink(_ dealt: SwarmColor?) -> Ink { .textMain }

  static func litBorder(active: Bool) -> Ink? { nil }
  static func litGround(active: Bool) -> Ink? { nil }
  static func linkedBorder(linked: Bool, ink: Ink) -> Ink? { nil }

  static let projectSize = 0.0
  static let smallSize = 0.0
  static let markSize = 0.0
  static let agentGap = 0.0
  static let accountSize = 0.0
  static let projectGap = 0.0
  static let projectInk = Ink.textMain
  static let branchInk = Ink.textMain
  static let modelInk = Ink.textMain
  static let accountInk = Ink.textMain
  static let hostInk = Ink.textMain
  static let terminalInk = Ink.textMain
  static let detailInk = Ink.textMain
  static let contextInk = Ink.textMain
  static let toolbarInk = Ink.textMain

  static let emptyGap = 0.0
  static let emptyTitleSize = 0.0
  static let emptyTitleTracking = 0.0
  static let emptyHintSize = 0.0
  static let emptyTracking = 0.0
  static let emptyInk = Ink.textMain
}
