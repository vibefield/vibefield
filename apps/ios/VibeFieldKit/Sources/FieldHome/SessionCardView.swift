import FieldAgents
import FieldDesign
import SwiftUI

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
  /// Live lookup: the card re-reads the field every update, so status and
  /// context stay current while the sheet is open. A vanished bubble renders
  /// the honest ended face.
  let bubble: FieldBubble?
  /// True once the host has an attachment for this session — the slot below
  /// is then the live surface rather than the invitation.
  let isAttached: Bool
  /// The attachment's own words, when it has any: connecting, view-only, the
  /// reason it failed. The card renders them and never derives them — the
  /// terminal owns its truth, and this view stays ignorant of how one works.
  let statusNote: String?
  let onAttach: () -> Void
  @ViewBuilder let terminal: () -> Terminal

  var body: some View {
    VStack(spacing: 0) {
      if let bubble {
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
          if let statusNote {
            Text(statusNote)
              .font(FieldType.mono(9))
              .foregroundStyle(FieldPalette.textMuted)
              .padding(.top, 8)
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

        Text(
          statusNote
            ?? (remote.readWrite
              ? "you can type here" : "view only — the host is not sharing writes")
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
  init(bubble: FieldBubble?, statusNote: String? = nil, onAttach: @escaping () -> Void) {
    self.init(bubble: bubble, isAttached: false, statusNote: statusNote, onAttach: onAttach) {
      EmptyView()
    }
  }
}
