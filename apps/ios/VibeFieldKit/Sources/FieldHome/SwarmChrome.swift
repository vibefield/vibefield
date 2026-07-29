import SwiftUI

/// The field's named coordinate space — gestures, bubbles, and chrome
/// obstacles all speak it.
enum SwarmSpace {
  static let name = "swarm-field"
}

/// Frames (in field space) that floating chrome contributes as physics
/// obstacles — bubbles flow around them, exactly like the desktop's
/// account-usage panel.
struct SwarmObstacleFramesKey: PreferenceKey {
  static let defaultValue: [CGRect] = []

  static func reduce(value: inout [CGRect], nextValue: () -> [CGRect]) {
    value.append(contentsOf: nextValue())
  }
}

extension View {
  /// Marks a chrome element inside `SwarmFieldView`'s chrome slot as a
  /// physics obstacle: the swarm nestles around its frame.
  public func swarmObstacle() -> some View {
    background(
      GeometryReader { proxy in
        Color.clear.preference(
          key: SwarmObstacleFramesKey.self,
          value: [proxy.frame(in: .named(SwarmSpace.name))])
      }
    )
  }
}
