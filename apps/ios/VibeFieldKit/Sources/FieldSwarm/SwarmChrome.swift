import SwiftUI

/// The field's named coordinate space — gestures, bodies, and chrome
/// obstacles all speak it.
public enum SwarmSpace {
  public static let name = "swarm-field"
}

/// Frames (in field space) that floating chrome contributes as physics
/// obstacles — bubbles flow around them, exactly like the desktop's
/// chrome elements.
public struct SwarmObstacleFramesKey: PreferenceKey {
  public static let defaultValue: [CGRect] = []

  public static func reduce(value: inout [CGRect], nextValue: () -> [CGRect]) {
    value.append(contentsOf: nextValue())
  }
}

extension View {
  /// Marks a chrome element inside the field's chrome slot as a physics
  /// obstacle: the swarm nestles around its frame.
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
