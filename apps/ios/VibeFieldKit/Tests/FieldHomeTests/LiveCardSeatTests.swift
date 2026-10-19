import FieldRoutedTerminal
import FieldTerminal
import SwiftUI
import Testing

@testable import FieldHome

/// Item 42 (James, 2026-10-19 17:42Z: "studio is driving · touch to take it
/// back"; the look ruled 21:38Z, Phone A) — a live card another client is
/// driving (DESIGN.md §8): what its readout says and when it stands, where its
/// words stand in the card's empty rows, its entrance, the held veil's figures,
/// and when a card on the screen takes the empty seat a holder let go of.
enum SeatFixtures {
  static let studio = holder("win-desk-incarnation-1", name: "studio", kind: "window", os: "macos")
  static let phone = holder("tailnet:james@example.com", name: "iPhone 16 Pro", kind: "phone", os: "ios")
  static let peer = holder("win-peer-1", name: "mini", kind: "peer-window", os: "macos")

  static func holder(
    _ client: String, name: String?, kind: String = "window", os: String? = nil
  ) -> RoutedGeometryStateHolder {
    RoutedGeometryStateHolder(
      holder: RoutedGeometryHolder(clientId: client, viewId: "view-\(client)", holderGeneration: 1),
      face: name.map { RoutedGeometryHolderFace(kind: kind, name: $0, os: os) })
  }

  static func seat(_ driver: RoutedSessionSeat.Driver, cols: Int = 120, rows: Int = 40)
    -> RoutedSessionSeat
  {
    RoutedSessionSeat(driver: driver, revision: 2, cols: cols, rows: rows)
  }
}

@Suite("item 42 — the readout a live card stands in its empty rows while another client drives")
struct SeatReadoutTests {
  @Test("another client's hold is named as fieldd minted it, with its rows and the line height they stand in")
  func anotherClientsHold() {
    let readout = FieldHomeModel.seatReadout(
      SeatFixtures.seat(.another(SeatFixtures.studio)), lineHeight: 19)
    #expect(readout?.name == "studio")
    #expect(readout?.heldRows == 40)
    #expect(readout?.lineHeight == 19)
  }

  @Test("the words are the ruled ones: the verb, and one caption line")
  func theWords() {
    #expect(FieldHomeModel.SeatReadout.verb == "is driving")
    #expect(FieldHomeModel.SeatReadout.caption == "touch to take it back")
  }

  @Test("the name is full and never re-cased: a lowercase desktop stays lowercase, a person's phone keeps its capitals")
  func theNameIsNeverReCased() {
    let lower = FieldHomeModel.seatReadout(
      SeatFixtures.seat(.another(SeatFixtures.studio)), lineHeight: 19)
    #expect(lower?.name == "studio")
    let phone = SeatFixtures.holder("phone-2", name: "James's iPhone", kind: "phone", os: "ios")
    let named = FieldHomeModel.seatReadout(SeatFixtures.seat(.another(phone)), lineHeight: 19)
    #expect(named?.name == "James's iPhone")
  }

  @Test("no face is Another device — never an id")
  func noFaceIsAnotherDevice() {
    let faceless = SeatFixtures.holder("win-desk-incarnation-9", name: nil)
    let readout = FieldHomeModel.seatReadout(SeatFixtures.seat(.another(faceless)), lineHeight: 19)
    #expect(readout?.name == "Another device")
    #expect(readout?.name == FieldHomeModel.seatHolderFallback)
    #expect(readout?.name.contains("win-desk") == false)
  }

  @Test("the readout names no size: the phone can see what it is drawing")
  func noSize() {
    let seat = SeatFixtures.seat(.another(SeatFixtures.studio), cols: 120, rows: 40)
    let readout = FieldHomeModel.seatReadout(seat, lineHeight: 19)
    let said = [readout?.name, FieldHomeModel.SeatReadout.verb, FieldHomeModel.SeatReadout.caption]
      .compactMap { $0 }.joined(separator: " ")
    #expect(readout != nil)
    #expect(!said.contains("120"))
    #expect(!said.contains("40"))
    #expect(!said.contains("×"))
  }

  @Test("only another client's hold earns a readout: this phone's, an empty seat and no seat say nothing")
  func onlyAnother() {
    #expect(FieldHomeModel.seatReadout(SeatFixtures.seat(.mine(SeatFixtures.phone)), lineHeight: 19) == nil)
    #expect(FieldHomeModel.seatReadout(SeatFixtures.seat(.nobody(letGo: nil)), lineHeight: 19) == nil)
    #expect(
      FieldHomeModel.seatReadout(SeatFixtures.seat(.nobody(letGo: SeatFixtures.studio)), lineHeight: 19)
        == nil)
    #expect(FieldHomeModel.seatReadout(nil, lineHeight: 19) == nil)
  }

  @Test("the words win, a cooled terminal keeps its own veil: the readout stands only on a live terminal with nothing else to say")
  func theReadoutYields() {
    #expect(FieldHomeModel.showsSeatReadout(live: true, cooled: false, hasWords: false))
    #expect(!FieldHomeModel.showsSeatReadout(live: true, cooled: false, hasWords: true))
    #expect(!FieldHomeModel.showsSeatReadout(live: true, cooled: true, hasWords: false))
    #expect(!FieldHomeModel.showsSeatReadout(live: true, cooled: true, hasWords: true))
    #expect(!FieldHomeModel.showsSeatReadout(live: false, cooled: false, hasWords: false))
  }

  @Test("the held veil is the desktop's 62%, never the cooled 45%, and the entrance waits 400ms")
  func theVeilsFigures() {
    #expect(FieldHomeModel.liveCardHeldVeil == 0.62)
    #expect(FieldHomeModel.liveCardCooledVeil == 0.45)
    #expect(FieldHomeModel.seatVeilWait == 0.4)
  }

  @Test("the figure is the desktop's at the phone's scale: 800 at 56pt/1, −0.04em, the caption 12pt")
  func theFigure() {
    #expect(FieldHomeModel.seatWordsSize == 56)
    #expect(FieldHomeModel.seatWordsTracking == -0.04)
    #expect(FieldHomeModel.seatCaptionSize == 12)
    // the two lines, 4 apart, and the caption's line 18 under them (typed apart: a sum of four literals in
    // `#expect` is more than the type checker resolves in reasonable time)
    let block: CGFloat = 56 * 2 + 4 + 18 + 15
    #expect(FieldHomeModel.seatWordsHeight == block)
  }
}

/// The words stand in the card's empty rows: at the foot while the held screen
/// stands top-left (the anchor at the foot rides ghosttea 0.10.2). The card
/// here is 700pt of grid at 19pt rows — its text 2pt down and 8pt up, 36 rows
/// of its own.
@Suite("item 42 — the readout's words stand in the card's empty rows")
struct SeatWordsCentreTests {
  @Test("the held screen top-left: the words stand in the middle of the empty rows at the foot")
  func theEmptyRowsAtTheFoot() {
    // the held rows' foot: 2 + 24 × 19 = 458; the grid's text foot: 700 − 8 = 692. `#expect` types each
    // side alone, so a sum of literals is an Int unless it is said to be a CGFloat
    #expect(
      FieldHomeModel.seatWordsCentre(grid: 700, heldRows: 24, lineHeight: 19)
        == CGFloat(458 + 692) / 2)
  }

  @Test("held rows that reach the card's own last row leave no empty rows: the words stand over the grid's middle")
  func noEmptyRows() {
    #expect(FieldHomeModel.seatWordsCentre(grid: 700, heldRows: 36, lineHeight: 19) == 350)
    #expect(FieldHomeModel.seatWordsCentre(grid: 700, heldRows: 40, lineHeight: 19) == 350)
  }

  @Test("empty rows too few for the words are no room either")
  func tooLittleRoom() {
    // 2 + 30 × 19 = 572 leaves 120pt above the foot; the words take 149
    #expect(FieldHomeModel.seatWordsCentre(grid: 700, heldRows: 30, lineHeight: 19) == 350)
  }

  @Test("the floating input row's footprint is kept clear: the words stand above the key and the chips")
  func aboveTheFloatingRow() {
    // the floating row's footprint, 62: the foot is 700 − 62 = 638; the held rows end at 458
    #expect(
      FieldHomeModel.seatWordsCentre(grid: 700, heldRows: 24, lineHeight: 19, footReserve: 62)
        == CGFloat(458 + 638) / 2)
    // a reserve inside the text's own 8pt changes nothing
    #expect(
      FieldHomeModel.seatWordsCentre(grid: 700, heldRows: 24, lineHeight: 19, footReserve: 4)
        == CGFloat(458 + 692) / 2)
    // 2 + 27 × 19 = 515 leaves 123pt above the row, under the words' 149: no room
    #expect(
      FieldHomeModel.seatWordsCentre(grid: 700, heldRows: 27, lineHeight: 19, footReserve: 62) == 350)
  }

  @Test("a line height not known yet or no held rows is the middle, never a guess; a broken grid is its top")
  func unknowns() {
    #expect(FieldHomeModel.seatWordsCentre(grid: 700, heldRows: 24, lineHeight: nil) == 350)
    #expect(FieldHomeModel.seatWordsCentre(grid: 700, heldRows: 24, lineHeight: 0) == 350)
    #expect(FieldHomeModel.seatWordsCentre(grid: 700, heldRows: 24, lineHeight: .nan) == 350)
    #expect(FieldHomeModel.seatWordsCentre(grid: 700, heldRows: 0, lineHeight: 19) == 350)
    #expect(FieldHomeModel.seatWordsCentre(grid: .nan, heldRows: 24, lineHeight: 19) == 0)
    #expect(FieldHomeModel.seatWordsCentre(grid: -10, heldRows: 24, lineHeight: 19) == 0)
  }

  /// The rows are counted from where the text stands: item 41's padding and
  /// the renderer's own 2pt origin (`GhostteaTerminalLayout.verticalPadding`).
  @Test("the text's margins are the presentation's padding and the renderer's origin")
  func theTextMargins() {
    let padding = presentationConfig(for: .default).paddingY
    #expect(FieldHomeModel.liveCardTextTop == CGFloat(padding[0]) + 2)
    #expect(FieldHomeModel.liveCardTextFoot == CGFloat(padding[1]) + 2)
  }
}

@Suite("item 42 — the readout's entrance plays once, as the desktop's does")
struct SeatEntranceTests {
  typealias Entrance = FieldHomeModel.SeatEntrance
  typealias Part = FieldHomeModel.EntrancePart

  @Test("after the wait: the veil in 200ms, the glow in 600ms, the bloom in 600ms from 140, the verb in 560ms from 340, the caption in 240ms from 540")
  func theParts() {
    #expect(Entrance.veil == Part(delay: 0, duration: 0.2))
    #expect(Entrance.glow == Part(delay: 0, duration: 0.6))
    #expect(Entrance.bloom == Part(delay: 0.14, duration: 0.6))
    #expect(Entrance.verb == Part(delay: 0.34, duration: 0.56))
    #expect(Entrance.caption == Part(delay: 0.54, duration: 0.24))
    #expect(Entrance.verbTrackingFrom == 0.34)
    #expect(Entrance.bloomScaleFrom == 0.4)
  }

  @Test("the letters pop in 280ms from 140ms, 26ms apart")
  func theLetters() {
    #expect(Entrance.letter(0) == Part(delay: 0.14, duration: 0.28))
    #expect(abs(Entrance.letter(1).delay - 0.166) < 1e-9)
    // "studio"'s last letter
    #expect(abs(Entrance.letter(5).delay - 0.27) < 1e-9)
  }

  @Test("the stagger never runs past 400ms: a long name's later letters start together")
  func theStaggerIsCapped() {
    #expect(abs(Entrance.letter(15).delay - 0.53) < 1e-9)
    #expect(abs(Entrance.letter(16).delay - 0.54) < 1e-9)
    #expect(abs(Entrance.letter(40).delay - 0.54) < 1e-9)
    #expect(Entrance.letter(-1) == Entrance.letter(0))
  }

  @Test("the clock runs until the verb is still, which no letter outlasts; then nothing moves")
  func theClock() {
    #expect(abs(Entrance.length - 0.9) < 1e-9)
    let parts = [Entrance.veil, Entrance.glow, Entrance.bloom, Entrance.verb, Entrance.caption]
    for part in parts + [Entrance.letter(0), Entrance.letter(1_000)] {
      #expect(part.delay + part.duration <= Entrance.length + 1e-9)
    }
  }

  @Test("a part's progress is nothing before it starts, all of it once done, and a straight line between")
  func progress() {
    let part = Part(delay: 0.25, duration: 0.5)
    #expect(part.progress(at: 0) == 0)
    #expect(part.progress(at: 0.25) == 0)
    #expect(part.progress(at: 0.5) == 0.5)
    #expect(part.progress(at: 0.75) == 1)
    #expect(part.progress(at: 9) == 1)
  }

  @Test("under reduced motion the whole of it fades in over 100ms")
  func reducedMotion() {
    #expect(Entrance.reduced == Part(delay: 0, duration: 0.1))
  }
}

@Suite("item 42 — a card on the screen takes the empty seat, once, when the holder lets go")
struct EmptySeatTakeTests {
  static let studio = SeatFixtures.studio
  static let phone = SeatFixtures.phone
  static let peer = SeatFixtures.peer

  /// On the screen unless said otherwise: the app active, the card presented.
  static func takes(
    _ old: RoutedSessionSeat.Driver?, _ new: RoutedSessionSeat.Driver?,
    phase: ScenePhase = .active, presented: Bool = true
  ) -> Bool {
    FieldHomeModel.takesEmptySeat(from: old, to: new, phase: phase, presented: presented)
  }

  @Test("the holder letting go is the take, for the card on the screen")
  func theLetGoTakes() {
    #expect(Self.takes(.another(Self.studio), .nobody(letGo: Self.studio)))
    #expect(Self.takes(.another(Self.peer), .nobody(letGo: Self.peer)))
  }

  @Test("a card off the screen takes nothing: the app inactive or in the background, or the card not presented")
  func offTheScreenTakesNothing() {
    for phase in [ScenePhase.inactive, .background] {
      #expect(!Self.takes(.another(Self.studio), .nobody(letGo: Self.studio), phase: phase))
    }
    #expect(!Self.takes(.another(Self.studio), .nobody(letGo: Self.studio), presented: false))
  }

  @Test("an empty seat no other client let go is no let-go: this phone let go, or the seat was first heard empty")
  func noOtherClientNoTake() {
    #expect(!Self.takes(.mine(Self.phone), .nobody(letGo: nil)))
    #expect(!Self.takes(nil, .nobody(letGo: nil)))
    // The fold never writes this one; the rule refuses it all the same.
    #expect(!Self.takes(.another(Self.studio), .nobody(letGo: nil)))
  }

  @Test("an empty seat seen first on a card presented again is DS-4b's to take, never this rule's")
  func aCardPresentedAgain() {
    #expect(!Self.takes(nil, .nobody(letGo: Self.studio)))
  }

  @Test("only the let-go: a hold changing hands, this phone's own take and a seat taken from it say nothing")
  func onlyTheLetGo() {
    #expect(!Self.takes(.another(Self.studio), .another(Self.peer)))
    #expect(!Self.takes(.another(Self.studio), .mine(Self.phone)))
    #expect(!Self.takes(.mine(Self.phone), .another(Self.studio)))
    #expect(!Self.takes(.nobody(letGo: Self.studio), .another(Self.peer)))
    #expect(!Self.takes(.nobody(letGo: Self.studio), .mine(Self.phone)))
    #expect(!Self.takes(.another(Self.studio), nil))
  }

  /// The seat as the client folds it, step by step: each driver beside the one
  /// before it, unchanged ones included, so the count holds whether or not the
  /// host is asked only on a change.
  @Test("once: the empty seat standing on — its resizes, a take that did not land — is not asked again")
  func onceAndNeverALoop() {
    let drivers: [RoutedSessionSeat.Driver?] = [
      nil,
      .mine(Self.phone),
      .another(Self.studio),
      .another(Self.studio),  // the window resizes its seat
      .nobody(letGo: Self.studio),  // the window lets go: the take
      .nobody(letGo: Self.studio),  // the PTY left at its size, said again
      .nobody(letGo: Self.studio),  // the take did not land: the seat stands
    ]
    let takes = zip(drivers, drivers.dropFirst()).filter { Self.takes($0, $1) }.count
    #expect(takes == 1)
  }

  @Test("a seat taken and let go again is a new let-go, and earns a new take")
  func aNewLetGoIsANewTake() {
    let drivers: [RoutedSessionSeat.Driver?] = [
      .another(Self.studio),
      .nobody(letGo: Self.studio),  // the take
      .another(Self.peer),  // the take lost the race: a peer took it first
      .nobody(letGo: Self.peer),  // and let go: the take again
      .mine(Self.phone),
    ]
    let takes = zip(drivers, drivers.dropFirst()).filter { Self.takes($0, $1) }.count
    #expect(takes == 2)
  }
}
