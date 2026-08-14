import { useEffect, useState } from 'react';
import { Gamepad2 } from '../../iconesPixelados';
import { cn } from '../../lib/utils';
import type { AtividadeSocial } from './tiposSocial';

interface ImagemAtividadeProps {
    atividade: AtividadeSocial;
    iconeUrlAlternativo?: string | null;
    className?: string;
    tamanhoIconeFallback?: number;
}

export function ImagemAtividade({
    atividade,
    iconeUrlAlternativo,
    className,
    tamanhoIconeFallback = 12,
}: ImagemAtividadeProps) {
    const [imagemFalhou, setImagemFalhou] = useState(false);
    const iconeUrl = iconeUrlAlternativo || atividade.iconeUrl;

    useEffect(() => {
        setImagemFalhou(false);
    }, [iconeUrl]);

    return (
        <div className={cn('grid shrink-0 place-items-center overflow-hidden', className)}>
            {iconeUrl && !imagemFalhou ? (
                <img
                    src={iconeUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={() => setImagemFalhou(true)}
                />
            ) : (
                <Gamepad2 size={tamanhoIconeFallback} className="text-emerald-300/55" />
            )}
        </div>
    );
}
