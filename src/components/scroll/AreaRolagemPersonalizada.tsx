import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent,
    type ReactNode,
} from "react";
import { cn } from "../../lib/utils";

interface AreaRolagemPersonalizadaProps {
    children: ReactNode;
    className?: string;
    classNameConteudo?: string;
    rotulo?: string;
}

interface IndicadorRolagem {
    altura: number;
    topo: number;
    visivel: boolean;
}

export function AreaRolagemPersonalizada({
    children,
    className,
    classNameConteudo,
    rotulo = "Conteúdo rolável",
}: AreaRolagemPersonalizadaProps) {
    const areaRef = useRef<HTMLDivElement | null>(null);
    const conteudoRef = useRef<HTMLDivElement | null>(null);
    const arrasteRef = useRef<{ ponteiroId: number; inicioY: number; scrollInicial: number } | null>(null);
    const [indicador, setIndicador] = useState<IndicadorRolagem>({ altura: 0, topo: 0, visivel: false });

    const sincronizar = useCallback(() => {
        const area = areaRef.current;
        if (!area) return;

        const { clientHeight, scrollHeight, scrollTop } = area;
        if (scrollHeight <= clientHeight) {
            setIndicador({ altura: 0, topo: 0, visivel: false });
            return;
        }

        const alturaTrilho = Math.max(0, clientHeight - 16);
        const altura = Math.max(36, (alturaTrilho * clientHeight) / scrollHeight);
        const percurso = alturaTrilho - altura;
        const topo = (scrollTop / (scrollHeight - clientHeight)) * percurso;
        setIndicador({ altura, topo, visivel: true });
    }, []);

    useEffect(() => {
        const quadro = requestAnimationFrame(sincronizar);
        const observador = new ResizeObserver(sincronizar);
        if (areaRef.current) observador.observe(areaRef.current);
        if (conteudoRef.current) observador.observe(conteudoRef.current);
        return () => {
            cancelAnimationFrame(quadro);
            observador.disconnect();
        };
    }, [sincronizar]);

    const iniciarArraste = (evento: PointerEvent<HTMLDivElement>) => {
        const area = areaRef.current;
        if (!area) return;
        evento.preventDefault();
        evento.stopPropagation();
        evento.currentTarget.setPointerCapture(evento.pointerId);
        arrasteRef.current = {
            ponteiroId: evento.pointerId,
            inicioY: evento.clientY,
            scrollInicial: area.scrollTop,
        };
    };

    const arrastar = (evento: PointerEvent<HTMLDivElement>) => {
        const area = areaRef.current;
        const arraste = arrasteRef.current;
        if (!area || !arraste || arraste.ponteiroId !== evento.pointerId) return;

        const alturaTrilho = Math.max(0, area.clientHeight - 16);
        const percursoIndicador = alturaTrilho - indicador.altura;
        const percursoConteudo = area.scrollHeight - area.clientHeight;
        if (percursoIndicador <= 0 || percursoConteudo <= 0) return;

        const delta = evento.clientY - arraste.inicioY;
        area.scrollTop = arraste.scrollInicial + (delta / percursoIndicador) * percursoConteudo;
    };

    const encerrarArraste = (evento: PointerEvent<HTMLDivElement>) => {
        if (arrasteRef.current?.ponteiroId !== evento.pointerId) return;
        arrasteRef.current = null;
        if (evento.currentTarget.hasPointerCapture(evento.pointerId)) {
            evento.currentTarget.releasePointerCapture(evento.pointerId);
        }
    };

    const rolarPeloTrilho = (evento: MouseEvent<HTMLDivElement>) => {
        if (evento.target !== evento.currentTarget || !areaRef.current) return;
        const limites = evento.currentTarget.getBoundingClientRect();
        const acima = evento.clientY - limites.top < indicador.topo + indicador.altura / 2;
        areaRef.current.scrollBy({
            top: (acima ? -1 : 1) * areaRef.current.clientHeight * 0.85,
            behavior: "smooth",
        });
    };

    const rolarComTeclado = (evento: KeyboardEvent<HTMLDivElement>) => {
        const area = areaRef.current;
        if (!area) return;
        const deslocamentos: Record<string, number> = {
            ArrowUp: -48,
            ArrowDown: 48,
            PageUp: -area.clientHeight * 0.85,
            PageDown: area.clientHeight * 0.85,
            Home: -area.scrollHeight,
            End: area.scrollHeight,
        };
        if (deslocamentos[evento.key] === undefined) return;
        evento.preventDefault();
        area.scrollBy({ top: deslocamentos[evento.key], behavior: "smooth" });
    };

    return (
        <div className={cn("relative min-h-0 overflow-hidden", className)}>
            <div
                ref={areaRef}
                className="h-full overflow-y-auto pr-2 scrollbar-hide"
                onScroll={sincronizar}
            >
                <div ref={conteudoRef} className={classNameConteudo}>{children}</div>
            </div>
            {indicador.visivel && (
                <div
                    role="scrollbar"
                    aria-label={rotulo}
                    aria-orientation="vertical"
                    tabIndex={0}
                    onClick={rolarPeloTrilho}
                    onKeyDown={rolarComTeclado}
                    className="absolute bottom-2 right-0 top-2 w-1.5 cursor-pointer bg-white/[0.035] outline-none focus:bg-white/[0.07]"
                >
                    <div
                        className="absolute left-0 w-full cursor-grab touch-none bg-white/20 transition-colors hover:bg-white/35 active:cursor-grabbing active:bg-emerald-300/60"
                        style={{ height: indicador.altura, transform: `translateY(${indicador.topo}px)` }}
                        onPointerDown={iniciarArraste}
                        onPointerMove={arrastar}
                        onPointerUp={encerrarArraste}
                        onPointerCancel={encerrarArraste}
                        onClick={(evento) => evento.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
}
