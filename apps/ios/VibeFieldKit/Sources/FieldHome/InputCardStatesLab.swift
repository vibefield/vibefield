// RB-2e — the Developer page's Input card states lab (DESIGN.md §8 "The phone's Settings", amended 2026-11-12; §9
// "Developer"). The whole file is compiled only into TestFlight and development builds, as the page that opens it is,
// so the build submitted for App Review carries neither the lab nor its words.
#if DEBUG || VF_TESTFLIGHT
  import FieldAgents
  import FieldDesign
  import FieldInput
  import FieldSettings
  import FieldTerminal
  import SwiftUI

  /// One state of the lab: the input card where a long press, a held key or the microphone would otherwise leave it,
  /// named as §9 "Developer" names it (asked for 2026-11-12). Each is reached by the card's own public acts on a fresh
  /// model, so a state the lab shows is a state the card can be in, and a test holds every one without a view.
  enum InputCardLabState: CaseIterable {
    /// A long press on Ctrl: its chord fan.
    case fanOpen
    /// One tap on Ctrl: the next key carries Control.
    case controlArmed
    /// Two taps: Control stays until a third releases it.
    case controlLocked
    /// A long press on Esc: Meta rides the next key.
    case metaArmed
    /// The mic, with heard words in the draft.
    case listening
    /// The keypad in the system keyboard's place, on each of its three pages.
    case keypadNavigate
    case keypadShortcuts
    case keypadFn
    /// A paste long enough to be read before it goes in.
    case pasteToRead
    /// An agent waiting on a permission, answered from the card.
    case replyChips
    /// The keys go to the terminal rather than the draft.
    case typingIntoTerminal

    /// Its name on the lab's list, §9's word for word.
    var name: String {
      switch self {
      case .fanOpen: "A key’s fan, open"
      case .controlArmed: "Control, armed"
      case .controlLocked: "Control, locked"
      case .metaArmed: "Meta, armed"
      case .listening: "Listening"
      case .keypadNavigate: "The keypad, Navigate"
      case .keypadShortcuts: "The keypad, Shortcuts"
      case .keypadFn: "The keypad, Fn"
      case .pasteToRead: "A paste to read first"
      case .replyChips: "Reply chips"
      case .typingIntoTerminal: "Typing into terminal"
      }
    }

    /// Whether the mic wears its listening look while the state stands (`DictationSession.labListening`). The lab
    /// sets the flag before the card is drawn, so the look shows with no microphone, no Speech and no audio session,
    /// and clears it when the state leaves.
    var listens: Bool { self == .listening }

    /// The words the Listening state's draft holds, put there by the card's own dictation rule.
    private static let heard = "run the tests and show me what fails"

    /// The paste the review holds: five made-up lines, the count at which a paste is read before it goes in
    /// (`InputCardModel.pasteReviewLines`), in DESIGN.md's made-up names.
    private static let paste = """
      #!/bin/sh
      set -eu
      cd ~/code/garden-planner
      git pull --ff-only
      make test
      """

    /// The card's model, moved into the state: the lab's sink first, which takes nothing, then the state's own acts.
    /// Every draft state asks for the keyboard first, as the card's keyboard key does, so the card stands open.
    @MainActor func seed(_ model: InputCardModel) {
      // Nothing typed in the lab is sent: every act is refused, and the card keeps what was typed.
      model.sink = { _ in false }
      switch self {
      case .fanOpen:
        model.requestKeyboard()
        model.showFan(.control)
      case .controlArmed:
        model.requestKeyboard()
        model.tapControl()
      case .controlLocked:
        model.requestKeyboard()
        model.tapControl()
        model.tapControl()
      case .metaArmed:
        model.requestKeyboard()
        model.armMeta()
      case .listening:
        model.requestKeyboard()
        model.appendDictation(Self.heard)
      case .keypadNavigate:
        Self.showKeypad(.keys, on: model)
      case .keypadShortcuts:
        Self.showKeypad(.combos, on: model)
      case .keypadFn:
        Self.showKeypad(.functions, on: model)
      case .pasteToRead:
        // A paste is held for reading only in the terminal's mode: in the draft it is already on screen.
        model.toggleMode()
        model.acceptPaste(Self.paste)
      case .replyChips:
        model.requestKeyboard()
        // The shipping row for an agent whose own terminal draws its permission dialog, asked of the chips' table
        // rather than named here, over a made-up permission: no desktop asked the question.
        if let typed = FieldInput.typedDialogAgents.first {
          model.chips = FieldInput.replyChips(provider: typed, permissions: [AgentPermission(tool: "Bash")])
        }
      case .typingIntoTerminal:
        model.toggleMode()
      }
    }

    /// What the lab does each second the state stands. Two states last three seconds by design, and the card's own
    /// clock would end them before anyone had looked: the lab arms them again while they stand, and leaves them the
    /// moment a key spends them or a tap moves them. Every other state keeps itself.
    @MainActor func keep(_ model: InputCardModel) {
      switch self {
      case .controlArmed:
        // A tap on an armed Ctrl locks it, so the latch goes round once more in one turn (locked, off, armed): no
        // frame shows the two between, and the arm's window starts again.
        guard model.latch.phase == .armed else { return }
        model.tapControl()
        model.tapControl()
        model.tapControl()
      case .metaArmed:
        // Arming again restarts the burst's window rather than toggling it (`armMeta`).
        guard model.metaArmed else { return }
        model.armMeta()
      default:
        return
      }
    }

    /// The keypad on `page`, in the system keyboard's place under the draft.
    @MainActor private static func showKeypad(_ page: KeypadPage, on model: InputCardModel) {
      model.requestKeyboard()
      model.keypadPage = page
      model.setKeypad(true)
    }
  }

  /// The lab (the swarm lab's form, over the home, with Done): §9's states in a list, and a row opens the real
  /// `InputCard` and `InputOverlay` over a made-up session's ground, on a fresh model moved into the row's state.
  /// Nothing typed there is sent, since the sink takes nothing. The card is handed no attachment, no pasteboard
  /// watcher and no clipboard history, and the `+` menu's doors stay shut, so the lab reads nothing of this phone's.
  struct InputCardStatesLab: View {
    @Environment(\.dismiss) private var dismiss
    /// The state on screen, or none: the list.
    @State private var shown: InputCardLabState?
    /// The model on screen: a fresh one for each state, moved into it before the card is drawn.
    @State private var model = InputCardModel()
    /// The state's clock (`InputCardLabState.keep`), cancelled when the state leaves.
    @State private var keeping: Task<Void, Never>?

    init() {}

    var body: some View {
      NavigationStack {
        Group {
          // The state takes the list's place on the same page, rather than a push: a fan or a review sheet that
          // stands from the card's first frame is never presented mid-transition.
          if let shown {
            InputCardLabStage(model: model)
              .id(shown)
          } else {
            list
          }
        }
        .navigationTitle(shown?.name ?? DeveloperWords.inputCardStates)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          backItem
          closeItem
        }
      }
      .onDisappear { leave() }
      .accessibilityIdentifier("input-card-states")
    }

    /// §9's states, in its order.
    private var list: some View {
      List {
        Section {
          ForEach(InputCardLabState.allCases, id: \.self) { state in
            Button {
              enter(state)
            } label: {
              ChromeRow(state.name)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(state.name)
            .accessibilityAddTraits(.isButton)
          }
        }
        .chromeRows()
      }
      .chromeList()
    }

    /// Back to the list, while a state stands.
    private var backItem: some ToolbarContent {
      ToolbarItem(placement: .topBarLeading) {
        if shown != nil {
          Button {
            backToList()
          } label: {
            Image(systemName: "chevron.backward")
              .fontWeight(.semibold)
          }
          .accessibilityLabel("Back")
        }
      }
    }

    private var closeItem: some ToolbarContent {
      ToolbarItem(placement: .topBarTrailing) {
        if #available(iOS 26.0, *) {
          Button(role: .close) { dismiss() }
        } else {
          Button("Done") { dismiss() }
            .fontWeight(.semibold)
        }
      }
    }

    /// A row was tapped: a fresh model, the mic's look for Listening alone, the state's acts, then the card. The look
    /// is set before the card is drawn, because the mic reads it once, when it is made.
    private func enter(_ state: InputCardLabState) {
      leave()
      let fresh = InputCardModel()
      DictationSession.labListening = state.listens
      state.seed(fresh)
      model = fresh
      shown = state
      keeping = Task { [fresh] in
        while !Task.isCancelled {
          try? await Task.sleep(for: .seconds(1))
          guard !Task.isCancelled else { return }
          state.keep(fresh)
        }
      }
    }

    private func backToList() {
      leave()
      shown = nil
    }

    /// The state leaves: its clock stops and the mic's look is let go, so no other card in this app listens by it.
    private func leave() {
      keeping?.cancel()
      keeping = nil
      DictationSession.labListening = false
    }
  }

  /// One state on screen: the real card and its floating controls over a made-up session's ground (DESIGN.md's
  /// made-up names: the project garden-planner, on the desktop studio), laid out as the live card lays them out.
  private struct InputCardLabStage: View {
    let model: InputCardModel
    /// The terminal's ground in the default look, as the live card paints it behind its terminal.
    private let ground = TerminalGround(presentationConfig(for: .default))

    private static let session = "garden-planner"
    private static let desktop = "studio"
    private static let folder = "~/code/garden-planner"

    init(model: InputCardModel) {
      self.model = model
    }

    var body: some View {
      ZStack(alignment: .topLeading) {
        ground.color.ignoresSafeArea()
        header
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      // Paste, replies and the show and fold key float over the ground; the card below alone takes room.
      .overlay(alignment: .bottom) {
        InputOverlay(model: model)
          .environment(\.colorScheme, ground.inkScheme)
      }
      .safeAreaInset(edge: .bottom, spacing: 0) {
        InputCard(model: model)
      }
      // A long paste, read before it goes through, presented as the live card presents it. Send is refused by the
      // sink, so the sheet stays until Cancel.
      .sheet(item: review) { pending in
        PasteReviewSheet(
          text: pending.text,
          commit: pending.commit,
          onSend: { model.confirmPasteReview() },
          onCancel: { model.cancelPasteReview() }
        )
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(40)
        .fieldGlassSheet()
      }
      // The `+` menu's doors are the home's (the snippets, the clipboard's history, the camera): the lab opens none.
      .onChange(of: model.surface) { _, surface in
        if surface != nil { model.closeSurface() }
      }
      // The bar stands on the ground, so it wears the ground's ink, as the overlay does.
      .toolbarBackground(.visible, for: .navigationBar)
      .toolbarColorScheme(ground.inkScheme, for: .navigationBar)
    }

    /// The made-up session the card types into: its name, its desktop and its folder, in the ground's ink.
    private var header: some View {
      VStack(alignment: .leading, spacing: 2) {
        Text(Self.session)
          .font(ChromeType.sans(ChromeType.stripSize, .semibold))
          .foregroundStyle(ChromePalette.ink)
        Text(Self.desktop)
          .font(ChromeType.sans(ChromeType.rowSummarySize))
          .foregroundStyle(ChromePalette.inkTertiary)
        Text(Self.folder)
          .font(ChromeType.mono(ChromeType.rowSummarySize))
          .foregroundStyle(ChromePalette.inkSecondary)
          .padding(.top, 8)
      }
      .padding(16)
      .environment(\.colorScheme, ground.inkScheme)
      .accessibilityElement(children: .combine)
    }

    /// Every way the review closes that is not Send is a Cancel, the swipe included.
    private var review: Binding<PendingPaste?> {
      Binding(
        get: { model.pendingPasteReview },
        set: { if $0 == nil { model.cancelPasteReview() } })
    }
  }
#endif
