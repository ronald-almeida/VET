# Destrava Vet — checkout Pix

Checkout de **R$ 287,00**, com Pix como único método, QR Code, Copia e Cola e acompanhamento do pagamento no pop-up.

## Integração Atlas Pags

Documentação: <https://atlaspags.com/docs/>. A API usa `https://atlaspags.com/api/v1` e autentica chamadas do servidor com `Authorization: Bearer ATLAS_SECRET_KEY`.

- `POST /api/pix` valida o comprador e cria a cobrança em `POST /charges` com valor, método `pix`, descrição, URL do checkout e os dados do cliente.
- O valor é fixado em 28.700 centavos no servidor. A resposta é validada antes de exibir o QR code de `pix.code`.
- `POST /api/pix-status` consulta `GET /charges/{id}` com um token assinado emitido pelo checkout; o pagamento só é confirmado após a Atlas retornar `paid` para a mesma cobrança e valor.
- `GET /api/payment-health` verifica a chave com `GET /ping`, sem retornar dados da conta.
- O checkout envia `Idempotency-Key` e reutiliza a chave ao repetir a mesma tentativa.

A chave `ATLAS_SECRET_KEY`, no formato `atlas_sk_...`, deve existir como Secret em Production na Vercel e só é lida pelas funções do servidor. Não existe modo de demonstração nem geração de QR fictício no código publicado. Se a API falhar, o checkout informa o erro.

## Executar e verificar

Node.js 22 ou superior. Não há dependências para instalar.

```sh
node --env-file=.env.local scripts/serve.mjs
node --test tests/*.test.mjs
```

O servidor local usa http://127.0.0.1:4173. Para verificar somente a interface sem configurar uma chave, execute `node scripts/serve.mjs`; a criação de cobrança retorna indisponibilidade.

Em ambientes sem permissão para subprocessos: `node --test --test-isolation=none tests/*.test.mjs`.

Os testes usam respostas controladas e registros sintéticos exclusivamente em memória, sem enviar dados de teste à Atlas Pags. Pagamentos reais precisam ser homologados com a conta do vendedor.

## Publicação

GitHub: https://github.com/ronald-almeida/VET

Vercel: https://vet-pi-self.vercel.app

Branch de produção: `main`. `vercel.json` publica `dist/`, disponibiliza as funções `api/` e executa os testes durante o build. A chave privada deve permanecer fora do Git, do navegador e dos logs.

## Operação

O pop-up reutiliza a cobrança atual para os mesmos dados e impede cliques simultâneos. A consulta é pausada ao fechar o modal ou ocultar a aba. O botão “Já paguei” consulta a Atlas Pags; ele não aprova pagamentos por conta própria.

As cobranças e os dados do comprador são registrados pela Atlas Pags. O checkout não mantém banco de pedidos próprio. O token de consulta vale 24 horas, sem alterar a validade da cobrança na Atlas. A chave de idempotência reduz cobranças duplicadas durante novas tentativas da mesma sessão.

A entrega do curso e o envio de email não são executados por este checkout. A venda deve ser acompanhada no painel Atlas Pags e a entrega deve seguir a operação do vendedor. Não há promessa de entrega automática na página.

## Recursos

Referência visual fornecida: https://pay.hotmart.com/F102592676T?off=q2qajwt0&checkoutMode=10&bid=1794412157346

Banner e marca DestravaVet reutilizados da referência. O checkout independente não utiliza o selo de proteção ou alegação de processamento da Hotmart.

QR Code: `qrcode-generator` 1.4.4, Kazuhiko Arase, MIT. Biblioteca servida localmente; avisos em `dist/vendor/`.
