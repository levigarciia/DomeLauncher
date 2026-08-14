import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Loader2 } from "../iconesPixelados";

// Utility functions for cape texture handling
function createTransparentTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 1, 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;

  return texture;
}

function applyCapeTexture(
  model: THREE.Object3D,
  texture: THREE.Texture | null,
  transparentTexture?: THREE.Texture,
): void {
  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      materials.forEach((mat: THREE.Material) => {
        if (mat instanceof THREE.MeshStandardMaterial) {
          if (mat.name === 'cape') {
            mat.map = texture || transparentTexture || null;
            mat.transparent = !texture || transparentTexture ? true : false;
            mat.metalness = 0;
            mat.color.set(0xffffff);
            mat.toneMapped = false;
            mat.flatShading = true;
            mat.roughness = 1;
            mat.needsUpdate = true;
            mat.depthTest = true;
            mat.depthWrite = true;
            mat.side = THREE.DoubleSide;
            mat.alphaTest = 0.1;
            mat.visible = !!texture;
          }
        }
      });
    }
  });
}

interface SkinPreviewRendererProps {
  skinUrl: string;
  capeUrl?: string; 
  model?: 'classic' | 'slim';
  height?: number;
  width?: number;
  className?: string;
  onReady?: () => void;
}

export const SkinPreviewRenderer: React.FC<SkinPreviewRendererProps> = ({ 
  skinUrl, 
  capeUrl,
  model = 'classic',
  height = 400,
  width = 300,
  className,
  onReady
}) => {
  const containerRef = useRef<HTMLDivElement>(null); // Container principal
  const mountRef = useRef<HTMLDivElement>(null); // Container EXCLUSIVO do Three.js
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const actionsRef = useRef<{ [key: string]: THREE.AnimationAction }>({});
  const activeActionRef = useRef<THREE.AnimationAction | null>(null);
  const [loading, setLoading] = useState(true);

  // Ref para armazenar a função de playAnimation acessível fora do useEffect principal
  const playAnimationRef = useRef<(name: string, once?: boolean) => void>(() => {});

  // Cape-related state
  const capeTextureRef = useRef<THREE.Texture | null>(null);
  const lastCapeSrcRef = useRef<string | undefined>(undefined);
  const transparentTexture = createTransparentTexture();

  // Efeito principal: Configuração da cena Three.js
  useEffect(() => {
    if (!mountRef.current || !containerRef.current) return;

    const initialWidth = containerRef.current.clientWidth || width || 300;
    const initialHeight = containerRef.current.clientHeight || height || 400;

    const camera = new THREE.PerspectiveCamera(45, initialWidth / initialHeight, 0.1, 100);
    camera.position.set(0, 1.1, 4.2); 

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(initialWidth, initialHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    // Limpeza segura: remove apenas os filhos do mountRef (que é só do ThreeJS)
    while (mountRef.current.firstChild) {
        mountRef.current.removeChild(mountRef.current.firstChild);
    }
    mountRef.current.appendChild(renderer.domElement);
    
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.0, 0); 
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.minDistance = 2.0; 
    controls.maxDistance = 8.0;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    const scene = new THREE.Scene();

    // Luz
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(-3, 5, 4);
    scene.add(dirLight);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    // Resize Observer no container principal
    const resizeObserver = new ResizeObserver(() => {
        if (!containerRef.current || !rendererRef.current) return;
        const newWidth = containerRef.current.clientWidth;
        const newHeight = containerRef.current.clientHeight;
        
        if (newWidth === 0 || newHeight === 0) return;

        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
        rendererRef.current.setSize(newWidth, newHeight);
    });
    resizeObserver.observe(containerRef.current);

    const loader = new GLTFLoader();
    const modelPath = model === 'slim' ? '/models/slim-player.gltf' : '/models/classic-player.gltf';

    loader.load(modelPath, (gltf) => {
        const object = gltf.scene;
        
        // Ajuste definido pelo usuário
        object.position.x = 0; 
        object.position.y = 0;
        
        object.rotation.y = Math.PI / 8;

        modelRef.current = object;
        scene.add(object);

        const mixer = new THREE.AnimationMixer(object);
        mixerRef.current = mixer;

        // Mapear animações
        gltf.animations.forEach((clip) => {
            const action = mixer.clipAction(clip);
            actionsRef.current[clip.name] = action;
        });
        
        playAnimationRef.current('idle'); 

        // Apply cape texture if available
        applyCapeTexture(object, capeTextureRef.current, transparentTexture);

        setLoading(false);
        if (onReady) onReady();
    }, undefined, (error) => {
        console.error('Error loading GLTF:', error);
        setLoading(false);
    });

    // Animation Loop
    const clock = new THREE.Clock();
    let animationId: number;

    const animate = () => {
        animationId = requestAnimationFrame(animate);
        const delta = clock.getDelta();
        if (mixerRef.current) mixerRef.current.update(delta);
        controls.update();
        renderer.render(scene, camera);
    };
    animate();

    return () => {
        resizeObserver.disconnect(); 
        cancelAnimationFrame(animationId);
        if (rendererRef.current) {
            rendererRef.current.dispose();
            // Verifica segurança antes de remover
            if (mountRef.current && rendererRef.current.domElement.parentNode === mountRef.current) {
                mountRef.current.removeChild(rendererRef.current.domElement);
            }
        }
    };
  }, [model]); 

  // Helpers de Animação
  const playActive = (newAction: THREE.AnimationAction, once: boolean) => {
       const current = activeActionRef.current;
       if (current === newAction && current.isRunning()) return;

       if (current) {
           current.fadeOut(0.2);
       }

       newAction.reset();
       newAction.fadeIn(0.2);
       
       if (once) {
           newAction.setLoop(THREE.LoopOnce, 1);
           newAction.clampWhenFinished = true;
           const restoreIdle = (e: any) => {
               if (e.action === newAction) {
                   mixerRef.current?.removeEventListener('finished', restoreIdle);
                   playAnimationRef.current('idle');
               }
           };
           mixerRef.current?.addEventListener('finished', restoreIdle);
       } else {
           newAction.setLoop(THREE.LoopRepeat, Infinity);
       }
       
       newAction.play();
       activeActionRef.current = newAction;
  };

  const playAnimation = (name: string, once: boolean = false) => {
      const actions = actionsRef.current;
      const clipName = Object.keys(actions).find(key => key.toLowerCase().includes(name.toLowerCase()));
      
      if (!clipName) {
          if (name === 'idle' && Object.keys(actions).length > 0) {
               playActive(actions[Object.keys(actions)[0]], once);
          }
          return;
      }
      playActive(actions[clipName], once);
  };

  useEffect(() => {
    playAnimationRef.current = playAnimation;
  });

  // Load Skin
  useEffect(() => {
     if (!modelRef.current) return;

     const textureLoader = new THREE.TextureLoader();
     textureLoader.load(skinUrl, (texture) => {
         texture.magFilter = THREE.NearestFilter;
         texture.minFilter = THREE.NearestFilter;
         texture.colorSpace = THREE.SRGBColorSpace;
         texture.flipY = false;

         modelRef.current?.traverse((child) => {
             if ((child as THREE.Mesh).isMesh) {
                 const mesh = child as THREE.Mesh;
                 if (mesh.material) {
                     const mat = mesh.material as THREE.MeshStandardMaterial;
                     mat.map = texture;
                     mat.needsUpdate = true;
                 }
             }
         });
         
         if (!loading) {
            // 'wave' não existe no modelo padrão modrinth, usar 'interact'
            playAnimation('interact', true); 
         }

     }, undefined, (err) => console.error("Error loading skin texture:", err));

  }, [skinUrl, loading]);

  // Load Cape Texture
  useEffect(() => {
    if (capeUrl === lastCapeSrcRef.current) return;

    lastCapeSrcRef.current = capeUrl;

    if (capeUrl) {
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(capeUrl, (texture) => {
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;

        capeTextureRef.current = texture;

        if (modelRef.current) {
          applyCapeTexture(modelRef.current, texture, transparentTexture);
        }
      }, undefined, (err) => console.error("Error loading cape texture:", err));
    } else {
      capeTextureRef.current = null;
      if (modelRef.current) {
        applyCapeTexture(modelRef.current, null, transparentTexture);
      }
    }
  }, [capeUrl]);

  const handleCanvasClick = () => {
      playAnimation('interact', true);
  };

  return (
    <div 
        className={`relative flex items-center justify-center ${className || ''}`} 
        style={{ width: '100%', height: '100%' }} 
        ref={containerRef}
        onClick={handleCanvasClick}
    >
        {/* Container Dedicado ao Three.js para não conflitar com Loader */}
        <div ref={mountRef} className="absolute inset-0 w-full h-full" />
        
       {loading && (
         <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
             <Loader2 className="animate-spin text-emerald-500" size={32} />
         </div>
       )}
    </div>
  );
};
