import FieldDesign
import FieldTerminal
import SwiftUI

/// The input card: a composer row over a rail of terminal keys, sitting on the
/// session sheet's glass above the keyboard.
///
/// **IOS-5v — the card speaks VibeField.** It used to speak godview: mono
/// labels, `FieldPalette`, a key that inverted rather than filled. That was the
/// integrator's reading of D-i2 and James reversed it on seeing the built card
/// (K-D7, 2026-09-11): *"the bubble swarm view and terminal do have their own
/// style, but they are a small part of our app; our app itself should follow
/// VibeField style."* DESIGN.md §1.1 already said as much — the godview
/// instrument palette is "the deliberate control-room exception", scoped to the
/// agent stage and the terminal deck. So the swarm field and the terminal
/// surface keep `FieldType`/`FieldPalette`, and this card is the CHROME family:
/// SF type, sentence case, a glass card with a hairline over the sheet's own
/// glass, near-colorless, with the KeyboardLab canvas as the instance —
/// `.glass.card` radius 26, `.key` 44 pt radius 9, `.circle` 28 in a 44 pt
/// `.target`, `.chip` a 36 pt pill.
///
/// The copy rule from the design's decision table holds throughout: the word
/// "Live" never reaches the screen. The mode is a terminal glyph, and the strip
/// says what is happening rather than what it is called.
///
/// **IOS-5e — the card at every size and to every reader.** Three environment
/// values reach in here. `dynamicTypeSize` takes the whole card up one step at
/// accessibility sizes (`InputCardMetrics`, where the rule and its reasons
/// live). `accessibilityReduceMotion` turns off the two animations that MOVE
/// something — the `+` glyph's rotation and the mic's breath — and leaves the
/// cross-fades alone, because a fade is what Reduce Motion asks for rather than
/// what it forbids. And every state this card draws as a fill now also SAYS
/// itself (`InputAnnouncement`): armed, locked, released, the mode, the keypad.
public struct InputCard: View {
  private let model: InputCardModel
  // --- IOS-5c: the pasteboard's own state, so the paste chip can appear
  // exactly when there is something new to offer. Optional because a card
  // without a host has no watcher, and the demo fixture is one of those.
  private let pasteboard: PasteboardWatcher?
  // --- end IOS-5c
  /// The composer's measured height. One line at rest; the card grows UPWARD
  /// as the draft does, which is why the row is bottom-aligned.
  @State private var composerHeight: CGFloat = InputCardMetrics.baseRowHeight
  @Environment(\.colorScheme) private var colorScheme
  // --- IOS-5e ---------------------------------------------------------------
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  /// Passed down to the fans, which are presentations and cannot read an
  /// environment the card has not handed them.
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  // --- end IOS-5e -----------------------------------------------------------

  public init(model: InputCardModel, pasteboard: PasteboardWatcher? = nil) {
    self.model = model
    self.pasteboard = pasteboard
  }

  /// The canvas's geometry: the card is `padding: 8` with `gap: 6` between its
  /// rows and `gap: 4` inside one; the chips row stands 8 above it, and the
  /// whole stack is inset 9 from the screen's edges (`.chrome`).
  private static let rowGap: CGFloat = 6
  private static let keyGap: CGFloat = 4
  private static let stackGap: CGFloat = 8
  private static let padding: CGFloat = 8
  private static let inset: CGFloat = 9

  private var rowHeight: CGFloat { InputCardMetrics.rowHeight(for: dynamicTypeSize) }
  private var labelSize: CGFloat { InputCardMetrics.labelSize(for: dynamicTypeSize) }
  private var glyphSize: CGFloat { InputCardMetrics.glyphSize(for: dynamicTypeSize) }
  private var circleSide: CGFloat { InputCardMetrics.circleDiameter(for: dynamicTypeSize) }
  private var actionGlyph: CGFloat { InputCardMetrics.actionGlyphSize(for: dynamicTypeSize) }

  public var body: some View {
    // --- IOS-5c: three faces, not one. With the keyboard down the card is a
    // single row (the design's `MainClosed`); with it up, the contextual chips
    // row rides above the card whenever it has something to say.
    Group {
      if model.keyboardOwner == .none {
        ClosedRow(model: model, pasteboard: pasteboard)
      } else {
        VStack(spacing: Self.stackGap) {
          if !ChipsRow.isEmpty(model: model, pasteboard: pasteboard) {
            ChipsRow(model: model, pasteboard: pasteboard)
              // IOS-5e: opacity and nothing else, at every motion setting. The
              // row arriving is the only thing that changes, and a chip that
              // flew in from an edge would be the one piece of this card that
              // moved for decoration.
              .transition(.opacity)
          }
          card
        }
      }
    }
    .padding(.horizontal, Self.inset)
    .padding(.bottom, Self.rowGap)
    // --- IOS-5e: the card's widest, centred. See `InputCardMetrics.maximumWidth`
    // — across an iPad's 1024 pt inset the nine keys would be 108 pt buttons
    // under the middle of the screen, where no thumb is.
    .frame(maxWidth: InputCardMetrics.maximumWidth + Self.inset * 2)
    .frame(maxWidth: .infinity)
    // --- end IOS-5e
    // --- IOS-5d ---------------------------------------------------------------
    // The keypad's hidden responder for Live (K-D5). It is zero-size and never
    // hit, but it must be IN the hierarchy at all times: `becomeFirstResponder`
    // on a view with no window returns false, and the moment it is needed is
    // the moment the terminal is giving the keyboard up.
    .background {
      KeypadHost(model: model)
        .frame(width: 0, height: 0)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
    .animation(FieldMotion.ease(0.18), value: model.keypadShown)
    // --- end IOS-5d -----------------------------------------------------------
    .animation(FieldMotion.ease(0.24), value: model.chips)
    .animation(FieldMotion.ease(0.24), value: pasteboard?.hasNewContent ?? false)
    .animation(FieldMotion.ease(0.24), value: model.keyboardOwner)
    // --- end IOS-5c
  }

  /// `.glass.card` — the card itself. Glass on glass, exactly as the canvas
  /// draws it: this sits on the session sheet, which is already the system's
  /// own material, and the hairline plus the specular top edge are what make
  /// two translucent layers read as two rather than as haze.
  private var card: some View {
    VStack(spacing: Self.rowGap) {
      if model.mode == .draft {
        draftRow
      } else {
        terminalStrip
      }
      rail
    }
    .padding(Self.padding)
    .chromeGlass(radius: ChromeRadius.card)
  }

  // MARK: - Row 1

  /// Draft: the `+`, the field and Send.
  ///
  /// Both of the design's other controls are here now: `+` at the far left
  /// (IOS-5d — Scan text · Snippets · Clipboard history; the attach items wait
  /// on a mesh file verb, K-D6) and the mic immediately left of Send (IOS-5d's
  /// rider — it needed the Speech framework and its usage strings). Send is the
  /// one prominent control: the canvas's `.circle.prominent`, the desktop
  /// Composer's own foot.
  ///
  /// The row's spacing is ZERO, like the canvas's: every control is a 44 pt
  /// `.target` around a 28 pt circle, so the air between them is the targets'
  /// own and the whole row is still one unbroken strip of tappable chrome.
  private var draftRow: some View {
    HStack(alignment: .bottom, spacing: 0) {
      // --- IOS-5d: the far left of the row, the desktop Composer's own foot.
      PlusMenu(model: model)
      // --- end IOS-5d
      ComposerField(
        model: model,
        height: $composerHeight,
        keyboardAppearance: colorScheme == .dark ? .dark : .light,
        // IOS-5v: `.field` — SF 17/22, the one piece of prose on the card, so
        // it is the one size here that scales as prose.
        textSize: InputCardMetrics.composerTextSize(for: dynamicTypeSize)
      )
      .frame(height: max(rowHeight, composerHeight))

      // --- IOS-5d mic ---
      DictationKey(model: model)
      // --- end IOS-5d mic ---

      sendKey
    }
  }

  /// Live: the strip and Enter. The draft is not gone — it is held in the
  /// model and comes back untouched when the mode flips.
  ///
  /// The strip carries no fill of its own (the canvas's `.strip` is a bare
  /// row): in this mode the field is not a field, and drawing a key-shaped box
  /// where the text goes would promise one.
  private var terminalStrip: some View {
    HStack(spacing: Self.keyGap) {
      // --- IOS-5d: the same door, in the same place. The design's strip keeps
      // `+` where the composer had it — a snippet is as useful with the
      // terminal holding the keys as with the draft holding them.
      PlusMenu(model: model)
      // --- end IOS-5d
      HStack(spacing: 8) {
        FieldGlyph(.prompt, size: FieldGlyph.box(for: glyphSize))
        Text("Typing into terminal")
          .font(
            ChromeType.sans(InputCardMetrics.stripSize(for: dynamicTypeSize), .semibold)
          )
          // IOS-5e: one line, always. At accessibility sizes on the narrowest
          // phone this sentence is wider than the strip, and both other ways
          // out are worse than an ellipsis — wrapping makes the strip taller
          // than the row it shares, and shrinking makes it the one label on the
          // card smaller than the keys beside it.
          .lineLimit(1)
          .truncationMode(.tail)
      }
      .foregroundStyle(ChromePalette.inkStrip)
      .padding(.horizontal, 10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .frame(height: rowHeight)
      .accessibilityElement()
      // A truncated strip still says the whole sentence: the ellipsis is a fact
      // about the width, not about the mode.
      .accessibilityLabel("Typing into terminal")

      key(
        glyph: .return, label: "Enter", width: rowHeight,
        action: { model.tapKey(.enter) })
    }
  }

  /// Send is never disabled. `.circle.quiet` with an empty draft, and the
  /// canvas's one `.circle.prominent` with text in it — an empty draft still
  /// sends, as Enter, because "run it" is a real act with nothing left to type.
  private var sendKey: some View {
    let carries = !model.draft.isEmpty
    return Button {
      // IOS-5e: felt only when something LEFT. The empty path is Enter, and a
      // keystroke on this card is never felt. Read before the tap, because
      // `tapSend` clears the draft on its way past.
      let carried = !model.draft.isEmpty
      model.tapSend()
      if carried { InputHaptics.sent() }
    } label: {
      circleFace(
        glyph: .arrow,
        fill: carries ? ChromePalette.circleProminentFill : ChromePalette.circleQuietFill,
        hairline: carries ? nil : ChromePalette.circleHairline,
        ink: carries ? ChromePalette.circleProminentInk : ChromePalette.circleQuietInk)
    }
    .buttonStyle(ChromePressStyle())
    .accessibilityLabel("Send")
    // IOS-5e: the one control here whose act cannot be guessed from its name.
    // An arrow that sometimes sends a paste AND an Enter and sometimes sends
    // only Enter has to say both before the tap.
    .accessibilityHint(
      "Sends the draft as a paste followed by Enter; with an empty draft, sends Enter")
  }

  /// `.target` around `.circle` — the composer row's own control shape, shared
  /// by Send here and restated by `PlusMenu` and `DictationKey`, which are
  /// their own views for reasons that have nothing to do with their chrome.
  private func circleFace(
    glyph: FieldGlyphName, fill: Color, hairline: Color?, ink: Color
  ) -> some View {
    FieldGlyph(glyph, size: FieldGlyph.box(for: actionGlyph))
      .foregroundStyle(ink)
      .frame(width: circleSide, height: circleSide)
      .background { ChromeMaterial.circle(fill: fill, hairline: hairline) }
      .frame(width: rowHeight, height: rowHeight)
  }

  // MARK: - Row 2, the rail

  /// Nine equal keys, `⋯` last (IOS-5d).
  ///
  /// Every key but the mode toggle carries a long-press fan (IOS-5b): the
  /// chords under Ctrl, the far ends under the arrows, ⇧Tab under Tab, and the
  /// Meta burst under Esc.
  private var rail: some View {
    HStack(spacing: Self.keyGap) {
      key(
        glyph: .prompt,
        label: model.mode == .live ? "Typing into terminal" : "Type into terminal",
        tone: model.mode == .live ? .on : .normal,
        action: {
          model.toggleMode()
          // IOS-5e: the mode is drawn as a lit key and a changed row, and both
          // are invisible to a reader whose focus is elsewhere on the card.
          // Announced AFTER the flip, so it names the mode now in force.
          InputAnnouncement.post(InputAnnouncement.mode(model.mode))
        })
      escapeKey
      controlKey
      key(text: "Tab", label: "Tab", fan: .tab, action: { model.tapKey(.tab) })
      key(
        glyph: .arrow, turn: -90, label: "Left arrow", tone: .nav, fan: KeyFan.arrow(.arrowLeft),
        action: { model.tapKey(.arrowLeft) })
      key(
        glyph: .arrow, turn: 180, label: "Down arrow", tone: .nav, fan: KeyFan.arrow(.arrowDown),
        action: { model.tapKey(.arrowDown) })
      key(
        glyph: .arrow, label: "Up arrow", tone: .nav, fan: KeyFan.arrow(.arrowUp),
        action: { model.tapKey(.arrowUp) })
      key(
        glyph: .arrow, turn: 90, label: "Right arrow", tone: .nav, fan: KeyFan.arrow(.arrowRight),
        action: { model.tapKey(.arrowRight) })
      // --- IOS-5d ------------------------------------------------------------
      // The keypad key. It lights while the keypad is up, like every other key
      // on this card that is holding a state — and it carries no fan: the
      // design's long-press (the keypad's last page) is what a tap already
      // does, the page being remembered.
      key(
        glyph: .ellipsis,
        label: model.keypadShown ? "Letters" : "Terminal keypad",
        tone: model.keypadShown ? .on : .normal,
        action: {
          model.toggleKeypad()
          // IOS-5e: the letters just left, or came back. Without this a screen
          // reader finds out by exploring the keyboard again and meeting a
          // different one.
          InputAnnouncement.post(InputAnnouncement.keypad(model.keypadShown))
        })
      // --- end IOS-5d --------------------------------------------------------
    }
    // --- IOS-5e: the rail is one thing, and VoiceOver should say so before it
    // reads nine keys. `.contain` rather than `.combine`: every key still has
    // to be reachable and tappable on its own, and combining them would make
    // the rail a single button that does nothing.
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Terminal keys")
    // --- end IOS-5e
    // --- IOS-5c: swipe the rail down to put the keyboard away.
    //
    // There is no scroll view on this sheet to hang
    // `.scrollDismissesKeyboard(.interactively)` on — the session card is a
    // VStack over a Metal surface — and the terminal below cannot take the
    // gesture either, because a drag there is a selection. So the rail itself
    // is the handle: it is the one strip of chrome that exists in both modes
    // and holds no scrollable content of its own. Simultaneous rather than
    // exclusive so the keys keep their taps; 20 pt before it engages, so a
    // finger sliding off a key is still a key.
    .simultaneousGesture(
      DragGesture(minimumDistance: 20)
        .onEnded { value in
          guard value.translation.height > 24, abs(value.translation.width) < 44 else { return }
          model.dismissKeyboard()
        }
    )
    // --- end IOS-5c
  }

  // --- IOS-5b ---------------------------------------------------------------
  /// Esc, and the Meta burst it holds.
  ///
  /// While the burst is armed the key says Meta and wears the canvas's
  /// `.key.armed` fill: the next key is about to mean something different, and
  /// the only place that can be said is the key that armed it. It still sends
  /// Escape when tapped — the burst rides the next keystroke, and Escape is one.
  private var escapeKey: some View {
    key(
      text: model.metaArmed ? "Meta" : "Esc",
      label: model.metaArmed ? "Escape, Meta armed for the next key" : "Escape",
      tone: model.metaArmed ? .armed : .normal,
      fan: .escape,
      action: { model.tapKey(.escape) })
  }
  // --- end IOS-5b -----------------------------------------------------------

  /// The sticky Ctrl. Armed is `.key.armed` and locked is `.key.locked` — one
  /// step brighter, with the dot — because "this stays until I release it" is a
  /// different promise from "this is spent on the next key" and a single fill
  /// cannot say both.
  private var controlKey: some View {
    let phase = model.latch.phase
    let tone: KeyTone = phase == .locked ? .locked : (phase == .armed ? .armed : .normal)
    return Button {
      // --- IOS-5b ---
      // The fan just opened under the finger; the touch-up that follows is the
      // long press ending, not a tap on Ctrl.
      guard model.openFan == nil else { return }
      model.tapControl()
      // Felt, not just seen: armed and locked are two different promises and a
      // fill alone cannot say which at arm's length. The VIEW reads the phase
      // the model just moved to — haptics are presentation, and the model has
      // no UIKit in it on purpose.
      switch model.latch.phase {
      case .armed: InputHaptics.arm()
      case .locked: InputHaptics.lock()
      case .off: InputHaptics.release()
      }
      // --- end IOS-5b ---
      // --- IOS-5e ---
      // And said, for the reason it is felt. This is the design's own
      // acceptance item (§10: "VoiceOver announces Ctrl armed and locked"), and
      // it is the one state on the card that changes what a key SOMEWHERE ELSE
      // will do — the label alone only reaches a reader focused on Ctrl.
      InputAnnouncement.post(InputAnnouncement.latch(model.latch.phase))
      // --- end IOS-5e ---
    } label: {
      Text("Ctrl")
        .font(ChromeType.sans(labelSize, .semibold, rounded: true))
        .tracking(ChromeType.keyTracking)
        .foregroundStyle(tone.ink)
        .lineLimit(1)
        .frame(maxWidth: .infinity)
        .frame(height: rowHeight)
        .background { keyFace(tone) }
        .overlay(alignment: .topTrailing) {
          // `.key.locked::after` — a 5 pt dot inset 5 from the corner.
          if phase == .locked {
            Circle()
              .fill(ChromePalette.keyArmedInk)
              .frame(width: 5, height: 5)
              .padding(5)
          }
        }
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel(model.latch.accessibilityLabel)
    // IOS-5e: what the NEXT tap does, which on a three-phase control cannot be
    // guessed from the phase it is in.
    .accessibilityHint(model.latch.accessibilityHint)
    // --- IOS-5b: the chord fan ---
    .fan(.control, on: model, reduceMotion: reduceMotion, pick: pick)
    // --- end IOS-5b ---
  }

  // MARK: - Key chrome

  private func key(
    text: String,
    label: String,
    tone: KeyTone = .normal,
    fan: KeyFan? = nil,
    action: @escaping () -> Void
  ) -> some View {
    Button {
      // IOS-5b: a long press that opened a fan still ends in a touch-up, and
      // that touch-up is not a tap on this key.
      guard model.openFan == nil else { return }
      action()
    } label: {
      Text(text)
        .font(ChromeType.sans(labelSize, .semibold, rounded: true))
        .tracking(ChromeType.keyTracking)
        .foregroundStyle(tone.ink)
        .lineLimit(1)
        .frame(maxWidth: .infinity)
        .frame(height: rowHeight)
        .background { keyFace(tone) }
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel(label)
    .fan(fan, on: model, reduceMotion: reduceMotion, pick: pick)
  }

  /// `width` is the strip's Enter and nothing else: rail keys are equal-width
  /// by division, and a fixed one among them would break the grid.
  private func key(
    glyph: FieldGlyphName,
    turn: Double = 0,
    label: String,
    tone: KeyTone = .normal,
    width: CGFloat? = nil,
    fan: KeyFan? = nil,
    action: @escaping () -> Void
  ) -> some View {
    Button {
      guard model.openFan == nil else { return }
      action()
    } label: {
      FieldGlyph(glyph, size: FieldGlyph.box(for: glyphSize), turn: turn)
        .foregroundStyle(tone.ink)
        .frame(maxWidth: width == nil ? .infinity : nil)
        .frame(width: width, height: rowHeight)
        .background { keyFace(tone) }
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel(label)
    .fan(fan, on: model, reduceMotion: reduceMotion, pick: pick)
  }

  // --- IOS-5b ---------------------------------------------------------------
  /// A key was picked out of an open fan.
  ///
  /// The fan closes first so the act cannot land twice, then the chord goes —
  /// `tapChord`, which spends an armed latch without adding to a chord that
  /// already names its own modifiers. Meta is the one item that arms instead of
  /// sending.
  private func pick(_ item: KeyFan.Item) {
    model.closeFan()
    switch item.act {
    case .stroke(let stroke): model.tapChord(stroke)
    case .meta:
      model.armMeta()
      // IOS-5e: an arm is an arm. The burst changes what the next key means and
      // its only sign is Esc wearing Meta, which a reader elsewhere cannot see.
      InputAnnouncement.post(InputAnnouncement.metaArmed)
    }
    InputHaptics.chord()
  }
  // --- end IOS-5b -----------------------------------------------------------

  /// One recipe for every key on the card, at whatever height the reader's text
  /// size asks for: the canvas's `.key`, and its four state variants.
  private func keyFace(_ tone: KeyTone) -> some View {
    ChromeMaterial.key(
      fill: tone.fill, hairline: tone.hairline, hairlineWidth: tone.hairlineWidth)
  }
}

/// A key's state, as the canvas names them: `.key`, `.key.nav`, `.key.armed`,
/// `.key.locked`, `.key.on`.
///
/// A state carries a FILL rather than an inversion. The godview card inverted
/// (`textMain` under `panelBackground`) because contrast is how that language
/// says attention; the chrome family says it with material — a brighter cap,
/// its border, and the ink that cap needs — which is what lets the rail read as
/// nine physical keys in both themes rather than as nine swatches.
enum KeyTone {
  case normal
  case nav
  case armed
  case locked
  case on

  var fill: Color {
    switch self {
    case .normal: return ChromePalette.keyFill
    case .nav: return ChromePalette.keyFillNav
    case .armed: return ChromePalette.keyArmedFill
    case .locked: return ChromePalette.keyLockedFill
    case .on: return ChromePalette.keyOnFill
    }
  }

  var ink: Color {
    switch self {
    case .normal: return ChromePalette.keyInk
    case .nav: return ChromePalette.keyInkNav
    case .armed, .locked: return ChromePalette.keyArmedInk
    case .on: return ChromePalette.keyOnInk
    }
  }

  var hairline: Color? {
    switch self {
    case .normal: return ChromePalette.keyHairline
    case .nav: return ChromePalette.keyHairlineNav
    case .armed, .locked: return ChromePalette.keyArmedBorder
    case .on: return nil
    }
  }

  /// §2.3: a heavier weight exists only as meaning. 1.5 pt is the selection
  /// weight, and a latched modifier is the card's one selection.
  var hairlineWidth: CGFloat {
    switch self {
    case .armed, .locked: return 1.5
    default: return 0.5
    }
  }
}

/// The canvas's `.key.pressed`: a veil over whatever the key already is, rather
/// than SwiftUI's default button highlight, which tints.
///
/// It is a fill and not an opacity because that is what the canvas draws, and
/// because dimming a translucent key on glass makes the terminal behind it
/// brighter — the one direction a press must never read as.
struct KeyPressStyle: ButtonStyle {
  var radius: CGFloat = ChromeRadius.key

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .overlay {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
          .fill(ChromePalette.keyPressedFill)
          .opacity(configuration.isPressed ? 1 : 0)
      }
      .animation(FieldMotion.ease(0.08), value: configuration.isPressed)
  }
}

/// The press feedback for the round controls, which are 28 pt circles inside
/// 44 pt targets: a veil the shape of the target would be a rectangle lighting
/// up around a circle, so these dim instead.
struct ChromePressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .opacity(configuration.isPressed ? 0.55 : 1)
      .animation(FieldMotion.ease(0.08), value: configuration.isPressed)
  }
}
