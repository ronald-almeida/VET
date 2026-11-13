import { firebotRequest, secureResponse } from '../lib/firebot.js';

// Read-only authentication probe: no account details or key are returned.
export default async function handler(request, response) {
  secureResponse(response);
  if (request.method !== 'GET') return response.status(405).json({ available: false });
  try {
    await firebotRequest('/api/v1/auth');
    return response.status(200).json({ available: true, provider: 'Firebot BR', amountInCents: 28700 });
  } catch { return response.status(503).json({ available: false, provider: 'Firebot BR' }); }
}
