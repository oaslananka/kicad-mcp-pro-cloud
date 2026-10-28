import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {inIsolatedDatabase} from "./isolated-db.js";
import {PgOwnerReadApprovalLedger} from "../src/owner-read-approval-ledger.js";

const url=process.env.TEST_DATABASE_URL;
const scope=()=>({
  oauth:{ownerSub:"verified-owner",clientId:"verified-client",accessTokenIssuedAtSeconds:1760000000},
  deviceId:randomUUID(),projectId:randomUUID(),requestId:randomUUID(),
  origin:"https://trusted-owner.example",operation:"project_summary" as const,
  expiresAtUnixMs:Date.now()+20_000
});

test("trusted owner approval receipt is consumed once across competing workers",
  {skip:!url},async()=>{
  await inIsolatedDatabase(url!,["013_owner_read_approvals.pgsql"],async db=>{
    const verifier=new PgOwnerReadApprovalLedger(db);
    const agreed=scope();
    assert.equal(await verifier.consume(agreed),false,"missing assertion must deny");
    // Synthetic fixture only; no API/service writes trusted approvals yet.
    await db.query("INSERT INTO owner_read_approvals "+
      "(request_id,owner_sub,client_id,device_id,project_id,cloud_origin,operation,expires_at) "+
      "VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8::double precision/1000))",
      [agreed.requestId,agreed.oauth.ownerSub,agreed.oauth.clientId,agreed.deviceId,
       agreed.projectId,agreed.origin,agreed.operation,agreed.expiresAtUnixMs]);
    const races=await Promise.all(Array.from({length:12},()=>verifier.consume(agreed)));
    assert.equal(races.filter(Boolean).length,1);
    assert.equal(await verifier.consume(agreed),false);
    const row=await db.query("SELECT consumed_at FROM owner_read_approvals WHERE request_id=$1",
      [agreed.requestId]);
    assert.ok(row.rows[0]?.consumed_at);
  });
});

test("bound scope, missing receipt, expiry and malformed caller fail closed",
  {skip:!url},async()=>{
  await inIsolatedDatabase(url!,["013_owner_read_approvals.pgsql"],async db=>{
    const verifier=new PgOwnerReadApprovalLedger(db);
    const agreed=scope();
    await db.query("INSERT INTO owner_read_approvals "+
      "(request_id,owner_sub,client_id,device_id,project_id,cloud_origin,operation,expires_at) "+
      "VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8::double precision/1000))",
      [agreed.requestId,agreed.oauth.ownerSub,agreed.oauth.clientId,agreed.deviceId,
       agreed.projectId,agreed.origin,agreed.operation,agreed.expiresAtUnixMs]);
    for(const invalid of [
      {...agreed,oauth:{...agreed.oauth,ownerSub:"other"}},
      {...agreed,oauth:{...agreed.oauth,clientId:"other"}},
      {...agreed,deviceId:randomUUID()},
      {...agreed,projectId:randomUUID()},
      {...agreed,origin:"https://other.example"},
      {...agreed,operation:"run_drc" as "project_summary"},
      {...agreed,expiresAtUnixMs:agreed.expiresAtUnixMs+1},
      {...agreed,requestId:randomUUID()},
      {...agreed,requestId:"not-a-uuid"}
    ])assert.equal(await verifier.consume(invalid),false);
    assert.equal(await verifier.consume(agreed),true,"invalid attempts cannot burn approval");
    assert.equal(await verifier.consume(agreed),false);
    const expired=scope();
    await db.query("INSERT INTO owner_read_approvals "+
      "(request_id,owner_sub,client_id,device_id,project_id,cloud_origin,operation,expires_at) "+
      "VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8::double precision/1000))",
      [expired.requestId,expired.oauth.ownerSub,expired.oauth.clientId,expired.deviceId,
       expired.projectId,expired.origin,expired.operation,expired.expiresAtUnixMs]);
    await db.query("UPDATE owner_read_approvals SET expires_at=clock_timestamp()-interval '1 second',"+
      "issued_at=clock_timestamp()-interval '5 seconds' WHERE request_id=$1",[expired.requestId]);
    assert.equal(await verifier.consume(expired),false,"expired DB approval denied");
  });
});
