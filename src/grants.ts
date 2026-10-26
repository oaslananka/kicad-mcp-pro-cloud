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
}

export class PgGrantManagement extends PgInventory implements GrantManagement {
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