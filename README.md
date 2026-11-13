# Destrava Vet — checkout Pix

Checkout de produção para **R$ 287,00**, integrado à **Firebot BR**, com Pix como único método, QR Code, Copia e Cola e acompanhamento de pagamento no pop-up.

## Integração

Documentação utilizada: https://firebotbr.com/integracoes/docs

- `POST /api/pix` valida o comprador no servidor e solicita a cobrança em `POST https://firebotbr.com/api/v1/pix/create`.
- O valor enviado é `287` reais, fixado no servidor. O preço recebido do navegador é ignorado.
- Produto `DIGITAL`, descrição `Destrava Vet - Vitalício`, checkout de origem `https://vet-pi-self.vercel.app`.
- A resposta é validada antes de exibir o QR: identificador, valor e integridade CRC16 do código Pix.
- `POST /api/pix-status` consulta `GET /api/v1/pix/{transactionId}`. Cada consulta exige um token assinado emitido na criação da cobrança; apenas o status `PAID` com o valor correto confirma o pagamento.
- `GET /api/payment-health` verifica a autenticação na Firebot sem retornar dados da conta.
- Nenhum endpoint de saque ou transferência é usado.

A chave `FIREBOT_API_KEY`, no formato `fire_sk_live_...`, deve existir como Secret em Production na Vercel. Ela é lida apenas pelas funções do servidor. Não existe modo de demonstração nem geração de QR fictício no código publicado. Se a API falhar, o checkout informa o erro.

## Executar e verificar

Node.js 22 ou superior. Não há dependências para instalar.

```sh
node --env-file=.env.local scripts/serve.mjs
node --test tests/*.test.mjs
```

O servidor local usa http://127.0.0.1:4173. Para verificar somente a interface sem configurar uma chave, execute `node scripts/serve.mjs`; a criação de cobrança retorna indisponibilidade.

Em ambientes sem permissão para subprocessos: `node --test --test-isolation=none tests/*.test.mjs`.

Os testes usam respostas controladas e registros sintéticos exclusivamente em memória, sem enviar dados de teste à Firebot. Cobrem valor fixo, validação, origem, assinatura, checksum, status e proteção de informações privadas.

## Publicação

GitHub: https://github.com/ronald-almeida/VET

Vercel: https://vet-pi-self.vercel.app

Branch de produção: `main`. `vercel.json` publica `dist/`, disponibiliza as funções `api/` e executa os testes durante o build. A chave privada deve permanecer fora do Git, do navegador e dos logs.

## Operação

O pop-up reutiliza a cobrança atual para os mesmos dados e impede cliques simultâneos. A consulta é pausada ao fechar o modal ou ocultar a aba. O botão “Já paguei” consulta a Firebot; ele não aprova pagamentos por conta própria.

As cobranças e os dados do comprador são registrados pela Firebot. O checkout não mantém banco de pedidos próprio. O token de consulta vale 24 horas; isso não altera a validade da cobrança na Firebot. A API documentada não estabelece idempotência de criação, por isso requisições novas após recarregar a página podem gerar cobranças pendentes adicionais.

A entrega do curso e o envio de email não são executados por este checkout. A venda deve ser acompanhada no painel Firebot e a entrega deve seguir a operação do vendedor. Não há promessa de entrega automática na página.

## Recursos

Referência visual fornecida: https://pay.hotmart.com/F102592676T?off=q2qajwt0&checkoutMode=10&bid=1794412157346

Banner e marca DestravaVet reutilizados da referência. O checkout independente não utiliza o selo de proteção ou alegação de processamento da Hotmart.

QR Code: `qrcode-generator` 1.4.4, Kazuhiko Arase, MIT. Biblioteca servida localmente; avisos em `dist/vendor/`.
