import FieldDesign
import FieldSettings
import SwiftUI
import UIKit

/// WI-1/WI-2 — the way in, standing over the splash's field (DESIGN.md §8 "The phone's way in"; every word is
/// §9 "The way in"'s, by way of `FieldHomeModel.wayInScreen`). Three places that never move (WI-L4): where you
/// are at the top; one picture on the words line, the splash's own mark or what takes its place, and the words
/// under it; the acts in one glass at the bottom, the primary always in its first slot. It decides nothing:
/// every act goes back to the home.
struct WayInView: View {
  let screen: FieldHomeModel.WayInScreen
  /// The face that takes the mark's place (the found beat, Tailscale asking again), and its tilt's seed.
  let face: UserFace?
  let faceSeed: String
  let onAct: (FieldHomeModel.WayInAct) -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var risen = false
  @State private var copied = false

  /// The page's measures, on a 402 × 874 phone: the picture stands on a line 29 pt under the screen's centre
  /// (the mark's own centre), and the words start 45 pt under it.
  private enum Measure {
    static let pictureLine: CGFloat = 29
    static let pictureBox: CGFloat = 200
    static let wordsTop: CGFloat = 45
    static let glassHeight: CGFloat = 210
    static let glassInset: CGFloat = 8
    static let slotInset: CGFloat = 20
    static let faceSize: CGFloat = 96
  }

  /// What shows in the mark's place.
  var picture: FieldHomeModel.WayInScreen.Picture {
    Self.shownPicture(screen.picture, hasFace: face != nil)
  }

  /// WI-L3's door: whether the splash can fade its mark where it stands. The mark only fades, and the splash's
  /// runtime draws it whole today, so the door is shut and the mark keeps its place on every step. It opens with the
  /// runtime's mark fade (vibefield-splash's `markOpacity`, vendored at a revision upstream has), and with it a
  /// face or a drawing takes the mark's place.
  nonisolated static let markFades = false

  /// What shows in the mark's place. Through the door, a face only when there is one to show (else the mark keeps
  /// its place) and a drawing always; with the door shut, the mark on every step (WI-L3).
  nonisolated static func shownPicture(
    _ picture: FieldHomeModel.WayInScreen.Picture, hasFace: Bool, markFades: Bool = WayInView.markFades
  ) -> FieldHomeModel.WayInScreen.Picture {
    guard markFades else { return .mark }
    return picture == .face && !hasFace ? .mark : picture
  }

  var body: some View {
    ZStack {
      GeometryReader { geo in
        let mid = geo.size.height / 2
        ZStack {
          // the seat: the field's own ground, under the words only
          EllipticalGradient(colors: [ChromePalette.wayInSeat, ChromePalette.wayInSeat.opacity(0)], center: .center)
            .frame(width: geo.size.width + 80, height: 440)
            .position(x: geo.size.width / 2, y: mid + 83)
            .allowsHitTesting(false)
          pictureView
            .frame(width: geo.size.width, height: Measure.pictureBox, alignment: .bottom)
            .position(x: geo.size.width / 2, y: mid + Measure.pictureLine - Measure.pictureBox / 2)
            .id(pictureID)
            .transition(.opacity)
          words
            .frame(width: max(0, geo.size.width - 60))
            .frame(maxHeight: .infinity, alignment: .top)
            .padding(.top, mid + Measure.wordsTop)
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
            .id(screen.words.title)
            .transition(.opacity)
        }
      }
      .ignoresSafeArea()

      VStack(spacing: 0) {
        top
        Spacer(minLength: 0)
      }

      VStack(spacing: 0) {
        Spacer(minLength: 0)
        actsGlass
      }
      .ignoresSafeArea(.container, edges: .bottom)
    }
    .animation(reduceMotion ? FieldMotion.plainEase(0.12) : FieldMotion.plainEase(0.28), value: screen)
    .onAppear {
      withAnimation(reduceMotion ? FieldMotion.plainEase(0.12) : FieldMotion.island(0.46)) { risen = true }
    }
  }

  private var pictureID: String {
    switch picture {
    case .mark: "mark"
    case .face: "face"
    case .art(let art): "art-\(art)"
    }
  }

  // MARK: The top: where you are

  @ViewBuilder
  private var top: some View {
    ZStack {
      if let steps = screen.steps {
        StepsCapsule(steps: steps, names: screen.stepNames)
          .transition(.opacity)
      }
      if let back = screen.back {
        Button {
          onAct(back)
        } label: {
          Image(systemName: "chevron.backward")
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(ChromePalette.ink)
            .frame(width: 44, height: 44)
            .background { ChromeMaterial.glass(in: Circle(), shadow: nil) }
        }
        .accessibilityLabel("Back")
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, 16)
      }
    }
    .frame(height: 44)
    .padding(.top, 2)
  }

  // MARK: The centre: the picture, then the words

  @ViewBuilder
  private var pictureView: some View {
    switch picture {
    case .mark:
      // the splash draws its own mark here
      Color.clear
    case .face:
      if let face {
        UserFaceView(face: face, size: Measure.faceSize, seed: faceSeed)
      }
    case .art(let art):
      WayInArt(art: art)
        .foregroundStyle(ChromePalette.ink)
        .accessibilityHidden(true)
    }
  }

  private var words: some View {
    VStack(spacing: 0) {
      Text(screen.words.title)
        .font(screen.words.hold ? ChromeType.sans(17, .semibold) : ChromeType.sans(28, .bold))
        .foregroundStyle(ChromePalette.ink)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityAddTraits(.isHeader)
      if let line = screen.words.line {
        Text(Self.inked(line))
          .font(ChromeType.sans(15))
          .foregroundStyle(ChromePalette.inkSecondary)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: 330)
          .padding(.top, 8)
      }
      if let note = screen.words.note {
        Text(note)
          .font(ChromeType.sans(ChromeType.hintSize))
          .foregroundStyle(ChromePalette.inkTertiary)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: 320)
          .padding(.top, 10)
      }
    }
  }

  /// The line's bold runs in the ink and the semibold weight: the words the eye looks for elsewhere. Pure, and
  /// nonisolated: a View's statics are the main actor's, and this one runs anywhere.
  nonisolated static func inked(_ line: AttributedString) -> AttributedString {
    var line = line
    let bold = line.runs.filter { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true }.map(\.range)
    for range in bold {
      line[range].inlinePresentationIntent = nil
      line[range].font = ChromeType.sans(15, .semibold)
      line[range].foregroundColor = ChromePalette.ink
    }
    return line
  }

  // MARK: The bottom: the acts' glass

  private var actsGlass: some View {
    let shape = UnevenRoundedRectangle(
      topLeadingRadius: 32, bottomLeadingRadius: 47, bottomTrailingRadius: 47, topTrailingRadius: 32,
      style: .continuous)
    let acts = Array(screen.acts.prefix(3))
    let shown = risen && !acts.isEmpty
    return ZStack(alignment: .top) {
      ChromeMaterial.glass(in: shape)
      if !acts.isEmpty {
        VStack(spacing: 0) {
          slot(acts[0]).frame(height: ChromePillStyle.wideHeight)
          if acts.count > 1 {
            slot(acts[1]).frame(height: ChromePillStyle.wideHeight).padding(.top, 10)
          }
          if acts.count > 2 {
            slot(acts[2]).frame(minHeight: 22).padding(.top, 14)
          }
        }
        .padding(.horizontal, Measure.slotInset)
        .padding(.top, 18)
        .id(screen.words.title)
        .transition(.opacity)
      }
    }
    .frame(height: Measure.glassHeight)
    .padding(.horizontal, Measure.glassInset)
    .padding(.bottom, Measure.glassInset)
    // a hold has no acts: the glass steps down out of its way
    .offset(y: shown ? 0 : Measure.glassHeight + 30)
    .opacity(shown ? 1 : 0)
    .allowsHitTesting(shown)
    .animation(reduceMotion ? FieldMotion.plainEase(0.12) : FieldMotion.island(0.46), value: acts.isEmpty)
  }

  @ViewBuilder
  private func slot(_ act: FieldHomeModel.WayInScreen.Act) -> some View {
    switch act {
    case .primary(let words, let what, let glyph):
      pill(words, glyph: glyph, kind: .primary) { onAct(what) }
    case .secondary(let words, let what, let glyph):
      pill(words, glyph: glyph, kind: .secondary) { onAct(what) }
    case .share(let words, let primary):
      ShareLink(item: VibeFieldSite.home) {
        HStack(spacing: 8) {
          Image(systemName: "square.and.arrow.up")
          Text(words)
        }
      }
      .buttonStyle(ChromePillStyle(primary ? .primary : .secondary, wide: true))
    case .link(let words, let what):
      Button(words) { onAct(what) }
        .font(ChromeType.sans(15, .semibold))
        .foregroundStyle(ChromePalette.ink)
    case .note(let words):
      Text(words)
        .font(ChromeType.sans(ChromeType.hintSize))
        .foregroundStyle(ChromePalette.inkSecondary)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    case .legal(let links):
      // IOS-13a — 12, the tertiary ink, two links to Safari with a dot between (§8, amended 2026-11-05)
      HStack(spacing: 6) {
        ForEach(Array(links.enumerated()), id: \.element.id) { index, link in
          if index > 0 {
            Text("·").accessibilityHidden(true)
          }
          Link(link.title, destination: link.url)
        }
      }
      .font(ChromeType.sans(12))
      .foregroundStyle(ChromePalette.inkTertiary)
      .tint(ChromePalette.inkTertiary)
    case .thisPhone(let machine):
      thisPhone(machine)
    case .computerWaiting:
      HStack(spacing: 10) {
        Image(systemName: "laptopcomputer")
          .font(.system(size: 17))
        Text("Your computer appears here")
          .font(ChromeType.sans(15, .medium))
          .lineLimit(1)
        Spacer(minLength: 0)
      }
      .foregroundStyle(ChromePalette.inkTertiary)
      .padding(.horizontal, 14)
      .frame(maxHeight: .infinity)
      .background {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
          .strokeBorder(ChromePalette.inkFaint, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
      }
      .accessibilityElement(children: .combine)
    case .tailscale(let words):
      HStack(spacing: 8) {
        TailscaleMark(size: TailscaleMark.minimum)
        Text(words)
          .font(ChromeType.sans(ChromeType.hintSize))
          .foregroundStyle(ChromePalette.inkSecondary)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: 200, alignment: .leading)
      }
      .accessibilityElement(children: .combine)
    }
  }

  private func pill(
    _ words: String, glyph: String?, kind: ChromePillStyle.Kind, action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      HStack(spacing: 8) {
        if let glyph { Image(systemName: glyph) }
        Text(words)
      }
    }
    .buttonStyle(ChromePillStyle(kind, wide: true))
  }

  /// Approval's one row (TS-7): this phone, its machine name in mono as it asked Tailscale for it, Copy.
  private func thisPhone(_ machine: String?) -> some View {
    HStack(spacing: 10) {
      Image(systemName: "key")
        .font(.system(size: 17, weight: .regular))
        .foregroundStyle(ChromePalette.inkSecondary)
      Text("This phone")
        .font(ChromeType.sans(15, .medium))
        .foregroundStyle(ChromePalette.ink)
      Spacer(minLength: 8)
      if let machine {
        Text(machine)
          .font(ChromeType.mono(13))
          .foregroundStyle(ChromePalette.inkSecondary)
          .lineLimit(1)
          .truncationMode(.middle)
          .textSelection(.enabled)
        Button(copied ? "Copied" : "Copy") {
          UIPasteboard.general.string = machine
          copied = true
          Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
          }
        }
        .font(ChromeType.sans(13, .semibold))
        .foregroundStyle(ChromePalette.ink)
        .accessibilityLabel(copied ? "Copied" : "Copy this phone’s name")
      }
    }
    .padding(.horizontal, 14)
    .frame(maxHeight: .infinity)
    .background { ChromeMaterial.well() }
  }
}

/// The top's capsule: three bars and the step's name, or the tour's four dots (DESIGN.md §8 "The phone's way in").
struct StepsCapsule: View {
  let steps: FieldHomeModel.WayInScreen.Steps
  /// One bar each (WI-3: the lock's third while the way in will offer it).
  let names: [String]

  var body: some View {
    HStack(spacing: 10) {
      switch steps {
      case .step(let step):
        HStack(spacing: 4) {
          ForEach(1...max(names.count, 1), id: \.self) { bar in
            Capsule()
              .fill(bar <= step ? ChromePalette.ink : ChromePalette.keyFill)
              .overlay {
                if bar > step { Capsule().strokeBorder(ChromePalette.keyHairline, lineWidth: 0.5) }
              }
              .frame(width: 22, height: 4)
          }
        }
        Text(Self.name(step, of: names))
          .font(ChromeType.sans(12, .semibold))
          .foregroundStyle(ChromePalette.ink)
      case .dots(let page):
        HStack(spacing: 7) {
          ForEach(0..<4, id: \.self) { dot in
            Circle()
              .fill(dot == page ? ChromePalette.ink : ChromePalette.inkFaint)
              .frame(width: 7, height: 7)
          }
        }
      }
    }
    .padding(.horizontal, 12)
    .frame(height: 30)
    .background { ChromeMaterial.glass(in: Capsule(), shadow: nil) }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
  }

  /// A step's name, held to the names there are.
  nonisolated static func name(_ step: Int, of names: [String]) -> String {
    guard !names.isEmpty else { return "" }
    return names[min(max(step, 1), names.count) - 1]
  }

  private var label: String {
    switch steps {
    case .step(let step): "Step \(min(max(step, 1), names.count)) of \(names.count), \(Self.name(step, of: names))"
    case .dots(let page): "How it works, page \(page + 1) of 4"
    }
  }
}
