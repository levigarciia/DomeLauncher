# Processo de release

## Antes da tag

1. Execute `bun install --frozen-lockfile`.
2. Execute `bun audit` e resolva vulnerabilidades reportadas.
3. Execute `bun run verificar`.
4. Execute `git diff --check`.
5. Faça o smoke test em uma instalação limpa do Windows.

## Smoke test obrigatório

1. Instalar o launcher sem ferramentas de desenvolvimento presentes.
2. Entrar com uma conta Microsoft válida.
3. Criar e iniciar instâncias Vanilla, Fabric, Forge e NeoForge.
4. Confirmar seleção ou instalação automática do Java exigido.
5. Instalar conteúdo Modrinth e CurseForge compatível.
6. Abrir mundo local e conectar diretamente a um servidor.
7. Exportar, importar e sincronizar uma instância.
8. Validar login Discord, amigos, chat e encerramento de sessão.
9. Publicar uma versão de teste e confirmar download, assinatura e updater.

## Publicação

A tag `v*` dispara `.github/workflows/release-launcher.yml`. O workflow usa Bun, valida frontend e backend, gera o instalador NSIS
e publica `latest.json` para o atualizador.

As versões em `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json` devem ser iguais antes da criação da tag.
O workflow interrompe a publicação automaticamente quando a versão da tag diverge de qualquer um desses manifestos.
