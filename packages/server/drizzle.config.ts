// drizzle-kit configuration. `pnpm db:generate` only compares schema.ts with the previous
// migration snapshot, so it needs no database connection and downloads nothing.
import {defineConfig} from "drizzle-kit";
import {config} from "./src/config.js";


export default defineConfig({
    dialect: "postgresql",
    schema: "./src/db/schema.ts",
    out: "./drizzle",
    // Only commands that talk to the database (migrate, push, studio) need credentials;
    // `generate` works without any, as config.database is null when DB_HOST is unset
    ...(config.database ? {dbCredentials: {url: config.database.connectionString}} : {}),
    migrations: {schema: config.database?.schema ?? 'public'},
});
