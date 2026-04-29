import { useEffect, useRef, useState, useMemo } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BB_THICKNESS } from '../../data/shapes.js'

// ─── How close two values must be to be considered the same row/col ───────────
const CLUSTER_THRESHOLD = 0.3

function cluster(values) {
  if (!values.length) return []
  const sorted = [...values].sort((a, b) => a - b)
  const groups = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const last = groups[groups.length - 1]
    if (sorted[i] - last[last.length - 1] < CLUSTER_THRESHOLD) {
      last.push(sorted[i])
    } else {
      groups.push([sorted[i]])
    }
  }
  // Return centroid of each group
  return groups.map(g => parseFloat((g.reduce((s, v) => s + v, 0) / g.length).toFixed(4)))
}

// ─── Raycaster that places markers on the board surface ───────────────────────
export function CalibrationRaycaster({ active, boardShape, onPlace }) {
  const { camera, raycaster, pointer, gl } = useThree()
  const boardPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -BB_THICKNESS))

  useEffect(() => {
    if (!active) return
    const handleClick = (e) => {
      if (!boardShape) return
      raycaster.setFromCamera(pointer, camera)
      const hit = new THREE.Vector3()
      raycaster.ray.intersectPlane(boardPlane.current, hit)
      if (!hit) return

      // Convert world hit → board-local coords
      const [bx, , bz] = boardShape.position
      const rad = -((boardShape.rotationY ?? 0) * Math.PI) / 180
      const dx = hit.x - bx
      const dz = hit.z - bz
      const localX =  dx * Math.cos(rad) - dz * Math.sin(rad)
      const localZ =  dx * Math.sin(rad) + dz * Math.cos(rad)

      onPlace({ worldPos: [hit.x, BB_THICKNESS + 0.08, hit.z], localX, localZ })
    }
    gl.domElement.addEventListener('click', handleClick)
    return () => gl.domElement.removeEventListener('click', handleClick)
  }, [active, boardShape, onPlace, camera, raycaster, pointer, gl])

  return null
}

// ─── Tiny sphere markers rendered in the 3D scene ─────────────────────────────
export function CalibrationMarkers({ markers }) {
  if (!markers.length) return null
  return (
    <>
      {markers.map((m, i) => (
        <mesh key={i} position={m.worldPos}>
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshBasicMaterial color="#00ff88" depthTest={false} transparent opacity={0.9} />
        </mesh>
      ))}
    </>
  )
}

// ─── HUD overlay panel ────────────────────────────────────────────────────────
export function CalibrationPanel({ markers, onUndo, onClear, onExport, boardFound }) {
  const rows = useMemo(() => cluster(markers.map(m => m.localX)), [markers])
  const cols = useMemo(() => cluster(markers.map(m => m.localZ)), [markers])

  const handleExport = () => {
    const rowStr = rows.map(v => v.toFixed(4)).join(', ')
    const colStr = cols.map(v => v.toFixed(4)).join(', ')

    const output = `
// ─── CALIBRATED BB_ROWS (X axis, ${rows.length} rows) ────────────────────────
export const BB_ROWS = [
  ${rows.map(v => v.toFixed(4)).join(',\n  ')},
]

// ─── CALIBRATED BB_COLS (Z axis, ${cols.length} cols) ────────────────────────
export const BB_COLS = [
  ${cols.map(v => v.toFixed(4)).join(',\n  ')},
]
`
    console.log('%c📋 CALIBRATION EXPORT — paste into shapes.js', 'color:#00ff88;font-weight:bold;font-size:14px')
    console.log(output)

    // Also copy to clipboard
    navigator.clipboard?.writeText(output).then(() => {
      alert('✅ Copied to clipboard! Paste into shapes.js to replace BB_ROWS and BB_COLS.')
    }).catch(() => {
      alert('Logged to console — open DevTools (F12) and copy from there.')
    })

    onExport?.()
  }

  return (
    <div style={{
      position: 'absolute', top: 12, right: 12, zIndex: 30,
      background: 'rgba(5, 12, 20, 0.96)',
      border: '1px solid #00ff88',
      borderRadius: 10,
      padding: '14px 16px',
      width: 270,
      color: '#e2e8f0',
      fontFamily: 'monospace',
      fontSize: 12,
      backdropFilter: 'blur(10px)',
      boxShadow: '0 0 24px rgba(0,255,136,0.15)',
    }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: '#00ff88', marginBottom: 10, letterSpacing: '0.06em' }}>
        🎯 CALIBRATION MODE
      </div>

      {!boardFound && (
        <div style={{
          background: 'rgba(255,80,80,0.15)', border: '1px solid #ff5050',
          borderRadius: 6, padding: '6px 10px', marginBottom: 10,
          color: '#ff8080', fontSize: 11,
        }}>
          ⚠️ Place a breadboard first, then enter calibration mode.
        </div>
      )}

      <div style={{ color: '#94a3b8', marginBottom: 10, lineHeight: 1.6, fontSize: 11 }}>
        Click each hole on the breadboard surface.<br />
        Tiny green spheres mark your clicks.<br />
        When done, hit <b style={{ color: '#fbbf24' }}>Export</b> to get the code.
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 6, marginBottom: 10,
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 6, padding: '8px 10px',
      }}>
        <div>
          <div style={{ color: '#64748b', fontSize: 10, marginBottom: 2 }}>MARKERS</div>
          <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 18 }}>{markers.length}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 10, marginBottom: 2 }}>ROWS / COLS</div>
          <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 18 }}>{rows.length} / {cols.length}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button
          onClick={onUndo}
          disabled={!markers.length}
          style={btnStyle('#1e3a5f', '#38bdf8', !markers.length)}
        >
          ↩ Undo
        </button>
        <button
          onClick={onClear}
          disabled={!markers.length}
          style={btnStyle('#3b1515', '#f87171', !markers.length)}
        >
          🗑 Clear
        </button>
      </div>

      <button
        onClick={handleExport}
        disabled={markers.length < 2}
        style={{
          ...btnStyle('#064e3b', '#00ff88', markers.length < 2),
          width: '100%',
          fontWeight: 700,
          fontSize: 13,
          padding: '8px 0',
        }}
      >
        📋 Export → shapes.js
      </button>

      <div style={{ marginTop: 10, color: '#334155', fontSize: 10, lineHeight: 1.5 }}>
        Export clusters nearby clicks into unique rows/cols automatically.<br />
        You don't need to click every single hole — just enough to establish all unique X and Z values.
      </div>
    </div>
  )
}

function btnStyle(bg, border, disabled) {
  return {
    flex: 1,
    padding: '5px 0',
    background: disabled ? 'rgba(255,255,255,0.04)' : bg,
    border: `1px solid ${disabled ? '#1e293b' : border}`,
    borderRadius: 5,
    color: disabled ? '#334155' : border,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'monospace',
    fontSize: 11,
  }
}