import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import createPayment from '../api/pix.js';
import statusPayment from '../api/pix-status.js';
import health from '../api/payment-health.js';
import { crc16, validatePixCode, createPaymentToken, verifyPaymentToken, normalizePayment } from '../lib/firebot.js';
import { customer, payment, fixturePix } from './fixtures.mjs';

let savedKey;
beforeEach(() => { savedKey = process.env.FIREBOT_API_KEY; process.env.FIREBOT_API_KEY = 'fire_sk_live_local_test_only'; });
afterEach(() => { if (savedKey === undefined) delete process.env.FIREBOT_API_KEY; else process.env.FIREBOT_API_KEY = savedKey; });
function request(body, options = {}) { return { method: 'POST', headers: { origin: 'https://vet-pi-self.vercel.app', 'content-type': 'application/json' }, body, ...options }; }
function response() { return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
function mockFirebot(t, data = payment, status = 200) { return t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })); }

test('criação usa o contrato Firebot e fixa R$ 287 mesmo com valor adulterado no browser', async (t) => {
  const mocked = mockFirebot(t);
  const res = response();
  await createPayment(request({ customer, amount: 1, amountInCents: 100 }), res);
  assert.equal(res.code, 200);
  const [url, options] = mocked.mock.calls[0].arguments;
  assert.equal(url, 'https://firebotbr.com/api/v1/pix/create');
  const body = JSON.parse(options.body);
  assert.equal(body.amount, 287);
  assert.equal(body.productType, 'DIGITAL');
  assert.equal(body.storeUrl, 'https://vet-pi-self.vercel.app');
  assert.deepEqual(Object.keys(body.customer).sort(), ['cpf', 'email', 'name', 'phone']);
  assert.equal(res.body.copyPaste, payment.pixCopiaECola);
  assert.equal(verifyPaymentToken(res.body.paymentToken).id, payment.transactionId);
  assert.equal(JSON.stringify(res.body).includes(process.env.FIREBOT_API_KEY), false);
  assert.match(res.headers['Cache-Control'], /no-store/);
});
test('dados inválidos e origens externas não chegam à Firebot', async (t) => {
  const mocked = mockFirebot(t);
  for (const req of [request({ customer: { ...customer, document: '11111111111' } }), request({ customer }, { headers: { origin: 'https://example.invalid', 'content-type': 'application/json' } })]) {
    const res = response(); await createPayment(req, res); assert.ok([400, 403].includes(res.code));
  }
  assert.equal(mocked.mock.callCount(), 0);
});
test('chave ausente impede cobrança e não produz QR fictício', async (t) => {
  delete process.env.FIREBOT_API_KEY;
  const mocked = mockFirebot(t);
  const res = response(); await createPayment(request({ customer }), res);
  assert.equal(res.code, 503); assert.equal(mocked.mock.callCount(), 0); assert.equal(res.body.copyPaste, undefined);
});
test('checksum, valor do payload e resposta com preço errado são rejeitados', () => {
  assert.equal(crc16('123456789'), '29B1');
  assert.equal(validatePixCode(fixturePix()), true);
  assert.equal(validatePixCode(fixturePix('1.00')), false);
  assert.equal(validatePixCode(fixturePix().slice(0, -4) + '0000'), false);
  assert.throws(() => normalizePayment({ ...payment, amount: 1 }));
});
test('token adulterado ou expirado não permite consulta', async (t) => {
  const mocked = mockFirebot(t);
  const token = createPaymentToken(payment.transactionId);
  assert.throws(() => verifyPaymentToken(token + 'x'));
  assert.throws(() => verifyPaymentToken(createPaymentToken(payment.transactionId, 1)));
  const res = response(); await statusPayment(request({ paymentToken: token + 'x' }), res);
  assert.equal(res.code, 403); assert.equal(mocked.mock.callCount(), 0);
});
test('confirma pagamento somente pelo status real PAID e valor correto do provedor', async (t) => {
  mockFirebot(t, { ...payment, status: 'PAID' });
  const res = response();
  await statusPayment(request({ paymentToken: createPaymentToken(payment.transactionId), status: 'PAID' }), res);
  assert.equal(res.code, 200); assert.equal(res.body.status, 'PAID');
});
test('status pago com valor errado é recusado', async (t) => {
  mockFirebot(t, { ...payment, amount: 1, status: 'PAID' });
  const res = response(); await statusPayment(request({ paymentToken: createPaymentToken(payment.transactionId) }), res);
  assert.equal(res.code, 502); assert.equal(res.body.code, 'INVALID_PAYMENT_AMOUNT');
});
test('erro da Firebot não expõe tokens, informações da conta ou traceback', async (t) => {
  mockFirebot(t, { success: false, message: 'private account details', apiKey: process.env.FIREBOT_API_KEY }, 401);
  const res = response(); await createPayment(request({ customer }), res);
  assert.equal(res.code, 502); assert.equal(res.body.code, 'PROVIDER_AUTH');
  assert.equal(JSON.stringify(res.body).includes('private account details'), false);
  assert.equal(JSON.stringify(res.body).includes(process.env.FIREBOT_API_KEY), false);
});
test('verificação de conexão não retorna os dados da conta', async (t) => {
  mockFirebot(t, { success: true, account: { private: 'should not escape' } });
  const res = response(); await health({ method: 'GET' }, res);
  assert.deepEqual(res.body, { available: true, provider: 'Firebot BR', amountInCents: 28700 });
});
