import FieldAgents
import FieldSwarm
import SwiftUI

// PG-7 — THE SPEND VIEW'S INKS ON THE PHONE (kit-only: the swarm's resolved theme is UIKit's). RED SKELETON (pair 5).

struct SpendInks: Equatable, Sendable {
  let dark: Bool
  let ground: SwarmColor
  let ink: SwarmColor
  let orange: SwarmColor
  let blue: SwarmColor
  let orangeInk: SwarmColor
  let blueInk: SwarmColor
  let greenInk: SwarmColor
  let panel: SwarmColor
  let muted: SwarmColor
  let faint: SwarmColor

  static let deep = SwarmColor.transparent

  init(theme: SwarmTheme, skin: GodviewSkin) {
    dark = false
    ground = .transparent
    ink = .transparent
    orange = .transparent
    blue = .transparent
    orangeInk = .transparent
    blueInk = .transparent
    greenInk = .transparent
    panel = .transparent
    muted = .transparent
    faint = .transparent
  }

  func base(_ dealt: SwarmColor?) -> SwarmColor { .transparent }
}
