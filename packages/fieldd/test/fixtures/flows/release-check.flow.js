export const meta = {
  name: "Release check",
  phases: ["Review", "Ship"],
  input: { target: "session" },
};

export default async function ({ target }) {
  const review = await phase("Review", () =>
    agent(`Review the change in ${target}. List each finding with file and line.`, {
      agent: "codex",
      model: "gpt-5.5",
      label: "review",
    }),
  );
  log(`review: ${review.text.length} characters`);
  if ((await ask("Push the release?", ["Push", "Hold"])) === "Push") {
    await phase("Ship", () => agent("Push the branch.", { in: target, label: "ship" }));
  }
}
