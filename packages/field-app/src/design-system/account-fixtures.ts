import type { AccountMe, AccountPerson } from "../account/use-account";

// Deterministic account data for the catalog's faces, Me menu and Settings
// head (UA-D17/D19). Fixture DATA only — every view that draws it is the
// shipping one. Logins and tailnets are examples.

export const FIXTURE_ME: AccountMe = {
  userId: "01J8Z3K6W9QX2M4N7P5R8T1V3B",
  name: "James",
  face: { emoji: "🦊" },
  waiting: 0,
  detail: "james@example.com",
  detailIsLogin: true,
  canLink: false,
};

export const FIXTURE_ME_OFFLINE: AccountMe = {
  ...FIXTURE_ME,
  detail: "offline · not linked",
  detailIsLogin: false,
  canLink: true,
};

export const FIXTURE_OTHERS: readonly AccountPerson[] = [
  {
    userId: "01J9B7Q2MXC5D8F3G6H9J2K4N7",
    name: "James (work)",
    face: { emoji: "🐙", frame: "coin" },
    waiting: 0,
  },
  {
    userId: "01JA4T8N5RS1V4W7X9Y2Z5A8B3",
    name: "Sandbox",
    face: { emoji: "🧪" },
    waiting: 0,
  },
];

export const FIXTURE_OTHERS_WAITING: readonly AccountPerson[] = FIXTURE_OTHERS.map((person) =>
  person.name === "James (work)" ? { ...person, waiting: 2 } : person,
);

/** The ladder the catalog stages a face on — every threshold of DESIGN.md §2.8
 * lands between two rungs. */
export const FACE_LADDER = [112, 80, 56, 40, 28, 20, 16] as const;
