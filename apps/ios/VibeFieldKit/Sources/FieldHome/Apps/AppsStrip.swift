import FieldProduct
import Foundation

// MA-6c — what MA-D7's two slots hold (DESIGN.md §8 "The phone's Apps", as amended by SE-D3): the strip above the switch
// before any word, and the group first in Everything once a word is typed. RED: both are absent.

/// The strip: **Apps**, the Recent row and **All apps**. Absent at zero apps (VF-PM's Q7).
struct AppsStripContent: Equatable {
  let head: String
  let all: String
  let recent: [IndexAppRow]

  static func of(reading: AppsFeed.Reading, opened: [String], here: String) -> AppsStripContent? { nil }
}

/// Everything's **Apps** group: the titles that hold the typed words.
struct AppsSearchGroup: Equatable {
  struct Row: Equatable, Identifiable {
    let app: IndexAppRow
    let desktop: String
    let away: Bool

    var id: String { app.appKey }
  }

  let head: String
  let rows: [Row]

  static func of(reading: AppsFeed.Reading, words: String, here: String) -> AppsSearchGroup? { nil }
}
