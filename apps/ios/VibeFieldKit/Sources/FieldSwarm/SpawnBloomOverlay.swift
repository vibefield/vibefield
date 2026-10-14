import FieldDesign
import QuartzCore
import SwiftUI
import UIKit

// PJ-7 — the spawn bloom, drawn over the field (DESIGN.md §8 "Hold, reach,
// let go", its phone paragraph): the veil, the hub, ring one's buds (each
// desktop's OS mark, or a profile's glyph), ring two's, their words above, and
// the huge words. The state is `SpawnBloom`'s; this file draws it and feels it.

/// What the field offers a hold: the desktops (their profiles when read) and the home.
public struct BloomMenu: Equatable, Sendable {
  public let desktops: [BloomDesktop]
  public let home: String?

  public init(desktops: [BloomDesktop], home: String?) {
    self.desktops = desktops
    self.home = home
  }
}

/// The bloom's host on the field: opens it when the hold completes, feeds it
/// the finger, feels the moments, and hands the choice on.
@MainActor
@Observable
final class BloomHost {
  var bloom: SpawnBloom?
  @ObservationIgnored var menu: BloomMenu?
  @ObservationIgnored var field = BloomSize(w: 0, h: 0)
  @ObservationIgnored var chrome: [BloomRect] = []
  @ObservationIgnored private let impact = UIImpactFeedbackGenerator(style: .soft)
  @ObservationIgnored private let selection = UISelectionFeedbackGenerator()

  /// The hold completed: a bloom opens (true), or nothing blooms and the hold
  /// creates as before (false).
  func hold(at point: SIMD2<Double>) -> Bool {
    guard let menu,
      let bloom = SpawnBloom(
        at: BloomPoint(x: point.x, y: point.y), desktops: menu.desktops, home: menu.home, field: field,
        chrome: chrome, measure: Self.measure)
    else { return false }
    self.bloom = bloom
    impact.impactOccurred()
    selection.prepare()
    return true
  }

  func move(to point: SIMD2<Double>) {
    guard var bloom else { return }
    if bloom.point(BloomPoint(x: point.x, y: point.y), now: CACurrentMediaTime() * 1000) == .tick {
      selection.selectionChanged()
    }
    self.bloom = bloom
  }

  /// Letting go: the choice, and the bloom closes either way.
  func release() -> BloomChoice? {
    defer { bloom = nil }
    return bloom?.release()
  }

  /// A bud's words measured in their own type (DESIGN.md §8: the name 9.5 pt
  /// mono 700, the state line 7.5 pt mono 800).
  static let measure: BloomMeasure = { text, font in
    let ui =
      font == .label
      ? UIFont.monospacedSystemFont(ofSize: 9.5, weight: .bold)
      : UIFont.monospacedSystemFont(ofSize: 7.5, weight: .heavy)
    return Double((text as NSString).size(withAttributes: [.font: ui]).width)
  }
}

struct SpawnBloomOverlay: View {
  let bloom: SpawnBloom
  let size: CGSize
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var appeared = false

  private var P: CGPoint { CGPoint(x: bloom.P.x, y: bloom.P.y) }

  var body: some View {
    ZStack(alignment: .topLeading) {
      FieldPalette.panelBackground.opacity(BloomConstants.veil)
        .frame(width: size.width, height: size.height)
      Circle()
        .strokeBorder(FieldPalette.textMain.opacity(0.5), lineWidth: 1.5)
        .frame(width: BloomConstants.hubR * 2, height: BloomConstants.hubR * 2)
        .position(P)
      ForEach(Array(bloom.one.items.enumerated()), id: \.offset) { index, item in
        bud(index: index, item: item, ring: 1)
      }
      if let two = bloom.two, let open = bloom.open {
        ForEach(Array(two.items.enumerated()), id: \.offset) { index, item in
          bud(index: index, item: item, ring: 2, from: CGPoint(x: bloom.one.items[open].x, y: bloom.one.items[open].y))
        }
      }
      words
    }
    .frame(width: size.width, height: size.height, alignment: .topLeading)
    .allowsHitTesting(false)
    .onAppear {
      if reduceMotion {
        withAnimation(.easeOut(duration: 0.09)) { appeared = true }
      } else {
        appeared = true
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(bloom.words.nounFirst ? "\(bloom.words.noun)\(bloom.words.verb)" : "\(bloom.words.verb)\(bloom.words.noun)")
    .accessibilityAddTraits(.updatesFrequently)
  }

  // MARK: A bud

  private func isHot(_ ring: Int, _ index: Int) -> Bool {
    switch bloom.target {
    case .ring1(let i, _): ring == 1 && i == index
    case .ring2(let i): ring == 2 && i == index
    default: false
    }
  }

  @ViewBuilder
  private func bud(index: Int, item: BloomGeometry.ArcItem, ring: Int, from: CGPoint? = nil) -> some View {
    let d = ring == 1 ? BloomConstants.bud1 : BloomConstants.bud2
    let hot = isHot(ring, index)
    let asleep = ring == 1 && bloom.mode == .desktops && bloom.desktops[index].asleep
    let dimmed = ring == 1 && bloom.open != nil && bloom.open != index
    let open = ring == 1 && bloom.open == index
    let origin = from ?? P
    let at = appeared || reduceMotion ? CGPoint(x: item.x, y: item.y) : origin
    let rank = Double(Self.centreFirst(ring == 1 ? bloom.one.items.count : (bloom.two?.items.count ?? 0)).firstIndex(of: index) ?? 0)
    ZStack {
      Circle()
        .fill(hot ? FieldPalette.textMain : FieldPalette.bloomBud)
      Circle()
        .strokeBorder(
          FieldPalette.textMain.opacity(open ? 1 : 0.22),
          style: StrokeStyle(lineWidth: open ? 2 : 1.25, dash: asleep ? [3, 3] : []))
      face(index: index, ring: ring, hot: hot)
    }
    .frame(width: d, height: d)
    .opacity(asleep ? 0.45 : dimmed ? 0.62 : 1)
    .scaleEffect(hot && !reduceMotion ? BloomConstants.hot : dimmed && !reduceMotion ? 0.9 : 1)
    .position(at)
    .animation(
      reduceMotion ? .easeOut(duration: 0.09) : .timingCurve(0.34, 1.45, 0.64, 1, duration: BloomConstants.pop / 1000)
        .delay(rank * BloomConstants.stagger / 1000), value: appeared)
    .animation(reduceMotion ? nil : .timingCurve(0.2, 0.9, 0.3, 1.2, duration: BloomConstants.lift / 1000), value: hot)
    label(item: item, index: index, ring: ring, dimmed: dimmed)
      .opacity(appeared ? (dimmed ? 0.58 : 1) : 0)
      .animation(
        reduceMotion ? .easeOut(duration: 0.09) : .easeOut(duration: 0.18).delay(rank * BloomConstants.stagger / 1000 + BloomConstants.reveal / 1000),
        value: appeared)
  }

  @ViewBuilder
  private func face(index: Int, ring: Int, hot: Bool) -> some View {
    let ink = hot ? FieldPalette.bloomBud : FieldPalette.textMain
    if ring == 1 && bloom.mode == .desktops {
      DeviceMark(platform: bloom.desktops[index].platform, size: 20).foregroundStyle(ink)
    } else {
      let profile =
        ring == 1 ? bloom.desktops[0].profiles[index] : bloom.open.map { bloom.desktops[$0].profiles[index] }
      Image(systemName: Self.symbol(profile))
        .font(.system(size: 15, weight: profile?.isDefault == true ? .bold : .regular))
        .foregroundStyle(ink)
    }
  }

  /// A profile's glyph: its own when the system has it, the person otherwise.
  static func symbol(_ profile: BloomProfile?) -> String {
    guard let glyph = profile?.glyph, UIImage(systemName: glyph) != nil else {
      return profile?.id == "native" ? "laptopcomputer" : "person.crop.circle"
    }
    return glyph
  }

  /// The words above a bud: the name over its state line, at the box the
  /// geometry seated them in.
  private func label(item: BloomGeometry.ArcItem, index: Int, ring: Int, dimmed: Bool) -> some View {
    let text: BloomLabelText =
      ring == 1
      ? bloom.label(one: index)
      : BloomLabelText(name: bloom.open.map { bloom.desktops[$0].profiles[index].label.uppercased() } ?? "")
    let alignment: HorizontalAlignment =
      item.label.align == .left ? .leading : item.label.align == .right ? .trailing : .center
    return VStack(alignment: alignment, spacing: 1) {
      Text(text.name)
        .font(FieldType.mono(9.5, .bold))
        .tracking(0.57)
        .foregroundStyle(FieldPalette.textMain.opacity(0.78))
      if let sub = text.sub, !sub.isEmpty, !item.short {
        Text(sub)
          .font(FieldType.mono(7.5, .heavy))
          .tracking(0.75)
          .foregroundStyle(FieldPalette.textMuted)
      }
    }
    .lineLimit(1)
    .fixedSize()
    .frame(width: item.label.w, height: item.label.h, alignment: Alignment(horizontal: alignment, vertical: .center))
    .position(x: item.label.x + item.label.w / 2, y: item.label.y + item.label.h / 2)
  }

  // MARK: The words

  private var words: some View {
    let words = bloom.words
    let top = bloom.P.y > Double(size.height) / 2
    let sayMax = min(72, max(size.width, size.height) * 0.066)
    let verb = Text(words.verb).foregroundStyle(FieldPalette.textMain.opacity(0.4))
    let noun = Text(words.noun).foregroundStyle(FieldPalette.textMain.opacity(words.cancels ? 0.5 : 1))
    return VStack(spacing: 8) {
      (words.nounFirst ? noun + verb : verb + noun)
        .font(.system(size: sayMax, weight: .heavy))
        .tracking(-0.04 * sayMax)
        .lineLimit(2)
        .minimumScaleFactor(22 / sayMax)
        .multilineTextAlignment(.center)
      Text(words.detail)
        .font(FieldType.mono(11, .bold))
        .tracking(1.1)
        .foregroundStyle(FieldPalette.textMuted)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
    .padding(.horizontal, 24)
    .frame(width: size.width)
    .position(x: size.width / 2, y: top ? 150 : size.height - 230)
    .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: words)
  }

  /// Indices of `n` items, centre first (the buds' order out of the hub).
  static func centreFirst(_ n: Int) -> [Int] {
    (0..<n).sorted { abs(Double($0) - Double(n - 1) / 2) < abs(Double($1) - Double(n - 1) / 2) }
  }
}
