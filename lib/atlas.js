import { createHmac, timingSafeEqual } from 'node:crypto';
import { validateCustomer, digits } from '../dist/validation.js';

export const AMOUNT_IN_CENTS = 28700;
export const STORE_URL = 'https://vet-pi-self.vercel.app';
const API_BASE = 'https://atlaspags.com/api/v1';
const TOKEN_LIFETIME = 24 * 60 * 60 * 1000;

export class PaymentError extends Error {
  constructor(message, status = 502, code = 'PAYMENT_UNAVAILABLE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getApiKey() {
  const value = process.env.ATLAS_SECRET_KEY?.trim();
  if (!value || !value.startsWith('atlas_sk_')) throw new PaymentError('O pagamento está temporariamente indisponível. Tente novamente mais tarde.', 503, 'PAYMENT_NOT_CONFIGURED');
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

export function readIdempotencyKey(request) {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new PaymentError('Identificador da cobrança inválido. Atualize a página e tente novamente.', 400, 'INVALID_IDEMPOTENCY_KEY');
  }
  return value;
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
  if (Object.keys(errors).length) throw new PaymentError(Object.values(errors)[0], 400, 'INVALID_CUSTOMER');
  return {
    name: customer.name,
    email: customer.email.toLowerCase(),
    document: customer.document.replace(/[^\da-z]/gi, '').toUpperCase(),
    phone: digits(customer.phone),
  };
}

function errorCode(content) {
  try {
    const value = JSON.parse(content)?.error?.code;
    return typeof value === 'string' && /^[a-z0-9_]{1,80}$/i.test(value) ? value : 'PROVIDER_ERROR';
  } catch { return 'PROVIDER_ERROR'; }
}

export async function atlasRequest(path, { method = 'GET', body, idempotencyKey } = {}, fetcher = fetch) {
  const key = getApiKey();
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  const headers = { accept: 'application/json', authorization: `Bearer ${key}` };
  if (serialized !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(serialized));
  }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  let response;
  try {
    response = await fetcher(`${API_BASE}${path}`, {
      method,
      headers,
      ...(serialized !== undefined ? { body: serialized } : {}),
      signal: AbortSignal.timeout(18000),
      redirect: 'error',
    });
  } catch {
    throw new PaymentError('Não foi possível confirmar a resposta do pagamento. Tente novamente com segurança.', 502, 'PROVIDER_CONNECTION');
  }
  const content = await response.text();
  if (content.length > 65536) throw new PaymentError('O serviço de pagamento não respondeu corretamente.', 502, 'PROVIDER_RESPONSE');
  let data;
  try { data = JSON.parse(content); } catch {
    console.error('atlas_non_json_response', { status: response.status });
    throw new PaymentError('O serviço de pagamento não respondeu corretamente.', 502, 'PROVIDER_RESPONSE');
  }
  if (!response.ok) {
    const code = errorCode(content);
    console.error('atlas_request_failed', { status: response.status, code });
    if (response.status === 401) throw new PaymentError('A chave Atlas Pags não está autorizada. Verifique a configuração do checkout.', 503, 'PROVIDER_AUTH');
    if (response.status === 403) throw new PaymentError('A conta Atlas Pags não está habilitada para vender. Verifique a conta com o suporte.', 503, 'PROVIDER_ACCOUNT');
    if (response.status === 422 || response.status === 400) throw new PaymentError('A Atlas Pags recusou os dados da cobrança. Confira os dados do comprador.', 422, 'PROVIDER_REJECTED');
    if (response.status === 429) throw new PaymentError('Muitas solicitações. Aguarde um instante e tente novamente.', 429, 'PROVIDER_RATE_LIMIT');
    throw new PaymentError('O serviço de pagamento está indisponível. Tente novamente em instantes.', 502, 'PROVIDER_UNAVAILABLE');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PaymentError('O serviço de pagamento não respondeu corretamente.', 502, 'PROVIDER_RESPONSE');
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

function validChargeId(id) { return typeof id === 'string' && /^[A-Za-z0-9._~-]{1,128}$/.test(id); }

export function createPaymentToken(chargeId, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ id: chargeId, amount: AMOUNT_IN_CENTS, exp: now + TOKEN_LIFETIME })).toString('base64url');
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
  if (!validChargeId(payment.id) || payment.amount !== AMOUNT_IN_CENTS || !Number.isFinite(payment.exp) || payment.exp <= now) throw new PaymentError('A consulta deste pagamento expirou. Confira o status com o vendedor antes de pagar novamente.', 403, 'PAYMENT_SESSION_EXPIRED');
  return payment;
}

const PAYMENT_STATUSES = { pending: 'PENDING', paid: 'PAID', failed: 'CANCELLED', expired: 'EXPIRED', refunded: 'REFUNDED', chargeback: 'CHARGEBACK' };

export function normalizePayment(data) {
  const status = PAYMENT_STATUSES[data?.status];
  if (!validChargeId(data?.id) || data.method !== 'pix' || !status || Math.round(Number(data.amount) * 100) !== AMOUNT_IN_CENTS || !validatePixCode(data.pix?.code)) {
    throw new PaymentError('Não foi possível validar a cobrança recebida. Entre em contato com o vendedor.', 502, 'INVALID_PROVIDER_PAYMENT');
  }
  const expiresAt = typeof data.pix.expires_at === 'string' && Number.isFinite(Date.parse(data.pix.expires_at)) ? data.pix.expires_at : null;
  return { transactionId: data.id, amountInCents: AMOUNT_IN_CENTS, copyPaste: data.pix.code, status, expiresAt, paymentToken: createPaymentToken(data.id) };
}

export function sendError(response, error) {
  if (!(error instanceof PaymentError)) console.error('checkout_internal_error', { name: error?.name ?? 'UnknownError' });
  return response.status(error instanceof PaymentError ? error.status : 500).json({ code: error instanceof PaymentError ? error.code : 'INTERNAL_ERROR', message: error instanceof PaymentError ? error.message : 'Não foi possível concluir a solicitação. Tente novamente.' });
}
