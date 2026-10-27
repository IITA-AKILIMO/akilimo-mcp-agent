// drizzle-kit configuration. `pnpm db:generate` only compares schema.ts with the previous
// migration snapshot, so it needs no database connection and downloads nothing.
import {defineConfig} from "drizzle-kit";
import {config} from "./src/config.js";


export default defineConfig({
    dialect: "postgresql",
    schema: "./src/db/schema.ts",
    out: "./drizzle",
    dbCredentials: {url: config.database.connectionString},
    migrations: {schema: process.env.DB_SCHEMA ?? 'public'},
});
