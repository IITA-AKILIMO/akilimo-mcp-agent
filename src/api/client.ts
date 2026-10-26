import axios, { AxiosInstance } from 'axios';

export class AkilimoApiClient {
    private client: AxiosInstance;

    constructor(baseUrl: string, apiKey: string) {
        this.client = axios.create({
            baseURL: baseUrl,
            headers: {
                'X-Api-Key': apiKey,
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
            
            return new Error(`[Akilimo API ${status}] ${message}`);
        }
        return error instanceof Error ? error : new Error(String(error));
    }
}
