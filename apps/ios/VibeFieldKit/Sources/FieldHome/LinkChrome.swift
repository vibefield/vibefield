import FieldDesign
import SwiftUI

/// The sentence under the mesh chip: the field's own leg, in words (IOS-4e).
///
/// `FieldLink` has known three things since IOS-4b — which desktops this phone
/// can hear, how well, and whether anything is arriving — and until now no
/// screen read any of them. A desktop whose door REFUSED this phone, one that
/// is on the mesh and serves no product surface, and one still dialing all
/// produced the same picture: a field whose centre reads "NO ACTIVE AGENTS"
/// with nothing anywhere saying why. That is the blank design-00 forbids
/// ("honest states, never blanks"), and the corner is where the why goes,
/// because the corner is already where this app puts facts about reach.
///
/// The voice is the CORNER's rather than the chrome family's: DESIGN.md §1.1
/// scopes the godview instrument palette to the control room, this line sits
/// under `MeshChip` over the swarm, and a second type family on one strip
/// would be two markings that do not match. Nothing here is hued — attention
/// is contrast, the rule `MeshChip` states and the only thing this corner has
/// ever used to mean "something needs you".
///
/// It is a fact and never a control, so it takes no touch: the field's own
/// gesture runs underneath it, and a caption that swallowed a hold would cost
/// the user a bubble.
struct LinkLine: View {
  let text: String
  let wantsAttention: Bool

  /// The caption's own bound, not a token: DESIGN.md gives no width for a
  /// corner sentence, and this number exists so a long device name wraps once
  /// in the corner instead of running the width of the field.
  private static let maximumWidth: CGFloat = 240

  var body: some View {
    Text(text)
      .font(FieldType.mono(9))
      .foregroundStyle(wantsAttention ? FieldPalette.textMain : FieldPalette.textMuted)
      .lineLimit(2)
      .multilineTextAlignment(.leading)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: Self.maximumWidth, alignment: .leading)
      .allowsHitTesting(false)
  }
}
