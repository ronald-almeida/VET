import { crc16 } from '../lib/firebot.js';

// Synthetic local-only records. Never send these customer details to a live API.
export const customer = { name: 'Pessoa Teste', email: 'teste@example.invalid', confirmEmail: 'teste@example.invalid', document: '12345678909', phone: '11999990000', postalCode: '' };
const field = (id, value) => id + String(Buffer.byteLength(value)).padStart(2, '0') + value;
export function fixturePix(amount = '287.00') {
  const code = field('00', '01') + field('26', field('00', 'br.gov.bcb.pix') + field('01', 'teste@example.invalid')) + field('52', '0000') + field('53', '986') + field('54', amount) + field('58', 'BR') + field('59', 'TESTE LOCAL') + field('60', 'BRASILIA') + field('62', field('05', '***')) + '6304';
  return code + crc16(code);
}
export const payment = { success: true, transactionId: 'fire_tx_local_test_only', amount: 287, pixCopiaECola: fixturePix(), status: 'PENDING' };
