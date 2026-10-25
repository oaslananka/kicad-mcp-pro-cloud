import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

test("Actions use only DOPPLER_TOKEN and never duplicate production secret values", async () => {
  const dir = new URL("../.github/workflows/", import.meta.url);
  for (const name of await readdir(dir)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const yml = await readFile(new URL(name, dir), "utf8");
    const accessedSecrets = [...yml.matchAll(/\$\{\{\s*secrets\.([A-Za-z_0-9]+)\s*\}\}/g)];
    for (const token of accessedSecrets) {
      assert.equal(token[1], "DOPPLER_TOKEN", name + " must not use other GitHub secrets");
    }
    assert.doesNotMatch(yml, /doppler\s+secrets\s+download/);
    assert.doesNotMatch(yml, /toJson\(secrets\)/);
  }
  const dopplerJob = await readFile(new URL("../.github/workflows/doppler-config.yml", import.meta.url), "utf8");
  assert.match(dopplerJob, /workflow_dispatch:/);
  assert.match(dopplerJob, /github\.ref == 'refs\/heads\/main'/);
  assert.match(dopplerJob, /doppler run -- npm run config:check/);
});
