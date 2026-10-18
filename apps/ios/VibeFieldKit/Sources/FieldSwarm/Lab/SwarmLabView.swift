import FieldAgents
import FieldDesign
import SwarmPhysics
import SwiftUI
import UIKit

// The swarm design lab (D-i15): one page, the production renderer, fixture
// bodies in every state and setting. It exists so a design change is
// reviewed as the pixels the app will draw — RFC 005's review surface, on
// the phone — and it is the screenshot gate for every slice that touches a
// pixel. DEBUG only, behind `-vf-swarm-lab`.

/// Which part of the lab a launch argument asks for, so a screenshot run — which
/// cannot scroll — reaches every page: `-vf-swarm-lab=states:3`, `=burn`,
/// `=light`, `=field`, `=marks`; bare `-vf-swarm-lab` is the whole lab, scrollable.
public struct LabFocus: Equatable, Sendable {
  public var section: String
  /// 1-based; a grid section shows six stages a page.
  public var page: Int

  public init(section: String, page: Int = 1) {
    self.section = section
    self.page = max(1, page)
  }

  /// `states:2` → the second page of the states; a bare name is its first page.
  public init?(argument: String) {
    let parts = argument.split(separator: ":", maxSplits: 1).map(String.init)
    guard let section = parts.first, !section.isEmpty else { return nil }
    self.init(section: section, page: parts.count > 1 ? Int(parts[1]) ?? 1 : 1)
  }
}

public struct SwarmLabView: View {
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.dismiss) private var dismiss

  private let focus: LabFocus?

  public init(focus: LabFocus? = nil) {
    self.focus = focus
  }

  private var palette: LabPalette { LabPalette(tint: colorScheme == .dark ? .dark : .light) }

  /// A grid section shows this many stages a surface: six keep a surface
  /// under the 8192-pixel texture ceiling at 3× and fill one phone screen.
  static let pageSize = 6

  private func shows(_ section: String) -> Bool {
    focus == nil || focus?.section == section
  }

  private func pages(_ section: String, of stages: [LabStage]) -> [[LabStage]] {
    let chunks = stride(from: 0, to: stages.count, by: Self.pageSize).map {
      Array(stages[$0..<min($0 + Self.pageSize, stages.count)])
    }
    guard let focus, focus.section == section else { return chunks }
    return focus.page <= chunks.count ? [chunks[focus.page - 1]] : []
  }

  public var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) {
        header
        if shows("marks") { LabMarksSection() }
        if shows("states") {
          LabGridSection(
            title: "States", lede: "Every drawn state, one body each, at the locked sizes.",
            pages: pages("states", of: stateStages(palette: palette)), columns: 2, cellHeight: 190,
            firstIndex: ((focus?.section == "states" ? focus?.page ?? 1 : 1) - 1) * Self.pageSize)
        }
        if shows("burn") {
          LabGridSection(
            title: "The burn ladder",
            lede: "How hard a session is spending, as up to four flames on a fixed absolute ladder of estimated USD per minute — about three times the spend per step, and only as many flames as the rate has lit. Absolute, so one body’s reading means what another’s does.",
            pages: pages("burn", of: burnStages(palette: palette)), columns: 2, cellHeight: 190,
            firstIndex: ((focus?.section == "burn" ? focus?.page ?? 1 : 1) - 1) * Self.pageSize)
        }
        if shows("light") {
          LabGridSection(
            title: "The pane light, weighed",
            lede: "The open card’s light under three settings on the idle body. The field wears the first; these are fixed for comparison.",
            pages: pages("light", of: lightStages(palette: palette)), columns: 3, cellHeight: 170, firstIndex: 0)
        }
        if shows("field") {
          LabClusterSection(
            title: "The field", lede: "Eight bodies settled under centre gravity, as the swarm actually rests.",
            stages: clusterStages(palette: palette))
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 24)
    }
    .background(FieldPalette.panelBackground.ignoresSafeArea())
    .accessibilityIdentifier("swarm-lab")
  }

  private var header: some View {
    HStack(alignment: .firstTextBaseline) {
      VStack(alignment: .leading, spacing: 4) {
        Text("SWARM LAB")
          .font(FieldType.mono(11, .heavy))
          .tracking(FieldType.tracking(0.18, of: 11))
          .foregroundStyle(FieldPalette.textMain)
        Text("the reference’s fixtures on this phone’s renderer · \(colorScheme == .dark ? "dark" : "light") · motion \(reduceMotion ? "off" : "on")")
          .font(FieldType.mono(9))
          .foregroundStyle(FieldPalette.textMuted)
      }
      Spacer()
      Button("CLOSE") { dismiss() }
        .font(FieldType.mono(9, .heavy))
        .foregroundStyle(FieldPalette.textMuted)
    }
  }
}

/// A section's caption.
private struct LabLede: View {
  let title: String
  let lede: String

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(title.uppercased())
        .font(FieldType.mono(10, .heavy))
        .tracking(FieldType.tracking(0.14, of: 10))
        .foregroundStyle(FieldPalette.textMain)
      Text(lede)
        .font(FieldType.mono(9))
        .foregroundStyle(FieldPalette.textMuted)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}

/// A grid of cells, one surface a PAGE (the reference draws the whole page on
/// one canvas and asks its adapter for a bigger texture; a phone's surface
/// stays under the limit by paging), the captions laid out by SwiftUI at the
/// same rects.
private struct LabGridSection: View {
  let title: String
  let lede: String
  let pages: [[LabStage]]
  let columns: Int
  let cellHeight: CGFloat
  /// The number the first stage on the first page wears, so a focused page
  /// keeps the whole lab's numbering.
  let firstIndex: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      LabLede(title: title, lede: lede)
      ForEach(Array(pages.enumerated()), id: \.offset) { pageIndex, stages in
        LabGridPage(
          stages: stages, columns: columns, cellHeight: cellHeight,
          firstIndex: firstIndex + pageIndex * SwarmLabView.pageSize)
      }
    }
  }
}

private struct LabGridPage: View {
  let stages: [LabStage]
  let columns: Int
  let cellHeight: CGFloat
  let firstIndex: Int
  private let captionHeight: CGFloat = 64
  private let gap: CGFloat = 10

  private var rows: Int { (stages.count + columns - 1) / columns }
  private var rowHeight: CGFloat { cellHeight + captionHeight + gap }

  var body: some View {
    Group {
      GeometryReader { proxy in
        let width = proxy.size.width
        let cellWidth = (width - gap * CGFloat(columns - 1)) / CGFloat(columns)
        ZStack(alignment: .topLeading) {
          LabSurface(stages: stages) { size, index in
            let column = index % columns
            let row = index / columns
            return SIMD2(
              Double(CGFloat(column) * (cellWidth + gap) + cellWidth / 2),
              Double(CGFloat(row) * rowHeight + cellHeight / 2))
          }
          ForEach(Array(stages.enumerated()), id: \.element.id) { index, stage in
            let column = index % columns
            let row = index / columns
            VStack(alignment: .leading, spacing: 3) {
              Text("\(String(format: "%02d", firstIndex + index + 1)) · \(stage.title)")
                .font(FieldType.mono(8, .heavy))
                .foregroundStyle(FieldPalette.textMain)
              Text(stage.note)
                .font(FieldType.mono(7))
                .foregroundStyle(FieldPalette.textMuted)
                .lineLimit(5)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: cellWidth, height: captionHeight, alignment: .topLeading)
            .offset(x: CGFloat(column) * (cellWidth + gap), y: CGFloat(row) * rowHeight + cellHeight + 4)
          }
        }
      }
      .frame(height: CGFloat(rows) * rowHeight)
    }
  }
}

/// The settled cluster in one cell.
private struct LabClusterSection: View {
  let title: String
  let lede: String
  let stages: [LabStage]
  private let height: CGFloat = 420

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      LabLede(title: title, lede: lede)
      LabSurface(stages: stages, cluster: true) { _, _ in .zero }
        .frame(height: height)
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
    }
  }
}

/// The contact sheet: each agent's mark from the signed-distance atlas beside
/// the neighbours it could be confused with. The chosen one is full ink; the
/// others are dimmed.
private struct LabMarksSection: View {
  private let columns = 5
  private let cell: CGFloat = 64
  private let caption: CGFloat = 30

  var body: some View {
    let candidates = MarksAtlas.candidates
    let rows = (candidates.count + columns - 1) / columns
    VStack(alignment: .leading, spacing: 12) {
      LabLede(
        title: "Marks",
        lede: "Each agent’s mark from the signed-distance atlas, beside the neighbours it could be confused with. The chosen one is full ink; the others are dimmed.")
      GeometryReader { proxy in
        let cellWidth = proxy.size.width / CGFloat(columns)
        ZStack(alignment: .topLeading) {
          LabMarksSurface(cellWidth: cellWidth, cell: cell, caption: caption, columns: columns)
          ForEach(Array(candidates.enumerated()), id: \.element.id) { index, candidate in
            VStack(spacing: 1) {
              Text(candidate.title + (candidate.chosen ? " ✓" : ""))
                .font(FieldType.mono(7, .heavy))
                .foregroundStyle(FieldPalette.textMain)
              Text(candidate.provider.map { "for \($0)" } ?? candidate.id)
                .font(FieldType.mono(6))
                .foregroundStyle(FieldPalette.textMuted)
            }
            .lineLimit(1)
            .frame(width: cellWidth, height: caption)
            .offset(x: CGFloat(index % columns) * cellWidth, y: CGFloat(index / columns) * (cell + caption) + cell)
          }
        }
      }
      .frame(height: CGFloat(rows) * (cell + caption))
    }
  }
}

private struct LabMarksSurface: UIViewRepresentable {
  let cellWidth: CGFloat
  let cell: CGFloat
  let caption: CGFloat
  let columns: Int
  @Environment(\.colorScheme) private var colorScheme

  func makeUIView(context: Context) -> SwarmMetalView {
    let view = SwarmMetalView(theme: SwarmTheme.resolve(colorScheme))
    view.preferredFramesPerSecond = 10
    return view
  }

  func updateUIView(_ view: SwarmMetalView, context: Context) {
    let theme = SwarmTheme.resolve(colorScheme)
    view.theme = theme
    let cellWidth = cellWidth
    let cell = cell
    let caption = caption
    let columns = columns
    view.frameSource = { _, _, _ in
      let marks = MarksAtlas.candidates.enumerated().map { index, candidate in
        RenderMark(
          tile: candidate.tile, size: 40,
          x: Double(CGFloat(index % columns) * cellWidth + cellWidth / 2),
          y: Double(CGFloat(index / columns) * (cell + caption) + cell / 2),
          colour: theme.ink, alpha: candidate.chosen ? 1 : 0.4)
      }
      return ([], nil, marks)
    }
  }
}

/// One surface drawing fixture stages at the centres `place` returns (or
/// settled as a cluster), with the production model and renderer.
private struct LabSurface: UIViewRepresentable {
  let stages: [LabStage]
  var cluster = false
  let place: (CGSize, Int) -> SIMD2<Double>
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func makeUIView(context: Context) -> SwarmMetalView {
    SwarmMetalView(theme: SwarmTheme.resolve(colorScheme))
  }

  func updateUIView(_ view: SwarmMetalView, context: Context) {
    let theme = SwarmTheme.resolve(colorScheme)
    view.theme = theme
    view.motion = !reduceMotion
    let stages = stages
    let cluster = cluster
    let place = place
    let now = labNow
    let models = stages.map { stage in
      bodyModel(
        BodyModelInput(
          bubble: stage.bubble, parameters: .default, now: now, runningSince: stage.runningSince,
          workingShare: stage.workingShare))
    }
    view.frameSource = { _, _, size in
      var bodies: [RenderBody] = []
      var hold: SwarmHold?
      let positions =
        cluster
        ? settleCluster(radii: models.map(\.radius), width: Double(size.width), height: Double(size.height))
        : stages.indices.map { place(size, $0) }
      for (index, stage) in stages.enumerated() {
        let model = models[index]
        let position = positions[index]
        if stage.hold {
          hold = SwarmHold(x: position.x, y: position.y, progress: 1)
          continue
        }
        bodies.append(
          RenderBody(
            model: model, x: position.x, y: position.y, radius: model.radius, scale: 1, opacity: 1,
            focus: stage.focus, seed: Double(stage.id.count) * 0.7, accent: model.accent ?? theme.neutral,
            mounted: model.mounted, glow: stage.glow))
      }
      return (bodies, hold, [])
    }
  }
}
