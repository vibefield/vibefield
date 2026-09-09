import FieldDesign
import SwiftUI
import UIKit

/// Saved commands and prompts, and the editor that makes one.
///
/// The sheet is a list and an editor in the same surface rather than two
/// sheets: writing a snippet is something a person does WHILE looking at the
/// ones they already have, and a second presentation over the first would hide
/// exactly the thing they were about to copy.
///
/// Nothing is seeded. An app that ships someone else's `git` aliases is
/// guessing at their shell, so the empty state says what to do in words
/// instead — the D-i6 reading of a list with nothing in it.
public struct SnippetsSheet: View {
  private let store: SnippetStore
  private let onUse: (Snippet) -> Void

  /// The snippet being written, or none. A fresh `Snippet` rather than a set
  /// of loose fields, so SAVE has nothing to assemble.
  @State private var editing: Snippet?
  @State private var isNew = false

  public init(store: SnippetStore, onUse: @escaping (Snippet) -> Void) {
    self.store = store
    self.onUse = onUse
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      if let editing {
        SnippetEditor(
          snippet: editing,
          onSave: { saved in
            if isNew { store.add(saved) } else { store.update(saved) }
            self.editing = nil
          },
          onCancel: { self.editing = nil }
        )
        .padding(.top, 14)
      } else if store.snippets.isEmpty {
        empty
      } else {
        list
      }
      Spacer(minLength: 0)
    }
    .padding(.top, 26)
    .frame(maxWidth: .infinity, alignment: .leading)
    // No background: the sheet's liquid glass is the surface.
  }

  private var header: some View {
    HStack(alignment: .firstTextBaseline) {
      Text("SNIPPETS")
        .font(FieldType.mono(9, .heavy))
        .tracking(FieldType.tracking(0.18, of: 9))
        .foregroundStyle(FieldPalette.textMuted)
      Spacer(minLength: 0)
      if editing == nil {
        Button {
          isNew = true
          editing = Snippet(title: "", text: "", sendsEnter: false)
        } label: {
          Text("NEW")
            .font(FieldType.mono(9, .heavy))
            .tracking(FieldType.tracking(0.12, of: 9))
            .foregroundStyle(FieldPalette.textMain)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .overlay(
              RoundedRectangle(cornerRadius: 6)
                .strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("New snippet")
      }
    }
    .padding(.horizontal, 22)
  }

  private var empty: some View {
    Text("no snippets yet — NEW makes one")
      .font(FieldType.mono(11))
      .foregroundStyle(FieldPalette.textMuted)
      .padding(.horizontal, 22)
      .padding(.top, 18)
  }

  /// A `List` for the swipe, with its own chrome taken off so the sheet's
  /// glass stays the surface — the same treatment the settings sheet gives its
  /// theme list.
  private var list: some View {
    List {
      ForEach(store.snippets) { snippet in
        Button {
          onUse(snippet)
        } label: {
          row(snippet)
        }
        .buttonStyle(.plain)
        .listRowBackground(Color.clear)
        .listRowSeparatorTint(FieldPalette.panelBorder)
        .listRowInsets(EdgeInsets(top: 10, leading: 22, bottom: 10, trailing: 22))
      }
      .onDelete { offsets in store.delete(atOffsets: offsets) }
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .padding(.top, 8)
  }

  private func row(_ snippet: Snippet) -> some View {
    HStack(alignment: .top, spacing: 10) {
      VStack(alignment: .leading, spacing: 3) {
        Text(snippet.title.isEmpty ? snippet.firstLine : snippet.title)
          .font(FieldType.mono(11, .medium))
          .foregroundStyle(FieldPalette.textMain)
          .lineLimit(1)
        Text(snippet.firstLine)
          .font(FieldType.mono(9))
          .foregroundStyle(FieldPalette.textMuted)
          .lineLimit(1)
      }
      Spacer(minLength: 0)
      // The one mark that changes what a tap DOES, so it is on the row rather
      // than inside the snippet.
      if snippet.sendsEnter {
        Text("\u{23CE}")
          .font(FieldType.mono(11, .heavy))
          .foregroundStyle(FieldPalette.textMuted)
          .accessibilityLabel("sends Enter")
      }
    }
    .contentShape(Rectangle())
  }
}

/// The inline editor: a title, the text, and the one decision that matters.
struct SnippetEditor: View {
  @State private var title: String
  @State private var text: String
  @State private var sendsEnter: Bool
  private let identity: UUID
  private let onSave: (Snippet) -> Void
  private let onCancel: () -> Void

  init(snippet: Snippet, onSave: @escaping (Snippet) -> Void, onCancel: @escaping () -> Void) {
    _title = State(initialValue: snippet.title)
    _text = State(initialValue: snippet.text)
    _sendsEnter = State(initialValue: snippet.sendsEnter)
    identity = snippet.id
    self.onSave = onSave
    self.onCancel = onCancel
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      // The title's own traits are off for the same reason the composer's are:
      // this is a name for a command, and a capitalized `git` is a different
      // word.
      TextField("", text: $title, prompt: Text("title").foregroundStyle(FieldPalette.textFaint))
        .font(FieldType.mono(13))
        .foregroundStyle(FieldPalette.textMain)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .padding(.horizontal, 10)
        .frame(height: 40)
        .background(fieldShape)
        .accessibilityLabel("Snippet title")

      SnippetTextView(text: $text)
        .frame(height: 110)
        .background(fieldShape)
        .accessibilityLabel("Snippet text")

      HStack(spacing: 10) {
        // A chip rather than a `Toggle`: a switch is the one control in this
        // app that says on/off with a colour, and attention here is contrast.
        Button {
          sendsEnter.toggle()
        } label: {
          Text("\u{23CE} SENDS ENTER")
            .font(FieldType.mono(9, .heavy))
            .tracking(FieldType.tracking(0.08, of: 9))
            .foregroundStyle(sendsEnter ? FieldPalette.panelBackground : FieldPalette.textMuted)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(
              RoundedRectangle(cornerRadius: 6)
                .fill(
                  sendsEnter
                    ? AnyShapeStyle(FieldPalette.textMain)
                    : AnyShapeStyle(FieldPalette.panelBackground.opacity(0.8)))
            )
            .overlay(
              RoundedRectangle(cornerRadius: 6)
                .strokeBorder(
                  sendsEnter ? Color.clear : FieldPalette.panelBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(sendsEnter ? "Sends Enter, on" : "Sends Enter, off")
        .accessibilityAddTraits(sendsEnter ? [.isSelected] : [])

        Spacer(minLength: 0)

        Button {
          onSave(
            Snippet(
              id: identity,
              title: title.isEmpty ? String(text.prefix(24)) : title,
              text: text,
              sendsEnter: sendsEnter))
        } label: {
          Text("SAVE")
            .font(FieldType.mono(9, .heavy))
            .tracking(FieldType.tracking(0.12, of: 9))
            .foregroundStyle(FieldPalette.panelBackground)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 6).fill(FieldPalette.textMain))
        }
        .buttonStyle(.plain)
        // Never disabled: an empty snippet simply is not saved, and a greyed
        // SAVE would explain nothing about why.
        .disabled(false)

        Button(action: onCancel) {
          Text("CANCEL")
            .font(FieldType.mono(9, .heavy))
            .tracking(FieldType.tracking(0.12, of: 9))
            .foregroundStyle(FieldPalette.textMain)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .overlay(
              RoundedRectangle(cornerRadius: 6)
                .strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
      }
    }
    .padding(.horizontal, 22)
  }

  private var fieldShape: some View {
    RoundedRectangle(cornerRadius: 6)
      .fill(FieldPalette.panelBackground.opacity(0.8))
      .overlay(
        RoundedRectangle(cornerRadius: 6)
          .strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
  }
}

/// The snippet body, on the composer's own text view.
///
/// It reuses `InputTextView` rather than a SwiftUI `TextEditor` for exactly the
/// reason `ComposerField` does: a snippet is a command, and autocorrection,
/// smart quotes and smart dashes turn `--flag` into an en dash and `"$HOME"`
/// into curled quotes. A snippet corrupted at the moment it is WRITTEN is
/// worse than one corrupted when it is typed, because it stays wrong.
struct SnippetTextView: UIViewRepresentable {
  @Binding var text: String

  func makeCoordinator() -> Coordinator { Coordinator(text: $text) }

  func makeUIView(context: Context) -> InputTextView {
    let view = InputTextView()
    view.delegate = context.coordinator
    view.autocorrectionType = .no
    view.spellCheckingType = .no
    view.smartQuotesType = .no
    view.smartDashesType = .no
    view.smartInsertDeleteType = .no
    view.autocapitalizationType = .none
    view.inputAccessoryView = nil
    view.backgroundColor = .clear
    view.isScrollEnabled = true
    view.placeholder = "the command or prompt"
    view.text = text
    return view
  }

  func updateUIView(_ view: InputTextView, context: Context) {
    context.coordinator.text = $text
    view.textColor = UIColor(FieldPalette.textMain)
    view.tintColor = UIColor(FieldPalette.textMain)
    view.placeholderColor = UIColor(FieldPalette.textFaint)
    if view.text != text {
      view.text = text
      view.refreshPlaceholder()
    }
  }

  @MainActor
  final class Coordinator: NSObject, UITextViewDelegate {
    var text: Binding<String>

    init(text: Binding<String>) {
      self.text = text
    }

    func textViewDidChange(_ textView: UITextView) {
      text.wrappedValue = textView.text
      (textView as? InputTextView)?.refreshPlaceholder()
    }
  }
}
