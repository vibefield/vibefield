import { PluginArtifactStore } from "../../src/plugin-artifact-store";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`missing ${name}`);
  return value;
};

const failpoint = required("VF_ARTIFACT_FAILPOINT");
const pauseAtFailpoint = (): Promise<void> =>
  new Promise(() => {
    process.send?.("failpoint");
    setInterval(() => undefined, 60_000);
  });

void (async () => {
  const store = new PluginArtifactStore(required("VF_INSTALLED_ROOT"), {
    ...(failpoint === "before-rename" ? { beforeCurrentPublish: pauseAtFailpoint } : {}),
    ...(failpoint === "after-rename" ? { afterCurrentPublish: pauseAtFailpoint } : {}),
  });

  await store.commit(
    {
      pluginId: required("VF_PLUGIN_ID"),
      slot: required("VF_CANDIDATE_SLOT"),
      artifactSha256: required("VF_CANDIDATE_SHA256"),
      root: required("VF_CANDIDATE_ROOT"),
      reused: true,
    },
    required("VF_EXPECTED_SLOT"),
    Number(required("VF_COMMIT_EPOCH")),
  );
  process.send?.("unexpected-completion");
})().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
