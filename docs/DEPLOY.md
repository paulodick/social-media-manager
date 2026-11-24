# Publicar no Render

## O que criar
1. **Postgres** no Render (workspace "My Workspace"). Copie a URL interna de conexão.
2. **Web Service** ligado a este repositório (`paulodick/social-media-manager`, branch `main`):
   - Build: `npm ci && npm run build`
   - Start: `npm start`
   - Health check: `/login`
3. **Variáveis de ambiente** no Web Service:

| Variável | O que é |
|---|---|
| `DATABASE_URL` | URL do Postgres do Render |
| `APP_PASSWORD` | opcional. Se ficar vazia, a senha é definida na tela "Primeiro acesso" e guardada (com hash) no banco. Se for definida, ela vale no lugar da senha do banco e serve de recuperação caso você esqueça a senha |
| `SESSION_SECRET` | texto longo e aleatório (32 caracteres ou mais) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON da conta de serviço do Google, colado inteiro |
| `DRIVE_ROOT_FOLDER_ID` | opcional: ID da pasta raiz dos clientes no Drive (para "Criar diretório"; também pode ser definido em `/configuracoes`) |
| `GEMINI_API_KEY` | opcional: liga a geração de legendas (com prioridade sobre a Anthropic) e o Planejamento Editorial com IA |
| `ANTHROPIC_API_KEY` | opcional: alternativa para ligar o botão "Gerar legenda" via Claude (a API é cobrada à parte da assinatura) |
| `TOKEN_ENC_KEY` | texto longo e aleatório (AES-256-GCM) para criptografar os tokens das contas conectadas no banco |
| `APP_URL` | endereço público do app sem barra no fim (ex.: `https://app.ebuks.com.br`), usado nos callbacks OAuth e links assinados de mídia |
| `META_APP_ID` | ID do app na Meta (Facebook e Instagram) |
| `META_APP_SECRET` | segredo do app na Meta |
| `META_LOGIN_CONFIG_ID` | ID da configuração de Login do Facebook para Empresas |
| `LINKEDIN_CLIENT_ID` | Client ID do app no LinkedIn |
| `LINKEDIN_CLIENT_SECRET` | Client Secret do app no LinkedIn |
| `LINKEDIN_API_VERSION` | opcional: versão da API do LinkedIn (`AAAAMM`, padrão `202611`) |
| `TIKTOK_CLIENT_KEY` | Client Key do app no TikTok |
| `TIKTOK_CLIENT_SECRET` | Client Secret do app no TikTok |
| `RESEND_API_KEY` | opcional: chave da Resend para enviar avisos por e-mail quando a publicação automática falha ou perde o horário |
| `NOTIFY_EMAIL_TO` | opcional: e-mail de destino dos avisos da Resend |
| `NOTIFY_EMAIL_FROM` | opcional: remetente dos avisos da Resend (padrão `Social Media Manager <onboarding@resend.dev>`) |

4. **Primeiro acesso**: abra o endereço do app logo depois do deploy. Sem senha ainda, a tela pede para você escolher uma. Quem abrir essa tela primeiro define a senha, então faça isso você mesmo antes de divulgar o endereço.

5. **Domínio**: adicione `app.ebuks.com.br` em Settings, Custom Domains, e crie no DNS do domínio o registro CNAME que o Render indicar.

## Conta de serviço do Google (leitura e criação de pastas no Drive)
1. No Google Cloud, crie um projeto e ative a API do Google Drive.
2. Crie uma conta de serviço e gere uma chave JSON.
3. Cole o JSON na variável `GOOGLE_SERVICE_ACCOUNT_JSON`.
4. No Drive, compartilhe a pasta de cada cliente com o e-mail da conta de serviço. Como Editor, o app cria sozinho as pastas do post (dia, rede e formato). Como Leitor, ele só lê e avisa que não pôde criar as pastas. As pastas criadas pelo app pertencem à conta de serviço, e o dono do Drive não consegue apagá-las. Esse e-mail também aparece na tela Configurações do app.

## Conferência depois de publicar
Abra `/configuracoes` no app: banco, senha, segredo da sessão e Drive devem aparecer como OK.
