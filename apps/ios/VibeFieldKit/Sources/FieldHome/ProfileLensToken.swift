import FieldDesign
import FieldHistory
import FieldProduct
import SwiftUI

/// SE-2 (UM-D27 A, ruled 2026-11-06 on the page *The Bands Meter*; DESIGN.md §8 "The phone's profile token"; the
/// drawing's `round4.css` `.ltok`, `.lmenu`, `.lm-chk` and `p4f-frames.js` `lensMark`, `lensMenu`) — THE TOKEN ABOVE
/// SEARCH: the chosen profile (the phone's one lens, `ProfileLens`) stands beside search as a shape of its own glass,
/// and its menu picks the lens. `ProfileLensTokenTests` pins its measure, its rows, when it shows and its words.
enum LensToken {
  /// The shape: 40 tall, corners 20, at most 250 wide, padded 0 7 0 4, its parts 2 apart.
  static let height: CGFloat = 40
  static let radius: CGFloat = height / 2
  static let maxWidth: CGFloat = 250
  static let leading: CGFloat = 4
  static let trailing: CGFloat = 7
  static let parts: CGFloat = 2
  /// Its name: a 32 button, corners 16, padded 0 7 0 10 — the profile's glyph at 15, then, 7 on, the name at 15/600.
  static let nameHeight: CGFloat = 32
  static let nameRadius: CGFloat = nameHeight / 2
  static let nameLeading: CGFloat = 10
  static let nameTrailing: CGFloat = 7
  static let nameGlyph: CGFloat = 15
  static let nameGap: CGFloat = 7
  static let nameText: CGFloat = 15
  /// Its ×: a 26 round on the ink at 8% holding `xmark` at 10 in the secondary ink (§13).
  static let close: CGFloat = 26
  static let closeGlyph: CGFloat = 10
  /// Where: its right edge on the search circle's, its foot 10 above the circle — inside the bar's melt (12), so the
  /// token keeps a glass container of its own.
  static let right: CGFloat = AppBar.margin
  static let aboveCircle: CGFloat = 10
  /// It grows out of the search circle's middle (half the circle in from its right edge, 10 and half the circle below
  /// its foot), from 0.35, on the bar's spring.
  static let growFrom: CGFloat = 0.35
  static let growOrigin = CGSize(width: -AppBar.height / 2, height: aboveCircle + AppBar.height / 2)
  /// The menu: the Me menu's solid chrome and rows, 262 wide, corners 26, its foot 8 above the token, 6 under its last
  /// row; it pops from the token (the drawing's origin, 50 in and 20 below its foot), from 0.55, over 380ms on the
  /// island curve.
  static let menuWidth: CGFloat = 262
  static let menuRadius: CGFloat = 26
  static let menuGap: CGFloat = 8
  static let menuFoot: CGFloat = 6
  static let menuPopFrom: CGFloat = 0.55
  static let menuPop: Double = 0.38
  static let menuOrigin = CGSize(width: -50, height: 20)
  /// A row's 34 check column (a check at 14 on the one shown); Every profile's glyph at 19, a profile's at 18, and
  /// Agent Profiles…'s view lead at 26: the Me menu's own row's circle of every plan (`AgentProfilesMenuRow`, SE-P5b).
  static let checkColumn: CGFloat = 34
  static let checkGlyph: CGFloat = 14
  static let everyGlyph: CGFloat = 19
  static let profileGlyph: CGFloat = 18
  static let viewLead = CGFloat(AgentProfilesMenuRow.size)
  /// Reduce Motion (M6): the token and its menu fade in over 120ms at full size, with no growth and no pop.
  static let reducedFade: Double = SearchSheet.reducedFade

  /// The × says what it does (the drawing's `aria-label`).
  static let clearWords = "Show every profile"
  /// The menu's eyebrow over the profiles, and its name.
  static let eyebrow = "Show"
  static let everyWord = "Every profile"
  /// The row that opens the Agent Profiles page.
  static let pageWord = "Agent Profiles…"

  /// The token's foot above the screen's bottom edge: the bar's band.
  static func bottom(homeInset: CGFloat) -> CGFloat { AppBar.band(homeInset: homeInset) }

  /// The menu's foot above the screen's bottom edge: 8 above the token's top.
  static func menuBottom(homeInset: CGFloat) -> CGFloat { bottom(homeInset: homeInset) + height + menuGap }

  /// One row of the menu that picks a profile.
  struct Item: Equatable, Identifiable {
    /// The profile it shows; nil shows every profile.
    let pick: String?
    /// Its glyph: the profile's, or nil for every profile's.
    let lead: PhoneSearch.Lead?
    let label: String
    /// Its sessions ("3 sessions").
    let word: String
    /// It is the one shown.
    let checked: Bool

    var id: String { pick ?? "" }
  }

  /// The menu's picking rows as they stand on screen, top to bottom — so from the bottom, nearest first: **Every
  /// profile** with every session on the field, then each of the home's profiles, the home's first nearest, with its
  /// sessions (the home's runs under it: the lens is self-only); a check on the one shown.
  static func items(_ lens: ProfileLens, live: PhoneSearch.Live) -> [Item] {
    let profiles = lens.profiles.reversed().map { set in
      Item(
        pick: set.id, lead: PhoneSearch.lead(set), label: set.label,
        word: PhoneSearch.plural(live.sessions(of: set.id).count, "session"), checked: lens.profile == set.id)
    }
    let every = Item(
      pick: nil, lead: nil, label: everyWord, word: PhoneSearch.plural(live.sessions.count, "session"),
      checked: lens.profile == nil)
    return profiles + [every]
  }

  /// It shows on Field at rest only, while a profile is chosen: never while the face is held, while another menu or a
  /// page is open, or while search is open (Chat's note stacks above it).
  static func shows(
    _ lens: ProfileLens, onField: Bool, searchOpen: Bool, faceHeld: Bool, menuOpen: Bool, pageOpen: Bool
  ) -> Bool {
    lens.chosen != nil && onField && !searchOpen && !faceHeld && !menuOpen && !pageOpen
  }

  /// The token's spoken name (the drawing's group label).
  static func spoken(_ profile: AgentProfileSet) -> String { "Showing only \(profile.label)" }

  /// The token grows out of the search circle on the bar's spring; under Reduce Motion it fades in place.
  static func grow(reduceMotion: Bool) -> AnyTransition {
    reduceMotion
      ? AnyTransition.opacity.animation(FieldMotion.plainEase(reducedFade))
      : AnyTransition.modifier(
        active: PopFrom(scale: growFrom, origin: growOrigin, shown: false),
        identity: PopFrom(scale: growFrom, origin: growOrigin, shown: true)
      ).animation(AppBar.motion)
  }

  /// The menu pops from the token over 380ms on the island curve; under Reduce Motion it fades in place.
  static func pop(reduceMotion: Bool) -> AnyTransition {
    reduceMotion
      ? AnyTransition.opacity.animation(FieldMotion.plainEase(reducedFade))
      : AnyTransition.modifier(
        active: PopFrom(scale: menuPopFrom, origin: menuOrigin, shown: false),
        identity: PopFrom(scale: menuPopFrom, origin: menuOrigin, shown: true)
      ).animation(FieldMotion.island(menuPop))
  }

  /// Scales about a point given from the view's bottom-trailing corner (`origin`): about that corner, then moved back
  /// by what the scale moved the point.
  private struct PopFrom: ViewModifier {
    let scale: CGFloat
    let origin: CGSize
    let shown: Bool

    func body(content: Content) -> some View {
      let factor = shown ? 1 : scale
      content
        .scaleEffect(factor, anchor: .bottomTrailing)
        .offset(x: (1 - factor) * origin.width, y: (1 - factor) * origin.height)
        .opacity(shown ? 1 : 0)
    }
  }
}

/// The token: the chosen profile's name, which opens the menu, and its ×, which shows every profile — in the bar's
/// glass, in a glass container of its own. It says how wide its glass stands (`onWidth`): the stage draws it over
/// every view, and the swarm's chrome keeps the bodies out of a frame that wide where it stands.
struct ProfileLensToken: View {
  let profile: AgentProfileSet
  let menuOpen: Bool
  let onMenu: () -> Void
  let onClear: () -> Void
  /// The glass's width, each time it changes (the name ellipsises inside `LensToken.maxWidth`).
  let onWidth: (CGFloat) -> Void

  var body: some View {
    GlassGroup {
      HStack(spacing: LensToken.parts) {
        Button(action: onMenu) {
          HStack(spacing: LensToken.nameGap) {
            SearchLeadGlyph(lead: PhoneSearch.lead(profile), size: LensToken.nameGlyph)
            Text(profile.label)
              .font(ChromeType.sans(LensToken.nameText, .semibold))
              .lineLimit(1)
          }
          .foregroundStyle(ChromePalette.ink)
          .padding(.leading, LensToken.nameLeading)
          .padding(.trailing, LensToken.nameTrailing)
          .frame(height: LensToken.nameHeight)
          .contentShape(RoundedRectangle(cornerRadius: LensToken.nameRadius, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(LensToken.spoken(profile))
        .accessibilityValue(menuOpen ? "menu open" : "")
        .accessibilityHint("Opens the profiles to show")
        Button(action: onClear) {
          Image(systemName: "xmark")
            .font(.system(size: LensToken.closeGlyph, weight: .semibold))
            .foregroundStyle(ChromePalette.inkSecondary)
            .frame(width: LensToken.close, height: LensToken.close)
            .background(Circle().fill(ChromePalette.searchWell))
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(LensToken.clearWords)
      }
      .padding(.leading, LensToken.leading)
      .padding(.trailing, LensToken.trailing)
      .frame(height: LensToken.height)
      .liquidGlassCapsule()
      .onGeometryChange(for: CGFloat.self) { proxy in
        proxy.size.width
      } action: { width in
        onWidth(width)
      }
    }
    .frame(maxWidth: LensToken.maxWidth, alignment: .trailing)
  }
}

/// The token's menu, in the Me menu's solid chrome and rows (§8 "The phone's corner"), top to bottom as it stands:
/// **Agent Profiles…**, led by the Me menu's own circle of every plan at 26 with nothing in its middle (SE-P5b: the
/// Me menu's row, `AgentProfilesMenuRow`, one value for both menus; it says no word here, as drawn), and a hairline;
/// the eyebrow **Show**; and the picking rows (`LensToken.items`), each a radio. The caller lays a clear scrim under it
/// that closes it.
struct ProfileLensMenu: View {
  let items: [LensToken.Item]
  /// A pick: the lens shows that profile (nil: every profile), and the menu closes.
  let onPick: (String?) -> Void
  /// Agent Profiles…: its circle, and its act — the menu folds and the Agent Profiles page opens (UM-4's PH-4). It
  /// always stands: there is always a page to open.
  let page: AgentProfilesMenuRow

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      AccountMenuRow(label: LensToken.pageWord, action: page.open) {
        // the row says its name; the page says every plan, so the circle is not read before the name (the Me menu's)
        BandsDial(geometry: page.geometry, mark: page.mark)
          .accessibilityHidden(true)
      }
      Rectangle()
        .fill(ChromePalette.separator)
        .frame(height: 1)
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
      ChromeEyebrow(LensToken.eyebrow)
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .accessibilityAddTraits(.isHeader)
      ForEach(items) { item in
        LensMenuRow(item: item) { onPick(item.pick) }
      }
    }
    .padding(.top, 6)
    .padding(.horizontal, 6)
    .padding(.bottom, LensToken.menuFoot)
    .frame(width: LensToken.menuWidth, alignment: .leading)
    .background { ChromeMaterial.floating(radius: LensToken.menuRadius) }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(LensToken.eyebrow)
    // SE-2l — over its clear scrim the menu is all VoiceOver reaches, as it is all a touch reaches
    .accessibilityAddTraits(.isModal)
  }
}

/// A picking row: the Me menu's row (its 50 lead column, the label at 15, the word at 13 in the tertiary ink, 44
/// tall), with the one shown at 600 and a 34 check column at its end — a radio.
private struct LensMenuRow: View {
  let item: LensToken.Item
  let onPick: () -> Void

  var body: some View {
    Button(action: onPick) {
      HStack(spacing: 4) {
        Group {
          if let lead = item.lead {
            SearchLeadGlyph(lead: lead, size: LensToken.profileGlyph)
          } else {
            // Every profile's mark, from the phone's one table (`ProfileGlyphSymbols`, §13)
            Image(systemName: ProfileGlyphSymbols.everyProfile)
              .font(.system(size: LensToken.everyGlyph, weight: .regular))
          }
        }
        .foregroundStyle(ChromePalette.inkSecondary)
        .frame(width: AccountCornerView.circle - 12)
        Text(item.label)
          .font(ChromeType.sans(15, item.checked ? .semibold : .medium))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
        Spacer(minLength: 8)
        Text(item.word)
          .font(ChromeType.sans(13))
          .monospacedDigit()
          .foregroundStyle(ChromePalette.inkTertiary)
          .lineLimit(1)
        FieldGlyph(.check, size: LensToken.checkGlyph)
          .foregroundStyle(ChromePalette.ink)
          .opacity(item.checked ? 1 : 0)
          .frame(width: LensToken.checkColumn)
          .accessibilityHidden(true)
      }
      .frame(minHeight: 44)
      .contentShape(RoundedRectangle(cornerRadius: ChromeRadius.row, style: .continuous))
    }
    .buttonStyle(AccountRowStyle())
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(item.checked ? [.isSelected] : [])
  }
}
