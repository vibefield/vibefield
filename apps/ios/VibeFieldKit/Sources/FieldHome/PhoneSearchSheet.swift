import FieldDesign
import FieldHistory
import FieldProduct
import SwiftUI
import UIKit

/// SE-2 (SE-D3 A; DESIGN.md §8 "The phone's search") — the sheet's measure, the drawing's (`search.css`'s `.ps-sheet`,
/// `.ps-seg`, `.ps-fchips`, `.ps-row`, `.ps-sug`, `.ps-none` and `.ps-foot`). `AppBarTests` pins the ruled numbers.
enum SearchSheet {
  /// From each side of the screen: where the keyboard's typing row stands.
  static let side: CGFloat = AppBar.marginTyping
  /// Its foot above the search field's top.
  static let gapAboveField: CGFloat = 10
  /// It is never higher than this from the screen's top.
  static let topLimit: CGFloat = 56
  static let radius: CGFloat = 34
  /// It rises from the middle of its foot: this far up, from this scale, over `rise` on the island curve.
  static let riseOffset: CGFloat = 24
  static let riseScale: CGFloat = 0.94
  static let rise: Double = 0.42
  /// The scrim's fade, and every fade Reduce Motion puts in a rise's or a pop's place (M6).
  static let scrimFade: Double = 0.24
  static let reducedFade: Double = 0.12
  /// The switch: 14 in from the sheet's sides and top, 6 above the chips; its track padded 2, corners 10; each half
  /// 30 tall, corners 8, at 13.5.
  static let headInset: CGFloat = 14
  static let headBelow: CGFloat = 6
  static let switchPadding: CGFloat = 2
  static let switchRadius: CGFloat = ChromeRadius.segment
  static let switchItemHeight: CGFloat = 30
  static let switchItemRadius: CGFloat = ChromeRadius.segmentThumb
  static let switchText: CGFloat = 13.5
  /// The chips' row: padded 2 14 8, its last 28 fading out; a chip 32 tall, corners 16, padded 0 12 0 10, its parts
  /// 6 apart, its glyph 13, the waiting dot 6; a 1 × 18 hairline between groups.
  static let chipsTop: CGFloat = 2
  static let chipsSide: CGFloat = 14
  static let chipsBottom: CGFloat = 8
  static let chipsFade: CGFloat = 28
  static let chipHeight: CGFloat = 32
  static let chipLeading: CGFloat = 10
  static let chipTrailing: CGFloat = 12
  static let chipGap: CGFloat = 6
  static let chipGlyph: CGFloat = 13
  static let waitingDot: CGFloat = 6
  static let groupRule = CGSize(width: 1, height: 18)
  /// The list: padded 4 6, its rows 1 apart, each with corners 18, padded 11 14 11 16, 10 between its parts.
  static let listVertical: CGFloat = 4
  static let listSide: CGFloat = 6
  static let rowGap: CGFloat = 1
  static let rowRadius: CGFloat = 18
  static let rowVertical: CGFloat = 11
  static let rowLeading: CGFloat = 16
  static let rowTrailing: CGFloat = 14
  static let rowParts: CGFloat = 10
  static let stateDot: CGFloat = 8
  /// The offer: a 32 round holding the glyph at 16, and a Filter capsule 30 tall.
  static let offerDisc: CGFloat = 32
  static let offerGlyph: CGFloat = 16
  static let filterHeight: CGFloat = 30
  /// The foot, over a hairline: padded 9 20 14.
  static let footTop: CGFloat = 9
  static let footSide: CGFloat = 20
  static let footBottom: CGFloat = 14

  /// The drawing's measure the ruling leaves unsaid, transcribed: a hairline between chip groups stands 3 from each
  /// (`.ps-fsep`); a row's title, its sub and its line stand 3 apart (`.ps-rt`), the sub's parts 8 and a pill's own 4
  /// (`.ps-sub`, `.ps-pf`), who said a line 7 before it (`.ps-ln em`); the state dot drops 6 to the title's middle
  /// and a past row's clock 3 (`.pk-dot`, `.ps-clock`); the Filter capsule is padded 12 (`.ps-jump`); an empty list
  /// is padded 26 18 with 12 before its one act, a 34 capsule padded 16 (`.ps-none`, `.ps-widen`).
  static let ruleMargin: CGFloat = 3
  static let rowStack: CGFloat = 3
  static let subParts: CGFloat = 8
  static let pillParts: CGFloat = 4
  static let whoGap: CGFloat = 7
  static let dotDrop: CGFloat = 6
  static let clockDrop: CGFloat = 3
  static let filterSide: CGFloat = 12
  static let emptyVertical: CGFloat = 26
  static let emptySide: CGFloat = 18
  static let emptyGap: CGFloat = 12
  static let actHeight: CGFloat = 34
  static let actSide: CGFloat = 16

  /// The tallest the sheet may stand, its foot `gapAboveField` above a search field whose top is `fieldTop` from the
  /// screen's top, and never past `topLimit`; a field too low for any sheet leaves none.
  static func maxHeight(fieldTop: CGFloat) -> CGFloat { max(0, fieldTop - gapAboveField - topLimit) }

  /// It rises from the middle of its foot over 420ms on the island curve; under Reduce Motion it fades in place over
  /// 120ms (M6).
  static func transition(reduceMotion: Bool) -> AnyTransition {
    reduceMotion
      ? AnyTransition.opacity.animation(FieldMotion.plainEase(reducedFade))
      : AnyTransition.modifier(active: Rise(risen: false), identity: Rise(risen: true))
        .animation(FieldMotion.island(rise))
  }

  /// The scrim fades in and out over 240ms, under Reduce Motion too.
  static var scrimTransition: AnyTransition { .opacity.animation(FieldMotion.plainEase(scrimFade)) }

  private struct Rise: ViewModifier {
    let risen: Bool

    func body(content: Content) -> some View {
      content
        .scaleEffect(risen ? 1 : SearchSheet.riseScale, anchor: .bottom)
        .offset(y: risen ? 0 : SearchSheet.riseOffset)
        .opacity(risen ? 1 : 0)
    }
  }

  /// `text` with the words marked as the Peek marks them: the ink at 600 on the ink at 11% (K1).
  static func marked(
    _ text: String, terms: [String], size: CGFloat, weight: Font.Weight, ink: Color
  ) -> AttributedString {
    var line = AttributedString()
    for run in FieldHistoryModel.marked(text, terms: terms) {
      var piece = AttributedString(run.text)
      piece.foregroundColor = run.marked ? ChromePalette.ink : ink
      piece.font = ChromeType.sans(size, run.marked ? .semibold : weight)
      if run.marked { piece.backgroundColor = ChromePalette.searchMark }
      line += piece
    }
    return line
  }
}

/// What the sheet draws for one scope, decided by `PhoneSearch` from the lens, the search's own state and each world
/// (composed by HomeScreen, SE-2e), so the sheet decides nothing.
struct SearchSheetContent: Equatable {
  enum Rows: Equatable {
    case live([PhoneSearch.LiveRow])
    case past([PhoneSearch.PastRow])
  }

  var scope: PhoneSearch.Scope
  /// The words typed, as the rows mark them; none, and MA-D7's Apps strip stands above the switch.
  var terms: [String]
  /// The field's tokens: the chosen filters, in the bar's search field.
  var tokens: [PhoneSearch.Token]
  var chips: [[PhoneSearch.Chip]]
  var offer: PhoneSearch.Offer?
  var rows: Rows
  /// The empty list's words while no row stands; nil says nothing (Everything before a word: §9's words are James's).
  var empty: PhoneSearch.Empty?
  var foot: String
  /// The profiles a home row's pill names: the lens's while it offers them, none with one profile (UM-D12).
  var profiles: [AgentProfileSet]

  var isEmpty: Bool {
    switch rows {
    case .live(let rows): rows.isEmpty
    case .past(let rows): rows.isEmpty
    }
  }
}

/// SE-2 (SE-D3, SE-D4 and SE-D5 A; DESIGN.md §8 "The phone's search") — THE GLASS SHEET over the field: MA-D7's Apps
/// strip before a word, the switch (Live now · Everything), the chips, the list (a typed name's offer, Everything's
/// Apps group, the rows or the empty words) and the foot. Its glass is the bar's, one more shape in the bar's glass
/// container (the caller's `GlassGroup`, `glass`); it stands as tall as what it holds, never past `maxHeight`.
///
/// The two Apps slots are MA-6's seam (§8 "The phone's Apps", as amended by SE-D3): `appsStrip` stands above the
/// switch in both scopes before any word and gives way once one is typed; `appsGroup` stands first among
/// Everything's results once a word is typed. Until MA-6 fills them the caller hands `EmptyView`.
struct PhoneSearchSheet<AppsStrip: View, AppsGroup: View>: View {
  let content: SearchSheetContent
  /// `SearchSheet.maxHeight(fieldTop:)`, from where the field stands.
  let maxHeight: CGFloat
  let glass: Namespace.ID
  let onScope: (PhoneSearch.Scope) -> Void
  /// A chip tapped: its filter becomes a token.
  let onChip: (PhoneSearch.Filter) -> Void
  /// The offer's Filter: applied, the word it was typed as dropped, the keyboard kept.
  let onOffer: (PhoneSearch.Filter) -> Void
  let onLive: (PhoneSearch.LiveRow) -> Void
  let onPast: (PhoneSearch.PastRow) -> Void
  let onAct: (PhoneSearch.EmptyAct) -> Void
  @ViewBuilder let appsStrip: () -> AppsStrip
  @ViewBuilder let appsGroup: () -> AppsGroup

  @Namespace private var thumb
  @State private var listHeight: CGFloat = 0

  var body: some View {
    VStack(spacing: 0) {
      if content.terms.isEmpty { appsStrip() }
      scopeSwitch
      if !content.chips.isEmpty { chips }
      list
      foot
    }
    .clipShape(RoundedRectangle(cornerRadius: SearchSheet.radius, style: .continuous))
    .liquidGlassPanel(radius: SearchSheet.radius)
    .glassID("sheet", in: glass)
    .frame(maxHeight: maxHeight, alignment: .bottom)
  }

  // MARK: - The switch

  private var scopeSwitch: some View {
    HStack(spacing: 0) {
      ForEach(PhoneSearch.Scope.allCases, id: \.self) { scope in
        let chosen = scope == content.scope
        Button {
          onScope(scope)
        } label: {
          Text(scope.label)
            .font(ChromeType.sans(SearchSheet.switchText, chosen ? .semibold : .medium))
            .foregroundStyle(ChromePalette.ink)
            .frame(maxWidth: .infinity)
            .frame(height: SearchSheet.switchItemHeight)
            .background {
              if chosen {
                RoundedRectangle(cornerRadius: SearchSheet.switchItemRadius, style: .continuous)
                  .fill(ChromePalette.paper)
                  .shadow(color: ChromeShadow.chosen.color, radius: ChromeShadow.chosen.radius, y: ChromeShadow.chosen.y)
                  .matchedGeometryEffect(id: "chosen", in: thumb)
              }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(chosen ? [.isSelected] : [])
      }
    }
    .padding(SearchSheet.switchPadding)
    .background(
      RoundedRectangle(cornerRadius: SearchSheet.switchRadius, style: .continuous).fill(ChromePalette.searchWell)
    )
    .animation(AppBar.motion, value: content.scope)
    .padding(.horizontal, SearchSheet.headInset)
    .padding(.top, SearchSheet.headInset)
    .padding(.bottom, SearchSheet.headBelow)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Search in")
  }

  // MARK: - The chips

  private var chips: some View {
    ScrollView(.horizontal) {
      HStack(spacing: SearchSheet.chipGap) {
        ForEach(Array(content.chips.enumerated()), id: \.offset) { index, group in
          if index > 0 {
            Rectangle()
              .fill(ChromePalette.searchRule)
              .frame(width: SearchSheet.groupRule.width, height: SearchSheet.groupRule.height)
              .padding(.horizontal, SearchSheet.ruleMargin)
              .accessibilityHidden(true)
          }
          ForEach(group) { chip in
            SearchChip(chip: chip) { onChip(chip.filter) }
          }
        }
      }
      .padding(.top, SearchSheet.chipsTop)
      .padding(.horizontal, SearchSheet.chipsSide)
      .padding(.bottom, SearchSheet.chipsBottom)
    }
    .scrollIndicators(.hidden)
    .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
    .fixedSize(horizontal: false, vertical: true)
    .mask {
      HStack(spacing: 0) {
        Rectangle()
        LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing)
          .frame(width: SearchSheet.chipsFade)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Filters you can add")
  }

  // MARK: - The list

  private var list: some View {
    ScrollView {
      VStack(spacing: SearchSheet.rowGap) {
        if let offer = content.offer {
          OfferRow(offer: offer) { onOffer(offer.filter) }
        }
        if content.scope == .everything, !content.terms.isEmpty { appsGroup() }
        switch content.rows {
        case .live(let rows):
          ForEach(rows) { row in
            LiveSearchRow(row: row, terms: content.terms, profiles: content.profiles) { onLive(row) }
          }
        case .past(let rows):
          ForEach(rows) { row in
            PastSearchRow(row: row, terms: content.terms) { onPast(row) }
          }
        }
        if content.isEmpty, let empty = content.empty {
          EmptySearch(empty: empty, onAct: onAct)
        }
      }
      .padding(.vertical, SearchSheet.listVertical)
      .padding(.horizontal, SearchSheet.listSide)
      .onGeometryChange(for: CGFloat.self) { proxy in
        proxy.size.height
      } action: { height in
        listHeight = height
      }
    }
    .frame(maxHeight: listHeight)
    .scrollBounceBehavior(.basedOnSize)
    .scrollDismissesKeyboard(.interactively)
  }

  // MARK: - The foot

  private var foot: some View {
    Text(content.foot)
      .font(ChromeType.sans(12, .medium))
      .monospacedDigit()
      .foregroundStyle(ChromePalette.inkTertiary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.top, SearchSheet.footTop)
      .padding(.horizontal, SearchSheet.footSide)
      .padding(.bottom, SearchSheet.footBottom)
      .overlay(alignment: .top) {
        Rectangle().fill(ChromePalette.separator).frame(height: 0.5)
      }
      .accessibilityAddTraits(.updatesFrequently)
  }
}

/// The dim under search (§5 *Search scrim*, returned by SE-D3 A): alone, with no blur, fading in over 240ms
/// (`SearchSheet.scrimTransition`, at the caller); a tap on it closes search.
struct SearchScrim: View {
  let onClose: () -> Void

  var body: some View {
    ChromePalette.searchScrim
      .ignoresSafeArea()
      .contentShape(Rectangle())
      .onTapGesture(perform: onClose)
      .accessibilityLabel("Close search")
      .accessibilityAddTraits(.isButton)
  }
}

// MARK: - The parts

/// What leads a chip, a token, an offer or a pill (`PhoneSearch.Lead`): a profile's glyph, a desktop's OS mark,
/// §13's `message` for who said it, §13's `folder` for a project — in the ink it sits in.
struct SearchLeadGlyph: View {
  let lead: PhoneSearch.Lead
  let size: CGFloat

  var body: some View {
    switch lead {
    case .profile(let glyph, let native):
      Image(systemName: Self.profileSymbol(glyph: glyph, native: native))
        .font(.system(size: size, weight: .regular))
        .accessibilityHidden(true)
    case .desk(let platform):
      DeviceMark(platform: platform, size: size)
    case .said:
      Image(systemName: "bubble.left")
        .font(.system(size: size, weight: .regular))
        .accessibilityHidden(true)
    case .folder:
      Image(systemName: "folder")
        .font(.system(size: size, weight: .regular))
        .accessibilityHidden(true)
    }
  }

  /// A profile's glyph, by the spawn bloom's rule on this base (`SpawnBloomOverlay.symbol`): its own when the system
  /// has it, the laptop for the agents' own folders, the person otherwise. The restack onto UM-4's PH-2 (SE-P5b)
  /// draws it through the phone's one table, `ProfileGlyphSymbols`, instead.
  static func profileSymbol(glyph: String?, native: Bool) -> String {
    guard let glyph, UIImage(systemName: glyph) != nil else {
      return native ? "laptopcomputer" : "person.crop.circle"
    }
    return glyph
  }
}

/// A chip: its glyph in the secondary ink, its name at 14/500, and its count (or "asleep") in tabular figures, with
/// the 6 orange dot before it while a session under it waits on you.
private struct SearchChip: View {
  let chip: PhoneSearch.Chip
  let onTap: () -> Void

  var body: some View {
    Button(action: onTap) {
      HStack(spacing: SearchSheet.chipGap) {
        SearchLeadGlyph(lead: chip.lead, size: SearchSheet.chipGlyph)
          .foregroundStyle(ChromePalette.inkSecondary)
        Text(chip.label)
          .font(ChromeType.sans(14, .medium))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
        if let note = chip.note {
          HStack(spacing: SearchSheet.pillParts) {
            if chip.waiting {
              Circle()
                .fill(ChromePalette.attention)
                .frame(width: SearchSheet.waitingDot, height: SearchSheet.waitingDot)
            }
            Text(note)
              .font(ChromeType.sans(13))
              .monospacedDigit()
              .foregroundStyle(ChromePalette.inkTertiary)
          }
        }
      }
      .padding(.leading, SearchSheet.chipLeading)
      .padding(.trailing, SearchSheet.chipTrailing)
      .frame(height: SearchSheet.chipHeight)
      .contentShape(Capsule())
    }
    .buttonStyle(SearchChipStyle())
    .accessibilityLabel(chip.note.map { "\(chip.label), \($0)\(chip.waiting ? ", waiting on you" : "")" } ?? chip.label)
    .accessibilityHint("Adds a filter")
  }
}

private struct SearchChipStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background(
        Capsule().fill(configuration.isPressed ? ChromePalette.searchChipPressed : ChromePalette.searchChip))
  }
}

/// A row of the list: corners 18, padded 11 14 11 16; pressed, the selected row's wash.
private struct SearchRowStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .padding(.vertical, SearchSheet.rowVertical)
      .padding(.leading, SearchSheet.rowLeading)
      .padding(.trailing, SearchSheet.rowTrailing)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: SearchSheet.rowRadius, style: .continuous)
          .fill(configuration.isPressed ? ChromePalette.rowSelected : Color.clear))
      .contentShape(RoundedRectangle(cornerRadius: SearchSheet.rowRadius, style: .continuous))
  }
}

/// A typed name's offer: a 32 round holding the glyph at 16, its title at 15/600 over its note, and the Filter
/// capsule at its end. A tap applies it.
private struct OfferRow: View {
  let offer: PhoneSearch.Offer
  let onApply: () -> Void

  var body: some View {
    Button(action: onApply) {
      HStack(alignment: .center, spacing: SearchSheet.rowParts) {
        SearchLeadGlyph(lead: offer.lead, size: SearchSheet.offerGlyph)
          .foregroundStyle(ChromePalette.ink)
          .frame(width: SearchSheet.offerDisc, height: SearchSheet.offerDisc)
          .background(Circle().fill(ChromePalette.searchWell))
        VStack(alignment: .leading, spacing: SearchSheet.rowStack) {
          Text(offer.title)
            .font(ChromeType.sans(15, .semibold))
            .foregroundStyle(ChromePalette.ink)
            .lineLimit(1)
          Text(offer.note)
            .font(ChromeType.sans(13))
            .foregroundStyle(ChromePalette.inkSecondary)
            .lineLimit(1)
        }
        Spacer(minLength: 0)
        Text("Filter")
          .font(ChromeType.sans(SearchSheet.switchText, .semibold))
          .foregroundStyle(ChromePalette.ink)
          .padding(.horizontal, SearchSheet.filterSide)
          .frame(height: SearchSheet.filterHeight)
          .background(Capsule().fill(ChromePalette.searchWell))
      }
    }
    .buttonStyle(SearchRowStyle())
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(offer.title), \(offer.note)")
    .accessibilityHint("Adds the filter")
  }
}

/// A live row: the 8 state dot, the body's title with the words marked, "folder · agent" and its profile and desktop
/// pills, its first matched line, and its state word.
private struct LiveSearchRow: View {
  let row: PhoneSearch.LiveRow
  let terms: [String]
  let profiles: [AgentProfileSet]
  let onOpen: () -> Void

  var body: some View {
    let session = row.session
    Button(action: onOpen) {
      HStack(alignment: .top, spacing: SearchSheet.rowParts) {
        Circle()
          .fill(Self.dot(session.state))
          .frame(width: SearchSheet.stateDot, height: SearchSheet.stateDot)
          .padding(.top, SearchSheet.dotDrop)
        VStack(alignment: .leading, spacing: SearchSheet.rowStack) {
          Text(SearchSheet.marked(session.title, terms: terms, size: 16, weight: .semibold, ink: ChromePalette.ink))
            .lineLimit(1)
          HStack(spacing: SearchSheet.subParts) {
            Text([session.folder, session.agent].compactMap { $0 }.joined(separator: " · "))
            if session.isHome, let profile = profiles.first(where: { $0.id == session.profileSet }) {
              HStack(spacing: SearchSheet.pillParts) {
                SearchLeadGlyph(lead: PhoneSearch.lead(profile), size: 11)
                Text(profile.label)
              }
            }
            if !session.isHome {
              HStack(spacing: SearchSheet.pillParts) {
                DeviceMark(platform: session.platform, size: 11)
                Text(session.deviceName)
              }
            }
          }
          .font(ChromeType.sans(13))
          .foregroundStyle(ChromePalette.inkSecondary)
          .lineLimit(1)
          if let line = row.lines.first {
            MatchedLine(hit: line, agent: session.agent, terms: terms)
          }
        }
        Spacer(minLength: 0)
        Text(session.state.word)
          .font(ChromeType.sans(13))
          .foregroundStyle(ChromePalette.inkTertiary)
          .padding(.top, 2)
      }
    }
    .buttonStyle(SearchRowStyle())
    .accessibilityElement(children: .combine)
    .accessibilityHint("Opens its card on Field")
  }

  /// §2.5: working green, waiting orange, idle and a shell faint.
  static func dot(_ state: PhoneSearch.LiveState) -> Color {
    switch state {
    case .blocked: ChromePalette.attention
    case .working: ChromePalette.green
    case .idle, .shell: ChromePalette.inkFaint
    }
  }
}

/// A past row: History's clock, the session's title with the words marked, "folder · agent", its first matched line
/// and when.
private struct PastSearchRow: View {
  let row: PhoneSearch.PastRow
  let terms: [String]
  let onOpen: () -> Void

  var body: some View {
    Button(action: onOpen) {
      HStack(alignment: .top, spacing: SearchSheet.rowParts) {
        Image(systemName: "clock.arrow.circlepath")
          .font(.system(size: SearchSheet.chipGlyph, weight: .regular))
          .foregroundStyle(ChromePalette.inkTertiary)
          .frame(width: SearchSheet.stateDot)
          .padding(.top, SearchSheet.clockDrop)
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: SearchSheet.rowStack) {
          Text(SearchSheet.marked(row.title, terms: terms, size: 16, weight: .semibold, ink: ChromePalette.ink))
            .lineLimit(1)
          Text([row.folder, row.agent].compactMap { $0 }.joined(separator: " · "))
            .font(ChromeType.sans(13))
            .foregroundStyle(ChromePalette.inkSecondary)
            .lineLimit(1)
          if let line = row.lines.first {
            MatchedLine(hit: line, agent: row.agent, terms: terms)
          }
        }
        Spacer(minLength: 0)
        Text(row.when)
          .font(ChromeType.sans(13))
          .monospacedDigit()
          .foregroundStyle(ChromePalette.inkTertiary)
          .padding(.top, 2)
      }
    }
    .buttonStyle(SearchRowStyle())
    .accessibilityElement(children: .combine)
    .accessibilityHint(row.group == nil ? "Opens the session in History" : "Opens History at the line")
  }
}

/// A row's first matched line: who said it at 12 in the tertiary ink, the line at 14 in the secondary ink with the
/// words marked, ellipsised.
private struct MatchedLine: View {
  let hit: HistoryHit
  let agent: String?
  let terms: [String]

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: SearchSheet.whoGap) {
      Text(hit.who == .you ? "You" : agent ?? "Agent")
        .font(ChromeType.sans(12))
        .foregroundStyle(ChromePalette.inkTertiary)
        .fixedSize()
      Text(SearchSheet.marked(hit.text, terms: terms, size: 14, weight: .regular, ink: ChromePalette.inkSecondary))
        .lineLimit(1)
    }
  }
}

/// An empty list: its sentence at 14.5 in the tertiary ink, and its one way out.
private struct EmptySearch: View {
  let empty: PhoneSearch.Empty
  let onAct: (PhoneSearch.EmptyAct) -> Void

  var body: some View {
    VStack(spacing: SearchSheet.emptyGap) {
      Text(empty.sentence)
        .font(ChromeType.sans(14.5))
        .foregroundStyle(ChromePalette.inkTertiary)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
      if let act = empty.act {
        Button {
          onAct(act)
        } label: {
          Text(Self.word(act))
            .font(ChromeType.sans(14, .semibold))
            .foregroundStyle(ChromePalette.ink)
            .padding(.horizontal, SearchSheet.actSide)
            .frame(height: SearchSheet.actHeight)
            .background(Capsule().fill(ChromePalette.searchWell))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, SearchSheet.emptyVertical)
    .padding(.horizontal, SearchSheet.emptySide)
  }

  /// §9 "The phone's empty lists": each act's words.
  static func word(_ act: PhoneSearch.EmptyAct) -> String {
    switch act {
    case .clearFilters: "Clear the filters"
    case .searchEverything: "Search everything"
    }
  }
}
