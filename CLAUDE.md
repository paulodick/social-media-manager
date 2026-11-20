# Social Media Manager

App multi-cliente para planejar posts em várias redes sociais. Usuário único por enquanto (senha em variável de ambiente). Interface e textos em português do Brasil.

## Pilha
- Next.js (App Router, TypeScript), Postgres via `pg`, sem ORM.
- Ações do servidor em `src/lib/actions.ts`. Consultas em `src/lib/queries.ts`.
- Migrações em `src/lib/db.ts`: só acrescentar versões novas ao fim da lista, nunca editar as antigas. Rodam sozinhas na primeira consulta.
- Redes, formatos, limites e pontos de corte das prévias: `src/config/networks.ts`. Limite `null` significa que a checagem fica desligada até confirmarmos o valor atual da rede.
- Checagens de legenda e mídia: `src/lib/checks.ts` (funções puras, com testes).
- Google Drive por conta de serviço, só leitura: `src/lib/drive.ts`. Vídeos passam por `/api/media/[id]`, que exige login, só serve arquivos ligados a um post e repassa o cabeçalho Range.

## Regras
- Datas são "dia local" em America/Sao_Paulo (texto AAAA-MM-DD e HH:MM). O banco guarda `timestamptz`. Converter sempre no SQL (`at time zone`), nunca no JavaScript.
- Pastas no Drive: `Cliente / Ano / Mês / Dia / Rede / Formato`. O app guarda o ID do arquivo no banco e não depende do caminho. O caminho serve de conferência.
- Nunca colocar segredos no repositório. Variáveis em `.env.example`. O repositório é público.
- Publicação nas redes é manual nesta fase. Publicação automática (Buffer, Metricool, Zapier) fica para depois.

## Comandos
- `npm run dev`, `npm run build`, `npm run typecheck`, `npm test`.
- Para testar localmente é preciso um Postgres e as variáveis `DATABASE_URL` e `SESSION_SECRET`. A senha é definida na tela `/configurar` (hash scrypt na tabela `app_settings`). `APP_PASSWORD`, se definida, tem prioridade e serve de recuperação.

## Estado
Etapa 1 pronta: primeiro acesso com definição de senha, clientes, calendário, novo post, dia com prévia, postar hoje, leitura do Drive.
Ainda não feito: legendas com IA (`ANTHROPIC_API_KEY`), templates por rede, integração com o Canva, prévias de Facebook (Reels/Stories), TikTok, Kwai e YouTube, visão de semana, aprovação do cliente, lembretes.
O protótipo visual aprovado está em `prototipo/`.
