# Arquitetura

O Dome Launcher combina React, TypeScript e Vite no frontend com Rust e Tauri no backend nativo.

## Frontend

- `src/App.tsx`: navegação principal e composição das telas.
- `src/components`: telas e componentes visuais.
- `src/hooks`: orquestração reutilizável de estado e comandos.
- `src/lib`: configurações e utilitários compartilhados.

As telas grandes são carregadas sob demanda. Dados nativos devem ser acessados por comandos Tauri tipados; chamadas HTTP diretas
ficam restritas a APIs públicas que não dependem de segredos.

## Backend

- `src-tauri/src/aplicacao`: criação, lançamento, conteúdo e importação de instâncias.
- `src-tauri/src/comandos`: comandos agrupados por domínio.
- `src-tauri/src/launcher.rs`: estado principal e persistência protegida de contas e sessões.
- `src-tauri/src/auth*.rs`: autenticação Microsoft.

IDs de instância são componentes simples de caminho. Antes de apagar, mover ou editar arquivos, o backend deve resolver o alvo
a partir da raiz permitida e rejeitar travessia de diretórios.

## Segurança

- Tokens Microsoft e sociais são protegidos com DPAPI no Windows.
- A CSP restringe scripts, conexões, formulários e objetos carregados pela WebView.
- HTML externo passa por sanitização antes da renderização.
- URLs externas abertas pelo sistema devem usar HTTPS.
