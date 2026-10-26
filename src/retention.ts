import type {Pool,PoolClient} from "pg";

const BATCH_SIZE=100;

/**
 * Security-sensitive identity data is held for an explicit 30-day grace
 * period after its hard expiration; activity budgets for 24 hours after
 * their window began (well beyond their 5- or 15-minute enforcement).
 *
 * This is deliberately one bounded, opt-in invocation; no cron daemon.
 */
export type RetentionTable=
  "connector_sessions"|"device_handshake_challenges"|"pairing_challenges"|
  "pairing_review_budget"|"pairing_device_budget";
const ORDER:readonly RetentionTable[]=[
  "connector_sessions",
  "device_handshake_challenges",
  "pairing_challenges",
  "pairing_review_budget",
  "pairing_device_budget"
];
export type RetentionAction="dry-run"|"apply";
export type RetentionSummary={
  mode:RetentionAction;
  batchLimit:number;
  // Dry run returns at most batchLimit+1 matching records per table.
  // An exact remaining total is intentionally not computed.
  tables:Record<RetentionTable,{eligible:number;hasMore:boolean;deleted:number}>;
};

/**
 * All SQL statements are static literals. Even internally enumerated
 * table identifiers must never be interpolated into query text.
 */
async function countCandidates(
  db:PoolClient,table:RetentionTable
):Promise<number>{
  switch(table){
    case "connector_sessions": {
      const result=await db.query<{eligible:string}>(
        "SELECT count(*)::text AS eligible FROM (SELECT 1 FROM connector_sessions WHERE expires_at < statement_timestamp() - interval '30 days' LIMIT $1) bounded",[BATCH_SIZE+1]);
      return Number(result.rows[0]?.eligible??0);
    }
    case "device_handshake_challenges": {
      const result=await db.query<{eligible:string}>(
        "SELECT count(*)::text AS eligible FROM (SELECT 1 FROM device_handshake_challenges WHERE expires_at < statement_timestamp() - interval '30 days' AND NOT EXISTS (SELECT 1 FROM connector_sessions s WHERE s.handshake_id=device_handshake_challenges.id) LIMIT $1) bounded",[BATCH_SIZE+1]);
      return Number(result.rows[0]?.eligible??0);
    }
    case "pairing_challenges": {
      const result=await db.query<{eligible:string}>(
        "SELECT count(*)::text AS eligible FROM (SELECT 1 FROM pairing_challenges WHERE expires_at < statement_timestamp() - interval '30 days' AND NOT EXISTS (SELECT 1 FROM device_credentials c WHERE c.pairing_challenge_id=pairing_challenges.id) LIMIT $1) bounded",[BATCH_SIZE+1]);
      return Number(result.rows[0]?.eligible??0);
    }
    case "pairing_review_budget": {
      const result=await db.query<{eligible:string}>(
        "SELECT count(*)::text AS eligible FROM (SELECT 1 FROM pairing_review_budget WHERE window_started_at < statement_timestamp() - interval '24 hours' LIMIT $1) bounded",[BATCH_SIZE+1]);
      return Number(result.rows[0]?.eligible??0);
    }
    case "pairing_device_budget": {
      const result=await db.query<{eligible:string}>(
        "SELECT count(*)::text AS eligible FROM (SELECT 1 FROM pairing_device_budget WHERE window_started_at < statement_timestamp() - interval '24 hours' LIMIT $1) bounded",[BATCH_SIZE+1]);
      return Number(result.rows[0]?.eligible??0);
    }
  }
}
async function preview(
  db:PoolClient,table:RetentionTable
):Promise<{eligible:number;hasMore:boolean;deleted:number}>{
  const count=await countCandidates(db,table);
  return {eligible:Math.min(BATCH_SIZE,count),hasMore:count>BATCH_SIZE,deleted:0};
}
async function erase(db:PoolClient,table:RetentionTable):Promise<number>{
  // Each statement locks exactly its candidate rows, then deletes only
  // that fixed table. No delete cascades are used for referenced metadata.
  switch(table){
    case "connector_sessions": {
      const result=await db.query(
        "WITH victims AS (SELECT id FROM connector_sessions WHERE expires_at < statement_timestamp() - interval '30 days' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1) DELETE FROM connector_sessions t USING victims WHERE t.id=victims.id", [BATCH_SIZE]);
      return result.rowCount??0;
    }
    case "device_handshake_challenges": {
      const result=await db.query(
        "WITH victims AS (SELECT id FROM device_handshake_challenges WHERE expires_at < statement_timestamp() - interval '30 days' AND NOT EXISTS (SELECT 1 FROM connector_sessions s WHERE s.handshake_id=device_handshake_challenges.id) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1) DELETE FROM device_handshake_challenges t USING victims WHERE t.id=victims.id", [BATCH_SIZE]);
      return result.rowCount??0;
    }
    case "pairing_challenges": {
      const result=await db.query(
        "WITH victims AS (SELECT id FROM pairing_challenges WHERE expires_at < statement_timestamp() - interval '30 days' AND NOT EXISTS (SELECT 1 FROM device_credentials c WHERE c.pairing_challenge_id=pairing_challenges.id) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1) DELETE FROM pairing_challenges t USING victims WHERE t.id=victims.id", [BATCH_SIZE]);
      return result.rowCount??0;
    }
    case "pairing_review_budget": {
      const result=await db.query(
        "WITH victims AS (SELECT owner_sub FROM pairing_review_budget WHERE window_started_at < statement_timestamp() - interval '24 hours' ORDER BY owner_sub FOR UPDATE SKIP LOCKED LIMIT $1) DELETE FROM pairing_review_budget t USING victims WHERE t.owner_sub=victims.owner_sub", [BATCH_SIZE]);
      return result.rowCount??0;
    }
    case "pairing_device_budget": {
      const result=await db.query(
        "WITH victims AS (SELECT budget_key FROM pairing_device_budget WHERE window_started_at < statement_timestamp() - interval '24 hours' ORDER BY budget_key FOR UPDATE SKIP LOCKED LIMIT $1) DELETE FROM pairing_device_budget t USING victims WHERE t.budget_key=victims.budget_key", [BATCH_SIZE]);
      return result.rowCount??0;
    }
  }
}
export async function pruneExpiredMetadata(
  pool:Pool,action:RetentionAction="dry-run"
):Promise<RetentionSummary>{
  if(action!=="dry-run"&&action!=="apply")throw new Error("INVALID_RETENTION_ACTION");
  const db=await pool.connect();
  try{
    await db.query("BEGIN");
    try{
      // Fail closed on heavyweight table locks and unbounded query work.
      if(action==="dry-run")await db.query("SET TRANSACTION READ ONLY");
      await db.query("SET LOCAL lock_timeout = '2s'");
      await db.query("SET LOCAL statement_timeout = '10s'");
      const tables={} as RetentionSummary["tables"];
      for(const table of ORDER){
        const before=await preview(db,table);
        const deleted=action==="apply"?await erase(db,table):0;
        tables[table]={...before,deleted};
      }
      await db.query("COMMIT");
      return {mode:action,batchLimit:BATCH_SIZE,tables};
    }catch(error){
      try{await db.query("ROLLBACK");}catch{/* keep original error */}
      throw error;
    }
  }finally{db.release();}
}
