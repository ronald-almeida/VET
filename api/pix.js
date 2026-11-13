// Fail closed until the authenticated Firebot BR API contract is available.
// Never place the provider API key in dist/ or trust a price sent by a browser.
export default function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ message: 'Método não permitido.' });
  }
  return response.status(503).json({
    code: 'FIREBOT_NOT_CONFIGURED',
    message: 'O pagamento está temporariamente indisponível. Tente novamente mais tarde.',
  });
}
