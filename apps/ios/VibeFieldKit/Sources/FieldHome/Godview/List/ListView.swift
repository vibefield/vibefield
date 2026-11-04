import FieldAgents
import FieldDesign
import FieldProduct
import SwiftUI

// PG-5 — THE LIST, DRAWN: puppeteer-views 0.3.3's list (`52d09c8e`: `AgentList.tsx` `e79fc53d` :37-204, `list.css`
// `e79fc53d` :1-227) on the phone, over `ListModel` (the words) and `ListPaint` (the numbers and the inks). The view
// stands in `GodviewStage.framed` (a FLOW stage, PG-4t: from the screen's top to the band's top), fills it with the
// skin's ground and pads its own words by `input.insets(.flow).top`, the Stories row's reserve (insets are data,
// DESIGN.md "Stage insets replace host padding rules"). It draws no scanlines, no vignette and no dissolve: the
// stage's (J-S3, PG-4t). The four named deviations are ListPaint's header's.

struct ListView: View {
  let input: GodviewStageInput

  var body: some View {
    let model = ListModel.of(input: input)
    let skin = input.skin
    let drawn = Dictionary(input.rows.map { ($0.id, $0) }) { first, _ in first }
    GeometryReader { stage in
      let columns = ListPaint.columns(
        width: stage.size.width, projectWidth: ListModel.Parameters.defaults.projectWidth)
      VStack(alignment: .leading, spacing: 0) {
        toolbar(model.count, skin: skin)
        if model.isEmpty {
          empty(skin: skin)
        } else {
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
              ForEach(model.rows) { row in
                ListRowView(
                  row: row, allReceded: model.allReceded,
                  ink: ListPaint.ink(drawn[row.id].flatMap(input.colour)), columns: columns, skin: skin,
                  isStill: input.isStill
                ) {
                  // a tap is the desktop's `select`: the card on the row's body (HS's `onOpen`)
                  if let tapped = drawn[row.id] { input.onOpen(tapped) }
                }
              }
            }
            .padding(.horizontal, ListPaint.rowsSide)
            .padding(.bottom, ListPaint.rowsFoot)
          }
        }
      }
      .padding(.top, input.insets(.flow).top + ListPaint.columnTop)
      .frame(width: stage.size.width, height: stage.size.height, alignment: .top)
    }
    .background(skin.monitorBg)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(ListModel.listLabel)
  }

  /// The toolbar: the count alone (deviation 1: no `＋ TERMINAL`), at the button's height.
  private func toolbar(_ count: String, skin: GodviewSkin) -> some View {
    Text(count)
      .font(FieldType.mono(ListPaint.toolbarSize, .bold))
      .tracking(FieldType.tracking(ListPaint.toolbarTracking, of: ListPaint.toolbarSize))
      .foregroundStyle(ListView.color(ListPaint.toolbarInk, skin: skin))
      .frame(maxWidth: .infinity, minHeight: ListPaint.toolbarHeight, alignment: .leading)
      .padding(.horizontal, ListPaint.toolbarSide)
      .padding(.bottom, ListPaint.toolbarFoot)
  }

  private func empty(skin: GodviewSkin) -> some View {
    VStack(spacing: ListPaint.emptyGap) {
      Text(ListModel.emptyTitle)
        .font(FieldType.mono(ListPaint.emptyTitleSize, .heavy))
        .tracking(FieldType.tracking(ListPaint.emptyTitleTracking, of: ListPaint.emptyTitleSize))
      Text(ListModel.emptyHint)
        .font(FieldType.mono(ListPaint.emptyHintSize))
        .tracking(FieldType.tracking(ListPaint.emptyTracking, of: ListPaint.emptyHintSize))
    }
    .multilineTextAlignment(.center)
    .foregroundStyle(ListView.color(ListPaint.emptyInk, skin: skin))
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .allowsHitTesting(false)
  }

  /// An ink, resolved: the skin's colour for its role, or the row's own.
  static func color(_ ink: ListPaint.Ink, skin: GodviewSkin) -> Color {
    switch ink {
    case .textMain: skin.textMain
    case .textMuted: skin.textMuted
    case .textFaint: skin.textFaint
    case .panelBorder: skin.panelBorder
    case .controlHoverBg: skin.controlHoverBg
    case .dealt(let colour): Color(.sRGB, red: colour.r, green: colour.g, blue: colour.b, opacity: colour.a)
    }
  }
}

/// One row (`ListRow`, AgentList.tsx:137-204): the dot, the project, the agent, the detail and the context.
private struct ListRowView: View {
  let row: ListRowModel
  let allReceded: Bool
  let ink: ListPaint.Ink
  let columns: (agent: Double, detail: Double)
  let skin: GodviewSkin
  let isStill: Bool
  let onTap: () -> Void

  var body: some View {
    let weight = ListPaint.weight(stale: row.stale, receded: row.receded, allReceded: allReceded)
    Button(action: onTap) {
      HStack(spacing: ListPaint.columnGap) {
        dot.frame(width: ListPaint.dotColumn)
        project.frame(width: ListModel.Parameters.defaults.projectWidth, alignment: .leading)
        agent.frame(width: columns.agent, alignment: .leading)
        words(row.detail, ink: ListPaint.detailInk)
          .frame(width: columns.detail, alignment: .leading)
        words(row.context, ink: ListPaint.contextInk)
          .monospacedDigit()
          .frame(width: ListPaint.contextColumn, alignment: .trailing)
      }
      .padding(.leading, ListPaint.leftBorder + ListPaint.rowInset)
      .padding(.trailing, ListPaint.border + ListPaint.rowInset)
      .padding(.vertical, ListPaint.border)
      .frame(minHeight: ListModel.Parameters.defaults.rowHeight)
      .background(ground)
      .overlay(edge)
      .contentShape(Rectangle())
    }
    .buttonStyle(ListRowPress())
    .opacity(weight)
    .animation(isStill ? nil : FieldMotion.plainEase(ListPaint.fadeWeight), value: weight)
    .animation(isStill ? nil : FieldMotion.plainEase(ListPaint.fadeBorder), value: row.active)
    .accessibilityLabel(row.label)
    .accessibilityAddTraits(row.current ? .isSelected : [])
  }

  private var colour: Color { ListView.color(ink, skin: skin) }

  /// The dot in the row's colour; an idle one at .4; a blocked one ringed.
  private var dot: some View {
    Circle()
      .fill(colour)
      .frame(width: ListPaint.dot, height: ListPaint.dot)
      .background {
        if ListPaint.dotRinged(row.status) {
          Circle()
            .fill(colour.opacity(ListPaint.dotRingWeight))
            .frame(width: ListPaint.dot + 2 * ListPaint.dotRing, height: ListPaint.dot + 2 * ListPaint.dotRing)
        }
      }
      .opacity(ListPaint.dotWeight(row.status))
  }

  private var project: some View {
    VStack(alignment: .leading, spacing: ListPaint.projectGap) {
      Text(row.project)
        .font(FieldType.mono(ListPaint.projectSize, .bold))
        .foregroundStyle(ListView.color(ListPaint.projectInk, skin: skin))
        .lineLimit(1)
        .truncationMode(.tail)
      if let branch = row.branch { words(branch, ink: ListPaint.branchInk) }
    }
  }

  @ViewBuilder private var agent: some View {
    switch row.agent {
    case .agent(let providerId, let model, let account):
      HStack(spacing: ListPaint.agentGap) {
        AgentGlyph(mark: providerId, letterSize: ListPaint.markSize)
          .frame(width: ListPaint.markSize, height: ListPaint.markSize)
          .foregroundStyle(ListView.color(ListPaint.modelInk, skin: skin))
        words(model, ink: ListPaint.modelInk)
        if let account {
          Text(account)
            .font(FieldType.mono(ListPaint.accountSize))
            .foregroundStyle(ListView.color(ListPaint.accountInk, skin: skin))
            .lineLimit(1)
        }
      }
    case .host(let host):
      words(host, ink: ListPaint.hostInk)
    case .terminal(let word):
      words(word, ink: ListPaint.terminalInk).italic()
    }
  }

  private func words(_ text: String, ink: ListPaint.Ink) -> Text {
    Text(text)
      .font(FieldType.mono(ListPaint.smallSize))
      .foregroundStyle(ListView.color(ink, skin: skin))
  }

  /// The lit row's ground (LC:90-94).
  @ViewBuilder private var ground: some View {
    if let ground = ListPaint.litGround(active: row.active) {
      RoundedRectangle(cornerRadius: ListPaint.radius).fill(ListView.color(ground, skin: skin))
    }
  }

  /// The lit row's border in text main (deviation 3), and a pane's left border (never on the phone).
  @ViewBuilder private var edge: some View {
    if let border = ListPaint.litBorder(active: row.active) {
      RoundedRectangle(cornerRadius: ListPaint.radius)
        .strokeBorder(ListView.color(border, skin: skin), lineWidth: ListPaint.border)
    }
    if let linked = ListPaint.linkedBorder(linked: row.linked, ink: ink) {
      UnevenRoundedRectangle(topLeadingRadius: ListPaint.radius, bottomLeadingRadius: ListPaint.radius)
        .fill(ListView.color(linked, skin: skin))
        .frame(width: ListPaint.leftBorder)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

/// No hover and no press look (deviation 2): the label as it is.
private struct ListRowPress: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View { configuration.label }
}
