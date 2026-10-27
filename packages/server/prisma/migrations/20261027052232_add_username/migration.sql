-- Hand-written: a required unique column cannot be added to a table that already has rows, so
-- usernames are backfilled from the email's local part before the constraint is applied.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "username" TEXT;

-- Backfill: lowercase local part, only a-z 0-9 . _ -, at most 30 characters, at least 3
-- (padded with "user"); later duplicates get a suffix from the account id
WITH base AS (
  SELECT
    "id",
    "created_at",
    CASE
      WHEN length(cleaned) >= 3 THEN cleaned
      ELSE cleaned || 'user'
    END AS name
  FROM (
    SELECT "id", "created_at",
           left(regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9._-]', '', 'g'), 30) AS cleaned
    FROM "users"
  ) source
),
numbered AS (
  SELECT "id", name, row_number() OVER (PARTITION BY name ORDER BY "created_at", "id") AS n
  FROM base
)
UPDATE "users" AS u
SET "username" = CASE
  WHEN numbered.n = 1 THEN numbered.name
  ELSE left(numbered.name, 21) || '-' || left(replace(u."id"::text, '-', ''), 8)
END
FROM numbered
WHERE u."id" = numbered."id";

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
