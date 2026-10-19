import SwiftUI

extension InsettableShape {
  /// CSS's `box-shadow: inset 0 0 <blur> <spread> <color>`: a light inside this
  /// shape, falling off from its edge. Godview's frames are lit this way, and
  /// the phone's live card wears them (DESIGN.md §8, "The phone's live card is
  /// its terminal": the pane frame's glow, and a held seat's light).
  ///
  /// The CSS shadow is everything outside the shape inset by `spread`, blurred
  /// to a deviation of `blur / 2` and clipped to the shape. Here that region is
  /// a band of the colour from the `spread` line outward to three deviations
  /// past the edge, which is all a blur carries inside: the kit's inset recipe
  /// (`strokeBorder`, `blur`, `mask`, as the coin's sunk field draws it) with the
  /// spread kept. A negative spread starts the band outside the edge, so only
  /// the blur's tail reaches in.
  public func insetGlow(_ color: Color, blur: CGFloat, spread: CGFloat = 0) -> some View {
    let deviation = max(0, blur / 2)
    let band = max(0, spread + 3 * deviation)
    return inset(by: spread - band)
      .strokeBorder(color, lineWidth: band)
      .blur(radius: deviation)
      .mask { self }
  }
}
