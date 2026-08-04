// =============================================================================
// NuvemshopIcon — Logo oficial da Nuvemshop
//
// Dois componentes para diferentes contextos de uso:
//
//   NuvemshopBrandIcon  → usa o PNG oficial (fundo navy + ícone branco)
//                         ideal para ícones grandes e standalone (≥ 32px)
//
//   NuvemshopCloudIcon  → SVG dos dois anéis sobrepostos que formam a nuvem
//                         ideal para ícones pequenos inline (herda currentColor)
// =============================================================================

interface BrandIconProps {
  /** Classe Tailwind de tamanho (ex: "w-10 h-10"). Default: "w-10 h-10" */
  className?: string;
  /** Border radius Tailwind (ex: "rounded-xl"). Default: "rounded-xl" */
  rounded?: string;
}

/**
 * Logo oficial Nuvemshop (PNG).
 * Fundo navy escuro (#2d3166) com os dois anéis brancos.
 * Use para ícones de 28px ou maiores.
 */
export function NuvemshopBrandIcon({
  className = 'w-10 h-10',
  rounded = 'rounded-xl',
}: BrandIconProps) {
  return (
    <img
      src="/images/nuvemshop-icon.png"
      alt="Nuvemshop"
      className={`${className} ${rounded} object-cover`}
    />
  );
}

interface CloudIconProps {
  className?: string;
}

/**
 * Ícone vetorial dos dois anéis da Nuvemshop.
 * SVG sem fundo — herda currentColor do contexto.
 * Ideal para tabs, badges e ícones inline pequenos (12–20px).
 */
export function NuvemshopCloudIcon({ className = 'w-4 h-4' }: CloudIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 36 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Nuvemshop"
    >
      {/* Anel esquerdo */}
      <circle cx="11" cy="11" r="8.5" stroke="currentColor" strokeWidth="4" />
      {/* Anel direito */}
      <circle cx="25" cy="11" r="8.5" stroke="currentColor" strokeWidth="4" />
    </svg>
  );
}
