import FieldDesign
import FieldTerminal
import SwiftUI

/// The input card: a composer row over a rail of terminal keys, sitting on the
/// session sheet's glass above the keyboard.
///
/// The design this re-skins (KeyboardLab's "Composer + Rail") is drawn in SF
/// on white glass; the field speaks godview mono (D-i2), so every label here
/// is `FieldType.mono`, every color comes from `FieldPalette`, and a key that
/// is ON inverts rather than colors — attention is contrast in this app, never
/// hue. The card carries no background of its own: the sheet's liquid glass is
/// the surface, and each key is a chip on it.
///
/// The copy rule from the design's decision table holds throughout: the word
/// "Live" never reaches the screen. The mode is a terminal glyph, and the strip
/// says what is happening rather than what it is called.
///
/// **IOS-5e — the card at every size and to every reader.** Three environment
/// values reach in here now. `dynamicTypeSize` takes the whole card up one step
/// at accessibility sizes (`InputCardMetrics`, where the rule and its reasons
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

  /// The design's geometry: 8 pt padding, 6 pt gaps, 44 pt rows — 110 pt of
  /// chrome at one line. The row height and every type size on the card are the
  /// numbers that move with the reader's text size, and they move in
  /// `InputCardMetrics` rather than here.
  private static let gap: CGFloat = 6
  private static let padding: CGFloat = 8
  private static let cornerRadius: CGFloat = 6

  private var rowHeight: CGFloat { InputCardMetrics.rowHeight(for: dynamicTypeSize) }
  private var labelSize: CGFloat { InputCardMetrics.labelSize(for: dynamicTypeSize) }
  private var glyphSize: CGFloat { InputCardMetrics.glyphSize(for: dynamicTypeSize) }

  public var body: some View {
    // --- IOS-5c: three faces, not one. With the keyboard down the card is a
    // single row (the design's `MainClosed`); with it up, the contextual chips
    // row rides above row 1 whenever it has something to say.
    Group {
      if model.keyboardOwner == .none {
        ClosedRow(model: model, pasteboard: pasteboard)
      } else {
        VStack(spacing: Self.gap) {
          if !ChipsRow.isEmpty(model: model, pasteboard: pasteboard) {
            ChipsRow(model: model, pasteboard: pasteboard)
              // IOS-5e: opacity and nothing else, at every motion setting. The
              // row arriving is the only thing that changes, and a chip that
              // flew in from an edge would be the one piece of this card that
              // moved for decoration.
              .transition(.opacity)
          }
          if model.mode == .draft {
            draftRow
          } else {
            terminalStrip
          }
          rail
        }
      }
    }
    .padding(Self.padding)
    // --- IOS-5e: the card's widest, centred. See `InputCardMetrics.maximumWidth`
    // — across an iPad's 1024 pt inset the nine keys would be 108 pt buttons
    // under the middle of the screen, where no thumb is.
    .frame(maxWidth: InputCardMetrics.maximumWidth)
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

  // MARK: - Row 1

  /// Draft: the `+`, the field and Send.
  ///
  /// Both of the design's other controls are here now: `+` at the far left
  /// (IOS-5d — Scan Text · Snippets · Clipboard History; the attach items wait
  /// on a mesh file verb, K-D6) and the mic immediately left of Send (IOS-5d's
  /// rider — it needed the Speech framework and its usage strings). Send stays
  /// the one inverted-solid control: the desktop Composer's own foot.
  private var draftRow: some View {
    HStack(alignment: .bottom, spacing: Self.gap) {
      // --- IOS-5d: the far left of the row, the desktop Composer's own foot.
      PlusMenu(model: model)
      // --- end IOS-5d
      ComposerField(
        model: model,
        height: $composerHeight,
        keyboardAppearance: colorScheme == .dark ? .dark : .light,
        // IOS-5e: the one prose-sized mono on the card (K-D7), so it is the one
        // size that scales as prose rather than as an instrument marking.
        textSize: InputCardMetrics.composerTextSize(for: dynamicTypeSize)
      )
      .frame(height: max(rowHeight, composerHeight))
      .background(keyShape(inverted: false))

      // --- IOS-5d mic ---
      DictationKey(model: model)
      // --- end IOS-5d mic ---

      sendKey
    }
  }

  /// Live: the strip and Enter. The draft is not gone — it is held in the
  /// model and comes back untouched when the mode flips.
  private var terminalStrip: some View {
    HStack(spacing: Self.gap) {
      // --- IOS-5d: the same door, in the same place. The design's strip keeps
      // `+` where the composer had it — a snippet is as useful with the
      // terminal holding the keys as with the draft holding them.
      PlusMenu(model: model)
      // --- end IOS-5d
      HStack(spacing: 7) {
        Image(systemName: "terminal")
          .font(.system(size: glyphSize, weight: .heavy))
        Text("Typing into terminal")
          .font(FieldType.mono(labelSize, .heavy))
          .tracking(FieldType.tracking(0.08, of: labelSize))
          // IOS-5e: one line, always. At accessibility sizes on the narrowest
          // phone this sentence is wider than the strip, and both other ways
          // out are worse than an ellipsis — wrapping makes the strip taller
          // than the row it shares, and shrinking makes it the one label on the
          // card smaller than the keys beside it.
          .lineLimit(1)
          .truncationMode(.tail)
      }
      .foregroundStyle(FieldPalette.textMain)
      .padding(.horizontal, 11)
      .frame(maxWidth: .infinity, alignment: .leading)
      .frame(height: rowHeight)
      .background(keyShape(inverted: false))
      .accessibilityElement()
      // A truncated strip still says the whole sentence: the ellipsis is a fact
      // about the width, not about the mode.
      .accessibilityLabel("Typing into terminal")

      key(
        glyph: "return", label: "Enter", width: rowHeight,
        action: { model.tapKey(.enter) })
    }
  }

  /// Send is never disabled. Quiet with an empty draft, inverted with text —
  /// and an empty draft still sends, as Enter, because "run it" is a real act
  /// with nothing left to type.
  private var sendKey: some View {
    Button {
      // IOS-5e: felt only when something LEFT. The empty path is Enter, and a
      // keystroke on this card is never felt. Read before the tap, because
      // `tapSend` clears the draft on its way past.
      let carried = !model.draft.isEmpty
      model.tapSend()
      if carried { InputHaptics.sent() }
    } label: {
      Image(systemName: "arrow.up")
        .font(
          .system(size: InputCardMetrics.actionGlyphSize(for: dynamicTypeSize), weight: .heavy)
        )
        .foregroundStyle(
          model.draft.isEmpty ? FieldPalette.textMuted : FieldPalette.panelBackground
        )
        .frame(width: rowHeight, height: rowHeight)
        .background(keyShape(inverted: !model.draft.isEmpty))
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel("Send")
    // IOS-5e: the one control here whose act cannot be guessed from its name.
    // An arrow that sometimes sends a paste AND an Enter and sometimes sends
    // only Enter has to say both before the tap.
    .accessibilityHint(
      "Sends the draft as a paste followed by Enter; with an empty draft, sends Enter")
  }

  // MARK: - Row 2, the rail

  /// Nine equal keys, `⋯` last (IOS-5d).
  ///
  /// Every key but the mode toggle carries a long-press fan (IOS-5b): the
  /// chords under CTRL, the far ends under the arrows, ⇧TAB under TAB, and the
  /// Meta burst under ESC.
  private var rail: some View {
    HStack(spacing: Self.gap) {
      key(
        glyph: "terminal",
        label: model.mode == .live ? "Typing into terminal" : "Type into terminal",
        inverted: model.mode == .live,
        action: {
          model.toggleMode()
          // IOS-5e: the mode is drawn as a lit key and a changed row, and both
          // are invisible to a reader whose focus is elsewhere on the card.
          // Announced AFTER the flip, so it names the mode now in force.
          InputAnnouncement.post(InputAnnouncement.mode(model.mode))
        })
      escapeKey
      controlKey
      key(text: "TAB", label: "Tab", fan: .tab, action: { model.tapKey(.tab) })
      key(
        glyph: "arrow.left", label: "Left arrow", fan: KeyFan.arrow(.arrowLeft),
        action: { model.tapKey(.arrowLeft) })
      key(
        glyph: "arrow.down", label: "Down arrow", fan: KeyFan.arrow(.arrowDown),
        action: { model.tapKey(.arrowDown) })
      key(
        glyph: "arrow.up", label: "Up arrow", fan: KeyFan.arrow(.arrowUp),
        action: { model.tapKey(.arrowUp) })
      key(
        glyph: "arrow.right", label: "Right arrow", fan: KeyFan.arrow(.arrowRight),
        action: { model.tapKey(.arrowRight) })
      // --- IOS-5d ------------------------------------------------------------
      // The keypad key. It INVERTS while the keypad is up, like every other
      // key on this card that is holding a state — and it carries no fan: the
      // design's long-press (the keypad's last page) is what a tap already
      // does, the page being remembered.
      key(
        glyph: "ellipsis",
        label: model.keypadShown ? "Letters" : "Terminal keypad",
        inverted: model.keypadShown,
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
  /// ESC, and the Meta burst it holds.
  ///
  /// While the burst is armed the key says META and inverts: the next key is
  /// about to mean something different, and the only place that can be said is
  /// the key that armed it. It still sends Escape when tapped — the burst rides
  /// the next keystroke, and Escape is one.
  private var escapeKey: some View {
    key(
      text: model.metaArmed ? "META" : "ESC",
      label: model.metaArmed ? "Escape, Meta armed for the next key" : "Escape",
      inverted: model.metaArmed,
      fan: .escape,
      action: { model.tapKey(.escape) })
  }
  // --- end IOS-5b -----------------------------------------------------------

  /// The sticky Ctrl. Armed and locked both invert; locked adds the dot,
  /// because "this stays until I release it" is a different promise from
  /// "this is spent on the next key" and a single fill cannot say both.
  private var controlKey: some View {
    let armed = model.latch.phase != .off
    return Button {
      // --- IOS-5b ---
      // The fan just opened under the finger; the touch-up that follows is the
      // long press ending, not a tap on CTRL.
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
      // will do — the label alone only reaches a reader focused on CTRL.
      InputAnnouncement.post(InputAnnouncement.latch(model.latch.phase))
      // --- end IOS-5e ---
    } label: {
      Text("CTRL")
        .font(FieldType.mono(labelSize, .heavy))
        .tracking(FieldType.tracking(0.08, of: labelSize))
        .foregroundStyle(armed ? FieldPalette.panelBackground : FieldPalette.textMain)
        .frame(maxWidth: .infinity)
        .frame(height: rowHeight)
        .background(keyShape(inverted: armed))
        .overlay(alignment: .topTrailing) {
          if model.latch.phase == .locked {
            Circle()
              .fill(FieldPalette.panelBackground)
              .frame(width: 4, height: 4)
              .padding(4)
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
    inverted: Bool = false,
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
        .font(FieldType.mono(labelSize, .heavy))
        .tracking(FieldType.tracking(0.08, of: labelSize))
        .foregroundStyle(inverted ? FieldPalette.panelBackground : FieldPalette.textMain)
        .frame(maxWidth: .infinity)
        .frame(height: rowHeight)
        .background(keyShape(inverted: inverted))
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel(label)
    .fan(fan, on: model, reduceMotion: reduceMotion, pick: pick)
  }

  /// `width` is the strip's Enter and nothing else: rail keys are equal-width
  /// by division, and a fixed one among them would break the grid.
  private func key(
    glyph: String,
    label: String,
    inverted: Bool = false,
    width: CGFloat? = nil,
    fan: KeyFan? = nil,
    action: @escaping () -> Void
  ) -> some View {
    Button {
      guard model.openFan == nil else { return }
      action()
    } label: {
      Image(systemName: glyph)
        .font(.system(size: glyphSize, weight: .heavy))
        .foregroundStyle(inverted ? FieldPalette.panelBackground : FieldPalette.textMain)
        .frame(maxWidth: width == nil ? .infinity : nil)
        .frame(width: width, height: rowHeight)
        .background(keyShape(inverted: inverted))
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
  /// already names its own modifiers. META is the one item that arms instead of
  /// sending.
  private func pick(_ item: KeyFan.Item) {
    model.closeFan()
    switch item.act {
    case .stroke(let stroke): model.tapChord(stroke)
    case .meta:
      model.armMeta()
      // IOS-5e: an arm is an arm. The burst changes what the next key means and
      // its only sign is ESC wearing META, which a reader elsewhere cannot see.
      InputAnnouncement.post(InputAnnouncement.metaArmed)
    }
    InputHaptics.chord()
  }
  // --- end IOS-5b -----------------------------------------------------------

  /// One shape for every key on the card: the `FieldChip` recipe, at whatever
  /// height the reader's text size asks for.
  @ViewBuilder
  private func keyShape(inverted: Bool) -> some View {
    if inverted {
      RoundedRectangle(cornerRadius: Self.cornerRadius)
        .fill(FieldPalette.textMain)
    } else {
      RoundedRectangle(cornerRadius: Self.cornerRadius)
        .fill(FieldPalette.panelBackground.opacity(0.8))
        .overlay(
          RoundedRectangle(cornerRadius: Self.cornerRadius)
            .strokeBorder(FieldPalette.panelBorder, lineWidth: 1)
        )
    }
  }
}

/// Press feedback without SwiftUI's default button highlight, which tints and
/// would put a hue on a monochrome key.
struct KeyPressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .opacity(configuration.isPressed ? 0.55 : 1)
      .animation(FieldMotion.ease(0.08), value: configuration.isPressed)
  }
}
