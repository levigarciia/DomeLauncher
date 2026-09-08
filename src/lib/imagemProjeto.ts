import iconeDomeLauncher from "../../src-tauri/icons/icon.png";

export const ICONE_DOME_LAUNCHER = iconeDomeLauncher;

export function obterImagemProjeto(
    imagem: string | null | undefined,
    tipo: string,
    identificador: string,
): string {
    const imagemInformada = imagem?.trim();
    if (imagemInformada) return imagemInformada;
    if (tipo.toLowerCase() === "modpack") return ICONE_DOME_LAUNCHER;
    return `https://api.dicebear.com/9.x/shapes/svg?seed=${identificador}`;
}
