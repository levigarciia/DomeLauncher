import { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Trash2,
  Gamepad2,
  Clock,
  LayoutGrid,
  List,
  Search,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  GripVertical,
  FolderOpen,
  X,
  Pencil,
  Plus,
  Box,
  Upload,
  Download,
  Loader2,
} from "../iconesPixelados";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Instance } from "../hooks/useLauncher";
import { cn } from "../lib/utils";

// Tipos
type ViewMode = "grid" | "list";
type SortKey = "name" | "last_played" | "version" | "loader";
type SortDir = "asc" | "desc";

interface InstanceGroup {
  id: string;
  name: string;
  collapsed: boolean;
  instanceIds: string[];
}

interface LibraryState {
  groups: InstanceGroup[];
  viewMode: ViewMode;
  sortKey: SortKey;
  sortDir: SortDir;
}

interface InstanciaImportavelExterna {
  idExterno: string;
  launcher: string;
  nome: string;
  versaoMinecraft: string;
  loaderType?: string;
  loaderVersion?: string;
  caminhoOrigem: string;
  caminhoJogo: string;
}

interface ResultadoImportacaoInstancia {
  idExterno: string;
  launcher: string;
  nomeOrigem: string;
  sucesso: boolean;
  instanciaId?: string;
  mensagem: string;
}

function deduplicarIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

// Chave de storage
const STORAGE_KEY = "dome-library-state";

// Estado padrão
const defaultState: LibraryState = {
  groups: [
    { id: "default", name: "Instâncias", collapsed: false, instanceIds: [] },
  ],
  viewMode: "grid",
  sortKey: "name",
  sortDir: "asc",
};

// Carregar estado salvo
function carregarEstado(): LibraryState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const estado = JSON.parse(raw) as LibraryState;
      return {
        ...estado,
        groups: (estado.groups || []).map((grupo) => ({
          ...grupo,
          instanceIds: deduplicarIds(grupo.instanceIds || []),
        })),
      };
    }
  } catch {}
  return defaultState;
}

// Salvar estado
function salvarEstado(state: LibraryState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Tempo relativo
function tempoRelativo(data: string | undefined): string {
  if (!data) return "Nunca";
  const diff = Date.now() - new Date(data).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "1 dia";
  if (d < 7) return `${d} dias`;
  const w = Math.floor(d / 7);
  if (w === 1) return "1 sem";
  if (w < 5) return `${w} sem`;
  return new Date(data).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

// Props
interface LibraryPageProps {
  instances: Instance[];
  instanciaAtivaId: string | null;
  onSelectInstance: (instance: Instance) => void;
  onAbrirGerenciadorInstancia: (instance: Instance) => void;
  onLaunch: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateNew: () => void;
  user: any;
  onLogin: () => void;
}

export default function LibraryPage({
  instances,
  instanciaAtivaId,
  onSelectInstance,
  onAbrirGerenciadorInstancia,
  onLaunch,
  onDelete,
  onCreateNew,
  user,
  onLogin,
}: LibraryPageProps) {
  const [state, setState] = useState<LibraryState>(carregarEstado);
  const [busca, setBusca] = useState("");
  const [editandoGrupo, setEditandoGrupo] = useState<string | null>(null);
  const [nomeGrupo, setNomeGrupo] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [menuAberto, setMenuAberto] = useState<string | null>(null);
  const [modalEscolhaImportacaoAberto, setModalEscolhaImportacaoAberto] = useState(false);
  const [modalImportacaoAberto, setModalImportacaoAberto] = useState(false);
  const [instanciaSelecionadaId, setInstanciaSelecionadaId] = useState<string | null>(null);
  const [carregandoImportaveis, setCarregandoImportaveis] = useState(false);
  const [importandoInstancias, setImportandoInstancias] = useState(false);
  const [instanciasImportaveis, setInstanciasImportaveis] = useState<
    InstanciaImportavelExterna[]
  >([]);
  const [idsSelecionadosImportacao, setIdsSelecionadosImportacao] = useState<Set<string>>(
    new Set()
  );
  const [resultadoImportacao, setResultadoImportacao] = useState<
    ResultadoImportacaoInstancia[]
  >([]);
  const [erroImportacao, setErroImportacao] = useState<string | null>(null);
  const [arrastoManualAtivo, setArrastoManualAtivo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Salvar estado ao mudar
  useEffect(() => {
    salvarEstado(state);
  }, [state]);

  useEffect(() => {
    if (instances.length === 0) {
      setInstanciaSelecionadaId(null);
      return;
    }

    const existeSelecionada = instanciaSelecionadaId
      ? instances.some((instancia) => instancia.id === instanciaSelecionadaId)
      : false;

    if (existeSelecionada) return;

    const ativaExiste = instanciaAtivaId
      ? instances.some((instancia) => instancia.id === instanciaAtivaId)
      : false;
    setInstanciaSelecionadaId(ativaExiste ? instanciaAtivaId : instances[0]?.id || null);
  }, [instances, instanciaAtivaId, instanciaSelecionadaId]);

  // Garantir que todas as instâncias estejam em algum grupo
  useEffect(() => {
    const idsUnicosInstancias = deduplicarIds(instances.map((i) => i.id));
    const idsNosGrupos = new Set(
      state.groups.flatMap((g) => deduplicarIds(g.instanceIds))
    );
    const orfaos = idsUnicosInstancias.filter((id) => !idsNosGrupos.has(id));

    if (orfaos.length > 0) {
      setState((prev) => {
        const grupos = [...prev.groups];
        // Adicionar ao grupo padrão
        const defaultIdx = grupos.findIndex((g) => g.id === "default");
        if (defaultIdx >= 0) {
          grupos[defaultIdx] = {
            ...grupos[defaultIdx],
            instanceIds: deduplicarIds([
              ...grupos[defaultIdx].instanceIds,
              ...orfaos,
            ]),
          };
        } else {
          grupos.unshift({
            id: "default",
            name: "Instâncias",
            collapsed: false,
            instanceIds: orfaos,
          });
        }
        return { ...prev, groups: grupos };
      });
    }

    // Limpar IDs de instâncias que não existem mais
    const idsExistentes = new Set(instances.map((i) => i.id));
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => ({
        ...g,
        instanceIds: deduplicarIds(
          g.instanceIds.filter((id) => idsExistentes.has(id))
        ),
      })),
    }));
  }, [instances]);

  // Ordenar instâncias
  const ordenar = useCallback(
    (ids: string[]): Instance[] => {
      const map = new Map(instances.map((i) => [i.id, i]));
      const lista = deduplicarIds(ids)
        .map((id) => map.get(id))
        .filter(Boolean) as Instance[];

      lista.sort((a, b) => {
        let cmp = 0;
        switch (state.sortKey) {
          case "name":
            cmp = a.name.localeCompare(b.name);
            break;
          case "last_played":
            cmp =
              new Date(b.last_played || 0).getTime() -
              new Date(a.last_played || 0).getTime();
            break;
          case "version":
            cmp = a.version.localeCompare(b.version);
            break;
          case "loader":
            cmp = (a.loader_type || "Vanilla").localeCompare(
              b.loader_type || "Vanilla"
            );
            break;
        }
        return state.sortDir === "asc" ? cmp : -cmp;
      });

      return lista;
    },
    [instances, state.sortKey, state.sortDir]
  );

  // Filtrar por busca
  const filtrar = useCallback(
    (lista: Instance[]): Instance[] => {
      if (!busca.trim()) return lista;
      const q = busca.toLowerCase();
      return lista.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.version.includes(q) ||
          (i.loader_type || "").toLowerCase().includes(q)
      );
    },
    [busca]
  );

  // Criar novo grupo
  const criarGrupo = () => {
    const id = `group-${Date.now()}`;
    setState((prev) => ({
      ...prev,
      groups: [
        ...prev.groups,
        { id, name: "Novo Grupo", collapsed: false, instanceIds: [] },
      ],
    }));
    setEditandoGrupo(id);
    setNomeGrupo("Novo Grupo");
    setTimeout(() => inputRef.current?.select(), 50);
  };

  // Renomear grupo
  const salvarNomeGrupo = (groupId: string) => {
    if (!nomeGrupo.trim()) return;
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId ? { ...g, name: nomeGrupo.trim() } : g
      ),
    }));
    setEditandoGrupo(null);
  };

  // Deletar grupo (move instâncias para default)
  const deletarGrupo = (groupId: string) => {
    if (groupId === "default") return;
    setState((prev) => {
      const grupo = prev.groups.find((g) => g.id === groupId);
      if (!grupo) return prev;
      return {
        ...prev,
        groups: prev.groups
          .map((g) => {
            if (g.id === "default") {
              return {
                ...g,
                instanceIds: deduplicarIds([
                  ...g.instanceIds,
                  ...grupo.instanceIds,
                ]),
              };
            }
            return g;
          })
          .filter((g) => g.id !== groupId),
      };
    });
  };

  // Toggle colapsar grupo
  const toggleGrupo = (groupId: string) => {
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
      ),
    }));
  };

  const moverInstanciaParaGrupo = (idArrastado: string, targetGroupId: string) => {
    setState((prev) => {
      // Remover a instância de todos os grupos
      const gruposSemItem = prev.groups.map((g) => ({
        ...g,
        instanceIds: g.instanceIds.filter((id) => id !== idArrastado),
      }));

      // Adicionar no grupo alvo
      return {
        ...prev,
        groups: gruposSemItem.map((g) =>
          g.id === targetGroupId
            ? {
                ...g,
                instanceIds: deduplicarIds([...g.instanceIds, idArrastado]),
              }
            : g
        ),
      };
    });
  };

  const iniciarArrastoManual = (instanceId: string) => {
    setDraggedId(instanceId);
    setArrastoManualAtivo(true);
  };

  const finalizarArrastoManual = useCallback(() => {
    setArrastoManualAtivo(false);
    setDraggedId(null);
    setDragOverGroup(null);
  }, []);

  useEffect(() => {
    if (!arrastoManualAtivo) return;
    const aoSoltarMouse = () => finalizarArrastoManual();
    window.addEventListener("mouseup", aoSoltarMouse);
    return () => window.removeEventListener("mouseup", aoSoltarMouse);
  }, [arrastoManualAtivo, finalizarArrastoManual]);

  useEffect(() => {
    if (!arrastoManualAtivo) return;
    const cursorAnterior = document.body.style.cursor;
    const userSelectAnterior = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursorAnterior;
      document.body.style.userSelect = userSelectAnterior;
    };
  }, [arrastoManualAtivo]);

  const handleGrupoMouseEnter = (groupId: string) => {
    if (!arrastoManualAtivo || !draggedId) return;
    setDragOverGroup(groupId);
  };

  const handleGrupoMouseUp = (groupId: string) => {
    if (!arrastoManualAtivo || !draggedId) return;
    moverInstanciaParaGrupo(draggedId, groupId);
    finalizarArrastoManual();
  };

  // Alternar ordenação
  const alternarSort = (key: SortKey) => {
    setState((prev) => ({
      ...prev,
      sortKey: key,
      sortDir: prev.sortKey === key && prev.sortDir === "asc" ? "desc" : "asc",
    }));
  };

  // Labels de sort
  const sortLabels: Record<SortKey, string> = {
    name: "Nome",
    last_played: "Último jogado",
    version: "Versão",
    loader: "Loader",
  };

  const carregarInstanciasImportaveis = async () => {
    setCarregandoImportaveis(true);
    setErroImportacao(null);
    try {
      const lista = await invoke<InstanciaImportavelExterna[]>(
        "listar_instancias_importaveis"
      );
      setInstanciasImportaveis(lista || []);
      setIdsSelecionadosImportacao(new Set((lista || []).map((item) => item.idExterno)));
    } catch (erro) {
      setErroImportacao(
        erro instanceof Error
          ? erro.message
          : "Não foi possível listar instâncias para importação."
      );
      setInstanciasImportaveis([]);
      setIdsSelecionadosImportacao(new Set());
    } finally {
      setCarregandoImportaveis(false);
    }
  };

  const abrirModalImportacao = () => {
    setModalEscolhaImportacaoAberto(true);
  };

  const abrirModalImportacaoInstancias = async () => {
    setModalEscolhaImportacaoAberto(false);
    setModalImportacaoAberto(true);
    setResultadoImportacao([]);
    await carregarInstanciasImportaveis();
  };

  const alternarSelecaoImportacao = (idExterno: string) => {
    setIdsSelecionadosImportacao((anterior) => {
      const proximo = new Set(anterior);
      if (proximo.has(idExterno)) {
        proximo.delete(idExterno);
      } else {
        proximo.add(idExterno);
      }
      return proximo;
    });
  };

  const selecionarTodasImportaveis = () => {
    if (idsSelecionadosImportacao.size === instanciasImportaveis.length) {
      setIdsSelecionadosImportacao(new Set());
      return;
    }
    setIdsSelecionadosImportacao(
      new Set(instanciasImportaveis.map((instancia) => instancia.idExterno))
    );
  };

  const importarSelecionadas = async () => {
    const selecionadas = instanciasImportaveis.filter((instancia) =>
      idsSelecionadosImportacao.has(instancia.idExterno)
    );
    if (selecionadas.length === 0) return;

    setImportandoInstancias(true);
    setErroImportacao(null);
    try {
      const resultados = await invoke<ResultadoImportacaoInstancia[]>(
        "importar_instancias_externas",
        { instancias: selecionadas }
      );
      setResultadoImportacao(resultados || []);
    } catch (erro) {
      setErroImportacao(
        erro instanceof Error
          ? erro.message
          : "Falha ao importar as instâncias selecionadas."
      );
      setResultadoImportacao([]);
    } finally {
      setImportandoInstancias(false);
    }
  };

  // ===== EXPORTAR / IMPORTAR POR ARQUIVO =====
  const [exportandoId, setExportandoId] = useState<string | null>(null);
  const [importandoArquivo, setImportandoArquivo] = useState(false);

  const exportarInstancia = async (instanceId: string) => {
    setExportandoId(instanceId);
    try {
      const resultado = await invoke<{
        sucesso: boolean;
        caminhoArquivo?: string;
        mensagem: string;
      }>("exportar_instancia", { instanceId, destino: null });
      if (resultado.sucesso) {
        alert(`✅ ${resultado.mensagem}\n\nSalvo em: ${resultado.caminhoArquivo}`);
      } else {
        alert(`❌ ${resultado.mensagem}`);
      }
    } catch (erro) {
      alert(`Erro ao exportar: ${erro instanceof Error ? erro.message : String(erro)}`);
    } finally {
      setExportandoId(null);
    }
  };

  const importarArquivoDome = async () => {
    try {
      // Usar dialog nativo do Tauri para selecionar arquivo
      const caminho = await openDialog({
        title: "Selecionar arquivo .dome",
        filters: [{ name: "Dome Instance", extensions: ["dome", "zip"] }],
        multiple: false,
        directory: false,
      });
      if (!caminho) return;

      setImportandoArquivo(true);
      const resultado = await invoke<{
        sucesso: boolean;
        instanciaId?: string;
        mensagem: string;
      }>("importar_instancia_arquivo", { caminhoArquivo: caminho });

      if (resultado.sucesso) {
        alert(`✅ ${resultado.mensagem}`);
        window.location.reload();
      } else {
        alert(`❌ ${resultado.mensagem}`);
      }
    } catch (erro) {
      alert(`Erro ao importar: ${erro instanceof Error ? erro.message : String(erro)}`);
    } finally {
      setImportandoArquivo(false);
    }
  };

  const exportarInstanciaSelecionada = async () => {
    if (!instanciaSelecionadaId) return;
    await exportarInstancia(instanciaSelecionadaId);
  };

  const selecionarInstancia = (instancia: Instance) => {
    setInstanciaSelecionadaId(instancia.id);
    onSelectInstance(instancia);
  };

  const totalSucessosImportacao = resultadoImportacao.filter((item) => item.sucesso).length;
  const nomeLauncher = (launcher: string) =>
    launcher === "prism"
      ? "Prism Launcher"
      : launcher === "modrinth"
        ? "Modrinth"
        : launcher === "curseforge"
          ? "CurseForge"
          : launcher;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        {/* Busca */}
        <div className="flex-1 relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20"
          />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar instâncias..."
            className="w-full bg-white/3 border border-white/5 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/30 placeholder:text-white/15 transition-all"
          />
          {busca && (
            <button
              onClick={() => setBusca("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/40"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Ordenação */}
        <div className="relative">
          <button
            onClick={() =>
              setMenuAberto(menuAberto === "sort" ? null : "sort")
            }
            className="flex items-center gap-1.5 px-3 py-2 bg-white/3 border border-white/5 rounded-xl text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-all"
          >
            <ArrowUpDown size={13} />
            {sortLabels[state.sortKey]}
          </button>
          <AnimatePresence>
            {menuAberto === "sort" && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute right-0 top-full mt-1 bg-[#1a1a1c] border border-white/10 rounded-xl p-1 z-50 min-w-[140px] shadow-xl"
              >
                {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => {
                      alternarSort(key);
                      setMenuAberto(null);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all ${
                      state.sortKey === key
                        ? "text-emerald-400 bg-emerald-500/10"
                        : "text-white/50 hover:bg-white/5 hover:text-white/70"
                    }`}
                  >
                    {sortLabels[key]}
                    {state.sortKey === key && (
                      <span className="ml-auto text-[10px] opacity-50">
                        {state.sortDir === "asc" ? "↑" : "↓"}
                      </span>
                    )}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Novo grupo */}
        <button
          onClick={criarGrupo}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/3 border border-white/5 rounded-xl text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-all"
          title="Criar grupo"
        >
          <FolderPlus size={13} />
        </button>

        {/* View mode */}
        <div className="flex bg-white/3 border border-white/5 rounded-xl overflow-hidden">
          <button
            onClick={() => setState((p) => ({ ...p, viewMode: "grid" }))}
            className={`p-2 transition-all ${
              state.viewMode === "grid"
                ? "text-emerald-400 bg-emerald-500/10"
                : "text-white/30 hover:text-white/50"
            }`}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => setState((p) => ({ ...p, viewMode: "list" }))}
            className={`p-2 transition-all ${
              state.viewMode === "list"
                ? "text-emerald-400 bg-emerald-500/10"
                : "text-white/30 hover:text-white/50"
            }`}
          >
            <List size={14} />
          </button>
        </div>

        {/* Importar / Exportar */}
        <button
          onClick={abrirModalImportacao}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/15 rounded-xl text-xs text-white/70 hover:text-white hover:bg-white/10 transition-all font-bold"
        >
          <Upload size={13} />
          Importar
        </button>

        <button
          onClick={exportarInstanciaSelecionada}
          disabled={!instanciaSelecionadaId || Boolean(exportandoId)}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/15 rounded-xl text-xs text-white/70 hover:text-white hover:bg-white/10 transition-all font-bold disabled:opacity-40"
          title="Exportar instância selecionada"
        >
          {exportandoId ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Download size={13} />
          )}
          Exportar
        </button>

        <button
          onClick={onCreateNew}
          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 hover:bg-emerald-500/20 transition-all font-bold"
        >
          <Plus size={13} />
          Nova
        </button>
      </div>

      {/* Grupos e instâncias */}
      {instances.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-white/20 border-2 border-dashed border-white/5 rounded-2xl">
          <Box size={48} className="mb-4 opacity-20" />
          <p className="font-bold">Nenhuma instância encontrada</p>
          <p className="text-sm mt-1">
            Clique em "Nova" para criar sua primeira instância
          </p>
          <button
            onClick={onCreateNew}
            className="mt-4 flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm font-bold hover:bg-emerald-500/20 transition-all"
          >
            <Plus size={14} />
            Criar Instância
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {state.groups.map((grupo) => {
            const instanciasOrdenadas = ordenar(grupo.instanceIds);
            const instanciasFiltradas = filtrar(instanciasOrdenadas);

            // Se filtrando e grupo vazio, ocultar
            if (busca && instanciasFiltradas.length === 0) return null;

            return (
              <GrupoWidget
                key={grupo.id}
                grupo={grupo}
                instances={instanciasFiltradas}
                viewMode={state.viewMode}
                editando={editandoGrupo === grupo.id}
                nomeEdit={nomeGrupo}
                dragOver={dragOverGroup === grupo.id}
                inputRef={
                  editandoGrupo === grupo.id ? inputRef : undefined
                }
                onToggle={() => toggleGrupo(grupo.id)}
                onRenomear={() => {
                  setEditandoGrupo(grupo.id);
                  setNomeGrupo(grupo.name);
                  setTimeout(() => inputRef.current?.select(), 50);
                }}
                onNomeChange={setNomeGrupo}
                onNomeSalvar={() => salvarNomeGrupo(grupo.id)}
                onDeletar={() => deletarGrupo(grupo.id)}
                onSelect={selecionarInstancia}
                onAbrirGerenciador={onAbrirGerenciadorInstancia}
                onLaunch={(id) => {
                  if (!user) {
                    onLogin();
                    return;
                  }
                  onLaunch(id);
                }}
                onDelete={onDelete}
                onExport={exportarInstancia}
                onIniciarArrasto={iniciarArrastoManual}
                onMouseEnterGrupo={() => handleGrupoMouseEnter(grupo.id)}
                onMouseUpGrupo={() => handleGrupoMouseUp(grupo.id)}
                onFinalizarArrasto={finalizarArrastoManual}
                instanciaSelecionadaId={instanciaSelecionadaId}
                instanciaAtivaId={instanciaAtivaId}
                exportandoId={exportandoId}
              />
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {modalEscolhaImportacaoAberto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-xs p-4 flex items-center justify-center"
            onClick={() => {
              if (importandoArquivo) return;
              setModalEscolhaImportacaoAberto(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="w-full max-w-xl bg-[#141416] border border-white/15 rounded-2xl overflow-hidden"
              onClick={(evento) => evento.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide">Importar</h3>
                  <p className="text-xs text-white/50 mt-1">
                    Escolha como deseja importar para a biblioteca.
                  </p>
                </div>
                <button
                  onClick={() => setModalEscolhaImportacaoAberto(false)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="p-5 space-y-3">
                <button
                  onClick={async () => {
                    setModalEscolhaImportacaoAberto(false);
                    await importarArquivoDome();
                  }}
                  disabled={importandoArquivo}
                  className="w-full text-left border border-white/10 bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3 transition-all disabled:opacity-40"
                >
                  <p className="text-sm font-bold flex items-center gap-2">
                    {importandoArquivo ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Upload size={14} />
                    )}
                    Importar arquivo `.dome`
                  </p>
                  <p className="text-xs text-white/55 mt-1">
                    Também aceita `.dome.zip` para compatibilidade.
                  </p>
                </button>

                <button
                  onClick={abrirModalImportacaoInstancias}
                  className="w-full text-left border border-white/10 bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3 transition-all"
                >
                  <p className="text-sm font-bold flex items-center gap-2">
                    <FolderOpen size={14} />
                    Importar de outro launcher
                  </p>
                  <p className="text-xs text-white/55 mt-1">
                    Detecta instâncias de Prism Launcher, Modrinth e CurseForge.
                  </p>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {modalImportacaoAberto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-xs p-4 flex items-center justify-center"
            onClick={() => {
              if (importandoInstancias) return;
              setModalImportacaoAberto(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="w-full max-w-3xl bg-[#141416] border border-white/15 rounded-2xl overflow-hidden"
              onClick={(evento) => evento.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide">Importar Instâncias</h3>
                  <p className="text-xs text-white/50 mt-1">
                    Detectadas em Prism Launcher, Modrinth e CurseForge.
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (importandoInstancias) return;
                    setModalImportacaoAberto(false);
                    setModalEscolhaImportacaoAberto(false);
                  }}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="px-5 py-4">
                {erroImportacao && (
                  <div className="mb-3 border border-red-400/30 bg-red-500/10 text-red-200 text-xs px-3 py-2 rounded-lg">
                    {erroImportacao}
                  </div>
                )}

                {carregandoImportaveis ? (
                  <div className="py-12 flex items-center justify-center text-white/60 text-sm">
                    <Loader2 size={14} className="animate-spin mr-2" />
                    Buscando instâncias...
                  </div>
                ) : instanciasImportaveis.length === 0 ? (
                  <div className="py-12 text-center text-white/50 text-sm">
                    Nenhuma instância externa foi encontrada no computador.
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex items-center justify-between">
                      <button
                        onClick={selecionarTodasImportaveis}
                        className="text-xs text-white/70 hover:text-white transition-colors"
                      >
                        {idsSelecionadosImportacao.size === instanciasImportaveis.length
                          ? "Desmarcar todas"
                          : "Marcar todas"}
                      </button>
                      <span className="text-[11px] text-white/40">
                        {idsSelecionadosImportacao.size}/{instanciasImportaveis.length} selecionadas
                      </span>
                    </div>

                    <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
                      {instanciasImportaveis.map((instancia) => {
                        const selecionada = idsSelecionadosImportacao.has(instancia.idExterno);
                        return (
                          <button
                            key={instancia.idExterno}
                            onClick={() => alternarSelecaoImportacao(instancia.idExterno)}
                            className={cn(
                              "w-full text-left border rounded-xl px-3 py-2 transition-all",
                              selecionada
                                ? "border-emerald-400/40 bg-emerald-500/10"
                                : "border-white/10 bg-white/3 hover:bg-white/6"
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={selecionada}
                                readOnly
                                className="mt-1 w-4 h-4"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-bold truncate">{instancia.nome}</p>
                                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                                    {nomeLauncher(instancia.launcher)}
                                  </span>
                                </div>
                                <p className="text-xs text-white/55 mt-0.5">
                                  MC {instancia.versaoMinecraft}
                                  {instancia.loaderType ? ` • ${instancia.loaderType}` : " • Vanilla"}
                                  {instancia.loaderVersion ? ` ${instancia.loaderVersion}` : ""}
                                </p>
                                <p className="text-[10px] text-white/35 mt-1 truncate">
                                  {instancia.caminhoOrigem}
                                </p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                {resultadoImportacao.length > 0 && (
                  <div className="mt-4 border border-white/10 rounded-xl p-3 bg-white/3">
                    <p className="text-xs font-black uppercase tracking-wide text-white/70">
                      Resultado da importação
                    </p>
                    <p className="text-xs text-white/45 mt-1">
                      {totalSucessosImportacao} de {resultadoImportacao.length} instâncias importadas.
                    </p>
                    <div className="mt-2 max-h-40 overflow-y-auto space-y-1.5">
                      {resultadoImportacao.map((item) => (
                        <div
                          key={item.idExterno}
                          className={cn(
                            "text-xs px-2 py-1.5 rounded border",
                            item.sucesso
                              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                              : "border-red-400/30 bg-red-500/10 text-red-200"
                          )}
                        >
                          <p className="font-bold">{item.nomeOrigem}</p>
                          <p className="opacity-80">{item.mensagem}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 py-4 border-t border-white/10 flex items-center justify-between gap-3">
                <button
                  onClick={carregarInstanciasImportaveis}
                  disabled={carregandoImportaveis || importandoInstancias}
                  className="text-xs text-white/65 hover:text-white disabled:opacity-40 transition-colors"
                >
                  Rebuscar
                </button>
                <div className="flex items-center gap-2">
                  {totalSucessosImportacao > 0 && (
                    <button
                      onClick={() => window.location.reload()}
                      className="px-3 py-2 rounded-lg text-xs font-bold bg-white/10 border border-white/20 hover:bg-white/15"
                    >
                      Atualizar biblioteca
                    </button>
                  )}
                  <button
                    onClick={importarSelecionadas}
                    disabled={
                      importandoInstancias ||
                      carregandoImportaveis ||
                      idsSelecionadosImportacao.size === 0
                    }
                    className={cn(
                      "px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wide transition-all flex items-center gap-2",
                      importandoInstancias ||
                        carregandoImportaveis ||
                        idsSelecionadosImportacao.size === 0
                        ? "bg-white/10 text-white/40 cursor-not-allowed"
                        : "bg-emerald-500 text-black hover:bg-emerald-400"
                    )}
                  >
                    {importandoInstancias ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Importando...
                      </>
                    ) : (
                      <>
                        <Upload size={12} />
                        Importar selecionadas
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ===== WIDGET DE GRUPO =====
function GrupoWidget({
  grupo,
  instances,
  viewMode,
  editando,
  nomeEdit,
  dragOver,
  inputRef,
  onToggle,
  onRenomear,
  onNomeChange,
  onNomeSalvar,
  onDeletar,
  onSelect,
  onAbrirGerenciador,
  onLaunch,
  onDelete,
  onExport,
  onIniciarArrasto,
  onMouseEnterGrupo,
  onMouseUpGrupo,
  onFinalizarArrasto,
  instanciaSelecionadaId,
  instanciaAtivaId,
  exportandoId,
}: {
  grupo: InstanceGroup;
  instances: Instance[];
  viewMode: ViewMode;
  editando: boolean;
  nomeEdit: string;
  dragOver: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onToggle: () => void;
  onRenomear: () => void;
  onNomeChange: (v: string) => void;
  onNomeSalvar: () => void;
  onDeletar: () => void;
  onSelect: (instance: Instance) => void;
  onAbrirGerenciador: (instance: Instance) => void;
  onLaunch: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onIniciarArrasto: (id: string) => void;
  onMouseEnterGrupo: () => void;
  onMouseUpGrupo: () => void;
  onFinalizarArrasto: () => void;
  instanciaSelecionadaId: string | null;
  instanciaAtivaId: string | null;
  exportandoId: string | null;
}) {
  return (
    <div
      onMouseEnter={onMouseEnterGrupo}
      onMouseUp={onMouseUpGrupo}
      className={`rounded-xl border transition-all ${
        dragOver
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-transparent"
      }`}
    >
      {/* Header do grupo */}
      <div className="flex items-center gap-2 py-1.5 px-1 group/header">
        <button
          onClick={onToggle}
          className="p-1 text-white/25 hover:text-white/50 transition-colors"
        >
          {grupo.collapsed ? (
            <ChevronRight size={14} />
          ) : (
            <ChevronDown size={14} />
          )}
        </button>

        {editando ? (
          <div className="flex items-center gap-1.5 flex-1">
            <input
              ref={inputRef}
              value={nomeEdit}
              onChange={(e) => onNomeChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onNomeSalvar();
                if (e.key === "Escape") onNomeSalvar();
              }}
              onBlur={onNomeSalvar}
              className="bg-white/5 border border-white/10 rounded-lg px-2 py-0.5 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
              autoFocus
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1">
            <FolderOpen size={13} className="text-white/20" />
            <span className="text-xs font-bold text-white/40 uppercase tracking-wider">
              {grupo.name}
            </span>
            <span className="text-[10px] text-white/15 font-medium">
              {instances.length}
            </span>
          </div>
        )}

        {/* Ações do grupo */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover/header:opacity-100 transition-opacity">
          <button
            onClick={onRenomear}
            className="p-1 text-white/20 hover:text-white/40 transition-colors"
            title="Renomear grupo"
          >
            <Pencil size={11} />
          </button>
          {grupo.id !== "default" && (
            <button
              onClick={onDeletar}
              className="p-1 text-white/20 hover:text-red-400 transition-colors"
              title="Excluir grupo"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Conteúdo */}
      <AnimatePresence>
        {!grupo.collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {instances.length === 0 ? (
              <div className="py-6 text-center text-white/10 text-xs border border-dashed border-white/5 rounded-xl mx-1 mb-2">
                Arraste instâncias para este grupo
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 px-1 pb-2">
                {instances.map((instance, i) => (
                  <CardGrid
                    key={instance.id}
                    instance={instance}
                    index={i}
                    onSelect={onSelect}
                    onAbrirGerenciador={onAbrirGerenciador}
                    onLaunch={onLaunch}
                    onDelete={onDelete}
                    onExport={onExport}
                    onIniciarArrasto={onIniciarArrasto}
                    onFinalizarArrasto={onFinalizarArrasto}
                    selecionada={instance.id === instanciaSelecionadaId}
                    ativa={instance.id === instanciaAtivaId}
                    exportando={exportandoId === instance.id}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-1 px-1 pb-2">
                {instances.map((instance, i) => (
                  <CardList
                    key={instance.id}
                    instance={instance}
                    index={i}
                    onSelect={onSelect}
                    onAbrirGerenciador={onAbrirGerenciador}
                    onLaunch={onLaunch}
                    onDelete={onDelete}
                    onExport={onExport}
                    onIniciarArrasto={onIniciarArrasto}
                    onFinalizarArrasto={onFinalizarArrasto}
                    selecionada={instance.id === instanciaSelecionadaId}
                    ativa={instance.id === instanciaAtivaId}
                    exportando={exportandoId === instance.id}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ===== CARD GRID (estilo PrismLauncher) =====
function CardGrid({
  instance,
  index,
  onSelect,
  onAbrirGerenciador,
  onLaunch,
  onDelete,
  onExport,
  onIniciarArrasto,
  onFinalizarArrasto,
  selecionada,
  ativa,
  exportando,
}: {
  instance: Instance;
  index: number;
  onSelect: (i: Instance) => void;
  onAbrirGerenciador: (i: Instance) => void;
  onLaunch: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onIniciarArrasto: (id: string) => void;
  onFinalizarArrasto: () => void;
  selecionada: boolean;
  ativa: boolean;
  exportando: boolean;
}) {
  return (
    <motion.div
      onMouseUp={onFinalizarArrasto}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.02 }}
      onClick={() => onSelect(instance)}
      onDoubleClick={() => onAbrirGerenciador(instance)}
      className={cn(
        "group relative rounded-xl p-3 cursor-pointer transition-all flex flex-col items-center text-center border",
        selecionada
          ? "bg-emerald-500/10 border-emerald-400/30 shadow-realce-selecao"
          : "bg-white/3 hover:bg-white/5 border-white/5 hover:border-white/10"
      )}
    >
      {/* Grip para drag */}
      <div
        onMouseDown={(evento) => {
          if (evento.button !== 0) return;
          evento.stopPropagation();
          onIniciarArrasto(instance.id);
        }}
        className="absolute top-1.5 left-1.5 text-white/0 group-hover:text-white/15 transition-colors cursor-grab active:cursor-grabbing"
      >
        <GripVertical size={10} />
      </div>

      {/* Botões de ação (hover) */}
      <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExport(instance.id);
          }}
          disabled={exportando}
          className="p-1 rounded-md bg-black/40 text-white/20 hover:text-blue-400 hover:bg-blue-400/10 transition-all disabled:opacity-40"
          title="Exportar instância"
        >
          {exportando ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Deletar "${instance.name}"?`)) {
              onDelete(instance.id);
            }
          }}
          className="p-1 rounded-md bg-black/40 text-white/20 hover:text-red-400 hover:bg-red-400/10 transition-all"
        >
          <Trash2 size={10} />
        </button>
      </div>

      {/* Ícone grande */}
      <div className="relative w-16 h-16 mb-2">
        <div className="w-full h-full rounded-xl bg-[#151516] border border-white/10 p-2 overflow-hidden">
          <img
            src={instance.icon}
            alt={instance.name}
            draggable={false}
            className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-200"
          />
        </div>

        {/* Play overlay */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLaunch(instance.id);
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Play size={20} fill="white" className="text-white" />
        </button>
      </div>

      {/* Nome */}
      <h3 className="font-bold text-xs truncate w-full">{instance.name}</h3>

      {selecionada && (
        <span className="mt-1 text-[10px] rounded-full bg-emerald-500/15 px-2 py-0.5 font-bold text-emerald-300">
          Selecionada
        </span>
      )}

      {ativa && (
        <span className="mt-1 text-[10px] rounded-full bg-emerald-500/15 px-2 py-0.5 font-bold text-emerald-300">
          Em execução
        </span>
      )}

      {/* Info */}
      <div className="flex items-center gap-1 text-[10px] text-white/25 mt-0.5">
        <Gamepad2 size={9} />
        <span className="truncate">
          {instance.loader_type || instance.mc_type} {instance.version}
        </span>
      </div>
      <div className="flex items-center gap-1 text-[10px] text-white/25 mt-0.5">
        <Clock size={9} />
        <span>{tempoRelativo(instance.last_played)}</span>
      </div>
    </motion.div>
  );
}

// ===== CARD LISTA =====
function CardList({
  instance,
  index,
  onSelect,
  onAbrirGerenciador,
  onLaunch,
  onDelete,
  onExport,
  onIniciarArrasto,
  onFinalizarArrasto,
  selecionada,
  ativa,
  exportando,
}: {
  instance: Instance;
  index: number;
  onSelect: (i: Instance) => void;
  onAbrirGerenciador: (i: Instance) => void;
  onLaunch: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onIniciarArrasto: (id: string) => void;
  onFinalizarArrasto: () => void;
  selecionada: boolean;
  ativa: boolean;
  exportando: boolean;
}) {
  return (
    <motion.div
      onMouseUp={onFinalizarArrasto}
      initial={{ opacity: 0, x: -5 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.02 }}
      onClick={() => onSelect(instance)}
      onDoubleClick={() => onAbrirGerenciador(instance)}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2 cursor-pointer transition-all border",
        selecionada
          ? "bg-emerald-500/10 border-emerald-400/30 shadow-realce-selecao"
          : "bg-white/2 hover:bg-white/4 border-white/3 hover:border-white/8"
      )}
    >
      {/* Grip */}
      <div
        onMouseDown={(evento) => {
          if (evento.button !== 0) return;
          evento.stopPropagation();
          onIniciarArrasto(instance.id);
        }}
        className="text-white/0 group-hover:text-white/15 transition-colors cursor-grab active:cursor-grabbing shrink-0"
      >
        <GripVertical size={12} />
      </div>

      {/* Ícone */}
      <div className="relative shrink-0">
        <div className="w-9 h-9 rounded-lg bg-[#151516] border border-white/10 p-1 overflow-hidden">
          <img
            src={instance.icon}
            alt={instance.name}
            draggable={false}
            className="w-full h-full object-contain"
          />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLaunch(instance.id);
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Play size={12} fill="white" className="text-white" />
        </button>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-sm truncate">{instance.name}</h3>
      </div>

      {/* Tags */}
      <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-white/30 font-mono shrink-0">
        {instance.version}
      </span>

      <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-white/30 shrink-0">
        {instance.loader_type || "Vanilla"}
      </span>

      {selecionada && (
        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 shrink-0 font-bold">
          Selecionada
        </span>
      )}

      {ativa && (
        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 shrink-0 font-bold">
          Ativa
        </span>
      )}

      {/* Último jogado */}
      <div className="flex items-center gap-1 text-[10px] text-white/20 shrink-0 w-16 justify-end">
        <Clock size={9} />
        {tempoRelativo(instance.last_played)}
      </div>

      {/* Ações */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLaunch(instance.id);
          }}
          className="p-1.5 rounded-lg text-white/20 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
        >
          <Play size={12} fill="currentColor" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExport(instance.id);
          }}
          disabled={exportando}
          className="p-1.5 rounded-lg text-white/20 hover:text-blue-400 hover:bg-blue-400/10 transition-all disabled:opacity-40"
          title="Exportar"
        >
          {exportando ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Deletar "${instance.name}"?`)) {
              onDelete(instance.id);
            }
          }}
          className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-400/10 transition-all"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </motion.div>
  );
}
