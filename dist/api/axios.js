import { container } from 'tsyringe';
import { Client } from '../struct/client.js';
import { Api, HttpClient } from './generated.js';
const httpClient = new HttpClient({
    baseURL: `${process.env.INTERNAL_API_BASE_URL}/v1`,
    secure: true,
    securityWorker: () => {
        return {
            headers: {
                'x-api-key': process.env.INTERNAL_API_KEY
            }
        };
    }
});
httpClient.instance.interceptors.response.use((response) => response, (error) => {
    const client = container.resolve(Client);
    client.logger.error(`${JSON.stringify(error.response?.data || error.code, null, 0)}`, {
        label: 'AXIOS'
    });
    console.error(error);
});
export const encode = (str) => encodeURIComponent(str);
export const api = new Api(httpClient);
//# sourceMappingURL=axios.js.map