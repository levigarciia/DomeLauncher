import { useEffect, useState } from 'react';

const CONSULTA_XL = '(min-width: 1280px)';

export function useBreakpointXl(): boolean {
  const [ehXl, setEhXl] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(CONSULTA_XL).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia(CONSULTA_XL);
    const atualizar = (evento?: MediaQueryListEvent) => {
      setEhXl(evento ? evento.matches : media.matches);
    };

    atualizar();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', atualizar);
      return () => media.removeEventListener('change', atualizar);
    }

    media.addListener(atualizar);
    return () => media.removeListener(atualizar);
  }, []);

  return ehXl;
}
