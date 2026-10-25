import pg from "pg";

export interface Device {
  id: string;
  alias: string;
  enabled: boolean;
  lastSeenAt: string | null;
  connected: false;
}
export interface Project {
  id: string;
  deviceId: string;
  alias: string;
  enabled: boolean;
  maxMode: "readonly" | "write" | "manufacturing";
  available: false;
  reason: "remote_connector_not_implemented";
}
export interface Inventory {
  listDevices(ownerSub: string): Promise<Device[]>;
  listProjects(ownerSub: string): Promise<Project[]>;
  getProject(ownerSub: string, projectId: string): Promise<Project | null>;
}

type DeviceRow = {id: string; alias: string; enabled: boolean; last_seen_at: Date | null};
type ProjectRow = {id: string; device_id: string; alias: string; enabled: boolean; max_mode: Project["maxMode"]};

export class PgInventory implements Inventory {
  private readonly pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 });
  }
  async listDevices(ownerSub: string): Promise<Device[]> {
    const result = await this.pool.query<DeviceRow>(
      "SELECT id, alias, enabled, last_seen_at FROM devices WHERE owner_sub = $1 ORDER BY alias, id LIMIT 100",
      [ownerSub]
    );
    return result.rows.map(d => ({
      id: d.id, alias: d.alias, enabled: d.enabled,
      lastSeenAt: d.last_seen_at?.toISOString() ?? null,
      connected: false
    }));
  }
  async listProjects(ownerSub: string): Promise<Project[]> {
    const result = await this.pool.query<ProjectRow>(
      "SELECT p.id, p.device_id, p.alias, p.enabled, p.max_mode FROM projects p JOIN devices d ON d.id = p.device_id AND d.owner_sub = p.owner_sub WHERE p.owner_sub = $1 AND p.enabled = true AND d.enabled = true ORDER BY p.alias, p.id LIMIT 100",
      [ownerSub]
    );
    return result.rows.map(toProject);
  }
  async getProject(ownerSub: string, projectId: string): Promise<Project | null> {
    const result = await this.pool.query<ProjectRow>(
      "SELECT p.id, p.device_id, p.alias, p.enabled, p.max_mode FROM projects p JOIN devices d ON d.id = p.device_id AND d.owner_sub = p.owner_sub WHERE p.owner_sub = $1 AND p.id = $2 AND p.enabled = true AND d.enabled = true LIMIT 1",
      [ownerSub, projectId]
    );
    return result.rows[0] ? toProject(result.rows[0]) : null;
  }
  async close(): Promise<void> { await this.pool.end(); }
}
function toProject(p: ProjectRow): Project {
  return {
    id:p.id, deviceId:p.device_id, alias:p.alias,
    enabled:p.enabled, maxMode:p.max_mode,
    available:false, reason:"remote_connector_not_implemented"
  };
}
