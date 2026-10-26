import type {Pool,PoolClient} from "pg";
import {issuePairing,reviewPairing,redeemPairing,
  type PairingRecord,type PairingStatus} from "./device-pairing.js";

type Row={
  id:string;device_alias:string;device_public_key_der:string;device_fingerprint:string;
  user_code_mac:string;device_code_mac:string;expires_at:Date;state:PairingStatus;
  attempts:number;owner_sub:string|null;
};
export type BrowserReview="approved"|"denied"|"invalid_code"|"locked"|"unavailable";
export type Redemption={kind:"redeemed";ownerSub:string;deviceFingerprint:string}|{kind:"unavailable"};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function convert(row:Row):PairingRecord {
  return {id:row.id,deviceAlias:row.device_alias,
    devicePublicKeyDer:row.device_public_key_der,deviceFingerprint:row.device_fingerprint,
    userCodeMac:row.user_code_mac,deviceCodeMac:row.device_code_mac,
    expiresAtMs:row.expires_at.getTime(),state:row.state,
    attempts:row.attempts,ownerSub:row.owner_sub};
}
async function clock(db:Pool|PoolClient):Promise<number>{
  const r=await db.query<{ms:string}>(
    "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms");
  const now=Number(r.rows[0]?.ms);
  if(!Number.isSafeInteger(now)||now<=0)throw new Error("INVALID_DATABASE_CLOCK");
  return now;
}
async function save(db:PoolClient,r:PairingRecord):Promise<void>{
  const result=await db.query(
    "UPDATE pairing_challenges SET state=$2,attempts=$3,owner_sub=$4 WHERE id=$1",
    [r.id,r.state,r.attempts,r.ownerSub]);
  if(result.rowCount!==1)throw new Error("PAIRING_ROW_MISSING");
}

/** Isolation only: NO browser authentication, CSRF, device credentials or live routes. */
export class PgPairingChallenges {
  private readonly key:Buffer;
  constructor(private readonly pool:Pool,secret:Buffer){
    if(!Buffer.isBuffer(secret)||secret.length<32)throw new Error("PAIRING_KEY_TOO_SHORT");
    this.key=Buffer.from(secret);
  }
  async issue(alias:string,publicKeyDer:Buffer){
    const now=await clock(this.pool);
    for(let i=0;i<3;i++){
      const issued=issuePairing(this.key,now,alias,publicKeyDer);
      const r=issued.record;
      try {
        await this.pool.query(
          "INSERT INTO pairing_challenges "+
          "(id,device_alias,device_public_key_der,device_fingerprint,user_code_mac,device_code_mac,expires_at,state,attempts,owner_sub) "+
          "VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7::double precision/1000),$8,$9,$10)",
          [r.id,r.deviceAlias,r.devicePublicKeyDer,r.deviceFingerprint,
           r.userCodeMac,r.deviceCodeMac,r.expiresAtMs,r.state,r.attempts,r.ownerSub]);
        return {id:r.id,userCode:issued.userCode,deviceCode:issued.deviceCode,
          deviceFingerprint:r.deviceFingerprint,expiresAtMs:r.expiresAtMs};
      }catch(e){
        if((e as {code?:string}).code!=="23505")throw e;
      }
    }
    throw new Error("PAIRING_CODE_COLLISION");
  }
  private async locked<T>(
    id:string,fallback:T,action:(db:PoolClient,r:PairingRecord,now:number)=>Promise<T>
  ):Promise<T>{
    if(!UUID.test(id))return fallback;
    const db=await this.pool.connect();
    try{
      await db.query("BEGIN");
      const rows=await db.query<Row>(
        "SELECT id,device_alias,device_public_key_der,device_fingerprint,"+
        "user_code_mac,device_code_mac,expires_at,state,attempts,owner_sub "+
        "FROM pairing_challenges WHERE id=$1 FOR UPDATE",[id]);
      let output=fallback;
      if(rows.rows[0])output=await action(db,convert(rows.rows[0]),await clock(db));
      await db.query("COMMIT");
      return output;
    }catch(e){
      try{await db.query("ROLLBACK");}catch{/*preserve first error*/}
      throw e;
    }finally{db.release();}
  }
  /** The caller MUST independently authenticate owner, verify CSRF and throttle. */
  async review(id:string,owner:string,code:string,decision:"approve"|"deny"):Promise<BrowserReview>{
    if(!owner||owner.length>256)return "unavailable";
    return this.locked(id,"unavailable" as BrowserReview,async(db,r,now)=>{
      const result=reviewPairing(r,this.key,now,owner,code,decision);
      if(result.record.state!==r.state||result.record.attempts!==r.attempts||
        result.record.ownerSub!==r.ownerSub)await save(db,result.record);
      return result.kind;
    });
  }
  /** A verified binding only; caller MUST NOT treat it as a device credential. */
  async redeem(id:string,code:string,signature:Buffer):Promise<Redemption>{
    return this.locked(id,{kind:"unavailable"} as Redemption,async(db,r,now)=>{
      const result=redeemPairing(r,this.key,now,code,signature);
      if(result.record.state!==r.state)await save(db,result.record);
      if(result.kind!=="redeemed")return {kind:"unavailable"};
      return {kind:"redeemed",ownerSub:result.ownerSub,deviceFingerprint:r.deviceFingerprint};
    });
  }
}
