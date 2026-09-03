# CHURRASCARIA CARNE DE SOL

Cardápio digital responsivo, painel administrativo e pedidos com preços recalculados no servidor.

## Conteúdo importado

- 88 produtos do cardápio de referência
- 12 categorias consolidadas
- 61 grupos de complementos
- 304 opções vinculadas
- 83 imagens locais, sem dependência do servidor de origem

## Estrutura

- `index.html`: loja, carrinho, checkout e autenticação por código
- `admin.html`: produtos, preços, promoções, imagens, categorias, complementos, pedidos e aparência
- `supabase/migrations`: schema, cardápio e políticas de segurança
- `supabase/email-templates`: modelos OTP com `{{ .Token }}` e sem link de localhost
- `google-apps-script`: notificação administrativa opcional via Gmail

## E-mail e autenticação

No Supabase, configure SMTP do Gmail com o e-mail comercial e uma senha de app armazenada apenas no painel de segredos. Em **Authentication > Email Templates**, use os HTMLs deste repositório. O cliente aceita o OTP numérico oficial e não usa link mágico.

O Google Apps Script usa `GmailApp` e não precisa da senha de app. Propriedades obrigatórias do script:

- `WEBHOOK_SECRET`: segredo longo e exclusivo
- `DESTINATION_EMAIL`: e-mail comercial
- `SENDER_NAME`: `CHURRASCARIA CARNE DE SOL`
- `SITE_URL`: `https://churrascariacarnedosol.vercel.app`

## Verificação

```bash
npm run check
node --check assets/app.js
node --check assets/admin.js
```
