import FieldDesign
import SwiftUI

/// WI-2 — the drawings that stand on the way in's words line in the mark's place (DESIGN.md §8 "The phone's way
/// in"): a computer, waiting or naming the desktop that sent you, and How it works' four pictures. Drawn in the
/// ink, with one session in the attention orange, as the Field shows a session that needs you (§2.5). The
/// geometry is the design page's own (The Way In, 2026-11-02), in points.
struct WayInArt: View {
  let art: FieldHomeModel.WayInScreen.Art

  var body: some View {
    switch art {
    case .computerWaiting: computer(empty: true, inner: nil)
    case .desktop(let name): computer(empty: false, inner: .name(name))
    case .tour(0): computer(empty: false, inner: .agents)
    case .tour(1): phoneOverTerminal
    case .tour(2): privateLink
    case .tour: computer(empty: false, inner: .site)
    }
  }

  private enum Inner {
    case name(String)
    case agents
    case site
  }

  private static let ink = ChromePalette.ink

  /// A computer, 192 × 128: its screen and its base; dashed while it waits to be filled.
  private func computer(empty: Bool, inner: Inner?) -> some View {
    Canvas { context, _ in
      let dash: [CGFloat] = empty ? [5, 5] : []
      var screen = context
      screen.opacity = empty ? 0.75 : 1
      screen.stroke(
        Path(roundedRect: CGRect(x: 26, y: 14, width: 140, height: 92), cornerRadius: 9),
        with: .color(Self.ink), style: StrokeStyle(lineWidth: 2, dash: dash))
      var base = Path()
      base.move(to: CGPoint(x: 10, y: 114))
      base.addLine(to: CGPoint(x: 182, y: 114))
      screen.stroke(base, with: .color(Self.ink), style: StrokeStyle(lineWidth: 2.4, lineCap: .round, dash: dash))
      switch inner {
      case .name(let name):
        context.draw(
          Text(name).font(ChromeType.sans(13, .semibold)).foregroundColor(Self.ink), at: CGPoint(x: 96, y: 64))
      case .agents:
        // four sessions; the small one in orange needs you
        let bodies: [(CGFloat, CGFloat, CGFloat, String, Bool)] = [
          (58, 52, 20, "Claude\nCode", false), (104, 44, 15, "Codex", false), (134, 66, 13, "", true),
          (86, 74, 12, "", false),
        ]
        for (x, y, r, label, needsYou) in bodies {
          let circle = Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
          if needsYou {
            context.fill(circle, with: .color(ChromePalette.attention))
          } else {
            var ring = context
            ring.opacity = 0.9
            ring.stroke(circle, with: .color(Self.ink), lineWidth: 1.6)
          }
          if !label.isEmpty {
            context.draw(
              Text(label).font(ChromeType.mono(7.5, .bold)).foregroundColor(Self.ink),
              at: CGPoint(x: x, y: y))
          }
        }
      case .site:
        context.stroke(
          Path(roundedRect: CGRect(x: 44, y: 50, width: 104, height: 22), cornerRadius: 11), with: .color(Self.ink),
          lineWidth: 1.5)
        context.draw(
          Text("vibefield.dev").font(ChromeType.sans(10.5, .semibold)).foregroundColor(Self.ink),
          at: CGPoint(x: 96, y: 61))
        var arrow = Path()
        arrow.move(to: CGPoint(x: 96, y: 80))
        arrow.addLine(to: CGPoint(x: 96, y: 94))
        arrow.move(to: CGPoint(x: 90, y: 88))
        arrow.addLine(to: CGPoint(x: 96, y: 94))
        arrow.addLine(to: CGPoint(x: 102, y: 88))
        context.stroke(
          arrow, with: .color(Self.ink), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
      case nil:
        break
      }
    }
    .frame(width: 192, height: 128)
  }

  /// How it works · 2, 192 × 138: the phone's Field, one session orange, and under it that session's own
  /// terminal with a reply typed.
  private var phoneOverTerminal: some View {
    Canvas { context, _ in
      let ink = GraphicsContext.Shading.color(Self.ink)
      context.stroke(Path(roundedRect: CGRect(x: 66, y: 4, width: 60, height: 128), cornerRadius: 14), with: ink, lineWidth: 2)
      var island = context
      island.opacity = 0.9
      island.fill(Path(roundedRect: CGRect(x: 84, y: 9, width: 24, height: 6), cornerRadius: 3), with: ink)
      context.stroke(Path(ellipseIn: CGRect(x: 72, y: 25, width: 16, height: 16)), with: ink, lineWidth: 1.4)
      context.stroke(Path(ellipseIn: CGRect(x: 73.5, y: 48.5, width: 11, height: 11)), with: ink, lineWidth: 1.4)
      context.fill(Path(ellipseIn: CGRect(x: 92, y: 28, width: 24, height: 24)), with: .color(ChromePalette.attention))
      context.stroke(Path(roundedRect: CGRect(x: 72, y: 68, width: 48, height: 54), cornerRadius: 7), with: ink, lineWidth: 1.5)
      var lines = context
      lines.opacity = 0.35
      for (y, width) in [(CGFloat(76), CGFloat(28)), (83, 35), (90, 22)] {
        lines.fill(Path(roundedRect: CGRect(x: 78, y: y, width: width, height: 3), cornerRadius: 1.5), with: ink)
      }
      context.draw(
        Text("› y").font(ChromeType.mono(10, .bold)).foregroundColor(Self.ink),
        at: CGPoint(x: 78, y: 107), anchor: .leading)
      context.fill(Path(roundedRect: CGRect(x: 97, y: 102.5, width: 5, height: 10), cornerRadius: 1), with: ink)
    }
    .frame(width: 192, height: 138)
  }

  /// How it works · 3, 232 × 120: your computer and your phone, a private link between them, locked.
  private var privateLink: some View {
    Canvas { context, _ in
      let ink = GraphicsContext.Shading.color(Self.ink)
      context.stroke(Path(roundedRect: CGRect(x: 6, y: 20, width: 96, height: 62), cornerRadius: 7), with: ink, lineWidth: 2)
      var base = Path()
      base.move(to: CGPoint(x: 0, y: 90))
      base.addLine(to: CGPoint(x: 108, y: 90))
      context.stroke(base, with: ink, style: StrokeStyle(lineWidth: 2.2, lineCap: .round))
      context.stroke(Path(roundedRect: CGRect(x: 184, y: 16, width: 40, height: 84), cornerRadius: 10), with: ink, lineWidth: 2)
      context.fill(Path(roundedRect: CGRect(x: 197, y: 20, width: 14, height: 4), cornerRadius: 2), with: ink)
      var link = Path()
      link.move(to: CGPoint(x: 112, y: 56))
      link.addLine(to: CGPoint(x: 178, y: 56))
      context.stroke(link, with: ink, style: StrokeStyle(lineWidth: 1.8, lineCap: .round, dash: [3, 5]))
      // the lock, at (133, 42)
      context.stroke(
        Path(roundedRect: CGRect(x: 135, y: 51, width: 20, height: 15), cornerRadius: 3.5), with: ink, lineWidth: 1.8)
      var shackle = Path()
      shackle.move(to: CGPoint(x: 139.5, y: 51))
      shackle.addLine(to: CGPoint(x: 139.5, y: 48.4))
      shackle.addArc(
        center: CGPoint(x: 145, y: 48.4), radius: 5.5, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
      shackle.addLine(to: CGPoint(x: 150.5, y: 51))
      context.stroke(shackle, with: ink, lineWidth: 1.8)
    }
    .frame(width: 232, height: 120)
  }
}
