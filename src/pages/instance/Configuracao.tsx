import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
    AlertCircle,
    Check,
    ChevronDown,
    ChevronUp,
    Gamepad2,
    HardDrive,
    Loader2,
    Monitor,
    Package,
    Terminal,
} from "../../iconesPixelados";
import { cn } from "../../lib/utils";

interface ConfiguracaoProps {
    instanceId: string;
    minecraftVersion: string;
    loaderType?: string;
    loaderVersion?: string;
    memoriaPersonalizada?: number | null;
    argumentosJvm?: string | null;
    largura?: number;
    altura?: number;
    onSalvar: () => Promise<void> | void;
    onVersaoAlterada?: () => Promise<void> | void;
}

interface ConfiguracoesGlobais {
    ram_mb: number;
    java_args: string;
}

interface VersaoMinecraftDisponivel {
    id: string;
    type: string;
}

interface ManifestoVersoesMinecraft {
    versions: VersaoMinecraftDisponivel[];
}

interface RespostaVersoesLoader {
    versions: Array<{ version: string }>;
}

const MEMORIA_MINIMA_MB = 512;
const MEMORIA_MAXIMA_MB = 32768;
const ATRASO_SALVAMENTO_MS = 180;

const PRESETS_JVM = [
    {
        nome: "Padrão",
        descricao: "Configuração balanceada",
        argumentos: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200",
    },
    {
        nome: "Performance",
        descricao: "Otimizado para FPS alto",
        argumentos: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 "
            + "-XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 "
            + "-XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 "
            + "-XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4",
    },
    {
        nome: "Mínimo",
        descricao: "Sem argumentos extras",
        argumentos: "",
    },
] as const;

function limitarMemoria(memoria: number, memoriaSistema: number): number {
    const limite = Math.max(MEMORIA_MINIMA_MB, Math.min(memoriaSistema, MEMORIA_MAXIMA_MB));
    return Math.min(Math.max(memoria, MEMORIA_MINIMA_MB), limite);
}

function assinaturaMemoria(usarPersonalizada: boolean, memoriaMb: number): string {
    return usarPersonalizada ? `personalizada:${memoriaMb}` : "global";
}

function assinaturaResolucao(largura: number, altura: number): string {
    return `${largura}x${altura}`;
}

export default function Configuracao({
    instanceId,
    minecraftVersion,
    loaderType,
    loaderVersion,
    memoriaPersonalizada,
    argumentosJvm,
    largura = 854,
    altura = 480,
    onSalvar,
    onVersaoAlterada,
}: ConfiguracaoProps) {
    const [versoesMinecraft, setVersoesMinecraft] = useState<VersaoMinecraftDisponivel[]>([]);
    const [versoesLoader, setVersoesLoader] = useState<string[]>([]);
    const [minecraftSelecionado, setMinecraftSelecionado] = useState(minecraftVersion);
    const [loaderSelecionado, setLoaderSelecionado] = useState(loaderVersion ?? "");
    const [carregandoMinecraft, setCarregandoMinecraft] = useState(true);
    const [carregandoLoader, setCarregandoLoader] = useState(false);
    const [salvandoVersao, setSalvandoVersao] = useState(false);
    const [mensagemVersao, setMensagemVersao] = useState<string | null>(null);
    const [usarMemoriaPersonalizada, setUsarMemoriaPersonalizada] = useState(
        memoriaPersonalizada != null,
    );
    const [memoriaMb, setMemoriaMb] = useState(memoriaPersonalizada ?? 4096);
    const [memoriaGlobalMb, setMemoriaGlobalMb] = useState(4096);
    const [memoriaSistemaMb, setMemoriaSistemaMb] = useState(16384);
    const [argumentosJvmEditaveis, setArgumentosJvmEditaveis] = useState(argumentosJvm ?? "");
    const [argumentosJvmAlterados, setArgumentosJvmAlterados] = useState(false);
    const [jvmAberto, setJvmAberto] = useState(false);
    const [larguraEditavel, setLarguraEditavel] = useState(String(largura));
    const [alturaEditavel, setAlturaEditavel] = useState(String(altura));
    const [configuracaoCarregada, setConfiguracaoCarregada] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const ultimaMemoriaSalvaRef = useRef(
        assinaturaMemoria(memoriaPersonalizada != null, memoriaPersonalizada ?? 4096),
    );
    const ultimosArgumentosSalvosRef = useRef(argumentosJvm);
    const ultimaResolucaoSalvaRef = useRef(assinaturaResolucao(largura, altura));
    const loaderNormalizado = (loaderType ?? "vanilla").toLowerCase();
    const possuiLoader = loaderNormalizado !== "vanilla";

    useEffect(() => {
        setMinecraftSelecionado(minecraftVersion);
        setLoaderSelecionado(loaderVersion ?? "");
        const usarPersonalizada = memoriaPersonalizada != null;
        setUsarMemoriaPersonalizada(usarPersonalizada);
        if (memoriaPersonalizada != null) setMemoriaMb(memoriaPersonalizada);
        ultimaMemoriaSalvaRef.current = assinaturaMemoria(
            usarPersonalizada,
            memoriaPersonalizada ?? memoriaMb,
        );
        setArgumentosJvmAlterados(false);
        ultimosArgumentosSalvosRef.current = argumentosJvm;
        if (argumentosJvm != null) setArgumentosJvmEditaveis(argumentosJvm);
        setLarguraEditavel(String(largura));
        setAlturaEditavel(String(altura));
        ultimaResolucaoSalvaRef.current = assinaturaResolucao(largura, altura);
    }, [instanceId, minecraftVersion, loaderVersion, memoriaPersonalizada, argumentosJvm, largura, altura]);

    useEffect(() => {
        setMensagemVersao(null);
    }, [instanceId]);

    useEffect(() => {
        let cancelado = false;

        const carregarVersoesMinecraft = async () => {
            setCarregandoMinecraft(true);
            try {
                const manifesto = await invoke<ManifestoVersoesMinecraft>("get_minecraft_versions");
                if (!cancelado) setVersoesMinecraft(manifesto.versions ?? []);
            } catch (falha) {
                if (!cancelado) setErro(String(falha));
            } finally {
                if (!cancelado) setCarregandoMinecraft(false);
            }
        };

        void carregarVersoesMinecraft();
        return () => {
            cancelado = true;
        };
    }, [instanceId]);

    useEffect(() => {
        let cancelado = false;
        if (!possuiLoader || !minecraftSelecionado) {
            setVersoesLoader([]);
            setLoaderSelecionado("");
            return () => {
                cancelado = true;
            };
        }

        const carregarVersoesLoader = async () => {
            setCarregandoLoader(true);
            setMensagemVersao(null);
            try {
                const resposta = await invoke<RespostaVersoesLoader>("get_loader_versions", {
                    loaderType: loaderNormalizado,
                    minecraftVersion: minecraftSelecionado,
                });
                if (cancelado) return;
                const versoes = (resposta.versions ?? []).map((item) => item.version);
                setVersoesLoader(versoes);
                setLoaderSelecionado((atual) => {
                    if (versoes.includes(atual)) return atual;
                    if (minecraftSelecionado === minecraftVersion && loaderVersion
                        && versoes.includes(loaderVersion)) {
                        return loaderVersion;
                    }
                    return versoes[0] ?? "";
                });
            } catch (falha) {
                if (!cancelado) {
                    setVersoesLoader([]);
                    setLoaderSelecionado("");
                    setErro(String(falha));
                }
            } finally {
                if (!cancelado) setCarregandoLoader(false);
            }
        };

        void carregarVersoesLoader();
        return () => {
            cancelado = true;
        };
    }, [instanceId, loaderNormalizado, loaderVersion, minecraftSelecionado, minecraftVersion, possuiLoader]);

    useEffect(() => {
        const carregarConfiguracaoGlobal = async () => {
            setConfiguracaoCarregada(false);
            try {
                const [configuracoes, memoriaSistema] = await Promise.all([
                    invoke<ConfiguracoesGlobais>("get_settings"),
                    invoke<number>("get_system_ram"),
                ]);
                setMemoriaGlobalMb(configuracoes.ram_mb);
                setMemoriaSistemaMb(memoriaSistema);
                if (memoriaPersonalizada == null) {
                    setMemoriaMb(limitarMemoria(configuracoes.ram_mb, memoriaSistema));
                }
                if (argumentosJvm == null) setArgumentosJvmEditaveis(configuracoes.java_args);
            } catch (falha) {
                console.error("Erro ao carregar configuração de desempenho da instância:", falha);
            } finally {
                setConfiguracaoCarregada(true);
            }
        };

        void carregarConfiguracaoGlobal();
    }, [instanceId]);

    useEffect(() => {
        if (!configuracaoCarregada) return;

        const assinatura = assinaturaMemoria(usarMemoriaPersonalizada, memoriaMb);
        if (assinatura === ultimaMemoriaSalvaRef.current) return;

        const temporizador = window.setTimeout(async () => {
            try {
                await invoke("update_instance_settings", {
                    instanceId,
                    memory: usarMemoriaPersonalizada ? memoriaMb : undefined,
                    usarMemoriaPersonalizada,
                });
                ultimaMemoriaSalvaRef.current = assinatura;
                setErro(null);
                await onSalvar();
            } catch (falha) {
                setErro(String(falha));
            }
        }, ATRASO_SALVAMENTO_MS);

        return () => window.clearTimeout(temporizador);
    }, [configuracaoCarregada, instanceId, memoriaMb, onSalvar, usarMemoriaPersonalizada]);

    useEffect(() => {
        if (!configuracaoCarregada || !argumentosJvmAlterados) return;
        if (argumentosJvmEditaveis === ultimosArgumentosSalvosRef.current) return;

        const temporizador = window.setTimeout(async () => {
            try {
                await invoke("update_instance_settings", {
                    instanceId,
                    javaArgs: argumentosJvmEditaveis,
                    usarArgumentosJvmPersonalizados: true,
                });
                ultimosArgumentosSalvosRef.current = argumentosJvmEditaveis;
                setArgumentosJvmAlterados(false);
                setErro(null);
                await onSalvar();
            } catch (falha) {
                setErro(String(falha));
            }
        }, ATRASO_SALVAMENTO_MS);

        return () => window.clearTimeout(temporizador);
    }, [argumentosJvmAlterados, argumentosJvmEditaveis, configuracaoCarregada, instanceId, onSalvar]);

    useEffect(() => {
        if (!configuracaoCarregada) return;

        const novaLargura = Number.parseInt(larguraEditavel, 10);
        const novaAltura = Number.parseInt(alturaEditavel, 10);
        if (!Number.isFinite(novaLargura) || !Number.isFinite(novaAltura)) return;
        if (novaLargura < 320 || novaLargura > 7680 || novaAltura < 240 || novaAltura > 4320) return;

        const assinatura = assinaturaResolucao(novaLargura, novaAltura);
        if (assinatura === ultimaResolucaoSalvaRef.current) return;

        const temporizador = window.setTimeout(async () => {
            try {
                await invoke("update_instance_settings", {
                    instanceId,
                    width: novaLargura,
                    height: novaAltura,
                });
                ultimaResolucaoSalvaRef.current = assinatura;
                setErro(null);
                await onSalvar();
            } catch (falha) {
                setErro(String(falha));
            }
        }, ATRASO_SALVAMENTO_MS);

        return () => window.clearTimeout(temporizador);
    }, [alturaEditavel, configuracaoCarregada, instanceId, larguraEditavel, onSalvar]);

    const limiteMemoriaMb = useMemo(
        () => Math.max(MEMORIA_MINIMA_MB, Math.min(memoriaSistemaMb, MEMORIA_MAXIMA_MB)),
        [memoriaSistemaMb],
    );
    const memoriaEfetivaMb = usarMemoriaPersonalizada ? memoriaMb : memoriaGlobalMb;
    const proporcaoMemoria = Math.min(100, (memoriaEfetivaMb / memoriaSistemaMb) * 100);

    const atualizarArgumentosJvm = (valor: string) => {
        setArgumentosJvmEditaveis(valor);
        setArgumentosJvmAlterados(true);
    };

    const versaoFoiAlterada = minecraftSelecionado !== minecraftVersion
        || (possuiLoader && loaderSelecionado !== (loaderVersion ?? ""));

    const aplicarNovaVersao = async () => {
        if (!versaoFoiAlterada || salvandoVersao) return;
        setSalvandoVersao(true);
        setMensagemVersao(null);
        setErro(null);
        try {
            await invoke("update_instance_version", {
                instanceId,
                minecraftVersion: minecraftSelecionado,
                loaderVersion: possuiLoader ? loaderSelecionado : undefined,
            });
            await onSalvar();
            await onVersaoAlterada?.();
            setMensagemVersao("Versão atualizada. Mods, configurações e mundos foram preservados.");
        } catch (falha) {
            setErro(String(falha));
        } finally {
            setSalvandoVersao(false);
        }
    };

    return (
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
            <section className="mr-auto max-w-3xl overflow-hidden border border-white/10 bg-[#171717]">
                <div className="flex items-center gap-3 border-b border-white/8 px-5 py-4">
                    <div className="grid h-9 w-9 shrink-0 place-items-center border border-emerald-400/20 bg-emerald-400/[0.06]">
                        <Gamepad2 size={16} className="text-emerald-300/80" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-white/90">Versão da instância</h2>
                        <p className="text-[10px] text-white/30">
                            Troque o Minecraft e a build compatível do loader
                        </p>
                    </div>
                </div>

                <div className="space-y-4 px-5 py-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="min-w-0">
                            <span className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">
                                <Gamepad2 size={11} /> Minecraft
                            </span>
                            <div className="relative">
                                <select
                                    value={minecraftSelecionado}
                                    disabled={carregandoMinecraft || salvandoVersao}
                                    onChange={(evento) => setMinecraftSelecionado(evento.target.value)}
                                    className="w-full appearance-none border border-white/10 bg-white/[0.025] px-3 py-2.5 pr-9 text-sm font-bold text-white/80 outline-none transition-colors focus:border-emerald-400/35 disabled:opacity-50"
                                >
                                    {versoesMinecraft.map((versao) => (
                                        <option key={versao.id} value={versao.id} className="bg-[#171717]">
                                            {versao.id}{versao.type === "release" ? "" : ` · ${versao.type}`}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown size={13} className="pointer-events-none absolute right-3 top-3.5 text-white/30" />
                            </div>
                        </label>

                        <label className="min-w-0">
                            <span className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">
                                <Package size={11} /> {possuiLoader ? loaderType : "Modloader"}
                            </span>
                            <div className="relative">
                                <select
                                    value={possuiLoader ? loaderSelecionado : "vanilla"}
                                    disabled={!possuiLoader || carregandoLoader || salvandoVersao}
                                    onChange={(evento) => setLoaderSelecionado(evento.target.value)}
                                    className="w-full appearance-none border border-white/10 bg-white/[0.025] px-3 py-2.5 pr-9 text-sm font-bold text-white/80 outline-none transition-colors focus:border-emerald-400/35 disabled:opacity-50"
                                >
                                    {!possuiLoader && <option value="vanilla">Vanilla</option>}
                                    {versoesLoader.map((versao) => (
                                        <option key={versao} value={versao} className="bg-[#171717]">
                                            {versao}
                                        </option>
                                    ))}
                                </select>
                                {carregandoLoader
                                    ? <Loader2 size={13} className="absolute right-3 top-3.5 animate-spin text-emerald-300/60" />
                                    : <ChevronDown size={13} className="pointer-events-none absolute right-3 top-3.5 text-white/30" />}
                            </div>
                        </label>
                    </div>

                    {versaoFoiAlterada && (
                        <div className="flex items-start gap-2 border-l-2 border-amber-400/55 bg-amber-400/[0.045] px-3 py-2.5">
                            <AlertCircle size={13} className="mt-0.5 shrink-0 text-amber-300/80" />
                            <p className="text-[10px] leading-relaxed text-amber-100/55">
                                O conteúdo será preservado, mas mods instalados podem não funcionar na nova versão.
                            </p>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
                        <p className="text-[10px] text-white/30">
                            Atual: Minecraft {minecraftVersion}
                            {possuiLoader && loaderVersion ? ` · ${loaderType} ${loaderVersion}` : " · Vanilla"}
                        </p>
                        <button
                            type="button"
                            disabled={!versaoFoiAlterada || carregandoLoader || !minecraftSelecionado
                                || (possuiLoader && !loaderSelecionado) || salvandoVersao}
                            onClick={() => void aplicarNovaVersao()}
                            className="flex items-center gap-2 border border-emerald-400/35 bg-emerald-400/15 px-4 py-2 text-xs font-black text-emerald-200 transition-colors hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                            {salvandoVersao
                                ? <Loader2 size={13} className="animate-spin" />
                                : <Check size={13} />}
                            {salvandoVersao ? "Preparando versão..." : "Aplicar versão"}
                        </button>
                    </div>

                    {mensagemVersao && (
                        <p className="flex items-center gap-2 text-[10px] text-emerald-300/70">
                            <Check size={12} /> {mensagemVersao}
                        </p>
                    )}
                </div>
            </section>

            <section className="mr-auto max-w-3xl overflow-hidden border border-white/10 bg-[#171717]">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/8 px-5 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="grid h-9 w-9 shrink-0 place-items-center border border-white/10 bg-white/[0.025]">
                            <HardDrive size={15} className="text-emerald-300/75" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-sm font-bold text-white/90">Desempenho</h2>
                            <p className="truncate text-[10px] text-white/30">
                                Memória do modpack e configurações da JVM
                            </p>
                        </div>
                    </div>

                    <label className="flex cursor-pointer items-center gap-2.5">
                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
                            Alocação própria
                        </span>
                        <input
                            type="checkbox"
                            className="sr-only"
                            checked={usarMemoriaPersonalizada}
                            onChange={(evento) => setUsarMemoriaPersonalizada(evento.target.checked)}
                        />
                        <span
                            className={cn(
                                "relative h-6 w-11 border transition-colors",
                                usarMemoriaPersonalizada
                                    ? "border-emerald-400/55 bg-emerald-400/25"
                                    : "border-white/15 bg-white/[0.04]",
                            )}
                        >
                            <span
                                className={cn(
                                    "absolute left-1 top-1 h-3.5 w-3.5 bg-white transition-transform",
                                    usarMemoriaPersonalizada ? "translate-x-5" : "translate-x-0",
                                )}
                            />
                        </span>
                    </label>
                </div>

                <div className="space-y-4 px-5 py-5">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <p className="flex items-center gap-2 text-sm font-bold text-white/85">
                                <HardDrive size={12} /> Memória RAM do modpack
                            </p>
                            <p className="mt-2 text-[11px] leading-relaxed text-white/35">
                                {usarMemoriaPersonalizada
                                    ? "Este modpack utiliza uma alocação exclusiva."
                                    : "Usando a memória RAM padrão definida nas configurações do Launcher."}
                            </p>
                        </div>
                        <p className="text-lg font-black tabular-nums text-emerald-300">
                            {(memoriaEfetivaMb / 1024).toFixed(1)} GB
                            <span className="ml-1 text-[10px] text-white/35">
                                / {(memoriaSistemaMb / 1024).toFixed(0)} GB
                            </span>
                        </p>
                    </div>

                    <div className={cn("space-y-3", !usarMemoriaPersonalizada && "opacity-55")}>
                        <div className="relative">
                            <div className="h-2 overflow-hidden bg-white/[0.06]">
                                <motion.div
                                    className={cn("h-full", proporcaoMemoria > 75 ? "bg-amber-400" : "bg-emerald-400")}
                                    animate={{ width: `${proporcaoMemoria}%` }}
                                />
                            </div>
                            <input
                                type="range"
                                min={MEMORIA_MINIMA_MB}
                                max={limiteMemoriaMb}
                                step={512}
                                value={limitarMemoria(memoriaMb, memoriaSistemaMb)}
                                disabled={!usarMemoriaPersonalizada}
                                onChange={(evento) => setMemoriaMb(Number.parseInt(evento.target.value, 10))}
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                            />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-white/35">
                            <span>512 MB</span>
                            <div className="flex gap-2">
                                {[2, 4, 8, 16].map((gb) =>
                                    gb * 1024 <= limiteMemoriaMb ? (
                                        <button
                                            key={gb}
                                            type="button"
                                            disabled={!usarMemoriaPersonalizada}
                                            onClick={() => setMemoriaMb(gb * 1024)}
                                            className={cn(
                                                "px-1.5 py-0.5 transition-colors",
                                                memoriaMb === gb * 1024 ? "text-emerald-300" : "hover:text-white/70",
                                            )}
                                        >
                                            {gb} GB
                                        </button>
                                    ) : null,
                                )}
                            </div>
                            <span>{(limiteMemoriaMb / 1024).toFixed(0)} GB</span>
                        </div>
                    </div>

                    {proporcaoMemoria > 75 && (
                        <p className="flex items-center gap-2 text-[10px] text-amber-300/70">
                            <AlertCircle size={12} /> Mais de 75% da RAM pode deixar o sistema instável.
                        </p>
                    )}

                    <div className="space-y-3 border-t border-white/8 pt-4">
                        <div>
                            <p className="flex items-center gap-2 text-sm font-bold text-white/85">
                                <Monitor size={13} /> Resolução da janela
                            </p>
                            <p className="mt-1 text-[11px] text-white/35">
                                Tamanho usado ao iniciar esta instância em modo janela.
                            </p>
                        </div>

                        <div className="flex max-w-md items-center gap-2">
                            <label className="min-w-0 flex-1">
                                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-white/35">
                                    Largura
                                </span>
                                <input
                                    type="number"
                                    min={320}
                                    max={7680}
                                    value={larguraEditavel}
                                    onChange={(evento) => setLarguraEditavel(evento.target.value)}
                                    className="w-full border border-white/10 bg-white/[0.025] px-3 py-2 text-sm font-bold tabular-nums text-white/80 outline-none transition-colors focus:border-emerald-400/35"
                                />
                            </label>
                            <span className="mt-5 text-sm font-bold text-white/25">×</span>
                            <label className="min-w-0 flex-1">
                                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-white/35">
                                    Altura
                                </span>
                                <input
                                    type="number"
                                    min={240}
                                    max={4320}
                                    value={alturaEditavel}
                                    onChange={(evento) => setAlturaEditavel(evento.target.value)}
                                    className="w-full border border-white/10 bg-white/[0.025] px-3 py-2 text-sm font-bold tabular-nums text-white/80 outline-none transition-colors focus:border-emerald-400/35"
                                />
                            </label>
                        </div>
                    </div>

                    <div className="space-y-3 border-t border-white/8 pt-4">
                        <button
                            type="button"
                            onClick={() => setJvmAberto((aberto) => !aberto)}
                            className="flex w-full items-center justify-between text-sm font-medium text-white/60 transition-colors hover:text-white/85"
                        >
                            <span className="flex items-center gap-2">
                                <Terminal size={13} /> Argumentos JVM
                            </span>
                            {jvmAberto ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>

                        <AnimatePresence initial={false}>
                            {jvmAberto && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="space-y-3 overflow-hidden"
                                >
                                    <div className="grid grid-cols-3 gap-2">
                                        {PRESETS_JVM.map((preset) => (
                                            <button
                                                key={preset.nome}
                                                type="button"
                                                onClick={() => atualizarArgumentosJvm(preset.argumentos)}
                                                className={cn(
                                                    "border px-3 py-2 text-xs font-medium transition-colors",
                                                    argumentosJvmEditaveis === preset.argumentos
                                                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                                                        : "border-white/8 bg-white/[0.025] text-white/45 hover:border-white/15 hover:text-white/65",
                                                )}
                                            >
                                                <span className="block font-bold">{preset.nome}</span>
                                                <span className="mt-0.5 block text-[9px] opacity-60">
                                                    {preset.descricao}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                    <textarea
                                        value={argumentosJvmEditaveis}
                                        onChange={(evento) => atualizarArgumentosJvm(evento.target.value)}
                                        placeholder="-XX:+UseG1GC ..."
                                        rows={4}
                                        className="w-full resize-none border border-white/8 bg-white/[0.025] p-3 font-mono text-xs leading-relaxed text-white/70 outline-none focus:border-emerald-400/30"
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {erro && <p className="text-[10px] text-red-300/75">{erro}</p>}
                </div>
            </section>
        </div>
    );
}
