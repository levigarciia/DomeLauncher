import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../../lib/utils";

interface MenuContextualProps {
    aberto: boolean;
    x: number;
    y: number;
    onFechar: () => void;
    children: ReactNode;
    largura?: number;
    rotulo?: string;
}

export function MenuContextual({
    aberto,
    x,
    y,
    onFechar,
    children,
    largura = 240,
    rotulo = "Menu contextual",
}: MenuContextualProps) {
    const menuRef = useRef<HTMLDivElement | null>(null);
    const [posicao, setPosicao] = useState({ x, y });

    useLayoutEffect(() => {
        if (!aberto) return;

        const margem = 8;
        const larguraMenu = menuRef.current?.offsetWidth ?? largura;
        const alturaMenu = menuRef.current?.offsetHeight ?? 240;
        setPosicao({
            x: Math.max(margem, Math.min(x, window.innerWidth - larguraMenu - margem)),
            y: Math.max(margem, Math.min(y, window.innerHeight - alturaMenu - margem)),
        });

        const fecharComEscape = (evento: KeyboardEvent) => {
            if (evento.key === "Escape") onFechar();
        };
        const fecharAoMudarViewport = () => onFechar();
        window.addEventListener("keydown", fecharComEscape);
        window.addEventListener("resize", fecharAoMudarViewport);
        window.addEventListener("scroll", fecharAoMudarViewport, true);
        return () => {
            window.removeEventListener("keydown", fecharComEscape);
            window.removeEventListener("resize", fecharAoMudarViewport);
            window.removeEventListener("scroll", fecharAoMudarViewport, true);
        };
    }, [aberto, largura, onFechar, x, y]);

    return (
        <AnimatePresence>
            {aberto && (
                <>
                    <button
                        type="button"
                        aria-label="Fechar menu contextual"
                        className="fixed inset-0 z-[79] cursor-default"
                        onClick={onFechar}
                        onContextMenu={(evento) => {
                            evento.preventDefault();
                            onFechar();
                        }}
                    />
                    <motion.div
                        ref={menuRef}
                        role="menu"
                        aria-label={rotulo}
                        initial={{ opacity: 0, scale: 0.97, y: -3 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97, y: -3 }}
                        transition={{ duration: 0.1 }}
                        className="fixed z-[80] overflow-hidden rounded-xl border border-white/15 bg-[#171719] p-1.5 shadow-2xl"
                        style={{ left: posicao.x, top: posicao.y, width: largura }}
                        onMouseDown={(evento) => evento.stopPropagation()}
                        onContextMenu={(evento) => evento.preventDefault()}
                    >
                        {children}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

export function CabecalhoMenuContextual({
    titulo,
    subtitulo,
}: {
    titulo: string;
    subtitulo?: string;
}) {
    return (
        <div className="border-b border-white/8 px-3 pb-2 pt-1.5">
            <p className="truncate text-xs font-black text-white">{titulo}</p>
            {subtitulo && <p className="mt-0.5 truncate text-[10px] text-white/35">{subtitulo}</p>}
        </div>
    );
}

export function ItemMenuContextual({
    icone,
    children,
    onClick,
    perigo = false,
    destaque = false,
    disabled = false,
    sufixo,
}: {
    icone: ReactNode;
    children: ReactNode;
    onClick: () => void;
    perigo?: boolean;
    destaque?: boolean;
    disabled?: boolean;
    sufixo?: ReactNode;
}) {
    return (
        <button
            type="button"
            role="menuitem"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold",
                "transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                perigo
                    ? "text-red-300/80 hover:bg-red-500/10 hover:text-red-200"
                    : destaque
                      ? "text-emerald-300 hover:bg-emerald-500/10"
                      : "text-white/70 hover:bg-white/7 hover:text-white"
            )}
        >
            <span className="grid h-4 w-4 shrink-0 place-items-center">{icone}</span>
            <span className="min-w-0 flex-1 truncate">{children}</span>
            {sufixo && <span className="shrink-0 text-[9px] text-white/30">{sufixo}</span>}
        </button>
    );
}

export function SeparadorMenuContextual() {
    return <div className="my-1 border-t border-white/8" />;
}

export function RotuloMenuContextual({ children }: { children: ReactNode }) {
    return (
        <p className="px-3 pb-1 pt-1 text-[9px] font-black uppercase tracking-[0.16em] text-white/25">
            {children}
        </p>
    );
}
