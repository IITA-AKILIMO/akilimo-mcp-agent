import axios, {type AxiosInstance } from 'axios';
import { ToolError } from '../tools/types.js';

export class AkilimoApiClient {
    private client: AxiosInstance;

    constructor(baseUrl: string, apiKey?: string) {
        this.client = axios.create({
            baseURL: baseUrl,
            headers: {
                // Reference data and compute are public; the key is only needed for protected routes
                ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            timeout: 120000,
        });
    }

    async get<T>(url: string, params?: object): Promise<T> {
        try {
            const response = await this.client.get<T>(url, { params });
            return response.data;
        } catch (error: any) {
            throw this.handleError(error);
        }
    }

    // List endpoints are paginated (50 rows per page); follow meta.last_page so callers get every row
    async getAll<T = Record<string, unknown>>(url: string, maxPages = 20): Promise<{ data: T[]; total: number }> {
        const first = await this.get<any>(url);
        if (!first || !Array.isArray(first.data)) {
            const rows = (Array.isArray(first) ? first : [first]) as T[];
            return { data: rows, total: rows.length };
        }

        const lastPage = Math.min(Number(first.meta?.last_page) || 1, maxPages);
        const rest = await Promise.all(
            Array.from({ length: lastPage - 1 }, (_, i) => this.get<any>(url, { page: i + 2 }))
        );
        const data = [first, ...rest].flatMap(page => (page?.data ?? []) as T[]);
        return { data, total: Number(first.meta?.total) || data.length };
    }

    // A file such as a PDF report: the raw bytes and the type the API gave them
    async getFile(url: string): Promise<{ bytes: Buffer; contentType: string }> {
        try {
            const response = await this.client.get<ArrayBuffer>(url, { responseType: 'arraybuffer', headers: { Accept: 'application/pdf' } });
            return { bytes: Buffer.from(response.data), contentType: String(response.headers['content-type'] ?? 'application/octet-stream') };
        } catch (error: any) {
            // A signed link that expired or was changed (403) or a file already deleted (404)
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            if (status === 403 || status === 404) {
                throw new ToolError(`[Akilimo API ${status}] The report link has expired or is no longer valid; compute the recommendation again for a new one`);
            }
            if (axios.isAxiosError(error) && error.response) error.response.data = {}; // bytes (often an HTML page), not a message
            throw this.handleError(error);
        }
    }

    async post<T>(url: string, data?: object): Promise<T> {
        try {
            const response = await this.client.post<T>(url, data);
            return response.data;
        } catch (error: any) {
            throw this.handleError(error);
        }
    }

    private handleError(error: any): Error {
        if (axios.isAxiosError(error)) {
            // No answer (refused, timed out, DNS): the cause names internal hosts, so it is only logged
            if (!error.response) {
                console.error(`Akilimo API request failed: ${error.code ?? ''} ${error.message}`);
                return new ToolError(error.code === 'ECONNABORTED'
                    ? '[Akilimo API] The request timed out, try again later'
                    : '[Akilimo API] The service could not be reached, try again later');
            }
            const status = error.response.status;
            const data = error.response?.data;
            // An unhandled server error's message can carry internals (SQL, paths); the model only needs to know it failed
            const message = status === 500 ? 'The service had an internal error, try again later' : String(data?.message || error.message);
            if (status === 500) console.error(`Akilimo API 500: ${data?.message ?? error.message}`);
            // Validation (422) and compute errors carry field-level details the model can act on
            const details = data?.errors ? `\n${JSON.stringify(data.errors, null, 2).slice(0, 4000)}` : '';

            return new ToolError(`[Akilimo API ${status}] ${message}${details}`);
        }
        return error instanceof Error ? error : new Error(String(error));
    }
}
