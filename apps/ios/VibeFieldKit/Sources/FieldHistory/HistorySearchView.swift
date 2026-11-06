import FieldDesign
import SwiftUI

// RETIRED 2026-11-06 (SE-2, SE-D3 A; DESIGN.md §8 "The phone's search"): `HistorySearchView`, search's page (the
// scopes, recent searches, hits under session heads, the quiet states). Search is a glass sheet over the field now
// (FieldHome's `PhoneSearchSheet`, deciding through `PhoneSearch`), Everything is History's search as it was, and its
// hits land here through the router as they did. The match stepper a landed search rides the bar with stays.

/// The match stepper — the island's third role (IOS-9e: a glass capsule the
/// bar carries above itself, or inline between its circles while folded):
/// the query word, `2 of 3`, and the two steps.
public struct HistoryStepperView: View {
  @Bindable var router: HistoryRouter

  public init(router: HistoryRouter) {
    self.router = router
  }

  public var body: some View {
    if let landed = router.landed {
      HStack(spacing: 4) {
        Text(landed.query)
          .font(ChromeType.sans(15, .semibold))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
          .truncationMode(.tail)
        Text(landed.words)
          .font(ChromeType.sans(13))
          .monospacedDigit()
          .foregroundStyle(ChromePalette.inkTertiary)
          .lineLimit(1)
          .padding(.leading, 6)
        Spacer(minLength: 6)
        stepButton("chevron.up", "Previous match") { router.step(-1) }
        stepButton("chevron.down", "Next match") { router.step(1) }
      }
      .padding(.leading, 18)
      .padding(.trailing, 6)
      .frame(maxWidth: .infinity, minHeight: 44)
    }
  }

  private func stepButton(_ glyph: String, _ label: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: glyph)
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(ChromePalette.inkSecondary)
        .frame(width: 40, height: 40)
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}
