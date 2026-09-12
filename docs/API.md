# Comunicação do DomeLauncher com a API

## Escopo e fontes

Contrato conferido no código em 12/09/2026, incluindo as rotas do checkout local de
`DomeAPI/src/routes/social/`. Isso não comprova a revisão implantada em produção.
A pasta irmã DomeAPI não é necessária para compilar o launcher.

- [Configuração do build](../vite.config.ts) e [configuração social](../src/lib/configuracaoSocial.ts).
- [OAuth Discord](../src-tauri/src/discord_social.rs).
- [Cliente HTTP e contratos Rust](../src-tauri/src/comandos/social_launcher.rs).
- [Interface e Socket.IO](../src/components/SocialSidebar.tsx).
- [Tipos sociais](../src/components/social/tiposSocial.ts) e [persistência](../src-tauri/src/launcher.rs).
- [Registro de comandos](../src-tauri/src/aplicacao/bootstrap.rs).

HTTP segue `React → invoke Tauri → reqwest/Rust → DomeAPI → JSON → React`.
Presença e notificações seguem `React → socket.io-client → DomeAPI` diretamente.
Pacotes de instâncias passam por HTTP no Rust; Socket.IO transporta pedidos, estados e tokens.

## Configuração pública

Base padrão: `https://api.domestudios.com.br`, sem `/api/launcher` e sem barra final.
Vite injeta `__DOME_CONFIGURACAO_SOCIAL__`, exportada como `CONFIGURACAO_SOCIAL`.
Esses valores são públicos; nunca acrescente client secret ao objeto.

| Campo | Variáveis em precedência, primeira não vazia | Padrão |
| --- | --- | --- |
| `apiBaseUrl` | `DOME_API_PUBLIC_URL`, `DOME_API_URL`, `VITE_DOME_API_PUBLIC_URL`, `VITE_DOME_API_URL`, `VITE_API_PUBLIC_URL` | `https://api.domestudios.com.br` |
| `discordClientId` | `DOME_CLIENT_ID`, `DOME_APP_ID`, `DOME_DISCORD_CLIENT_ID`, `VITE_DOME_CLIENT_ID`, `VITE_DOME_APP_ID`, `VITE_DOME_DISCORD_CLIENT_ID` | `1380421346605138041` |
| `discordRedirectUri` | `DOME_REDIRECT_URI`, `DOME_DISCORD_REDIRECT_URI`, `VITE_DOME_REDIRECT_URI`, `VITE_DOME_DISCORD_REDIRECT_URI` | `https://domestudios.com.br/domelauncher` |
| `discordScopes` | `DOME_DISCORD_SCOPES`, `VITE_DOME_DISCORD_SCOPES` | `identify` |

Exemplo em `.env.local`, para uma API local já em execução:

```dotenv
DOME_API_PUBLIC_URL=http://localhost:3000
```

Reinicie o Vite ou reconstrua o bundle após mudanças. Client ID e redirect URI devem corresponder
ao aplicativo Discord do servidor. A variável não altera a CSP: confira `connect-src` em
`src-tauri/tauri.conf.json`, incluindo WebSocket, sem liberar origens indiscriminadamente.

## Login e sessão

1. A UI chama `login_discord_social` com `apiBaseUrl`, `clientId`, `redirectUri` e `scope`.
2. Rust gera `state`, verifier aleatório e challenge PKCE S256 e abre uma WebView no OAuth Discord.
3. O fluxo espera até 180 segundos, extrai `code` e valida o `state` retornado.
4. Rust envia `POST /api/launcher/auth/discord/exchange` com `{ code, codeVerifier, redirectUri }`.
5. A API troca o código com Discord e retorna `{ accessToken, refreshToken, expiraEm, perfil }`.
   O segredo OAuth, quando configurado, fica no servidor. Token social não é token Discord nem Minecraft.

`obterTokenValido` considera a sessão vencida 20 segundos antes de `expiraEm`. A renovação usa
`refresh_launcher_social_session`, recebe `{ accessToken, expiraEm }` e preserva o refresh token.
Falha na renovação limpa a sessão local. Não presuma retry de toda requisição com 401 ou rotação de refresh token.

`salvar_sessao_social_local` grava `%APPDATA%/dome/social-session.dat`, protegido por DPAPI no Windows;
`carregar_sessao_social_local` recupera a sessão. A chave legada `dome:social:sessao` no `localStorage`
é migrada e removida. Tokens ainda existem na memória do frontend para IPC/socket.

`logout_launcher_social` está implementado e registrado, mas não é chamado pelo frontend atual.
A rota local da API marca o perfil offline, sem revogar JWTs emitidos. Desconectar socket, limpar sessão
local e invalidar credenciais no servidor são operações diferentes.

## HTTP e IPC

As rotas das tabelas são relativas a `/api/launcher`. JSON e argumentos de `invoke` usam camelCase,
mesmo quando parâmetros Rust usam snake_case. Rotas protegidas recebem `Authorization: Bearer <accessToken>`.
Exchange e refresh dispensam Bearer; download usa token próprio na query.

O cliente social comum tem timeout total de 12 segundos. Transferências têm timeout de conexão de 20 segundos,
sem timeout total fixo. O exchange OAuth usa outro cliente, sem o timeout comum de 12 segundos.
`social_launcher.rs` exige HTTPS, exceto HTTP em `localhost`, `127.0.0.1` e `::1`.
O normalizador de `discord_social.rs` é menos restritivo e aceita prefixo HTTP ou HTTPS.

### Autenticação e perfil

| Método e rota | Comando Tauri | Corpo / resposta consumida |
| --- | --- | --- |
| `POST /auth/discord/exchange` | `login_discord_social` | `{ code, codeVerifier, redirectUri }` → sessão completa |
| `POST /auth/refresh` | `refresh_launcher_social_session` | `{ refreshToken }` → `{ accessToken, expiraEm }` |
| `POST /auth/logout` | `logout_launcher_social` | Sem corpo; retorno IPC `void` após sucesso HTTP |
| `GET /social/profile/me` | `get_launcher_social_profile` | Perfil direto, sem envelope `perfil` |
| `PATCH /social/profile/me` | `save_launcher_social_profile` | `{ nomeSocial?, handle?, contaMinecraftPrincipalUuid? }` → `{ sucesso?, perfil? }` |
| `PATCH /social/status/me` | `set_launcher_social_status` | `{ statusManual?, aparecerOffline? }` → `{ sucesso?, perfil? }` |
| `POST /social/minecraft/link` | `link_launcher_minecraft_account` | `{ uuid, nome, minecraftAccessToken }` → `{ sucesso?, perfil? }` |
| `DELETE /social/minecraft/:uuid` | `unlink_launcher_minecraft_account` | Sem corpo → `{ sucesso?, perfil? }` |

O token Minecraft comprova a conta perante o servidor; UUID/nome isolados não substituem essa prova.
Status de presença usados: `online`, `ausente`, `offline`. Atividade e `emJogo` vêm do heartbeat.
A API local também tem `GET /auth/me`; o launcher usa `/social/profile/me`.

### Amigos e chat

| Método e rota | Comando Tauri | Corpo / resposta consumida |
| --- | --- | --- |
| `GET /friends` | `get_launcher_friends` | `{ amigos, pendentesRecebidas, pendentesEnviadas }` |
| `GET /friends/search-by-handle/:handle` | `search_launcher_friend_by_handle` | Perfil de busca; HTTP 404 vira `null` no IPC |
| `POST /friends/request-by-handle` | `send_launcher_friend_request_by_handle` | `{ handle }` → `{ sucesso, id, destinatarioPerfilId }` |
| `DELETE /friends/request/:id` | `cancel_launcher_friend_request` | Cancela pedido; retorno IPC `void` |
| `POST /friends/request/:id/accept` | `respond_launcher_friend_request` | IPC `acao: "accept"` ou `"aceitar"`; sem corpo HTTP; retorno `void` |
| `POST /friends/request/:id/reject` | `respond_launcher_friend_request` | IPC `acao: "reject"` ou `"recusar"`; sem corpo HTTP; retorno `void` |
| `DELETE /friends/:friendProfileId` | `remove_launcher_friend` | Remove amizade; retorno IPC `void` |
| `GET /chat/:friendProfileId?limite=N` | `get_launcher_chat_messages` | `{ conversaId, mensagens }`; padrão 60, entre 1 e 120 |
| `POST /chat/send` | `send_launcher_chat_message` | `{ paraPerfilId, conteudo }` → HTTP `{ mensagem, ... }`; Rust extrai mensagem |

Handle é normalizado para minúsculas e sem `@`; a UI aceita 3–24 caracteres em `[a-z0-9._]`.
Rust apara mensagens, rejeita conteúdo vazio e mais de 500 caracteres. Parâmetros de rota são codificados
para URL. Diferencie ID de pedido, ID de amizade, perfil social e UUID Minecraft.

Exemplo de leitura em um módulo dentro de `src/`, com sessão válida obtida pelo fluxo existente:

```ts
import { invoke } from '@tauri-apps/api/core';
import { CONFIGURACAO_SOCIAL } from './lib/configuracaoSocial';
import type { RespostaAmigosApi, SessaoSocial } from './components/social/tiposSocial';

async function buscarAmigos(sessao: SessaoSocial): Promise<RespostaAmigosApi> {
    return invoke<RespostaAmigosApi>('get_launcher_friends', {
        apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
        accessToken: sessao.accessToken,
    });
}
```

Na integração existente, reutilize `obterTokenValido` antes de enviar requisições.

### Dados principais

| Tipo | Campos |
| --- | --- |
| Sessão | `accessToken`, `refreshToken`, `expiraEm`, `perfil` |
| Perfil | `perfilId`, `discordId`, `discordUsername`, `discordGlobalName?`, `discordAvatar?`, `handle`, `nomeSocial`, `contasMinecraftVinculadas`, `contaMinecraftPrincipalUuid?`, `online`, `status?`, `aparecerOffline?`, `emJogo?`, `atividadeAtual?`, `ultimoSeenEm?`, `criadoEm`, `atualizadoEm` |
| Conta vinculada | `uuid`, `nome`, `vinculadoEm`, `ultimoUsoEm?` |
| Amigo | `amizadeId`, `friendProfileId`, `nome`, `handle?`, `avatarUrl?`, `online`, `status?`, `atividadeAtual?`, `ultimoSeenEm?` |
| Pedido recebido | `id`, `dePerfilId`, `deHandle?`, `deNome`, `criadoEm` |
| Pedido enviado | `id`, `paraPerfilId`, `paraHandle?`, `paraNome`, `criadoEm` |
| Perfil de busca | `perfilId`, `nome`, `handle`, `avatarUrl?`, `online`, `status?` |
| Mensagem | `id`, `dePerfilId`, `paraPerfilId`, `conteudo`, `criadoEm` |
| Atividade | `tipo`, `instanciaId?`, `instanciaNome?`, `servidor?`, `source?`, `projectId?`, `versionId?`, `fileId?`, `modpackNome?`, `iconeUrl?`, `versaoMinecraft?`, `loader?`, `atualizadoEm` |

Datas são strings interpretadas como datas pelo cliente. Campos opcionais podem admitir `null`; consulte
os tipos Rust/TypeScript antes de mudar serialização. Atividade usa `launcher`, `modpack_exato` ou
`instancia_personalizada`; `source` usa `modrinth` ou `curseforge`.

## Socket.IO

A conexão usa `io(base, { auth: { accessToken }, transports: ['websocket', 'polling'] })`.
Não é WebSocket puro: preserve Socket.IO e seu path padrão `/socket.io/` no proxy.
Ao trocar conexão/token, o cliente desconecta o socket anterior. Heartbeats ocorrem ao conectar,
quando a atividade muda e a cada 20 segundos.

| Direção | Evento | Payload e efeito |
| --- | --- | --- |
| Cliente → API | `social:presenca:heartbeat` | `{ emJogo, atividadeAtual }` |
| API → cliente | `social:amigos:atualizar` | Sinaliza recarregar amigos via HTTP |
| API → cliente | `social:chat:nova` | `{ mensagem }` atualiza conversa e não lidas |
| Cliente → API | `social:sync:solicitar` | `{ alvoPerfilId, instanciaId, instanciaNome }`; ack `{ sucesso, pedidoId?, erro? }` |
| API → cliente | `social:sync:pedido` | `pedidoId`, `solicitantePerfilId`, metadados da instância e `expiraEm` |
| Cliente → API | `social:sync:responder` | `{ pedidoId, aceitar }`; ack `{ sucesso, erro? }` |
| API → cliente | `social:sync:status` | `pedidoId`, `status` e token correspondente ao participante/etapa |
| Ambas | `social:sync:falha` | `{ pedidoId, mensagem }` comunica falha ao solicitante |

O cliente envia chat por HTTP, embora a API local também implemente `social:chat:enviar`.
Não envie simultaneamente pelos dois canais, pois isso pode duplicar mensagens.

## Transferência de instâncias

1. O solicitante emite `social:sync:solicitar` para obter uma instância do amigo alvo.
2. O alvo recebe o pedido e aceita ou recusa com `social:sync:responder`.
3. Em `aguardando_upload`, o alvo recebe `tokenUpload`; o solicitante aguarda a preparação.
4. `export_launcher_social_sync_package({ instanceId })` exporta `.dome` sem saves e retorna
   `{ caminhoArquivo, tamanhoBytes }`. A exportação pesada usa `spawn_blocking`.
5. `upload_launcher_social_sync_package` envia streaming por `POST /social/sync/upload/:pedidoId`,
   com Bearer social, `x-social-sync-token` e `Content-Type: application/octet-stream`.
   Não use multipart nem JSON para o arquivo.
6. A API sinaliza `pronto_download` ao solicitante com `tokenDownload`. O cliente monta a URL pela base
   configurada, mesmo quando o evento também inclui `downloadUrl`.
7. `download_import_launcher_social_sync_package` faz `GET /social/sync/download/:pedidoId?token=...`,
   sem Bearer, grava em `%TEMP%/dome-social-sync/incoming`, importa e remove o temporário após sucesso.
   Retorna `{ pedidoId, caminhoArquivo, instanciaId, mensagem }`; o caminho retornado pode já estar removido.

IPC de upload: `{ apiBaseUrl, accessToken, payload: { pedidoId, tokenUpload, caminhoArquivo } }`.
IPC de download: `{ apiBaseUrl, pedidoId, tokenDownload }`, sem envelope `payload`.
Upload HTTP retorna JSON; a API local responde 201 com `{ sucesso, pedidoId, status, tamanhoBytes }`.
Download HTTP retorna o arquivo binário.

O launcher limita upload/download a `512 * 1024 * 1024` bytes (512 MiB), inclusive durante recebimento.
A API local permite 2 GiB; o limite efetivo desse cliente continua sendo 512 MiB.
Ack de aceite não significa upload concluído; `pronto_download` não significa instância importada.
Não exponha tokens de transferência ou URLs autenticadas em logs. A limpeza em todos os tipos de falha
não é garantida pelo cliente atual; confira rede, arquivo vazio, limite excedido e falha de importação.

## Erros e diagnóstico

Rust verifica status antes de desserializar. O extrator comum procura `erro.mensagem`, `message`, `erro`
textual e `error` textual, nessa ordem. Caso contrário, inclui até 200 caracteres do corpo; sem corpo,
mantém o status. A API local responde erros como `{ erro: { codigo, mensagem } }`.

- **401:** confira tipo de token, expiração e renovação; token Microsoft não autentica rotas sociais.
- **403:** confira participante e permissão; não contorne autorização no cliente.
- **404:** busca por handle vira ausência; em sync pode indicar pacote indisponível.
- **429:** confira recarregamentos em cascata e limitador do servidor; evite retries imediatos.
- **Conexão:** separe base do build, CSP da WebView, proxy Socket.IO e rede do Rust.

Rejeições de `invoke` podem ser strings. O helper atual `mensagemErro` só extrai texto de `Error`, então
alguns detalhes nativos aparecem como mensagem genérica. Não presuma que o usuário viu o status HTTP.
Não existe uma camada global de retry para essas chamadas.

## Outros serviços e validação

Microsoft/Xbox/Minecraft, skins, manifests Mojang, loaders e conteúdo Modrinth/CurseForge têm integrações
próprias, fora da DomeAPI. Consulte `auth*.rs`, `skin.rs` e módulos de `aplicacao/`.
Discord Rich Presence em `comandos/presenca_discord.rs` também é distinto do social da DomeAPI.
O updater usa GitHub, conforme `tauri.conf.json`, e não `/api/launcher`.

Ao mudar contratos, atualize comando Rust, registro, tipos/UI e este documento. Se o servidor precisar mudar,
considere compatibilidade entre versões; alterar um checkout não implanta a API. Valide, conforme o escopo,
login/renovação, perfil, amizade, chat entre duas contas, reconexão, presença e transferências aceitas,
recusadas e com falha. Build/testes locais não comprovam OAuth ou disponibilidade em produção.
