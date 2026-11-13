import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import createPayment from '../api/pix.js';
import statusPayment from '../api/pix-status.js';
import health from '../api/payment-health.js';
import { crc16, validatePixCode, createPaymentToken, verifyPaymentToken, normalizePayment } from '../lib/atlas.js';
import { customer, payment, fixturePix } from './fixtures.mjs';

let savedKey;
beforeEach(() => { savedKey = process.env.ATLAS_SECRET_KEY; process.env.ATLAS_SECRET_KEY = 'atlas_sk_test_local_only'; });
afterEach(() => { if (savedKey === undefined) delete process.env.ATLAS_SECRET_KEY; else process.env.ATLAS_SECRET_KEY = savedKey; });
function request(body, options = {}) { return { method: 'POST', headers: { origin: 'https://vet-pi-self.vercel.app', 'content-type': 'application/json', 'idempotency-key': 'vet-test-order-1042' }, body, ...options }; }
function response() { return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
function mockAtlas(t, data = payment, status = 200) { return t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })); }

test('criação usa o contrato Atlas Pags e fixa R$ 287 mesmo com valor adulterado no browser', async (t) => {
  const mocked = mockAtlas(t);
  const res = response();
  await createPayment(request({ customer, amount: 1, amountInCents: 100 }), res);
  assert.equal(res.code, 200);
  const [url, options] = mocked.mock.calls[0].arguments;
  assert.equal(url, 'https://atlaspags.com/api/v1/charges');
  const body = JSON.parse(options.body);
  assert.equal(body.amount, 287);
  assert.equal(body.method, 'pix');
  assert.equal(body.checkout_url, 'https://vet-pi-self.vercel.app');
  assert.deepEqual(Object.keys(body.customer).sort(), ['document', 'email', 'name', 'phone']);
  assert.equal(options.headers.authorization, `Bearer ${process.env.ATLAS_SECRET_KEY}`);
  assert.equal(options.headers['idempotency-key'], 'vet-test-order-1042');
  assert.equal(options.headers['content-length'], String(Buffer.byteLength(options.body)));
  assert.equal(res.body.copyPaste, payment.pix.code);
  assert.equal(verifyPaymentToken(res.body.paymentToken).id, payment.id);
  assert.equal(res.body.status, 'PENDING');
  assert.equal(JSON.stringify(res.body).includes(process.env.ATLAS_SECRET_KEY), false);
  assert.match(res.headers['Cache-Control'], /no-store/);
});
test('dados inválidos e origens externas não chegam à Atlas Pags', async (t) => {
  const mocked = mockAtlas(t);
  for (const req of [request({ customer: { ...customer, document: '11111111111' } }), request({ customer }, { headers: { origin: 'https://example.invalid', 'content-type': 'application/json', 'idempotency-key': 'vet-test-order-1042' } })]) {
    const res = response(); await createPayment(req, res); assert.ok([400, 403].includes(res.code));
  }
  assert.equal(mocked.mock.callCount(), 0);
});
test('chave ausente impede cobrança e não produz QR fictício', async (t) => {
  delete process.env.ATLAS_SECRET_KEY;
  const mocked = mockAtlas(t);
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
  const mocked = mockAtlas(t);
  const token = createPaymentToken(payment.id);
  assert.throws(() => verifyPaymentToken(token + 'x'));
  assert.throws(() => verifyPaymentToken(createPaymentToken(payment.id, 1)));
  const res = response(); await statusPayment(request({ paymentToken: token + 'x' }), res);
  assert.equal(res.code, 403); assert.equal(mocked.mock.callCount(), 0);
});
test('confirma somente status pago e valor correto retornados pela Atlas Pags', async (t) => {
  mockAtlas(t, { ...payment, status: 'paid' });
  const res = response();
  await statusPayment(request({ paymentToken: createPaymentToken(payment.id), status: 'paid' }), res);
  assert.equal(res.code, 200); assert.equal(res.body.status, 'PAID');
});
test('status pago com valor errado é recusado', async (t) => {
  mockAtlas(t, { ...payment, amount: 1, status: 'paid' });
  const res = response(); await statusPayment(request({ paymentToken: createPaymentToken(payment.id) }), res);
  assert.equal(res.code, 502); assert.equal(res.body.code, 'INVALID_PAYMENT_AMOUNT');
});
test('erro da Atlas não expõe tokens, informações da conta ou traceback', async (t) => {
  mockAtlas(t, { detail: 'private account details', error: { code: 'authentication_required', message: 'private account details', apiKey: process.env.ATLAS_SECRET_KEY } }, 401);
  const res = response(); await createPayment(request({ customer }), res);
  assert.equal(res.code, 503); assert.equal(res.body.code, 'PROVIDER_AUTH');
  assert.equal(JSON.stringify(res.body).includes('private account details'), false);
  assert.equal(JSON.stringify(res.body).includes(process.env.ATLAS_SECRET_KEY), false);
});
test('verificação de conexão não retorna os dados da conta', async (t) => {
  mockAtlas(t, { ok: true, livemode: false, time: '2026-11-13T13:00:00+00:00' });
  const res = response(); await health({ method: 'GET' }, res);
  assert.deepEqual(res.body, { available: true, provider: 'Atlas Pags', amountInCents: 28700 });
});
