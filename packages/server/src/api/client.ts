import axios, { AxiosInstance } from 'axios';

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
