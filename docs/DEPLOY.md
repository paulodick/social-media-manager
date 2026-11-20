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
| `ANTHROPIC_API_KEY` | só na etapa 2 (legendas com IA) |

4. **Primeiro acesso**: abra o endereço do app logo depois do deploy. Sem senha ainda, a tela pede para você escolher uma. Quem abrir essa tela primeiro define a senha, então faça isso você mesmo antes de divulgar o endereço.

5. **Domínio**: adicione `app.ebuks.com.br` em Settings, Custom Domains, e crie no DNS do domínio o registro CNAME que o Render indicar.

## Conta de serviço do Google (leitura do Drive)
1. No Google Cloud, crie um projeto e ative a API do Google Drive.
2. Crie uma conta de serviço e gere uma chave JSON.
3. Cole o JSON na variável `GOOGLE_SERVICE_ACCOUNT_JSON`.
4. No Drive, compartilhe a pasta de cada cliente, como Leitor, com o e-mail da conta de serviço. Esse e-mail também aparece na tela Configurações do app.

## Conferência depois de publicar
Abra `/configuracoes` no app: banco, senha, segredo da sessão e Drive devem aparecer como OK.
