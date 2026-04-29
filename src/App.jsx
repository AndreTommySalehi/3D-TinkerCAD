import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Suspense } from 'react'
import { useRef, useEffect, useState, useCallback } from 'react'

import {
  MODELS, resolveCollision, BB_THICKNESS,
  isHoleOccupied, snapToBreadboard,
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
} from './components/scene/WireSystem.jsx'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function RendererSetup() {
  const { gl } = useThree()
  useEffect(() => {
    gl.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  }, [gl])
  return null
}

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

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const orbitRef = useRef()
  const [placed, setPlaced]               = useState([])
  const [activeShape, setActiveShape]     = useState(null)
  const [ghostPos, setGhostPos]           = useState(null)
  const [ghostBlocked, setGhostBlocked]   = useState(false)
  const [selectedId, setSelectedId]       = useState(null)
  const [rotations, setRotations]         = useState({})

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

  // ── Board shape ──
  const boardShape = placed.find(s => s.type === 'breadboard') ?? null

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

        // Keep rotations map in sync (used by OBJModel for its rotation prop)
        setRotations(prev => {
          const target = placed.find(s => s.id === selectedId)
          if (!target) return prev
          const newRot = ((target.rotationY ?? 0) + 90) % 360

          if (target.type === 'breadboard') {
            const updates = { [selectedId]: newRot }
            for (const s of placed) {
              if (s.id === selectedId) continue
              if (Math.abs(s.position[1] - BB_THICKNESS) > 0.1) continue
              updates[s.id] = ((s.rotationY ?? 0) + 90) % 360
            }
            return { ...prev, ...updates }
          }
          return { ...prev, [selectedId]: newRot }
        })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedId, selectedWireId, rotations, wiringMode, wireStart, placed])

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