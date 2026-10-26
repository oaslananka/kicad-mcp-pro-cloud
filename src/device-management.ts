import type {Pool} from "pg";

const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ManagedDevice {
  id:string;
  alias:string;
  enabled:boolean;
  revoked:boolean;
  fingerprint:string;
  createdAt:Date;
}

/** No device credentials, private keys or local project paths are returned. */
export class PgDeviceManagement {
  constructor(private readonly pool:Pool){}

  async list(owner:string):Promise<ManagedDevice[]> {
    if(!owner||owner.length>256)return [];
    const result=await this.pool.query<{
      id:string;alias:string;enabled:boolean;revoked:boolean;
      fingerprint:string;created_at:Date;
    }>(
      "SELECT d.id,d.alias,d.enabled,(c.revoked_at IS NOT NULL) AS revoked,"+
      "c.key_fingerprint AS fingerprint,d.created_at FROM devices d "+
      "JOIN device_credentials c ON c.device_id=d.id AND c.owner_sub=d.owner_sub "+
      "WHERE d.owner_sub=$1 ORDER BY d.created_at DESC,d.id LIMIT 100",[owner]);
    return result.rows.map(r=>({
      id:r.id,alias:r.alias,enabled:r.enabled,revoked:r.revoked,
      fingerprint:r.fingerprint,createdAt:r.created_at
    }));
  }

  /**
   * Owner-scoped, irreversible revocation and cascading permission fence.
   * This cannot be undone by toggling the device enabled flag later.
   */
  async revokeDevice(owner:string,id:string):Promise<boolean> {
    if(!owner||owner.length>256||!ID.test(id))return false;
    const db=await this.pool.connect();
    try{
      await db.query("BEGIN");
      const existing=await db.query(
        "SELECT d.id FROM devices d JOIN device_credentials c "+
        "ON c.device_id=d.id AND c.owner_sub=d.owner_sub "+
        "WHERE d.id=$1 AND d.owner_sub=$2 FOR UPDATE OF d,c",[id,owner]);
      if(existing.rowCount!==1){await db.query("ROLLBACK");return false;}
      await db.query(
        "UPDATE device_credentials SET revoked_at=COALESCE(revoked_at,clock_timestamp()) "+
        "WHERE device_id=$1 AND owner_sub=$2",[id,owner]);
      await db.query("UPDATE devices SET enabled=false WHERE id=$1 AND owner_sub=$2",[id,owner]);
      await db.query(
        "UPDATE connector_sessions SET state='revoked' "+
        "WHERE device_id=$1 AND owner_sub=$2 AND state IN ('pending','active')",[id,owner]);
      await db.query(
        "UPDATE device_handshake_challenges SET status='revoked' "+
        "WHERE device_id=$1 AND owner_sub=$2 AND status='pending'",[id,owner]);
      await db.query(
        "UPDATE project_client_grants SET enabled=false WHERE owner_sub=$2 "+
        "AND project_id IN (SELECT id FROM projects WHERE device_id=$1 AND owner_sub=$2)",
        [id,owner]);
      await db.query("UPDATE projects SET enabled=false WHERE device_id=$1 AND owner_sub=$2",[id,owner]);
      await db.query("COMMIT");
      return true;
    }catch(error){
      try{await db.query("ROLLBACK");}catch{/* preserve cause */}
      throw error;
    }finally{db.release();}
  }
}
