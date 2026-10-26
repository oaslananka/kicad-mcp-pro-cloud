import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Actor } from "./auth.js";
import type { Inventory } from "./store.js";

const text = (value: object) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: value
});
const readonly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function createCloudMcpHandler(inventory: Inventory, actor: Actor) {
  return createMcpHandler(() => {
    const mcp = new McpServer({ name: "kicad-mcp-pro-cloud", version: "0.1.0" });
    mcp.registerTool("get_service_status", {
      description: "Describe Cloud connectivity limits and current feature availability. No local KiCad operation is performed.",
      inputSchema: z.object({}), annotations: readonly
    }, async () => text({
      status: "foundation_only",
      remoteKiCadExecution: false,
      devicePairing: false,
      projectManagementWrites: false,
      message: "Cloud inventory is read-only. A local connector is not yet available."
    }));
    mcp.registerTool("list_devices", {
      description: "List the authenticated user's registered device metadata. Connected always false until a verified device relay exists.",
      inputSchema: z.object({}), annotations: readonly
    }, async () => text({ devices: await inventory.listDevices(actor.sub,actor.clientId) }));
    mcp.registerTool("list_projects", {
      description: "List only enabled KiCad project aliases owned by the authenticated user. No local paths or design contents.",
      inputSchema: z.object({}), annotations: readonly
    }, async () => text({ projects: await inventory.listProjects(actor.sub,actor.clientId) }));
    mcp.registerTool("get_project", {
      description: "Find an enabled project by opaque UUID within the authenticated user's inventory; never returns paths or KiCad data.",
      inputSchema: z.object({ project_id: z.string().uuid() }), annotations: readonly
    }, async ({ project_id }) => {
      const project = await inventory.getProject(actor.sub,actor.clientId,project_id);
      return text(project ? { project } : { found: false, message: "Project not found or not accessible" });
    });
    return mcp;
  });
}
