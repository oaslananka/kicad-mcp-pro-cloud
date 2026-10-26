-- Fail-closed revocation fence for Better Auth's pinned OAuth token tables.
-- Both new refresh and opaque access token rows are blocked after a client
-- revocation. New social login/re-authorization needs an explicit
-- session-bound reset protocol, which is NOT provided in this increment.
-- A new, explicit OAuth consent allows ONLY a new authorization-code lineage.
-- Previous token families remain denied, even if their delayed issuance
-- races with a legitimate fresh consent. The advisory key and salt MUST
-- match PgGrantManagement.revokeClient.
CREATE OR REPLACE FUNCTION kicad_fence_oauth_issuance()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW."userId" || chr(31) || NEW."clientId", 48296018)
  );
  IF EXISTS (
    SELECT 1 FROM client_token_cutoffs c
    WHERE c.owner_sub=NEW."userId" AND c.client_id=NEW."clientId"
      AND (
        NEW."authorizationCodeId" IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM "oauthConsent" consent
          WHERE consent."userId"=NEW."userId"
            AND consent."clientId"=NEW."clientId"
            AND consent."createdAt">c.revoked_at
        )
        OR EXISTS (
          SELECT 1 FROM "oauthRefreshToken" previous
          WHERE previous."userId"=NEW."userId"
            AND previous."clientId"=NEW."clientId"
            AND previous."authorizationCodeId"=NEW."authorizationCodeId"
            AND previous."createdAt"<=c.revoked_at
        )
      )
  ) THEN
    RAISE EXCEPTION 'oauth_client_revoked'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$body$;

CREATE TRIGGER kicad_fence_refresh_insert
BEFORE INSERT ON "oauthRefreshToken"
FOR EACH ROW EXECUTE FUNCTION kicad_fence_oauth_issuance();

CREATE TRIGGER kicad_fence_opaque_access_insert
BEFORE INSERT ON "oauthAccessToken"
FOR EACH ROW EXECUTE FUNCTION kicad_fence_oauth_issuance();

CREATE OR REPLACE FUNCTION kicad_block_revoked_replay()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  IF NEW."rotationReplayResponse" IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW."userId" || chr(31) || NEW."clientId", 48296018)
    );
    IF EXISTS (
      SELECT 1 FROM client_token_cutoffs c
      WHERE c.owner_sub=NEW."userId" AND c.client_id=NEW."clientId"
        AND (
          NEW."authorizationCodeId" IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM "oauthConsent" consent
            WHERE consent."userId"=NEW."userId"
              AND consent."clientId"=NEW."clientId"
              AND consent."createdAt">c.revoked_at
          )
          OR EXISTS (
            SELECT 1 FROM "oauthRefreshToken" previous
            WHERE previous."userId"=NEW."userId"
              AND previous."clientId"=NEW."clientId"
              AND previous."authorizationCodeId"=NEW."authorizationCodeId"
              AND previous."createdAt"<=c.revoked_at
          )
        )
    ) THEN
      RAISE EXCEPTION 'oauth_client_revoked'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END
$body$;

CREATE TRIGGER kicad_fence_refresh_replay
BEFORE UPDATE OF "rotationReplayResponse" ON "oauthRefreshToken"
FOR EACH ROW EXECUTE FUNCTION kicad_block_revoked_replay();
