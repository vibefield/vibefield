import FieldDesign
import FieldSplash
import SwiftUI

/// The phone's root: the splash over the home at launch (DESIGN.md §8 "The phone's splash"), the home
/// mounted under it once the field shows. The window wears the phone's Appearance from the first
/// frame here, before the home that also applies it is built, so the splash comes up in the
/// appearance the home will wear (Obsidian by night, Obsidian Light by day) and never turns over.
public struct HomeRoot: View {
  @AppStorage(PhoneAppearance.storageKey) private var phoneLook: PhoneAppearance = .auto

  public init() {}

  public var body: some View {
    SplashGate { HomeScreen() }
      .phoneAppearance(phoneLook)
  }
}
