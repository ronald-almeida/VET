import { createHmac, timingSafeEqual } from 'node:crypto';
import { validateCustomer, digits } from '../dist/validation.js';

export const AMOUNT_IN_CENTS = 28700;
export const STORE_URL = 'https://vet-pi-self.vercel.app';
const BASE_URL = 'https://firebotbr.com';
const TOKEN_LIFETIME = 24 * 60 * 60 * 1000;

export class PaymentError extends Error {
  constructor(message, status = 502, code = 'PAYMENT_UNAVAILABLE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getApiKey() {
  const value = process.env.FIREBOT_API_KEY?.trim();
  if (!value || !value.startsWith('fire_sk_live_')) throw new PaymentError('O pagamento está temporariamente indisponível. Tente novamente mais tarde.', 503, 'PAYMENT_NOT_CONFIGURED');
  return value;
}

export function secureResponse(response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

export function readPost(request) {
  if (request.method !== 'POST') throw new PaymentError('Método não permitido.', 405, 'METHOD_NOT_ALLOWED');
  const origins = [STORE_URL];
  for (const host of [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) if (host) origins.push(`https://${host}`);
  if (!process.env.VERCEL) origins.push('http://127.0.0.1:4173', 'http://localhost:4173');
  if (!origins.includes(request.headers.origin)) throw new PaymentError('Origem da solicitação inválida.', 403, 'INVALID_ORIGIN');
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new PaymentError('Formato de solicitação inválido.', 415, 'INVALID_CONTENT_TYPE');
  let body = request.body;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > 4096) throw new PaymentError('Solicitação muito grande.', 413, 'BODY_TOO_LARGE');
    try { body = JSON.parse(body); } catch { throw new PaymentError('Dados inválidos.', 400, 'INVALID_JSON'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PaymentError('Dados inválidos.', 400, 'INVALID_BODY');
  if (Buffer.byteLength(JSON.stringify(body)) > 4096) throw new PaymentError('Solicitação muito grande.', 413, 'BODY_TOO_LARGE');
  return body;
}

export function normalizeCustomer(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PaymentError('Preencha os dados do comprador.', 400, 'INVALID_CUSTOMER');
  const limits = { name: 120, email: 254, confirmEmail: 254, document: 18, phone: 20, postalCode: 9 };
  const customer = {};
  for (const [key, limit] of Object.entries(limits)) {
    if (input[key] !== undefined && typeof input[key] !== 'string') throw new PaymentError('Dados do comprador inválidos.', 400, 'INVALID_CUSTOMER');
    customer[key] = String(input[key] ?? '').trim();
    if (customer[key].length > limit) throw new PaymentError('Dados do comprador inválidos.', 400, 'INVALID_CUSTOMER');
  }
  const errors = validateCustomer(customer);
  // Firebot's published contract currently accepts numeric CPF/CNPJ only.
  if (/[a-z]/i.test(customer.document)) errors.document = 'Este pagamento aceita CPF ou CNPJ numérico.';
  if (Object.keys(errors).length) throw new PaymentError(Object.values(errors)[0], 400, 'INVALID_CUSTOMER');
  return { name: customer.name, email: customer.email.toLowerCase(), cpf: digits(customer.document), phone: digits(customer.phone) };
}

export async function firebotRequest(path, { method = 'GET', body } = {}, fetcher = fetch) {
  const key = getApiKey();
  let response;
  try {
    response = await fetcher(`${BASE_URL}${path}`, {
      method,
      headers: { accept: 'application/json', 'x-api-key': key, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(18000), redirect: 'error',
    });
  } catch {
    throw new PaymentError('Não foi possível conectar ao pagamento. Tente novamente em instantes.', 502, 'PROVIDER_CONNECTION');
  }
  const content = await response.text();
  let data;
  try { data = JSON.parse(content); } catch {
    console.error('firebot_non_json_response', { status: response.status });
    throw new PaymentError('O serviço de pagamento não respondeu corretamente.', 502, 'PROVIDER_RESPONSE');
  }
  if (!response.ok || data.success === false) {
    const code = response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH' : response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_REJECTED';
    console.error('firebot_request_failed', { status: response.status, code });
    // Do not send upstream error bodies, account details or credentials to buyers.
    throw new PaymentError(response.status === 400 ? 'A Firebot não aceitou os dados da cobrança. Confira os dados do comprador e tente novamente.' : response.status === 429 ? 'Muitas solicitações. Aguarde um instante e tente novamente.' : 'O serviço de pagamento está indisponível. Tente novamente em instantes.', response.status === 400 ? 422 : response.status === 429 ? 429 : 502, code);
  }
  return data;
}

export function crc16(input) {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function validatePixCode(code) {
  if (typeof code !== 'string' || code.length > 2048 || !code.startsWith('000201') || !/6304[0-9A-F]{4}$/i.test(code) || !/br\.gov\.bcb\.pix/i.test(code)) return false;
  if (crc16(code.slice(0, -4)) !== code.slice(-4).toUpperCase()) return false;
  // Verify the fixed BR Code amount when present. Dynamic codes can omit tag 54.
  const bytes = Buffer.from(code, 'utf8');
  let position = 0;
  while (position < bytes.length) {
    const tag = bytes.subarray(position, position + 2).toString();
    const lengthText = bytes.subarray(position + 2, position + 4).toString();
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lengthText)) return false;
    const length = Number(lengthText);
    if (position + 4 + length > bytes.length) return false;
    if (tag === '54' && Math.round(Number(bytes.subarray(position + 4, position + 4 + length).toString()) * 100) !== AMOUNT_IN_CENTS) return false;
    position += 4 + length;
  }
  return position === bytes.length;
}

function signature(body) { return createHmac('sha256', getApiKey()).update(`vet-payment-session-v1:${body}`).digest('base64url'); }

export function createPaymentToken(transactionId, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ id: transactionId, amount: AMOUNT_IN_CENTS, exp: now + TOKEN_LIFETIME })).toString('base64url');
  return `${body}.${signature(body)}`;
}

export function verifyPaymentToken(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 1500) throw new PaymentError('Sessão de pagamento inválida.', 403, 'INVALID_PAYMENT_SESSION');
  const parts = token.split('.');
  if (parts.length !== 2) throw new PaymentError('Sessão de pagamento inválida.', 403, 'INVALID_PAYMENT_SESSION');
  const expected = Buffer.from(signature(parts[0]));
  const received = Buffer.from(parts[1]);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new PaymentError('Sessão de pagamento inválida.', 403, 'INVALID_PAYMENT_SESSION');
  let payment;
  try { payment = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch { throw new PaymentError('Sessão de pagamento inválida.', 403, 'INVALID_PAYMENT_SESSION'); }
  if (!/^fire_tx_[a-zA-Z0-9_-]{4,120}$/.test(payment.id) || payment.amount !== AMOUNT_IN_CENTS || !Number.isFinite(payment.exp) || payment.exp <= now) throw new PaymentError('A consulta deste pagamento expirou. Confira o status com o vendedor antes de pagar novamente.', 403, 'PAYMENT_SESSION_EXPIRED');
  return payment;
}

export function normalizePayment(data) {
  if (data.success !== true || !/^fire_tx_[a-zA-Z0-9_-]{4,120}$/.test(data.transactionId) || Math.round(Number(data.amount) * 100) !== AMOUNT_IN_CENTS || !validatePixCode(data.pixCopiaECola)) throw new PaymentError('Não foi possível validar a cobrança recebida. Entre em contato com o vendedor.', 502, 'INVALID_PROVIDER_PAYMENT');
  const expiresAt = typeof data.expiresAt === 'string' && Number.isFinite(Date.parse(data.expiresAt)) ? data.expiresAt : null;
  return { transactionId: data.transactionId, amountInCents: AMOUNT_IN_CENTS, copyPaste: data.pixCopiaECola, status: data.status === 'PAID' ? 'PAID' : 'PENDING', expiresAt, paymentToken: createPaymentToken(data.transactionId) };
}

export function sendError(response, error) {
  if (!(error instanceof PaymentError)) console.error('checkout_internal_error', { name: error?.name ?? 'UnknownError' });
  return response.status(error instanceof PaymentError ? error.status : 500).json({ code: error instanceof PaymentError ? error.code : 'INTERNAL_ERROR', message: error instanceof PaymentError ? error.message : 'Não foi possível concluir a solicitação. Tente novamente.' });
}
