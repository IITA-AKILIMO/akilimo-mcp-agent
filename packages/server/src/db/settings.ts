// Database settings from Laravel-style variables (src/config.ts):
//   DB_HOST, DB_PORT (5432), DB_DATABASE, DB_USERNAME, DB_PASSWORD
// DB_CONNECTION is optional and must be pgsql if set. Without DB_HOST the app runs guest-only.

export interface DatabaseSettings {
    host: string;
    port: number;
    database: string;
    schema: string;
    user: string;
    password: string;
    connectionString: string;
}

export function databaseSettings(env: NodeJS.ProcessEnv = process.env): DatabaseSettings {


    const client = process.env.DB_CLIENT ?? 'pgsql'
    const user = process.env.DB_USERNAME ?? ''
    const password = process.env.DB_PASSWORD ?? ''
    const host = process.env.DB_HOST ?? ''
    const schema = process.env.DB_SCHEMA ?? 'public'
    const port = process.env.DB_PORT ?? defaultPort(client)
    const db = process.env.DB_DATABASE ?? 'akilimo_mcp'


    let connectionString = ''
    switch (client) {
        case 'pgsql':
            // case 'mysql':
            // case 'mariadb':
            // case 'mssql':
            if (!user) throw new Error(`Missing DB_USERNAME for ${client}`)
            if (!password) throw new Error(`Missing DB_PASSWORD for ${client}`)
            if (!host) throw new Error(`Missing DB_HOST for ${client}`)
            if (!db) throw new Error(`Missing DB_DATABASE for ${client}`)
            if (!port) throw new Error(`Missing DB_PORT for ${client}`)
            connectionString = `${client}://${user}:${encodeURIComponent(password)}@${host}:${port}/${db}`
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
