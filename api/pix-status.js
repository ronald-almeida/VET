import { AMOUNT_IN_CENTS, PaymentError, readPost, verifyPaymentToken, atlasRequest, secureResponse, sendError } from '../lib/atlas.js';

export default async function handler(request, response) {
  secureResponse(response);
  response.setHeader('Allow', 'POST');
  try {
    const { paymentToken } = readPost(request);
    const payment = verifyPaymentToken(paymentToken);
    const charge = await atlasRequest(`/charges/${encodeURIComponent(payment.id)}`);
    if (charge.id !== payment.id || charge.method !== 'pix') throw new PaymentError('Não foi possível validar o status do pagamento.', 502, 'INVALID_PAYMENT_STATUS');
    if (Math.round(Number(charge.amount) * 100) !== AMOUNT_IN_CENTS) throw new PaymentError('Não foi possível validar o valor do pagamento.', 502, 'INVALID_PAYMENT_AMOUNT');
    const statuses = { pending: 'PENDING', paid: 'PAID', failed: 'CANCELLED', expired: 'EXPIRED', refunded: 'REFUNDED', chargeback: 'CHARGEBACK' };
    const status = statuses[charge.status];
    if (!status) throw new PaymentError('O status do pagamento ainda não está disponível. Tente consultar novamente.', 502, 'UNKNOWN_PAYMENT_STATUS');
    return response.status(200).json({ transactionId: payment.id, amountInCents: AMOUNT_IN_CENTS, status });
  } catch (error) { return sendError(response, error); }
}
