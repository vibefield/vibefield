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

/// The card that rises when a bubble is tapped: the session's identity and
/// live status above the surface where its terminal renders.
///
/// Two faces, one anatomy. An agent's card says what the agent is doing; a
/// peer's terminal says which machine it lives on and offers the one act that
/// matters — **attach**. There is deliberately no session list here (IOS-3):
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
  let hasWriteKey: Bool
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
  let onAttach: () -> Void
  @ViewBuilder let terminal: () -> Terminal

  private var face: FieldHomeModel.CardFace {
    FieldHomeModel.cardFace(hasSubject: bubble != nil, listed: listed, attached: isAttached)
  }

  var body: some View {
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
        Text(subtitle(bubble))
          .font(FieldType.mono(9))
          .foregroundStyle(FieldPalette.textMuted)
          .lineLimit(1)
        if !listed {
          // Exactly one fact, and only the one we hold: the LISTING is gone.
          // Whether the session ended is the attachment's to say, and it does —
          // saying it here too would be a second answer, and a guess.
          Text("the mesh has stopped listing this session")
            .font(FieldType.mono(8))
            .foregroundStyle(FieldPalette.textFaint)
            .lineLimit(1)
        }
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
    }
    .padding(.horizontal, 18)
    .padding(.top, 22)
    .padding(.bottom, 14)
  }

  /// The line under the name: what is thinking, or which machine and how it
  /// looks from here.
  private func subtitle(_ bubble: FieldBubble) -> String {
    if let agent = bubble.agent {
      let model = agent.modelName ?? agent.provider.displayName
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

      if isAttached {
        VStack(spacing: 0) {
          terminal()
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .opacity(cooled ? 0.55 : 1)
            .animation(FieldMotion.ease(0.24), value: cooled)
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
            .padding(.top, 10)
          }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
      } else if let remote = bubble.remote {
        invitation(remote)
      } else {
        agentTerminalAbsence(bubble)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  /// A peer's session, not yet attached: the one act, and the truth about
  /// what it will get you.
  private func invitation(_ remote: RemoteFacet) -> some View {
    VStack(spacing: 12) {
      Text("TERMINAL")
        .font(FieldType.mono(9, .heavy))
        .tracking(FieldType.tracking(0.18, of: 9))
        .foregroundStyle(FieldPalette.textMuted)

      if remote.attachable {
        Button(action: onAttach) {
          Text("ATTACH")
            .font(FieldType.mono(11, .heavy))
            .tracking(FieldType.tracking(0.12, of: 11))
            .foregroundStyle(FieldPalette.panelBackground)
            .padding(.horizontal, 18)
            .padding(.vertical, 9)
            .background(RoundedRectangle(cornerRadius: 8).fill(FieldPalette.textMain))
        }
        .buttonStyle(.plain)

        // `remote.readWrite` says the SESSION is shared for writing — it rides
        // in a host advertisement broadcast to the whole mesh and knows
        // nothing about who is asking. Whether THIS device may type is a
        // per-attach grant against a write key it does not have yet, so
        // promising typing from the listing alone was a promise the next tap
        // broke.
        Text(
          statusNote
            ?? FieldHomeModel.writeInvitation(
              sessionSharesWrites: remote.readWrite, hasWriteKey: hasWriteKey)
        )
        .font(FieldType.mono(9))
        .foregroundStyle(FieldPalette.textMuted)
        .multilineTextAlignment(.center)
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

  /// An agent's card, before fieldd's agent tracks exist: the terminal it is
  /// running in is not something the mesh has offered us.
  private func agentTerminalAbsence(_ bubble: FieldBubble) -> some View {
    VStack(spacing: 10) {
      Text("TERMINAL")
        .font(FieldType.mono(9, .heavy))
        .tracking(FieldType.tracking(0.18, of: 9))
        .foregroundStyle(FieldPalette.textMuted)
      Text("not connected")
        .font(FieldType.mono(12, .medium))
        .foregroundStyle(FieldPalette.textMain)
      Text("this agent is a preview — a real one arrives with the daemon's\nagent feed")
        .font(FieldType.mono(9))
        .foregroundStyle(FieldPalette.textMuted)
        .multilineTextAlignment(.center)
        .lineSpacing(3)
      if bubble.status == .waiting {
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
    hasWriteKey: Bool = false,
    statusNote: String? = nil,
    onAttach: @escaping () -> Void
  ) {
    self.init(
      bubble: bubble, listed: listed, isAttached: false, hasWriteKey: hasWriteKey,
      statusNote: statusNote, statusDetail: nil,
      statusActions: [], cooled: false, onAttach: onAttach
    ) {
      EmptyView()
    }
  }
}
