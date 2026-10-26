import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import pg from "pg";
import type { Config } from "./config.js";

export type IdentitySecrets = {
  secret: string;
  googleId: string;
  googleSecret: string;
  githubId: string;
  githubSecret: string;
};

// Use Better Auth as a FIRST-PARTY issuer; an external OAuth provider is not
// stacked on top of this. Resource, OAuth client and user identities are distinct.
export function createIdentity(
  config: Pick<Config, "publicOrigin" | "audience" | "databaseUrl">,
  credentials: IdentitySecrets,
  pool?: pg.Pool
) {
  if (credentials.secret.length < 32 || !credentials.googleId || !credentials.googleSecret ||
      !credentials.githubId || !credentials.githubSecret) {
    throw new Error("Identity provider requires an encryption secret and both social OAuth credentials");
  }
  return betterAuth({
    baseURL: config.publicOrigin,
    secret: credentials.secret,
    database: pool ?? new pg.Pool({
      connectionString: config.databaseUrl,
      max: 5,
      connectionTimeoutMillis: 3000
    }),
    emailAndPassword: { enabled: false },
    user: { modelName: "users" },
    socialProviders: {
      google: { clientId: credentials.googleId, clientSecret: credentials.googleSecret },
      github: { clientId: credentials.githubId, clientSecret: credentials.githubSecret }
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true
      }
    },
    plugins: [
      jwt({
        jwks: {
          keyPairConfig: { alg: "RS256" },
          rotationInterval: 60 * 60 * 24 * 30,
          gracePeriod: 60 * 60 * 24 * 30
        }
      }),
      mcp({
        resource: config.audience,
        loginPage: "/sign-in",
        consentPage: "/consent",
        scopes: ["openid", "profile", "offline_access", "projects:read", "projects:manage"]
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" })
    ]
  });
}
export type Identity = ReturnType<typeof createIdentity>;

export function identityFromEnvironment(
  config: Pick<Config, "publicOrigin" | "audience" | "databaseUrl">,
  env: NodeJS.ProcessEnv = process.env
): Identity {
  return createIdentity(config, {
    secret: env.BETTER_AUTH_SECRET ?? "",
    googleId: env.GOOGLE_CLIENT_ID ?? "",
    googleSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    githubId: env.GITHUB_CLIENT_ID ?? "",
    githubSecret: env.GITHUB_CLIENT_SECRET ?? ""
  });
}


// Explicit opt-in until first-party login, consent, and real OAuth issuance
// are proven end to end with registered Google/GitHub clients.
export function configuredIdentity(
  config: Config,
  env: NodeJS.ProcessEnv = process.env
): Identity | undefined {
  const mode = env.AUTH_MODE ?? "external";
  if (mode === "external") return undefined;
  if (mode !== "builtin") throw new Error("AUTH_MODE must be external or builtin");
  if (config.issuer !== config.publicOrigin + "/api/auth" ||
      config.jwksUrl !== config.publicOrigin + "/api/auth/jwks") {
    throw new Error("Built-in OAuth issuer and JWKS must match this public origin");
  }
  return identityFromEnvironment(config, env);
}
