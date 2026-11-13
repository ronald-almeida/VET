import { firebotRequest, secureResponse } from '../lib/firebot.js';

// Read-only authentication probe: no account details or key are returned.
export default async function handler(request, response) {
  secureResponse(response);
  if (request.method !== 'GET') return response.status(405).json({ available: false });
  try {
    await firebotRequest('/api/v1/account');
    return response.status(200).json({ available: true, provider: 'Firebot BR', amountInCents: 28700 });
  } catch (error) {
    console.error('firebot_health_failed', { code: error.code ?? 'INTERNAL_ERROR' });
    return response.status(503).json({ available: false, provider: 'Firebot BR', code: error.code ?? 'INTERNAL_ERROR' });
  }
}
