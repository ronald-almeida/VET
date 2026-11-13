import { checkout } from './config.js';
import { validateCustomer, formatPhone, formatDocument, digits } from './validation.js';

const $ = (id) => document.getElementById(id);
const form = $('checkout-form');
const dialog = $('pix-dialog');
const price = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(checkout.amountInCents / 100);
document.querySelectorAll('[data-price]').forEach((node) => { node.textContent = price; });
let activePayment = null;
let activeCustomer = '';
let creationFingerprint = '';
let creationKey = '';
let creating = false;
let checking = false;
let pollTimer;
let copyTimer;

$('phone').addEventListener('input', (event) => { event.target.value = formatPhone(event.target.value); });
$('document').addEventListener('input', (event) => { event.target.value = formatDocument(event.target.value); });
$('postal-code').addEventListener('input', (event) => { event.target.value = digits(event.target.value).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2'); });
form.addEventListener('input', (event) => {
  event.target.removeAttribute('aria-invalid');
  const error = $(`${event.target.id}-error`);
  if (error) error.textContent = '';
});

function alertMessage(message, error = false) {
  $('dialog-alert').textContent = message;
  $('dialog-alert').hidden = !message;
  $('dialog-alert').classList.toggle('error', error);
}
function stopPolling() { clearTimeout(pollTimer); }
function scheduleCheck(delay = 10000) {
  stopPolling();
  if (dialog.open && !document.hidden && activePayment?.status === 'PENDING') pollTimer = setTimeout(() => checkPayment(false), delay);
}
function openDialog() {
  if (!dialog.open) dialog.showModal();
  $('copy-status').textContent = '';
}
$('close-dialog').addEventListener('click', () => dialog.close());
$('back-button').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', stopPolling);
dialog.addEventListener('click', (event) => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPolling();
  else scheduleCheck(1000);
});

function renderState() {
  const status = activePayment.status;
  const paid = status === 'PAID';
  const pending = status === 'PENDING';
  $('dialog-title').textContent = paid ? 'Pagamento confirmado!' : pending ? 'Pague com Pix' : status === 'REFUNDED' ? 'Pagamento reembolsado' : 'Pix encerrado';
  $('dialog-description').textContent = paid ? 'A Atlas Pags confirmou o recebimento do seu pagamento.' : pending ? 'Escaneie o QR Code no aplicativo do seu banco.' : status === 'REFUNDED' ? 'A Atlas Pags informou o reembolso deste pagamento.' : 'Esta cobrança foi cancelada ou expirou.';
  $('dialog-symbol').textContent = paid ? '✓' : pending ? '◇' : '!';
  $('payment-content').hidden = !pending;
  $('payment-confirmed').hidden = !paid;
  $('payment-status').textContent = pending ? 'Aguardando pagamento · confirmação automática' : '';
  $('check-payment').disabled = !pending || checking;
  $('check-payment').hidden = !pending;
  $('order-reference').textContent = `Código da transação: ${activePayment.transactionId}`;
  $('order-reference').hidden = false;
  if (!pending) stopPolling();
  if (paid) alertMessage('');
}

function showPayment(payment) {
  $('payment-loading').hidden = true;
  alertMessage('');
  const qr = window.qrcode(0, 'M');
  qr.addData(payment.copyPaste, 'Byte');
  qr.make();
  // Only locally generated SVG markup is inserted, never provider-supplied HTML.
  $('qr-code').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
  $('pix-code').value = payment.copyPaste;
  $('copy-button').disabled = false;
  renderState();
  scheduleCheck(4000);
}

async function checkPayment(manual = true) {
  if (checking || !activePayment || activePayment.status !== 'PENDING') return;
  stopPolling();
  const payment = activePayment;
  checking = true;
  $('check-payment').disabled = true;
  if (manual) $('payment-status').textContent = 'Consultando pagamento…';
  try {
    const response = await fetch('/api/pix-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentToken: payment.paymentToken }), signal: AbortSignal.timeout(22000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Não foi possível consultar agora. Tente novamente.');
    if (result.transactionId !== payment.transactionId || result.amountInCents !== checkout.amountInCents) throw new Error('Não foi possível validar o pagamento. Tente consultar novamente.');
    if (activePayment !== payment) return;
    payment.status = result.status;
    alertMessage('');
    renderState();
    if (manual && payment.status === 'PENDING') $('payment-status').textContent = 'Ainda aguardando a confirmação da Atlas Pags.';
  } catch (error) {
    if (activePayment !== payment) return;
    $('payment-status').textContent = 'Consulta indisponível agora. Você pode verificar novamente.';
    if (manual) alertMessage(error instanceof TypeError || error instanceof SyntaxError || error.name === 'TimeoutError' ? 'Não foi possível consultar o pagamento agora. Confira sua conexão e tente novamente.' : error.message, true);
  } finally {
    checking = false;
    $('check-payment').disabled = false;
    scheduleCheck(15000);
  }
}
$('check-payment').addEventListener('click', () => checkPayment(true));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (creating) return;
  const customer = Object.fromEntries(new FormData(form));
  Object.keys(customer).forEach((key) => { customer[key] = customer[key].trim(); });
  const errors = validateCustomer(customer);
  if (/[a-z]/i.test(customer.document)) errors.document = 'Este pagamento aceita CPF ou CNPJ numérico.';
  document.querySelectorAll('.field-error').forEach((node) => { node.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
  Object.entries(errors).forEach(([id, message]) => {
    $(`${id}-error`).textContent = message;
    $(id).setAttribute('aria-invalid', 'true');
  });
  if (Object.keys(errors).length) { $(Object.keys(errors)[0]).focus(); return; }

  const fingerprint = JSON.stringify(customer);
  openDialog();
  if (activePayment && activeCustomer === fingerprint && ['PENDING', 'PAID'].includes(activePayment.status)) {
    showPayment(activePayment);
    return;
  }
  if (activePayment || creationFingerprint !== fingerprint) {
    creationFingerprint = fingerprint;
    creationKey = crypto.randomUUID();
  }
  stopPolling();
  activePayment = null;
  creating = true;
  $('pay-button').disabled = true;
  $('pay-button').querySelector('span').textContent = 'Gerando seu Pix…';
  $('dialog-title').textContent = 'Gerando seu Pix';
  $('dialog-description').textContent = 'Aguarde enquanto a Atlas Pags prepara sua cobrança.';
  alertMessage('');
  $('payment-content').hidden = true;
  $('payment-confirmed').hidden = true;
  $('check-payment').hidden = true;
  $('order-reference').hidden = true;
  $('payment-status').textContent = '';
  $('payment-loading').hidden = false;
  try {
    const response = await fetch('/api/pix', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': creationKey },
      body: JSON.stringify({ customer }), signal: AbortSignal.timeout(25000),
    });
    const payment = await response.json();
    if (!response.ok) throw new Error(payment.message || 'Não foi possível gerar o Pix. Tente novamente.');
    if (payment.amountInCents !== checkout.amountInCents || typeof payment.copyPaste !== 'string' || !payment.copyPaste.startsWith('000201') || !payment.paymentToken) throw new Error('Os dados do pagamento não puderam ser validados. Entre em contato com o vendedor.');
    activePayment = payment;
    activeCustomer = fingerprint;
    showPayment(payment);
  } catch (error) {
    $('payment-loading').hidden = true;
    $('dialog-title').textContent = 'Não foi possível gerar o Pix';
    $('dialog-description').textContent = 'Nenhum pagamento foi confirmado nesta página.';
    alertMessage(error.name === 'TimeoutError' ? 'A geração do Pix está demorando. Feche esta janela e tente novamente em instantes.' : (error instanceof TypeError || error instanceof SyntaxError ? 'Não foi possível conectar ao pagamento. Tente novamente em instantes.' : error.message), true);
  } finally {
    creating = false;
    $('pay-button').disabled = false;
    $('pay-button').querySelector('span').textContent = activePayment?.status === 'PAID' ? 'Ver pagamento' : activePayment ? 'Ver QR Code Pix' : 'Gerar QR Code Pix';
  }
});

$('copy-button').addEventListener('click', async () => {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText($('pix-code').value);
    else {
      $('pix-code').focus();
      $('pix-code').select();
      if (!document.execCommand('copy')) throw new Error('clipboard');
    }
    $('copy-status').textContent = 'Código Pix copiado! Abra o app do seu banco.';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { $('copy-status').textContent = ''; }, 6000);
  } catch {
    $('pix-code').focus();
    $('pix-code').select();
    $('copy-status').textContent = 'Selecione e copie o código acima manualmente.';
  }
});
