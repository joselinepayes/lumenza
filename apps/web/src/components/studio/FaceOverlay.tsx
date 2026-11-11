import type { FaceBox } from '../../lib/types';

/**
 * Recuadros de rostros sobre el escenario. Las coordenadas son fracciones (0–1) de la imagen orientada y el escenario
 * conserva su proporción, por lo que el porcentaje coincide con la foto en cualquier tamaño y en cualquier versión.
 * Doble trazo (oscuro + lila claro fijo) para que se lea sobre fotos claras y oscuras en ambos temas.
 */
export function FaceOverlay({ boxes }: { boxes: FaceBox[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10" data-testid="face-overlay" aria-hidden="true">
      {boxes.map((b, i) => (
        <div
          key={`${b.x}-${b.y}-${i}`}
          data-testid="face-box"
          className="rise absolute rounded-[6px] border-[1.5px] border-[#d9ccff] shadow-[0_0_0_1px_rgb(0_0_0/0.55),0_0_16px_rgb(150_115_247/0.5)]"
          style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, animationDelay: `${i * 70}ms` }}
        >
          <span className="absolute left-1 top-1 grid size-[18px] place-items-center rounded-[5px] bg-accent text-[10px] font-semibold leading-none text-on-accent shadow-[0_1px_4px_rgb(0_0_0/0.5)]">{i + 1}</span>
        </div>
      ))}
    </div>
  );
}
