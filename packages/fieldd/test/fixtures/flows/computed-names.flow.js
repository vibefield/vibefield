// A script whose steps the static read cannot all name: its agents are chosen as it runs, an option is spread, the
// gate's words are computed, and `agent` is handed on as a value, so the card says it starts agents it can't list.
// Its budget is computed too, and is never read (CP4-S11).
export const meta = { name: "Computed names", budget: { usd: 4 * 3 } };

const reviewers = ["codex", "claude"];
const opts = { model: "gpt-5.5" };

export default async function ({ files }) {
  await parallel(
    reviewers.map((who) => agent(`Review ${files}.`, { agent: who, label: `review by ${who}` })),
  );
  await agent("Summarize the reviews.", { ...opts, label: "summary" });
  const call = agent;
  await call("Anything else?", { agent: "codex" });
  const choice = await ask(`Ship ${files}?`, reviewers);
  log(choice);
}
