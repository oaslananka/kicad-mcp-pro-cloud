import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createIdentity } from "../src/identity.js";
import pg from "pg";
import { getMigrations } from "better-auth/db/migration";

const databaseUrl = process.env.TEST_DATABASE_URL;
function instance(pool?: pg.Pool) {
  return createIdentity({
    publicOrigin: "http://127.0.0.1:8787",
    audience: "http://127.0.0.1:8787/mcp",
    databaseUrl: databaseUrl ?? "postgresql://127.0.0.1:65432/unused"
  }, {
    secret: randomBytes(48).toString("hex"),
    googleId: "placeholder-provider-id", googleSecret: "placeholder-provider-value",
    githubId: "placeholder-provider-id", githubSecret: "placeholder-provider-value"
  },pool);
}

test("identity rejects missing social credentials and key", () => {
  assert.throws(() => createIdentity({
    publicOrigin:"http://127.0.0.1:8787",
    audience:"http://127.0.0.1:8787/mcp", databaseUrl:"not-used"
  }, {secret:"",googleId:"",googleSecret:"",githubId:"",githubSecret:""}));
});

test("Better Auth serves MCP-aware OAuth metadata with PostgreSQL", {skip: !databaseUrl}, async () => {
  const pool = new pg.Pool({connectionString:databaseUrl});
  try {
    // CI must use a disposable PostgreSQL database. No production auto-migration.
    const ddl=await readFile(new URL("../db/003_better_auth.pgsql",import.meta.url),"utf8");
    await pool.query(ddl);
    const identity=instance(pool);
    const migration=await getMigrations(identity.options);
    assert.deepEqual(migration.unsafeChanges, []);
    assert.equal(migration.toBeCreated.length,0);
    assert.equal(migration.toBeAdded.length,0);
    let served=false;
    for(const path of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/api/auth"
    ]) {
      const response=await identity.handler(new Request("http://127.0.0.1:8787"+path));
      if(response.status===200) {
        const metadata=await response.json() as Record<string,unknown>;
        assert.equal(typeof metadata.authorization_endpoint,"string");
        assert.equal(typeof metadata.token_endpoint,"string");
        assert.equal(metadata.client_id_metadata_document_supported,true);
        served=true;
        break;
      }
    }
    assert.equal(served,true,"issuer-specific authorization metadata must be served");
  } finally {
    await pool.end();
  }
});
