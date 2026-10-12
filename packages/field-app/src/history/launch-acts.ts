import type { ProjectSummary } from "@vibefield/contracts";
import type { KeyedCallClient } from "../forwarded-call";
import { readModels, thrownReason } from "./acts";
import type { HistoryHostState } from "./host-inputs";
import { FIRST_PAGE, type HeldModels, type LaunchPage, modelsKey } from "./launch";
import { turnNewAgentPage } from "./turn-page";

// PJ-6 — what History's controller does for New agent's pages (`launch.ts`):
// turn the rows to a page (in place, `turn-page.ts`), and ask fieldd for the
// agent's own picker a page or the recipe row needs (`agent.models`). The
// product's controller and the catalog's plate both build their acts from it,
// each over its own client — fieldd, or the catalog's fixture adapter.

type Update = (update: (state: HistoryHostState) => HistoryHostState) => void;

export interface LaunchActs {
  /** turn New agent's rows to `page`, asking the picker a models page shows */
  page(page: LaunchPage): void;
  /** ask the picker the project's recipe names (its row's words) */
  recipeShown(project: ProjectSummary | undefined): void;
}

export function launchActs(client: Pick<KeyedCallClient, "request">, update: Update): LaunchActs {
  const held = (
    models: ReadonlyMap<string, HeldModels>,
    key: string,
    value: HeldModels,
  ): ReadonlyMap<string, HeldModels> => {
    const next = new Map(models);
    next.set(key, value);
    return next;
  };
  /** "reading" until a first answer; a later ask keeps what is held while
   * fieldd answers (at once, from its own last read, a read behind it) */
  const ask = (provider: string, profileSet: string) => {
    const key = modelsKey(provider, profileSet);
    update((state) =>
      state.models.has(key)
        ? state
        : { ...state, models: held(state.models, key, { state: "reading" }) },
    );
    void readModels(client, provider, profileSet).then(
      (answer) =>
        update((state) => ({
          ...state,
          models: held(state.models, key, { state: "answered", answer }),
        })),
      (error: unknown) =>
        update((state) =>
          state.models.get(key)?.state === "answered"
            ? state
            : {
                ...state,
                models: held(state.models, key, { state: "unasked", reason: thrownReason(error) }),
              },
        ),
    );
  };
  return {
    page(next) {
      update((state) => ({ ...state, page: next }));
      if (next.kind === "models") ask(next.provider, next.profileSet);
      turnNewAgentPage(() => update((state) => ({ ...state, page: FIRST_PAGE })));
    },
    recipeShown(project) {
      const recipe = project?.recipe;
      if (recipe !== undefined) ask(recipe.provider, recipe.profileSet);
    },
  };
}
