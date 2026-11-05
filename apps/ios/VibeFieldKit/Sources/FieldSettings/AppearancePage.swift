import FieldDesign
import SwiftUI

/// Settings › Appearance (IOS-10a): Light, Dark or Auto — the Mac's three
/// (FC-D5) — for this phone. The window takes it at once
/// (`phoneAppearance(_:)`), so this page, the sheet behind it and the field
/// all change as it is picked; nothing waits for a save.
struct AppearancePage: View {
  @Binding var look: PhoneAppearance

  var body: some View {
    List {
      Section {
        HStack(alignment: .top, spacing: 10) {
          ForEach(PhoneAppearance.allCases) { option in
            LookChoice(option: option, selected: look == option) { look = option }
              .frame(maxWidth: .infinity)
          }
        }
        .padding(.vertical, 16)
      } header: {
        ChromeListHead("Look", tags: [FactTag(DeviceWord.current.This), FactTag("Live")])
      } footer: {
        ChromeListFoot(SettingsWords.lookFoot(DeviceWord.current))
      }
      .chromeRows()
    }
    .chromeList()
    .navigationTitle("Appearance")
    .navigationBarTitleDisplayMode(.inline)
  }
}

/// One look: a small page drawn in it, its word, and the radio under it.
private struct LookChoice: View {
  let option: PhoneAppearance
  let selected: Bool
  let choose: () -> Void

  var body: some View {
    Button(action: choose) {
      VStack(spacing: 10) {
        LookSketch(option: option)
        Text(option.word)
          .font(ChromeListType.detail.weight(.medium))
          .foregroundStyle(ChromePalette.ink)
        ZStack {
          Circle()
            .strokeBorder(selected ? ChromePalette.ink : ChromePalette.placeholder, lineWidth: 1.5)
          if selected {
            Circle().fill(ChromePalette.ink)
            FieldGlyph(.check, size: 13)
              .foregroundStyle(ChromePalette.switchKnob)
          }
        }
        .frame(width: 22, height: 22)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(option.word)
    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
  }
}

/// A settings page in miniature, in the look it names: the paper, a title, and
/// four rows on their fill. Each half is drawn with the palette set to that
/// look, so the sketch shows the real colours rather than a copy of them; Auto
/// is both, split on the diagonal.
private struct LookSketch: View {
  let option: PhoneAppearance

  var body: some View {
    ZStack {
      switch option {
      case .light:
        page.environment(\.colorScheme, .light)
      case .dark:
        page.environment(\.colorScheme, .dark)
      case .auto:
        page.environment(\.colorScheme, .light)
        page.environment(\.colorScheme, .dark)
          .clipShape(Diagonal())
      }
    }
    .frame(width: 74, height: 150)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .strokeBorder(ChromePalette.ruleStrong, lineWidth: 1)
    }
    .shadow(color: ChromeShadow.card.color, radius: ChromeShadow.card.radius, y: ChromeShadow.card.y)
    .accessibilityHidden(true)
  }

  private var page: some View {
    VStack(alignment: .leading, spacing: 6) {
      Capsule()
        .fill(ChromePalette.ink)
        .frame(width: 34, height: 7)
        .padding(.top, 18)
        .padding(.bottom, 8)
      ForEach(0..<4, id: \.self) { _ in
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .fill(ChromePalette.fill)
          .frame(height: 16)
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 9)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(ChromePalette.paper)
  }
}

/// The lower-right half of a rectangle, cut on its diagonal.
private struct Diagonal: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.move(to: CGPoint(x: rect.maxX, y: rect.minY))
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
    path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
    path.closeSubpath()
    return path
  }
}
