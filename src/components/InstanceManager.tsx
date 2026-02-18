import { useState, useEffect, useRef } from "react";
import {
  Play,
  Settings,
  ArrowLeft,
  Search,
  Plus,
  RefreshCw,
  Download,
  Trash2,
  MoreVertical,
  Globe,
  Clock,
  Package,
  Image,
  Sparkles,
  Loader2,
  ChevronLeft,
  X,
  FolderOpen,
  Copy,
  FileText,
  Calendar,
  HardDrive,
  Pencil,
  Save,
} from "../iconesPixelados";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "../lib/utils";

interface InstanceManagerProps {
  instanceId: string;
  onBack: () => void;
  onInstanceUpdate?: () => void;
}

interface InstanceDetails {
  id: string;
  name: string;
  version: string;
  mcType: string;
  loaderType?: string;
  loaderVersion?: string;
  icon?: string;
  lastPlayed?: string;
  path: string;
  created?: string;
  memory?: number;
  javaArgs?: string;
  mcArgs?: string;
  width?: number;
  height?: number;
}

interface InstalledMod {
  name: string;
  fileName: string;
  version: string;
  author: string;
  icon?: string;
  enabled: boolean;
  projectId?: string;
  source?: BrowseSource;
  projectType?: TipoProjetoCache;
  latestVersion?: string;
  updateAvailable?: boolean;
  updateFileName?: string;
  updateDownloadUrl?: string;
  updating?: boolean;
}

interface SearchResult {
  id: string;
  title: string;
  description: string;
  icon_url?: string;
  author: string;
  downloads?: number;
  slug: string;
  project_type: string;
  latest_version?: string;
  file_name?: string;
}

interface WorldInfo {
  name: string;
  path: string;
  gameMode: string;
  difficulty: string;
  lastPlayed: string;
  sizeOnDisk: string;
}

interface LogFile {
  filename: string;
  path: string;
  size: number;
  modified: string;
}

interface ConfiguracoesGlobais {
  close_on_launch?: boolean;
}

type ContentTab = "content" | "worlds" | "logs";
type ContentFilter = "mods" | "resourcepacks" | "shaders";
type ViewMode = "installed" | "browse";
type BrowseSource = "modrinth" | "curseforge";
type TipoProjetoCache = "mod" | "resourcepack" | "shader";

interface RegistroCacheConteudo {
  name: string;
  author: string;
  icon?: string;
  projectId?: string;
  source?: BrowseSource;
  projectType?: TipoProjetoCache;
  latestVersion?: string;
  updateAvailable?: boolean;
  updateFileName?: string;
  updateDownloadUrl?: string;
  atualizacaoVerificadaEm?: number;
  atualizadoEm: number;
}

type EstruturaCacheConteudo = Record<string, RegistroCacheConteudo>;

const CHAVE_CACHE_CONTEUDO_INSTALADO = "dome:cache-conteudo-instalado:v1";
const TTL_CACHE_CONTEUDO_MS = 1000 * 60 * 60 * 24 * 30;
const TTL_CACHE_ATUALIZACAO_MS = 1000 * 60 * 60 * 6;

const tipoProjetoPorFiltro = (filtro: ContentFilter): TipoProjetoCache => {
  if (filtro === "resourcepacks") return "resourcepack";
  if (filtro === "shaders") return "shader";
  return "mod";
};

const montarChaveCacheConteudo = (
  instanceId: string,
  tipoProjeto: TipoProjetoCache,
  fileName: string
) => `${instanceId}::${tipoProjeto}::${fileName.toLowerCase()}`;

const lerCacheConteudoInstalado = (): EstruturaCacheConteudo => {
  try {
    const bruto = localStorage.getItem(CHAVE_CACHE_CONTEUDO_INSTALADO);
    if (!bruto) return {};
    const json = JSON.parse(bruto);
    if (!json || typeof json !== "object") return {};
    return json as EstruturaCacheConteudo;
  } catch {
    return {};
  }
};

const salvarCacheConteudoInstalado = (cache: EstruturaCacheConteudo) => {
  try {
    localStorage.setItem(CHAVE_CACHE_CONTEUDO_INSTALADO, JSON.stringify(cache));
  } catch {
    // Ignorar erro de armazenamento
  }
};

const obterRegistroCacheConteudo = (
  cache: EstruturaCacheConteudo,
  instanceId: string,
  tipoProjeto: TipoProjetoCache,
  fileName: string
): RegistroCacheConteudo | null => {
  const chave = montarChaveCacheConteudo(instanceId, tipoProjeto, fileName);
  const registro = cache[chave];
  if (!registro) return null;
  if (Date.now() - registro.atualizadoEm > TTL_CACHE_CONTEUDO_MS) return null;
  return registro;
};

const definirRegistroCacheConteudo = (
  cache: EstruturaCacheConteudo,
  instanceId: string,
  tipoProjeto: TipoProjetoCache,
  fileName: string,
  registro: Omit<RegistroCacheConteudo, "atualizadoEm">
) => {
  const chave = montarChaveCacheConteudo(instanceId, tipoProjeto, fileName);
  cache[chave] = {
    ...registro,
    atualizadoEm: Date.now(),
  };
};

const removerRegistroCacheConteudo = (
  cache: EstruturaCacheConteudo,
  instanceId: string,
  tipoProjeto: TipoProjetoCache,
  fileName: string
) => {
  const chave = montarChaveCacheConteudo(instanceId, tipoProjeto, fileName);
  delete cache[chave];
};

const removerCacheInstanciaInteira = (
  cache: EstruturaCacheConteudo,
  instanceId: string
) => {
  const prefixo = `${instanceId}::`;
  for (const chave of Object.keys(cache)) {
    if (chave.startsWith(prefixo)) {
      delete cache[chave];
    }
  }
};

const limparCacheOrfaoPorTipo = (
  cache: EstruturaCacheConteudo,
  instanceId: string,
  tipoProjeto: TipoProjetoCache,
  arquivosAtuais: string[]
) => {
  const prefixo = `${instanceId}::${tipoProjeto}::`;
  const arquivos = new Set(arquivosAtuais.map((a) => a.toLowerCase()));
  for (const chave of Object.keys(cache)) {
    if (!chave.startsWith(prefixo)) continue;
    const arquivo = chave.slice(prefixo.length);
    if (!arquivos.has(arquivo)) {
      delete cache[chave];
    }
  }
};

export default function InstanceManager({
  instanceId,
  onBack,
  onInstanceUpdate,
}: InstanceManagerProps) {
  const [instanceDetails, setInstanceDetails] = useState<InstanceDetails | null>(null);
  const [activeTab, setActiveTab] = useState<ContentTab>("content");
  const [activeFilter, setActiveFilter] = useState<ContentFilter>("mods");
  const [viewMode, setViewMode] = useState<ViewMode>("installed");
  const [browseSource, setBrowseSource] = useState<BrowseSource>("modrinth");
  const [searchQuery, setSearchQuery] = useState("");
  const [installedMods, setInstalledMods] = useState<InstalledMod[]>([]);
  const [installedResourcePacks, setInstalledResourcePacks] = useState<InstalledMod[]>([]);
  const [installedShaders, setInstalledShaders] = useState<InstalledMod[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [logs, setLogs] = useState<LogFile[]>([]);
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [logContent, setLogContent] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [installedModFileNames, setInstalledModFileNames] = useState<Set<string>>(new Set());
  const [updatingAll, setUpdatingAll] = useState(false);
  
  // Estados para edição
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editFolderName, setEditFolderName] = useState("");
  const [editMemory, setEditMemory] = useState("");
  const [editJavaArgs, setEditJavaArgs] = useState("");
  const [editWidth, setEditWidth] = useState("");
  const [editHeight, setEditHeight] = useState("");
  const [saving, setSaving] = useState(false);

  const itemsPerPage = 10;
  const lastSearch = useRef({ query: "", filter: "", source: "" });

  useEffect(() => {
    loadInstanceDetails();
    loadInstalledContent("mods");
  }, [instanceId]);

  useEffect(() => {
    if (activeTab === "worlds") loadWorlds();
    if (activeTab === "logs") loadLogs();
  }, [activeTab]);

  // Carregar conteúdo quando mudar o filtro
  useEffect(() => {
    if (activeTab === "content" && viewMode === "installed") {
      loadInstalledContent(activeFilter);
    }
  }, [activeFilter, activeTab, viewMode]);

  // Verificar se instância é vanilla (não mostrar mods/shaders)
  // Corrigido: usar loaderType (camelCase) que vem do backend
  const isVanilla = !instanceDetails?.loaderType || 
                    instanceDetails?.loaderType === "Vanilla" ||
                    instanceDetails?.loaderType === "vanilla";

  // Buscar quando mudar para browse mode ou filtro
  useEffect(() => {
    if (viewMode === "browse") {
      searchContent(searchQuery);
    }
  }, [viewMode, activeFilter, browseSource]);

  // Debounce na busca
  useEffect(() => {
    if (viewMode !== "browse") return;
    if (lastSearch.current.query === searchQuery &&
        lastSearch.current.filter === activeFilter &&
        lastSearch.current.source === browseSource) return;
    
    const timer = setTimeout(() => {
      searchContent(searchQuery);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, viewMode]);

  const loadInstanceDetails = async () => {
    try {
      const details: InstanceDetails = await invoke("get_instance_details", { instanceId });
      setInstanceDetails(details);
      // Preencher campos de edição
      setEditName(details.name);
      setEditFolderName(details.id);
      setEditMemory(details.memory?.toString() || "4096");
      setEditJavaArgs(details.javaArgs || "");
      setEditWidth(details.width?.toString() || "854");
      setEditHeight(details.height?.toString() || "480");
    } catch (error) {
      console.error("Erro ao carregar detalhes:", error);
    }
  };

  // Função genérica para carregar conteúdo instalado (mods, resourcepacks, shaders)
  const loadInstalledContent = async (contentType: ContentFilter) => {
    setLoading(true);
    try {
      // Determinar pasta e comando baseado no tipo
      let files: string[] = [];
      
      if (contentType === "mods") {
        files = await invoke("get_installed_mods", { instanceId });
      } else if (contentType === "resourcepacks") {
        files = await invoke("get_installed_resourcepacks", { instanceId });
      } else if (contentType === "shaders") {
        files = await invoke("get_installed_shaders", { instanceId });
      }

      const tipoProjeto = tipoProjetoPorFiltro(contentType);
      const cacheConteudo = lerCacheConteudoInstalado();
      limparCacheOrfaoPorTipo(cacheConteudo, instanceId, tipoProjeto, files);
      salvarCacheConteudoInstalado(cacheConteudo);
      
      // Formatar lista
      const formattedContent: InstalledMod[] = files.map((fileName) => {
        const registro = obterRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjeto, fileName);
        const atualizacaoCacheValida = Boolean(
          registro?.atualizacaoVerificadaEm &&
            Date.now() - registro.atualizacaoVerificadaEm <= TTL_CACHE_ATUALIZACAO_MS
        );

        return {
          name:
            registro?.name ||
            fileName
              .replace(".jar", "")
              .replace(".zip", "")
              .replace(".disabled", "")
              .replace(/[-_]/g, " "),
          fileName,
          version: extractVersion(fileName),
          author: registro?.author || "Unknown",
          icon: registro?.icon,
          projectId: registro?.projectId,
          source: registro?.source,
          projectType: registro?.projectType || tipoProjeto,
          latestVersion: registro?.latestVersion,
          updateAvailable: atualizacaoCacheValida ? registro?.updateAvailable : false,
          updateFileName: atualizacaoCacheValida ? registro?.updateFileName : undefined,
          updateDownloadUrl: atualizacaoCacheValida ? registro?.updateDownloadUrl : undefined,
          enabled: !fileName.endsWith(".disabled"),
        };
      });
      
      // Atualizar estado correto baseado no tipo
      if (contentType === "mods") {
        setInstalledMods(formattedContent);
        setInstalledModFileNames(new Set(files.map(f => f.toLowerCase())));
        // Enriquecer os que estão sem metadata (em background)
        enrichModsWithModrinthData(formattedContent, "mod");
      } else if (contentType === "resourcepacks") {
        setInstalledResourcePacks(formattedContent);
        enrichModsWithModrinthData(formattedContent, "resourcepack");
      } else if (contentType === "shaders") {
        setInstalledShaders(formattedContent);
        enrichModsWithModrinthData(formattedContent, "shader");
      }
    } catch (error) {
      console.error(`Erro ao carregar ${contentType}:`, error);
    } finally {
      setLoading(false);
    }
  };

  const normalizarChaveProjeto = (valor: string): string =>
    valor
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

  const compactarChaveProjeto = (valor: string): string =>
    normalizarChaveProjeto(valor).replace(/-/g, "");

  const gerarConsultasArquivo = (fileName: string): string[] => {
    const base = fileName
      .replace(/\.disabled$/i, "")
      .replace(/\.(jar|zip)$/i, "");

    const consultas = new Set<string>();
    const adicionarConsulta = (valor: string) => {
      const normalizada = normalizarChaveProjeto(valor);
      if (normalizada.length >= 3) {
        consultas.add(normalizada);
      }
    };

    adicionarConsulta(base);

    let limpa = base.toLowerCase();
    limpa = limpa
      .replace(/[_+.-](fabric|forge|neoforge|quilt)(?=[_+.-]|$)/gi, "-")
      .replace(/[_+.-](client|server|universal|all)(?=[_+.-]|$)/gi, "-")
      .replace(/[_+.-]?mc[_+.-]?\d[\w.+-]*/gi, "")
      .replace(/[_+.-]?v?\d+(?:\.\d+){1,4}(?:[_+.-]?[a-z0-9-]+)*$/gi, "");

    adicionarConsulta(limpa);

    const primeiraParte = limpa.split(/[_+.-]/).filter(Boolean)[0];
    if (primeiraParte && primeiraParte.length >= 4) {
      adicionarConsulta(primeiraParte);
    }

    return Array.from(consultas);
  };

  const pontuarHitProjeto = (consulta: string, hit: any): number => {
    const slug = normalizarChaveProjeto(String(hit?.slug || ""));
    const titulo = normalizarChaveProjeto(String(hit?.title || ""));
    const consultaCompacta = compactarChaveProjeto(consulta);
    const slugCompacto = compactarChaveProjeto(slug);
    const tituloCompacto = compactarChaveProjeto(titulo);
    const tokens = consulta.split("-").filter((t) => t.length >= 2);

    if (!slug && !titulo) return 0;
    if (slug === consulta) return 100;
    if (titulo === consulta) return 95;
    if (slugCompacto === consultaCompacta) return 92;
    if (tituloCompacto === consultaCompacta) return 90;
    if (slug.startsWith(`${consulta}-`)) return 84;
    if (titulo.startsWith(`${consulta}-`)) return 80;

    if (tokens.length >= 2) {
      const matchSlug = tokens.filter((token) => slug.includes(token)).length;
      const matchTitulo = tokens.filter((token) => titulo.includes(token)).length;
      const cobertura = Math.max(matchSlug, matchTitulo) / tokens.length;
      if (cobertura >= 1) return 74;
      if (cobertura >= 0.75) return 62;
    }

    if (tokens.length === 1 && tokens[0].length >= 5) {
      const token = tokens[0];
      if (slug.includes(token) || titulo.includes(token)) return 45;
    }

    return 0;
  };

  const escolherMelhorHitProjeto = (consultas: string[], hits: any[]): any | null => {
    let melhorHit: any | null = null;
    let melhorScore = 0;
    let consultaEscolhida = "";

    for (const consulta of consultas) {
      for (const hit of hits) {
        const score = pontuarHitProjeto(consulta, hit);
        if (score > melhorScore) {
          melhorScore = score;
          melhorHit = hit;
          consultaEscolhida = consulta;
        }
      }
    }

    if (!melhorHit) return null;

    const tokensConsulta = consultaEscolhida.split("-").filter((token) => token.length >= 2);
    const scoreMinimo = tokensConsulta.length <= 1 ? 90 : 62;
    return melhorScore >= scoreMinimo ? melhorHit : null;
  };

  // Buscar informações do Modrinth para conteúdo instalado
  const enrichModsWithModrinthData = async (
    items: InstalledMod[],
    projectType: string = "mod"
  ) => {
    const enrichedItems = [...items];
    const tipoProjeto = (projectType === "resourcepack" || projectType === "shader"
      ? projectType
      : "mod") as TipoProjetoCache;
    const cacheConteudo = lerCacheConteudoInstalado();
    let cacheAlterado = false;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.author !== "Unknown" && item.projectId) continue;

      try {
        const consultas = gerarConsultasArquivo(item.fileName).slice(0, 2);
        if (consultas.length === 0) continue;

        const hitsUnicos = new Map<string, any>();
        for (const consulta of consultas) {
          const variacoesConsulta = Array.from(
            new Set(
              [
                consulta,
                consulta.replace(/-/g, " "),
                consulta.replace(/-/g, "+"),
              ].filter((q) => q.trim().length > 0)
            )
          );

          for (const termoBusca of variacoesConsulta) {
            const resultadosBusca: any[] = await invoke("search_mods_online", {
              query: termoBusca,
              contentType: projectType,
            });

            for (const resultado of resultadosBusca) {
              const id = String(resultado?.id || "");
              const slug = String(resultado?.slug || "");
              const title = String(resultado?.name || resultado?.title || "");
              const chave = [id, slug, title].join("|");
              if (!chave.replace(/\|/g, "").trim()) continue;
              if (!hitsUnicos.has(chave)) {
                hitsUnicos.set(chave, {
                  project_id: id,
                  slug,
                  title,
                  author: String(resultado?.author || "Unknown"),
                  icon_url: resultado?.iconUrl || resultado?.icon_url,
                  source: String(resultado?.platform || "modrinth"),
                  latest_version: resultado?.latestVersion || resultado?.latest_version,
                });
              }
            }
          }
        }

        const bestMatch = escolherMelhorHitProjeto(consultas, Array.from(hitsUnicos.values()));
        if (bestMatch) {
          enrichedItems[i] = {
            ...item,
            name: String(bestMatch.title || item.name),
            author: String(bestMatch.author || "Unknown"),
            icon: bestMatch.icon_url,
            projectId: bestMatch.project_id,
            source: bestMatch.source === "curseforge" ? "curseforge" : "modrinth",
            projectType: tipoProjeto,
            latestVersion: bestMatch.latest_version,
            updateAvailable:
              Boolean(bestMatch.latest_version) &&
              extractVersion(item.fileName) !== String(bestMatch.latest_version),
          };

          definirRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjeto, item.fileName, {
            name: enrichedItems[i].name,
            author: enrichedItems[i].author,
            icon: enrichedItems[i].icon,
            projectId: enrichedItems[i].projectId,
            source: enrichedItems[i].source,
            projectType: tipoProjeto,
            latestVersion: enrichedItems[i].latestVersion,
            updateAvailable: enrichedItems[i].updateAvailable,
          });
          cacheAlterado = true;
        }
      } catch (e) {
        // Ignorar erros de busca individual
        console.warn(`Falha ao buscar info para ${item.fileName}:`, e);
      }
    }

    if (cacheAlterado) {
      salvarCacheConteudoInstalado(cacheConteudo);
    }

    // Atualizar o estado correto baseado no tipo
    if (projectType === "mod") {
      setInstalledMods(enrichedItems);
    } else if (projectType === "resourcepack") {
      setInstalledResourcePacks(enrichedItems);
    } else if (projectType === "shader") {
      setInstalledShaders(enrichedItems);
    }

    verificarAtualizacoesConteudo(enrichedItems, tipoProjeto);
  };

  const atualizarListaPorTipo = (
    tipoProjeto: TipoProjetoCache,
    atualizador: (lista: InstalledMod[]) => InstalledMod[]
  ) => {
    if (tipoProjeto === "mod") {
      setInstalledMods((prev) => atualizador(prev));
    } else if (tipoProjeto === "resourcepack") {
      setInstalledResourcePacks((prev) => atualizador(prev));
    } else {
      setInstalledShaders((prev) => atualizador(prev));
    }
  };

  const verificarAtualizacoesConteudo = async (
    itens: InstalledMod[],
    tipoProjeto: TipoProjetoCache
  ) => {
    if (!instanceDetails) return;

    const cacheConteudo = lerCacheConteudoInstalado();
    let cacheAlterado = false;
    const itensAtualizados = [...itens];

    for (let i = 0; i < itensAtualizados.length; i++) {
      const item = itensAtualizados[i];
      if (!item.projectId) continue;

      const registroCache = obterRegistroCacheConteudo(
        cacheConteudo,
        instanceId,
        tipoProjeto,
        item.fileName
      );
      const cacheAtualizacaoValido = Boolean(
        registroCache?.atualizacaoVerificadaEm &&
          Date.now() - registroCache.atualizacaoVerificadaEm <= TTL_CACHE_ATUALIZACAO_MS
      );

      if (cacheAtualizacaoValido) {
        itensAtualizados[i] = {
          ...item,
          updateAvailable: registroCache?.updateAvailable || false,
          latestVersion: registroCache?.latestVersion || item.latestVersion,
          updateFileName: registroCache?.updateFileName,
          updateDownloadUrl: registroCache?.updateDownloadUrl,
        };
        continue;
      }

      // CurseForge: sem endpoint leve de "update id", manter apenas botão manual de atualizar.
      if (item.source === "curseforge") {
        definirRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjeto, item.fileName, {
          name: item.name,
          author: item.author,
          icon: item.icon,
          projectId: item.projectId,
          source: "curseforge",
          projectType: tipoProjeto,
          latestVersion: item.latestVersion,
          updateAvailable: false,
          updateFileName: undefined,
          updateDownloadUrl: undefined,
          atualizacaoVerificadaEm: Date.now(),
        });
        cacheAlterado = true;
        continue;
      }

      try {
        const params = new URLSearchParams();
        params.set("game_versions", JSON.stringify([instanceDetails.version]));
        if (tipoProjeto === "mod") {
          const loaderAtual = (instanceDetails.loaderType || "").toLowerCase();
          if (["fabric", "forge", "quilt", "neoforge"].includes(loaderAtual)) {
            params.set("loaders", JSON.stringify([loaderAtual]));
          }
        }

        const resposta = await fetch(
          `https://api.modrinth.com/v2/project/${item.projectId}/version?${params.toString()}`
        );
        if (!resposta.ok) continue;
        const versoes = await resposta.json();
        if (!Array.isArray(versoes) || versoes.length === 0) continue;

        const versaoAlvo = versoes[0];
        const arquivoAlvo =
          versaoAlvo?.files?.find((f: any) => f?.primary) || versaoAlvo?.files?.[0];
        if (!arquivoAlvo?.filename || !arquivoAlvo?.url) continue;

        const updateDisponivel =
          String(arquivoAlvo.filename).toLowerCase() !== item.fileName.toLowerCase();

        const latestVersion =
          String(versaoAlvo?.version_number || "") || item.latestVersion || undefined;

        itensAtualizados[i] = {
          ...item,
          latestVersion,
          updateAvailable: updateDisponivel,
          updateFileName: updateDisponivel ? String(arquivoAlvo.filename) : undefined,
          updateDownloadUrl: updateDisponivel ? String(arquivoAlvo.url) : undefined,
        };

        definirRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjeto, item.fileName, {
          name: itensAtualizados[i].name,
          author: itensAtualizados[i].author,
          icon: itensAtualizados[i].icon,
          projectId: itensAtualizados[i].projectId,
          source: "modrinth",
          projectType: tipoProjeto,
          latestVersion: itensAtualizados[i].latestVersion,
          updateAvailable: itensAtualizados[i].updateAvailable,
          updateFileName: itensAtualizados[i].updateFileName,
          updateDownloadUrl: itensAtualizados[i].updateDownloadUrl,
          atualizacaoVerificadaEm: Date.now(),
        });
        cacheAlterado = true;
      } catch (erro) {
        console.warn(`Falha ao verificar atualização para ${item.fileName}:`, erro);
      }
    }

    if (cacheAlterado) {
      salvarCacheConteudoInstalado(cacheConteudo);
    }

    if (tipoProjeto === "mod") {
      setInstalledMods(itensAtualizados);
    } else if (tipoProjeto === "resourcepack") {
      setInstalledResourcePacks(itensAtualizados);
    } else {
      setInstalledShaders(itensAtualizados);
    }
  };

  const loadWorlds = async () => {
    try {
      const worldList: WorldInfo[] = await invoke("get_worlds", { instanceId });
      setWorlds(worldList);
    } catch (error) {
      console.error("Erro ao carregar mundos:", error);
      setWorlds([]);
    }
  };

  const loadLogs = async () => {
    try {
      const logList: LogFile[] = await invoke("get_log_files", { instanceId });
      setLogs(logList);
    } catch (error) {
      console.error("Erro ao carregar logs:", error);
      setLogs([]);
    }
  };

  const viewLog = async (filePath: string) => {
    try {
      const content: string = await invoke("get_log_content", { instanceId, filePath });
      setLogContent(content);
      setSelectedLog(filePath);
    } catch (error) {
      console.error("Erro ao ler log:", error);
    }
  };

  const extractVersion = (fileName: string): string => {
    const match = fileName.match(/[\d]+\.[\d]+\.?[\d]*/);
    return match ? match[0] : "";
  };

  const searchContent = async (query: string) => {
    lastSearch.current = { query, filter: activeFilter, source: browseSource };
    setSearching(true);
    try {
      const typeMap: Record<ContentFilter, string> = {
        mods: "mod",
        resourcepacks: "resourcepack",
        shaders: "shader",
      };
      const plataforma = browseSource === "curseforge" ? "curseforge" : "modrinth";
      const tipoConteudo = typeMap[activeFilter];

      const resultados: any[] = await invoke("search_mods_online", {
        query,
        platform: plataforma,
        contentType: tipoConteudo,
      });

      setSearchResults(
        resultados.map((item: any) => ({
          id: String(item.id || ""),
          title: String(item.name || item.title || "Sem nome"),
          description: String(item.description || ""),
          icon_url: item.iconUrl || item.icon_url || undefined,
          author: String(item.author || "Desconhecido"),
          downloads:
            typeof item.downloadCount === "number"
              ? item.downloadCount
              : typeof item.download_count === "number"
                ? item.download_count
                : undefined,
          slug:
            String(item.slug || "").trim() ||
            String(item.id || "").trim(),
          project_type: String(item.projectType || item.project_type || tipoConteudo),
          latest_version: item.latestVersion || item.latest_version || undefined,
          file_name: item.fileName || item.file_name || undefined,
        }))
      );
    } catch (error) {
      console.error("Erro ao buscar:", error);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const installContent = async (item: SearchResult) => {
    if (!instanceDetails) return;
    setInstalling(item.id);

    try {
      const typeMap: Record<ContentFilter, string> = {
        mods: "mod",
        resourcepacks: "resourcepack",
        shaders: "shader",
      };
      const tipoProjeto = typeMap[activeFilter];

      if (browseSource === "curseforge") {
        if (tipoProjeto === "mod") {
          await invoke("install_mod", {
            instanceId,
            modInfo: {
              id: item.id,
              name: item.title,
              description: item.description,
              author: item.author,
              version: item.latest_version || "latest",
              download_url: "",
              file_name: item.file_name || "",
              platform: "curseforge",
              dependencies: [],
            },
          });
        } else {
          await invoke("install_curseforge_project_file", {
            instanceId,
            projectType: tipoProjeto,
            projectId: item.id,
          });
        }

        const cacheConteudo = lerCacheConteudoInstalado();
        const tipoProjetoCache = tipoProjeto as TipoProjetoCache;
        const nomeArquivoCache = item.file_name || item.slug || item.id;
        definirRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjetoCache, nomeArquivoCache, {
          name: item.title,
          author: item.author,
          icon: item.icon_url,
          projectId: item.id,
          source: "curseforge",
          projectType: tipoProjetoCache,
          latestVersion: item.latest_version,
          updateAvailable: false,
        });
        salvarCacheConteudoInstalado(cacheConteudo);

        await loadInstalledContent(activeFilter);
        setViewMode("installed");
        return;
      }

      // Determinar o loader correto para filtrar versões
      const loaderType = instanceDetails.loaderType?.toLowerCase() || "";
      const loadersSuportados = ["fabric", "forge", "quilt", "neoforge"];
      const params = new URLSearchParams();
      params.set("game_versions", JSON.stringify([instanceDetails.version]));
      if (activeFilter === "mods" && loadersSuportados.includes(loaderType)) {
        params.set("loaders", JSON.stringify([loaderType]));
      }
      
      // Buscar versões compatíveis com versão do MC E loader
      const versionsRes = await fetch(
        `https://api.modrinth.com/v2/project/${item.id}/version?${params.toString()}`
      );
      const versions = await versionsRes.json();

      if (versions.length === 0) {
        const alvoCompat = loaderType ? `${loaderType} ${instanceDetails.version}` : instanceDetails.version;
        alert(`Nenhuma versão compatível com ${alvoCompat}`);
        setInstalling(null);
        return;
      }

      const version = versions[0];
      const file = version.files.find((f: any) => f.primary) || version.files[0];

      if (!file) {
        alert("Arquivo não encontrado");
        setInstalling(null);
        return;
      }

      if (tipoProjeto === "mod") {
        await invoke("install_mod", {
          instanceId,
          modInfo: {
            id: item.id,
            name: item.title,
            description: item.description,
            author: item.author,
            version: version.version_number,
            download_url: file.url,
            file_name: file.filename,
            platform: "modrinth",
            dependencies: [],
          },
        });
      } else {
        await invoke("install_project_file", {
          instanceId,
          projectType: tipoProjeto,
          downloadUrl: file.url,
          fileName: file.filename,
        });
      }

      const cacheConteudo = lerCacheConteudoInstalado();
      const tipoProjetoCache = tipoProjeto as TipoProjetoCache;
      const nomeArquivoCache = file.filename || item.file_name || item.slug || item.id;
      definirRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjetoCache, nomeArquivoCache, {
        name: item.title,
        author: item.author,
        icon: item.icon_url,
        projectId: item.id,
        source: "modrinth",
        projectType: tipoProjetoCache,
        latestVersion: version.version_number,
        updateAvailable: false,
        updateFileName: undefined,
        updateDownloadUrl: undefined,
        atualizacaoVerificadaEm: Date.now(),
      });
      salvarCacheConteudoInstalado(cacheConteudo);

      await loadInstalledContent(activeFilter);
      setViewMode("installed");
    } catch (error) {
      console.error("Erro ao instalar:", error);
      alert(`Erro: ${error}`);
    } finally {
      setInstalling(null);
    }
  };

  const toggleMod = async (mod: InstalledMod) => {
    const tipoProjeto = tipoProjetoPorFiltro(activeFilter);
    atualizarListaPorTipo(tipoProjeto, (prev) =>
      prev.map((m) => (m.fileName === mod.fileName ? { ...m, enabled: !m.enabled } : m))
    );
  };

  const removerConteudoInstalado = async (mod: InstalledMod, filtro: ContentFilter) => {
    const tipoProjeto = tipoProjetoPorFiltro(filtro);
    try {
      await invoke("remove_project_file", {
        instanceId,
        projectType: tipoProjeto,
        fileName: mod.fileName,
      });
      atualizarListaPorTipo(tipoProjeto, (prev) =>
        prev.filter((m) => m.fileName !== mod.fileName)
      );

      const cacheConteudo = lerCacheConteudoInstalado();
      removerRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjeto, mod.fileName);
      salvarCacheConteudoInstalado(cacheConteudo);
    } catch (error) {
      console.error("Erro ao remover:", error);
    }
  };

  const deleteMod = async (mod: InstalledMod) => {
    if (!confirm(`Remover "${mod.name}"?`)) return;
    await removerConteudoInstalado(mod, activeFilter);
  };

  const atualizarItemInstalado = async (item: InstalledMod, filtro: ContentFilter) => {
    const tipoProjeto = tipoProjetoPorFiltro(filtro);
    if (!item.projectId) return;
    if (item.updating) return;

    atualizarListaPorTipo(tipoProjeto, (prev) =>
      prev.map((m) => (m.fileName === item.fileName ? { ...m, updating: true } : m))
    );

    try {
      if (item.source === "curseforge") {
        if (tipoProjeto === "mod") {
          await invoke("install_mod", {
            instanceId,
            modInfo: {
              id: item.projectId,
              name: item.name,
              description: "",
              author: item.author,
              version: item.latestVersion || "latest",
              download_url: "",
              file_name: "",
              platform: "curseforge",
              dependencies: [],
            },
          });
        } else {
          await invoke("install_curseforge_project_file", {
            instanceId,
            projectType: tipoProjeto,
            projectId: item.projectId,
          });
        }
      } else {
        let downloadUrl = item.updateDownloadUrl;
        let fileName = item.updateFileName;
        let latestVersion = item.latestVersion;

        if (!downloadUrl || !fileName) {
          const params = new URLSearchParams();
          params.set("game_versions", JSON.stringify([instanceDetails?.version || ""]));
          if (tipoProjeto === "mod") {
            const loaderAtual = (instanceDetails?.loaderType || "").toLowerCase();
            if (["fabric", "forge", "quilt", "neoforge"].includes(loaderAtual)) {
              params.set("loaders", JSON.stringify([loaderAtual]));
            }
          }

          const resposta = await fetch(
            `https://api.modrinth.com/v2/project/${item.projectId}/version?${params.toString()}`
          );
          const versoes = await resposta.json();
          const versaoAlvo = Array.isArray(versoes) ? versoes[0] : null;
          const arquivoAlvo =
            versaoAlvo?.files?.find((f: any) => f?.primary) || versaoAlvo?.files?.[0];
          if (!arquivoAlvo?.url || !arquivoAlvo?.filename) {
            throw new Error("Nenhuma atualização compatível encontrada.");
          }
          downloadUrl = String(arquivoAlvo.url);
          fileName = String(arquivoAlvo.filename);
          latestVersion = String(versaoAlvo?.version_number || latestVersion || "");
        }

        if (tipoProjeto === "mod") {
          await invoke("install_mod", {
            instanceId,
            modInfo: {
              id: item.projectId,
              name: item.name,
              description: "",
              author: item.author,
              version: latestVersion || item.version || "latest",
              download_url: downloadUrl,
              file_name: fileName,
              platform: "modrinth",
              dependencies: [],
            },
          });
        } else {
          await invoke("install_project_file", {
            instanceId,
            projectType: tipoProjeto,
            downloadUrl,
            fileName,
          });
        }
      }

      if (item.updateFileName && item.updateFileName !== item.fileName) {
        await removerConteudoInstalado(item, filtro);
      }

      await loadInstalledContent(filtro);
    } catch (error) {
      console.error("Erro ao atualizar conteúdo:", error);
      alert(`Erro ao atualizar "${item.name}": ${error}`);
      atualizarListaPorTipo(tipoProjeto, (prev) =>
        prev.map((m) => (m.fileName === item.fileName ? { ...m, updating: false } : m))
      );
    }
  };

  const atualizarTodosConteudos = async () => {
    if (updatingAll) return;

    const tipoProjeto = tipoProjetoPorFiltro(activeFilter);
    const listaAtual =
      tipoProjeto === "mod"
        ? installedMods
        : tipoProjeto === "resourcepack"
          ? installedResourcePacks
          : installedShaders;
    const pendentes = listaAtual.filter((item) => item.updateAvailable);
    if (pendentes.length === 0) return;

    setUpdatingAll(true);
    try {
      for (const item of pendentes) {
        await atualizarItemInstalado(item, activeFilter);
      }
    } finally {
      setUpdatingAll(false);
    }
  };

  const deleteWorld = async (world: WorldInfo) => {
    if (!confirm(`Deletar mundo "${world.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await invoke("delete_world", { instanceId, worldPath: world.path });
      await loadWorlds();
    } catch (error) {
      console.error("Erro ao deletar mundo:", error);
    }
  };

  const launchInstance = async () => {
    try {
      await invoke("launch_instance", { id: instanceId });

      try {
        const configuracoes = await invoke<ConfiguracoesGlobais>("get_settings");
        if (configuracoes?.close_on_launch) {
          await getCurrentWindow().minimize();
        }
      } catch (erroConfig) {
        console.warn("Falha ao aplicar close_on_launch:", erroConfig);
      }
    } catch (error) {
      console.error("Erro ao iniciar:", error);
      alert(`Erro: ${error}`);
    }
  };

  const saveInstanceSettings = async () => {
    if (!instanceDetails) return;
    setSaving(true);
    try {
      let idAtual = instanceId;

      if (editFolderName.trim() && editFolderName !== instanceDetails.id) {
        idAtual = await invoke<string>("rename_instance_folder", {
          instanceId,
          newFolderName: editFolderName,
        });
      }

      // Atualizar nome se mudou
      if (editName !== instanceDetails.name) {
        await invoke("update_instance_name", {
          instanceId: idAtual,
          newName: editName,
        });
      }

      const memoria = Number.parseInt(editMemory, 10);
      const largura = Number.parseInt(editWidth, 10);
      const altura = Number.parseInt(editHeight, 10);

      await invoke("update_instance_settings", {
        instanceId: idAtual,
        memory: Number.isFinite(memoria) ? memoria : undefined,
        javaArgs: editJavaArgs,
        mcArgs: instanceDetails.mcArgs,
        width: Number.isFinite(largura) ? largura : undefined,
        height: Number.isFinite(altura) ? altura : undefined,
      });

      // Se o ID mudou, voltar para a biblioteca para recarregar com a nova rota
      if (idAtual !== instanceId) {
        onInstanceUpdate?.();
        onBack();
        return;
      }

      await loadInstanceDetails();
      setIsEditing(false);
      onInstanceUpdate?.();
    } catch (error) {
      console.error("Erro ao salvar:", error);
      alert(`Erro ao salvar: ${error}`);
    } finally {
      setSaving(false);
    }
  };

  const openInstanceFolder = async () => {
    if (instanceDetails?.path) {
      try {
        const urlArquivo = `file:///${instanceDetails.path.replace(/\\/g, "/")}`;
        await invoke("open_browser", { url: urlArquivo });
      } catch {
        navigator.clipboard.writeText(instanceDetails.path);
        alert("Caminho copiado para a área de transferência");
      }
    }
    setShowMoreMenu(false);
  };

  const copyPath = () => {
    if (instanceDetails?.path) {
      navigator.clipboard.writeText(instanceDetails.path);
    }
    setShowMoreMenu(false);
  };

  const deleteInstance = async () => {
    if (!confirm(`Excluir instância "${instanceDetails?.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await invoke("delete_instance", { id: instanceId });

      const cacheConteudo = lerCacheConteudoInstalado();
      removerCacheInstanciaInteira(cacheConteudo, instanceId);
      salvarCacheConteudoInstalado(cacheConteudo);

      onBack();
      onInstanceUpdate?.();
    } catch (error) {
      console.error("Erro ao excluir:", error);
      alert(`Erro: ${error}`);
    }
  };

  const abrirPastaMundo = async (worldPath: string) => {
    try {
      const urlArquivo = `file:///${worldPath.replace(/\\/g, "/")}`;
      await invoke("open_browser", { url: urlArquivo });
    } catch (error) {
      console.error("Erro ao abrir pasta do mundo:", error);
    }
  };

  // Obter conteúdo baseado no filtro ativo
  const currentContent = 
    activeFilter === "mods" ? installedMods :
    activeFilter === "resourcepacks" ? installedResourcePacks :
    installedShaders;

  // Filtrar conteúdo instalado
  const filteredContent = currentContent.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Paginação
  const totalPages = Math.ceil(filteredContent.length / itemsPerPage);
  const paginatedContent = filteredContent.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  const quantidadeAtualizaveis = filteredContent.filter((item) => item.updateAvailable).length;
  const mostrarControlesAtualizacao = quantidadeAtualizaveis > 0 || updatingAll;

  // Filtros disponíveis baseado no tipo de instância
  const availableFilters: ContentFilter[] = isVanilla 
    ? ["resourcepacks"] 
    : ["mods", "resourcepacks", "shaders"];

  // Ajustar filtro se necessário
  useEffect(() => {
    if (isVanilla && activeFilter !== "resourcepacks") {
      setActiveFilter("resourcepacks");
    }
  }, [isVanilla]);

  if (!instanceDetails) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-emerald-500" size={32} />
      </div>
    );
  }

  const filterIcons: Record<ContentFilter, any> = {
    mods: Package,
    resourcepacks: Image,
    shaders: Sparkles,
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0d0e]">
      {/* Header */}
      <div className="bg-[#121214] border-b border-white/5 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors text-white/60 hover:text-white"
            >
              <ArrowLeft size={20} />
            </button>

            {/* Ícone editável */}
            <div className="relative group">
              <div className="w-14 h-14 rounded-xl bg-[#1a1a1c] border border-white/10 overflow-hidden flex items-center justify-center">
                {instanceDetails.icon ? (
                  <img src={instanceDetails.icon} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Package size={24} className="text-white/40" />
                )}
              </div>
              {isEditing && (
                <button className="absolute inset-0 bg-black/60 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Pencil size={16} className="text-white" />
                </button>
              )}
            </div>

            <div>
              {isEditing ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="text-xl font-bold text-white bg-white/5 border border-white/20 rounded-lg px-3 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <input
                    type="text"
                    value={editFolderName}
                    onChange={(e) => setEditFolderName(e.target.value)}
                    className="text-xs text-white/80 bg-white/5 border border-white/15 rounded-lg px-3 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="nome_da_pasta"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-white">{instanceDetails.name}</h1>
                  <button 
                    onClick={() => setIsEditing(true)}
                    className="p-1 rounded hover:bg-white/10 text-white/30 hover:text-white transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-3 text-sm text-white/50">
                <span className="flex items-center gap-1">
                  <Globe size={14} />
                  {instanceDetails.loaderType || "Vanilla"} {instanceDetails.version}
                </span>
                <span className="flex items-center gap-1">
                  <Clock size={14} />
                  {instanceDetails.lastPlayed || "Nunca jogado"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveInstanceSettings}
                  disabled={saving}
                  className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black px-4 py-2 rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Salvar
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={launchInstance}
                  className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black px-5 py-2.5 rounded-xl font-bold transition-all active:scale-95"
                >
                  <Play size={18} fill="currentColor" />
                  Play
                </button>
                
                {/* Settings Button */}
                <div className="relative">
                  <button 
                    onClick={() => { setShowSettings(!showSettings); setShowMoreMenu(false); }}
                    className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <Settings size={18} className="text-white/60" />
                  </button>
                  
                  {showSettings && (
                    <div className="absolute right-0 top-full mt-2 w-72 bg-[#1a1a1c] border border-white/10 rounded-xl shadow-xl z-50">
                      <div className="p-3 border-b border-white/5">
                        <p className="text-xs text-white/40 uppercase font-bold">Configurações</p>
                      </div>
                      <div className="p-4 space-y-4">
                        {/* Memória RAM */}
                        <div>
                          <label className="text-xs text-white/40 block mb-1">Memória RAM (MB)</label>
                          <input
                            type="number"
                            value={editMemory}
                            onChange={(e) => setEditMemory(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </div>
                        
                        {/* Java Args */}
                        <div>
                          <label className="text-xs text-white/40 block mb-1">Java Arguments</label>
                          <input
                            type="text"
                            value={editJavaArgs}
                            onChange={(e) => setEditJavaArgs(e.target.value)}
                            placeholder="-XX:+UseG1GC"
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </div>
                        
                        {/* Resolução */}
                        <div>
                          <label className="text-xs text-white/40 block mb-1">Resolução</label>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              value={editWidth}
                              onChange={(e) => setEditWidth(e.target.value)}
                              placeholder="854"
                              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <span className="text-white/40 self-center">×</span>
                            <input
                              type="number"
                              value={editHeight}
                              onChange={(e) => setEditHeight(e.target.value)}
                              placeholder="480"
                              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                          </div>
                        </div>
                        
                        <button
                          onClick={() => { saveInstanceSettings(); setShowSettings(false); }}
                          className="w-full bg-emerald-500 hover:bg-emerald-400 text-black py-2 rounded-lg font-bold text-sm transition-all"
                        >
                          Salvar Configurações
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* More Options Button */}
                <div className="relative">
                  <button 
                    onClick={() => { setShowMoreMenu(!showMoreMenu); setShowSettings(false); }}
                    className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <MoreVertical size={18} className="text-white/60" />
                  </button>
                  
                  {showMoreMenu && (
                    <div className="absolute right-0 top-full mt-2 w-56 bg-[#1a1a1c] border border-white/10 rounded-xl shadow-xl z-50">
                      <div className="p-2">
                        <button 
                          onClick={() => { setIsEditing(true); setShowMoreMenu(false); }}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-sm flex items-center gap-2"
                        >
                          <Pencil size={14} className="text-white/40" />
                          Editar instância
                        </button>
                        <button 
                          onClick={openInstanceFolder}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-sm flex items-center gap-2"
                        >
                          <FolderOpen size={14} className="text-white/40" />
                          Abrir pasta
                        </button>
                        <button 
                          onClick={copyPath}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-sm flex items-center gap-2"
                        >
                          <Copy size={14} className="text-white/40" />
                          Copiar caminho
                        </button>
                        <div className="border-t border-white/5 my-1" />
                        <button 
                          onClick={deleteInstance}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-red-500/10 text-red-400 text-sm flex items-center gap-2"
                        >
                          <Trash2 size={14} />
                          Excluir instância
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-4 pb-2 border-b border-white/5">
        <div className="flex gap-1">
          {(["content", "worlds", "logs"] as ContentTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize",
                activeTab === tab
                  ? "bg-emerald-500 text-black"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              )}
            >
              {tab === "content" ? "Conteúdo" : tab === "worlds" ? "Mundos" : "Logs"}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col" onClick={() => { setShowSettings(false); setShowMoreMenu(false); }}>
        {activeTab === "content" && (
          <>
            {/* Search & Actions Bar */}
            <div className="px-6 py-4 flex items-center gap-4 border-b border-white/5">
              {viewMode === "browse" && (
                <button
                  onClick={() => setViewMode("installed")}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/60"
                >
                  <ChevronLeft size={20} />
                </button>
              )}

              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    viewMode === "installed"
                      ? `Buscar em ${filteredContent.length} projetos...`
                      : `Buscar no ${browseSource === "modrinth" ? "Modrinth" : "CurseForge"}...`
                  }
                  className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-10 pr-10 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {viewMode === "installed" ? (
                <button
                  onClick={() => setViewMode("browse")}
                  className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black px-4 py-2 rounded-lg font-medium text-sm transition-all whitespace-nowrap"
                >
                  <Plus size={16} />
                  Adicionar conteúdo
                </button>
              ) : (
                <div className="flex bg-white/5 p-1 rounded-lg border border-white/10">
                  <button
                    onClick={() => setBrowseSource("modrinth")}
                    className={cn(
                      "px-3 py-1.5 rounded text-xs font-bold transition-all",
                      browseSource === "modrinth" ? "bg-emerald-500 text-black" : "text-white/40"
                    )}
                  >
                    Modrinth
                  </button>
                  <button
                    onClick={() => setBrowseSource("curseforge")}
                    className={cn(
                      "px-3 py-1.5 rounded text-xs font-bold transition-all",
                      browseSource === "curseforge" ? "bg-[#f16436] text-white" : "text-white/40"
                    )}
                  >
                    CurseForge
                  </button>
                </div>
              )}
            </div>

            {/* Filters */}
            <div className="px-6 py-3 flex items-center justify-between border-b border-white/5">
              <div className="flex items-center gap-2">
                {availableFilters.map((filter) => {
                  const Icon = filterIcons[filter];
                  return (
                    <button
                      key={filter}
                      onClick={() => setActiveFilter(filter)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5",
                        activeFilter === filter
                          ? "bg-white/10 text-white"
                          : "text-white/40 hover:text-white/60"
                      )}
                    >
                      <Icon size={12} />
                      {filter === "resourcepacks" ? "Resource Packs" : filter.charAt(0).toUpperCase() + filter.slice(1)}
                    </button>
                  );
                })}
                
                {isVanilla && (
                  <span className="text-xs text-white/30 ml-2">
                    (Instância Vanilla - apenas resource packs)
                  </span>
                )}
              </div>

              {viewMode === "installed" && totalPages > 1 && (
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(totalPages, 3) }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={cn(
                        "w-7 h-7 rounded-lg text-xs font-medium transition-all",
                        currentPage === page
                          ? "bg-emerald-500 text-black"
                          : "bg-white/5 text-white/50 hover:bg-white/10"
                      )}
                    >
                      {page}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {viewMode === "installed" ? (
                loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="animate-spin text-emerald-500" size={32} />
                  </div>
                ) : paginatedContent.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-white/40">
                    <div className="text-center">
                      <Package size={40} className="mx-auto mb-3 opacity-30" />
                      <p className="font-medium">Nenhum conteúdo instalado</p>
                      <button
                        onClick={() => setViewMode("browse")}
                        className="mt-3 text-emerald-400 hover:text-emerald-300 text-sm"
                      >
                        + Adicionar conteúdo
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="px-6 py-2 flex items-center text-xs text-white/40 border-b border-white/5 sticky top-0 bg-[#0d0d0e]">
                      <div className="w-8" />
                      <div className="flex-1 ml-3">Nome</div>
                      <div className="w-48">Versão</div>
                      {mostrarControlesAtualizacao && (
                        <div className="w-28 text-right">Atualização</div>
                      )}
                      <div className="w-20 text-right">Ativo</div>
                      {mostrarControlesAtualizacao ? (
                        <div className="w-24 text-right flex items-center justify-end">
                          <button
                            onClick={atualizarTodosConteudos}
                            disabled={updatingAll || quantidadeAtualizaveis === 0}
                            className={cn(
                              "flex items-center gap-1 transition-colors",
                              updatingAll || quantidadeAtualizaveis === 0
                                ? "text-white/20 cursor-not-allowed"
                                : "hover:text-white/70"
                            )}
                          >
                            {updatingAll ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Download size={12} />
                            )}
                            Atualizar todos
                          </button>
                        </div>
                      ) : (
                        <div className="w-24" />
                      )}
                    </div>

                    {paginatedContent.map((mod: InstalledMod) => (
                      <div key={mod.fileName} className="px-6 py-3 flex items-center hover:bg-white/2 border-b border-white/5 group">
                        <div className="w-8">
                          <input type="checkbox" className="w-4 h-4 rounded border-white/20 bg-white/5" />
                        </div>

                        <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center ml-2">
                          {mod.icon ? (
                            <img src={mod.icon} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Package size={18} className="text-white/30" />
                          )}
                        </div>

                        <div className="flex-1 ml-3 min-w-0">
                          <p className="font-medium text-white truncate">{mod.name}</p>
                          <p className="text-xs text-white/40">por {mod.author}</p>
                          {mod.updateAvailable && (
                            <p className="text-[10px] text-amber-300 mt-0.5 uppercase tracking-wide">
                              Atualização disponível {mod.latestVersion ? `(${mod.latestVersion})` : ""}
                            </p>
                          )}
                        </div>

                        <div className="w-48">
                          <p className="text-sm text-white/70">{mod.version || "-"}</p>
                          <p className="text-xs text-white/30 truncate">{mod.fileName}</p>
                        </div>

                        {mostrarControlesAtualizacao && (
                          <div className="w-28 flex items-center justify-end">
                            {(mod.updateAvailable || mod.updating) ? (
                              <button
                                onClick={() => atualizarItemInstalado(mod, activeFilter)}
                                disabled={!mod.updateAvailable || mod.updating || updatingAll}
                                className={cn(
                                  "px-2.5 py-1 rounded text-xs font-bold flex items-center gap-1 transition-all",
                                  !mod.updateAvailable || mod.updating || updatingAll
                                    ? "bg-white/5 text-white/30 cursor-not-allowed"
                                    : "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                                )}
                              >
                                {mod.updating ? (
                                  <Loader2 size={11} className="animate-spin" />
                                ) : (
                                  <RefreshCw size={11} />
                                )}
                                Atualizar
                              </button>
                            ) : (
                              <span className="text-[10px] text-white/20">-</span>
                            )}
                          </div>
                        )}

                        <div className="w-20 flex items-center justify-end gap-2">
                          <button
                            onClick={() => toggleMod(mod)}
                            className={cn(
                              "w-10 h-5 rounded-full transition-all relative",
                              mod.enabled ? "bg-emerald-500" : "bg-white/20"
                            )}
                          >
                            <div
                              className={cn(
                                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all",
                                mod.enabled ? "left-5" : "left-0.5"
                              )}
                            />
                          </button>
                        </div>

                        <div className="w-24 flex items-center justify-end gap-1">
                          <button
                            onClick={() => deleteMod(mod)}
                            className="p-1.5 rounded hover:bg-red-500/20 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                          <button className="p-1.5 rounded hover:bg-white/10 text-white/30 hover:text-white opacity-0 group-hover:opacity-100 transition-all">
                            <MoreVertical size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                searching ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="animate-spin text-emerald-500" size={32} />
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-white/40">
                    <p>Nenhum resultado encontrado</p>
                  </div>
                ) : (
                  <div className="p-4 grid grid-cols-1 gap-3">
                    {searchResults.map((item) => (
                      <div
                        key={item.id}
                        className="bg-white/3 hover:bg-white/5 border border-white/5 rounded-xl p-4 flex gap-4 transition-all group"
                      >
                        <img
                          src={item.icon_url || `https://api.dicebear.com/9.x/shapes/svg?seed=${item.id}`}
                          alt=""
                          className="w-14 h-14 rounded-xl bg-black/40 object-cover shrink-0"
                        />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h3 className="font-bold text-white group-hover:text-emerald-400 transition-colors">
                                {item.title}
                              </h3>
                              <p className="text-xs text-white/40">
                                por {item.author} • via <span className={browseSource === "modrinth" ? "text-emerald-400" : "text-orange-400"}>{browseSource}</span>
                              </p>
                            </div>

                            {(() => {
                              // Verificar se algum arquivo instalado contém o slug do mod
                              const isInstalled = Array.from(installedModFileNames).some(
                                fileName => fileName.includes(item.slug.toLowerCase())
                              );
                              
                              if (isInstalled) {
                                return (
                                  <button
                                    disabled
                                    className="px-4 py-2 rounded-xl text-sm font-bold bg-white/10 text-white/50 flex items-center gap-2 shrink-0 cursor-not-allowed"
                                  >
                                    <Download size={14} />
                                    Instalado
                                  </button>
                                );
                              }
                              
                              return (
                                <button
                                  onClick={() => installContent(item)}
                                  disabled={installing === item.id}
                                  className={cn(
                                    "px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shrink-0",
                                    installing === item.id
                                      ? "bg-white/10 text-white/40"
                                      : "bg-emerald-500 hover:bg-emerald-400 text-black active:scale-95"
                                  )}
                                >
                                  {installing === item.id ? (
                                    <>
                                      <Loader2 size={14} className="animate-spin" />
                                      Instalando...
                                    </>
                                  ) : (
                                    <>
                                      <Download size={14} />
                                      Instalar
                                    </>
                                  )}
                                </button>
                              );
                            })()}
                          </div>

                          <p className="text-sm text-white/50 line-clamp-2 mt-2">
                            {item.description}
                          </p>

                          <div className="flex items-center gap-3 mt-2 text-xs text-white/30">
                            <span className="flex items-center gap-1">
                              <Download size={10} />
                              {(() => {
                                const qtdDownloads = item.downloads || 0;
                                if (qtdDownloads >= 1000000) return `${(qtdDownloads / 1000000).toFixed(1)}M`;
                                if (qtdDownloads >= 1000) return `${(qtdDownloads / 1000).toFixed(1)}K`;
                                return qtdDownloads;
                              })()}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </>
        )}

        {/* WORLDS TAB */}
        {activeTab === "worlds" && (
          <div className="flex-1 overflow-y-auto p-6">
            {worlds.length === 0 ? (
              <div className="flex items-center justify-center h-full text-white/40">
                <div className="text-center">
                  <Globe size={48} className="mx-auto mb-4 opacity-30" />
                  <p className="font-medium">Nenhum mundo encontrado</p>
                  <p className="text-sm mt-1">Crie um novo mundo no jogo</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {worlds.map((world) => (
                  <div
                    key={world.path}
                    className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-all group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center">
                          <Globe size={24} className="text-emerald-400" />
                        </div>
                        <div>
                          <h3 className="font-bold text-white">{world.name}</h3>
                          <p className="text-xs text-white/40 flex items-center gap-1">
                            <Calendar size={10} />
                            {world.lastPlayed}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => deleteWorld(world)}
                        className="p-2 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-xs text-white/40">
                      <span className="flex items-center gap-1">
                        <HardDrive size={10} />
                        {world.sizeOnDisk}
                      </span>
                      <button
                        onClick={() => abrirPastaMundo(world.path)}
                        className="text-emerald-400 hover:text-emerald-300"
                      >
                        Abrir pasta
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* LOGS TAB */}
        {activeTab === "logs" && (
          <div className="flex-1 overflow-hidden flex">
            <div className="w-64 border-r border-white/5 overflow-y-auto">
              <div className="p-3 border-b border-white/5">
                <p className="text-xs text-white/40 uppercase font-bold">Arquivos de Log</p>
              </div>
              {logs.length === 0 ? (
                <div className="p-4 text-center text-white/40 text-sm">
                  Nenhum log encontrado
                </div>
              ) : (
                logs.map((log) => (
                  <button
                    key={log.path}
                    onClick={() => viewLog(log.path)}
                    className={cn(
                      "w-full text-left p-3 hover:bg-white/5 transition-all border-b border-white/5",
                      selectedLog === log.path && "bg-white/10"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-white/40" />
                      <span className="text-sm font-medium truncate">{log.filename}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-white/30">
                      <span>{(log.size / 1024).toFixed(1)} KB</span>
                      <span>•</span>
                      <span>{log.modified}</span>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
              {selectedLog ? (
                <>
                  <div className="p-3 border-b border-white/5 flex items-center justify-between">
                    <p className="text-sm font-medium">{logs.find(l => l.path === selectedLog)?.filename}</p>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => navigator.clipboard.writeText(logContent)}
                        className="text-xs text-white/40 hover:text-white px-2 py-1 rounded hover:bg-white/10"
                      >
                        Copiar
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto p-4 bg-black/30">
                    <pre className="text-xs text-white/70 font-mono whitespace-pre-wrap">
                      {logContent || "Carregando..."}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-white/40">
                  <div className="text-center">
                    <FileText size={40} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Selecione um arquivo de log</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
