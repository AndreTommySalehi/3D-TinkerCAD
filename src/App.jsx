import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Suspense, useMemo } from 'react'
import { useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'

import {
  MODELS, resolveCollision, BB_THICKNESS,
  isHoleOccupied, snapToBreadboard, worldToLocal,
  POWER_RAIL_COLS, GROUND_RAIL_COLS,
} from './data/shapes.js'
import { OBJModel, OBJGhostPreview } from './components/shapes/OBJModel.jsx'
import { Ground }            from './components/scene/Ground.jsx'
import { Movement }          from './components/scene/Movement.jsx'
import { PlacementRaycaster } from './components/scene/PlacementRaycaster.jsx'
import {
  WireRaycaster,
  PlacedWires,
  WirePlacementPreview,
  WireColorPicker,
  snapWorldToHole,
} from './components/scene/WireSystem.jsx'
import { simulateCircuit, buildComponentEdges, getComponentPinStates } from './data/circuitSim.js'

// ─── Battery → breadboard wire visual ────────────────────────────────────────
function BatteryWire({ bw, pole }) {
  const color = pole === 'positive' ? '#ef4444' : '#1e40af'
  const s = new THREE.Vector3(...bw.terminalWorldPos)
  const e = new THREE.Vector3(...bw.holeWorldPos)
  const mid = s.clone().lerp(e, 0.5)
  const span = s.distanceTo(e)
  mid.y += Math.min(4, 1.5 + span * 0.3)
  const curve = new THREE.CubicBezierCurve3(
    s,
    new THREE.Vector3(s.x, s.y + Math.min(4, 1.5 + span * 0.3), s.z),
    new THREE.Vector3(e.x, e.y + Math.min(4, 1.5 + span * 0.3), e.z),
    e
  )
  return (
    <mesh>
      <tubeGeometry args={[curve, 32, 0.1, 8, false]} />
      <meshStandardMaterial color={color} roughness={1} metalness={0} />
    </mesh>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function RendererSetup() {
  const { gl } = useThree()
  useEffect(() => {
    gl.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  }, [gl])
  return null
}

const BATTERY_GROUND_Y = 0.8  // battery rests on ground at this Y center

// ─── Component categories ─────────────────────────────────────────────────────
const BREADBOARD_TYPES = ['breadboard']
const INPUT_TYPES      = ['resistor', 'capacitor', 'button', 'diode', 'ic', 'transistor']
const OUTPUT_TYPES     = ['buzzer', 'led_blue', 'led_green', 'led_red']

// ─── Generic component icon ───────────────────────────────────────────────────
function ComponentIcon({ active }) {
  const fill  = active ? '#93c5fd' : '#94a3b8'
  const light = active ? '#bfdbfe' : '#cbd5e1'
  const dark  = active ? '#60a5fa' : '#64748b'
  return (
    <svg viewBox="0 0 36 36" width="28" height="28">
      <polygon points="18,4 30,11 30,25 18,32 6,25 6,11" fill={fill} />
      <polygon points="18,4 30,11 18,18 6,11"             fill={light} />
      <polygon points="6,11 18,18 18,32 6,25"             fill={dark} />
      <polygon points="30,11 18,18 18,32 30,25"           fill={fill} opacity="0.75" />
    </svg>
  )
}

// ─── Sidebar section ──────────────────────────────────────────────────────────
function ComponentSection({ title, models, activeShape, wiringMode, onSelect }) {
  const [open, setOpen] = useState(true)
  if (!models.length) return null
  return (
    <div style={{ borderBottom: '1px solid #e2e8f0' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', border: 'none', background: '#f8fafc',
          cursor: 'pointer', fontSize: 10, fontWeight: 700, color: '#64748b',
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 9, color: '#94a3b8' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {models.map(model => {
            const isActive = activeShape?.type === model.type
            const disabled = wiringMode
            return (
              <button
                key={model.type}
                onClick={() => !disabled && onSelect({ type: model.type })}
                title={model.label}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', padding: '10px 4px 8px',
                  border: 'none',
                  borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0',
                  background: isActive ? '#eff6ff' : '#ffffff',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.4 : 1,
                  outline: isActive ? '2px solid #3b82f6' : 'none',
                  outlineOffset: -2,
                  transition: 'background 0.1s',
                  gap: 5,
                }}
                onMouseEnter={e => { if (!isActive && !disabled) e.currentTarget.style.background = '#f0f9ff' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = isActive ? '#eff6ff' : '#ffffff' }}
              >
                <ComponentIcon active={isActive} />
                <div style={{ fontSize: 9, color: '#64748b', textAlign: 'center', lineHeight: 1.2, fontWeight: 500 }}>
                  {model.label}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Pin markers + optional LED glow ─────────────────────────────────────────
function ComponentPinMarkers({ cs, showMarkers }) {
  const isLED = cs.modelDef.type?.startsWith('led')
  const glowColor = cs.modelDef.type === 'led_red'   ? '#ff3333'
                  : cs.modelDef.type === 'led_green' ? '#00ff44'
                  : '#2299ff'  // blue / default

  // The LED dome is visually offset from the snap-hole by visualOffsetX,
  // rotated by the component's own rotationY. Compute the actual dome
  // world position so glow/light sit correctly on the dome.
  const rotRad = ((cs.shape.rotationY ?? 0) * Math.PI) / 180
  const vox = cs.modelDef.visualOffsetX ?? 0
  const voz = cs.modelDef.visualOffsetZ ?? 0
  const domeCenterX = cs.shape.position[0] + vox * Math.cos(rotRad) - voz * Math.sin(rotRad)
  const domeCenterZ = cs.shape.position[2] + vox * Math.sin(rotRad) + voz * Math.cos(rotRad)

  return (
    <group>
      {/* Pin role markers — debug only */}
      {showMarkers && cs.pins.map((pin, i) => (
        <mesh
          key={i}
          position={[pin.worldX, BB_THICKNESS + 0.28, pin.worldZ]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[0.22, 0.07, 8, 20]} />
          <meshStandardMaterial
            color={pin.role === 'anode' ? '#ef4444' : '#3b82f6'}
            roughness={0.4}
            metalness={0.1}
            emissive={pin.role === 'anode' ? '#cc0000' : '#0033aa'}
            emissiveIntensity={0.6}
          />
        </mesh>
      ))}

      {/* Strong point light at dome when powered */}
      {isLED && cs.active && (
        <pointLight
          position={[domeCenterX, BB_THICKNESS + 3.2, domeCenterZ]}
          color={glowColor}
          intensity={18}
          distance={16}
          decay={2}
        />
      )}

      {/* Inner bright core — tight, semi-opaque */}
      {isLED && cs.active && (
        <mesh position={[domeCenterX, BB_THICKNESS + 2.5, domeCenterZ]}>
          <sphereGeometry args={[0.6, 16, 16]} />
          <meshBasicMaterial color={glowColor} transparent opacity={0.55} depthWrite={false} />
        </mesh>
      )}

      {/* Mid halo */}
      {isLED && cs.active && (
        <mesh position={[domeCenterX, BB_THICKNESS + 2.5, domeCenterZ]}>
          <sphereGeometry args={[1.6, 16, 16]} />
          <meshBasicMaterial color={glowColor} transparent opacity={0.18} depthWrite={false} />
        </mesh>
      )}

      {/* Wide atmospheric bloom */}
      {isLED && cs.active && (
        <mesh position={[domeCenterX, BB_THICKNESS + 2.0, domeCenterZ]}>
          <sphereGeometry args={[3.0, 16, 16]} />
          <meshBasicMaterial color={glowColor} transparent opacity={0.06} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const orbitRef = useRef()
  const [placed, setPlaced]               = useState([])
  const [showPinMarkers, setShowPinMarkers] = useState(false)
  const [activeShape, setActiveShape]     = useState(null)
  const [ghostPos, setGhostPos]           = useState(null)
  const [ghostBlocked, setGhostBlocked]   = useState(false)
  const [selectedId, setSelectedId]       = useState(null)


  // ── Wires ──
  const [wiringMode, setWiringMode]         = useState(false)
  const [wireColor, setWireColor]           = useState('#ef4444')
  const [wireStart, setWireStart]           = useState(null)
  const [wireHover, setWireHover]           = useState(null)
  const [wires, setWires]                   = useState([])
  const [selectedWireId, setSelectedWireId] = useState(null)

  // ── Imperative refs for board drag ──
  const groupRefs = useRef({})

  // ── Board drag: wires update via boardGroupRef imperatively; we just commit on end ──
  const handleBoardDragFrame = useCallback(() => {}, [])

  const handleDragEnd = useCallback((id, finalBoardPos, riderFinal) => {
    if (!finalBoardPos) return
    setPlaced(prev => prev.map(s => {
      if (s.id === id) return { ...s, position: finalBoardPos }
      if (riderFinal?.[s.id]) return { ...s, position: riderFinal[s.id] }
      return s
    }))
  }, [])

  const handleMove = useCallback((pos, blocked = false) => {
    setGhostPos([...pos])
    setGhostBlocked(blocked)
  }, [])

  const handlePlace = useCallback(() => {
    if (!ghostPos || !activeShape || ghostBlocked) return
    setPlaced(prev => [...prev, {
      id: Date.now(), type: activeShape.type,
      position: [...ghostPos], color: activeShape.color ?? '#ffffff', rotationY: 0,
    }])
    setActiveShape(null)
    setGhostPos(null)
    setGhostBlocked(false)
  }, [ghostPos, activeShape, ghostBlocked])

  const handleSelectShape = (shapeEntry) => {
    setActiveShape(prev => prev?.type === shapeEntry.type ? null : shapeEntry)
    setGhostPos(null)
    setGhostBlocked(false)
    setSelectedId(null)
    setSelectedWireId(null)
  }

  const handleDragStart = useCallback((_id) => {}, [])

  const handleDragMove = useCallback((id, pos) => {
    setPlaced(prev => prev.map(s => s.id === id ? { ...s, position: pos } : s))
  }, [])

  const handleSelectPlaced = useCallback((id) => {
    if (activeShape || wiringMode) return
    setSelectedId(prev => prev === id ? null : id)
    setSelectedWireId(null)
  }, [activeShape, wiringMode])

  const handleSelectWire = useCallback((id) => {
    if (wiringMode && wireStart) return
    setSelectedWireId(prev => prev === id ? null : id)
    setSelectedId(null)
  }, [wiringMode, wireStart])

  const handleGroundPointerDown = useCallback((e) => {
    e.stopPropagation()
    setSelectedId(null)
    setSelectedWireId(null)
  }, [])

  // ── Board shape ──
  const boardShape = placed.find(s => s.type === 'breadboard') ?? null

  // ── Wire placement ──
  const handleWireHoleClick = useCallback((holeResult) => {
    if (!wireStart) {
      setWireStart(holeResult)
    } else {
      const dx = holeResult.worldPos[0] - wireStart.worldPos[0]
      const dz = holeResult.worldPos[2] - wireStart.worldPos[2]
      if (Math.sqrt(dx * dx + dz * dz) > 0.1) {
        setWires(prev => [...prev, {
          id: Date.now(),
          startLocal: [wireStart.localX, wireStart.localZ],
          endLocal:   [holeResult.localX, holeResult.localZ],
          color: wireColor,
        }])
      }
      setWireStart(null)
    }
  }, [wireStart, wireColor])

  const handleWireHover = useCallback((pos) => setWireHover(pos), [])

  const toggleWiringMode = () => {
    setWiringMode(w => !w)
    setWireStart(null)
    setWireHover(null)
    setActiveShape(null)
    setSelectedId(null)
    setSelectedWireId(null)
  }

  // ── Circuit simulation + component pin states (merged so edges are built first) ──
  const { poweredNodes, groundedNodes, componentStates } = useMemo(() => {
    // Build conductance edges from placed components so power flows through them
    const componentEdges = buildComponentEdges(placed, boardShape, MODELS)
    const { poweredNodes, groundedNodes } = simulateCircuit(wires, componentEdges)

    // Now compute each component's pin states
    const componentStates = boardShape
      ? placed
          .filter(s => s.type !== 'breadboard')
          .map(s => {
            const modelDef = MODELS.find(m => m.type === s.type)
            if (!modelDef?.pins?.length) return null
            const state = getComponentPinStates(s, boardShape, modelDef, poweredNodes, groundedNodes)
            if (!state) return null
            return { shape: s, modelDef, ...state }
          })
          .filter(Boolean)
      : []

    // Tag active polar components with whether a resistor is in their circuit path.
    // A resistor is conducting if both its pin nodes are powered (power flowed through it).
    const resistors = placed.filter(s => s.type === 'resistor')
    const hasResistorInPath = resistors.some(r => {
      const rDef = MODELS.find(m => m.type === 'resistor')
      if (!rDef?.pins?.length) return false
      const state = getComponentPinStates(r, boardShape, rDef, poweredNodes, groundedNodes)
      return state?.active
    })
    const taggedStates = componentStates.map(cs =>
      cs.active && cs.modelDef.anodePinIndex != null
        ? { ...cs, hasResistor: hasResistorInPath }
        : cs
    )

    return { poweredNodes, groundedNodes, componentStates: taggedStates }
  }, [wires, placed, boardShape])

  // ── Rail connection notifications ──
  // Check if any endpoint of any placed wire is on a power or ground rail
  const RAIL_TOLERANCE = 0.4
  const isOnRail = (localZ, railCols) =>
    railCols.some(c => Math.abs(localZ - c) < RAIL_TOLERANCE)

  const railMessages = useMemo(() => {
    const msgs = []
    for (const w of wires) {
      const [, slz] = w.startLocal
      const [, elz] = w.endLocal
      const startPower  = isOnRail(slz, POWER_RAIL_COLS)
      const startGround = isOnRail(slz, GROUND_RAIL_COLS)
      const endPower    = isOnRail(elz, POWER_RAIL_COLS)
      const endGround   = isOnRail(elz, GROUND_RAIL_COLS)
      if (startPower  || endPower)  msgs.push({ id: w.id, type: 'power',  text: 'Wire connected to power rail (+)' })
      if (startGround || endGround) msgs.push({ id: w.id, type: 'ground', text: 'Wire connected to ground rail (−)' })
    }
    // Deduplicate — only show each type once
    const seen = new Set()
    return msgs.filter(m => {
      if (seen.has(m.type)) return false
      seen.add(m.type)
      return true
    })
  }, [wires])

  // Auto-dismiss rail messages 3s after they last changed
  const [railMsgVisible, setRailMsgVisible] = useState(false)
  const railDismissTimer = useRef(null)
  useEffect(() => {
    if (railMessages.length > 0) {
      setRailMsgVisible(true)
      clearTimeout(railDismissTimer.current)
      railDismissTimer.current = setTimeout(() => setRailMsgVisible(false), 3000)
    }
    return () => clearTimeout(railDismissTimer.current)
  }, [railMessages])

  useEffect(() => {
    const handler = (e) => {
      if (wiringMode) {
        if (e.code === 'Escape') {
          if (wireStart) setWireStart(null)
          else setWiringMode(false)
        }
        if ((e.code === 'Delete' || e.code === 'Backspace') && selectedWireId) {
          setWires(prev => prev.filter(w => w.id !== selectedWireId))
          setSelectedWireId(null)
        }
        return
      }

      if ((e.code === 'Delete' || e.code === 'Backspace') && selectedWireId) {
        setWires(prev => prev.filter(w => w.id !== selectedWireId))
        setSelectedWireId(null)
        return
      }
      if ((e.code === 'Delete' || e.code === 'Backspace') && selectedId) {
        setPlaced(prev => prev.filter(s => s.id !== selectedId))
        setSelectedId(null)
      }
      if (e.code === 'Escape') {
        setActiveShape(null)
        setSelectedId(null)
        setSelectedWireId(null)
      }

      if (e.code === 'KeyR' && selectedId) {
        setPlaced(prev => {
          const target = prev.find(s => s.id === selectedId)
          if (!target) return prev

          const newRot = ((target.rotationY ?? 0) + 90) % 360

          // ── If rotating the breadboard, also rotate all riders around its centre ──
          if (target.type === 'breadboard') {
            const [bx, by, bz] = target.position
            // Rotation delta in radians (always +90°)
            const delta = Math.PI / 2

            return prev.map(s => {
              if (s.id === selectedId) return { ...s, rotationY: newRot }

              // Only move components sitting on this board
              if (Math.abs(s.position[1] - BB_THICKNESS) > 0.1) return s

              // Rotate rider offset around board centre by +90°
              const dx = s.position[0] - bx
              const dz = s.position[2] - bz
              const nx = dx * Math.cos(delta) - dz * Math.sin(delta)
              const nz = dx * Math.sin(delta) + dz * Math.cos(delta)

              // Also update the rider's own rotationY to face the same way
              const riderNewRot = ((s.rotationY ?? 0) + 90) % 360

              return {
                ...s,
                position: [bx + nx, s.position[1], bz + nz],
                rotationY: riderNewRot,
              }
            })
          }

          // ── Normal component rotation ──
          return prev.map(s => s.id === selectedId ? { ...s, rotationY: newRot } : s)
        })

      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedId, selectedWireId, wiringMode, wireStart, placed])

  const sharedProps = {
    onSelect: handleSelectPlaced,
    onDragStart: handleDragStart,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    orbitRef, placed, resolveCollision, groupRefs,
    onBoardDragFrame: handleBoardDragFrame,
  }

  let cursor = 'default'
  if (wiringMode) cursor = wireStart ? 'cell' : 'crosshair'
  else if (activeShape) cursor = 'crosshair'

  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    }}>

      {/* ── Side Panel ── */}
      <div style={{
        width: 220, background: '#ffffff', borderRight: '1px solid #e2e8f0',
        display: 'flex', flexDirection: 'column', zIndex: 10, overflow: 'hidden',
        boxShadow: '2px 0 8px rgba(0,0,0,0.07)',
      }}>
        <div style={{
          padding: '14px 14px 12px', borderBottom: '1px solid #e2e8f0',
          background: 'linear-gradient(135deg, #1e3a5f 0%, #0f2440 100%)',
        }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, letterSpacing: '0.01em' }}>
            Circuit Builder
          </div>
          <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 2 }}>
            Select a component to place
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ borderBottom: '1px solid #e2e8f0', padding: '10px 10px 8px' }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: '#64748b',
              letterSpacing: '0.08em', textTransform: 'uppercase',
              marginBottom: 8,
            }}>
              Wires
            </div>
            <button
              onClick={toggleWiringMode}
              style={{
                width: '100%', padding: '7px 0',
                background: wiringMode ? '#fef3c7' : '#f8fafc',
                border: `1.5px solid ${wiringMode ? '#f59e0b' : '#cbd5e1'}`,
                borderRadius: 6,
                color: wiringMode ? '#92400e' : '#475569',
                cursor: 'pointer',
                fontWeight: 600, fontSize: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'all 0.15s',
                boxShadow: wiringMode ? '0 0 0 3px rgba(245,158,11,0.15)' : 'none',
              }}
            >
              {wiringMode
                ? (wireStart ? 'Click end hole...' : 'Click start hole...')
                : 'Add Wire'}
            </button>
            {wiringMode && (
              <>
                <WireColorPicker color={wireColor} onChange={setWireColor} />
                <div style={{ fontSize: 10, color: '#94a3b8', padding: '0 2px 4px', lineHeight: 1.6 }}>
                  {wireStart
                    ? 'Click a 2nd hole to finish. Esc = cancel.'
                    : 'Click a hole to start. Esc = exit.'}
                </div>
              </>
            )}
            {selectedWireId && !wiringMode && (
              <div style={{ fontSize: 10, color: '#f87171', marginTop: 6 }}>
                Wire selected — Del to delete
              </div>
            )}
          </div>

          <ComponentSection
            title="Breadboard"
            models={MODELS.filter(m => BREADBOARD_TYPES.includes(m.type))}
            activeShape={activeShape} wiringMode={wiringMode} onSelect={handleSelectShape}
          />
          <ComponentSection
            title="Inputs"
            models={MODELS.filter(m => INPUT_TYPES.includes(m.type))}
            activeShape={activeShape} wiringMode={wiringMode} onSelect={handleSelectShape}
          />
          <ComponentSection
            title="Outputs"
            models={MODELS.filter(m => OUTPUT_TYPES.includes(m.type))}
            activeShape={activeShape} wiringMode={wiringMode} onSelect={handleSelectShape}
          />
        </div>

        <div style={{
          padding: '8px 12px', borderTop: '1px solid #e2e8f0',
          background: '#f8fafc', color: '#94a3b8', fontSize: 10, lineHeight: 1.9,
        }}>
          <div><b style={{color:'#64748b'}}>WASD</b> move &nbsp;·&nbsp; <b style={{color:'#64748b'}}>Space/Shift</b> up/down</div>
          <div><b style={{color:'#64748b'}}>Drag</b> rotate &nbsp;·&nbsp; <b style={{color:'#64748b'}}>Scroll</b> zoom</div>
          <div><b style={{color:'#64748b'}}>Click</b> select &nbsp;·&nbsp; <b style={{color:'#64748b'}}>Del</b> delete &nbsp;·&nbsp; <b style={{color:'#64748b'}}>R</b> rotate</div>
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #e2e8f0' }}>
            <button
              onClick={() => setShowPinMarkers(v => !v)}
              style={{
                width: '100%', padding: '4px 0', fontSize: 10, fontFamily: 'monospace',
                background: showPinMarkers ? '#fef9c3' : '#f1f5f9',
                border: '1px solid ' + (showPinMarkers ? '#ca8a04' : '#cbd5e1'),
                borderRadius: 4, color: showPinMarkers ? '#92400e' : '#64748b',
                cursor: 'pointer', fontWeight: showPinMarkers ? 700 : 400,
              }}
            >
              {showPinMarkers ? '● Pin Markers ON' : '○ Pin Markers OFF'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Canvas area ── */}
      <div style={{ flex: 1, position: 'relative', cursor }}>
        <div style={{
          position: 'absolute', inset: 0, zIndex: 0,
          background: 'linear-gradient(180deg, #aecde8 0%, #c8dff2 30%, #daeaf8 60%, #eef5fc 100%)',
        }} />

        {!wiringMode && activeShape && (
          <div style={{
            position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
            background: ghostBlocked ? 'rgba(40,0,0,0.88)' : 'rgba(15,23,42,0.82)',
            color: ghostBlocked ? '#f87171' : '#38bdf8',
            padding: '6px 18px', borderRadius: 999, fontSize: 12,
            pointerEvents: 'none', zIndex: 5, backdropFilter: 'blur(6px)',
            border: `1px solid ${ghostBlocked ? '#7f1d1d' : '#1e40af'}`,
          }}>
            {ghostBlocked ? 'Hole occupied' : 'Click to place · Esc to cancel'}
          </div>
        )}

        {wiringMode && (
          <div style={{
            position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
            background: wireStart ? 'rgba(30,15,0,0.9)' : 'rgba(15,23,42,0.88)',
            color: wireStart ? '#f59e0b' : '#fcd34d',
            padding: '6px 18px', borderRadius: 999, fontSize: 12,
            pointerEvents: 'none', zIndex: 5, backdropFilter: 'blur(6px)',
            border: `1px solid ${wireStart ? '#f59e0b' : '#78350f'}`,
          }}>
            {wireStart ? 'Click end hole to finish · Esc = cancel' : 'Wire mode — click a hole to start · Esc = exit'}
          </div>
        )}

        {selectedId && !wiringMode && (
          <div style={{
            position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(15,23,42,0.75)', color: '#f8fafc',
            padding: '5px 16px', borderRadius: 999, fontSize: 11,
            pointerEvents: 'none', zIndex: 5, backdropFilter: 'blur(6px)',
            border: '1px solid #334155',
          }}>
            Del to delete · click ground to deselect · R to rotate
          </div>
        )}

        {selectedWireId && !wiringMode && (
          <div style={{
            position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(15,23,42,0.75)', color: '#f87171',
            padding: '5px 16px', borderRadius: 999, fontSize: 11,
            pointerEvents: 'none', zIndex: 5, backdropFilter: 'blur(6px)',
            border: '1px solid #334155',
          }}>
            Wire selected · Del to delete · click ground to deselect
          </div>
        )}

        {/* ── Component power status ── */}
        {componentStates.some(c => c.active || c.reversedPolarity) && (
          <div style={{
            position: 'absolute', bottom: 44, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center',
            pointerEvents: 'none', zIndex: 5,
          }}>
            {componentStates.filter(c => c.active || c.reversedPolarity).map(c => (
              <div key={c.shape.id} style={{
                background: c.active
                  ? 'rgba(34,197,94,0.15)'
                  : 'rgba(239,68,68,0.15)',
                border: `1px solid ${c.active ? '#22c55e' : '#ef4444'}`,
                color: c.active ? '#86efac' : '#fca5a5',
                padding: '4px 14px', borderRadius: 999, fontSize: 11,
                backdropFilter: 'blur(6px)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span>{c.active ? '✅' : '⚠️'}</span>
                {c.modelDef.label}:&nbsp;
                {c.active ? (c.isTerminal ? 'in circuit ✓' : c.hasResistor ? 'powered ✓ (with resistor)' : 'powered') : 'reversed polarity — flip component'}
              </div>
            ))}
          </div>
        )}
        {railMessages.length > 0 && railMsgVisible && !wiringMode && !activeShape && (
          <div style={{
            position: 'absolute', bottom: 14, right: 14,
            display: 'flex', flexDirection: 'column', gap: 6,
            pointerEvents: 'none', zIndex: 5,
          }}>
            {railMessages.map(m => (
              <div key={m.type} style={{
                background: m.type === 'power' ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
                border: `1px solid ${m.type === 'power' ? '#ef4444' : '#3b82f6'}`,
                color: m.type === 'power' ? '#fca5a5' : '#93c5fd',
                padding: '5px 14px', borderRadius: 999, fontSize: 11,
                backdropFilter: 'blur(6px)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span>{m.type === 'power' ? '⚡' : '⏚'}</span>
                {m.text}
              </div>
            ))}
          </div>
        )}

        <Canvas
          shadows
          camera={{ position: [6, 4, 8], fov: 60 }}
          style={{ position: 'relative', zIndex: 1, background: 'transparent' }}
        >
          <ambientLight intensity={0.9} />
          <directionalLight
            position={[10, 18, 10]} intensity={2.2} castShadow
            shadow-mapSize-width={2048} shadow-mapSize-height={2048}
            shadow-camera-far={80} shadow-camera-left={-35}
            shadow-camera-right={35} shadow-camera-top={35} shadow-camera-bottom={-35}
            shadow-bias={-0.001}
          />
          <directionalLight position={[-6, 8, -4]} intensity={0.5} />
          <hemisphereLight skyColor="#c8dff5" groundColor="#b0cce0" intensity={0.6} />

          <RendererSetup />
          <Ground onPointerDown={handleGroundPointerDown} />

          <Suspense fallback={null}>
            {placed.map(s =>
              <OBJModel
                key={s.id} shape={s}
                isSelected={selectedId === s.id}
                rotationY={s.rotationY ?? 0}
                {...sharedProps}
              />
            )}

            {/* ── Pin role markers + LED glow ── */}
            {componentStates.map(cs => (
              <ComponentPinMarkers key={cs.shape.id} cs={cs} showMarkers={showPinMarkers} />
            ))}

            {!wiringMode && activeShape && ghostPos && (
              <OBJGhostPreview type={activeShape.type} position={ghostPos} blocked={ghostBlocked} />
            )}

            <PlacedWires
              wires={wires}
              boardShape={boardShape}
              boardGroupRef={boardShape ? groupRefs.current[boardShape.id] : null}
              selectedWireId={selectedWireId}
              onSelectWire={handleSelectWire}
            />

            {wiringMode && wireStart && wireHover && (
              <WirePlacementPreview wireStart={wireStart.worldPos} hoverPos={wireHover} color={wireColor} />
            )}
          </Suspense>

          <OrbitControls
            ref={orbitRef}
            mouseButtons={{ LEFT: 0 }}
            minDistance={1.5} maxDistance={60}
            minPolarAngle={0.05} maxPolarAngle={Math.PI / 2 - 0.05}
            enablePan={false} enableDamping={false}
          />
          <Movement orbitRef={orbitRef} />

          {!wiringMode && (
            <PlacementRaycaster activeShape={activeShape} onPlace={handlePlace} onMove={handleMove} placed={placed} />
          )}
          {wiringMode && (
            <WireRaycaster active={wiringMode} boardShape={boardShape} onHover={handleWireHover} onHoleClick={handleWireHoleClick} />
          )}
        </Canvas>
      </div>
    </div>
  )
}