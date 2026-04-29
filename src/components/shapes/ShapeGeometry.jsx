export function ShapeGeometry({ type }) {
  switch (type) {
    case 'cube':         return <boxGeometry args={[1, 1, 1]} />
    case 'cylinder':     return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />
    case 'sphere':       return <sphereGeometry args={[0.5, 32, 32]} />
    case 'cone':         return <coneGeometry args={[0.5, 1, 32]} />
    case 'torus':        return <torusGeometry args={[0.4, 0.18, 16, 64]} />
    case 'pyramid':      return <coneGeometry args={[0.6, 1, 4]} />
    case 'capsule':      return <capsuleGeometry args={[0.3, 0.6, 8, 16]} />
    case 'dodecahedron': return <dodecahedronGeometry args={[0.55]} />
    case 'hemisphere':   return <sphereGeometry args={[0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
    case 'wedge':        return <cylinderGeometry args={[0, 0.6, 1, 3]} />
    default:             return <boxGeometry args={[1, 1, 1]} />
  }
}