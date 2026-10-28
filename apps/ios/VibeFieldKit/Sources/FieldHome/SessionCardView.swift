import FieldAgents
import FieldDesign
import SwiftUI

/// One act a status line can offer. Deliberately NOT nested in the card: the
/// card is generic over its terminal slot, so a nested type would be a
/// different type per slot and the host could not name one.
struct CardAction: Identifiable {
  let id: String
  let label: String
  let run: () -> Void
}

/// The terminal's own ground as the live card paints it (item 41), handed over
/// by the host so the card never learns what a terminal's theme is.
struct CardGround {
  /// The ground, its opacity included.
  let color: Color
  /// The ground at full strength: the ink of what stands on text main over it
  /// (the band's badge), which a translucent ground would wash out.
  let solid: Color
  /// The ramp chrome on this ground wears: the ground's lightness decides it,
  /// not the app's theme.
  let inkScheme: ColorScheme
}

/// The card that rises when a bubble is tapped: the session's identity and
/// live status above the surface where its terminal renders.
///
/// Two faces, one anatomy. An agent's card says what the agent is doing; a
/// peer's terminal says which machine it lives on. Neither offers ATTACH any
/// more (FW-D2, 2026-10-17): the card rising IS the attach, so its terminal
/// is connecting or live from its first frame. There is deliberately no session list here (IOS-3):
/// discovery puts every session on the field as its own bubble, so a list
/// inside the card would be a second way to choose something the field has
/// already laid out.
///
/// The terminal slot is a `@ViewBuilder` the host fills: the card composes a
/// terminal without knowing how one works, which is what keeps the Ghosttea
/// renderer on the far side of `FieldTerminal`.
struct SessionCardView<Terminal: View>: View {
  /// The card's SUBJECT — the bubble it opened on, kept fresh by the host
  /// while the field still carries it and deliberately NOT dropped when the
  /// field stops carrying it. See `listed`.
  let bubble: FieldBubble?
  /// Whether the field still lists this session. A listing is not a heartbeat:
  /// two failed asks (~4 s) withdraw every remote row, and a terminal that is
  /// still rendering has not ended because discovery blinked. So an attached
  /// card that goes unlisted keeps its terminal and says only what is true —
  /// that the mesh has stopped listing it — while the connection speaks for
  /// itself. `FieldHomeModel.cardFace` owns the rule.
  let listed: Bool
  /// True once the host has an attachment for this session — the slot below
  /// is then the live surface rather than the invitation.
  let isAttached: Bool
  /// Whether this DEVICE holds a write key for the host. Distinct from the
  /// session's own `readWrite`, which only says the session is shared for
  /// writing — the two were being conflated into a promise this app cannot
  /// keep until the Keychain leg lands.
  /// The attachment's own words, when it has any: connecting, view-only, the
  /// reason it failed. The card renders them and never derives them — the
  /// terminal owns its truth, and this view stays ignorant of how one works.
  let statusNote: String?
  /// The second line a banner carries ("Waiting for it to return."), absent
  /// for the one-line states.
  let statusDetail: String?
  /// What the banner offers, already translated out of Ghosttea's vocabulary
  /// by the host — the card presents acts, it does not know their machinery.
  let statusActions: [CardAction]
  /// Upstream's `coolsTerminal`: the retained frame is still worth reading and
  /// still copyable, but it is plainly not live. Dimming says that without a
  /// word, which is the honest way to say it while the words are busy.
  let cooled: Bool
  /// IOS-8g — the terminal's appearance sheet, from the card's own `···`:
  /// the TERMINAL chip that stood in the field's top-right corner moved here,
  /// because what it opens is about the terminal this card holds, and the
  /// field's corners are the account's and the tab bar's now.
  let onSettings: () -> Void
  /// IOS-4c — why this agent's card has no terminal, in the host's words
  /// (`AgentTerminalFace.note`). nil where the ordinary invitation already
  /// says it, or where there is nothing honest to say.
  var terminalReason: String?
  /// fix7 — the run's own face offers its terminal (`AgentTerminalFace
  /// .offersAttach`): the host attaches as the card rises, and the slot is
  /// the terminal from the first frame (FW-D2)
  var agentAttachable: Bool = false
  /// Item 41 — the OS mark the live card's badge wears: the desktop the
  /// session runs on (§13), a plain screen while its platform is not said.
  var sessionOS: DeviceMark.OS = .unknown
  /// Item 41 — the terminal's own ground. Given, a live card is its terminal,
  /// edge to edge (`liveCard`); nil keeps the stacked card on the glass.
  var liveGround: CardGround? = nil
  /// Item 42 — who drives this card's session from another device, handed over
  /// only while one does and the card has no words of its own
  /// (`FieldHomeModel.seatReadout`, `showsSeatReadout`). Given, the live card
  /// stands this readout in its empty rows, over the held veil; nil says
  /// nothing.
  var seatReadout: FieldHomeModel.SeatReadout? = nil
  /// The act that fixes "no write key for this host" (IOS-3c), when there is
  /// one to offer. `nil` means not offered and draws nothing — this card never
  /// renders a control it cannot honour (D-i6). It is a callback rather than a
  /// store because where a key LIVES is the host's business: the card knows
  /// only that entering one is a thing the user may do here.
  @ViewBuilder let terminal: () -> Terminal

  private var face: FieldHomeModel.CardFace {
    FieldHomeModel.cardFace(hasSubject: bubble != nil, listed: listed, attached: isAttached)
  }

  var body: some View {
    if let bubble, face == .session, let liveGround, slot(bubble) == .live {
      liveCard(bubble, ground: liveGround)
    } else {
      VStack(spacing: 0) {
        if let bubble, face == .session {
          header(bubble)
          Divider().overlay(FieldPalette.panelBorder)
          terminalSlot(bubble)
        } else {
          endedFace
        }
      }
      // No opaque background: the sheet's liquid glass carries the card, and
      // the field stays visible behind it, blurred and dimmed.
    }
  }

  private func slot(_ bubble: FieldBubble) -> FieldHomeModel.TerminalSlot {
    FieldHomeModel.terminalSlot(
      attached: isAttached, remote: bubble.remote != nil, agentAttachable: agentAttachable)
  }

  // MARK: - The live card (item 41)

  /// The live card is its terminal, edge to edge (DESIGN.md §8, "The phone's
  /// live card is its terminal"; James, 2026-10-19, T1 and F1). It wears
  /// Godview's pane frame: a line and an inner glow that follow the sheet's
  /// corners, and a 44pt band across its top. The grid starts under the band
  /// and runs to the top of the home indicator's safe area, so no row hides
  /// under chrome; the closed input row floats over its last rows (the host's
  /// `ClosedRow`). The terminal's own ground runs on behind the home indicator.
  /// There is no paper, rounded inset, divider or header block.
  private func liveCard(_ bubble: FieldBubble, ground: CardGround) -> some View {
    ZStack(alignment: .top) {
      terminal()
        // A cooled terminal dims toward its ground, never toward the glass.
        .overlay {
          ground.color
            .opacity(cooled ? FieldHomeModel.liveCardCooledVeil : 0)
            .allowsHitTesting(false)
        }
        .animation(FieldMotion.ease(0.24), value: cooled)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // The grid starts under the band. The Metal view itself is laid out
        // there — never translated — so the grid it measures, less its safe
        // area, is the rows the person can read, and those are the PTY's.
        .padding(.top, FieldHomeModel.liveCardBand)

      // Item 42 — another client drives the session: the card goes on drawing
      // it at the holder's size, dimmed under the held veil, and says so in its
      // empty rows, lit in the band's ink. Over the grid and under the frame and
      // the band; it takes no touch, so one on the grid goes through and takes
      // the seat back (DS-D5), and it leaves at once when the phone takes it.
      if let seatReadout {
        SeatReadoutView(readout: seatReadout, ground: ground)
          .environment(\.colorScheme, ground.inkScheme)
          .transition(.identity)
      }

      // Godview's pane frame, over the grid and under the band's words.
      liveCardFrame
        .environment(\.colorScheme, ground.inkScheme)
        .ignoresSafeArea(edges: .bottom)

      VStack(spacing: 0) {
        band(bubble, ground: ground)
        // The attachment's words ride over the grid, 10pt under the band's
        // foot: the panel's own top margin.
        statusPanel.animation(FieldMotion.ease(0.24), value: statusNote)
      }
      // Chrome on the terminal's ground wears the ground's ramp, not the app's.
      .environment(\.colorScheme, ground.inkScheme)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    // The ground runs on under the input card and the home indicator. It is a
    // strip at the card's foot that takes the bottom safe area, so it never
    // lies under the grid: one surface, never a layer under a layer.
    .background(alignment: .bottom) {
      ground.color
        .frame(height: 0)
        .ignoresSafeArea(edges: .bottom)
    }
  }

  // MARK: - Header

  private func header(_ bubble: FieldBubble) -> some View {
    HStack(alignment: .center, spacing: 12) {
      BubbleGlyph(bubble: bubble)
        .frame(width: 28, height: 28)
        .foregroundStyle(FieldPalette.textMain)
        .opacity(0.85)

      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(bubble.project)
            .font(FieldType.mono(14, .heavy))
            .foregroundStyle(FieldPalette.textMain)
          if let branch = bubble.agent?.branch {
            HStack(spacing: 4) {
              Circle()
                .fill(FieldPalette.branchGreen)
                .frame(width: 5, height: 5)
              Text(branch)
                .font(FieldType.mono(8))
                .foregroundStyle(FieldPalette.textMuted)
            }
          }
        }
        // Unlisted, the line says exactly one fact, and only the one we hold:
        // the LISTING is gone. Whether the session ended is the attachment's to
        // say, and it does — saying it here too would be a second answer, and a
        // guess. It takes the subtitle's place rather than a line of its own: a
        // third line that came and went with discovery re-laid the terminal
        // under it, and every re-lay is a resize at the desktop (2026-10-17).
        Text(listed ? subtitle(bubble) : "the mesh has stopped listing this session")
          .font(FieldType.mono(9))
          .foregroundStyle(listed ? FieldPalette.textMuted : FieldPalette.textFaint)
          .lineLimit(1)
      }

      Spacer()

      VStack(alignment: .trailing, spacing: 3) {
        Circle()
          .fill(FieldPalette.agentColor(hue: agentIdentityHue(bubble.identityKey)))
          .frame(width: 8, height: 8)
        if let context = contextText(bubble) {
          Text(context)
            .font(FieldType.mono(8, .heavy))
            .monospacedDigit()
            .foregroundStyle(FieldPalette.textFaint)
        }
      }

      moreMenu {
        Text("···")
          .font(FieldType.mono(11, .heavy))
          .foregroundStyle(FieldPalette.textMuted)
          .frame(width: 30, height: 26)
          .background(RoundedRectangle(cornerRadius: 6).fill(FieldPalette.panelBackground.opacity(0.8)))
          .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
          .contentShape(Rectangle())
      }
    }
    .padding(.horizontal, 18)
    .padding(.top, 22)
    .padding(.bottom, 14)
  }

  /// The card's `···` (IOS-8g): the acts about this card's terminal. One
  /// today — the appearance sheet the TERMINAL chip used to open — in the
  /// godview voice the card speaks, on the system's own menu. The stacked
  /// card's header boxes the glyph; the live card's band wears it bare (T1).
  private func moreMenu<Glyph: View>(@ViewBuilder glyph: () -> Glyph) -> some View {
    let face = glyph()
    return Menu {
      Button {
        onSettings()
      } label: {
        Label("Terminal appearance…", systemImage: "paintpalette")
      }
    } label: {
      face
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .accessibilityLabel("More")
  }

  /// The line under the name: what is thinking, or which machine and how it
  /// looks from here.
  private func subtitle(_ bubble: FieldBubble) -> String {
    if let agent = bubble.agent {
      let model = agent.modelName ?? agent.providerName
      return "\(model)  ·  \(statusWords(bubble))"
    }
    return bubble.detail
  }

  private func statusWords(_ bubble: FieldBubble) -> String {
    bubble.detail == bubble.status.rawValue
      ? bubble.detail : "\(bubble.status.rawValue) · \(bubble.detail)"
  }

  private func contextText(_ bubble: FieldBubble) -> String? {
    guard bubble.agent != nil else { return nil }
    guard let percent = bubble.agent?.contextUsedPercent else { return "CTX:--%" }
    return String(format: "CTX:%02d%%", Int(percent.rounded(.down)))
  }

  // MARK: - The band and the frame (item 41)

  /// The live card's band (T1; DESIGN.md §8): 44pt across the sheet's top, on
  /// the terminal's ground. At the left the readout; at the right `···` and the
  /// badge, inset clear of the sheet's 40pt corner (the badge's own corner
  /// stands 12pt inside its arc). The row sits under the drag indicator, its
  /// middle 26pt down. The band takes its own touches: one that reached the
  /// terminal under it would take the seat (DS-D5) for a touch on the name.
  private func band(_ bubble: FieldBubble, ground: CardGround) -> some View {
    HStack(spacing: 12) {
      if let readout = FieldHomeModel.liveCardReadout(bubble) {
        bandReadout(readout)
      }
      Spacer(minLength: 0)
      HStack(spacing: 14) {
        moreMenu {
          Text("···")
            .font(FieldType.mono(14, .heavy))
            .tracking(FieldType.tracking(0.04, of: 14))
            .foregroundStyle(FieldPalette.textMain.opacity(0.62))
            .frame(width: 30, height: 36)
            .contentShape(Rectangle())
        }
        badge(bubble, ink: ground.solid)
      }
      // The readout gives way first: the badge is which session this is.
      .layoutPriority(1)
    }
    .padding(.leading, 28)
    .padding(.trailing, 24)
    .padding(.top, 8)
    .frame(maxWidth: .infinity)
    .frame(height: FieldHomeModel.liveCardBand)
    .background(ground.color)
    .contentShape(Rectangle())
  }

  /// The band's readout (T1): model · effort · context, lowercase, mono 11
  /// medium at half the band's ink, as a desktop pane's — the effort italic
  /// while it is only the launch's intent.
  private func bandReadout(_ readout: FieldHomeModel.LiveCardReadout) -> some View {
    let separator = AttributedString(FieldHomeModel.LiveCardReadout.separator)
    var line = AttributedString(readout.model)
    if let effort = readout.effort {
      var word = AttributedString(effort)
      if readout.effortIsIntent { word.font = FieldType.mono(11, .medium).italic() }
      line += separator + word
    }
    if let context = readout.context { line += separator + AttributedString(context) }
    return Text(line)
      .font(FieldType.mono(11, .medium))
      .tracking(FieldType.tracking(0.01, of: 11))
      .foregroundStyle(FieldPalette.textMain.opacity(0.5))
      .lineLimit(1)
      .truncationMode(.tail)
  }

  /// The badge (T1): the session's OS mark · its agent's mark · its name, in
  /// the ground's own ink on a fill of text main — Godview's pane badge.
  private func badge(_ bubble: FieldBubble, ink: Color) -> some View {
    HStack(spacing: 6) {
      DeviceMark(os: sessionOS, size: 11)
      BubbleGlyph(bubble: bubble, letterSize: 11)
        .frame(width: 11, height: 11)
      Text(bubble.project)
        .font(FieldType.mono(12, .semibold))
        .lineLimit(1)
    }
    .foregroundStyle(ink)
    .padding(.top, 4)
    .padding(.bottom, 5)
    .padding(.horizontal, 10)
    .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(FieldPalette.textMain))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(bubble.project), on \(sessionOS.label)")
  }

  /// Godview's pane frame on the phone (T1): its line, 1px at 30%, and its
  /// inner glow — the bare shell frame's `inset 0 0 34px -8px` at 20% and
  /// `inset 0 0 5px -1px` at 10% — in text main, following the sheet's corners.
  /// It takes no touch.
  private var liveCardFrame: some View {
    let outline = FieldHomeModel.liveCardOutline
    return ZStack {
      outline.insetGlow(FieldPalette.textMain.opacity(0.2), blur: 34, spread: -8)
      outline.insetGlow(FieldPalette.textMain.opacity(0.1), blur: 5, spread: -1)
      outline.strokeBorder(FieldPalette.textMain.opacity(0.3), lineWidth: 1)
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  // MARK: - The terminal slot

  @ViewBuilder
  private func terminalSlot(_ bubble: FieldBubble) -> some View {
    ZStack {
      // The terminal paper floats translucent in the glass — the field
      // ghosts through it, and a terminal's own background opacity composes
      // with the card's material rather than fighting it.
      RoundedRectangle(cornerRadius: 14)
        .fill(FieldPalette.terminalBackground.opacity(0.45))
        .overlay(
          RoundedRectangle(cornerRadius: 14)
            .strokeBorder(FieldPalette.panelBorder.opacity(0.6), lineWidth: 1)
        )
        .padding(.horizontal, 14)
        .padding(.vertical, 14)

      switch FieldHomeModel.terminalSlot(
        attached: isAttached, remote: bubble.remote != nil, agentAttachable: agentAttachable)
      {
      case .live:
        terminal()
          .clipShape(RoundedRectangle(cornerRadius: 14))
          .opacity(cooled ? 0.55 : 1)
          .animation(FieldMotion.ease(0.24), value: cooled)
          // The attachment's words ride OVER the terminal, never beside it: a
          // line in a row of its own resized the pane each time it came or
          // went, and a resize is a round trip to the desktop's PTY that, until
          // 2026-10-17, brought the line back (James: "a line of status text
          // jumping around"). Top, because the bottom rows are where a prompt
          // and the typing are.
          .overlay(alignment: .top) {
            statusPanel.animation(FieldMotion.ease(0.24), value: statusNote)
          }
          .padding(.horizontal, 14)
          .padding(.vertical, 14)
      case .peer:
        if let remote = bubble.remote { peerFacts(remote) }
      case .absence:
        agentTerminalAbsence(bubble)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  /// What the attachment says, and the acts its banner offers, on the card's
  /// own panel over the terminal's top edge.
  @ViewBuilder
  private var statusPanel: some View {
    if statusNote != nil || !statusActions.isEmpty {
      VStack(spacing: 6) {
        if let statusNote {
          Text(statusNote)
            .font(FieldType.mono(10, .medium))
            .foregroundStyle(FieldPalette.textMain)
            .multilineTextAlignment(.center)
        }
        if let statusDetail {
          Text(statusDetail)
            .font(FieldType.mono(9))
            .foregroundStyle(FieldPalette.textMuted)
            .multilineTextAlignment(.center)
        }
        if !statusActions.isEmpty {
          HStack(spacing: 8) {
            ForEach(statusActions) { action in
              Button(action: action.run) {
                Text(action.label)
                  .font(FieldType.mono(9, .heavy))
                  .tracking(FieldType.tracking(0.1, of: 9))
                  .foregroundStyle(FieldPalette.textMain)
                  .padding(.horizontal, 10)
                  .padding(.vertical, 6)
                  .overlay(
                    RoundedRectangle(cornerRadius: 6)
                      .strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
              }
              .buttonStyle(.plain)
            }
          }
          .padding(.top, 2)
        }
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
      .background(
        RoundedRectangle(cornerRadius: 8).fill(FieldPalette.panelBackground.opacity(0.92)))
      .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
      .padding(.horizontal, 12)
      .padding(.top, 10)
      .transition(.opacity)
    }
  }

  /// A peer's session: which machine it lives on and whether it is shared.
  /// No act (FW-D2): opening the card is the attach, and since TM-5 a peer's
  /// row names no session this phone can mint a ticket for.
  private func peerFacts(_ remote: RemoteFacet) -> some View {
    VStack(spacing: 12) {
      Text("TERMINAL")
        .font(FieldType.mono(9, .heavy))
        .tracking(FieldType.tracking(0.18, of: 9))
        .foregroundStyle(FieldPalette.textMuted)

      if remote.attachable {
        // No pre-attach write mark (James, 2026-10-28: a peer is writable by default). Whether THIS device may
        // type is decided per attach by the grant in its ticket, and the live attachment says so in its own words
        // when a desktop grants read without input.
        if let statusNote {
          Text(statusNote)
            .font(FieldType.mono(9))
            .foregroundStyle(FieldPalette.textMuted)
            .multilineTextAlignment(.center)
        }

        // RETIRED 2026-09-14 (TM-3): the ENTER KEY invitation stood here, the
        // one act that could change the sentence above — the host shares writes
        // and this phone holds no mirror-write key. There is no key to enter:
        // the right to type is a claim in the attach grant (TM-D3), granted or
        // not by the desktop, with nothing for a person to supply. Removing the
        // affordance rather than disabling it is D-i6's rule — an absence is a
        // state in words, never a dead control.
      } else {
        // The row survives and refuses honestly: a live session the peer is
        // deliberately not sharing is a fact, and hiding it would be the
        // field lying about what is running over there.
        Text("not shared for attach")
          .font(FieldType.mono(12, .medium))
          .foregroundStyle(FieldPalette.textMain)
        Text("this session is live on \(remote.deviceName), but its host is not offering it")
          .font(FieldType.mono(9))
          .foregroundStyle(FieldPalette.textMuted)
          .multilineTextAlignment(.center)
          .lineSpacing(3)
          .padding(.horizontal, 28)
      }
    }
  }

  // RETIRED 2026-10-17 (FW-D2): `agentInvitation`, the ATTACH an agent's run
  // drew while its face offered its terminal. The card rising is the attach,
  // so that face is the live slot, connecting, from its first frame.

  /// An agent's card with no terminal under it, and WHY — which since IOS-4c
  /// is a real question with four answers rather than one standing apology.
  ///
  /// The reason comes from the host as `terminalReason`, decided by
  /// `agentTerminalFace` against the hosts store. The old copy here said "this
  /// agent is a preview", which was true while the feed was the mock and
  /// became a lie the moment the daemon's board arrived: an agent that IS real
  /// and whose desktop is simply not publishing its terminals deserves to be
  /// told that, by name.
  private func agentTerminalAbsence(_ bubble: FieldBubble) -> some View {
    VStack(spacing: 10) {
      Text("TERMINAL")
        .font(FieldType.mono(9, .heavy))
        .tracking(FieldType.tracking(0.18, of: 9))
        .foregroundStyle(FieldPalette.textMuted)
      Text("not connected")
        .font(FieldType.mono(12, .medium))
        .foregroundStyle(FieldPalette.textMain)
      Text(terminalReason ?? "no terminal has been offered for this session")
        .font(FieldType.mono(9))
        .foregroundStyle(FieldPalette.textMuted)
        .multilineTextAlignment(.center)
        .lineSpacing(3)
      if bubble.status == .blocked {
        Text("waiting on a permission — approve at the desktop")
          .font(FieldType.mono(9))
          .foregroundStyle(FieldPalette.textMain)
          .padding(.top, 8)
      }
    }
  }

  // MARK: - Ended

  private var endedFace: some View {
    VStack(spacing: 8) {
      Text("SESSION ENDED")
        .font(FieldType.mono(11, .heavy))
        .tracking(FieldType.tracking(0.18, of: 11))
        .foregroundStyle(FieldPalette.textMuted)
      Text("this session left the field")
        .font(FieldType.mono(9))
        .foregroundStyle(FieldPalette.textFaint)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

extension SessionCardView where Terminal == EmptyView {
  init(
    bubble: FieldBubble?,
    listed: Bool = true,
    statusNote: String? = nil,
    onSettings: @escaping () -> Void = {}
  ) {
    self.init(
      bubble: bubble, listed: listed, isAttached: false,
      statusNote: statusNote, statusDetail: nil,
      statusActions: [], cooled: false, onSettings: onSettings
    ) {
      EmptyView()
    }
  }
}
