import React, { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Upload, Loader2 } from "../iconesPixelados";
import { invoke } from "@tauri-apps/api/core";
import { MinecraftAccount } from "../App";
import { cn } from "../lib/utils";
import { SkinPreviewRenderer } from "./SkinPreviewRenderer";

interface SkinManagerProps {
  user: MinecraftAccount | null;
}

interface SkinPadrao {
  name: string;
  uuid: string;
  variant: "classic" | "slim";
}

const SKINS_PADRAO: SkinPadrao[] = [
  { name: "Steve", uuid: "c06f89064c8a49119c29ea1dbd1aab82", variant: "classic" },
  { name: "Alex", uuid: "MHF_Alex", variant: "slim" },
  { name: "Ari", uuid: "f6236d8042404eeb950119e496c21e64", variant: "classic" },
  { name: "Efe", uuid: "b21264c7820645c7ad8949826372d68e", variant: "slim" },
  { name: "Kai", uuid: "95195b0d00f644268735ac1964175373", variant: "classic" },
  { name: "Makena", uuid: "62572579044d47919242207b5a228f44", variant: "slim" },
  { name: "Noor", uuid: "1a4df83c74cb459f9c7370884d5930e4", variant: "slim" },
  { name: "Sunny", uuid: "1b1a7dbe88f3416e917c91350411c502", variant: "classic" },
  { name: "Zuri", uuid: "ddf40552b7814400a453f0607ba90a6e", variant: "classic" },
];

export function SkinManager({ user }: SkinManagerProps) {
  const [dragActive, setDragActive] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">(
    "idle"
  );
  const [variant, setVariant] = useState<"classic" | "slim">("classic");
  const [aplicandoSkinPadrao, setAplicandoSkinPadrao] = useState<string | null>(null);
  const [mensagemStatus, setMensagemStatus] = useState<string | null>(null);
  const [erroStatus, setErroStatus] = useState<string | null>(null);
  const [cachePreview, setCachePreview] = useState(() => Date.now());

  const previewSkinUrl = useMemo(() => {
    if (!user) return "";
    return `https://visage.surgeplay.com/skin/${user.uuid}?t=${cachePreview}`;
  }, [cachePreview, user]);

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
    setIsUploadModalOpen(true);
    setUploadStatus("idle");
  };

  const enviarSkin = async (bytes: number[], variante: "classic" | "slim") => {
    await invoke("upload_skin", {
      accessToken: user.access_token,
      variant: variante,
      skinBytes: bytes,
    });
    setCachePreview(Date.now());
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploadStatus("uploading");
    limparMensagens();

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const bytes = Array.from(new Uint8Array(arrayBuffer));
      await enviarSkin(bytes, variant);
      setUploadStatus("success");
      setMensagemStatus("Skin enviada com sucesso.");
      setTimeout(() => {
        setIsUploadModalOpen(false);
      }, 1200);
    } catch (err) {
      console.error(err);
      setUploadStatus("error");
      setErroStatus("Falha ao enviar skin. Verifique o arquivo e tente novamente.");
    }
  };

  const aplicarSkinPadrao = async (skin: SkinPadrao) => {
    limparMensagens();
    setAplicandoSkinPadrao(skin.uuid);
    setVariant(skin.variant);
    try {
      const resposta = await fetch(`https://mc-heads.net/skin/${skin.uuid}`);
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

  const abrirPaginaCapa = async () => {
    try {
      await invoke("open_browser", { url: "https://www.minecraft.net/pt-br/profile/skin" });
    } catch (erro) {
      console.error("Erro ao abrir página de capa:", erro);
      setErroStatus("Não foi possível abrir a página de capas no navegador.");
    }
  };

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
              model={variant}
              height={450}
              width={300}
            />
          </div>

          <span className="pointer-events-none mt-4 text-xs font-bold uppercase tracking-widest text-white/20 transition-colors group-hover:text-white/40">
            Arraste para girar
          </span>

          <button
            onClick={abrirPaginaCapa}
            className="mt-6 flex items-center gap-2 rounded-lg border border-white/5 bg-[#1c1c1c] px-4 py-2 text-sm font-bold text-white/70 transition-all hover:bg-[#252525] hover:text-white"
          >
            Trocar Capa
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
              onClick={() => inputRef.current?.click()}
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

            <div className="group relative aspect-[0.85] cursor-pointer overflow-hidden rounded-xl border-2 border-emerald-500/50 bg-[#121214]">
              <div className="absolute top-2 right-2 z-20 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => inputRef.current?.click()}
                  className="rounded-md bg-black/60 p-1.5 text-white transition-colors hover:bg-emerald-500 hover:text-black"
                >
                  <Upload size={14} />
                </button>
              </div>
              <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.08)_0,_transparent_60%)] p-4">
                <img
                  src={`https://mc-heads.net/body/${user.uuid}/right?t=${cachePreview}`}
                  className="h-full object-contain drop-shadow-lg"
                  alt={`Skin atual de ${user.name}`}
                />
              </div>
              <div className="pointer-events-none absolute inset-0 rounded-xl border-4 border-emerald-500/0 transition-all group-hover:border-emerald-500/20" />
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold text-white/90">Skins padrão</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
            {SKINS_PADRAO.map((skin) => {
              const carregando = aplicandoSkinPadrao === skin.uuid;
              return (
                <button
                  key={skin.uuid}
                  onClick={() => aplicarSkinPadrao(skin)}
                  disabled={Boolean(aplicandoSkinPadrao)}
                  className="group relative flex aspect-[0.85] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-[#121214] p-4 text-left transition-all hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {carregando && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/65">
                      <Loader2 size={20} className="animate-spin text-emerald-400" />
                    </div>
                  )}
                  <img
                    src={`https://mc-heads.net/body/${skin.uuid}/right`}
                    className="h-[90%] object-contain grayscale transition-all duration-300 group-hover:scale-110 group-hover:grayscale-0"
                    alt={skin.name}
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
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-[#121214] p-6"
            >
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="absolute top-4 right-4 text-white/20 hover:text-white"
              >
                <X size={20} />
              </button>

              <h3 className="mb-4 text-xl font-bold">Nova Skin</h3>

              <div className="mb-6 flex justify-center rounded-xl bg-black/20 p-4">
                <div className="text-center">
                  <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
                    <Upload className="text-emerald-400" />
                  </div>
                  <p className="text-sm font-medium text-white/80">{selectedFile?.name}</p>
                </div>
              </div>

              <div className="mb-6 flex rounded-lg bg-white/5 p-1">
                <button
                  onClick={() => setVariant("classic")}
                  className={cn(
                    "flex-1 rounded-md py-1.5 text-xs font-bold uppercase transition-all",
                    variant === "classic" ? "bg-white/10 text-white" : "text-white/40"
                  )}
                >
                  Classic
                </button>
                <button
                  onClick={() => setVariant("slim")}
                  className={cn(
                    "flex-1 rounded-md py-1.5 text-xs font-bold uppercase transition-all",
                    variant === "slim" ? "bg-white/10 text-white" : "text-white/40"
                  )}
                >
                  Slim
                </button>
              </div>

              <button
                onClick={handleUpload}
                disabled={uploadStatus === "uploading"}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 font-bold text-black transition-colors hover:bg-emerald-400 disabled:opacity-50"
              >
                {uploadStatus === "uploading" && <Loader2 className="animate-spin" size={18} />}
                {uploadStatus === "success" ? "Skin enviada!" : "Confirmar Upload"}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
