// Tipos e interfaces compartilhados pelos componentes da instância

export interface GameInstance {
  id: string
  name: string
  path: string
  version?: string
  mc_type?: string
  loader_type?: string
  loader_version?: string
  loader?: string
  game_version?: string
  linked_data?: {
    locked?: boolean
    version_id?: string
  }
  install_stage?: string
  icon?: string
  last_played?: string
}

export interface ContextMenuType {
  showMenu?: (event: MouseEvent, item: any, options: MenuOption[]) => void
}

export type ContextMenuTypeOrNull = ContextMenuType | null

export interface MenuOption {
  name: string
  type?: 'divider'
  color?: 'base' | 'primary' | 'danger' | 'contrast'
}

export interface Version {
  id: string
  version_number?: string
  date_published?: string
}

export interface ProjectListEntry {
  path: string
  name: string
  slug?: string
  author: ProjectAuthor | null
  version: string | null
  file_name: string
  icon?: string
  disabled: boolean
  updateVersion?: string
  outdated: boolean
  updated: any
  project_type: string
  id?: string
  updating?: boolean
}

export interface ProjectAuthor {
  name: string
  slug: string
  type: 'user' | 'organization'
}

export interface World {
  type: 'singleplayer' | 'server'
  path?: string
  address?: string
  name: string
  index?: number
  locked?: boolean
}

export interface ServerData {
  status?: string
  refreshing?: boolean
  renderedMotd?: string
  ping?: number
}

export interface LogEntry {
  id: number
  text: string
  prefix?: string
  prefixColor?: string
  textColor?: string
  weight?: string
  level?: string
}