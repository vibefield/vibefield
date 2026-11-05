// v2's review loop (draft/compose-plane/v2/index.html, the flow API), its budget dropped (James, 2026-11-02 13:08Z)
// and its schema written out: a reviewer each round, a fix in the session you named, then a gate.
const Findings = {
  type: "object",
  properties: { findings: { type: "array", items: { type: "string" } } },
  required: ["findings"],
};

export const meta = {
  name: "Review until clean",
  phases: ["Review", "Ship"],
  input: { target: "session" },
};

export default async function ({ target }) {
  await phase("Review", async () => {
    for (let round = 1; round <= 3; round++) {
      const review = await agent(
        `Review the change in ${target}. List each finding with file and line.`,
        {
          agent: "codex",
          model: "gpt-5.5",
          label: `review · round ${round} of 3`,
          schema: Findings,
        },
      );
      if (review.findings.length === 0) break;
      await agent(`Fix these findings:\n${review.text}`, { in: target, label: "fix" });
    }
  });
  if ((await ask("Push 0.7.25?", ["Push", "Hold"])) === "Push") {
    await phase("Ship", () => agent("Push the branch.", { in: target, label: "ship" }));
  }
}
