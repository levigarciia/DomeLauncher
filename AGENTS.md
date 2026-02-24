# AGENTS.md - Dome Launcher

Guia para agentes de IA e contribuidores no repositorio `DomeLauncher`.

## Objetivo do Projeto

`DomeLauncher` e um launcher desktop para Minecraft baseado em Tauri:

- Frontend: React + TypeScript + Vite (`src/`)
- Backend nativo: Rust + Tauri (`src-tauri/`)

## Regra Critica do README

`README.md` e material para publico final (jogadores), nao para devs.

### O que pode no README

- Visao geral do launcher
- Beneficios e funcionalidades para usuario
- Requisitos minimos
- Links de download, Discord, site e suporte

### O que nao deve entrar no README

- Detalhes internos de arquitetura
- Fluxos tecnicos de autenticacao
- Estrutura interna de modulos Rust/React
- Guia de manutencao, scripts internos, decisoes de engenharia

### Onde colocar conteudo tecnico

- Criar/usar documentacao tecnica separada (ex.: `docs/DEVELOPMENT.md`, `docs/ARQUITETURA.md`)
- No README, manter no maximo um link curto para essa documentacao tecnica

## Estrutura Atual Importante

- `src-tauri/src/main.rs`: ponto de entrada binario
- `src-tauri/src/lib.rs`: bootstrap da app Tauri e comandos
- `src-tauri/src/launcher.rs`: modelos/estado principal do launcher
- `src-tauri/src/auth*.rs`: autenticacao Microsoft/Discord
- `src/components/` e `src/pages/`: UI React
- `src/hooks/useLauncher.ts`: orquestracao principal do frontend com `invoke`

## Convencoes de Codigo

- Escrever codigo, comentarios e nomes em portugues quando coerente
- Funcoes curtas, com responsabilidade unica
- Evitar duplicacao; extrair utilitarios reaproveitaveis
- Preferir tipagem explicita no TypeScript
- Tratar erros de IO/rede com mensagens claras para o usuario

## Regras para Comandos Tauri

Ao criar/alterar comandos no backend:

1. Declarar funcao com `#[tauri::command]` (ou `#[command]` quando aplicavel).
2. Registrar no `tauri::generate_handler![]` em `src-tauri/src/lib.rs`.
3. Integrar no frontend via `invoke(...)` com tipagem de retorno.
4. Garantir validacao de entrada (paths, urls, ids).

## Build e Validacao

Executar antes de concluir alteracoes:

```bash
# frontend
npm run build

# backend
cd src-tauri
cargo check
```

Se alterar fluxo de instancia, modpack, auth ou Java, validar tambem manualmente no app.

## Diretriz de Refatoracao do Backend Rust

`src-tauri/src/lib.rs` esta grande. Em novas implementacoes, preferir extrair por dominio para modulos dedicados (ex.: `mods`, `instancias`, `logs`, `social`, `java`, `news`) e manter `lib.rs` como orquestrador.

## Checklist de Entrega

- Build frontend ok
- `cargo check` ok
- Sem regressao em comandos Tauri usados pela UI
- README mantido como documento de publico final
- Detalhes tecnicos documentados fora do README
