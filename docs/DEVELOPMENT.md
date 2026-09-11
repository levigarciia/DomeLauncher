# Desenvolvimento do Dome Launcher

## Requisitos

- Windows 10 ou 11
- Bun 1.3.5 ou compatível
- Rust estável com `rustfmt` e `clippy`
- WebView2

## Preparação

```powershell
bun install --frozen-lockfile
```

Variáveis públicas opcionais podem ser definidas em `.env.local`. Use `.env.example` como referência quando ele existir.
Não armazene tokens de usuário ou segredos novos em arquivos versionados.

## Execução

```powershell
bun run dev
```

O frontend isolado pode ser iniciado com `bun run vite`, mas isso não valida comandos Tauri nem o backend Rust.

## Validação obrigatória

```powershell
bun run verificar
bun audit
git diff --check
```

Alterações em autenticação, Java, instâncias, importação ou modpacks também exigem validação manual no aplicativo.

### Verificação dos modelos de skins em produção

```powershell
bun run verificar:skins
```

O teste compila o componente real de preview em modo de produção e abre os modelos clássico e slim
com a CSP de `src-tauri/tauri.conf.json`. Primeiro reproduz o bloqueio sem `data:` em `connect-src`,
depois exige o carregamento dos dois modelos com a política atual. Os buffers GLTF estão embutidos,
mas o Three.js os lê por `fetch`, portanto a permissão em `img-src` sozinha não é suficiente.

No Windows, requer Microsoft Edge e Node.js 22.18 ou superior. O comando é executado via Bun;
o processo do teste usa Node para compatibilidade com a comunicação do Playwright no Windows.
Em outros sistemas, instale o Chromium de teste com `bunx playwright install chromium`.
Defina `DOME_CAPTURA_SKINS` com um caminho PNG para salvar a renderização. Esse teste não substitui
a conferência do instalador no WebView2.

## Convenções

- Use Bun, nunca npm.
- Preserve nomes e mensagens em português quando coerente.
- Todo comando Tauri deve validar IDs, caminhos e URLs recebidos da interface.
- Operações de filesystem devem permanecer dentro da raiz do domínio correspondente.
- Respostas de APIs devem possuir tipos TypeScript explícitos.
