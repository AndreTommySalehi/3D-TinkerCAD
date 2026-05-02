import { useRef, useState } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const BATTERY_W = 3.2
const BATTERY_H = 1.6
const BATTERY_D = 1.8
const TERMINAL_R = 0.22
const TERMINAL_H = 0.45
const TERMINAL_Y = BATTERY_H / 2 + TERMINAL_H / 2

// World positions of the + and - terminals relative to battery center
export function getBatteryTerminalPositions(batteryPos) {
  const [bx, by, bz] = batteryPos
  return {
    positive: [bx + 0.85, by + BATTERY_H / 2 + TERMINAL_H, bz],
    negative: [bx - 0.85, by + BATTERY_H / 2 + TERMINAL_H, bz],
  }
}

function Terminal({ position, color, label, isHovered, isSelected, onClick, onHover }) {
  return (
    <group position={position}>
      <mesh
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerEnter={(e) => { e.stopPropagation(); onHover(true) }}
        onPointerLeave={(e) => { e.stopPropagation(); onHover(false) }}
      >
        <cylinderGeometry args={[TERMINAL_R, TERMINAL_R, TERMINAL_H, 12]} />
        <meshStandardMaterial
          color={isSelected ? '#ffffff' : isHovered ? '#fffde7' : color}
          emissive={isSelected ? color : isHovered ? color : '#000000'}
          emissiveIntensity={isSelected ? 0.8 : isHovered ? 0.4 : 0}
          roughness={0.6} metalness={0.4}
        />
      </mesh>
      {/* Terminal cap disc */}
      <mesh position={[0, TERMINAL_H / 2 + 0.02, 0]}>
        <cylinderGeometry args={[TERMINAL_R * 1.3, TERMINAL_R * 1.3, 0.06, 12]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.5} />
      </mesh>
    </group>
  )
}

export function Battery({ battery, isSelected, onSelect, onTerminalClick, activeTerminal, orbitRef }) {
  const [hoveredTerminal, setHoveredTerminal] = useState(null)
  const { camera, raycaster, pointer, gl } = useThree()
  const dragging     = useRef(false)
  const pointerDown  = useRef(null)
  const dragPlane    = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const DRAG_THRESHOLD = 5

  const [bx, by, bz] = battery.position

  const handlePointerDown = (e) => {
    e.stopPropagation()
    pointerDown.current = { x: e.clientX, y: e.clientY }

    const onMove = (me) => {
      if (!pointerDown.current) return
      const dx = me.clientX - pointerDown.current.x
      const dy = me.clientY - pointerDown.current.y
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD && !dragging.current) {
        dragging.current = true
        gl.domElement.style.cursor = 'grabbing'
        if (orbitRef.current) orbitRef.current.enabled = false
      }
    }
    const onUp = () => {
      const wasDragging = dragging.current
      pointerDown.current = null
      dragging.current = false
      gl.domElement.style.cursor = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!wasDragging) onSelect(battery.id)
      if (orbitRef.current) orbitRef.current.enabled = true
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  useFrame(() => {
    if (!dragging.current) return
    raycaster.setFromCamera(pointer, camera)
    const hit = new THREE.Vector3()
    raycaster.ray.intersectPlane(dragPlane.current, hit)
    if (hit) {
      // notify parent — battery drags freely on the ground
    }
  })

  const terminals = getBatteryTerminalPositions(battery.position)

  return (
    <group position={[bx, by, bz]} onPointerDown={handlePointerDown}>
      {/* Battery body */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[BATTERY_W, BATTERY_H, BATTERY_D]} />
        <meshStandardMaterial
          color={isSelected ? '#38bdf8' : '#2d3748'}
          emissive={isSelected ? '#0369a1' : '#000000'}
          emissiveIntensity={isSelected ? 0.2 : 0}
          roughness={0.8} metalness={0.1}
        />
      </mesh>

      {/* Label stripe */}
      <mesh position={[0, 0, BATTERY_D / 2 + 0.01]}>
        <planeGeometry args={[BATTERY_W - 0.3, BATTERY_H - 0.3]} />
        <meshBasicMaterial color="#1a202c" />
      </mesh>

      {/* + / - text indicators on body */}
      <mesh position={[0.85, 0, BATTERY_D / 2 + 0.015]}>
        <planeGeometry args={[0.35, 0.35]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
      <mesh position={[-0.85, 0, BATTERY_D / 2 + 0.015]}>
        <planeGeometry args={[0.35, 0.35]} />
        <meshBasicMaterial color="#1e40af" />
      </mesh>

      {/* Positive terminal (red) */}
      <Terminal
        position={[0.85, TERMINAL_Y, 0]}
        color="#ef4444"
        label="+"
        isHovered={hoveredTerminal === 'positive'}
        isSelected={activeTerminal?.batteryId === battery.id && activeTerminal?.pole === 'positive'}
        onClick={() => onTerminalClick(battery.id, 'positive', terminals.positive)}
        onHover={(h) => setHoveredTerminal(h ? 'positive' : null)}
      />

      {/* Negative terminal (black/blue) */}
      <Terminal
        position={[-0.85, TERMINAL_Y, 0]}
        color="#1e40af"
        label="−"
        isHovered={hoveredTerminal === 'negative'}
        isSelected={activeTerminal?.batteryId === battery.id && activeTerminal?.pole === 'negative'}
        onClick={() => onTerminalClick(battery.id, 'negative', terminals.negative)}
        onHover={(h) => setHoveredTerminal(h ? 'negative' : null)}
      />
    </group>
  )
}