# E-mail, OTP de 6 dígitos e Google Apps Script

## Supabase Auth

Configuração esperada em Authentication:

- Site URL: `https://churrascariacarnedosol.vercel.app`
- OTP: exatamente 6 dígitos
- SMTP host: `smtp.gmail.com`
- SMTP port: `465`
- SMTP user: e-mail comercial da churrascaria
- SMTP password: senha de app do Google (guardar somente no painel do Supabase)
- Sender name: `CHURRASCARIA CARNE DE SOL`
- Sender email: e-mail comercial da churrascaria

Nos modelos de confirmação, acesso, recuperação e troca de e-mail, usar os arquivos de `supabase/email-templates`. Todos usam `{{ .Token }}` e não contêm `localhost` nem `{{ .ConfirmationURL }}`.

## Google Apps Script

O Google Apps Script usa a conta Google que executa o script por meio de `GmailApp`. Portanto, não se deve colar a senha de app no código nem nas propriedades do script.

Propriedades do script:

- `DESTINATION_EMAIL`: e-mail comercial da churrascaria
- `SENDER_NAME`: `CHURRASCARIA CARNE DE SOL`
- `SITE_URL`: `https://churrascariacarnedosol.vercel.app`
- `WEBHOOK_SECRET`: valor aleatório longo, diferente de qualquer senha

Depois de criar as propriedades, execute `testEmail` uma vez, autorize o Gmail e confirme o recebimento. Em seguida, publique como Aplicativo da Web, executando como proprietário e permitindo acesso a qualquer pessoa. O `WEBHOOK_SECRET` protege o envio pelo endpoint público.

## Integração automática de pedidos

A URL publicada e o `WEBHOOK_SECRET` ficam criptografados no Supabase Vault. A migração `20260903001000_order_email_webhook.sql` instala um gatilho interno que envia cada novo pedido ao Google Apps Script por `pg_net`. O navegador nunca recebe o segredo e uma falha de e-mail não impede a criação do pedido.
