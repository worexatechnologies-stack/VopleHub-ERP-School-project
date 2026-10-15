import { useEffect, useRef, useState } from 'react';

export default function SchoolhouseHero() {
  const host = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const lowPower = window.innerWidth < 700 || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (lowPower) { setFallback(true); return; }
    let renderer: import('three').WebGLRenderer | undefined;
    let frame = 0;
    let disposed = false;
    let resizeHandler: (() => void) | undefined;
    
    const boot = async () => {
      const THREE = await import('three');
      if (disposed || !host.current) return;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(0, 1.7, 5.5);
      
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      host.current.appendChild(renderer.domElement);
      
      const school = new THREE.Group();
      
      // Indigo/Slate themed model
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 2.15, 2.3), 
        new THREE.MeshStandardMaterial({ color: 0x1e293b, flatShading: true }) // slate-800
      );
      wall.position.y = 0.25; 
      school.add(wall);
      
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(2.7, 1.7, 4), 
        new THREE.MeshStandardMaterial({ color: 0x4f46e5, flatShading: true }) // indigo-600
      );
      roof.rotation.y = Math.PI / 4; 
      roof.position.y = 2.18; 
      school.add(roof);
      
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(.62, 1.15, .08), 
        new THREE.MeshStandardMaterial({ color: 0x0f172a }) // slate-950
      );
      door.position.set(0, -.25, 1.2); 
      school.add(door);
      
      for (const x of [-1.05, 1.05]) { 
        const win = new THREE.Mesh(
          new THREE.BoxGeometry(.56, .58, .08), 
          new THREE.MeshStandardMaterial({ color: 0x818cf8, emissive: 0x3730a3 }) // indigo-400, indigo-800 emissive
        ); 
        win.position.set(x, .48, 1.2); 
        school.add(win); 
      }
      
      const ground = new THREE.Mesh(
        new THREE.CylinderGeometry(3.9, 4.3, .25, 7), 
        new THREE.MeshStandardMaterial({ color: 0x0f172a, flatShading: true }) // slate-950
      ); 
      ground.position.y = -1.03; 
      school.add(ground);
      
      // Update lighting to match new theme
      scene.add(school, new THREE.HemisphereLight(0xc7d2fe, 0x0f172a, 2.4)); // indigo-200, slate-950
      const key = new THREE.DirectionalLight(0xffffff, 2); 
      key.position.set(3, 5, 4); 
      scene.add(key);
      
      resizeHandler = () => { 
        if (!host.current || !renderer) return; 
        const { width, height } = host.current.getBoundingClientRect(); 
        renderer.setSize(width, height); 
        camera.aspect = width / height; 
        camera.updateProjectionMatrix(); 
      };
      
      resizeHandler();
      window.addEventListener('resize', resizeHandler);
      
      const render = () => { 
        if (!reducedMotion) school.rotation.y += .004; 
        renderer?.render(scene, camera); 
        if (!reducedMotion) frame = requestAnimationFrame(render); 
      };
      render();
      
    };
    
    void boot();
    
    return () => { 
      disposed = true; 
      cancelAnimationFrame(frame); 
      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
      renderer?.dispose(); 
      renderer?.domElement.remove(); 
    };
  }, []);

  return (
    <div 
      ref={host} 
      className={`w-full h-full min-h-[300px] md:min-h-[500px] flex items-center justify-center ${
        fallback ? 'bg-gradient-to-br from-indigo-900 to-slate-900 rounded-[40px] shadow-2xl border border-indigo-500/20' : ''
      }`} 
      aria-label="Low-poly schoolhouse illustration"
    >
      {fallback && <span className="text-6xl text-indigo-400">✦</span>}
    </div>
  );
}
