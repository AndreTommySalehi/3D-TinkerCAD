import { useEffect, useRef, useState } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js'
import * as THREE from 'three'
import { registerModelAABB, MODELS, snapToBreadboard, BB_THICKNESS, isHoleOccupied } from '../../data/shapes.js'

// ─── Imperative loader hook ───────────────────────────────────────────────────
function useOBJModel(modelDef) {
  const [model, setModel] = useState(null)

  useEffect(() => {
    let cancelled = false

    function processObj(obj) {
      const box = new THREE.Box3().setFromObject(obj)
      const size = new THREE.Vector3()
      box.getSize(size)
      const maxDim = Math.max(size.x, size.y, size.z)
      const targetSize = modelDef.targetSize ?? 3
      const autoScale = maxDim > 0 ? targetSize / maxDim : 1
      const center = new THREE.Vector3()
      box.getCenter(center)
      obj.position.set(-center.x, -box.min.y, -center.z)
      const group = new THREE.Group()
      group.scale.setScalar(autoScale)
      group.add(obj)
      registerModelAABB(modelDef.type, (size.x * autoScale) / 2, (size.z * autoScale) / 2)
      return group
    }

    function loadWithoutMtl() {
      new OBJLoader().load(
        modelDef.objPath,
        (obj) => { if (!cancelled) setModel(processObj(obj)) },
        undefined,
        (err) => console.error('OBJ load failed:', err)
      )
    }

    const modelFolder    = modelDef.mtlPath.substring(0, modelDef.mtlPath.lastIndexOf('/') + 1)
    const texturesFolder = modelFolder + 'Textures/'
    const mtlLoader = new MTLLoader()
    mtlLoader.setResourcePath(texturesFolder)
    mtlLoader.load(
      modelDef.mtlPath,
      (materials) => {
        if (cancelled) return
        materials.preload()
        Object.values(materials.materials).forEach(mat => {
          if (!mat) return
          ;['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap'].forEach(slot => {
            const tex = mat[slot]
            if (!tex) return
            tex.minFilter = THREE.LinearFilter
            tex.magFilter = THREE.NearestFilter
            tex.generateMipmaps = false
            tex.anisotropy = 16
            tex.needsUpdate = true
          })
        })
        const objLoader = new OBJLoader()
        objLoader.setMaterials(materials)
        objLoader.load(
          modelDef.objPath,
          (obj) => { if (!cancelled) setModel(processObj(obj)) },
          undefined,
          (err) => { console.warn('OBJ load error, retrying without MTL:', err); loadWithoutMtl() }
        )
      },
      undefined,
      () => { if (!cancelled) loadWithoutMtl() }
    )

    return () => { cancelled = true }
  }, [modelDef.objPath, modelDef.mtlPath]) // eslint-disable-line

  return model
}

// ─── Resolve world Y for a placed component ───────────────────────────────────
function resolveWorldY(shape, modelDef) {
  if (shape.type === 'breadboard') return 0
  const onBoard = Math.abs(shape.position[1] - BB_THICKNESS) < 0.05
  if (onBoard) return BB_THICKNESS - (modelDef?.pinOffset ?? 0)
  return 0
}

// ─── Placed OBJ model ─────────────────────────────────────────────────────────
export function OBJModel({ shape, isSelected, onSelect, onDragStart, onDragMove, onDragEnd, orbitRef, placed, resolveCollision, rotationY = 0, groupRefs, onBoardDragFrame }) {
  const modelDef = MODELS.find(m => m.type === shape.type)
  if (!modelDef) return null
  return (
    <OBJModelInner
      shape={shape} modelDef={modelDef} isSelected={isSelected}
      onSelect={onSelect} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd}
      orbitRef={orbitRef} placed={placed} resolveCollision={resolveCollision}
      rotationY={rotationY} groupRefs={groupRefs} onBoardDragFrame={onBoardDragFrame}
    />
  )
}

function OBJModelInner({ shape, modelDef, isSelected, onSelect, onDragStart, onDragMove, onDragEnd, orbitRef, placed, resolveCollision, rotationY = 0, groupRefs, onBoardDragFrame }) {
  const { camera, raycaster, pointer, gl } = useThree()
  const groupRef     = useRef()
  const sceneRef     = useRef(null)
  const dragging     = useRef(false)
  const pointerDown  = useRef(null)
  const dragPlane    = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const riderOffsets = useRef(null)
  const DRAG_THRESHOLD = 5

  const sourceModel = useOBJModel(modelDef)

  useEffect(() => {
    if (!groupRefs) return
    groupRefs.current[shape.id] = groupRef
    return () => { delete groupRefs.current[shape.id] }
  }, [shape.id, groupRefs])

  useEffect(() => {
    if (!sourceModel || !groupRef.current) return
    while (groupRef.current.children.length) groupRef.current.remove(groupRef.current.children[0])
    const clone = sourceModel.clone(true)
    // Clone stays at local origin — offset is applied to the group position instead,
    // so the group pivot (= rotation center) is at the mesh center, not the hole.
    groupRef.current.add(clone)
    sceneRef.current = clone
  }, [sourceModel])

  useEffect(() => {
    if (!sceneRef.current) return
    sceneRef.current.traverse((child) => {
      if (!child.isMesh) return
      if (!child.userData._origMat) child.userData._origMat = child.material
      if (isSelected) {
        const m = child.userData._origMat.clone()
        m.color = new THREE.Color('#38bdf8')
        m.emissive = new THREE.Color('#0369a1')
        m.emissiveIntensity = 0.35
        child.material = m
      } else {
        child.material = child.userData._origMat
      }
    })
  }, [isSelected, sourceModel])

  const handlePointerDown = (e) => {
    e.stopPropagation()
    pointerDown.current = { x: e.clientX, y: e.clientY }
    const worldY = resolveWorldY(shape, modelDef)
    dragPlane.current.constant = -worldY

    const onMove = (me) => {
      if (!pointerDown.current) return
      const dx = me.clientX - pointerDown.current.x
      const dy = me.clientY - pointerDown.current.y
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD && !dragging.current) {
        dragging.current = true
        gl.domElement.style.cursor = 'grabbing'
        if (orbitRef.current) orbitRef.current.enabled = false

        if (shape.type === 'breadboard' && groupRefs && groupRef.current) {
          const bx = groupRef.current.position.x
          const bz = groupRef.current.position.z
          const offsets = {}
          for (const s of placed) {
            if (s.id === shape.id) continue
            if (Math.abs(s.position[1] - BB_THICKNESS) < 0.05) {
              const rRef = groupRefs.current[s.id]
              if (rRef?.current) {
                offsets[s.id] = [rRef.current.position.x - bx, rRef.current.position.z - bz]
              }
            }
          }
          riderOffsets.current = offsets
        }
        onDragStart?.(shape.id)
      }
    }

    const onUp = () => {
      const wasDragging = dragging.current
      pointerDown.current = null
      dragging.current = false
      gl.domElement.style.cursor = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)

      if (wasDragging) {
        if (shape.type === 'breadboard' && groupRef.current && groupRefs) {
          const finalBoardPos = [groupRef.current.position.x, shape.position[1], groupRef.current.position.z]
          const riderFinal = {}
          if (riderOffsets.current) {
            for (const [riderId, off] of Object.entries(riderOffsets.current)) {
              riderFinal[riderId] = [
                groupRef.current.position.x + off[0],
                (placed.find(s => s.id === riderId)?.position[1] ?? BB_THICKNESS),
                groupRef.current.position.z + off[1],
              ]
            }
          }
          riderOffsets.current = null
          onDragEnd?.(shape.id, finalBoardPos, riderFinal)
        } else {
          onDragEnd?.(shape.id, null, null)
        }
        requestAnimationFrame(() => { if (orbitRef.current) orbitRef.current.enabled = true })
      } else {
        onSelect(shape.id)
        if (orbitRef.current) orbitRef.current.enabled = true
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  useFrame(() => {
    if (!dragging.current) return
    raycaster.setFromCamera(pointer, camera)
    const hit = new THREE.Vector3()
    raycaster.ray.intersectPlane(dragPlane.current, hit)
    if (!hit) return

    // ── Breadboard: direct placement, no collision solving (eliminates Z jitter) ──
    if (shape.type === 'breadboard' && groupRef.current) {
      const newX = hit.x
      const newZ = hit.z

      groupRef.current.position.x = newX
      groupRef.current.position.z = newZ

      // Move riders
      if (riderOffsets.current && groupRefs) {
        for (const [riderId, off] of Object.entries(riderOffsets.current)) {
          const rRef = groupRefs.current[riderId]
          if (rRef?.current) {
            rRef.current.position.x = newX + off[0]
            rRef.current.position.z = newZ + off[1]
          }
        }
      }

      // Notify App of the new board world position (not a delta — absolute coords)
      onBoardDragFrame?.(shape.id, newX, newZ)
      return
    }

    // ── Component: snap to breadboard or ground ───────────────────────────────
    const livePlaced = placed.map(s => {
      const ref = groupRefs?.current[s.id]
      if (ref?.current) return { ...s, position: [ref.current.position.x, s.position[1], ref.current.position.z] }
      return s
    })

    if (shape.type !== 'breadboard') {
      for (const s of livePlaced) {
        if (s.type !== 'breadboard' || s.id === shape.id) continue
        const snapped = snapToBreadboard(s.position, s.rotationY ?? 0, [hit.x, 0, hit.z], shape.type)
        if (snapped) {
          const blocked = isHoleOccupied(s, snapped, shape.type, livePlaced, shape.id)
          if (!blocked) {
            const ox = modelDef.offsetX ?? 0
            const oz = modelDef.offsetZ ?? 0
            onDragMove(shape.id, [snapped[0] + ox, snapped[1], snapped[2] + oz])
          }
          return
        }
      }
    }

    const resolved = resolveCollision([hit.x, shape.position[1], hit.z], shape.type, livePlaced, shape.id)
    onDragMove(shape.id, resolved)
  })

  const worldY   = resolveWorldY(shape, modelDef)
  const finalPos = [shape.position[0], worldY, shape.position[2]]

  if (!sourceModel) {
    return (
      <mesh position={finalPos}>
        <boxGeometry args={[1, 0.5, 1]} />
        <meshStandardMaterial color="#7a9cb8" transparent opacity={0.35} wireframe />
      </mesh>
    )
  }

  return (
    <group
      ref={groupRef}
      position={finalPos}
      rotation={[0, (rotationY * Math.PI) / 180, 0]}
      onPointerDown={handlePointerDown}
    />
  )
}

// ─── Ghost preview ────────────────────────────────────────────────────────────
export function OBJGhostPreview({ type, position, blocked = false }) {
  const modelDef = MODELS.find(m => m.type === type)
  if (!modelDef || !position) return null
  return <OBJGhostInner modelDef={modelDef} position={position} blocked={blocked} />
}

function OBJGhostInner({ modelDef, position, blocked }) {
  const groupRef    = useRef()
  const sourceModel = useOBJModel(modelDef)

  useEffect(() => {
    if (!sourceModel || !groupRef.current) return
    while (groupRef.current.children.length) groupRef.current.remove(groupRef.current.children[0])
    const clone = sourceModel.clone(true)
    const ghostMat = new THREE.MeshStandardMaterial({
      color: blocked ? '#f87171' : '#38bdf8', transparent: true, opacity: 0.4, depthWrite: false,
    })
    clone.traverse((child) => { if (child.isMesh) child.material = ghostMat })
    groupRef.current.add(clone)
  }, [sourceModel, blocked])

  const isOnBoard = Math.abs(position[1] - BB_THICKNESS) < 0.05
  const pinOffset = isOnBoard ? (modelDef.pinOffset ?? 0) : 0
  const ghostY    = isOnBoard ? BB_THICKNESS - pinOffset : 0

  if (!sourceModel) {
    return (
      <mesh position={[position[0], ghostY, position[2]]}>
        <boxGeometry args={[1, 0.5, 1]} />
        <meshStandardMaterial color={blocked ? '#f87171' : '#38bdf8'} transparent opacity={0.25} wireframe />
      </mesh>
    )
  }

  return <group ref={groupRef} position={[position[0], ghostY, position[2]]} />
}