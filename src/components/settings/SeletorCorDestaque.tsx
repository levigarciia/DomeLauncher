import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ehCorHexValida, normalizarCorDestaque } from "../../lib/corDestaque";

const CORES_DESTAQUE_PREDEFINIDAS = [
  { nome: "Azul", codigo: "#3B82F6" },
  { nome: "Vermelho", codigo: "#EF4444" },
  { nome: "Verde", codigo: "#10B981" },
  { nome: "Amarelo", codigo: "#EAB308" },
] as const;

interface CorHsv {
  matiz: number;
  saturacao: number;
  valor: number;
}

function converterHexParaHsv(codigo: string): CorHsv {
  const hexadecimal = normalizarCorDestaque(codigo).slice(1);
  const vermelho = Number.parseInt(hexadecimal.slice(0, 2), 16) / 255;
  const verde = Number.parseInt(hexadecimal.slice(2, 4), 16) / 255;
  const azul = Number.parseInt(hexadecimal.slice(4, 6), 16) / 255;
  const maximo = Math.max(vermelho, verde, azul);
  const minimo = Math.min(vermelho, verde, azul);
  const diferenca = maximo - minimo;
  let matiz = 0;

  if (diferenca !== 0) {
    if (maximo === vermelho) matiz = 60 * (((verde - azul) / diferenca) % 6);
    if (maximo === verde) matiz = 60 * ((azul - vermelho) / diferenca + 2);
    if (maximo === azul) matiz = 60 * ((vermelho - verde) / diferenca + 4);
  }

  return {
    matiz: matiz < 0 ? matiz + 360 : matiz,
    saturacao: maximo === 0 ? 0 : diferenca / maximo,
    valor: maximo,
  };
}

function converterHsvParaHex({ matiz, saturacao, valor }: CorHsv): string {
  const croma = valor * saturacao;
  const setor = matiz / 60;
  const intermediario = croma * (1 - Math.abs((setor % 2) - 1));
  const ajuste = valor - croma;
  const [vermelho, verde, azul] =
    setor < 1 ? [croma, intermediario, 0] :
    setor < 2 ? [intermediario, croma, 0] :
    setor < 3 ? [0, croma, intermediario] :
    setor < 4 ? [0, intermediario, croma] :
    setor < 5 ? [intermediario, 0, croma] : [croma, 0, intermediario];
  const converterCanal = (canal: number) =>
    Math.round((canal + ajuste) * 255).toString(16).padStart(2, "0");

  return `#${converterCanal(vermelho)}${converterCanal(verde)}${converterCanal(azul)}`.toUpperCase();
}

export function SeletorCorDestaque({
  cor,
  codigo,
  onAlterar,
  onRestaurar,
}: {
  cor: string;
  codigo: string;
  onAlterar: (codigo: string) => void;
  onRestaurar: () => void;
}) {
  const [personalizadoAberto, setPersonalizadoAberto] = useState(false);
  const [hsv, setHsv] = useState<CorHsv>(() => converterHexParaHsv(cor));
  const codigoValido = ehCorHexValida(codigo);
  const corPredefinida = CORES_DESTAQUE_PREDEFINIDAS.some(
    (item) => item.codigo === cor
  );

  useEffect(() => {
    setHsv(converterHexParaHsv(cor));
  }, [cor]);

  const aplicarHsv = (proximoHsv: CorHsv) => {
    setHsv(proximoHsv);
    onAlterar(converterHsvParaHex(proximoHsv));
  };

  const atualizarSaturacaoEValor = (evento: React.PointerEvent<HTMLDivElement>) => {
    const limites = evento.currentTarget.getBoundingClientRect();
    const saturacao = Math.min(1, Math.max(0, (evento.clientX - limites.left) / limites.width));
    const valor = 1 - Math.min(1, Math.max(0, (evento.clientY - limites.top) / limites.height));
    aplicarHsv({ ...hsv, saturacao, valor });
  };

  const atualizarMatiz = (evento: React.PointerEvent<HTMLDivElement>) => {
    const limites = evento.currentTarget.getBoundingClientRect();
    const proporcao = Math.min(1, Math.max(0, (evento.clientX - limites.left) / limites.width));
    aplicarHsv({ ...hsv, matiz: proporcao * 359.99 });
  };

  const ajustarSaturacaoEValorPeloTeclado = (evento: React.KeyboardEvent<HTMLDivElement>) => {
    const passo = evento.shiftKey ? 0.1 : 0.02;
    const limitar = (valor: number) => Math.min(1, Math.max(0, valor));
    let proximoHsv = hsv;

    if (evento.key === "ArrowLeft") {
      proximoHsv = { ...hsv, saturacao: limitar(hsv.saturacao - passo) };
    } else if (evento.key === "ArrowRight") {
      proximoHsv = { ...hsv, saturacao: limitar(hsv.saturacao + passo) };
    } else if (evento.key === "ArrowDown") {
      proximoHsv = { ...hsv, valor: limitar(hsv.valor - passo) };
    } else if (evento.key === "ArrowUp") {
      proximoHsv = { ...hsv, valor: limitar(hsv.valor + passo) };
    } else {
      return;
    }

    evento.preventDefault();
    aplicarHsv(proximoHsv);
  };

  const ajustarMatizPeloTeclado = (evento: React.KeyboardEvent<HTMLDivElement>) => {
    if (evento.key !== "ArrowLeft" && evento.key !== "ArrowRight") return;
    evento.preventDefault();
    const passo = evento.shiftKey ? 15 : 3;
    const direcao = evento.key === "ArrowLeft" ? -1 : 1;
    aplicarHsv({ ...hsv, matiz: (hsv.matiz + direcao * passo + 360) % 360 });
  };

  return (
    <div className="space-y-3 border-t border-white/5 pt-4">
      <div>
        <p className="text-sm font-medium">Cor de destaque</p>
        <p className="mt-1 text-xs text-white/30">
          Escolha uma cor pronta ou abra o seletor personalizado.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {CORES_DESTAQUE_PREDEFINIDAS.map((item) => {
          const selecionada = cor === item.codigo;
          return (
            <button
              type="button"
              key={item.codigo}
              onClick={() => {
                setPersonalizadoAberto(false);
                onAlterar(item.codigo);
              }}
              aria-pressed={selecionada}
              className={`flex items-center gap-2 border px-2.5 py-2 text-[10px] font-bold transition-colors ${
                selecionada
                  ? "border-white/30 bg-white/10 text-white"
                  : "border-white/8 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white/75"
              }`}
            >
              <span
                className="h-4 w-4 shrink-0 border border-white/20"
                style={{ backgroundColor: item.codigo }}
              />
              <span className="truncate">{item.nome}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setPersonalizadoAberto((aberto) => !aberto)}
          aria-expanded={personalizadoAberto}
          aria-pressed={!corPredefinida}
          className={`flex items-center gap-2 border px-2.5 py-2 text-[10px] font-bold transition-colors ${
            !corPredefinida || personalizadoAberto
              ? "border-white/30 bg-white/10 text-white"
              : "border-white/8 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white/75"
          }`}
        >
          <span
            className="h-4 w-4 shrink-0 border border-white/25"
            style={{
              background: "conic-gradient(#ef4444, #eab308, #10b981, #3b82f6, #a855f7, #ef4444)",
            }}
          />
          Personalizado
        </button>
      </div>

      <AnimatePresence initial={false}>
        {personalizadoAberto && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="grid gap-3 border border-white/10 bg-black/25 p-3 sm:grid-cols-[minmax(0,1fr)_150px]">
              <div className="space-y-3">
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="Saturação e luminosidade"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(hsv.saturacao * 100)}
                  aria-valuetext={`${Math.round(hsv.saturacao * 100)}% de saturação, ${Math.round(hsv.valor * 100)}% de luminosidade`}
                  onKeyDown={ajustarSaturacaoEValorPeloTeclado}
                  onPointerDown={(evento) => {
                    evento.currentTarget.setPointerCapture(evento.pointerId);
                    atualizarSaturacaoEValor(evento);
                  }}
                  onPointerMove={(evento) => {
                    if (evento.currentTarget.hasPointerCapture(evento.pointerId)) {
                      atualizarSaturacaoEValor(evento);
                    }
                  }}
                  className="relative h-36 cursor-crosshair touch-none border border-white/15 outline-none focus:ring-2 focus:ring-white/30"
                  style={{
                    background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.matiz} 100% 50%))`,
                  }}
                >
                  <span
                    className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 border-2 border-white shadow-[0_0_0_1px_#000]"
                    style={{
                      left: `${hsv.saturacao * 100}%`,
                      top: `${(1 - hsv.valor) * 100}%`,
                    }}
                  />
                </div>

                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="Matiz"
                  aria-valuemin={0}
                  aria-valuemax={360}
                  aria-valuenow={Math.round(hsv.matiz)}
                  onKeyDown={ajustarMatizPeloTeclado}
                  onPointerDown={(evento) => {
                    evento.currentTarget.setPointerCapture(evento.pointerId);
                    atualizarMatiz(evento);
                  }}
                  onPointerMove={(evento) => {
                    if (evento.currentTarget.hasPointerCapture(evento.pointerId)) {
                      atualizarMatiz(evento);
                    }
                  }}
                  className="relative h-3 cursor-ew-resize touch-none border border-white/15 outline-none focus:ring-2 focus:ring-white/30"
                  style={{
                    background: "linear-gradient(to right, #ef4444, #eab308, #10b981, #06b6d4, #3b82f6, #a855f7, #ef4444)",
                  }}
                >
                  <span
                    className="pointer-events-none absolute top-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 border border-black bg-white"
                    style={{ left: `${(hsv.matiz / 360) * 100}%` }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div
                  className="min-h-20 flex-1 border border-white/15"
                  style={{ backgroundColor: cor }}
                  aria-label={`Prévia da cor ${cor}`}
                />
                <label className="border border-white/10 bg-black/30 px-3 py-2 focus-within:border-white/30">
                  <span className="block text-[8px] font-black uppercase tracking-[0.18em] text-white/25">
                    Hexadecimal
                  </span>
                  <input
                    type="text"
                    value={codigo}
                    onChange={(evento) => onAlterar(evento.target.value)}
                    onBlur={onRestaurar}
                    maxLength={7}
                    spellCheck={false}
                    aria-invalid={!codigoValido}
                    className={`mt-1 w-full bg-transparent font-mono text-sm font-bold uppercase tracking-[0.12em] outline-none ${
                      codigoValido ? "text-white" : "text-red-400"
                    }`}
                    placeholder="#10B981"
                  />
                </label>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
