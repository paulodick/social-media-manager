# Social Media Manager

App multi-cliente para planejar posts em várias redes sociais. Usuário único por enquanto (senha em variável de ambiente). Interface e textos em português do Brasil.

## Pilha
- Next.js (App Router, TypeScript), Postgres via `pg`, sem ORM.
- Ações do servidor em `src/lib/actions.ts`. Consultas em `src/lib/queries.ts`.
- Migrações em `src/lib/db.ts`: só acrescentar versões novas ao fim da lista, nunca editar as antigas. Rodam sozinhas na primeira consulta.
- Redes, formatos, limites e pontos de corte das prévias: `src/config/networks.ts`. Limite `null` significa que a checagem fica desligada até confirmarmos o valor atual da rede. Cada formato tem `guide` (formato e tempo ideais, só informativo na tela de novo post). Sem fonte confiável para Kwai e Facebook (Feed/Stories): por decisão do Paulo, Kwai usa a referência de tempo do TikTok, Facebook Feed a do LinkedIn e Facebook Stories a do Instagram Stories (marcado "mesma referência" na tela). Trocar quando houver fonte oficial. Conferido em 2026-11-21: LinkedIn e YouTube em páginas oficiais; Instagram, Facebook e TikTok em guias de terceiros.
- Checagens de legenda e mídia: `src/lib/checks.ts` (funções puras, com testes).
- Novo post (`/posts/novo`): primeiro campo é o planejamento do dia (tabela `day_notes`, uma nota por cliente e dia, aparece no calendário e na tela do dia). Sem rede marcada, só a nota é salva. Cada rede/formato marcado (`src/components/TargetPicker.tsx`) tem a própria legenda (`caption__rede:formato`) e o próprio link do Drive (`drive__rede:formato`). Na criação, a nota nova é acrescentada à existente; na tela do dia ela é editada por inteiro (`saveDayNote`).
- Legendas com IA sem custo de API: o app não chama nenhuma IA. `src/lib/prompt.ts` (`buildCaptionPrompt`, com teste) monta o pedido (cliente, tom de voz, planejamento do dia, rede/formato, limites, guia de mídia) e o botão "Copiar pedido para a IA" (novo post e tela do dia) copia para colar no Claude/Gemini da assinatura do Paulo; ele cola a legenda de volta. Chamada direta por API (`ANTHROPIC_API_KEY`) só se um dia houver orçamento; o mesmo prompt serve.
- Google Drive por conta de serviço: `src/lib/drive.ts`. O app lê arquivos e só cria pastas (nunca envia, move nem apaga). Ao criar um post, `ensureFolderPath` garante `Ano / MM - Mês / DD / Rede / Formato` dentro da pasta do cliente e guarda o ID em `post_targets.post_folder_id`. Se não conseguir criar (conta só com Leitor), o post é criado mesmo assim e a tela do dia avisa. Pastas criadas pelo app pertencem à conta de serviço: o dono do Drive não consegue apagá-las nem renomeá-las. Vídeos passam por `/api/media/[id]`, que exige login, só serve arquivos ligados a um post e repassa o cabeçalho Range.

## Regras
- Datas são "dia local" em America/Sao_Paulo (texto AAAA-MM-DD e HH:MM). O banco guarda `timestamptz`. Converter sempre no SQL (`at time zone`), nunca no JavaScript.
- Pastas no Drive: `Cliente / Ano / MM - Mês / Dia / Rede / Formato` (ex.: `2026 / 11 - Novembro / 21`). Fora disso, a pasta `Logotipo` fica no nível do cliente. O app guarda o ID do arquivo no banco e não depende do caminho. O caminho serve de conferência.
- Nunca colocar segredos no repositório. Variáveis em `.env.example`. O repositório é público.
- Publicação nas redes é manual nesta fase. Publicação automática (Buffer, Metricool, Zapier) fica para depois.

## Comandos
- `npm run dev`, `npm run build`, `npm run typecheck`, `npm test`.
- Para testar localmente é preciso um Postgres e as variáveis `DATABASE_URL` e `SESSION_SECRET`. A senha é definida na tela `/configurar` (hash scrypt na tabela `app_settings`). `APP_PASSWORD`, se definida, tem prioridade e serve de recuperação.

## Estado
Etapa 1 pronta: primeiro acesso com definição de senha, clientes, calendário, planejamento por dia, novo post com legenda e vídeo por rede, dia com prévia, postar hoje, leitura do Drive e criação das pastas do post.
Ainda não feito: legendas geradas dentro do app (hoje é copiar e colar), templates por rede, integração com o Canva, prévias de Facebook (Reels/Stories), TikTok, Kwai e YouTube, visão de semana, aprovação do cliente, lembretes.
O protótipo visual aprovado está em `prototipo/`.
