import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import type { Inventory } from "./store.js";
import { createCloudMcpHandler } from "./mcp.js";
import type { Verifier } from "./auth.js";

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
  return (expected.hostname === "127.0.0.1" || expected.hostname === "localhost")
    && new RegExp("^" + expected.hostname.replaceAll(".", "\\.") + ":[0-9]{1,5}$").test(host);
}
function validOrigin(req: IncomingMessage, config: Config): boolean {
  const origin = req.headers.origin;
  return origin === undefined || (typeof origin === "string" &&
    (origin === config.publicOrigin || config.allowedOrigins.includes(origin)));
}

export function createHttpServer(config: Config, inventory: Inventory, verify: Verifier): Server {
  return createServer(async (req, res) => {
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
          ...noCache, "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        });
        res.end("<!doctype html><html lang=en><meta charset=utf-8><title>KiCad MCP Pro Cloud</title><h1>KiCad MCP Pro Cloud</h1><p>Secure MCP foundation. User registration and local device pairing are not yet available.</p></html>");
        return;
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
  });
}
