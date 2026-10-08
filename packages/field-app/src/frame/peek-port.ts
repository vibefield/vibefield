import {
  INDEX_MESH,
  IndexProjectsResult,
  IndexRecentResult,
  IndexSearchResult,
} from "@vibefield/contracts";
import { PEEK_LATEST_LIMIT, PEEK_SEARCH_LIMIT } from "./peek-model";

// THE PEEK'S PORT (DESIGN.md §8 "Search — the Peek"): the three questions the
// popup asks, answered over this window's fieldd client — the words
// (`index.search`, unscoped: Everything), your latest sessions before a word
// is typed (`index.recent {scope: "all"}`) and the projects its dropdown names
// (`index.projects`). This desktop's index only (K5: `scope: "local"` — the
// room cannot open a peer's session until DS-7). The catalog hands the
// controller a fixture port instead; every answer is parsed, never cast.

/** A project the Everything dropdown can narrow to. */
export interface PeekProject {
  readonly id: string;
  readonly name: string;
}

export interface PeekSearch {
  readonly q: string;
  /** one side of the conversation; null asks both */
  readonly kind: "user" | "agent" | null;
}

export interface PeekPort {
  search(request: PeekSearch): Promise<IndexSearchResult>;
  latest(): Promise<IndexRecentResult>;
  projects(): Promise<readonly PeekProject[]>;
}

/** What the port asks of a fieldd client: one request door. */
export interface PeekDoorClient {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export function peekPortOver(client: PeekDoorClient): PeekPort {
  return {
    async search({ q, kind }) {
      return IndexSearchResult.parse(
        await client.request("index.search", {
          q: q.slice(0, 512),
          limit: PEEK_SEARCH_LIMIT,
          scope: "local",
          ...(kind !== null ? { kind } : {}),
        }),
      );
    },
    async latest() {
      return IndexRecentResult.parse(
        await client.request("index.recent", { scope: "all", limit: PEEK_LATEST_LIMIT }),
      );
    },
    async projects() {
      // one page, newest activity first: a dropdown names the projects you
      // are likely after, never a directory listing
      const answer = IndexProjectsResult.parse(
        await client.request("index.projects", {
          scope: "local",
          limit: INDEX_MESH.PAGE_MAX_LIMIT,
        }),
      );
      return answer.rows.map((row) => ({ id: row.projectId, name: row.name }));
    },
  };
}
