import FieldAgents
import FieldDesign
import FieldMesh
import FieldRoutedTerminal
import FieldTerminal
import SwiftUI

/// Everything on the home screen that is a DECISION rather than a layout, kept
/// out of the views so it can be tested without a simulator — the shape
/// `TerminalSettingsModel` established on the terminal leg.
///
/// Each function here replaced a rule that was previously spelled out inline
/// across `HomeScreen`/`SessionCardView` and got it wrong; the doc comments
/// carry the finding, and `FieldHomeTests` pins it.
enum FieldHomeModel {

  // MARK: - Discovery

  /// What one change in (mesh, scene phase) means for the remote-session poll.
  ///
  /// The two stoppers are deliberately different verbs, and conflating them was
  /// the bug. Backgrounding **parks** a field whose door is still good: the
  /// Truffle runtime did not go anywhere, so the rows stay on screen and the
  /// poll resumes on return. A mesh that left **closes the door**:
  /// a start builds a fresh runtime, so the directory the field
  /// was holding names a node that no longer exists, and keeping its rows would
  /// be the stage claiming a mesh answered when none did.
  ///
  /// Previously `.background` called `stop()` on the field but left the
  /// "already polling" flag set, so the resume branch was unreachable for the
  /// rest of the process's life: bubbles froze, and `noteHostReachable()` —
  /// the ONLY thing in this app that can end a `suspended(host absent)`
  /// attachment — could never fire again.
  enum DiscoveryAction: Equatable {
    /// Drop the source and the rows: the answer they came from is void.
    case closeDoor
    /// Stop the poll, keep the field standing: the door is still good.
    case park
    /// Build a source from the live directory and start polling.
    case open
    /// Restart the poll on the field that is already standing.
    case resume
    case none
  }

  static func discoveryAction(
    meshIsUp: Bool,
    phase: ScenePhase,
    polling: Bool,
    hasDoor: Bool
  ) -> DiscoveryAction {
    // Every stopper is a no-op when there is nothing to stop. Closing a door
    // that is not there is not honesty, it is churn: this runs on every mesh
    // AND scene tick, and an unconditional close would rebuild the field object
    // (and re-publish its snapshot) for changes that concern it not at all.
    guard meshIsUp else { return (hasDoor || polling) ? .closeDoor : .none }
    // `.inactive` is transient on iOS (a notification shade, the app switcher's
    // first frame); parking there would flap, so only a real background parks.
    if phase == .background { return polling ? .park : .none }
    guard phase == .active, !polling else { return .none }
    return hasDoor ? .resume : .open
  }

  // RETIRED 2026-09-23 (IOS-8e): `LinkFace`, `linkFace(desktops:isHearing:)`
  // and `linkSubject` — the corner's token and line about the doors (IOS-4e).
  // The two rules they pinned live on in `accountFace` below: the rows are
  // about the same desktops the dot is about (one predicate,
  // `MeshDisplay.wantsTheUser`), and a desktop that answered and sent nothing
  // still says so (`AccountDisplay.desktopWord`'s "no field yet").

  // MARK: - The link's own door

  /// What a call to open the field's link should actually do.
  ///
  /// Two bugs live here and both were invisible because the rule was spelled
  /// inline. `openLink` read `link == nil`, then awaited the mesh node, then
  /// assigned — so two calls inside that window (a scene-phase flap reaches it
  /// through discovery) each built a `FieldLink`, each with two `FieldStore`s
  /// and its own sockets, and the second overwrote the first with nothing left
  /// holding it to stop it. And the DEBUG guard beside it tested the two flags
  /// the fixture LINK does not set (`-vf-demo-field-slice` sets neither), so
  /// its only effect was skipping a resume for the two paths that own the
  /// field's rows rather than its link.
  enum LinkOpenAction: Equatable {
    /// Nothing to do: a fixture owns the link, or an open is already in
    /// flight and will install one.
    case none
    /// A link is standing; unpause it.
    case resume
    /// Build one.
    case open
  }

  static func linkOpenAction(
    fixtureOwnsLink: Bool, hasLink: Bool, isOpening: Bool
  ) -> LinkOpenAction {
    // A fixture link has no live door behind it: resuming it is a no-op and
    // replacing it is the fixture lying about what it is.
    if fixtureOwnsLink { return .none }
    if hasLink { return .resume }
    return isOpening ? .none : .open
  }

  // MARK: - The session card's face

  /// Which face the session card wears.
  ///
  /// The field's listing is NOT the authority on whether a session is alive
  /// while one is attached. `remoteFailureTolerance` withdraws every row after
  /// two consecutive failed asks — roughly four seconds at the poll's cadence,
  /// and with a single desktop on the mesh a single refused listing is already
  /// a failed ask — but a terminal that is still rendering frames has not ended
  /// because a listing timed out. So an attached card keeps its subject and
  /// lets the connection speak for itself.
  ///
  /// Only an UNATTACHED card has nothing better than the listing to go on, and
  /// there the row's departure is the only signal there is — so it stays the
  /// ended face, which is what it always was.
  enum CardFace: Equatable {
    case session
    case ended
  }

  static func cardFace(hasSubject: Bool, listed: Bool, attached: Bool) -> CardFace {
    guard hasSubject else { return .ended }
    return (listed || attached) ? .session : .ended
  }

  /// fix7 — what the card's terminal slot draws (PJ-7's first phone run, S2:
  /// a hand-started agent's card said "no terminal has been offered for this
  /// session" while its desktop pane was live). IOS-4c gave an agent's card
  /// ATTACH through the hosts store's advertisement, which made its bubble a
  /// peer's; TM-5 retired that store, and the agent's card lost its tap — only
  /// the DEBUG `-vf-auto-attach` still reached an attachment. The run's own
  /// face (`agentTerminalFace`) says whether its terminal can be opened.
  ///
  /// FW-D2 (James, 2026-10-17: "no more attach button for me to manually
  /// click to connect"): opening the card IS the attach, so no slot draws
  /// ATTACH. A run whose face offers its terminal is `.live` from the card's
  /// first frame — attached, or attaching, or saying in the attach's own
  /// words why it could not.
  enum TerminalSlot: Equatable {
    /// a terminal, or one on its way: the attachment speaks for itself
    case live
    /// a peer's session (IOS-3a): which machine, and whether it is shared —
    /// since TM-5 no peer row names a session this phone can mint for
    case peer
    /// nothing to open, and why (the face's words)
    case absence
  }

  static func terminalSlot(attached: Bool, remote: Bool, agentAttachable: Bool) -> TerminalSlot {
    if attached || agentAttachable { return .live }
    return remote ? .peer : .absence
  }

  // MARK: - The live card is its terminal (item 41)

  /// Item 41 (James, 2026-10-19; T1, ruled 21:38Z) — the live card wears
  /// Godview's pane frame (DESIGN.md §8, "The phone's live card is its
  /// terminal"): a band across its top, and a line and a glow that follow the
  /// sheet's corners. The band is 44pt, and the grid starts under it, so no row
  /// hides under chrome.
  static let liveCardBand: CGFloat = 44
  /// The sheet's outline, which the frame's line and glow follow: the sheet's
  /// own 40pt corners on top (`.presentationCornerRadius(40)`) and, at its
  /// foot, the screen's — 62 on the 6.3-inch phones, and never less, so the
  /// glass never cuts the line; a screen rounded tighter shows it a hair inside.
  static let liveCardOutline = UnevenRoundedRectangle(
    topLeadingRadius: 40, bottomLeadingRadius: 62, bottomTrailingRadius: 62, topTrailingRadius: 40)
  /// A cooled terminal dims toward its ground, under a veil of it at this opacity.
  static let liveCardCooledVeil: Double = 0.45

  /// What the band's readout says (T1): the agent's model · effort · context
  /// share, lowercase, as a desktop pane's frame reads its agent. What the
  /// agent has not said is left out, never a placeholder.
  struct LiveCardReadout: Equatable {
    /// The model, else the agent's own name.
    let model: String
    let effort: String?
    /// The effort is the launch's intent, not the provider's evidence: drawn
    /// italic, as the desktop's frame and the swarm's bodies draw it.
    let effortIsIntent: Bool
    /// The context share in whole percent: `46%`.
    let context: String?

    static let separator = " · "

    /// The readout as one line.
    var words: String { [model, effort, context].compactMap { $0 }.joined(separator: Self.separator) }
  }

  /// The band's readout for the card's subject; nil for a peer's bare terminal,
  /// whose band wears the badge alone, as a desktop pane does before its agent
  /// speaks.
  static func liveCardReadout(_ bubble: FieldBubble) -> LiveCardReadout? {
    guard let agent = bubble.agent else { return nil }
    let named = agent.modelName.flatMap { $0.isEmpty ? nil : $0 } ?? agent.providerName
    let effort = agent.effort.flatMap { $0.value.isEmpty ? nil : $0.value.lowercased() }
    let context = agent.contextUsedPercent.flatMap { share -> String? in
      guard share.isFinite else { return nil }
      return "\(Int(min(max(share, 0), 100).rounded(.down)))%"
    }
    return LiveCardReadout(
      model: named.lowercased(), effort: effort,
      effortIsIntent: effort != nil && agent.effort?.intent == .configured, context: context)
  }

  // MARK: - A live card another client is driving (item 42)

  /// Item 42 (James, 2026-10-19 17:42Z: "studio is driving · touch to take it
  /// back"; the look ruled 21:38Z, Phone A) — the READOUT a live card stands in
  /// its empty rows while another client holds its session's geometry seat: a
  /// window, a peer's window, another phone (DESIGN.md §8, "A live card another
  /// client is driving"). It is the desktop's held-edge figure at the phone's
  /// scale: the holder's name huge, the verb at 40%, one caption line. It names
  /// no size and wears no mark: the phone can see what it is drawing.
  struct SeatReadout: Equatable {
    /// The holder's name as fieldd minted it into its grant, full and never
    /// re-cased: `seatHolderFallback` when it minted none.
    let name: String
    /// The rows the holder's grid stands in on the card — the PTY's, from the
    /// seat — which the words stand clear of.
    let heldRows: Int
    /// The renderer's line height, which those rows are measured in; nil
    /// before the card's terminal view exists.
    let lineHeight: CGFloat?

    /// What the holder is doing, at 40%.
    static let verb = "is driving"
    /// The one caption line: what a touch does.
    static let caption = "touch to take it back"
  }

  /// The name the readout says when fieldd minted the holder none — a grant
  /// from before item 42, or a principal it could not name — as the desktop
  /// says it (`pane-faces.ts`), never an id.
  static let seatHolderFallback = "Another device"
  /// The held veil: the terminal's ground at 62%, the desktop's held veil and
  /// not the cooled terminal's 45%, so one state wears one veil on every device.
  static let liveCardHeldVeil: Double = 0.62
  /// The readout's entrance waits this long after the seat goes, so a glance at
  /// another device never flashes it (the desktop's `SEAT_VEIL_DELAY_MS`). It
  /// goes at once when the phone takes the seat.
  static let seatVeilWait: Double = 0.4

  /// Who drives, for the readout — only while ANOTHER client holds the seat.
  /// This phone's own seat, an empty one and one the cell has not announced say
  /// nothing: the terminal is the state then. An empty seat another client let
  /// go is not said either: the card on the screen takes it (`takesEmptySeat`),
  /// and a card off the screen takes it when it is presented again (DS-4b).
  static func seatReadout(_ seat: RoutedSessionSeat?, lineHeight: CGFloat?) -> SeatReadout? {
    guard let seat, case .another(let holder) = seat.driver else { return nil }
    return SeatReadout(
      name: holder.face?.name ?? seatHolderFallback, heldRows: seat.rows, lineHeight: lineHeight)
  }

  /// Whether the readout stands, and the held veil with it: only on a live
  /// terminal with no words of its own. The attachment's words win, and a
  /// cooled terminal keeps its own 45% veil, so a card never wears two veils and
  /// the held veil never stands without the words that say why.
  static func showsSeatReadout(live: Bool, cooled: Bool, hasWords: Bool) -> Bool {
    live && !cooled && !hasWords
  }

  /// The words' figure (DESIGN.md §8, the desktop's at the phone's scale): 800
  /// at 56pt with a line height of 1, −0.04em; the verb 4pt under the name, and
  /// the caption, 12pt semibold, 18pt under the verb (the canvas's spacing).
  static let seatWordsSize: CGFloat = 56
  static let seatWordsTracking: CGFloat = -0.04
  static let seatVerbGap: CGFloat = 4
  static let seatCaptionSize: CGFloat = 12
  static let seatCaptionGap: CGFloat = 18
  /// The block the words take: the two lines, their gaps, and the caption's line
  /// at 1.25 of its size.
  static var seatWordsHeight: CGFloat {
    seatWordsSize * 2 + seatVerbGap + seatCaptionGap + seatCaptionSize * 1.25
  }
  /// Where the text stands in the grid, which the rows are counted from: item
  /// 41's padding (`presentationConfig`: 0 above, 6 below) and the renderer's own
  /// 2pt origin on each — 2pt down from the grid's top, 8pt up from its foot.
  static let liveCardTextTop: CGFloat = 2
  static let liveCardTextFoot: CGFloat = 8

  /// Where the readout's words stand: the distance of their middle from the
  /// grid's top. They stand in the card's empty rows (DESIGN.md §8). While the
  /// held screen stands top-left — the anchor at the foot rides ghosttea 0.10.2
  /// — its rows fill the grid from the top and the empty rows are at the foot,
  /// so the words stand in the middle of those. When the held rows reach the
  /// card's own last row, or leave too few rows for the words, there are none
  /// to stand in, and the words stand over the grid's middle; so they do while
  /// the line height is not known yet. The empty rows end above the floating
  /// input row (`footReserve`, `ClosedRow.footprint`), so the words never stand
  /// under the keyboard key or the reply chips.
  static func seatWordsCentre(
    grid: CGFloat, heldRows: Int, lineHeight: CGFloat?, footReserve: CGFloat = 0
  ) -> CGFloat {
    guard grid.isFinite, grid > 0 else { return 0 }
    let middle = grid / 2
    guard let lineHeight, lineHeight.isFinite, lineHeight > 0, heldRows > 0 else { return middle }
    let heldFoot = liveCardTextTop + CGFloat(heldRows) * lineHeight
    let gridFoot = grid - max(liveCardTextFoot, footReserve)
    guard gridFoot - heldFoot >= seatWordsHeight else { return middle }
    return (heldFoot + gridFoot) / 2
  }

  /// One part of the readout's entrance: when it starts, after the wait, and
  /// how long it takes.
  struct EntrancePart: Equatable {
    let delay: Double
    let duration: Double

    /// How far through it is `clock` seconds into the entrance: 0 until it
    /// starts, 1 once it is done, a straight line between (the curve is the
    /// part's own, laid on this).
    func progress(at clock: Double) -> Double {
      guard duration > 0 else { return clock >= delay ? 1 : 0 }
      return min(max((clock - delay) / duration, 0), 1)
    }
  }

  /// The readout's entrance (DESIGN.md §8), played once, as the desktop's plays,
  /// after the 400ms wait: the veil in 200ms on plain `ease`; the glow in 600ms
  /// on the island curve, and the bloom in 600ms on it from 140ms; the name's
  /// letters on the pop in 280ms from 140ms, 26ms apart and never more than
  /// 400ms in all (§6's stagger); the verb tracking in from .34em on the island
  /// curve in 560ms from 340ms; and the caption in 240ms from 540ms. Then it
  /// holds still — a held seat is a state, not a wait (§6) — so nothing loops.
  /// Under reduced motion the whole of it fades in over 100ms.
  enum SeatEntrance {
    static let veil = EntrancePart(delay: 0, duration: 0.2)
    static let glow = EntrancePart(delay: 0, duration: 0.6)
    static let bloom = EntrancePart(delay: 0.14, duration: 0.6)
    static let verb = EntrancePart(delay: 0.34, duration: 0.56)
    static let caption = EntrancePart(delay: 0.54, duration: 0.24)
    static let reduced = EntrancePart(delay: 0, duration: 0.1)
    /// The verb's tracking as it starts, in ems; it ends on the words' −0.04em.
    static let verbTrackingFrom: CGFloat = 0.34
    /// The bloom's scale as it starts; it ends at 1.
    static let bloomScaleFrom: CGFloat = 0.4
    /// How far a letter rises, and the caption, as each comes in: half an em,
    /// and 8pt (the canvas's).
    static let letterRise: CGFloat = 0.5
    static let captionRise: CGFloat = 8

    static let letterStart = 0.14
    static let letterStep = 0.026
    static let letterCap = 0.4
    static let letterDuration = 0.28

    /// The name's letter at `index`: its own pop, 26ms after the one before,
    /// the stagger capped at 400ms (§6's `26ms/item (cap 400ms)`, read as the
    /// desktop's Me menu reads it: `min(i × 26, 400)`), so a long name's later
    /// letters start together.
    static func letter(_ index: Int) -> EntrancePart {
      EntrancePart(
        delay: letterStart + min(Double(max(index, 0)) * letterStep, letterCap),
        duration: letterDuration)
    }

    /// The clock the letters and the verb are drawn on runs until the last of
    /// them is still: the verb, which no letter outlasts.
    static let length = max(verb.delay + verb.duration, letterStart + letterCap + letterDuration)
  }

  /// Whether the live card takes its session's EMPTY seat itself: the holder let
  /// go while the card is on the screen. The card is the phone's one pane in
  /// front, so this is Q1's ruling — a focused pane takes the empty seat —
  /// applied to the phone (DESIGN.md §8). On the screen is the app in front
  /// (`.active`; `.inactive` is a shade or the switcher, not a person at the
  /// card) with this card the one presented. A card in the background or behind
  /// another takes nothing while it is away; one presented again takes the seat
  /// by DS-4b's own rule (`TerminalAttachment`'s attach and resume), never by
  /// this one, so the readout shows only while another device holds the seat as
  /// the card sits on the screen (DESIGN.md §8).
  ///
  /// ONCE, on the let-go itself: another client held the seat, and now nobody
  /// does, with that client remembered as the one who let go. An empty seat keeps
  /// that memory through its later resizes and empty states, and a take that does
  /// not land leaves it standing, so neither is asked again — the client owns the
  /// take's one retry, and the host never loops. A seat this phone let go, or
  /// first heard empty (`letGo` nil), was never another's to let go of.
  static func takesEmptySeat(
    from old: RoutedSessionSeat.Driver?, to new: RoutedSessionSeat.Driver?,
    phase: ScenePhase, presented: Bool
  ) -> Bool {
    guard phase == .active, presented else { return false }
    guard case .another(_)? = old, case .nobody(let letGo)? = new else { return false }
    return letGo != nil
  }

  /// fix8 — whether the card's run has EXITED, by its own face (PJ-7's second
  /// phone run: the card read "connecting over the mesh…" after the run had
  /// ended). An attachment still attaching then says the run ended and stops
  /// dialing (`TerminalAttachment.runEnded`); a live one is the cell's to end.
  static func runHasExited(_ face: AgentTerminalFace) -> Bool {
    switch face {
    case .exited, .exitedWithPane: true
    case .attach, .unobserved, .notPublished, .noJoin: false
    }
  }

  // MARK: - The input card

  /// Whether the input card is on the screen at all (K-D2).
  ///
  /// It is shown for exactly one state: a LIVE attachment the host has granted
  /// writes to. Every other state renders no card — not a greyed-out one.
  /// A rail of keys that cannot reach a terminal is the disabled-affordance
  /// shape D-i6 exists to forbid: the honest line ("view only — this device
  /// has no write key for this host") already says why, and a dead keyboard
  /// under it would say it a second time and worse.
  ///
  /// `mayType` is the GRANT's answer (`TerminalAttachment.mayType`: the input
  /// right, accepted and live) and never the per-keystroke gate. Corrected
  /// 2026-10-17: this read `acceptsInput`, on the reading that it composed only
  /// the phase and the grant. It is `InputAllowed`, which also holds input
  /// while the scene catches up after a reseed, so the card left on every
  /// resize, the pane grew into another resize, and the card came back: the
  /// phone's terminal tab jumped up and down without end. The phase is asked
  /// for as well, so a suspended session cannot keep a keyboard up.
  enum InputCardFace: Equatable {
    case hidden
    case shown
  }

  static func inputCardFace(phase: TerminalPhase, mayType: Bool) -> InputCardFace {
    guard phase == .live, mayType else { return .hidden }
    return .shown
  }

  // MARK: - Writes

  // RETIRED 2026-10-28 (James, typed 04:22Z: "all the peer session should be writable, which is the default and
  // universal setting, so no need to mark things like writable or read only"): the card's pre-attach sentence,
  // `writeInvitation` ("you can type here" / "view only — this session is shared read-only" from the listing's
  // `readWrite`), was such a mark. The card says nothing about typing before a tap. The live attachment still names
  // a desktop that grants `read` without `input` in its own words (`TerminalAttachment`, "view only — this desktop
  // granted read without input"): that is post-attach truth, and it stays.

  // MARK: - The account corner (IOS-8b)

  /// The corner's whole answer (AP-D1…D7): which face it wears, whether it
  /// wears the dot, what stands beside the face when the menu is open, which
  /// rows the menu holds and which act it offers. Every word is
  /// `MeshDisplay`'s or `AccountDisplay`'s; this decides WHICH.
  struct AccountFace: Equatable {
    enum Control: Equatable {
      /// Not signed in and no node: the corner is the act.
      case signIn
      /// Signed in, and no desktop has said who you are yet: a plain circle,
      /// never a face to take back.
      case blank
      case face(UserFace)
    }

    struct DesktopRow: Equatable, Identifiable {
      let id: String
      let name: String
      let word: String?
      let wantsTheUser: Bool
    }

    var control: Control
    /// The dot (AP-D7): the mesh needs the person, or a desktop does.
    var wantsAttention: Bool
    /// The name beside the face; the login stands in until a desktop names you.
    var name: String
    /// Under the name: the account line while up, the connection's word otherwise.
    var detail: String?
    var detailIsLogin: Bool
    var detailWantsAttention: Bool
    /// The orange words at the top of the menu, when the mesh needs the person.
    var notice: String?
    var desktops: [DesktopRow]
    var othersLine: String?
    /// Sign in, as a row in the menu: the one act the connection still asks
    /// of the person, and only while the tailnet asks for it. There is no
    /// connect and no disconnect — the phone stays on the mesh by itself while
    /// it is signed in (James, 2026-10-18).
    var offersSignIn: Bool
    var canSignOut: Bool
  }

  /// A desktop this account has seen and the tailnet does not list right now
  /// (AP-D6): a row that says `asleep`.
  struct AsleepDesktop: Equatable {
    let deviceId: String
    let name: String
  }

  static func accountFace(
    meshState: MeshModel.State,
    rememberedLogin: String?,
    login: String?,
    domain: String?,
    name: String?,
    face: UserFace?,
    desktops: [FieldDesktop],
    asleep: [AsleepDesktop],
    foreignDoors: Int,
    isHearing: Bool
  ) -> AccountFace {
    let live = (login?.isEmpty ?? true) ? nil : login
    let remembered = (rememberedLogin?.isEmpty ?? true) ? nil : rememberedLogin
    // The account this phone is signed in as: the node's own report first,
    // then what the phone remembers from the last sign-in.
    let account = live ?? remembered
    let nodeStanding: Bool =
      switch meshState {
      case .off, .failed, .reconnecting: false
      case .starting, .needsLogin, .needsMachineAuth, .up, .stopping: true
      }

    let control: AccountFace.Control
    if let face {
      control = .face(face)
    } else if account != nil || nodeStanding {
      control = .blank
    } else {
      control = .signIn
    }

    let wantsAttention =
      MeshDisplay.chipWantsAttention(state: meshState) || MeshDisplay.chipWantsAttention(desktops: desktops)

    // The line under the name. Up: the account line (UA-P-5a's, word for
    // word) — unless the login is already standing in for the name, in which
    // case the domain half alone, so the login is not said twice. Otherwise
    // the connection's own word.
    let shownName = name ?? account ?? ""
    let detail: String?
    let detailIsLogin: Bool
    let detailWantsAttention: Bool
    if meshState == .up {
      let loginForLine = (name == nil && live != nil) ? nil : live
      detail = MeshDisplay.accountLine(login: loginForLine, domain: domain)
      detailIsLogin = loginForLine != nil
      detailWantsAttention = false
    } else {
      detail = AccountDisplay.connectionDetail(state: meshState)
      detailIsLogin = false
      detailWantsAttention =
        switch meshState {
        case .needsLogin, .needsMachineAuth, .failed: true
        case .off, .starting, .up, .stopping, .reconnecting: false
        }
    }

    // The rows: what the link lists, in its order, then what the phone
    // remembers and the tailnet does not list — asleep, by name.
    var rows: [AccountFace.DesktopRow] = desktops.map { desktop in
      let word = AccountDisplay.desktopWord(desktop, isHearing: isHearing)
      return .init(id: desktop.deviceId, name: desktop.name, word: word.word, wantsTheUser: word.wantsTheUser)
    }
    let listed = Set(desktops.map(\.deviceId))
    rows += asleep
      .filter { !listed.contains($0.deviceId) }
      .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
      .map { .init(id: $0.deviceId, name: $0.name, word: AccountDisplay.asleep, wantsTheUser: false) }

    return AccountFace(
      control: control,
      wantsAttention: wantsAttention,
      name: shownName,
      detail: detail,
      detailIsLogin: detailIsLogin,
      detailWantsAttention: detailWantsAttention,
      notice: AccountDisplay.notice(state: meshState),
      desktops: rows,
      othersLine: AccountDisplay.othersLine(count: foreignDoors),
      offersSignIn: meshState == .needsLogin,
      canSignOut: account != nil)
  }
}
