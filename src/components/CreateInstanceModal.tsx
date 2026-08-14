import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronDown, Pencil } from "../iconesPixelados";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "../lib/utils";
import {
  addCreatingInstance,
  updateCreatingInstance,
  completeCreatingInstance,
  errorCreatingInstance,
  type CreatingInstance,
} from "../stores/creatingInstances";

interface CreateInstanceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const LOADERS = [
  { id: "forge", name: "Forge" },
  { id: "fabric", name: "Fabric" },
  { id: "neoforge", name: "NeoForge" },
  { id: "vanilla", name: "Vanilla" },
];

export default function CreateInstanceModal({ isOpen, onClose }: CreateInstanceModalProps) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [loader, setLoader] = useState("forge");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [versions, setVersions] = useState<{ id: string; type: string }[]>([]);
  const [mostrarSnapshots, setMostrarSnapshots] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingLoaderVersions, setLoadingLoaderVersions] = useState(false);
  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const [isLoaderVersionOpen, setIsLoaderVersionOpen] = useState(false);

  // Carregar versões do Minecraft
  useEffect(() => {
    if (isOpen) {
      const fetchVersions = async () => {
        setLoadingVersions(true);
        try {
          const [res, settings] = await Promise.all([
            invoke<any>("get_minecraft_versions"),
            invoke<any>("get_settings").catch(() => ({ show_snapshots: false })),
          ]);

          const snapshotsAtivados = Boolean(settings?.show_snapshots);
          setMostrarSnapshots(snapshotsAtivados);

          const filtradas = res.versions.filter(
            (v: any) => v.type === "release" || (snapshotsAtivados && v.type === "snapshot")
          );
          setVersions(filtradas);
          if (filtradas.length > 0) setVersion(filtradas[0].id);
        } catch (error) {
          console.error("Erro ao carregar versões:", error);
        } finally {
          setLoadingVersions(false);
        }
      };
      fetchVersions();
    }
  }, [isOpen]);

  // Carregar versões do loader
  useEffect(() => {
    if (loader !== "vanilla" && version) {
      const fetchLoaderVersions = async () => {
        setLoadingLoaderVersions(true);
        try {
          const res: any = await invoke("get_loader_versions", { loaderType: loader });
          const vers = res.versions.map((v: any) => v.version);
          setLoaderVersions(vers);
          if (vers.length > 0) setLoaderVersion(vers[0]);
        } catch (error) {
          console.error("Erro ao carregar versões do loader:", error);
          setLoaderVersions([]);
        } finally {
          setLoadingLoaderVersions(false);
        }
      };
      fetchLoaderVersions();
    } else {
      setLoaderVersions([]);
      setLoaderVersion("");
    }
  }, [loader, version]);

  // Reset ao abrir
  useEffect(() => {
    if (isOpen) {
      setName("");
      setLoader("forge");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!name.trim() || !version) return;

    const instanceId = name.toLowerCase().replace(/\s+/g, "_");

    // Adicionar ao estado de criação
    const creatingInstance: CreatingInstance = {
      id: instanceId,
      name,
      version,
      type: loader,
      status: "downloading",
      progress: 0,
      message: "Iniciando download...",
      icon: `https://api.dicebear.com/9.x/shapes/svg?seed=${instanceId}`,
    };
    addCreatingInstance(creatingInstance);

    // Fechar modal
    onClose();

    // Criar em background
    try {
      const params: any = { name, version, mcType: loader };
      if (loader !== "vanilla") {
        params.loaderType = loader;
        params.loaderVersion = loaderVersion;
      }

      updateCreatingInstance(instanceId, {
        status: "downloading",
        progress: 30,
        message: "Baixando arquivos...",
      });

      await invoke("create_instance", params);
      completeCreatingInstance(instanceId);

      setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      console.error("Erro ao criar instância:", error);
      errorCreatingInstance(instanceId, `Falha: ${error}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-[#1a1a1c] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <h2 className="text-lg font-bold">Criar Instância</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={18} className="text-white/60" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Icon + Name */}
          <div className="flex gap-4">
            <div className="relative group">
              <div className="w-16 h-16 rounded-xl bg-linear-to-br from-emerald-500/20 to-orange-500/20 border border-white/10 overflow-hidden">
                <img
                  src={`https://api.dicebear.com/9.x/shapes/svg?seed=${name || "default"}`}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
              <button className="absolute -bottom-1 -right-1 w-6 h-6 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors">
                <Pencil size={12} className="text-white/60" />
              </button>
            </div>

            <div className="flex-1">
              <label className="text-sm text-white/60 mb-1.5 block">Nome</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Meu Modpack"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
              />
            </div>
          </div>

          {/* Minecraft Version */}
          <div>
            <label className="text-sm font-bold text-white mb-2 block">
              Versão do Minecraft
              {mostrarSnapshots && (
                <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                  snapshots habilitados
                </span>
              )}
            </label>
            <div className="relative">
              <button
                onClick={() => setIsVersionOpen(!isVersionOpen)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-left flex items-center justify-between hover:bg-white/10 transition-colors"
              >
                <span>{loadingVersions ? "Carregando..." : version}</span>
                <ChevronDown size={16} className={cn("text-white/40 transition-transform", isVersionOpen && "rotate-180")} />
              </button>

              <AnimatePresence>
                {isVersionOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute z-10 top-full left-0 right-0 mt-1 bg-[#222224] border border-white/10 rounded-lg max-h-48 overflow-y-auto"
                  >
                    {versions.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => {
                          setVersion(v.id);
                          setIsVersionOpen(false);
                        }}
                        className={cn(
                          "w-full px-3 py-2 text-sm text-left hover:bg-white/10 transition-colors",
                          version === v.id && "bg-emerald-500/20 text-emerald-400"
                        )}
                      >
                        {v.id}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Modloader */}
          <div>
            <label className="text-sm font-bold text-white mb-2 flex items-center gap-1">
              Modloader
              <span className="w-4 h-4 rounded-full border border-white/20 text-[10px] flex items-center justify-center text-white/40">?</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {LOADERS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLoader(l.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all",
                    loader === l.id
                      ? "bg-green-400 text-black font-medium"
                      : "bg-white/5 text-white/60 hover:bg-white/10"
                  )}
                >
                  <div
                    className={cn(
                      "w-3 h-3 rounded-full border-2",
                      loader === l.id ? "border-black bg-black" : "border-white/30"
                    )}
                  >
                    {loader === l.id && (
                      <div className="w-full h-full rounded-full bg-green-500 scale-50" />
                    )}
                  </div>
                  {l.name}
                </button>
              ))}
            </div>
          </div>

          {/* Modloader Version */}
          {loader !== "vanilla" && (
            <div>
              <label className="text-sm font-bold text-white mb-2 block">Versão do Loader</label>
              <div className="relative">
                <button
                  onClick={() => setIsLoaderVersionOpen(!isLoaderVersionOpen)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-left flex items-center justify-between hover:bg-white/10 transition-colors"
                >
                  <span>{loadingLoaderVersions ? "Carregando..." : loaderVersion || "Selecione..."}</span>
                  <ChevronDown size={16} className={cn("text-white/40 transition-transform", isLoaderVersionOpen && "rotate-180")} />
                </button>

                <AnimatePresence>
                  {isLoaderVersionOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute z-10 top-full left-0 right-0 mt-1 bg-[#222224] border border-white/10 rounded-lg max-h-48 overflow-y-auto"
                    >
                      {loaderVersions.map((v) => (
                        <button
                          key={v}
                          onClick={() => {
                            setLoaderVersion(v);
                            setIsLoaderVersionOpen(false);
                          }}
                          className={cn(
                            "w-full px-3 py-2 text-sm text-left hover:bg-white/10 transition-colors",
                            loaderVersion === v && "bg-emerald-500/20 text-emerald-400"
                          )}
                        >
                          {loader}-{v}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-white/5">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-sm font-medium hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || !version}
            className="px-5 py-2 rounded-lg text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </motion.div>
    </div>
  );
}
