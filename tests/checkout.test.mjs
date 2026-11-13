import test from 'node:test';
import assert from 'node:assert/strict';
import { checkout } from '../dist/config.js';
import { validDocument, validateCustomer, formatPhone } from '../dist/validation.js';

test('a oferta é R$ 287,00 e usa a Firebot BR sem modo de demonstração', () => {
  assert.equal(checkout.amountInCents, 28700);
  assert.equal(checkout.provider, 'Firebot BR');
  assert.equal(checkout.preview, undefined);
});
test('rejeita documentos repetidos ou com dígitos verificadores incorretos', () => {
  for (const value of ['11111111111', '00000000000000', '12345678900', '123']) assert.equal(validDocument(value), false);
  assert.equal(validDocument('123.456.789-09'), true);
});
test('valida emails diferentes e telefone e CEP incompletos', () => {
  const errors = validateCustomer({ email: 'teste@example.invalid', confirmEmail: 'outro@example.invalid', name: 'Pessoa Teste', document: '12345678909', phone: '11', postalCode: '123' });
  assert.ok(errors['confirm-email']);
  assert.ok(errors.phone);
  assert.ok(errors['postal-code']);
  assert.equal(errors.name, undefined);
});
test('máscara preserva todos os dígitos do celular', () => {
  assert.equal(formatPhone('11999990000'), '(11) 99999-0000');
});
