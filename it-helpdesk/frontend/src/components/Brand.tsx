type BrandProps = {
  compact?: boolean
  light?: boolean
}

function Brand({ compact = false, light = false }: BrandProps) {
  return (
    <a className={`brand${compact ? ' brand--compact' : ''}${light ? ' brand--light' : ''}`} href="/" aria-label="IT HelpDesk, главная">
      <span className="brand-mark" aria-hidden="true">IT</span>
      <span className="brand-name">HelpDesk</span>
    </a>
  )
}

export default Brand
