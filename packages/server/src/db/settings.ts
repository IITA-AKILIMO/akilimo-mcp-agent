// Database settings from Laravel-style variables (src/config.ts):
//   DB_HOST, DB_PORT (5432), DB_DATABASE, DB_SCHEMA (public), DB_USERNAME, DB_PASSWORD
// DB_CLIENT (or DB_CONNECTION) is optional and must be pgsql if set. Without DB_HOST the app runs
// guest-only, so databaseSettings() returns null.

export interface DatabaseSettings {
    host: string;
    port: number;
    database: string;
    schema: string;
    user: string;
    password: string;
    connectionString: string;
}

export function databaseSettings(env: NodeJS.ProcessEnv = process.env): DatabaseSettings | null {
    // No host: accounts are off (guest-only HTTP mode, stdio mode, drizzle-kit generate)
    const host = env.DB_HOST ?? ''
    if (!host) return null

    // Empty values count as unset, so a blank line in .env falls back to the default
    const client = env.DB_CLIENT || env.DB_CONNECTION || 'pgsql'
    const user = env.DB_USERNAME ?? ''
    const password = env.DB_PASSWORD ?? ''
    const schema = env.DB_SCHEMA || 'public'
    const port = env.DB_PORT || defaultPort(client)
    const db = env.DB_DATABASE || 'akilimo_mcp'


    let connectionString = ''
    switch (client) {
        case 'pgsql':
            // case 'mysql':
            // case 'mariadb':
            // case 'mssql':
            if (!user) throw new Error(`Missing DB_USERNAME for ${client}`)
            if (!password) throw new Error(`Missing DB_PASSWORD for ${client}`)
            if (!db) throw new Error(`Missing DB_DATABASE for ${client}`)
            if (!port) throw new Error(`Missing DB_PORT for ${client}`)
            // postgresql:// is the scheme PostgreSQL tools (drizzle-kit, psql) expect
            connectionString = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`
            break;
        default:
            throw new Error(`Unsupported DB_CLIENT: ${client}`)
    }

    return {
        host: host,
        port: Number(port),
        database: db,
        user: user,
        schema: schema,
        password: password,
        connectionString: connectionString
    };
}


function defaultPort(client: string): string {
    switch (client) {
        case 'pgsql':
        case 'postgres':
        case 'postgresql':
            return '5432'
        case 'mysql':
        case 'mariadb':
            return '3306'
        case 'mssql':
            return '1433'
        case 'sqlite':
            return '' // no port
        default:
            return ''
    }
}
