import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import type { Inventory } from "./store.js";
import { createCloudMcpHandler } from "./mcp.js";
import type { Verifier } from "./auth.js";
import type { GrantManagement, AccessMode } from "./grants.js";

const MAX_BODY = 1024 * 1024;
const noCache = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function json(res: ServerResponse, code: number, body: object, headers: Record<string,string> = {}) {
  res.writeHead(code, { ...noCache, ...headers, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function deny(res: ServerResponse, code: number, error: string) {
  json(res, code, { error });
}
function bearerChallenge(config: Config) {
  return 'Bearer resource_metadata="' + config.publicOrigin + '/.well-known/oauth-protected-resource", scope="projects:read"';
}
async function requestBody(req: IncomingMessage): Promise<Buffer> {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += data.length;
    if (length > MAX_BODY) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(data);
  }
  return Buffer.concat(chunks);
}
function validHost(req: IncomingMessage, publicOrigin: string): boolean {
  const expected = new URL(publicOrigin);
  const host = req.headers.host;
  if (typeof host !== "string" || host.includes(",") || host.includes("@")) return false;
  if (host === expected.host) return true;
  if (expected.hostname === "127.0.0.1") return /^127\.0\.0\.1:[0-9]{1,5}$/.test(host);
  if (expected.hostname === "localhost") return /^localhost:[0-9]{1,5}$/.test(host);
  return false;
}
function validOrigin(req: IncomingMessage, config: Config): boolean {
  const origin = req.headers.origin;
  return origin === undefined || (typeof origin === "string" &&
    (origin === config.publicOrigin || config.allowedOrigins.includes(origin)));
}

export function createHttpServer(config: Config, inventory: Inventory, verify: Verifier, grants?: GrantManagement): Server {
  return createServer((req, res) => {
    void handleRequest(req, res, config, inventory, verify, grants).catch(() => {
      if (!res.headersSent) deny(res, 500, "internal_error");
      else res.end();
    });
  });
}

async function handleRequest(
  req: IncomingMessage, res: ServerResponse, config: Config,
  inventory: Inventory, verify: Verifier, grants?: GrantManagement
): Promise<void> {
    try {
      if (!validHost(req, config.publicOrigin) || !validOrigin(req, config)) {
        deny(res, 403, "origin_or_host_not_allowed");
        return;
      }
      const path = new URL(req.url ?? "/", config.publicOrigin).pathname;
      if (path === "/health" && req.method === "GET") {
        json(res, 200, { status: "ok", mcp: "/mcp", remoteConnector: "not_implemented" });
        return;
      }
      if ((path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") && req.method === "GET") {
        json(res, 200, {
          resource: config.audience,
          authorization_servers: [config.issuer],
          scopes_supported: ["projects:read"],
          bearer_methods_supported: ["header"]
        });
        return;
      }
      if (path === "/" && req.method === "GET") {
        res.writeHead(200, {
          ...noCache, "Content-Type": "text/plain; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
        });
        res.end("KiCad MCP Pro Cloud: secure MCP foundation. User registration and local device pairing are not yet available.");
        return;
      }
      const grantRoute = /^\/api\/v1\/projects\/([0-9a-f-]{36})\/grants$/.exec(path);
      if (grantRoute && req.method === "PUT" && grants) {
        const header = req.headers.authorization;
        const matched = typeof header === "string" ? /^Bearer ([A-Za-z0-9._~+/-]+={0,2})$/.exec(header) : null;
        if (!matched) { deny(res, 401, "authentication_required"); return; }
        let actor;
        try { actor = await verify(matched[1]); }
        catch { deny(res, 401, "invalid_access_token"); return; }
        if (!config.managementClientId || actor.clientId !== config.managementClientId || !actor.scopes.has("projects:manage")) {
          deny(res, 403, "forbidden"); return;
        }
        if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
          deny(res, 415, "unsupported_media_type"); return;
        }
        let body: unknown;
        try { body = JSON.parse((await requestBody(req)).toString("utf8")); }
        catch { deny(res, 400, "invalid_json"); return; }
        if (!body || Array.isArray(body) || typeof body !== "object") {
          deny(res, 400, "invalid_grant"); return;
        }
        const fields = body as Record<string,unknown>;
        const mode = fields.maxMode;
        const clientId = fields.clientId;
        const enabled = fields.enabled;
        if (Object.keys(fields).length !== 3 || !["clientId","enabled","maxMode"].every(key => Object.hasOwn(fields,key)) ||
            typeof clientId !== "string" || clientId.length < 1 || clientId.length > 1024 ||
            typeof enabled !== "boolean" ||
            (mode !== "readonly" && mode !== "write" && mode !== "manufacturing")) {
          deny(res, 400, "invalid_grant"); return;
        }
        try {
          const ok = await grants.setGrant(actor.sub, actor.clientId, grantRoute[1], {
            clientId, enabled, maxMode: mode as AccessMode
          });
          if (!ok) { deny(res, 404, "not_found"); return; }
          json(res, 200, {updated:true}); return;
        } catch (error) {
          if (error instanceof Error && error.message === "POLICY_EXCEEDS_PROJECT") {
            deny(res, 409, "grant_exceeds_project_policy"); return;
          }
          throw error;
        }
      }
      if (path !== "/mcp") {
        deny(res, 404, "not_found");
        return;
      }
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        deny(res, 405, "method_not_allowed");
        return;
      }
      const header = req.headers.authorization;
      const matched = typeof header === "string" ? /^Bearer ([A-Za-z0-9._~+/-]+={0,2})$/.exec(header) : null;
      if (!matched) {
        json(res, 401, { error: "authentication_required" }, { "WWW-Authenticate": bearerChallenge(config) });
        return;
      }
      let actor;
      try {
        actor = await verify(matched[1]);
      } catch {
        json(res, 401, { error: "invalid_access_token" }, { "WWW-Authenticate": bearerChallenge(config) });
        return;
      }
      if (!actor.scopes.has("projects:read") || !actor.sub) {
        deny(res, 403, "insufficient_scope");
        return;
      }
      if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
        deny(res, 415, "unsupported_media_type");
        return;
      }
      const bytes = await requestBody(req);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      // Authorization was checked above; do not forward the bearer token to the SDK.
      headers.delete("authorization");
      const request = new Request(config.publicOrigin + "/mcp", {
        method: "POST", headers, body: bytes.toString("utf8")
      });
      const handler = createCloudMcpHandler(inventory, actor);
      let output: Response;
      try {
        output = await handler.fetch(request);
      } finally {
        await handler.close();
      }
      const outHeaders = Object.fromEntries(output.headers);
      delete outHeaders["set-cookie"];
      res.writeHead(output.status, { ...noCache, ...outHeaders });
      res.end(Buffer.from(await output.arrayBuffer()));
    } catch (error) {
      if (!res.headersSent) {
        deny(res, error instanceof Error && error.message === "REQUEST_TOO_LARGE" ? 413 : 500,
          error instanceof Error && error.message === "REQUEST_TOO_LARGE" ? "request_too_large" : "internal_error");
      } else {
        res.end();
      }
    }
}
