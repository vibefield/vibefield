import FieldAgents
import FieldDesign
import SwiftUI

/// The card that rises when a bubble is tapped: the session's identity and
/// live status above the surface where its terminal will render.
///
/// The terminal area is an honest placeholder until the Ghosttea/Truffle leg
/// lands — it names what's missing and never fakes a TUI. The seam is
/// `terminalSurface`: the live Metal surface drops in there without touching
/// the card's anatomy.
struct SessionCardView: View {
  /// Live lookup: the card re-reads the fleet every update, so status and
  /// context stay current while the sheet is open.
  let agent: AgentSnapshot?

  var body: some View {
    VStack(spacing: 0) {
      if let agent {
        header(agent)
        Divider().overlay(FieldPalette.panelBorder)
        terminalSurface(agent)
      } else {
        endedFace
      }
    }
    .background(FieldPalette.panelBackground)
  }

  // MARK: - Header

  private func header(_ agent: AgentSnapshot) -> some View {
    let status = classifyAgentStatus(agent.state) ?? .working
    let hue = agentIdentityHue(agent.runtimeSessionID)

    return HStack(alignment: .center, spacing: 12) {
      AgentGlyph(provider: agent.provider)
        .frame(width: 28, height: 28)
        .foregroundStyle(FieldPalette.textMain)
        .opacity(0.85)

      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(agent.project)
            .font(FieldType.mono(14, .heavy))
            .foregroundStyle(FieldPalette.textMain)
          if let branch = agent.state?.branch {
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
        Text(
          "\(agent.state?.modelName ?? agent.provider.displayName)  ·  \(statusLine(agent, status))"
        )
        .font(FieldType.mono(9))
        .foregroundStyle(FieldPalette.textMuted)
        .lineLimit(1)
      }

      Spacer()

      VStack(alignment: .trailing, spacing: 3) {
        Circle()
          .fill(FieldPalette.agentColor(hue: hue))
          .frame(width: 8, height: 8)
        Text(contextText(agent))
          .font(FieldType.mono(8, .heavy))
          .monospacedDigit()
          .foregroundStyle(FieldPalette.textFaint)
      }
    }
    .padding(.horizontal, 18)
    .padding(.top, 22)
    .padding(.bottom, 14)
  }

  private func statusLine(_ agent: AgentSnapshot, _ status: AgentVisualStatus) -> String {
    let detail = agentDetail(agent.state, status: status)
    return detail == status.rawValue ? detail : "\(status.rawValue) · \(detail)"
  }

  private func contextText(_ agent: AgentSnapshot) -> String {
    guard let percent = agent.state?.contextUsedPercent else { return "CTX:--%" }
    return String(format: "CTX:%02d%%", Int(percent.rounded(.down)))
  }

  // MARK: - Terminal surface (the Ghosttea seam)

  private func terminalSurface(_ agent: AgentSnapshot) -> some View {
    ZStack {
      FieldPalette.terminalBackground

      VStack(spacing: 10) {
        Text("TERMINAL")
          .font(FieldType.mono(9, .heavy))
          .tracking(FieldType.tracking(0.18, of: 9))
          .foregroundStyle(FieldPalette.textMuted)
        Text("not connected")
          .font(FieldType.mono(12, .medium))
          .foregroundStyle(FieldPalette.textMain)
        Text("the live TUI attaches over the mesh — the truffle leg\nof this card has not landed yet")
          .font(FieldType.mono(9))
          .foregroundStyle(FieldPalette.textMuted)
          .multilineTextAlignment(.center)
          .lineSpacing(3)
        if classifyAgentStatus(agent.state) == .waiting {
          Text("waiting on a permission — approve at the desktop")
            .font(FieldType.mono(9))
            .foregroundStyle(FieldPalette.textMain)
            .padding(.top, 8)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  // MARK: - Ended

  private var endedFace: some View {
    VStack(spacing: 8) {
      Text("SESSION ENDED")
        .font(FieldType.mono(11, .heavy))
        .tracking(FieldType.tracking(0.18, of: 11))
        .foregroundStyle(FieldPalette.textMuted)
      Text("this agent left the field")
        .font(FieldType.mono(9))
        .foregroundStyle(FieldPalette.textFaint)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
