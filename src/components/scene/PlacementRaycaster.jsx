import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { resolveCollision, MODELS, snapToBreadboard, BB_THICKNESS, isHoleOccupied } from '../../data/shapes.js'

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const isModelType  = (type) => MODELS.some(m => m.type === type)

// Apply visual offsetX/Z to a world position so stored position = mesh center
function applyVisualOffset(pos, componentType) {
  const modelDef = MODELS.find(m => m.type === componentType)
  if (!modelDef) return pos
  const ox = modelDef.offsetX ?? 0
  const oz = modelDef.offsetZ ?? 0
  if (!ox && !oz) return pos
  return [pos[0] + ox, pos[1], pos[2] + oz]
}

export function PlacementRaycaster({ activeShape, onPlace, onMove, placed }) {
  const { camera, gl, raycaster, pointer } = useThree()

  useFrame(() => {
    if (!activeShape) return
    raycaster.setFromCamera(pointer, camera)
    const hit = new THREE.Vector3()
    raycaster.ray.intersectPlane(groundPlane, hit)
    if (!hit) return

    // Breadboard snap — for non-breadboard OBJ components
    if (activeShape.type !== 'breadboard' && isModelType(activeShape.type)) {
      for (const s of placed) {
        if (s.type !== 'breadboard') continue
        const snapped = snapToBreadboard(
          s.position, s.rotationY ?? 0,
          [hit.x, 0, hit.z],
          activeShape.type
        )
        if (snapped) {
          const blocked = isHoleOccupied(s, snapped, activeShape.type, placed)
          // Store mesh center (snap + visual offset) so rotation pivot = mesh center
          onMove(applyVisualOffset(snapped, activeShape.type), blocked)
          return
        }
      }
    }

    // Normal ground placement
    const y = isModelType(activeShape.type) ? 0 : 0.5
    const resolved = resolveCollision([hit.x, y, hit.z], activeShape.type, placed)
    onMove(resolved, false)
  })

  useEffect(() => {
    if (!activeShape) return
    const handleClick = () => onPlace()
    gl.domElement.addEventListener('click', handleClick)
    return () => gl.domElement.removeEventListener('click', handleClick)
  }, [activeShape, onPlace, gl])

  return null
}