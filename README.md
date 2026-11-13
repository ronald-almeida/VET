# Destrava Vet — checkout Pix

Checkout responsivo baseado na referência fornecida, com oferta fixa de **R$ 287,00**, formulário, Pix como único método, modal com QR Code e botão de copiar.

## Estado atual

**Prévia visual, sem cobrança real.** O QR exibido codifica uma mensagem de demonstração não pagável. Os dados do formulário permanecem apenas na memória da página. Não há envio de email, registro de pedido, liberação de acesso ou confirmação de pagamento nesta versão.

A integração solicitada é **Firebot BR**. A documentação em <https://firebotbr.com/integracoes/docs> exige login e não estava acessível na implementação inicial. Por esse motivo, não foram inventados endpoints ou formatos de autenticação: `api/pix.js` responde 503 até a integração real ser implementada. Alterar apenas `preview` não ativa o pagamento.

## Executar

Requer Node.js 22 ou superior. Não há dependências para instalar.

```sh
node scripts/serve.mjs
node --test tests/*.test.mjs
```

Abra <http://127.0.0.1:4173>. Em ambientes que bloqueiam subprocessos, os testes podem ser executados com `node --test --test-isolation=none tests/*.test.mjs`.

## Vercel

O arquivo `vercel.json` publica `dist/` e disponibiliza a função `api/pix.js`. O comando de build executa os testes. A conexão Git deve usar `ronald-almeida/VET`, branch `main`.

## Concluir Firebot BR

1. Consultar a documentação autenticada: criação de cobrança, autenticação, unidade do valor, consulta de status, expiração, idempotência e validação de webhook.
2. Implementar a chamada autenticada exclusivamente na função de servidor, com o valor fixado em **28700 centavos**, convertido para a unidade documentada pelo provedor. Validar os dados recebidos novamente no servidor.
3. Configurar credenciais nas variáveis de ambiente da Vercel, nunca em `dist/`, no Git ou em logs. Usar os nomes exigidos pela integração verificada.
4. Normalizar a resposta para o contrato interno do frontend: `{ amountInCents: 28700, copyPaste: "...", expiresAt: "..." }`. Este é um contrato interno, não uma alegação sobre a resposta da Firebot.
5. Testar cobrança em sandbox quando disponível, recusas, timeout, duplicação e expiração. A confirmação de pagamento e a entrega do produto dependem de validação real do provedor; não devem ser simuladas em produção.
6. Desativar `checkout.preview` somente após os testes reais da integração. Ajustar os testes de disponibilidade para o modo final.

## Arquivos

- `dist/index.html` e `dist/styles.css`: layout.
- `dist/app.js`: validação, modal, geração local do QR e cópia.
- `dist/config.js`: dados públicos da oferta e modo de prévia.
- `dist/validation.js`: validação compartilhável de campos.
- `api/pix.js`: ponto de integração do servidor, bloqueado por enquanto.
- `tests/checkout.test.mjs`: verificações de preço, validação e bloqueio de cobranças sem integração.

## Referência e recursos

Referência visual: <https://pay.hotmart.com/F102592676T?off=q2qajwt0&checkoutMode=10&bid=1794412157346>.

O banner e a marca DestravaVet foram reutilizados da referência fornecida. O checkout independente não utiliza o selo de proteção, os termos ou a alegação de processamento da Hotmart. Não foram copiados scripts de rastreamento ou credenciais da referência.

QR Code: `qrcode-generator` 1.4.4, Kazuhiko Arase, licença MIT. A biblioteca é servida localmente e preserva o aviso de direitos autorais em `dist/vendor/qrcode.js`.
