import { AMOUNT_IN_CENTS, PaymentError, readPost, verifyPaymentToken, firebotRequest, secureResponse, sendError } from '../lib/firebot.js';

export default async function handler(request, response) {
  secureResponse(response);
  response.setHeader('Allow', 'POST');
  try {
    const { paymentToken } = readPost(request);
    const payment = verifyPaymentToken(paymentToken);
    const result = await firebotRequest(`/api/v1/pix/${encodeURIComponent(payment.id)}`);
    const transaction = result.transaction ?? result.data ?? result;
    if (transaction.transactionId && transaction.transactionId !== payment.id) throw new PaymentError('Não foi possível validar o status do pagamento.', 502, 'INVALID_PAYMENT_STATUS');
    if (Math.round(Number(transaction.amount) * 100) !== AMOUNT_IN_CENTS) throw new PaymentError('Não foi possível validar o valor do pagamento.', 502, 'INVALID_PAYMENT_AMOUNT');
    if (!['PAID', 'PENDING', 'CANCELLED', 'REFUNDED'].includes(transaction.status)) throw new PaymentError('O status do pagamento ainda não está disponível. Tente consultar novamente.', 502, 'UNKNOWN_PAYMENT_STATUS');
    return response.status(200).json({ transactionId: payment.id, amountInCents: AMOUNT_IN_CENTS, status: transaction.status });
  } catch (error) { return sendError(response, error); }
}
