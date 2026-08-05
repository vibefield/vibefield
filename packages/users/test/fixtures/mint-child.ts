// One contender in the mint race (spec §3.3 test 1): waits at the barrier,
// then races ensureUsersRoot against seven siblings on one empty root.
import { existsSync } from "node:fs";
import { ensureUsersRoot } from "../../src/index";

const root = process.argv[2];
const goFile = process.argv[3];
if (root === undefined || goFile === undefined) {
  process.stderr.write("usage: mint-child <root> <goFile>\n");
  process.exit(2);
}

while (!existsSync(goFile)) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

const ensured = await ensureUsersRoot(root, {});
process.stdout.write(
  `${JSON.stringify({ userId: ensured.user.userId, created: ensured.created })}\n`,
);
