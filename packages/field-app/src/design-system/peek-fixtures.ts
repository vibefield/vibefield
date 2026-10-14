import {
  catalogIdForKind,
  IndexRecentResult,
  type IndexSearchHit,
  IndexSearchResult,
} from "@vibefield/contracts";
import { createDemoPorts, type RoomDemo } from "@vibefield/rosetta-room/fixtures";
import { PEEK_LATEST_LIMIT, PEEK_SEARCH_LIMIT } from "../frame/peek-model";
import type { PeekPort } from "../frame/peek-port";

// The Peek's FIXTURE ADAPTER (docs/UI_SYSTEM.md "Catalog fidelity"; DESIGN.md
// §8 "Search — the Peek"). The catalog mounts the SHIPPING Peek controller
// (`frame/Peek.tsx`) over this port, never a copy of its markup or CSS. It
// answers the Peek's three questions from the room package's own demo — the
// same demo the plate's room is drawn over — so a pick lands that room on the
// line: the demo's search (its own words, one phrase as typed) with each hit's
// ROOT facts folded in as fieldd folds them, the demo's sessions newest first
// for "your latest sessions", and its projects for the dropdown. Every answer
// is parsed by the contract's own schema, as the product's port parses
// fieldd's.

export function peekFixturePort(demo: RoomDemo): PeekPort {
  const ports = createDemoPorts(demo);
  const sessions = new Map(demo.meta.sessions.map((row) => [row.id, row]));
  const kinds = new Map(demo.meta.runtimes.map((row) => [row.id, row.kind]));
  const projects = new Map(demo.meta.projects.map((row) => [row.id, row]));
  const providerOf = (runtimeId: string | null | undefined): string | undefined =>
    runtimeId === null || runtimeId === undefined
      ? undefined
      : catalogIdForKind(kinds.get(runtimeId) ?? "");
  return {
    async search({ q, kind }) {
      const answer = await ports.catalog.search({
        q,
        limit: PEEK_SEARCH_LIMIT,
        project: null,
        kind,
        agent: null,
      });
      const hits: IndexSearchHit[] = answer.hits
        .filter((hit) => kind === null || hit.kind === kind)
        .map((hit) => {
          const row = sessions.get(hit.session_id);
          const root = row === undefined ? undefined : (sessions.get(row.root_session_id) ?? row);
          const provider = providerOf(root?.runtime_id);
          return {
            sessionId: hit.session_id,
            ...(root !== undefined
              ? { rootSessionId: root.id, nativeSessionId: root.native_session_id }
              : {}),
            ...(root?.title ? { title: root.title } : {}),
            timelineId: hit.timeline_id,
            kind: hit.kind,
            ...(typeof hit.at === "number" ? { at: hit.at } : {}),
            snippet: hit.snippet,
            ...(root?.cwd ? { cwd: root.cwd } : {}),
            ...(root?.project_id ? { projectId: root.project_id } : {}),
            ...(provider !== undefined ? { provider } : {}),
          };
        });
      return IndexSearchResult.parse({
        answered: true,
        state: { readiness: "ready", canonicalReady: true },
        hits,
        clipped: false,
      });
    },
    async latest() {
      const newest = [...demo.meta.sessions]
        .filter((row) => row.parent_session_id === null)
        .sort((left, right) => (right.activity?.last_at ?? 0) - (left.activity?.last_at ?? 0))
        .slice(0, PEEK_LATEST_LIMIT);
      return IndexRecentResult.parse({
        rows: newest.map((row) => {
          const provider = providerOf(row.runtime_id);
          const project = row.project_id === null ? undefined : projects.get(row.project_id);
          return {
            sessionId: row.id,
            nativeSessionId: row.native_session_id,
            rootSessionId: row.root_session_id,
            ...(row.title ? { title: row.title } : {}),
            ...(row.summary ? { summary: row.summary } : {}),
            ...(row.cwd ? { cwd: row.cwd } : {}),
            activity:
              row.activity === null
                ? null
                : { firstAt: row.activity.first_at, lastAt: row.activity.last_at },
            streamState: row.stream_state,
            ...(provider !== undefined ? { provider } : {}),
            here: false,
            ...(project !== undefined ? { project: { id: project.id, name: project.name } } : {}),
          };
        }),
      });
    },
    async projects() {
      return demo.meta.projects.map((row) => ({ id: row.id, name: row.name }));
    },
  };
}
