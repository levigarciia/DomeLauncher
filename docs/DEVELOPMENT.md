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

## Convenções

- Use Bun, nunca npm.
- Preserve nomes e mensagens em português quando coerente.
- Todo comando Tauri deve validar IDs, caminhos e URLs recebidos da interface.
- Operações de filesystem devem permanecer dentro da raiz do domínio correspondente.
- Respostas de APIs devem possuir tipos TypeScript explícitos.
