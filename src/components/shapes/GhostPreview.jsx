import { ShapeGeometry } from './ShapeGeometry.jsx'
import { MODELS } from '../../data/shapes.js'

export function GhostPreview({ type, position, blocked = false }) {
  if (!position) return null
  if (MODELS.find(m => m.type === type)) return null
  return (
    <mesh position={position}>
      <ShapeGeometry type={type} />
      <meshStandardMaterial
        color={blocked ? '#f87171' : '#38bdf8'}
        transparent
        opacity={0.45}
        depthWrite={false}
      />
    </mesh>
  )
}