import { useEffect, useRef, useMemo, useState } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js'
import { BB_THICKNESS, BB_ROWS, BB_COLS, BB_HALF_LENGTH, BB_HALF_WIDTH } from '../../data/shapes.js'

// ─── Wire colours ─────────────────────────────────────────────────────────────
export const WIRE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ffffff', '#f8fafc']

// ─── Wire geometry constants ──────────────────────────────────────────────────
const ARC_BASE    = 1.8     // how high the vertical exit goes before bending
const ARC_FACTOR  = 0.45    // extra height for longer wires
const WIRE_RADIUS = 0.13    // thicker wire
const WIRE_SEGS   = 40      // smooth tube
const WIRE_RADIAL = 6       // reduced radial segs for low-poly look
const PIN_HEIGHT  = 0.32    // shorter pin base
const PIN_SCALE   = 0.35    // wider diameter for wire base OBJ

// ─── WireBase OBJ — load once, clone for each pin ────────────────────────────
let _wireBasePromise = null
let _wireBaseSource  = null

function loadWireBase() {
  if (_wireBasePromise) return _wireBasePromise
  _wireBasePromise = new Promise((resolve) => {
    const objPath = '/models/WireBase/WireBase.obj'
    const mtlPath = '/models/WireBase/WireBase.mtl'

    function processObj(obj) {
      const box = new THREE.Box3().setFromObject(obj)
      const center = new THREE.Vector3(); box.getCenter(center)
      obj.position.set(-center.x, -box.min.y, -center.z)
      // Consistent dark matte material — no reflectivity
      const mat = new THREE.MeshStandardMaterial({ color: '#1c1c1c', roughness: 1, metalness: 0 })
      obj.traverse(c => { if (c.isMesh) c.material = mat })
      const group = new THREE.Group()
      group.scale.setScalar(PIN_SCALE)
      group.add(obj)
      _wireBaseSource = group
      resolve(group)
    }

    function loadObjOnly() {
      new OBJLoader().load(objPath, processObj, undefined, (err) => {
        console.warn('WireBase load failed, using fallback:', err)
        resolve(null)
      })
    }

    const mtlLoader = new MTLLoader()
    mtlLoader.setResourcePath('/models/WireBase/Textures/')
    mtlLoader.load(mtlPath, (mats) => {
      mats.preload()
      const loader = new OBJLoader()
      loader.setMaterials(mats)
      loader.load(objPath, processObj, undefined, loadObjOnly)
    }, undefined, loadObjOnly)
  })
  return _wireBasePromise
}

function useWireBase() {
  const [model, setModel] = useState(() =>
    _wireBaseSource ? _wireBaseSource.clone(true) : null
  )
  useEffect(() => {
    if (_wireBaseSource) { setModel(_wireBaseSource.clone(true)); return }
    loadWireBase().then(src => { if (src) setModel(src.clone(true)) })
  }, [])
  return model
}

// ─── Convert board-local [localX, localZ] → world [x, y, z] ──────────────────
function localToWorld(boardShape, localX, localZ) {
  const [bx, , bz] = boardShape.position
  const rad = ((boardShape.rotationY ?? 0) * Math.PI) / 180
  return [
    bx + localX * Math.cos(rad) - localZ * Math.sin(rad),
    BB_THICKNESS + 0.05,
    bz + localX * Math.sin(rad) + localZ * Math.cos(rad),
  ]
}

// ─── Snap world XZ to nearest hole ───────────────────────────────────────────
export function snapWorldToHole(boardShape, worldX, worldZ) {
  if (!boardShape) return null
  const [bx, , bz] = boardShape.position
  const rad = -((boardShape.rotationY ?? 0) * Math.PI) / 180
  const dx = worldX - bx, dz = worldZ - bz
  const localX = dx * Math.cos(rad) - dz * Math.sin(rad)
  const localZ = dx * Math.sin(rad) + dz * Math.cos(rad)

  if (Math.abs(localX) > BB_HALF_LENGTH || Math.abs(localZ) > BB_HALF_WIDTH) return null

  let bestRow = BB_ROWS[0], bestRowDist = Math.abs(localX - BB_ROWS[0])
  for (const r of BB_ROWS) { const d = Math.abs(localX - r); if (d < bestRowDist) { bestRowDist = d; bestRow = r } }
  let bestCol = BB_COLS[0], bestColDist = Math.abs(localZ - BB_COLS[0])
  for (const c of BB_COLS) { const d = Math.abs(localZ - c); if (d < bestColDist) { bestColDist = d; bestCol = c } }
  if (bestRowDist > 1.0 || bestColDist > 1.0) return null

  const radFwd = ((boardShape.rotationY ?? 0) * Math.PI) / 180
  const worldPos = [
    bx + bestRow * Math.cos(radFwd) - bestCol * Math.sin(radFwd),
    BB_THICKNESS + 0.05,
    bz + bestRow * Math.sin(radFwd) + bestCol * Math.cos(radFwd),
  ]
  return { worldPos, localX: bestRow, localZ: bestCol }
}

// ─── Arc tube geometry ────────────────────────────────────────────────────────
// start/end are world hole positions. Uses a cubic bezier with vertical tangents
// at each pin so the wire shoots straight up before bending — like real jumper wires.
const ARC_MAX_HEIGHT = 3.5   // world units — hard cap on how tall the arc gets

function makeTubeGeometry(start, end, radius = WIRE_RADIUS) {
  const pinTop = PIN_HEIGHT
  const s = new THREE.Vector3(start[0], start[1] + pinTop, start[2])
  const e = new THREE.Vector3(end[0],   end[1]   + pinTop, end[2])
  const span = Math.sqrt((e.x - s.x) ** 2 + (e.z - s.z) ** 2)
  const arcH = Math.min(ARC_MAX_HEIGHT, ARC_BASE + span * ARC_FACTOR)
  // Control points go straight up from each pin end — vertical exit, then bend
  const c1 = new THREE.Vector3(s.x, s.y + arcH, s.z)
  const c2 = new THREE.Vector3(e.x, e.y + arcH, e.z)
  const curve = new THREE.CubicBezierCurve3(s, c1, c2, e)
  return new THREE.TubeGeometry(curve, WIRE_SEGS, radius, WIRE_RADIAL, false)
}

// ─── Pin base using WireBase OBJ ──────────────────────────────────────────────
// posRef is a ref that parent WireImperative writes its Three.js group into,
// so the parent's useFrame can call posRef.current.position.set(...) directly.
function PinBase({ initPos, posRef }) {
  const model    = useWireBase()
  const groupRef = useRef()

  useEffect(() => {
    if (groupRef.current) posRef.current = groupRef.current
  })

  if (!model) {
    // Fallback while loading — sits at hole level
    return (
      <mesh
        ref={groupRef}
        position={[initPos[0], initPos[1], initPos[2]]}
      >
        <boxGeometry args={[0.36, PIN_HEIGHT * 0.8, 0.36]} />
        <meshBasicMaterial color="#1c1c1c" />
      </mesh>
    )
  }

  return (
    <primitive
      ref={groupRef}
      object={model}
      position={initPos}
    />
  )
}

// ─── Single wire — imperative every-frame updates ─────────────────────────────
function WireImperative({ wire, boardShape, boardGroupRef, selected, onSelectWire }) {
  const tubeRef    = useRef()
  const matRef     = useRef()
  const pinAObjRef = useRef()
  const pinBObjRef = useRef()

  const [initStart, initEnd] = useMemo(() => {
    const s = localToWorld(boardShape, wire.startLocal[0], wire.startLocal[1])
    const e = localToWorld(boardShape, wire.endLocal[0],   wire.endLocal[1])
    return [s, e]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const initGeo = useMemo(
    () => makeTubeGeometry(initStart, initEnd),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useFrame(() => {
    const bx  = boardGroupRef?.current?.position.x ?? boardShape.position[0]
    const bz  = boardGroupRef?.current?.position.z ?? boardShape.position[2]
    const rot = boardShape.rotationY ?? 0
    const rad = (rot * Math.PI) / 180

    const [slx, slz] = wire.startLocal
    const [elx, elz] = wire.endLocal

    const sx = bx + slx * Math.cos(rad) - slz * Math.sin(rad)
    const sz = bz + slx * Math.sin(rad) + slz * Math.cos(rad)
    const ex = bx + elx * Math.cos(rad) - elz * Math.sin(rad)
    const ez = bz + elx * Math.sin(rad) + elz * Math.cos(rad)
    const y  = BB_THICKNESS + 0.05

    if (tubeRef.current) {
      const newGeo = makeTubeGeometry([sx, y, sz], [ex, y, ez])
      tubeRef.current.geometry.dispose()
      tubeRef.current.geometry = newGeo
    }

    if (pinAObjRef.current) pinAObjRef.current.position.set(sx, y, sz)
    if (pinBObjRef.current) pinBObjRef.current.position.set(ex, y, ez)
  })

  useEffect(() => {
    if (!matRef.current) return
    matRef.current.color.set(selected ? '#ffffff' : wire.color)
    matRef.current.emissive.set(selected ? wire.color : '#000000')
    matRef.current.emissiveIntensity = selected ? 0.4 : 0
    matRef.current.roughness = 1
    matRef.current.metalness = 0
  }, [selected, wire.color])

  return (
    <group onClick={(ev) => { ev.stopPropagation(); onSelectWire?.(wire.id) }}>
      <mesh ref={tubeRef} geometry={initGeo}>
        <meshStandardMaterial
          ref={matRef}
          color={selected ? '#ffffff' : wire.color}
          emissive={selected ? wire.color : '#000000'}
          emissiveIntensity={selected ? 0.4 : 0}
          roughness={1}
          metalness={0}
        />
      </mesh>
      <PinBase initPos={initStart} posRef={pinAObjRef} />
      <PinBase initPos={initEnd}   posRef={pinBObjRef} />
    </group>
  )
}

// ─── All placed wires ─────────────────────────────────────────────────────────
export function PlacedWires({ wires, boardShape, boardGroupRef, selectedWireId, onSelectWire }) {
  if (!boardShape) return null
  return (
    <>
      {wires.map(w => (
        <WireImperative
          key={w.id}
          wire={w}
          boardShape={boardShape}
          boardGroupRef={boardGroupRef}
          selected={selectedWireId === w.id}
          onSelectWire={onSelectWire}
        />
      ))}
    </>
  )
}

// ─── Raycaster for wire placement ─────────────────────────────────────────────
export function WireRaycaster({ active, boardShape, onHover, onHoleClick }) {
  const { camera, raycaster, pointer, gl } = useThree()
  const boardPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -BB_THICKNESS))

  useFrame(() => {
    if (!active || !boardShape) return
    raycaster.setFromCamera(pointer, camera)
    const hit = new THREE.Vector3()
    raycaster.ray.intersectPlane(boardPlane.current, hit)
    if (!hit) return
    const result = snapWorldToHole(boardShape, hit.x, hit.z)
    onHover(result ? result.worldPos : null)
  })

  useEffect(() => {
    if (!active) return
    const handleClick = () => {
      if (!boardShape) return
      raycaster.setFromCamera(pointer, camera)
      const hit = new THREE.Vector3()
      raycaster.ray.intersectPlane(boardPlane.current, hit)
      if (!hit) return
      const result = snapWorldToHole(boardShape, hit.x, hit.z)
      if (result) onHoleClick(result)
    }
    gl.domElement.addEventListener('click', handleClick)
    return () => gl.domElement.removeEventListener('click', handleClick)
  }, [active, boardShape, onHoleClick, camera, raycaster, pointer, gl])

  return null
}

// ─── Preview wire while placing ───────────────────────────────────────────────
export function WirePlacementPreview({ wireStart, hoverPos, color }) {
  if (!wireStart || !hoverPos) return null
  const pinTop = PIN_HEIGHT
  const s    = new THREE.Vector3(wireStart[0], wireStart[1] + pinTop, wireStart[2])
  const e    = new THREE.Vector3(hoverPos[0],  hoverPos[1]  + pinTop, hoverPos[2])
  const span = Math.sqrt((e.x - s.x) ** 2 + (e.z - s.z) ** 2)
  const arcH = Math.min(ARC_MAX_HEIGHT, ARC_BASE + span * ARC_FACTOR)
  const c1   = new THREE.Vector3(s.x, s.y + arcH, s.z)
  const c2   = new THREE.Vector3(e.x, e.y + arcH, e.z)
  const curve = new THREE.CubicBezierCurve3(s, c1, c2, e)
  return (
    <group>
      <mesh>
        <tubeGeometry args={[curve, WIRE_SEGS, WIRE_RADIUS, WIRE_RADIAL, false]} />
        <meshStandardMaterial color={color} roughness={1} metalness={0} transparent opacity={0.55} depthWrite={false} />
      </mesh>
      {/* Ghost pin bases at hole level */}
      <mesh position={[wireStart[0], wireStart[1], wireStart[2]]}>
        <boxGeometry args={[0.28, PIN_HEIGHT * 0.8, 0.28]} />
        <meshBasicMaterial color="#1c1c1c" transparent opacity={0.6} depthWrite={false} />
      </mesh>
      <mesh position={[hoverPos[0], hoverPos[1], hoverPos[2]]}>
        <boxGeometry args={[0.28, PIN_HEIGHT * 0.8, 0.28]} />
        <meshBasicMaterial color="#1c1c1c" transparent opacity={0.6} depthWrite={false} />
      </mesh>
    </group>
  )
}

// ─── Wire colour picker ───────────────────────────────────────────────────────
export function WireColorPicker({ color, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '8px 10px' }}>
      {WIRE_COLORS.map(c => (
        <button
          key={c}
          onClick={() => onChange(c)}
          title={c}
          style={{
            width: 22, height: 22, borderRadius: '50%',
            background: c,
            border: color === c ? '2px solid #fff' : '2px solid transparent',
            outline: color === c ? '2px solid #3b82f6' : 'none',
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }}
        />
      ))}
    </div>
  )
}