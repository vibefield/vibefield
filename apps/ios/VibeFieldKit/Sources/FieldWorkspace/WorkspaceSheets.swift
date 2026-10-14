import FieldDesign
import FieldProduct
import SwiftUI
import UIKit

/// Folder first; the chooser has its own presenter above a single-detent
/// launch sheet. Agent choices never change the launch sheet's height.
///
/// PJ-7 — Profile · Model · Effort, menu rows that never come or go; a choice
/// with one answer, or none, is said in its row (DESIGN.md §8's FS-2 entry).
/// The folder row comes filled with the usual place, else the folder sheet
/// opens by itself.
public struct CreateSessionSheet: View {
  @Bindable private var model: WorkspaceLaunch
  @State private var choosingFolder = false
  @Environment(\.dismiss) private var dismiss
  public init(model: WorkspaceLaunch) { self.model = model }

  public var body: some View {
    NavigationStack {
      Form {
        Section {
          Button { choosingFolder = true } label: {
            HStack {
              Image(systemName: "folder")
              VStack(alignment: .leading) {
                if let place = model.place {
                  Text(place.label)
                  Text(model.desktops.first { $0.id == place.desktop }?.name ?? "")
                    .font(.caption).foregroundStyle(ChromePalette.inkSecondary)
                } else {
                  Text(model.folder == nil ? "Choose a folder" : "Folder")
                  if let folder = model.folder {
                    Text(folder.path).font(.caption.monospaced()).foregroundStyle(ChromePalette.inkSecondary)
                      .lineLimit(1).truncationMode(.middle)
                  }
                }
              }
              Spacer()
              Image(systemName: "chevron.right").foregroundStyle(ChromePalette.inkSecondary)
            }
          }
          .disabled(model.spawning)
          HStack {
            Text("Desktop")
            Spacer()
            if let desktop = model.desktop { WorkspaceDesktopLabel(desktop: desktop) }
            else { Text("Connect a desktop").foregroundStyle(ChromePalette.inkSecondary) }
          }
          if model.agents.count > 1 {
            Picker("Agent", selection: Binding(get: { model.provider }, set: { provider in
              model.provider = provider
              Task { await model.providerChanged() }
            })) {
              ForEach(model.agents) { Text($0.label).tag($0.id) }
            }.disabled(model.spawning)
          } else {
            fact("Agent", model.agents.first?.label ?? "No agent available")
          }
          if let words = model.profileRowWords {
            fact("Profile", words)
          } else {
            Picker("Profile", selection: Binding(get: { model.profileSet ?? "" }, set: { id in
              Task { await model.chooseProfile(id) }
            })) {
              ForEach(model.profileChoices) { Text($0.label).tag($0.id) }
            }.pickerStyle(.menu).disabled(model.spawning)
          }
          if let words = model.modelRowWords {
            fact("Model", words)
          } else {
            Picker("Model", selection: Binding(get: { model.modelId }, set: { model.chooseModel($0) })) {
              Text("Each agent's own").tag(String?.none)
              ForEach(model.modelChoices) { Text($0.label).tag(String?.some($0.id)) }
            }.pickerStyle(.menu).disabled(model.spawning)
          }
          if let words = model.effortRowWords {
            fact("Effort", words)
          } else {
            Picker("Effort", selection: Binding(get: { model.effort }, set: { model.chooseEffort($0) })) {
              Text("Its own").tag(String?.none)
              ForEach(model.model?.effort?.values ?? []) { Text($0.label).tag(String?.some($0.id)) }
            }.pickerStyle(.menu).disabled(model.spawning)
          }
        } footer: {
          Text(model.footer)
            .foregroundStyle(ChromePalette.inkSecondary)
        }
        Button {
          Task {
            // DESIGN.md §8: success or warning at the birth
            let born = await model.spawn()
            UINotificationFeedbackGenerator().notificationOccurred(born ? .success : .warning)
            if born { dismiss() }
          }
        } label: {
          HStack {
            Spacer()
            if model.spawning { ProgressView().tint(ChromePalette.keyOnInk) }
            else { FieldGlyph(.start, size: FieldGlyph.box(for: 15)) }
            Text(model.spawning ? "Starting…" : "Start \(model.agents.first { $0.id == model.provider }?.label ?? "session")")
            Spacer()
          }
        }
        .buttonStyle(ChromePillStyle(.primary))
        .opacity(model.canSpawn || model.spawning ? 1 : 0.4)
        .disabled(!model.canSpawn)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
      }
      .scrollContentBackground(.hidden)
      .background(ChromePalette.paper)
      .navigationTitle("New session")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(model.spawning) } }
      .sheet(isPresented: $choosingFolder) {
        WorkspaceFolderSheet(model: model)
          .presentationDetents([.large])
          .presentationDragIndicator(.visible)
          .presentationCornerRadius(40)
          .fieldGlassSheet()
      }
      .task {
        // PJ-D12 (a): nowhere to start yet, the folder sheet opens by itself
        if model.needsFolder { choosingFolder = true }
        if let device = model.selected { await model.select(device) }
        #if DEBUG
          if let scenario = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("-vf-demo-workspace=") })?.split(separator: "=").last {
            if ["folder", "launch", "refused", "spawning"].contains(String(scenario)) {
              if let reader = model.reader, let root = reader.roots.first(where: { $0.browse == "home" }) {
                await reader.open(root, path: "Projects/project100")
                if scenario != "folder" { _ = model.chooseCurrentFolder() }
              }
            }
            if scenario == "offline" {
              model.update(model.desktops.map { .init(id: $0.id, name: $0.name, platform: $0.platform, online: false) })
            }
            choosingFolder = ["roots", "folder", "offline"].contains(String(scenario))
            if scenario == "refused" { _ = await model.spawn() }
            if scenario == "spawning" { Task { _ = await model.spawn() } }
          }
        #endif
      }
    }
    .tint(ChromePalette.ink)
    .interactiveDismissDisabled(model.spawning)
    .presentationDetents([.medium])
    .presentationDragIndicator(.visible)
    .presentationCornerRadius(40)
    .fieldGlassSheet()
  }
}

extension CreateSessionSheet {
  /// A row with one answer, or none: the fact in its place, never a menu.
  fileprivate func fact(_ title: String, _ words: String) -> some View {
    HStack {
      Text(title)
      Spacer()
      Text(words).foregroundStyle(ChromePalette.inkSecondary).multilineTextAlignment(.trailing)
    }
    .accessibilityElement(children: .combine)
  }
}

public struct WorkspaceFolderSheet: View {
  @Bindable private var model: WorkspaceLaunch
  @State private var query = ""
  @State private var copied: String?
  @Environment(\.dismiss) private var dismiss
  public init(model: WorkspaceLaunch) { self.model = model }

  public var body: some View {
    NavigationStack {
      List {
        // Q7 — from a project: its places first, under each desktop's mark
        ForEach(model.placesByDesktop, id: \.desktop) { group in
          Section {
            ForEach(group.places) { place in placeRow(place) }
          } header: {
            if let desktop = model.desktops.first(where: { $0.id == group.desktop }) {
              WorkspaceDesktopLabel(desktop: desktop)
            }
          }
        }
        Section {
          if model.desktops.count > 1 {
            Picker("Desktop", selection: Binding(
              get: { model.selected ?? "" },
              set: { device in query = ""; Task { await model.select(device) } }
            )) {
              ForEach(model.desktops) { desktop in WorkspaceDesktopLabel(desktop: desktop).tag(desktop.id) }
            }
          } else if let desktop = model.desktop {
            WorkspaceDesktopLabel(desktop: desktop)
          } else {
            Text("Connect a desktop to browse its folders").foregroundStyle(ChromePalette.inkSecondary)
          }
        }
        if let reader = model.reader {
          if let message = reader.message {
            Section {
              HStack {
                if reader.state == .loading { ProgressView() }
                Text(message).font(.callout).foregroundStyle(ChromePalette.inkSecondary)
                Spacer()
                if reader.state != .loading && reader.state != .ready {
                  Button("Retry") { Task { await refresh(reader) } }
                }
              }
            }
          }
          if reader.root == nil { roots(reader) } else { contents(reader) }
        }
      }
      .scrollContentBackground(.hidden)
      .background(ChromePalette.paper)
      .navigationTitle(model.context.projectName.map { "Where in \($0)" } ?? "Choose a folder")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Use folder") { if model.chooseCurrentFolder() { dismiss() } }
            .disabled(model.reader?.choice == nil)
        }
      }
      .safeAreaInset(edge: .bottom) {
        if copied != nil {
          Text("Path copied").font(.caption).padding().background(.regularMaterial, in: Capsule())
            .padding(.bottom)
        }
      }
      .task(id: query) {
        guard let reader = model.reader, reader.root != nil else { return }
        do { try await Task.sleep(for: .milliseconds(250)); try Task.checkCancellation() }
        catch { return }
        await reader.search(query)
      }
      .onChange(of: model.selected) { query = "" }
    }.tint(ChromePalette.ink)
  }

  /// A project's place: its folder's name and branch, then its last use or
  /// why it cannot take a launch; the chosen one checked. A tap brings its
  /// desktop and returns.
  private func placeRow(_ place: LaunchPlace) -> some View {
    let awake = model.desktops.first { $0.id == place.desktop }?.online == true
    let available = place.reason == nil && awake && !model.spawning
    return Button {
      Task {
        await model.choose(place)
        if model.place == place { dismiss() }
      }
    } label: {
      HStack {
        Image(systemName: "folder")
        Text(place.label).lineLimit(1)
        Spacer()
        Text(place.reason ?? (awake ? place.last : "asleep")).font(.caption)
        if model.place == place { Image(systemName: "checkmark") }
      }
      .foregroundStyle(available ? ChromePalette.ink : ChromePalette.inkSecondary)
    }
    .disabled(!available)
    .accessibilityValue(model.place == place ? "chosen" : "")
  }

  @ViewBuilder private func roots(_ reader: WorkspaceReads) -> some View {
    Section("Recent places") {
      if reader.recent.isEmpty && reader.state == .ready { Text("No recent places").foregroundStyle(ChromePalette.inkSecondary) }
      ForEach(reader.recent) { rootRow($0, reader: reader) }
    }
    Section("Browse") { ForEach(reader.browse) { rootRow($0, reader: reader) } }
    if reader.rootsClipped { Text("Showing the most recent places").font(.caption).foregroundStyle(ChromePalette.inkSecondary) }
  }

  private func rootRow(_ root: WorkspaceRoot, reader: WorkspaceReads) -> some View {
    pathRow(name: root.name, path: root.path, kind: "dir", detail: root.missing ? "Folder is missing" : nil,
      available: reader.state == .ready && !root.missing, reader: reader) {
      query = ""; Task { await reader.open(root) }
    }
  }

  @ViewBuilder private func contents(_ reader: WorkspaceReads) -> some View {
    Section {
      breadcrumbs(reader)
      if let path = reader.absolutePath {
        HStack {
          Text(path).font(.caption.monospaced()).foregroundStyle(ChromePalette.inkSecondary).textSelection(.enabled)
          Spacer()
          copyButton(path, reader: reader)
        }
      }
      TextField("Search this folder", text: $query)
        .textInputAutocapitalization(.never).autocorrectionDisabled()
        .accessibilityLabel("Search within this folder")
      Toggle("Show files", isOn: Binding(get: { reader.showFiles }, set: { value in
        Task { await reader.filter(files: value) }
      }))
    }
    Section {
      let rows = reader.query.isEmpty ? reader.entries : reader.hits
      if rows.isEmpty && reader.state == .ready {
        Text(reader.query.isEmpty ? (reader.showFiles ? "This folder is empty" : "No folders here") : (reader.showFiles ? "No matching entries" : "No matching folders"))
          .foregroundStyle(ChromePalette.inkSecondary)
      }
      ForEach(rows, id: \.path) { entry in
        pathRow(name: entry.name, path: entry.path, kind: entry.kind,
          detail: entry.childCount.map { "\($0) items" },
          available: reader.state == .ready && entry.kind == "dir", reader: reader) {
          query = ""; Task { await reader.enter(entry) }
        }
      }
      if reader.query.isEmpty, reader.nextCursor != nil {
        Button("Load more (\(reader.entries.count) of \(reader.total))") { Task { await reader.more() } }
          .disabled(reader.state != .ready)
      }
    } footer: {
      VStack(alignment: .leading) {
        if !reader.query.isEmpty && !reader.complete { Text("Searched part of this folder") }
        if reader.clipped { Text(reader.query.isEmpty ? "More entries are available" : "More matches are available. Narrow your search.") }
      }
    }
  }

  private func breadcrumbs(_ reader: WorkspaceReads) -> some View {
    let parts = reader.relativePath.split(separator: "/").map(String.init)
    return ScrollView(.horizontal) {
      HStack {
        Button("Places") { query = ""; reader.showRoots() }
        if let root = reader.root {
          Image(systemName: "chevron.right").font(.caption)
          Button(root.name) { query = ""; Task { await reader.open(root) } }
          ForEach(parts.indices, id: \.self) { index in
            Image(systemName: "chevron.right").font(.caption)
            Button(parts[index]) {
              query = ""; Task { await reader.open(root, path: parts.prefix(index + 1).joined(separator: "/")) }
            }
          }
        }
      }.buttonStyle(.borderless)
    }.scrollIndicators(.hidden)
  }

  private func pathRow(name: String, path: String, kind: String, detail: String?, available: Bool,
    reader: WorkspaceReads, open: @escaping () -> Void) -> some View {
    HStack {
      Button(action: open) {
        HStack(alignment: .top) {
          Image(systemName: kind == "dir" ? "folder" : kind == "symlink" ? "link" : "doc")
          VStack(alignment: .leading, spacing: 4) {
            Text(name).font(.body)
            Text(path).font(.caption.monospaced()).multilineTextAlignment(.leading).lineLimit(2).truncationMode(.middle)
            if let detail { Text(detail).font(.caption) }
          }
          Spacer(minLength: 0)
        }.foregroundStyle(available ? ChromePalette.ink : ChromePalette.inkSecondary)
      }.buttonStyle(.borderless).disabled(!available)
      copyButton(path, reader: reader)
    }
    .contextMenu { Button("Copy path", systemImage: "doc.on.doc") { copy(path, reader: reader) } }
  }

  private func copyButton(_ path: String, reader: WorkspaceReads) -> some View {
    Button { copy(path, reader: reader) } label: { Image(systemName: "doc.on.doc").padding(.vertical, 8) }
      .buttonStyle(.borderless).foregroundStyle(ChromePalette.inkSecondary)
      .accessibilityLabel("Copy path").accessibilityValue(path)
  }
  private func copy(_ path: String, reader: WorkspaceReads) {
    reader.copyPath(path) { UIPasteboard.general.string = $0 }; copied = path
    Task { try? await Task.sleep(for: .seconds(2)); if copied == path { copied = nil } }
  }
  private func refresh(_ reader: WorkspaceReads) async {
    await reader.refreshRoots()
    if reader.state == .ready, let root = reader.root { await reader.open(root, path: reader.relativePath) }
  }
}

/// A desktop as a choice: its OS mark (PJ-7: the desktop's own marks,
/// `DeviceMark`, where FS-2 drew SF Symbols) and its name.
private struct WorkspaceDesktopLabel: View {
  let desktop: WorkspaceDesktop
  var body: some View {
    Label { Text(desktop.name) } icon: { DeviceMark(platform: desktop.platform, size: 17) }
      .foregroundStyle(desktop.online ? ChromePalette.ink : ChromePalette.inkSecondary)
  }
}
