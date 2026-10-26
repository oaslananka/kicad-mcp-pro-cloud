import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes,randomUUID,sign} from "node:crypto";
import {test} from "node:test";
import {inIsolatedDatabase} from "./isolated-db.js";
import {PgDeviceManagement} from "../src/device-management.js";
import {PgPairingChallenges} from "../src/pairing-store.js";
import {PgConnectorSessions,connectorSessionProof} from "../src/connector-session.js";
import {redemptionProof} from "../src/device-pairing.js";

test("device owner revocation atomically removes credentials, sessions and project grants",
  {skip:!process.env.TEST_DATABASE_URL},async()=>{
  await inIsolatedDatabase(process.env.TEST_DATABASE_URL!,[
    "001_inventory.pgsql","002_client_grants.pgsql","007_device_pairing.pgsql",
    "008_device_credentials.pgsql","009_device_handshake.pgsql",
    "010_connector_sessions.pgsql"
  ],async db=>{
    const owner="owner-a",foreign="owner-b";
    const key=generateKeyPairSync("ed25519");
    const pub=key.publicKey.export({format:"der",type:"spki"}) as Buffer;
    const pairing=new PgPairingChallenges(db,randomBytes(32));
    const pending=await pairing.issue("Test device",pub);
    assert.equal(await pairing.review(pending.id,owner,pending.userCode,"approve"),"approved");
    const enrolled=await pairing.enroll(pending.id,pending.deviceCode,
      sign(null,redemptionProof(pending.id,pending.deviceCode),key.privateKey));
    assert.equal(enrolled.kind,"enrolled");
    if(enrolled.kind!=="enrolled")return;
    const device=enrolled.deviceId;
    const manager=new PgDeviceManagement(db);
    assert.deepEqual(await manager.list(foreign),[]);
    assert.equal((await manager.list(owner)).length,1);
    assert.equal((await manager.list(owner))[0]?.enabled,false);

    await db.query("UPDATE devices SET enabled=true WHERE id=$1",[device]);
    const proj=randomUUID();
    await db.query("INSERT INTO projects(id,device_id,owner_sub,alias,enabled) VALUES ($1,$2,$3,'Demo',true)",
      [proj,device,owner]);
    await db.query(
      "INSERT INTO project_client_grants(project_id,owner_sub,client_id,enabled) VALUES($1,$2,'client-x',true)",
      [proj,owner]);

    const store=new PgConnectorSessions(db);
    const start=await store.issue(owner,device);
    assert.equal(start.kind,"issued");
    if(start.kind!=="issued")return;
    assert.equal((await store.activate(owner,device,start.sessionId,start.nonce,start.binding,
      sign(null,connectorSessionProof(start.sessionId,start.challengeId,device,
        start.nonce,start.binding),key.privateKey))).kind,"active");
    assert.equal(await manager.revokeDevice(foreign,device),false);
    assert.equal((await db.query("SELECT state FROM connector_sessions WHERE id=$1",
      [start.sessionId])).rows[0].state,"active");
    assert.equal(await manager.revokeDevice(owner,device),true);
    assert.equal(await manager.revokeDevice(owner,device),true); // idempotent
    const row=(await db.query("SELECT d.enabled,c.revoked_at FROM devices d "+
      "JOIN device_credentials c ON c.device_id=d.id WHERE d.id=$1",[device])).rows[0];
    assert.equal(row.enabled,false);
    assert.ok(row.revoked_at instanceof Date);
    assert.equal((await db.query("SELECT state FROM connector_sessions WHERE id=$1",
      [start.sessionId])).rows[0].state,"revoked");
    assert.equal((await db.query("SELECT enabled FROM projects WHERE id=$1",[proj])).rows[0].enabled,false);
    assert.equal((await db.query("SELECT enabled FROM project_client_grants WHERE project_id=$1",
      [proj])).rows[0].enabled,false);
    await db.query("UPDATE devices SET enabled=true WHERE id=$1",[device]);
    assert.equal((await pairing.activeDevicePublicKey(owner,device)),null);
    assert.equal((await store.issue(owner,device)).kind,"unavailable");
    assert.equal((await manager.list(owner))[0]?.revoked,true);
    assert.equal((await manager.list(owner))[0]?.enabled,true); // unrelated flag cannot revive revoked key
  });
});
