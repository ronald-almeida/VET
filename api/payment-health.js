import { atlasRequest, secureResponse } from '../lib/atlas.js';

// Read-only authentication probe: no account details or key are returned.
export default async function handler(request, response) {
  secureResponse(response);
  if (request.method !== 'GET') return response.status(405).json({ available: false });
  try {
    const result = await atlasRequest('/ping');
    if (result.ok !== true) throw new Error('Atlas ping failed');
    return response.status(200).json({ available: true, provider: 'Atlas Pags', amountInCents: 28700 });
  } catch (error) {
    console.error('atlas_health_failed', { code: error.code ?? 'INTERNAL_ERROR' });
    return response.status(503).json({ available: false, provider: 'Atlas Pags', code: error.code ?? 'INTERNAL_ERROR' });
  }
}
