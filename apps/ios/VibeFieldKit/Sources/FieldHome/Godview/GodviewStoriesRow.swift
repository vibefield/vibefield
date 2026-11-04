import FieldDesign
import SwiftUI

// PG-4t — THE STORIES ROW ON THE FIELD PAGE (DESIGN.md §8 "The phone's Stories row"; James ruled J-S1 A, J-S2 (ii),
// J-S3 drop and J-S4 accept): Godview's head, carried to the phone. A frame piece over the stage and its overlays,
// outside the swarm: it never moves when the view changes; only its ring does. Kit only: it wears the chrome palette
// and the bar's glass. Its numbers are `GodviewStories`', its marks `GodviewViewMarks`', its name `GodviewStorySaying`.

/// One glass circle per view the phone has, centred; the current one ringed; the name said under a tapped one.
struct GodviewStoriesRow: View {
  /// The views the row draws (`GodviewViewChoice.shown`), in the registry's order.
  let views: [GodviewViewChoice]
  /// The view the stage stands on: its circle wears the ring.
  let current: GodviewViewChoice
  /// The name said, if any (HS's; its deadline is HS's task).
  let saying: GodviewStorySaying
  /// A still: nothing moves.
  let isStill: Bool
  /// A circle tapped.
  let onPick: @MainActor (GodviewViewChoice) -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  /// Reduced motion or a still: the ring and the name change at once.
  private var quiet: Bool { reduceMotion || isStill }

  var body: some View {
    // Spacing 0: the circles stand apart and never melt (the bar's rule: under the gap between them).
    GlassGroup(spacing: 0) {
      HStack(spacing: GodviewStories.gap) {
        ForEach(views, id: \.self) { view in circle(view) }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Views")
  }

  /// A circle: the view's mark in the bar's ink, in the bar's glass; the ring when it is current; its name under it.
  private func circle(_ view: GodviewViewChoice) -> some View {
    let face = view.face
    let name = GodviewStories.name(label: face.label)
    let isCurrent = view == current
    return Button {
      onPick(view)
    } label: {
      mark(face)
        .frame(width: GodviewStories.circle, height: GodviewStories.circle)
        .overlay {
          // J-S2 (ii): the ring IS the circle's edge, 2 inside its 44; nothing grows, shifts or clips.
          Circle()
            .strokeBorder(ChromePalette.ink, lineWidth: GodviewStories.ring)
            .opacity(isCurrent ? 1 : 0)
            .animation(quiet ? nil : FieldMotion.plainEase(GodviewStories.ringFade), value: isCurrent)
        }
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .liquidGlassCircle()
    .overlay(alignment: .top) { nameLabel(name, for: view) }
    .accessibilityLabel("\(name) view")
    .accessibilityAddTraits(isCurrent ? .isSelected : [])
    .accessibilityShowsLargeContentViewer {
      Label {
        Text(name)
      } icon: {
        mark(face)
      }
    }
  }

  /// The manifest's mark, one shape in the bar's ink in a 22 box; a view whose manifest draws none, its label's
  /// initial in the name's type.
  @ViewBuilder
  private func mark(_ face: GodviewViewFace) -> some View {
    if face.paths.isEmpty {
      Text(String(face.label.prefix(1)))
        .font(ChromeType.sans(GodviewStories.labelSize, .medium))
        .foregroundStyle(ChromePalette.ink)
    } else {
      ChromePalette.ink
        .frame(width: GodviewStories.markBox, height: GodviewStories.markBox)
        .mask { GodviewMark(face: face) }
    }
  }

  /// The name, said under its circle: solid chrome, the strong hairline, the island shadow. It enters 3 down into
  /// place and leaves in a fade; another circle's name takes the place at once, so there is never two.
  private func nameLabel(_ name: String, for view: GodviewViewChoice) -> some View {
    let said = saying.view
    return ZStack {
      if said == view {
        Text(name)
          .font(ChromeType.sans(GodviewStories.labelSize, .medium))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
          .padding(.horizontal, GodviewStories.labelPad)
          .frame(height: GodviewStories.labelHeight)
          .background {
            RoundedRectangle(cornerRadius: GodviewStories.labelCorner, style: .continuous)
              .fill(ChromePalette.paper)
              .shadow(
                color: ChromeShadow.island.color, radius: ChromeShadow.island.radius, y: ChromeShadow.island.y)
          }
          .overlay {
            // the strong hairline, a 1 ring outside the pill (`0 0 0 1px`)
            RoundedRectangle(cornerRadius: GodviewStories.labelCorner + 0.5, style: .continuous)
              .stroke(ChromePalette.ruleStrong, lineWidth: 1)
              .padding(-0.5)
          }
          .fixedSize()
          .transition(
            .asymmetric(
              insertion: .opacity.combined(with: .offset(y: -GodviewStories.labelDrop)), removal: .opacity))
      }
    }
    .offset(y: GodviewStories.circle + GodviewStories.labelGap)
    // One name, never two: when another circle's name is said, this one goes at once.
    .transaction { transaction in
      if let said, said != view { transaction.animation = nil }
    }
    .animation(quiet ? nil : FieldMotion.plainEase(GodviewStories.labelFade), value: saying)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
