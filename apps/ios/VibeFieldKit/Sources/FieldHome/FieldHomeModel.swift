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
  /// sheet's corners. The header's controls take 44pt; its fading backdrop
  /// overlays the grid without reserving a separate header row.
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
  /// center while another client holds its session's geometry seat: a
  /// window, a peer's window, another phone (DESIGN.md §8, "A live card another
  /// client is driving"). It is the desktop's held-edge figure at the phone's
  /// scale: the holder's name huge, the verb at 40%, one caption line. It names
  /// no size and wears no mark: the phone can see what it is drawing.
  struct SeatReadout: Equatable {
    /// The holder's name as fieldd minted it into its grant, full and never
    /// re-cased: `seatHolderFallback` when it minted none.
    let name: String
    /// The holder's announced geometry. The overlay's position is independent
    /// of it, so another device's resizing cannot move the message around.
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
  /// starting at 56pt, −0.04em; the verb 4pt under the name, and
  /// the caption, 12pt semibold, 18pt under the verb (the canvas's spacing).
  static let seatWordsSize: CGFloat = 56
  static let seatWordsTracking: CGFloat = -0.04
  static let seatVerbGap: CGFloat = 4
  static let seatCaptionSize: CGFloat = 12
  static let seatCaptionGap: CGFloat = 18

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
      /// TS-7 — the desktop's own `process.platform`, for its OS mark. Nil is
      /// "not said yet", and draws the plain screen, never a guess.
      var platform: String? = nil
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
    /// WI-W2e A (James on the page The Way In, 2026-11-14 03:47:45Z) — Try again, as a row in the menu: the next step
    /// under the notice "Couldn’t connect.", in Sign in's place. The two never stand together: Sign in while the
    /// tailnet asks, Try again after a start that failed, which nothing retries by itself (`MeshModel.dropped`).
    var offersTryAgain: Bool
    /// TS-7 — that row's words: the act's own on a first sign-in, the
    /// desktop's "Sign in again" for an account the tailnet asks for again.
    var signInWord: String
    var canSignOut: Bool

    /// WI-W2e A — Try again's row's words, the corner's own.
    var tryAgainWord: String { AccountDisplay.tryAgain }

    /// Whether the menu's desktops section has anything in it — a desktop,
    /// or the line about other accounts' desktops — and so closes with a
    /// hairline (IOS-10a; filed 2026-10-31: waiting for approval, the two
    /// hairlines stood with nothing between them).
    var drawsDesktopSection: Bool { !desktops.isEmpty || othersLine != nil }
  }

  /// A desktop this account has seen and the tailnet does not list right now
  /// (AP-D6): a row that says `asleep`.
  struct AsleepDesktop: Equatable {
    let deviceId: String
    let name: String
    /// TS-7 — the platform the account remembers it saying, for its mark.
    var platform: String? = nil
    /// IOS-10a — when this login last heard it (`RememberedDesktop.lastSeen`),
    /// for Settings' "Asleep · last heard …".
    var lastSeen: Date? = nil
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
      return .init(
        id: desktop.deviceId, name: desktop.name, word: word.word, wantsTheUser: word.wantsTheUser,
        platform: desktop.platform)
    }
    let listed = Set(desktops.map(\.deviceId))
    rows += asleep
      .filter { !listed.contains($0.deviceId) }
      .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
      .map {
        .init(id: $0.deviceId, name: $0.name, word: AccountDisplay.asleep, wantsTheUser: false, platform: $0.platform)
      }

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
      // RED — WI-W2e A: the notice carries no act yet
      offersTryAgain: false,
      signInWord: AccountDisplay.signInWord(hasAccount: account != nil),
      canSignOut: account != nil)
  }

  // MARK: - The way in (WI-1; TS-7's door, moved off the Field tab)

  /// What stands in the way in while the phone is signed out (WI-1, DESIGN.md §9 "The way in"), or nil:
  /// signed in, the three tabs. Every word is `WayInView`'s; this decides WHICH page, and is the one
  /// place that does.
  enum DoorPage: Equatable {
    /// No account: nothing remembered and no login live — before a first
    /// sign-in, while it is under way, after a Cancel and after Sign out. It
    /// yields only to approval and to a login. `failure` is a first sign-in's
    /// reason, or why the sheet could not be shown; `expecting` is the login a
    /// desktop's code said to expect (TS-7b), said as "At Tailscale, pick ‹login›."
    case welcome(failure: String?, expecting: String? = nil)
    /// WI-2 — opened from a desktop's code by its link (the Camera) on a phone with no account: the welcome
    /// steps aside for the desktop that sent you, and names the account to sign in with.
    case fromCode(desktop: String, login: String)
    /// Signed in; an admin of the network approves new devices.
    case approval(machine: String?, adminConsole: URL?)
    /// The tailnet asks a remembered account to sign in again. Expired and
    /// removed are one page: the Swift node says neither (TS-7 Q1-b).
    case signInAgain(note: String?)
    /// TS-7b (A:723) — signed in as one account while a desktop's code said to
    /// expect another. Presentation only: the gate and the login are
    /// untouched. `byLink` — the code came by a link any page could have
    /// opened, so Keep this account is the primary act (EL7).
    case anotherAccount(current: String, expected: String, from: String, byLink: Bool)
    /// WI-1 — an account, its node not up yet, and no desktop known: a hold. `note` is why it is not up
    /// (a failure the mesh is already retrying).
    case joining(login: String?, note: String?)
    /// WI-1 — up, and the first answer (the gate, the listing) not in yet: a hold.
    case looking(login: String)
    /// Up, the first listing answered, nothing online and nothing remembered.
    case noDesktops(login: String)
    /// WI-L2 as amended 2026-11-13 — a phone that has been here before, and no network on it: nothing is reached
    /// until it has one.
    case offline
    /// WI-L2 as amended — a phone that has been here before, looking for a desktop to answer: a hold, and no
    /// step of the first way in. `quiet` under a launch's grace: the splash stands bare, as every launch looks.
    case reaching(quiet: Bool)
    /// WI-L2 as amended — it has looked for the patience and none answers: what to do about it. `desktop` is
    /// the account's one desktop by name, nil when it has several.
    case unreachable(desktop: String?)
  }

  // MARK: - The gate (WI-L2 as amended 2026-11-13: signed in means a desktop answers now)

  /// How long the phone has gone without a desktop answering (DESIGN.md §9 "The way in", amended 2026-11-13).
  enum Absence: Equatable {
    /// Under the grace, with a desktop answering until a moment ago: the tabs stay, and say it themselves.
    case blip
    /// Under the grace with none since the launch: the splash holds bare.
    case opening
    /// Past the grace: the hold says it is looking.
    case looking
    /// Past the patience: the page says what to do.
    case long
  }

  /// One turn of an absence: what it becomes, and how long after the turn before it.
  struct AbsenceStep: Equatable {
    let after: Duration
    let then: Absence
  }

  /// How long a phone may be without a desktop before the splash comes back (§8 "The phone's way in").
  static let reachGrace: Duration = .seconds(5)
  /// How long the hold looks before the page says a desktop can't be reached.
  static let reachPatience: Duration = .seconds(10)

  /// What an absence passes through from where it stands. A fresh one (a drop, a launch) waits out the grace,
  /// then looks for the patience. One already past its grace (Try again, coming back to VibeField, a sign-in
  /// that Tailscale asked for, a network that returned) looks again at once.
  static func absenceCourse(from absence: Absence) -> [AbsenceStep] {
    switch absence {
    case .blip, .opening:
      return [AbsenceStep(after: reachGrace, then: .looking), AbsenceStep(after: reachPatience, then: .long)]
    case .looking, .long:
      return [AbsenceStep(after: .zero, then: .looking), AbsenceStep(after: reachPatience, then: .long)]
    }
  }

  /// What the absence's clock runs on: a change of any of these starts it again from where it stands.
  struct Reach: Equatable {
    /// A desktop answers, and the phone has a network.
    var connected: Bool
    /// Tailscale is asking (a sign-in, an admin's approval): the page is the asking's own, and no clock runs.
    var asking: Bool
    var online: Bool
    /// Try again and coming back to VibeField each count one.
    var attempt: Int
  }

  static func reach(meshState: MeshModel.State, online: Bool, answering: Int, attempt: Int) -> Reach {
    let asking = meshState == .needsLogin || meshState == .needsMachineAuth
    return Reach(connected: online && answering > 0, asking: asking, online: online, attempt: attempt)
  }

  /// What the clock makes of an absence when its facts change, before any time passes: connected, the next drop
  /// begins as a blip; asked by Tailscale, the absence is long, so the sign-in's end goes to the hold and never
  /// through the tabs. Else a long absence looks again (a network back, a sign-in ended, Try again), and any
  /// other stands as it was, for `absenceCourse` to run from. The home makes this turn in the pass that saw
  /// the facts move, so Can’t reach your computer. never stands for a frame between two holds.
  static func absence(_ was: Absence, at reach: Reach) -> Absence {
    if reach.connected { return .blip }
    if reach.asking { return .long }
    return was == .long ? .looking : was
  }

  /// How many desktops answer: a door that is ready (the home's client, or another desktop's probe), and one
  /// that answered and stopped this phone in its own words (`failed`: a build too old, a scope not granted).
  /// That desktop is there, so the tabs stand and say why, as they did; "Can’t reach your computer." would be
  /// false of it. Asleep, connecting, reconnecting, or with no address to dial, a desktop is known and does
  /// not answer.
  static func answering(_ desktops: [FieldDesktop]) -> Int {
    desktops.filter { desktop in
      switch desktop.state {
      case .ready, .failed: return true
      case .noDoor, .connecting, .reconnecting, .refusedDoor: return false
      }
    }.count
  }

  /// The desktop the gate's page names: the account's one desktop, or nil when it has none or several
  /// ("on your computer").
  static func awaitedDesktop(_ names: [String]) -> String? {
    names.count == 1 ? names.first : nil
  }

  /// Whether a first way in is under way. It begins when one of its own pages stands (no account, the desktop
  /// that sent you, joining, looking, No desktops yet) and ends at signed in; Sign in again, Another account?,
  /// an admin's approval and the gate's three screens leave it as it was. Approval stands in a first way in
  /// and over a phone that has been here before alike, so it begins none: a first way in has passed the
  /// welcome before it. While one is under way the gate's screens never stand in its place, so a desktop listed
  /// mid-way neither drops the steps nor loses the found beat.
  static func firstWayIn(_ was: Bool, page: DoorPage?) -> Bool {
    guard let page else { return false }
    switch page {
    case .welcome, .fromCode, .joining, .looking, .noDesktops: return true
    case .signInAgain, .anotherAccount, .approval, .offline, .reaching, .unreachable: return was
    }
  }

  /// Whether the way in draws anything over the splash for this step: all but the launch's bare hold.
  static func wayInDraws(_ step: WayInStep) -> Bool {
    step != .page(.reaching(quiet: true))
  }

  /// The found beat's subject (WI-2): the desktop the phone first reached.
  struct FoundDesktop: Equatable {
    let name: String
    let platform: String?
  }

  /// How long the found beat holds before the way in goes on (to the lock, then the hand-over).
  static let foundBeatHold: Duration = .milliseconds(1200)

  /// WI-L2 — the way in's page, or nil for signed in: an account whose node is not asking, with a VibeField
  /// desktop answering now and a network on the phone (amended 2026-11-13, James: the phone is a companion to
  /// VibeField on a computer, and offers nothing without one).
  ///
  /// *Errata (2026-11-13):* this said "with a VibeField desktop known (listed now, or remembered from an
  /// earlier listing). A desktop asleep keeps the phone signed in". A desktop known and not answering now
  /// gates a phone that has been here before (`remembered` > 0 and no first way in under way): nothing for a
  /// blip, the bare splash at a launch, then the hold, then the page; with no network, You’re offline. A first
  /// way in keeps its own pages until a desktop answers.
  static func doorPage(
    fixtureOwnsTheField: Bool,
    meshState: MeshModel.State,
    rememberedLogin: String?,
    login: String?,
    isGated: Bool,
    hasListed: Bool,
    listed: Int,
    answering: Int,
    remembered: Int,
    online: Bool,
    firstWayIn: Bool,
    absence: Absence,
    desktop: String?,
    machineName: String?,
    adminConsole: URL?,
    signInNote: String?,
    expected: PhoneCodeExpectation? = nil
  ) -> DoorPage? {
    // A fixture's photograph is of the tabs it stages; a page over it would be
    // this decision's, not the fixture's (it stamps its own).
    if fixtureOwnsTheField { return nil }
    let live = (login?.isEmpty ?? true) ? nil : login
    let kept = (rememberedLogin?.isEmpty ?? true) ? nil : rememberedLogin
    let account = live ?? kept
    // TS-7b — a mismatch is caught at once, over any other page: the phone's
    // account is not the one the desktop's code named.
    if let expected, let account, !expected.matches(account) {
      return .anotherAccount(
        current: account, expected: expected.login, from: expected.from, byLink: expected.arrival == .link)
    }
    // No account: the welcome, or — for a code that came by its link — the desktop that sent you.
    func welcome(_ failure: String?) -> DoorPage {
      guard let expected else { return .welcome(failure: failure) }
      if expected.arrival == .link, failure == nil { return .fromCode(desktop: expected.from, login: expected.login) }
      return .welcome(failure: failure, expecting: expected.login)
    }
    // An account with no desktop answering. A phone that has been here before is gated by how long it has gone
    // without one; a first way in stands on its own page (`first`) until one answers.
    let returning = !firstWayIn && remembered > 0
    func gate(_ first: DoorPage) -> DoorPage? {
      guard returning else { return first }
      switch absence {
      case .blip: return nil
      case .opening: return .reaching(quiet: true)
      case .looking: return online ? .reaching(quiet: false) : .offline
      case .long: return online ? .unreachable(desktop: desktop) : .offline
      }
    }
    switch meshState {
    case .needsMachineAuth:
      return .approval(machine: machineName, adminConsole: adminConsole)
    case .needsLogin:
      return account == nil ? welcome(signInNote) : .signInAgain(note: signInNote)
    case .off, .starting, .stopping:
      guard let account else { return welcome(signInNote) }
      return gate(.joining(login: account, note: nil))
    case .failed(let reason):
      guard let account else { return welcome(reason) }
      return gate(.joining(login: account, note: reason))
    case .reconnecting:
      // the mesh reconnects only for a remembered account
      guard let account else { return .joining(login: nil, note: nil) }
      return gate(.joining(login: account, note: nil))
    case .up:
      // Up with no login yet is the beat before the re-gate: still joining.
      guard let account else { return .joining(login: nil, note: nil) }
      // signed in: a desktop answers now, and the phone has a network to hear it on
      if online, answering > 0 { return nil }
      // No desktops yet is an answer, never the blank before one; a desktop known and not answering is looked for
      guard isGated, hasListed, listed + remembered == 0 else { return gate(.looking(login: account)) }
      return gate(.noDesktops(login: account))
    }
  }

  /// WI-2 — whether the way in ends here, with the found beat: a page that stood for a first sign-in yields to
  /// signed in. "Another account?" kept is no arrival, and a launch that is signed in from its first frame
  /// passes no page at all. Nor does Sign in again end the way in with a beat (WI-1's review, M4): §9 sets the
  /// beat between the steps and the lock's offer, and Tailscale asking a remembered phone again is neither. Nor do
  /// the gate's three screens (WI-L2 as amended 2026-11-13): a desktop answering again is a return, not an arrival.
  static func wayInEnds(previous: DoorPage?, next: DoorPage?) -> Bool {
    guard let previous, next == nil else { return false }
    switch previous {
    case .anotherAccount, .signInAgain, .offline, .reaching, .unreachable: return false
    case .welcome, .fromCode, .approval, .joining, .looking, .noDesktops: return true
    }
  }

  /// WI-1 (the review's M1) — whether the tabs stand: signed in, always; signed out, only until the splash stands
  /// whole over them. A sign-out's splash comes back over the tabs, fading in over them (DESIGN.md §8 "The phone's
  /// way in"), so they stay under it until it covers them, taking no touch meanwhile; a launch signed out never
  /// mounts them, the splash covering from its first frame.
  static func tabsStand(signedIn: Bool, splashCovers: Bool) -> Bool {
    signedIn || !splashCovers
  }

  /// WI-2 (WI-1's review, L3) — How it works' page when the way in's page changes: the tour stands only over the
  /// welcome, so any other page ends it, and the welcome's return later does not bring back a page left mid-tour.
  static func tourPage(_ page: Int?, after next: DoorPage?) -> Int? {
    guard case .welcome = next else { return nil }
    return page
  }

  /// The found beat's desktop: the home if it is listed, else the first desktop listed; nil while none
  /// answers (signed in by a desktop remembered, asleep).
  static func foundDesktop(home: String?, desktops: [FieldDesktop]) -> FoundDesktop? {
    guard let desktop = desktops.first(where: { $0.deviceId == home }) ?? desktops.first else { return nil }
    return FoundDesktop(name: desktop.name, platform: desktop.platform)
  }

  /// TS-7b — whether the expectation is met and goes: the node reports the
  /// login the Mac's code named. Only the node's own report settles it — a
  /// remembered login is what the phone had, not what it signed in as.
  static func expectationSettles(_ expected: PhoneCodeExpectation?, login: String?) -> Bool {
    guard let expected, let login, !login.isEmpty else { return false }
    return expected.matches(login)
  }
}

// MARK: - The card's terminal (items 154, 162)

extension FieldHomeModel {
  /// The card's terminal face for its subject: the subject's join decided against its desktop's name and doors (the
  /// devices store's `name` and `terminalMesh`). `.noJoin` with no subject.
  static func cardTerminalFace(_ bubble: FieldBubble?, desktops: [FieldDesktop]) -> AgentTerminalFace {
    guard let join = bubble?.join else { return .noJoin }
    let desktop = desktops.first { $0.deviceId == join.deviceID }
    return agentTerminalFace(
      join: join, deviceName: desktop?.name, publishesTerminalDoors: desktop?.publishesTerminalDoors)
  }

  /// Whether the card offers RESUME for its subject, given its face: an agent's alone. A bare terminal has no run (its
  /// board key is a floor session, which `agent.resume` would refuse), whatever its face.
  static func offersResume(_ face: AgentTerminalFace, for bubble: FieldBubble?) -> Bool {
    face.offersResume && bubble?.agent != nil
  }
}
