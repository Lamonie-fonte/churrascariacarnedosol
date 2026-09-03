# E-mail, OTP numérico e Google Apps Script

## Supabase Auth

Configuração esperada em Authentication:

- Site URL: `https://churrascariacarnedosol.vercel.app`
- OTP: código numérico oficial do Supabase (a interface aceita de 6 a 8 dígitos)
- SMTP host: `smtp.gmail.com`
- SMTP port: `465`
- SMTP user: e-mail comercial da churrascaria
- SMTP password: senha de app do Google (guardar somente no painel do Supabase)
- Sender name: `CHURRASCARIA CARNE DE SOL`
- Sender email: e-mail comercial da churrascaria

Os arquivos de `supabase/email-templates` versionam os modelos usados em **Authentication > Email Templates**. O modelo de Magic Link contém `{{ .Token }}`, portanto o Supabase Auth envia um OTP numérico em vez de um link.

A Edge Function `request-auth-code` usa `admin.generateLink` apenas para criar o token oficial sem disparar o modelo padrão do Supabase. No cadastro, ela fornece uma senha técnica aleatória exigida pela API; no acesso e na recuperação, usa os tipos correspondentes. Em seguida, substitui o token pendente por um código de seis dígitos e envia o HTML da churrascaria pelo SMTP protegido no Vault. Assim nenhum e-mail contém link para `localhost`. A função mantém lista de origem permitida, resposta neutra contra enumeração e limites persistentes por e-mail e por hora.

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

O teste de produção deve retornar HTTP 200 e `{\"ok\":true}` no histórico de respostas do `pg_net`. O envio do Supabase Auth também deve retornar HTTP 200 antes da validação visual do código recebido.
