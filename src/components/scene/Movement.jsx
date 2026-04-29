import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useKeyboard } from '../../hooks/useKeyboard.js'

const GROUND_Y = 0.6

export function Movement({ orbitRef }) {
  const { camera } = useThree()
  const keys  = useKeyboard()
  const speed = 0.08

  useFrame(() => {
    if (!orbitRef.current) return
    const ctrl    = orbitRef.current
    const forward = new THREE.Vector3()
    const right   = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0; forward.normalize()
    right.crossVectors(forward, camera.up).normalize()

    const move = new THREE.Vector3()
    if (keys.current['KeyW'])                                     move.addScaledVector(forward,  speed)
    if (keys.current['KeyS'])                                     move.addScaledVector(forward, -speed)
    if (keys.current['KeyA'])                                     move.addScaledVector(right,   -speed)
    if (keys.current['KeyD'])                                     move.addScaledVector(right,    speed)
    if (keys.current['Space'])                                    move.y += speed
    if (keys.current['ShiftLeft'] || keys.current['ShiftRight']) move.y -= speed

    if (move.lengthSq() > 0) {
      const nextY = camera.position.y + move.y
      if (nextY < GROUND_Y) move.y = Math.max(0, GROUND_Y - camera.position.y)
      camera.position.add(move)
      ctrl.target.add(move)
    }

    if (camera.position.y < GROUND_Y) camera.position.y = GROUND_Y
    if (ctrl.target.y < 0) ctrl.target.y = 0
    ctrl.update()
  })

  return null
}