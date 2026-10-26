import axios, {type AxiosInstance } from 'axios';

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
            const status = error.response?.status;
            const data = error.response?.data;
            const message = data?.message || error.message;
            // Validation (422) and compute errors carry field-level details the model can act on
            const details = data?.errors ? `\n${JSON.stringify(data.errors, null, 2)}` : '';

            return new Error(`[Akilimo API ${status}] ${message}${details}`);
        }
        return error instanceof Error ? error : new Error(String(error));
    }
}
