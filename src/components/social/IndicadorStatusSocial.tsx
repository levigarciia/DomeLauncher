import { cn } from '../../lib/utils';
import type { StatusPresenca } from './tiposSocial';

interface IndicadorStatusSocialProps {
    status: StatusPresenca;
    className?: string;
    titulo?: string;
}

const CORES_STATUS: Record<StatusPresenca, string> = {
    online: '#45A366',
    ausente: '#FFC04E',
    ocupado: '#DA3E44',
    offline: '#84858D',
};

export function IndicadorStatusSocial({
    status,
    className,
    titulo,
}: IndicadorStatusSocialProps) {
    const cor = CORES_STATUS[status];

    return (
        <svg
            viewBox="0 0 12 12"
            aria-hidden={titulo ? undefined : true}
            aria-label={titulo}
            className={cn('h-3 w-3 shrink-0', className)}
        >
            {status === 'online' && <circle cx="6" cy="6" r="4.5" fill={cor} />}
            {status === 'ausente' && (
                <path
                    d="M8.84 8.56A4.5 4.5 0 0 1 3.44 3.16 4.5 4.5 0 1 0 8.84 8.56Z"
                    fill={cor}
                />
            )}
            {status === 'ocupado' && (
                <>
                    <circle cx="6" cy="6" r="4.5" fill={cor} />
                    <rect x="3.25" y="5.25" width="5.5" height="1.5" rx="0.75" fill="#3C3D45" />
                </>
            )}
            {status === 'offline' && (
                <circle cx="6" cy="6" r="3.4" fill="none" stroke={cor} strokeWidth="2.2" />
            )}
        </svg>
    );
}
