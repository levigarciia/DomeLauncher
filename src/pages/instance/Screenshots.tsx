import { useEffect, useRef, useState } from "react";
import { Image, Loader2, MoreVertical, RefreshCw, Trash2, X } from "../../iconesPixelados";
import { cn } from "../../lib/utils";

export interface ScreenshotInstancia {
    nome: string;
    dataUrl: string;
    modificadaEm: string;
}

interface ScreenshotsProps {
    screenshots: ScreenshotInstancia[];
    carregando: boolean;
    onAtualizar: () => void;
    onExcluir: (screenshot: ScreenshotInstancia) => void;
}

interface MenuContexto {
    screenshot: ScreenshotInstancia;
    x: number;
    y: number;
}

const formatarData = (valor: string): string => {
    if (!valor) return "";
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return "";
    return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
    }).format(data);
};

export default function Screenshots({
    screenshots,
    carregando,
    onAtualizar,
    onExcluir,
}: ScreenshotsProps) {
    const [ampliada, setAmpliada] = useState<ScreenshotInstancia | null>(null);
    const [menuContexto, setMenuContexto] = useState<MenuContexto | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!ampliada) return;
        const fecharComEscape = (evento: KeyboardEvent) => {
            if (evento.key === "Escape") setAmpliada(null);
        };
        window.addEventListener("keydown", fecharComEscape);
        return () => window.removeEventListener("keydown", fecharComEscape);
    }, [ampliada]);

    useEffect(() => {
        if (!menuContexto) return;
        const fecharMenu = (evento: MouseEvent) => {
            if (!menuRef.current?.contains(evento.target as Node)) setMenuContexto(null);
        };
        const fecharAoPerderFoco = () => setMenuContexto(null);
        window.addEventListener("mousedown", fecharMenu);
        window.addEventListener("blur", fecharAoPerderFoco);
        return () => {
            window.removeEventListener("mousedown", fecharMenu);
            window.removeEventListener("blur", fecharAoPerderFoco);
        };
    }, [menuContexto]);

    const abrirMenuContexto = (
        evento: React.MouseEvent,
        screenshot: ScreenshotInstancia
    ) => {
        evento.preventDefault();
        const larguraMenu = 190;
        const alturaMenu = 52;
        setMenuContexto({
            screenshot,
            x: Math.max(12, Math.min(evento.clientX, window.innerWidth - larguraMenu - 12)),
            y: Math.max(12, Math.min(evento.clientY, window.innerHeight - alturaMenu - 12)),
        });
    };

    const excluirSelecionada = () => {
        if (!menuContexto) return;
        const screenshot = menuContexto.screenshot;
        setMenuContexto(null);
        if (ampliada?.nome === screenshot.nome) setAmpliada(null);
        onExcluir(screenshot);
    };

    return (
        <div className="relative flex-1 overflow-y-auto p-6">
            <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                    <h2 className="text-lg font-bold text-white">Screenshots</h2>
                    <p className="mt-1 text-sm text-white/40">
                        Clique para ampliar ou use o botão direito para excluir.
                    </p>
                </div>
                <button
                    onClick={onAtualizar}
                    disabled={carregando}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                >
                    <RefreshCw size={14} className={cn(carregando && "animate-spin")} />
                    Atualizar
                </button>
            </div>

            {carregando ? (
                <div className="flex min-h-72 items-center justify-center">
                    <Loader2 size={32} className="animate-spin text-emerald-500" />
                </div>
            ) : screenshots.length === 0 ? (
                <div className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] text-center text-white/40">
                    <div>
                        <Image size={44} className="mx-auto mb-3 opacity-30" />
                        <p className="font-medium text-white/60">Nenhuma screenshot encontrada</p>
                        <p className="mt-1 text-sm">As capturas feitas no jogo aparecerão aqui.</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {screenshots.map((screenshot) => (
                        <button
                            key={screenshot.nome}
                            onClick={() => setAmpliada(screenshot)}
                            onContextMenu={(evento) => abrirMenuContexto(evento, screenshot)}
                            className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] text-left transition-all hover:-translate-y-0.5 hover:border-emerald-400/40 hover:bg-white/[0.06]"
                        >
                            <div className="relative aspect-video overflow-hidden bg-black/40">
                                <img
                                    src={screenshot.dataUrl}
                                    alt={screenshot.nome}
                                    loading="lazy"
                                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                                />
                                <div className="absolute right-2 top-2 rounded-md bg-black/60 p-1.5 text-white/70 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                                    <MoreVertical size={14} />
                                </div>
                            </div>
                            <div className="px-3 py-2.5">
                                <p className="truncate text-sm font-medium text-white" title={screenshot.nome}>
                                    {screenshot.nome}
                                </p>
                                <p className="mt-0.5 text-xs text-white/35">
                                    {formatarData(screenshot.modificadaEm)}
                                </p>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {menuContexto && (
                <div
                    ref={menuRef}
                    style={{ left: menuContexto.x, top: menuContexto.y }}
                    className="fixed z-[120] w-48 rounded-lg border border-white/10 bg-[#18181a] p-1.5 shadow-2xl"
                >
                    <button
                        onClick={excluirSelecionada}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-500/15"
                    >
                        <Trash2 size={15} />
                        Excluir screenshot
                    </button>
                </div>
            )}

            {ampliada && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Screenshot ${ampliada.nome}`}
                    onClick={() => setAmpliada(null)}
                    className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-8 backdrop-blur-sm"
                >
                    <button
                        onClick={() => setAmpliada(null)}
                        aria-label="Fechar screenshot"
                        className="absolute right-6 top-6 rounded-full border border-white/15 bg-black/50 p-2.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    >
                        <X size={22} />
                    </button>
                    <div onClick={(evento) => evento.stopPropagation()} className="flex max-h-full max-w-full flex-col items-center gap-4">
                        <img
                            src={ampliada.dataUrl}
                            alt={ampliada.nome}
                            className="max-h-[82vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
                        />
                        <p className="max-w-[90vw] truncate text-sm text-white/70">{ampliada.nome}</p>
                    </div>
                </div>
            )}
        </div>
    );
}
