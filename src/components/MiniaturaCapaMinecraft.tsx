import { useEffect, useRef } from "react";

interface MiniaturaCapaMinecraftProps {
    capaUrl: string;
    className?: string;
}

export function MiniaturaCapaMinecraft({ capaUrl, className }: MiniaturaCapaMinecraftProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const contexto = canvas?.getContext("2d");
        if (!canvas || !contexto) return;

        let ativa = true;
        const imagem = new Image();
        imagem.crossOrigin = "anonymous";
        imagem.onload = () => {
            if (!ativa) return;
            contexto.clearRect(0, 0, canvas.width, canvas.height);
            contexto.imageSmoothingEnabled = false;

            const escalaX = imagem.naturalWidth / 64;
            const escalaY = imagem.naturalHeight / 32;
            contexto.drawImage(
                imagem,
                12 * escalaX,
                1 * escalaY,
                10 * escalaX,
                16 * escalaY,
                0,
                0,
                canvas.width,
                canvas.height,
            );
        };
        imagem.src = capaUrl;

        return () => {
            ativa = false;
            imagem.onload = null;
        };
    }, [capaUrl]);

    return (
        <canvas
            ref={canvasRef}
            width={60}
            height={96}
            className={className}
            aria-label="Prévia da capa"
        />
    );
}
