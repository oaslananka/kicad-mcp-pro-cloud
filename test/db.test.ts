import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";
import { PgInventory } from "../src/store.js";

const url = process.env.TEST_DATABASE_URL;
test("postgres enforces ownership, disabled projects and opaque-only records", {skip:!url}, async()=>{
  const admin = new pg.Pool({connectionString:url});
  const schema = await readFile(new URL("../db/001_inventory.pgsql",import.meta.url),"utf8");
  const deviceA = "2e850e45-e34b-4f14-a042-ed7449bf42de";
  const deviceB = "bb4de070-a6f1-45ab-9ad6-62983605d6be";
  const projectA = "6abdd0d3-4665-4db4-bc58-a8aca819a123";
  const projectDisabled = "d0531d7a-dc6f-4472-8886-7e98885670c4";
  const projectB = "94017537-b93b-47fa-96b9-0e4b1872df51";
  const inventory = new PgInventory(url!);
  try {
    await admin.query(schema);
    await admin.query("INSERT INTO devices (id,owner_sub,alias,enabled) VALUES ($1,'owner-a','A',true),($2,'owner-b','B',true)",[deviceA,deviceB]);
    await admin.query("INSERT INTO projects (id,device_id,owner_sub,alias,enabled) VALUES ($1,$2,'owner-a','USB-C',true),($3,$2,'owner-a','Disabled',false),($4,$5,'owner-b','Other',true)",[projectA,deviceA,projectDisabled,projectB,deviceB]);
    const projects = await inventory.listProjects("owner-a");
    assert.deepEqual(projects.map(p=>p.alias),["USB-C"]);
    assert.equal(projects[0].available,false);
    assert.equal(await inventory.getProject("owner-b",projectA),null);
    assert.equal(await inventory.getProject("owner-a",projectDisabled),null);
    assert.equal((await inventory.listDevices("owner-b")).length,1);
    await assert.rejects(admin.query("INSERT INTO projects(id,device_id,owner_sub,alias) VALUES ('1961d3a0-5e7b-44a5-b903-3c4efb2531a7',$1,'owner-a','Injected')",[deviceB]));
  } finally {
    try{await admin.query("DELETE FROM projects WHERE id = ANY($1::uuid[])",[[projectA,projectDisabled,projectB]]);}catch{}
    try{await admin.query("DELETE FROM devices WHERE id = ANY($1::uuid[])",[[deviceA,deviceB]]);}catch{}
    await inventory.close();
    await admin.end();
  }
});
