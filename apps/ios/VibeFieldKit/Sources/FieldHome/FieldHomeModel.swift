import FieldDesign
import FieldMesh
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
  /// `MeshModel.connect()` builds a fresh runtime, so the directory the field
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
  enum TerminalSlot: Equatable {
    /// an attachment speaks for itself
    case live
    /// a peer's session (IOS-3a): ATTACH
    case peerInvitation
    /// an agent's own run whose face offers its terminal (IOS-4c): ATTACH
    case agentInvitation
    /// nothing to open, and why (the face's words)
    case absence
  }

  static func terminalSlot(attached: Bool, remote: Bool, agentAttachable: Bool) -> TerminalSlot {
    if attached { return .live }
    if remote { return .peerInvitation }
    return agentAttachable ? .agentInvitation : .absence
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
  /// `acceptsInput` alone would very nearly do — the attachment composes it
  /// from the live phase and the grant — but the phase is asked for again
  /// here so this stays a total function of what the card can see, and so a
  /// suspended session cannot keep a keyboard up on a stale `true`.
  enum InputCardFace: Equatable {
    case hidden
    case shown
  }

  static func inputCardFace(phase: TerminalPhase, acceptsInput: Bool) -> InputCardFace {
    guard phase == .live, acceptsInput else { return .hidden }
    return .shown
  }

  // MARK: - Writes

  /// What the card can say about typing BEFORE a tap, which since TM-3
  /// (2026-09-14) is one fact rather than two.
  ///
  /// `sessionSharesWrites` rides in the listing — a broadcast with no
  /// per-caller context — so it says the session is *shared* for writing, never
  /// that WE may write. Whether this device may type is decided per attach, and
  /// it used to depend on a mirror-write key this phone either held or did not:
  /// a second fact, a sheet to enter it, and an ENTER KEY affordance beside this
  /// sentence. TM-D3 replaced the key with a claim in the attach grant, so there
  /// is nothing for a person to obtain and nothing to offer them here.
  ///
  /// The remaining unknown is answered where it becomes known rather than
  /// guessed at here: a desktop that grants `read` without `input` is named by
  /// the live attachment in its own words (`TerminalAttachment`, "view only —
  /// this desktop granted read without input").
  static func writeInvitation(sessionSharesWrites: Bool) -> String {
    sessionSharesWrites
      ? "you can type here"
      : "view only — this session is shared read-only"
  }

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

    /// The connection's own act, as a row in the menu — what the mesh sheet's
    /// one button used to be.
    enum ConnectionAct: Equatable {
      case connect
      case signIn
      case disconnect
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
    var connectionAct: ConnectionAct?
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
      case .off, .failed: false
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
        case .off, .starting, .up, .stopping: false
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

    let act: AccountFace.ConnectionAct? =
      switch meshState {
      case .off, .failed: account != nil ? .connect : nil
      case .needsLogin: .signIn
      case .up, .needsMachineAuth: .disconnect
      case .starting, .stopping: nil
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
      connectionAct: act,
      canSignOut: account != nil)
  }
}
