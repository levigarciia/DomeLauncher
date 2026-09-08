import { cn } from '../lib/utils';

function LinhaEsqueleto({ className }: { className?: string }) {
  return <div className={cn('h-3 rounded bg-white/[0.06]', className)} />;
}

export function EsqueletoAba() {
  return (
    <div className="h-full min-h-[420px] animate-pulse space-y-5 p-1" aria-hidden="true">
      <div className="flex items-center justify-between gap-6">
        <div className="space-y-2">
          <LinhaEsqueleto className="h-5 w-40" />
          <LinhaEsqueleto className="w-64 max-w-[55vw]" />
        </div>
        <LinhaEsqueleto className="h-9 w-28" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="space-y-4 border border-white/[0.06] bg-white/[0.015] p-4">
            <div className="h-24 rounded bg-white/[0.045]" />
            <LinhaEsqueleto className="w-3/5" />
            <LinhaEsqueleto className="w-2/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function EsqueletoExplore() {
  return (
    <div
      className="grid min-h-[420px] animate-pulse grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3"
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div
          key={item}
          className="flex min-h-[218px] flex-col gap-4 rounded-3xl border border-white/5 bg-white/[0.025] p-5"
        >
          <div className="flex gap-4">
            <div className="h-16 w-16 shrink-0 rounded-2xl bg-white/[0.06]" />
            <div className="flex-1 space-y-3 py-1">
              <LinhaEsqueleto className="h-5 w-3/5" />
              <LinhaEsqueleto className="w-2/5" />
              <LinhaEsqueleto className="h-4 w-16 rounded-full" />
            </div>
          </div>

          <div className="space-y-2">
            <LinhaEsqueleto className="w-full" />
            <LinhaEsqueleto className="w-5/6" />
          </div>

          <div className="mt-auto flex items-center justify-between border-t border-white/5 pt-4">
            <LinhaEsqueleto className="w-24" />
            <div className="flex gap-2">
              <LinhaEsqueleto className="h-8 w-8 rounded-xl" />
              <LinhaEsqueleto className="h-8 w-20 rounded-xl" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EsqueletoSocial() {
  return (
    <div className="w-full animate-pulse space-y-3" aria-hidden="true">
      <div className="border border-white/[0.06] bg-[#151515] p-3">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 bg-white/[0.06]" />
          <div className="flex-1 space-y-2">
            <LinhaEsqueleto className="w-2/3" />
            <LinhaEsqueleto className="h-2 w-1/2" />
          </div>
        </div>
      </div>
      <div className="space-y-3 border border-white/[0.06] bg-[#151515] p-3">
        <LinhaEsqueleto className="h-8 w-full" />
        <LinhaEsqueleto className="h-12 w-full" />
        <LinhaEsqueleto className="h-12 w-full" />
      </div>
    </div>
  );
}
