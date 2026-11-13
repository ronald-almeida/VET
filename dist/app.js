import { checkout } from './config.js';
import { validateCustomer, formatPhone, formatDocument, digits } from './validation.js';

const $ = (id) => document.getElementById(id);
const form = $('checkout-form');
const dialog = $('pix-dialog');
const price = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(checkout.amountInCents / 100);
document.querySelectorAll('[data-price]').forEach((node) => { node.textContent = price; });
let activePayment = null;
let activeCustomer = '';
let pending = false;
let requestId = '';
let copyTimer;

if (checkout.preview) {
  $('preview-notice').hidden = false;
  $('footer-preview').hidden = false;
  $('form-note').textContent = 'Prévia de demonstração. Nenhuma cobrança será gerada e os dados não serão enviados.';
}

$('phone').addEventListener('input', (event) => { event.target.value = formatPhone(event.target.value); });
$('document').addEventListener('input', (event) => { event.target.value = formatDocument(event.target.value); });
$('postal-code').addEventListener('input', (event) => { event.target.value = digits(event.target.value).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2'); });
form.addEventListener('input', (event) => {
  event.target.removeAttribute('aria-invalid');
  const error = $(`${event.target.id}-error`);
  if (error) error.textContent = '';
});

function openDialog() {
  if (!dialog.open) dialog.showModal();
  $('copy-status').textContent = '';
}

function closeDialog() { dialog.close(); }
$('close-dialog').addEventListener('click', closeDialog);
$('back-button').addEventListener('click', closeDialog);
dialog.addEventListener('click', (event) => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeDialog();
});

function showPayment(payment) {
  const qr = window.qrcode(0, 'M');
  qr.addData(payment.copyPaste, 'Byte');
  qr.make();
  // Markup comes exclusively from the local QR encoder, never from the provider.
  $('qr-code').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
  $('pix-code').value = payment.copyPaste;
  $('payment-content').hidden = false;
  $('payment-loading').hidden = true;
  $('copy-button').disabled = false;
  if (payment.demo) {
    $('dialog-title').textContent = 'Prévia do pagamento Pix';
    $('dialog-description').textContent = 'Veja como será o pagamento de R$ 287,00.';
    $('dialog-alert').hidden = false;
    $('dialog-alert').textContent = 'Demonstração: este QR Code não realiza pagamentos. A integração com a Firebot BR ainda precisa ser ativada.';
    $('qr-code').setAttribute('aria-label', 'QR Code de demonstração, sem valor de pagamento');
    $('qr-caption').textContent = 'QR Code de demonstração · não pagável';
    $('copy-button').querySelector('span').textContent = 'Copiar código de demonstração';
    document.querySelector('.code-label').textContent = 'Código de demonstração';
    document.querySelector('.payment-instructions').hidden = true;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pending) return;
  const customer = Object.fromEntries(new FormData(form));
  Object.keys(customer).forEach((key) => { customer[key] = customer[key].trim(); });
  const errors = validateCustomer(customer);
  document.querySelectorAll('.field-error').forEach((node) => { node.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
  Object.entries(errors).forEach(([id, message]) => {
    $(`${id}-error`).textContent = message;
    $(id).setAttribute('aria-invalid', 'true');
  });
  if (Object.keys(errors).length) { $(Object.keys(errors)[0]).focus(); return; }

  openDialog();
  $('dialog-alert').classList.remove('error');
  $('dialog-alert').hidden = true;
  if (checkout.preview) {
    showPayment({ demo: true, copyPaste: 'DEMONSTRACAO DESTRAVA VET | BRL 287.00 | SEM VALOR DE PAGAMENTO' });
    return;
  }

  const fingerprint = JSON.stringify(customer);
  if (activePayment && activeCustomer === fingerprint && Date.parse(activePayment.expiresAt) > Date.now()) { showPayment(activePayment); return; }
  if (activeCustomer !== fingerprint || !requestId) {
    requestId = crypto.randomUUID();
    activeCustomer = fingerprint;
  }
  pending = true;
  $('pay-button').disabled = true;
  $('payment-content').hidden = true;
  $('payment-loading').hidden = false;
  try {
    const response = await fetch('/api/pix', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
      body: JSON.stringify({ customer }), signal: AbortSignal.timeout(25000),
    });
    const payment = await response.json();
    if (!response.ok) throw new Error(payment.message || 'Não foi possível gerar o Pix. Tente novamente.');
    if (payment.amountInCents !== checkout.amountInCents || typeof payment.copyPaste !== 'string' || !payment.copyPaste.startsWith('000201')) throw new Error('Os dados do pagamento não puderam ser validados. Tente novamente.');
    activePayment = payment;
    showPayment(payment);
  } catch (error) {
    $('payment-loading').hidden = true;
    $('dialog-alert').classList.add('error');
    $('dialog-alert').hidden = false;
    $('dialog-alert').textContent = error.name === 'TimeoutError' ? 'A geração do Pix está demorando. Feche esta janela e tente novamente.' : (error instanceof TypeError || error instanceof SyntaxError ? 'Não foi possível conectar ao pagamento. Tente novamente em instantes.' : error.message);
  } finally {
    pending = false;
    $('pay-button').disabled = false;
  }
});

$('copy-button').addEventListener('click', async () => {
  const value = $('pix-code').value;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      $('pix-code').focus();
      $('pix-code').select();
      if (!document.execCommand('copy')) throw new Error('clipboard');
    }
    $('copy-status').textContent = checkout.preview ? 'Código de demonstração copiado!' : 'Código Pix copiado! Abra o app do seu banco.';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { $('copy-status').textContent = ''; }, 6000);
  } catch {
    $('pix-code').focus();
    $('pix-code').select();
    $('copy-status').textContent = 'Selecione e copie o código acima manualmente.';
  }
});
