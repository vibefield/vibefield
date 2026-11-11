import FieldDesign
import SwiftUI

/// IOS-10c — how the home desktop's page draws an agent's mark. Settings knows no vendor glyph (AR-L1): the drawn
/// glyphs are FieldHome's (`AgentGlyph`, the asset catalog's two since LP-4), so the home hands its drawing in through
/// the environment. Without one, the agent's letter stands in History's recipe (`AgentMark`), so a mark is never
/// blank.
public struct SettingsAgentMark: Sendable {
  public let draw: @MainActor @Sendable (String) -> AnyView

  public init(_ draw: @escaping @MainActor @Sendable (String) -> AnyView) {
    self.draw = draw
  }
}

private struct SettingsAgentMarkKey: EnvironmentKey {
  static let defaultValue: SettingsAgentMark? = nil
}

extension EnvironmentValues {
  /// The home's drawing of an agent's mark, by the catalog's mark key; nil draws the agent's letter.
  public var settingsAgentMark: SettingsAgentMark? {
    get { self[SettingsAgentMarkKey.self] }
    set { self[SettingsAgentMarkKey.self] = newValue }
  }
}

/// An agent's mark on its 28 tile: History's `AgentMark` recipe at 28 (the fill's rounded square at 0.28 of the side,
/// the strong rule's hairline, the letter at 0.62 in the ink), at full strength, with the home's drawn glyph inside
/// where it hands one in. Hidden from VoiceOver: the row says the agent's name.
struct SettingsAgentMarkTile: View {
  let mark: String
  let name: String
  @Environment(\.settingsAgentMark) private var drawing

  private static let side: CGFloat = 28
  private static let glyphInset: CGFloat = 5

  var body: some View {
    let tile = RoundedRectangle(cornerRadius: Self.side * 0.28, style: .continuous)
    Group {
      if let drawing {
        drawing.draw(mark)
          .padding(Self.glyphInset)
      } else {
        Text(name.prefix(1).uppercased())
          .font(.system(size: Self.side * 0.62, weight: .bold, design: .rounded))
      }
    }
    .foregroundStyle(ChromePalette.ink)
    .frame(width: Self.side, height: Self.side)
    .background(tile.fill(ChromePalette.fill))
    .overlay(tile.strokeBorder(ChromePalette.ruleStrong, lineWidth: 0.5))
    .accessibilityHidden(true)
  }
}
