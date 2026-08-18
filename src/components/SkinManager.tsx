import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Upload, Loader2 } from "../iconesPixelados";
import { invoke } from "@tauri-apps/api/core";
import { MinecraftAccount } from "../App";
import { cn } from "../lib/utils";
import { SkinPreviewRenderer } from "./SkinPreviewRenderer";
import { MiniaturaSkinMinecraft } from "./MiniaturaSkinMinecraft";
import { SKINS_PADRAO, type SkinPadrao } from "../assets/skinsPadrao";

interface SkinManagerProps {
  user: MinecraftAccount | null;
}

interface CapaMinecraft {
  id: string;
  state: string;
  url: string;
  alias: string;
}

interface CosmeticosSkin {
  variant: "classic" | "slim";
  skinUrl?: string | null;
  capes: CapaMinecraft[];
}

interface SkinAtualBaixada {
  variant: "classic" | "slim";
  bytes: number[];
}

interface SkinSalva {
  id: string;
  nome: string;
  variant: "classic" | "slim";
  bytes: number[];
  salvaEm: number;
}

const CHAVE_SKINS_SALVAS = "dome-skins-salvas";

function carregarSkinsSalvas(): SkinSalva[] {
  try {
    const valor = localStorage.getItem(CHAVE_SKINS_SALVAS);
    return valor ? (JSON.parse(valor) as SkinSalva[]) : [];
  } catch {
    return [];
  }
}

function identificarBytes(bytes: number[]): string {
  let hash = 2166136261;
  bytes.forEach((byte) => {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  });
  return (hash >>> 0).toString(16);
}

function bytesParaDataUrl(bytes: number[]): string {
  let binario = "";
  for (let indice = 0; indice < bytes.length; indice += 8192) {
    binario += String.fromCharCode(...bytes.slice(indice, indice + 8192));
  }
  return `data:image/png;base64,${btoa(binario)}`;
}

export function SkinManager({ user }: SkinManagerProps) {
  const [dragActive, setDragActive] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [modoEditor, setModoEditor] = useState<"skin" | "capa">("skin");
  const inputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">(
    "idle"
  );
  const [variant, setVariant] = useState<"classic" | "slim">("classic");
  const [variantOriginal, setVariantOriginal] = useState<"classic" | "slim">("classic");
  const [aplicandoSkinPadrao, setAplicandoSkinPadrao] = useState<string | null>(null);
  const [mensagemStatus, setMensagemStatus] = useState<string | null>(null);
  const [erroStatus, setErroStatus] = useState<string | null>(null);
  const [cachePreview, setCachePreview] = useState(() => Date.now());
  const [skinAtualUrl, setSkinAtualUrl] = useState<string | null>(null);
  const [capas, setCapas] = useState<CapaMinecraft[]>([]);
  const [capaSelecionadaId, setCapaSelecionadaId] = useState<string | null>(null);
  const [capaOriginalId, setCapaOriginalId] = useState<string | null>(null);
  const [skinsSalvas, setSkinsSalvas] = useState<SkinSalva[]>(carregarSkinsSalvas);

  const previewSkinUrl = useMemo(() => {
    if (!user) return "";
    return skinAtualUrl || `https://visage.surgeplay.com/skin/${user.uuid}?t=${cachePreview}`;
  }, [cachePreview, skinAtualUrl, user]);
  const previewEditorUrl = useMemo(
    () => (selectedFile ? URL.createObjectURL(selectedFile) : previewSkinUrl),
    [previewSkinUrl, selectedFile]
  );

  useEffect(() => {
    return () => {
      if (previewEditorUrl.startsWith("blob:")) URL.revokeObjectURL(previewEditorUrl);
    };
  }, [previewEditorUrl]);

  const carregarCosmeticos = useCallback(async () => {
    if (!user) return;
    try {
      const cosmeticos = await invoke<CosmeticosSkin>("obter_cosmeticos_skin", {
        accessToken: user.access_token,
      });
      setVariant(cosmeticos.variant);
      setVariantOriginal(cosmeticos.variant);
      setSkinAtualUrl(cosmeticos.skinUrl || null);
      setCapas(cosmeticos.capes || []);
      const capaAtiva = cosmeticos.capes.find((capa) => capa.state.toLowerCase() === "active");
      setCapaSelecionadaId(capaAtiva?.id || null);
      setCapaOriginalId(capaAtiva?.id || null);
    } catch (erro) {
      console.warn("Não foi possível carregar skins e capas:", erro);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let ativo = true;
    void carregarCosmeticos().then(() => {
      if (!ativo) return;
    });

    return () => {
      ativo = false;
    };
  }, [cachePreview, carregarCosmeticos, user]);

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-lg rounded-2xl border border-white/10 bg-[#121214] p-8 text-center">
          <h2 className="text-2xl font-bold">Faça login para gerenciar skins</h2>
          <p className="mt-2 text-sm text-white/55">
            Entre com sua conta Microsoft para enviar e trocar skins.
          </p>
        </div>
      </div>
    );
  }

  const limparMensagens = () => {
    setMensagemStatus(null);
    setErroStatus(null);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      openUploadModal(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      openUploadModal(e.target.files[0]);
    }
  };

  const openUploadModal = (file: File) => {
    limparMensagens();
    setSelectedFile(file);
    setModoEditor("skin");
    setIsUploadModalOpen(true);
    setUploadStatus("idle");
  };

  const abrirEditorSkin = () => {
    limparMensagens();
    setSelectedFile(null);
    setModoEditor("skin");
    setIsUploadModalOpen(true);
    setUploadStatus("idle");
  };

  const abrirEditorCapa = () => {
    limparMensagens();
    setSelectedFile(null);
    setModoEditor("capa");
    setIsUploadModalOpen(true);
    setUploadStatus("idle");
  };

  const persistirSkinsSalvas = (proximasSkins: SkinSalva[]) => {
    const limitadas = proximasSkins.slice(0, 12);
    setSkinsSalvas(limitadas);
    localStorage.setItem(CHAVE_SKINS_SALVAS, JSON.stringify(limitadas));
  };

  const preservarSkinAtual = async () => {
    if (!user) return;
    try {
      const atual = await invoke<SkinAtualBaixada>("baixar_skin_atual", {
        accessToken: user.access_token,
      });
      const id = identificarBytes(atual.bytes);
      if (skinsSalvas.some((skin) => skin.id === id)) return;

      persistirSkinsSalvas([
        {
          id,
          nome: `Skin de ${new Date().toLocaleDateString("pt-BR")}`,
          variant: atual.variant,
          bytes: atual.bytes,
          salvaEm: Date.now(),
        },
        ...skinsSalvas,
      ]);
    } catch (erro) {
      console.warn("Não foi possível preservar a skin anterior:", erro);
    }
  };

  const enviarSkin = async (
    bytes: number[],
    variante: "classic" | "slim",
    preservarAnterior = true
  ) => {
    if (preservarAnterior) await preservarSkinAtual();
    await invoke("upload_skin", {
      accessToken: user.access_token,
      variant: variante,
      skinBytes: bytes,
    });
    setCachePreview(Date.now());
    await carregarCosmeticos();
  };

  const aplicarSkinPadrao = async (skin: SkinPadrao) => {
    limparMensagens();
    setAplicandoSkinPadrao(skin.textureUrl);
    setVariant(skin.variant);
    try {
      const resposta = await fetch(skin.textureUrl);
      if (!resposta.ok) {
        throw new Error(`Falha ao baixar skin padrão (${resposta.status})`);
      }
      const bytesBuffer = await resposta.arrayBuffer();
      const bytes = Array.from(new Uint8Array(bytesBuffer));
      await enviarSkin(bytes, skin.variant);
      setMensagemStatus(`Skin ${skin.name} aplicada com sucesso.`);
    } catch (erro) {
      console.error("Erro ao aplicar skin padrão:", erro);
      setErroStatus(`Não foi possível aplicar a skin ${skin.name}.`);
    } finally {
      setAplicandoSkinPadrao(null);
    }
  };

  const aplicarSkinSalva = async (skin: SkinSalva) => {
    limparMensagens();
    setAplicandoSkinPadrao(skin.id);
    try {
      await enviarSkin(skin.bytes, skin.variant);
      setVariant(skin.variant);
      setMensagemStatus("Skin salva aplicada.");
    } catch (erro) {
      console.error("Erro ao aplicar skin salva:", erro);
      setErroStatus("Não foi possível aplicar a skin salva.");
    } finally {
      setAplicandoSkinPadrao(null);
    }
  };

  const salvarEditorAtual = async () => {
    setUploadStatus("uploading");
    limparMensagens();
    try {
      if (selectedFile) {
        const arrayBuffer = await selectedFile.arrayBuffer();
        await enviarSkin(Array.from(new Uint8Array(arrayBuffer)), variant);
      } else if (variant !== variantOriginal) {
        const atual = await invoke<SkinAtualBaixada>("baixar_skin_atual", {
          accessToken: user.access_token,
        });
        await enviarSkin(atual.bytes, variant);
      }
      if (capaSelecionadaId !== capaOriginalId) {
        await invoke("equipar_capa", {
          accessToken: user.access_token,
          capeId: capaSelecionadaId,
        });
      }
      await carregarCosmeticos();
      setUploadStatus("success");
      setMensagemStatus("Visual atualizado.");
      setTimeout(() => setIsUploadModalOpen(false), 700);
    } catch (erro) {
      console.error("Erro ao atualizar skin e capa:", erro);
      setUploadStatus("error");
      setErroStatus("Não foi possível atualizar a skin e a capa.");
    }
  };

  const capaAtualUrl = capas.find((capa) => capa.id === capaSelecionadaId)?.url;

  return (
    <div className="relative grid flex-1 grid-cols-1 gap-8 overflow-hidden p-8 lg:grid-cols-[1fr_2.5fr]">
      <div className="flex h-full flex-col items-center justify-center">
        <div className="w-full">
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            Skins
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
              Beta
            </span>
          </h1>
        </div>

        <div className="group relative z-10 mt-6 flex w-full cursor-grab flex-col items-center active:cursor-grabbing">
          <span className="mb-4 rounded border border-white/5 bg-black/40 px-3 py-1 text-xs text-white/70">
            {user.name}
          </span>

          <div className="flex h-[400px] w-full items-center justify-center drop-shadow-2xl transition-transform duration-500 hover:scale-105">
            <SkinPreviewRenderer
              skinUrl={previewSkinUrl}
              capeUrl={capaAtualUrl}
              model={variant}
              height={450}
              width={300}
            />
          </div>

          <span className="pointer-events-none mt-4 text-xs font-bold uppercase tracking-widest text-white/20 transition-colors group-hover:text-white/40">
            Arraste para girar
          </span>

          <button
            onClick={abrirEditorCapa}
            className="mt-6 flex items-center gap-2 rounded-lg border border-white/5 bg-[#1c1c1c] px-4 py-2 text-sm font-bold text-white/70 transition-all hover:bg-[#252525] hover:text-white"
          >
            Trocar capa
          </button>
        </div>
      </div>

      <div className="custom-scrollbar space-y-8 overflow-y-auto pr-4">
        {(mensagemStatus || erroStatus) && (
          <div
            className={cn(
              "rounded-xl border px-4 py-3 text-sm",
              erroStatus
                ? "border-red-400/30 bg-red-500/10 text-red-200"
                : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
            )}
          >
            {erroStatus || mensagemStatus}
          </div>
        )}

        <section>
          <h2 className="mb-4 text-lg font-bold text-white/90">Skins salvas</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
            <div
              onClick={abrirEditorSkin}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={cn(
                "group flex aspect-[0.85] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-all",
                dragActive
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "border-white/10 bg-[#121214] hover:border-white/20 hover:bg-[#18181b]"
              )}
            >
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept=".png"
                onChange={handleFileChange}
              />
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 transition-transform group-hover:scale-110">
                <span className="text-2xl font-light text-white/50">+</span>
              </div>
              <span className="text-sm font-bold text-white/50 transition-colors group-hover:text-white">
                Adicionar skin
              </span>
            </div>

            <div className="relative aspect-[0.85] overflow-hidden rounded-xl border-2 border-emerald-500/50 bg-[#121214]">
              <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.08)_0,_transparent_60%)] p-4">
                <img
                  src={`https://mc-heads.net/body/${user.uuid}/right?t=${cachePreview}`}
                  className="h-full object-contain drop-shadow-lg"
                  alt={`Skin atual de ${user.name}`}
                />
              </div>
            </div>

            {skinsSalvas.map((skin) => {
              const carregando = aplicandoSkinPadrao === skin.id;
              return (
                <button
                  type="button"
                  key={skin.id}
                  onClick={() => void aplicarSkinSalva(skin)}
                  disabled={Boolean(aplicandoSkinPadrao)}
                  className="group relative aspect-[0.85] overflow-hidden rounded-xl border border-white/8 bg-[#121214] p-3 transition-colors hover:border-white/20 disabled:opacity-50"
                >
                  {carregando && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/65">
                      <Loader2 size={20} className="animate-spin text-emerald-400" />
                    </div>
                  )}
                  <img
                    src={bytesParaDataUrl(skin.bytes)}
                    alt={skin.nome}
                    className="h-full w-full object-contain [image-rendering:pixelated]"
                  />
                  <span className="absolute inset-x-2 bottom-2 truncate bg-black/70 px-2 py-1 text-[9px] font-bold text-white/75">
                    {skin.nome}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold text-white/90">Skins padrão</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
            {SKINS_PADRAO.map((skin) => {
              const carregando = aplicandoSkinPadrao === skin.textureUrl;
              return (
                <button
                  key={skin.name}
                  onClick={() => aplicarSkinPadrao(skin)}
                  disabled={Boolean(aplicandoSkinPadrao)}
                  className="group relative flex aspect-[0.85] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-[#121214] p-4 text-left transition-all hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {carregando && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/65">
                      <Loader2 size={20} className="animate-spin text-emerald-400" />
                    </div>
                  )}
                  <MiniaturaSkinMinecraft
                    skinUrl={skin.textureUrl}
                    modelo={skin.variant}
                    className="h-[90%] w-auto [image-rendering:pixelated] grayscale transition-all duration-300 group-hover:scale-110 group-hover:grayscale-0"
                  />
                  <div className="absolute bottom-2 left-0 right-0 text-center opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="rounded bg-black/50 px-2 py-1 text-[10px] font-bold uppercase tracking-widest">
                      {skin.name}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <AnimatePresence>
        {isUploadModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0, y: 12 }}
              className="relative grid max-h-[88vh] w-full max-w-3xl grid-cols-1 overflow-hidden rounded-2xl border border-white/10 bg-[#111113] shadow-2xl md:grid-cols-[0.8fr_1.2fr]"
            >
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="absolute right-4 top-4 z-20 rounded-lg p-1.5 text-white/30 transition-colors hover:bg-white/8 hover:text-white"
              >
                <X size={20} />
              </button>

              <div className="relative min-h-72 border-b border-white/8 bg-[radial-gradient(circle_at_50%_42%,rgba(52,211,153,0.09),transparent_58%)] md:border-b-0 md:border-r">
                <SkinPreviewRenderer
                  skinUrl={previewEditorUrl}
                  capeUrl={capas.find((capa) => capa.id === capaSelecionadaId)?.url}
                  model={variant}
                  className="h-full min-h-72"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-[9px] font-bold uppercase tracking-[0.18em] text-white/25">
                  Arraste para visualizar
                </div>
              </div>

              <div className="custom-scrollbar max-h-[88vh] overflow-y-auto p-6">
                <div className="mb-6 pr-8">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-400/75">
                    Aparência
                  </p>
                  <h3 className="mt-1 text-xl font-bold">
                    {modoEditor === "skin" ? "Editar skin" : "Escolher capa"}
                  </h3>
                </div>

                <div className="space-y-5">
                  {modoEditor === "skin" && (
                    <>
                      <section>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="text-xs font-bold text-white/65">Textura</span>
                          <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/4 px-2.5 py-1.5 text-[10px] font-bold text-white/60 transition-colors hover:bg-white/8 hover:text-white"
                          >
                            <Upload size={12} />
                            {selectedFile ? "Substituir" : "Escolher PNG"}
                          </button>
                        </div>
                        <div className="truncate rounded-lg border border-white/7 bg-black/20 px-3 py-2 text-[11px] text-white/40">
                          {selectedFile?.name || "Skin atual"}
                        </div>
                      </section>

                      <section>
                        <span className="mb-2 block text-xs font-bold text-white/65">Braços</span>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setVariant("classic")}
                            className={cn(
                              "rounded-lg border px-3 py-2 text-xs font-bold transition-colors",
                              variant === "classic"
                                ? "border-emerald-400/30 bg-emerald-400/8 text-emerald-200"
                                : "border-white/8 bg-white/3 text-white/40 hover:bg-white/6"
                            )}
                          >
                            Normal
                          </button>
                          <button
                            type="button"
                            onClick={() => setVariant("slim")}
                            className={cn(
                              "rounded-lg border px-3 py-2 text-xs font-bold transition-colors",
                              variant === "slim"
                                ? "border-emerald-400/30 bg-emerald-400/8 text-emerald-200"
                                : "border-white/8 bg-white/3 text-white/40 hover:bg-white/6"
                            )}
                          >
                            Slim
                          </button>
                        </div>
                      </section>
                    </>
                  )}

                  {modoEditor === "capa" && <section>
                    <span className="mb-2 block text-xs font-bold text-white/65">Capa</span>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setCapaSelecionadaId(null)}
                        className={cn(
                          "flex min-h-16 items-center justify-center rounded-lg border text-[10px] font-bold transition-colors",
                          capaSelecionadaId === null
                            ? "border-emerald-400/30 bg-emerald-400/8 text-emerald-200"
                            : "border-white/8 bg-white/3 text-white/35 hover:bg-white/6"
                        )}
                      >
                        Sem capa
                      </button>
                      {capas.map((capa) => (
                        <button
                          type="button"
                          key={capa.id}
                          onClick={() => setCapaSelecionadaId(capa.id)}
                          title={capa.alias || "Capa"}
                          className={cn(
                            "relative flex min-h-16 items-center justify-center overflow-hidden rounded-lg border p-2 transition-colors",
                            capaSelecionadaId === capa.id
                              ? "border-emerald-400/30 bg-emerald-400/8"
                              : "border-white/8 bg-white/3 hover:bg-white/6"
                          )}
                        >
                          <img
                            src={capa.url}
                            alt={capa.alias || "Capa"}
                            className="h-12 w-full object-contain [image-rendering:pixelated]"
                          />
                        </button>
                      ))}
                    </div>
                    {capas.length === 0 && (
                      <p className="mt-2 text-[10px] text-white/30">
                        Sua conta não possui capas disponíveis.
                      </p>
                    )}
                  </section>}

                  <button
                    type="button"
                    onClick={() => void salvarEditorAtual()}
                    disabled={uploadStatus === "uploading"}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-sm font-black text-black transition-colors hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {uploadStatus === "uploading" && (
                      <Loader2 className="animate-spin" size={16} />
                    )}
                    {uploadStatus === "success"
                      ? "Atualizado"
                      : modoEditor === "skin"
                        ? "Aplicar skin"
                        : "Aplicar capa"}
                  </button>
                  {uploadStatus === "error" && (
                    <p className="text-center text-[10px] text-red-300/80">
                      Não foi possível aplicar as alterações.
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
