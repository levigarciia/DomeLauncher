const LIMITE_ARQUIVO_IMAGEM_BYTES = 8 * 1024 * 1024;
const TAMANHO_ICONE_INSTANCIA = 256;
const TIPOS_IMAGEM_ACEITOS = new Set(["image/png", "image/jpeg", "image/webp"]);

export const EXTENSOES_IMAGEM_INSTANCIA = ".png,.jpg,.jpeg,.webp";

export async function prepararIconeInstancia(arquivo: File): Promise<string> {
    if (!TIPOS_IMAGEM_ACEITOS.has(arquivo.type)) {
        throw new Error("Selecione uma imagem PNG, JPG ou WebP.");
    }
    if (arquivo.size > LIMITE_ARQUIVO_IMAGEM_BYTES) {
        throw new Error("A imagem deve ter no máximo 8 MB.");
    }

    const bitmap = await createImageBitmap(arquivo);
    try {
        const escala = Math.min(
            TAMANHO_ICONE_INSTANCIA / bitmap.width,
            TAMANHO_ICONE_INSTANCIA / bitmap.height,
        );
        const largura = Math.max(1, Math.round(bitmap.width * escala));
        const altura = Math.max(1, Math.round(bitmap.height * escala));
        const canvas = document.createElement("canvas");
        canvas.width = TAMANHO_ICONE_INSTANCIA;
        canvas.height = TAMANHO_ICONE_INSTANCIA;

        const contexto = canvas.getContext("2d");
        if (!contexto) throw new Error("Não foi possível preparar a imagem.");

        contexto.imageSmoothingEnabled = true;
        contexto.imageSmoothingQuality = "high";
        contexto.drawImage(
            bitmap,
            (TAMANHO_ICONE_INSTANCIA - largura) / 2,
            (TAMANHO_ICONE_INSTANCIA - altura) / 2,
            largura,
            altura,
        );
        return canvas.toDataURL("image/png");
    } finally {
        bitmap.close();
    }
}
