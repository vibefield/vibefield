import FieldDesign
import SwiftUI

/// The mesh chip: a quiet top-corner fact the bubbles physically flow
/// around. Attention is contrast — when the mesh needs the user (sign-in),
/// the chip inverts; otherwise it stays a muted instrument marking.
public struct MeshChip: View {
  private let state: MeshModel.State
  private let peerCount: Int
  private let onTap: () -> Void

  public init(state: MeshModel.State, peerCount: Int, onTap: @escaping () -> Void) {
    self.state = state
    self.peerCount = peerCount
    self.onTap = onTap
  }

  public var body: some View {
    let wantsAttention = MeshDisplay.chipWantsAttention(state: state)
    Button(action: onTap) {
      Text(MeshDisplay.chipLabel(state: state, peerCount: peerCount))
        .font(FieldType.mono(9, .heavy))
        .tracking(FieldType.tracking(0.08, of: 9))
        .monospacedDigit()
        .foregroundStyle(chipText(wantsAttention: wantsAttention))
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(
          RoundedRectangle(cornerRadius: 6)
            .fill(wantsAttention ? FieldPalette.textMain : FieldPalette.panelBackground.opacity(0.8))
        )
        .overlay(
          RoundedRectangle(cornerRadius: 6)
            .strokeBorder(FieldPalette.panelBorder, lineWidth: 1)
        )
    }
    .buttonStyle(.plain)
    .accessibilityLabel(MeshDisplay.statusLine(state: state, peerCount: peerCount))
  }

  private func chipText(wantsAttention: Bool) -> Color {
    if wantsAttention { return FieldPalette.panelBackground }
    switch state {
    case .off, .starting, .stopping, .failed: return FieldPalette.textMuted
    default: return FieldPalette.textMain
    }
  }
}

/// The mesh sheet: state verbatim, one primary act, and the online roster.
public struct MeshSheet: View {
  private let model: MeshModel

  public init(model: MeshModel) {
    self.model = model
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("MESH")
        .font(FieldType.mono(9, .heavy))
        .tracking(FieldType.tracking(0.18, of: 9))
        .foregroundStyle(FieldPalette.textFaint)
        .padding(.top, 24)

      Text(MeshDisplay.statusLine(state: model.state, peerCount: model.peers.count))
        .font(FieldType.mono(12, .medium))
        .foregroundStyle(FieldPalette.textMain)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 8)

      if let action = MeshDisplay.primaryAction(state: model.state) {
        Button {
          perform(action)
        } label: {
          Text(action.rawValue)
            .font(FieldType.mono(9, .heavy))
            .tracking(FieldType.tracking(0.08, of: 9))
            .foregroundStyle(actionForeground(action))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(
              RoundedRectangle(cornerRadius: 6).fill(actionBackground(action))
            )
            .overlay(
              RoundedRectangle(cornerRadius: 6)
                .strokeBorder(FieldPalette.panelBorder, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .padding(.top, 16)
      }

      Text("ONLINE PEERS")
        .font(FieldType.mono(8, .heavy))
        .tracking(FieldType.tracking(0.12, of: 8))
        .foregroundStyle(FieldPalette.textFaint)
        .padding(.top, 28)

      if model.peers.isEmpty {
        Text(peersEmptyLine)
          .font(FieldType.mono(10))
          .foregroundStyle(FieldPalette.textFaint)
          .padding(.top, 10)
      } else {
        ScrollView {
          VStack(alignment: .leading, spacing: 12) {
            ForEach(model.peers) { peer in
              VStack(alignment: .leading, spacing: 2) {
                Text(peer.name)
                  .font(FieldType.mono(12, .medium))
                  .foregroundStyle(FieldPalette.textMain)
                if let address = peer.address {
                  Text(address)
                    .font(FieldType.mono(9))
                    .monospacedDigit()
                    .foregroundStyle(FieldPalette.textFaint)
                }
              }
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.top, 10)
        }
      }

      Spacer(minLength: 16)
    }
    .padding(.horizontal, 22)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    // Transparent: the sheet's liquid glass is the surface.
  }

  private var peersEmptyLine: String {
    switch model.state {
    case .up: "nobody else is online right now"
    default: "peers appear once the mesh is up"
    }
  }

  private func perform(_ action: MeshDisplay.Action) {
    switch action {
    case .connect: model.connect()
    case .disconnect: model.disconnect()
    case .signIn: model.requestLogin()
    }
  }

  private func actionForeground(_ action: MeshDisplay.Action) -> Color {
    action == .signIn ? FieldPalette.panelBackground : FieldPalette.textMain
  }

  private func actionBackground(_ action: MeshDisplay.Action) -> Color {
    action == .signIn ? FieldPalette.textMain : FieldPalette.panelBackground
  }
}
