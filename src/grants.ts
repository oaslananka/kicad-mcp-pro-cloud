import type { PoolClient } from "pg";
import { PgInventory } from "./store.js";

export type AccessMode = "readonly" | "write" | "manufacturing";
export type GrantInput = {
  clientId: string;
  enabled: boolean;
  maxMode: AccessMode;
};

export interface GrantManagement {
  setGrant(ownerSub: string, actorClientId: string, projectId: string, grant: GrantInput): Promise<boolean>;
  revokeClient(ownerSub: string, clientId: string): Promise<number>;
}

export class PgGrantManagement extends PgInventory implements GrantManagement {
  constructor(connectionString:string, private readonly builtInTokenStore=false) {
    super(connectionString);
  }
  async revokeClient(ownerSub: string, clientId: string): Promise<number> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      if (this.builtInTokenStore) {
        // Serialize with the issuance/replay triggers, including across
        // independent Cloud instances that share this PostgreSQL database.
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1 || chr(31) || $2, 48296018))",
          [ownerSub,clientId]
        );
      }
      await db.query(
        "INSERT INTO client_token_cutoffs(owner_sub,client_id,revoked_at) VALUES($1,$2,now()) ON CONFLICT(owner_sub,client_id) DO UPDATE SET revoked_at=excluded.revoked_at",
        [ownerSub,clientId]
      );
      if (this.builtInTokenStore) {
        // Clear rotated refresh-token replay caches as well as active tokens.
        await db.query(
          'UPDATE "oauthRefreshToken" SET "revoked"=COALESCE("revoked",now()), "rotationReplayResponse"=NULL, "rotationReplayExpiresAt"=NULL WHERE "userId"=$1 AND "clientId"=$2',
          [ownerSub,clientId]
        );
        await db.query(
          'UPDATE "oauthAccessToken" SET "revoked"=COALESCE("revoked",now()) WHERE "userId"=$1 AND "clientId"=$2',
          [ownerSub,clientId]
        );
      }
      const result = await db.query<{project_id:string}>(
        "UPDATE project_client_grants SET enabled=false WHERE owner_sub=$1 AND client_id=$2 AND enabled=true RETURNING project_id",
        [ownerSub,clientId]
      );
      if (result.rows.length) {
        await db.query(
          "INSERT INTO client_grant_audit(owner_sub,actor_client_id,project_id,operation) SELECT $1,$2,id,'client.revoke' FROM unnest($3::uuid[]) AS id",
          [ownerSub,clientId,result.rows.map(row=>row.project_id)]
        );
      }
      await db.query("COMMIT");
      return result.rowCount ?? 0;
    } catch(e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  async setGrant(ownerSub: string, actorClientId: string, projectId: string, grant: GrantInput): Promise<boolean> {
    const db: PoolClient = await this.pool.connect();
    try {
      await db.query("BEGIN");
      // Serialize against future project mode/ownership changes, and never accept foreign owners.
      const project = await db.query<{max_mode: AccessMode}>(
        "SELECT max_mode FROM projects WHERE id=$1 AND owner_sub=$2 FOR UPDATE", [projectId, ownerSub]
      );
      if (!project.rows[0]) {
        await db.query("ROLLBACK");
        return false;
      }
      if (grant.enabled && grant.maxMode !== "readonly" && grant.maxMode !== project.rows[0].max_mode) {
        throw new Error("POLICY_EXCEEDS_PROJECT");
      }
      await db.query(
        "INSERT INTO project_client_grants(project_id,owner_sub,client_id,enabled,max_mode) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,client_id) DO UPDATE SET enabled=excluded.enabled,max_mode=excluded.max_mode WHERE project_client_grants.owner_sub=excluded.owner_sub",
        [projectId,ownerSub,grant.clientId,grant.enabled,grant.maxMode]
      );
      await db.query(
        "INSERT INTO client_grant_audit(owner_sub,actor_client_id,project_id,operation) VALUES($1,$2,$3,'grant.set')",
        [ownerSub,actorClientId,projectId]
      );
      await db.query("COMMIT");
      return true;
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
}