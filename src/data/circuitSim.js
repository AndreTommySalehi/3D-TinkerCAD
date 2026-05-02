// ─── Circuit Simulation ───────────────────────────────────────────────────────
// Power rails are always energized: red = power (+), blue = ground (−)
// Wires propagate power/ground through the main holes via shared row nodes.

import { BB_COLS, BB_ROWS, POWER_RAIL_COLS, GROUND_RAIL_COLS } from './shapes.js'

const LEFT_MAIN_COLS  = BB_COLS.slice(2, 7)   // A-E
const RIGHT_MAIN_COLS = BB_COLS.slice(7, 12)  // F-J
const TOLERANCE = 0.5

function near(a, b) { return Math.abs(a - b) < TOLERANCE }

// ── Node key ──────────────────────────────────────────────────────────────────
export function getNodeKey(localX, localZ) {
  // Power rails — always energized, single bus each
  if (POWER_RAIL_COLS.some(c => near(localZ, c)))  return `power_rail`
  if (GROUND_RAIL_COLS.some(c => near(localZ, c))) return `ground_rail`

  // Left main (A-E) — per row, left side
  if (LEFT_MAIN_COLS.some(c => near(localZ, c))) {
    const rowIdx = BB_ROWS.findIndex(r => near(localX, r))
    return rowIdx >= 0 ? `left_main_${rowIdx}` : null
  }
  // Right main (F-J) — per row, right side
  if (RIGHT_MAIN_COLS.some(c => near(localZ, c))) {
    const rowIdx = BB_ROWS.findIndex(r => near(localX, r))
    return rowIdx >= 0 ? `right_main_${rowIdx}` : null
  }
  return null
}

// ── Helper: get node key for a component pin in board-local space ─────────────
function pinNodeKey(shape, boardShape, modelDef, pin) {
  const rotRad   = ((shape.rotationY ?? 0) * Math.PI) / 180
  const bbRotRad = ((boardShape.rotationY ?? 0) * Math.PI) / 180
  const [bx, , bz] = boardShape.position

  const offsetX = modelDef.offsetX ?? 0
  const offsetZ = modelDef.offsetZ ?? 0
  const rotOffX = offsetX * Math.cos(rotRad) - offsetZ * Math.sin(rotRad)
  const rotOffZ = offsetX * Math.sin(rotRad) + offsetZ * Math.cos(rotRad)
  const holeBaseX = shape.position[0] - rotOffX
  const holeBaseZ = shape.position[2] - rotOffZ

  const rotX = pin.dx * Math.cos(rotRad) - pin.dz * Math.sin(rotRad)
  const rotZ = pin.dx * Math.sin(rotRad) + pin.dz * Math.cos(rotRad)

  const vox    = modelDef.visualOffsetX ?? 0
  const rotVox = vox * Math.cos(rotRad)
  const rotVoz = vox * Math.sin(rotRad)

  const worldX = holeBaseX + rotX + rotVox
  const worldZ = holeBaseZ + rotZ + rotVoz

  const dx = worldX - bx, dz = worldZ - bz
  const lx = dx * Math.cos(-bbRotRad) - dz * Math.sin(-bbRotRad)
  const lz = dx * Math.sin(-bbRotRad) + dz * Math.cos(-bbRotRad)
  return getNodeKey(lx, lz)
}

// ── Main simulation ───────────────────────────────────────────────────────────
// wires: placed wires array
// componentEdges: optional array of [nodeA, nodeB] pairs from placed components
//   — allows power to flow through resistors only (non-polar components)
export function simulateCircuit(wires, componentEdges = []) {
  const poweredNodes  = new Set(['power_rail'])
  const groundedNodes = new Set(['ground_rail'])

  const adj = new Map()
  const connect = (a, b) => {
    if (!a || !b || a === b) return
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a).add(b)
    adj.get(b).add(a)
  }

  // Wire edges
  for (const w of wires) {
    const [slx, slz] = w.startLocal
    const [elx, elz] = w.endLocal
    connect(getNodeKey(slx, slz), getNodeKey(elx, elz))
  }

  // Component conductance edges — ONLY non-polar components conduct here.
  // Polar components (LEDs, diodes, capacitors, buzzers) do NOT get edges:
  // their activation is checked separately in getComponentPinStates by
  // verifying one pin is powered and the other is grounded independently.
  for (const [a, b] of componentEdges) {
    connect(a, b)
  }

  const flood = (seeds, visited) => {
    const queue = [...seeds]
    while (queue.length) {
      const cur = queue.shift()
      for (const nb of (adj.get(cur) ?? [])) {
        if (!visited.has(nb)) { visited.add(nb); queue.push(nb) }
      }
    }
    return visited
  }

  return {
    poweredNodes:  flood(poweredNodes,  poweredNodes),
    groundedNodes: flood(groundedNodes, groundedNodes),
  }
}

// ── Build component edges from placed components for use in simulateCircuit ───
// IMPORTANT: Only add conducting edges for NON-POLAR components (resistors, etc.)
// Polar components (anodePinIndex != null) must NOT conduct — adding an edge
// between their anode and cathode would short-circuit the flood fill, causing
// both pins to appear powered and neither to appear grounded.
export function buildComponentEdges(placed, boardShape, modelDefsList) {
  if (!boardShape) return []
  const edges = []
  for (const shape of placed) {
    const modelDef = modelDefsList.find(m => m.type === shape.type)
    if (!modelDef?.pins?.length || modelDef.pins.length < 2) continue

    // Skip polar components — they detect activation via pin state checks, not edges
    if (modelDef.anodePinIndex != null) continue

    // Connect each pair of pins — power flows through the component
    const pins = modelDef.pins
    for (let i = 0; i < pins.length - 1; i++) {
      const nodeA = pinNodeKey(shape, boardShape, modelDef, pins[i])
      const nodeB = pinNodeKey(shape, boardShape, modelDef, pins[i + 1])
      if (nodeA && nodeB) edges.push([nodeA, nodeB])
    }
  }
  return edges
}

// ── Component pin state ───────────────────────────────────────────────────────
export function getComponentPinStates(shape, boardShape, modelDef, poweredNodes, groundedNodes) {
  if (!boardShape) return null
  const pins = modelDef.pins
  if (!pins?.length) return null

  const rotRad   = ((shape.rotationY ?? 0) * Math.PI) / 180
  const bbRotRad = ((boardShape.rotationY ?? 0) * Math.PI) / 180
  const [bx, , bz] = boardShape.position

  // shape.position = logicalSnapHoleWorld + rotate(offsetX, offsetZ).
  // Subtract the rotated offset to recover the snap hole's world position.
  const offsetX = modelDef.offsetX ?? 0
  const offsetZ = modelDef.offsetZ ?? 0
  const rotOffX = offsetX * Math.cos(rotRad) - offsetZ * Math.sin(rotRad)
  const rotOffZ = offsetX * Math.sin(rotRad) + offsetZ * Math.cos(rotRad)
  const holeBaseX = shape.position[0] - rotOffX
  const holeBaseZ = shape.position[2] - rotOffZ

  const pinStates = pins.map((pin, idx) => {
    // Rotate pin offset (relative to mesh center) by component rotation
    const rotX = pin.dx * Math.cos(rotRad) - pin.dz * Math.sin(rotRad)
    const rotZ = pin.dx * Math.sin(rotRad) + pin.dz * Math.cos(rotRad)

    const vox    = modelDef.visualOffsetX ?? 0
    const rotVox = vox * Math.cos(rotRad)
    const rotVoz = vox * Math.sin(rotRad)
    const worldX = holeBaseX + rotX + rotVox
    const worldZ = holeBaseZ + rotZ + rotVoz

    // World → board local using hole pos (not visual pos) for correct node lookup
    const dx = worldX - bx , dz = worldZ - bz
    const boardLocalX = dx * Math.cos(-bbRotRad) - dz * Math.sin(-bbRotRad)
    const boardLocalZ = dx * Math.sin(-bbRotRad) + dz * Math.cos(-bbRotRad)

    const node  = getNodeKey(boardLocalX, boardLocalZ)
    const state = !node ? null : poweredNodes.has(node) ? 'power' : groundedNodes.has(node) ? 'ground' : null
    const role  = modelDef.anodePinIndex == null ? 'terminal'
                : idx === modelDef.anodePinIndex  ? 'anode' : 'cathode'

    return { role, state, worldX, worldZ, boardLocalX, boardLocalZ }
  })

  const anode     = pinStates.find(p => p.role === 'anode')
  const cathode   = pinStates.find(p => p.role === 'cathode')
  const terminals = pinStates.filter(p => p.role === 'terminal')

  const polarActive   = anode?.state === 'power'  && cathode?.state === 'ground'
  const polarReversed = anode?.state === 'ground' && cathode?.state === 'power'
  const terminalActive = terminals.length >= 2 && (
    (terminals[0].state === 'power' && terminals[1].state === 'ground') ||
    (terminals[0].state === 'ground' && terminals[1].state === 'power')
  )

  return {
    pins: pinStates,
    active:           polarActive || terminalActive,
    reversedPolarity: polarReversed,
    isTerminal:       terminals.length > 0,
  }
}