# Componentes da Instância

Este diretório contém os componentes adaptados do repositório `code-main` para gerenciamento de instâncias do launcher.

## Componentes Disponíveis

### Overview
Componente básico que exibe informações gerais da instância.

```tsx
import { Overview } from './pages/instance'

<Overview
  instance={gameInstance}
  options={contextMenuOptions}
  offline={false}
  playing={true}
  versions={[]}
  installed={true}
/>
```

### Mods
Componente para gerenciamento de mods da instância, incluindo instalação, atualização e remoção.

```tsx
import { Mods } from './pages/instance'

<Mods
  instance={gameInstance}
  options={contextMenuOptions}
  offline={false}
  playing={false}
  versions={versions}
  installed={true}
/>
```

### Logs
Componente para visualização e gerenciamento de logs da instância.

```tsx
import { Logs } from './pages/instance'

<Logs
  instance={gameInstance}
  options={contextMenuOptions}
  offline={false}
  playing={true}
  versions={[]}
  installed={true}
/>
```

### Worlds
Componente para gerenciamento de mundos e servidores.

```tsx
import { Worlds } from './pages/instance'

<Worlds
  instance={gameInstance}
  options={contextMenuOptions}
  offline={false}
  playing={false}
  versions={[]}
  installed={true}
/>
```

### ContextMenu
Menu de contexto reutilizável para ações nos componentes.

```tsx
import ContextMenu from './components/ui/ContextMenu'

<ContextMenu
  shown={showMenu}
  options={menuOptions}
  item={selectedItem}
  onMenuClosed={() => setShowMenu(false)}
  onOptionClicked={(data) => handleOptionClick(data)}
>
  {/* Conteúdo do menu */}
</ContextMenu>
```

## Interfaces

Todos os tipos estão definidos em `src/types.ts`. As principais interfaces incluem:

- `GameInstance`: Representa uma instância do jogo
- `ProjectListEntry`: Representa um mod/projeto na lista
- `World`: Representa um mundo ou servidor
- `LogEntry`: Representa uma entrada de log
- `MenuOption`: Opção do menu de contexto

## Notas de Adaptação

Estes componentes foram adaptados do Vue.js (do repositório code-main) para React/TypeScript. Algumas funcionalidades podem precisar de implementação adicional:

1. **Composables Vue**: Lógica de estado e hooks foram convertidos para hooks React
2. **Bibliotecas específicas**: Algumas bibliotecas específicas do Vue podem precisar de alternativas React
3. **APIs do Tauri**: Chamadas para APIs nativas podem precisar de ajustes
4. **Estilos**: Estilos SCSS foram convertidos para CSS inline ou podem ser extraídos

Para uso completo, pode ser necessário implementar:
- Hooks personalizados para gerenciamento de estado
- Serviços para comunicação com APIs
- Utilitários para processamento de dados
- Integração completa com o backend do launcher