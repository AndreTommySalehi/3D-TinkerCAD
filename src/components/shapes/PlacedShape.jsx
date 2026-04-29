import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ShapeGeometry } from './ShapeGeometry.jsx'

export function PlacedShape({ shape, isSelected, onSelect, onDragStart, onDragMove, orbitRef, placed, resolveCollision, rotationY = 0 }) {
  const { camera, raycaster, pointer, gl } = useThree()
  const dragging      = useRef(false)
  const pointerDownAt = useRef(null)
  const dragPlane     = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -shape.position[1]))
  const DRAG_THRESHOLD = 5

  const handlePointerDown = (e) => {
    e.stopPropagation()
    pointerDownAt.current = { x: e.clientX, y: e.clientY }
    dragPlane.current.constant = -shape.position[1]

    const onWindowMove = (me) => {
      if (!pointerDownAt.current) return
      const dx = me.clientX - pointerDownAt.current.x
      const dy = me.clientY - pointerDownAt.current.y
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD && !dragging.current) {
        dragging.current = true
        gl.domElement.style.cursor = 'grabbing'
        if (orbitRef.current) orbitRef.current.enabled = false
        onDragStart?.(shape.id)
      }
    }

    const onWindowUp = () => {
      const wasDragging = dragging.current
      pointerDownAt.current = null
      dragging.current = false
      gl.domElement.style.cursor = ''
      window.removeEventListener('pointermove', onWindowMove)
      window.removeEventListener('pointerup', onWindowUp)

      if (wasDragging) {
        requestAnimationFrame(() => {
          if (orbitRef.current) orbitRef.current.enabled = true
        })
      } else {
        onSelect(shape.id)
        if (orbitRef.current) orbitRef.current.enabled = true
      }
    }

    window.addEventListener('pointermove', onWindowMove)
    window.addEventListener('pointerup', onWindowUp)
  }

  useFrame(() => {
    if (!dragging.current) return
    raycaster.setFromCamera(pointer, camera)
    const hit = new THREE.Vector3()
    raycaster.ray.intersectPlane(dragPlane.current, hit)
    if (hit) {
      const resolved = resolveCollision(
        [hit.x, shape.position[1], hit.z],
        shape.type,
        placed,
        shape.id
      )
      onDragMove(shape.id, resolved)
    }
  })

  return (
    <mesh
      position={shape.position}
      rotation={[0, (rotationY * Math.PI) / 180, 0]}
      castShadow
      receiveShadow
      onPointerDown={handlePointerDown}
    >
      <ShapeGeometry type={shape.type} />
      <meshStandardMaterial
        color={isSelected ? '#38bdf8' : shape.color}
        emissive={isSelected ? '#0369a1' : '#000000'}
        emissiveIntensity={isSelected ? 0.35 : 0}
      />
      {isSelected && (
        <mesh scale={[1.06, 1.06, 1.06]}>
          <ShapeGeometry type={shape.type} />
          <meshBasicMaterial color="#38bdf8" side={THREE.BackSide} transparent opacity={0.4} />
        </mesh>
      )}
    </mesh>
  )
}