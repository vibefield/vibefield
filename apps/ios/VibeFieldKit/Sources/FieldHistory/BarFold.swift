import SwiftUI

extension View {
  /// Scrolling down folds the app's bar to its selected glyph; scrolling back
  /// up opens it (IOS-9e). The decision is `FieldHistoryModel.barFold`; this
  /// only feeds it the scroll's offset and writes the answer to the router.
  public func foldsBar(_ router: HistoryRouter) -> some View {
    modifier(FoldsBar(router: router))
  }
}

private struct FoldsBar: ViewModifier {
  let router: HistoryRouter
  @State private var anchor: CGFloat = 0

  func body(content: Content) -> some View {
    content.onScrollGeometryChange(for: CGFloat.self) { geometry in
      geometry.contentOffset.y + geometry.contentInsets.top
    } action: { _, offset in
      let next = FieldHistoryModel.barFold(minimized: router.barMinimized, anchor: anchor, offset: offset)
      anchor = next.anchor
      if router.barMinimized != next.minimized { router.barMinimized = next.minimized }
    }
  }
}
