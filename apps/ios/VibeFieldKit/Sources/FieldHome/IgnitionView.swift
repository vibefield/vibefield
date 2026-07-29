import FieldDesign
import SwiftUI

/// The ignition layer of an actively-working bubble: a breathing core glow
/// plus 24 ember particles drifting upward through the circle.
///
/// Particle trajectories are the desktop's exactly — the same
/// `sin`-hash noise assigns each particle its angle, stagger, travel and
/// size, and positions are computed analytically per frame in one Canvas,
/// which also reproduces the CSS negative-delay trick (particles are born
/// mid-flight, so ignition never starts in lockstep).
struct IgnitionView: View {
  let color: Color
  let diameter: CGFloat

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private struct Particle {
    let angle: Double  // radians
    let phaseOffset: Double  // seconds already elapsed at t=0 (CSS negative delay)
    let distance: Double
    let duration: Double
    let size: Double
  }

  private static let particles: [Particle] = (0..<24).map { index in
    Particle(
      angle: particleNoise(index, 0) * 2 * .pi,
      phaseOffset: particleNoise(index, 1) * 2.2,
      distance: 24 + particleNoise(index, 2) * 34,
      duration: 1.05 + particleNoise(index, 3) * 1.35,
      size: 2 + particleNoise(index, 4) * 1.5)
  }

  /// Desktop `particleNoise`: fract(sin((i+1)·12.9898 + (c+1)·78.233)·43758.5453).
  private static func particleNoise(_ index: Int, _ channel: Int) -> Double {
    let value =
      sin(Double(index + 1) * 12.9898 + Double(channel + 1) * 78.233) * 43758.5453
    return value - value.rounded(.down)
  }

  var body: some View {
    if reduceMotion {
      // CSS reduced-motion fallback: a still, present glow.
      glowCircle(opacity: 0.18, scale: 0.72)
    } else {
      TimelineView(.animation) { context in
        let time = context.date.timeIntervalSinceReferenceDate
        // Core glow: 1.5 s ease-in-out breath, opacity 0.1↔0.44, scale 0.35↔1.
        let breath = 0.5 - 0.5 * cos(2 * .pi * time / 1.5)
        ZStack {
          glowCircle(
            opacity: 0.10 + (0.44 - 0.10) * breath,
            scale: 0.35 + (1.0 - 0.35) * breath)

          Canvas { canvas, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            for particle in Self.particles {
              let phase =
                ((time + particle.phaseOffset).truncatingRemainder(dividingBy: particle.duration))
                / particle.duration
              let eased = easeOut(phase)
              // CSS: rotate(angle → angle+20°) translateY(0 → −distance),
              // scale 0.65 → 0.
              let angle = particle.angle + (20.0 / 180.0 * .pi) * eased
              let travel = particle.distance * eased
              let position = CGPoint(
                x: center.x + sin(angle) * travel,
                y: center.y - cos(angle) * travel)
              let fade: Double =
                phase < 0.12 ? (0.95 * phase / 0.12) : 0.95 * (1 - (phase - 0.12) / 0.88)
              let dotSize = particle.size * (0.65 * (1 - eased))
              guard dotSize > 0.1 else { continue }
              let rect = CGRect(
                x: position.x - dotSize / 2, y: position.y - dotSize / 2,
                width: dotSize, height: dotSize)
              canvas.fill(Path(ellipseIn: rect), with: .color(color.opacity(fade)))
            }
          }
        }
        .clipShape(Circle())
      }
    }
  }

  private func glowCircle(opacity: Double, scale: Double) -> some View {
    Circle()
      .fill(color)
      .frame(width: diameter * 0.72, height: diameter * 0.72)
      .scaleEffect(scale)
      .blur(radius: 13)
      .opacity(opacity)
      .frame(width: diameter, height: diameter)
  }

  /// The particle timing curve (`cubic-bezier(0.2, 0.8, 0.2, 1)`), close
  /// enough as a cubic ease-out for 3 pt embers.
  private func easeOut(_ t: Double) -> Double {
    1 - pow(1 - t, 3)
  }
}
