function lighten(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16)
  return `rgb(${Math.min(255,(num>>16)+amount)},${Math.min(255,((num>>8)&0xff)+amount)},${Math.min(255,(num&0xff)+amount)})`
}
function darken(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16)
  return `rgb(${Math.max(0,(num>>16)-amount)},${Math.max(0,((num>>8)&0xff)-amount)},${Math.max(0,(num&0xff)-amount)})`
}

export function ShapeIconSVG({ type, color: c }) {
  switch (type) {
    case 'cube':
      return (
        <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
          <polygon points="40,10 70,27 70,57 40,74 10,57 10,27" fill={c} />
          <polygon points="40,10 70,27 40,44 10,27" fill={lighten(c,30)} />
          <polygon points="10,27 40,44 40,74 10,57" fill={darken(c,30)} />
          <polygon points="70,27 40,44 40,74 70,57" fill={darken(c,15)} />
        </svg>
      )
    case 'cylinder':
      return (
        <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
          <defs>
            <linearGradient id={`cg-${c.replace('#','')}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#000" stopOpacity="0.3" />
              <stop offset="50%" stopColor="#fff" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#000" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          <ellipse cx="40" cy="60" rx="24" ry="10" fill={darken(c,20)} />
          <rect x="16" y="22" width="48" height="38" fill={c} />
          <rect x="16" y="22" width="48" height="38" fill={`url(#cg-${c.replace('#','')})`} opacity="0.3" />
          <ellipse cx="40" cy="22" rx="24" ry="10" fill={lighten(c,25)} />
        </svg>
      )
    case 'sphere':
      return (
        <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
          <defs>
            <radialGradient id={`sg-${c.replace('#','')}`} cx="35%" cy="35%" r="55%">
              <stop offset="0%" stopColor={lighten(c,40)} />
              <stop offset="100%" stopColor={darken(c,30)} />
            </radialGradient>
          </defs>
          <circle cx="40" cy="40" r="28" fill={`url(#sg-${c.replace('#','')})`} />
        </svg>
      )
    case 'cone':
      return (
        <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
          <ellipse cx="40" cy="65" rx="22" ry="9" fill={darken(c,25)} />
          <polygon points="40,12 62,65 18,65" fill={c} />
          <polygon points="40,12 62,65 40,65" fill={darken(c,15)} />
        </svg>
      )
    case 'torus':
      return (
        <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
          <ellipse cx="40" cy="50" rx="28" ry="12" fill={darken(c,20)} />
          <ellipse cx="40" cy="44" rx="28" ry="12" fill={c} />
          <ellipse cx="40" cy="44" rx="14" ry="5" fill="#f0f0f0" opacity="0.5" />
        </svg>
      )
    case 'pyramid':
      return (
        <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
          <polygon points="40,12 65,62 15,62" fill={c} />
          <polygon points="40,12 65,62 40,62" fill={darken(c,20)} />
          <ellipse cx="40" cy="62" rx="25" ry="7" fill={darken(c,30)} />
        </svg>
      )
    case 'capsule':
      return (
        <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
          <rect x="25" y="28" width="30" height="28" fill={c} />
          <ellipse cx="40" cy="28" rx="15" ry="10" fill={lighten(c,20)} />
          <ellipse cx="40" cy="56" rx="15" ry="10" fill={darken(c,20)} />
        </svg>
      )
    case 'dodecahedron':
      return (
        <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
          <polygon points="40,10 60,22 65,44 52,62 28,62 15,44 20,22" fill={c} />
          <polygon points="40,10 60,22 52,38 40,44 28,38 20,22" fill={lighten(c,20)} />
          <polygon points="40,44 52,38 65,44 52,62 28,62 15,44 28,38" fill={darken(c,20)} />
        </svg>
      )
    case 'hemisphere':
      return (
        <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
          <defs>
            <radialGradient id={`hg-${c.replace('#','')}`} cx="35%" cy="35%" r="65%">
              <stop offset="0%" stopColor={lighten(c,35)} />
              <stop offset="100%" stopColor={darken(c,25)} />
            </radialGradient>
          </defs>
          <ellipse cx="40" cy="56" rx="28" ry="10" fill={darken(c,30)} />
          <path d="M12,54 A28,30 0 0,1 68,54 Z" fill={`url(#hg-${c.replace('#','')})`} />
        </svg>
      )
    case 'wedge':
      return (
        <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
          <polygon points="20,60 60,60 60,20" fill={c} />
          <polygon points="20,60 60,60 40,70 10,70" fill={darken(c,25)} />
          <polygon points="60,60 60,20 50,28 50,70 60,60" fill={darken(c,15)} />
        </svg>
      )
    // Generic icon for OBJ models — a simple 3D box silhouette
    default:
      return (
        <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
          <polygon points="40,12 68,26 68,54 40,68 12,54 12,26" fill="#7a9cb8" />
          <polygon points="40,12 68,26 40,40 12,26" fill="#a8c4d8" />
          <polygon points="12,26 40,40 40,68 12,54" fill="#4a7090" />
          <polygon points="68,26 40,40 40,68 68,54" fill="#5a8098" />
          <text x="40" y="44" textAnchor="middle" fontSize="9" fill="#fff" fontFamily="monospace" fontWeight="bold">OBJ</text>
        </svg>
      )
  }
}