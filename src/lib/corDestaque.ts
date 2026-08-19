const COR_DESTAQUE_PADRAO = "#10B981";

const CORES_ANTIGAS: Record<string, string> = {
    verde: COR_DESTAQUE_PADRAO,
    azul: "#3B82F6",
    laranja: "#F97316",
    rosa: "#EC4899",
    ciano: "#06B6D4",
};

type Rgb = {
    r: number;
    g: number;
    b: number;
};

export function ehCorHexValida(valor: unknown): valor is string {
    return /^#[0-9A-F]{6}$/i.test(String(valor ?? "").trim());
}

export function normalizarCorDestaque(valor: unknown): string {
    const texto = String(valor ?? "").trim();
    const corAntiga = CORES_ANTIGAS[texto.toLowerCase()];
    if (corAntiga) return corAntiga;

    if (/^#[0-9A-F]{3}$/i.test(texto)) {
        return `#${texto.slice(1).split("").map((digito) => digito.repeat(2)).join("")}`.toUpperCase();
    }

    return ehCorHexValida(texto) ? texto.toUpperCase() : COR_DESTAQUE_PADRAO;
}

function converterHexParaRgb(cor: string): Rgb {
    const hexadecimal = normalizarCorDestaque(cor).slice(1);
    return {
        r: Number.parseInt(hexadecimal.slice(0, 2), 16),
        g: Number.parseInt(hexadecimal.slice(2, 4), 16),
        b: Number.parseInt(hexadecimal.slice(4, 6), 16),
    };
}

function misturarCores(origem: Rgb, destino: Rgb, proporcao: number): Rgb {
    const misturarCanal = (canalOrigem: number, canalDestino: number) =>
        Math.round(canalOrigem + (canalDestino - canalOrigem) * proporcao);

    return {
        r: misturarCanal(origem.r, destino.r),
        g: misturarCanal(origem.g, destino.g),
        b: misturarCanal(origem.b, destino.b),
    };
}

function converterRgbParaHex({ r, g, b }: Rgb): string {
    const canalParaHex = (canal: number) => canal.toString(16).padStart(2, "0");
    return `#${canalParaHex(r)}${canalParaHex(g)}${canalParaHex(b)}`;
}

export function aplicarCorDestaque(valor: unknown): void {
    const cor = normalizarCorDestaque(valor);
    const base = converterHexParaRgb(cor);
    const branco = { r: 255, g: 255, b: 255 };
    const preto = { r: 0, g: 0, b: 0 };
    const raiz = document.documentElement;
    const favoritos = misturarCores(base, converterHexParaRgb("#F6329A"), 0.5);
    const grupos = misturarCores(base, converterHexParaRgb("#E600FF"), 0.5);
    const paleta: Record<number, Rgb> = {
        50: misturarCores(base, branco, 0.94),
        100: misturarCores(base, branco, 0.86),
        200: misturarCores(base, branco, 0.72),
        300: misturarCores(base, branco, 0.5),
        400: misturarCores(base, branco, 0.25),
        500: base,
        600: misturarCores(base, preto, 0.12),
        700: misturarCores(base, preto, 0.25),
        800: misturarCores(base, preto, 0.38),
        900: misturarCores(base, preto, 0.5),
    };

    Object.entries(paleta).forEach(([nivel, rgb]) => {
        raiz.style.setProperty(`--cor-acento-${nivel}`, converterRgbParaHex(rgb));
    });
    raiz.style.setProperty("--cor-acento-rgb", `${base.r}, ${base.g}, ${base.b}`);
    raiz.style.setProperty("--cor-favoritos", converterRgbParaHex(favoritos));
    raiz.style.setProperty("--cor-favoritos-rgb", `${favoritos.r}, ${favoritos.g}, ${favoritos.b}`);
    raiz.style.setProperty("--cor-grupos", converterRgbParaHex(grupos));
    raiz.style.setProperty("--cor-grupos-rgb", `${grupos.r}, ${grupos.g}, ${grupos.b}`);
}
