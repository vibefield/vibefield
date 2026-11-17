// RB-2 — This phone › Developer (DESIGN.md §8 "The phone's Settings", amended 2026-11-12; §9 "Developer"). The whole
// file is compiled only into TestFlight and development builds, so the build submitted for App Review carries neither
// the page nor its words (`SettingsBuild`).
#if DEBUG || VF_TESTFLIGHT
  import FieldDesign
  import Foundation
  import SwiftUI

  /// Demo, then Labs, then §9's foot (asked for 2026-11-12: D1–D4, the 23 account states, and how a demo ends, A).
  /// A choice is kept in this phone's defaults and takes effect the next time VibeField opens (D1): the page writes
  /// the choice and nothing else, so nothing here reaches the field that stands. A demo never holds this page, its
  /// switch or its picker, so a demo can always be switched off.
  struct DeveloperPage: View {
    let actions: SettingsActions
    /// This phone's own defaults, beside Appearance (`DeveloperChoices`).
    let defaults: UserDefaults
    /// The choices as kept: what the next open reads.
    @State private var choices: DeveloperChoices

    init(actions: SettingsActions, defaults: UserDefaults = .standard) {
      self.actions = actions
      self.defaults = defaults
      _choices = State(initialValue: DeveloperChoices.read(defaults))
    }

    var body: some View {
      List {
        demo
        if actions.openSwarmLab != nil || actions.openInputCardStates != nil {
          labs
        }
        Section {
          EmptyView()
        } footer: {
          ChromeListFoot(DeveloperWords.foot)
        }
        .chromeRows()
      }
      .chromeList()
      .navigationTitle(DeveloperWords.row)
      .navigationBarTitleDisplayMode(.inline)
    }

    /// Demo field, a switch, and Account, a picker: Your own, then the states in their two groups.
    private var demo: some View {
      Section {
        Toggle(isOn: demoField) {
          ChromeRow(DeveloperWords.demoField, detail: DeveloperWords.demoFieldLine)
        }
        Picker(selection: account) {
          Text(DeveloperWords.yourOwn).tag(String?.none)
          Section(DeveloperWords.yourAccountTitle) {
            ForEach(DeveloperWords.yourAccount, id: \.key) { state in
              Text(state.name).tag(String?.some(state.key))
            }
          }
          Section(DeveloperWords.theWayInTitle) {
            ForEach(DeveloperWords.theWayIn, id: \.key) { state in
              Text(state.name).tag(String?.some(state.key))
            }
          }
        } label: {
          ChromeRow(DeveloperWords.account, detail: DeveloperWords.accountLine)
        }
        .pickerStyle(.navigationLink)
      } header: {
        ChromeListHead(DeveloperWords.demoGroup)
      } footer: {
        ChromeListFoot(DeveloperWords.demoFoot)
      }
      .chromeRows()
    }

    /// The labs this build's home hands the page, each opening over the home with Settings closed first.
    private var labs: some View {
      Section {
        if let open = actions.openSwarmLab {
          lab(DeveloperWords.swarmLab, open: open)
        }
        if let open = actions.openInputCardStates {
          lab(DeveloperWords.inputCardStates, open: open)
        }
      } header: {
        ChromeListHead(DeveloperWords.labsGroup)
      }
      .chromeRows()
    }

    private func lab(_ title: String, open: @escaping () -> Void) -> some View {
      Button {
        open()
      } label: {
        ChromeRow(title)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(title)
      .accessibilityAddTraits(.isButton)
    }

    /// Demo field: on keeps the key, off removes it.
    private var demoField: Binding<Bool> {
      Binding(
        get: { choices.demoField },
        set: { on in
          DeveloperChoices.setDemoField(on, in: defaults)
          choices = DeveloperChoices.read(defaults)
        })
    }

    /// Account: a state by its key, or nil for Your own, which removes the key.
    private var account: Binding<String?> {
      Binding(
        get: { choices.account },
        set: { name in
          DeveloperChoices.setAccount(name, in: defaults)
          choices = DeveloperChoices.read(defaults)
        })
    }
  }
#endif
