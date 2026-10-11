import type { RoomSelection } from "@rosetta/room";
import {
  type AgentProviderSummary,
  AgentProvidersResult,
  AgentSpawnResult,
  IndexRecentParams,
  IndexRecentResult,
  type IndexRecentSession,
  IndexSessionResult,
} from "@vibefield/contracts";
import { type KeyedCallClient, requestResolvingOutcome } from "../forwarded-call";
import { launcherSession, refusalReason, UNTITLED_SESSION } from "../godview/launcher-doors";

// HISTORY'S RESUME (AR-8c; DESIGN.md §8 "History — Resume"; AR-D43 (a)). The
// room reports the session a person has chosen; the line's create continues
// it — `agent.resume` in its NATIVE form, exactly as the empty pane launcher's
// resume asks it (QL, `godview/launcher-doors.ts`): the conversation's agent
// (the catalog id its runtime's kind maps to), its provider-native id, its
// folder, and the persona the index filed it under (EL7: a resume continues
// where the conversation lives — never under another profile's folder). The
// launcher's own reading decides whether the act can be taken at all and says
// why not in its words (a folder that is gone, an agent not offered here), and
// fieldd's refusals are said in the launcher's words too (`refusalReason`).

/** What `agent.resume`'s native form is asked with. */
export interface ResumeFacts {
  readonly provider: string;
  readonly nativeSessionId: string;
  readonly cwd?: string;
  readonly profileId?: string;
  readonly title?: string;
}

/** The chosen session, read: resumable with its facts, or why not. */
export type ResumeReading =
  | { readonly state: "ready"; readonly facts: ResumeFacts }
  | { readonly state: "waits"; readonly why: string };

/** How many of a folder's sessions the reading looks through for the row the
 * launcher would list (its `cwdExists` and persona). */
const RECENT_LOOKUP_LIMIT = 500;

/**
 * Read what Resume needs for `selection`, the way the launcher reads a row:
 * the folder's `index.recent` row when the index lists the session there (its
 * persona and whether its folder still exists, said by fieldd), else the
 * session's own header (`index.session`) with the folder's existence read off
 * any row the folder shares; then the launcher's own judgement against
 * `agent.providers` (offered here, can resume, installed).
 */
export async function readResume(
  client: KeyedCallClient,
  selection: RoomSelection,
): Promise<ResumeReading> {
  // the door's own reading of a folder (an absolute one; a relative path names
  // no folder fieldd could resolve) — a session with none is read by its header
  const ask =
    selection.folder === null
      ? null
      : IndexRecentParams.safeParse({
          cwd: selection.folder,
          scope: "here",
          limit: RECENT_LOOKUP_LIMIT,
        });
  const folder = ask?.success === true ? (ask.data.cwd ?? null) : null;
  const [recent, header, providers] = await Promise.allSettled([
    ask?.success !== true
      ? Promise.resolve(null)
      : client
          .request("index.recent", { ...ask.data })
          .then((answer) => IndexRecentResult.parse(answer)),
    client
      .request("index.session", { sessionId: selection.sessionId })
      .then((answer) => IndexSessionResult.parse(answer)),
    client
      .request("agent.providers", {})
      .then((answer) => AgentProvidersResult.parse(answer).providers),
  ]);
  if (providers.status === "rejected")
    return { state: "waits", why: refusalReason(providers.reason) };
  const listed = recent.status === "fulfilled" ? (recent.value?.rows ?? []) : [];
  let row: IndexRecentSession | undefined = listed.find(
    (candidate) => candidate.sessionId === selection.sessionId,
  );
  if (row === undefined) {
    if (header.status === "rejected") return { state: "waits", why: refusalReason(header.reason) };
    const session = header.value.session;
    const sameFolder = listed.find((candidate) => candidate.cwd === (session.cwd ?? folder));
    row = {
      ...session,
      ...(session.cwd === undefined && folder !== null ? { cwd: folder } : {}),
      here: true,
      ...(sameFolder?.cwdExists !== undefined ? { cwdExists: sameFolder.cwdExists } : {}),
    };
  }
  return readingOf(row, providers.value);
}

/** The launcher's judgement of one row (QL's `launcherSession`). */
export function readingOf(
  row: IndexRecentSession,
  providers: readonly AgentProviderSummary[],
): ResumeReading {
  const listed = launcherSession(row, providers);
  if (!listed.resumable || row.provider === undefined) {
    return { state: "waits", why: listed.unresumable ?? "can’t resume" };
  }
  return {
    state: "ready",
    facts: {
      provider: row.provider,
      nativeSessionId: row.nativeSessionId,
      ...(row.cwd !== undefined ? { cwd: row.cwd } : {}),
      ...(row.profileId !== undefined ? { profileId: row.profileId } : {}),
      ...(listed.title !== UNTITLED_SESSION ? { title: listed.title.slice(0, 256) } : {}),
    },
  };
}

/** What `agent.resume` came to: the create ticket of the agent it started, the
 * one-run law's refusal (a run already continues the conversation — Jump to's,
 * P3), or another refusal in the launcher's words. */
export type ResumeAnswer =
  | { readonly state: "started"; readonly terminal: unknown }
  | { readonly state: "running" }
  | { readonly state: "refused"; readonly reason: string };

/** fieldd's refusal of a second run on one conversation (AR-4b's one-run law). */
function conversationRunning(cause: unknown): boolean {
  const details =
    typeof cause === "object" && cause !== null
      ? (cause as { details?: Record<string, unknown> }).details
      : undefined;
  return details?.["state"] === "terminal-alive";
}

/** Continue the conversation (`agent.resume`, the native form, one logical
 * call — an outcome-unknown is asked once more with its key). */
export async function resumeNative(
  client: KeyedCallClient,
  facts: ResumeFacts,
): Promise<ResumeAnswer> {
  try {
    const answered = await requestResolvingOutcome(client, "agent.resume", {
      provider: facts.provider,
      nativeSessionId: facts.nativeSessionId,
      ...(facts.cwd !== undefined ? { cwd: facts.cwd } : {}),
      ...(facts.profileId !== undefined ? { profileId: facts.profileId } : {}),
      ...(facts.title !== undefined ? { title: facts.title } : {}),
    });
    return { state: "started", terminal: AgentSpawnResult.parse(answered).terminal };
  } catch (cause) {
    if (conversationRunning(cause)) return { state: "running" };
    return { state: "refused", reason: refusalReason(cause) };
  }
}
