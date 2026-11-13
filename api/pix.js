import { AMOUNT_IN_CENTS, STORE_URL, readPost, normalizeCustomer, firebotRequest, normalizePayment, secureResponse, sendError } from '../lib/firebot.js';

export default async function handler(request, response) {
  secureResponse(response);
  response.setHeader('Allow', 'POST');
  try {
    const { customer } = readPost(request);
    const buyer = normalizeCustomer(customer);
    const data = await firebotRequest('/api/v1/pix/create', { method: 'POST', body: {
      amount: AMOUNT_IN_CENTS / 100,
      productType: 'DIGITAL',
      description: 'Destrava Vet - Vitalício',
      storeUrl: STORE_URL,
      customer: buyer,
      qrStyle: 'plain',
    } });
    return response.status(200).json(normalizePayment(data));
  } catch (error) { return sendError(response, error); }
}
