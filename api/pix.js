import { AMOUNT_IN_CENTS, STORE_URL, readPost, readIdempotencyKey, normalizeCustomer, atlasRequest, normalizePayment, secureResponse, sendError } from '../lib/atlas.js';

export default async function handler(request, response) {
  secureResponse(response);
  response.setHeader('Allow', 'POST');
  try {
    const { customer } = readPost(request);
    const idempotencyKey = readIdempotencyKey(request);
    const buyer = normalizeCustomer(customer);
    const data = await atlasRequest('/charges', { method: 'POST', idempotencyKey, body: {
      amount: AMOUNT_IN_CENTS / 100,
      method: 'pix',
      description: 'Destrava Vet - Vitalício',
      checkout_url: STORE_URL,
      customer: buyer,
    } });
    return response.status(200).json(normalizePayment(data));
  } catch (error) { return sendError(response, error); }
}
