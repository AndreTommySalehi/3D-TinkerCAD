// ─── Static AABB half-extents [halfW, halfD] for built-in shapes ──────────────
const STATIC_AABB = {
  cube:         [0.5,  0.5 ],
  cylinder:     [0.5,  0.5 ],
  sphere:       [0.5,  0.5 ],
  cone:         [0.5,  0.5 ],
  torus:        [0.58, 0.58],
  pyramid:      [0.6,  0.6 ],
  capsule:      [0.3,  0.3 ],
  dodecahedron: [0.55, 0.55],
  hemisphere:   [0.5,  0.5 ],
  wedge:        [0.52, 0.52],
}

// ─── Dynamic AABB registry for OBJ models (populated at load time) ────────────
export const dynamicAABB = {}
export function registerModelAABB(type, halfW, halfD) { dynamicAABB[type] = [halfW, halfD] }
export function getShapeAABB(type) {
  if (STATIC_AABB[type]) return STATIC_AABB[type]
  if (dynamicAABB[type]) return dynamicAABB[type]
  return [0.5, 0.5]
}

// ─── AABB collision resolver ──────────────────────────────────────────────────
export function resolveCollision(candidatePos, candidateType, placedShapes, excludeId = null) {
  let [x, y, z] = candidatePos
  const [hw1, hd1] = getShapeAABB(candidateType)
  for (let iter = 0; iter < 3; iter++) {
    for (const s of placedShapes) {
      if (s.id === excludeId) continue
      if (s.type === 'breadboard') continue
      const [hw2, hd2] = getShapeAABB(s.type)
      const overlapX = (hw1 + hw2) - Math.abs(x - s.position[0])
      const overlapZ = (hd1 + hd2) - Math.abs(z - s.position[2])
      if (overlapX > 0 && overlapZ > 0) {
        if (overlapX < overlapZ) x += overlapX * Math.sign(x - s.position[0])
        else                     z += overlapZ * Math.sign(z - s.position[2])
      }
    }
  }
  return [x, y, z]
}

// ─── Breadboard snap grid ─────────────────────────────────────────────────────
// Calibrated by clicking each hole in-app using CalibrationMode.jsx.
// Row = X axis (30 rows), Col = Z axis (14 columns incl. rails).

export const BB_ROWS = [
  -13.6230,
  -12.7119,
  -11.7349,
  -10.8053,
   -9.8656,
   -8.9396,
   -8.0149,
   -7.0653,
   -6.1629,
   -5.2234,
   -4.2858,
   -3.3459,
   -2.3989,
   -1.4758,
   -0.5508,
    0.3966,
    1.3261,
    2.2471,
    3.1817,
    4.1156,
    5.0634,
    5.9913,
    6.8992,
    7.8461,
    8.7885,
    9.7160,
   10.6405,
   11.5694,
   12.5070,
   13.4215,
]

export const BB_COLS = [
  // Left rail
  -8.4598,
  -7.5120,
  // Left main cols A–E
  -4.6278,
  -3.7011,
  -2.7764,
  // Left cols F–G (adjacent to gap)
  -1.8372,
  -0.9094,
  // Right cols H–I (adjacent to gap)
   1.1962,
   2.1195,
  // Right main cols J–L
   3.0380,
   3.9642,
   4.8945,
  // Right rail
   7.7592,
   8.7086,
]

// The two cols immediately either side of the centre gap
export const BB_GAP_LEFT_COL  = -0.9094   // col G
export const BB_GAP_RIGHT_COL =  1.1962   // col H
// Midpoint of the gap — bridge components snap here on Z
const BB_GAP_CENTRE_Z = (BB_GAP_LEFT_COL + BB_GAP_RIGHT_COL) / 2  // ≈ 0.1434

// Gap band — blocks plain hole snap in the dead zone
export const BB_GAP_MIN = -0.1
export const BB_GAP_MAX =  0.5

export const BB_THICKNESS   = 2.773
export const BB_HALF_LENGTH = 14.65
export const BB_HALF_WIDTH  = 10.24

// ─── Component types that bridge the centre gap ───────────────────────────────
const BRIDGE_GAP_TYPES = new Set(['button', 'ic'])

// ─── Snap a world position onto the nearest breadboard hole ───────────────────
export function snapToBreadboard(bbWorldPos, bbRotationY, worldPos, componentType = null) {
  const [bx, , bz] = bbWorldPos
  const [wx, , wz] = worldPos

  const rad = -(bbRotationY * Math.PI) / 180
  const dx = wx - bx, dz = wz - bz
  const localX =  dx * Math.cos(rad) - dz * Math.sin(rad)
  const localZ =  dx * Math.sin(rad) + dz * Math.cos(rad)

  if (Math.abs(localX) > BB_HALF_LENGTH) return null
  if (Math.abs(localZ) > BB_HALF_WIDTH)  return null

  // Subtract the visual offsetX/Z so the nearest-hole search is biased:
  // the snapped hole will be offsetX behind the cursor, and when the mesh
  // adds offsetX back visually, it lands exactly at the cursor position.
  const modelDef    = componentType ? MODELS.find(m => m.type === componentType) : null
  const ox = modelDef?.offsetX ?? 0
  const oz = modelDef?.offsetZ ?? 0
  const searchX = localX - ox
  const searchZ = localZ - oz

  // ── Bridge-gap snap ───────────────────────────────────────────────────────
  if (componentType && BRIDGE_GAP_TYPES.has(componentType)) {
    if (Math.abs(searchZ - BB_GAP_CENTRE_Z) < 2.2) {
      let bestRow = BB_ROWS[0], bestRowDist = Math.abs(searchX - BB_ROWS[0])
      for (const r of BB_ROWS) {
        const d = Math.abs(searchX - r)
        if (d < bestRowDist) { bestRowDist = d; bestRow = r }
      }
      if (bestRowDist > 1.0) return null

      const radFwd = (bbRotationY * Math.PI) / 180
      return [
        bx + bestRow * Math.cos(radFwd) - BB_GAP_CENTRE_Z * Math.sin(radFwd),
        BB_THICKNESS,
        bz + bestRow * Math.sin(radFwd) + BB_GAP_CENTRE_Z * Math.cos(radFwd),
      ]
    }
  }

  // ── Normal hole snap ──────────────────────────────────────────────────────
  if (searchZ > BB_GAP_MIN && searchZ < BB_GAP_MAX) return null

  let bestRow = BB_ROWS[0], bestRowDist = Math.abs(searchX - BB_ROWS[0])
  for (const r of BB_ROWS) {
    const d = Math.abs(searchX - r)
    if (d < bestRowDist) { bestRowDist = d; bestRow = r }
  }

  let bestCol = BB_COLS[0], bestColDist = Math.abs(searchZ - BB_COLS[0])
  for (const c of BB_COLS) {
    const d = Math.abs(searchZ - c)
    if (d < bestColDist) { bestColDist = d; bestCol = c }
  }

  const SNAP_RADIUS = 1.0
  if (bestRowDist > SNAP_RADIUS || bestColDist > SNAP_RADIUS) return null

  const radFwd = (bbRotationY * Math.PI) / 180
  return [
    bx + bestRow * Math.cos(radFwd) - bestCol * Math.sin(radFwd),
    BB_THICKNESS,
    bz + bestRow * Math.sin(radFwd) + bestCol * Math.cos(radFwd),
  ]
}

// ─── Hole occupancy ───────────────────────────────────────────────────────────
const HOLE_SNAP_TOLERANCE = 0.35

/** Convert a world snap position to board-local [localX, localZ]. */
export function worldToLocal(bbWorldPos, bbRotationY, worldPos) {
  const [bx, , bz] = bbWorldPos
  const [wx, , wz] = worldPos
  const rad = -(bbRotationY * Math.PI) / 180
  const dx = wx - bx, dz = wz - bz
  return [
    dx * Math.cos(rad) - dz * Math.sin(rad),
    dx * Math.sin(rad) + dz * Math.cos(rad),
  ]
}

/**
 * Return the list of [localX, localZ] hole slots a component occupies.
 * Bridge types claim one hole on each side of the gap at their row.
 */
export function getOccupiedHoles(localX, localZ, componentType) {
  if (componentType && BRIDGE_GAP_TYPES.has(componentType)) {
    return [
      [localX, BB_GAP_LEFT_COL],
      [localX, BB_GAP_RIGHT_COL],
    ]
  }
  return [[localX, localZ]]
}

/**
 * Returns true if placing candidateType at candidateWorldPos on bbShape
 * would conflict with any already-placed component on the same board.
 */
export function isHoleOccupied(bbShape, candidateWorldPos, candidateType, placedShapes, excludeId = null) {
  const [candLocalX, candLocalZ] = worldToLocal(bbShape.position, bbShape.rotationY ?? 0, candidateWorldPos)
  const candHoles = getOccupiedHoles(candLocalX, candLocalZ, candidateType)

  for (const s of placedShapes) {
    if (s.id === excludeId) continue
    if (s.id === bbShape.id) continue
    if (Math.abs(s.position[1] - BB_THICKNESS) > 0.1) continue

    const [sLocalX, sLocalZ] = worldToLocal(bbShape.position, bbShape.rotationY ?? 0, s.position)
    const sHoles = getOccupiedHoles(sLocalX, sLocalZ, s.type)

    for (const [cx, cz] of candHoles) {
      for (const [sx, sz] of sHoles) {
        if (
          Math.abs(cx - sx) < HOLE_SNAP_TOLERANCE &&
          Math.abs(cz - sz) < HOLE_SNAP_TOLERANCE
        ) return true
      }
    }
  }
  return false
}

// ─── Built-in shape list ──────────────────────────────────────────────────────
export const SHAPES = [
  { type: 'cube',         label: 'Box',         color: '#e74c3c' },
  { type: 'cylinder',     label: 'Cylinder',    color: '#e67e22' },
  { type: 'sphere',       label: 'Sphere',      color: '#2196f3' },
  { type: 'cone',         label: 'Cone',        color: '#8e44ad' },
  { type: 'torus',        label: 'Torus',       color: '#9e9fc8' },
  { type: 'dodecahedron', label: 'Gem',         color: '#aaccee' },
  { type: 'pyramid',      label: 'Pyramid',     color: '#f1c40f' },
  { type: 'wedge',        label: 'Wedge',       color: '#4caf50' },
  { type: 'capsule',      label: 'Capsule',     color: '#16a085' },
  { type: 'hemisphere',   label: 'Half Sphere', color: '#00bcd4' },
]
export const SHAPES_WITH_ID = SHAPES.map((s, i) => ({ ...s, id: `${s.type}-${i}` }))

// ─── OBJ model catalogue ──────────────────────────────────────────────────────
// offsetX / offsetZ: visually shift the mesh relative to the snap hole so the
//   model's pin lines up with the texture hole. Both ghost and placed model
//   shift by the same amount — the snap point (where the cursor is) stays fixed,
//   the mesh moves around it. Tune in small steps until pin sits on hole.
//   offsetX: positive = toward higher row numbers (breadboard length axis)
//   offsetZ: positive = toward right rail (breadboard width axis)
export const MODELS = [
  {
    type: 'breadboard', label: 'Breadboard',
    objPath: '/models/Breadboard-OBJ/BreadBoard.obj',
    mtlPath: '/models/Breadboard-OBJ/BreadBoard.mtl',
    targetSize: 30, pinOffset: 0, offsetX: 0, offsetZ: 0,
  },
  {
    type: 'resistor', label: 'Resistor',
    objPath: '/models/Resistor/Resistor.obj',
    mtlPath: '/models/Resistor/Resistor.mtl',
    targetSize: 3.75, pinOffset: 0.0, offsetX: 0, offsetZ: 0,
  },
  {
    type: 'capacitor', label: 'Capacitor',
    objPath: '/models/Capacitor/Capacitor.obj',
    mtlPath: '/models/Capacitor/Capacitor.mtl',
    targetSize: 3.5, pinOffset: 0.35, offsetX: 0, offsetZ: 0,
  },
  {
    type: 'button', label: 'Button',
    objPath: '/models/Button/Button.obj',
    mtlPath: '/models/Button/Button.mtl',
    targetSize: 3.25, pinOffset: 0.3, offsetX: 0, offsetZ: 0,
  },
  {
    type: 'buzzer', label: 'Buzzer',
    objPath: '/models/Buzzer/Buzzer.obj',
    mtlPath: '/models/Buzzer/Buzzer.mtl',
    targetSize: 2.8125, pinOffset: 0.3, offsetX: 0, offsetZ: 0,
  },
  {
    type: 'diode', label: 'Diode',
    objPath: '/models/Diode/Diode.obj',
    mtlPath: '/models/Diode/Diode.mtl',
    targetSize: 3.75, pinOffset: 0.35, offsetX: 0, offsetZ: 0,
  },
  {
    type: 'ic', label: 'IC Chip',
    objPath: '/models/IC/IC.obj',
    mtlPath: '/models/IC/IC.mtl',
    targetSize: 3.5, pinOffset: 0.25, offsetX: 0.45, offsetZ: 0,
  },
  {
    type: 'led_blue', label: 'LED Blue',
    objPath: '/models/LED-Blue/LEDBlue.obj',
    mtlPath: '/models/LED-Blue/LEDBlue.mtl',
    targetSize: 3.5, pinOffset: 0.4, offsetX: 5.1, offsetZ: 0,
  },
  {
    type: 'led_green', label: 'LED Green',
    objPath: '/models/LED-Green/LEDGreen.obj',
    mtlPath: '/models/LED-Green/LEDGreen.mtl',
    targetSize: 3.5, pinOffset: 0.4, offsetX: 5.1, offsetZ: 0,
  },
  {
    type: 'led_red', label: 'LED Red',
    objPath: '/models/LED-Red/LEDRed.obj',
    mtlPath: '/models/LED-Red/LEDRed.mtl',
    targetSize: 3.5, pinOffset: 0.4, offsetX: 5.1, offsetZ: 0,
  },
  {
    type: 'transistor', label: 'Transistor',
    objPath: '/models/Transistor/Transistor.obj',
    mtlPath: '/models/Transistor/Transistor.mtl',
    targetSize: 2.8125, pinOffset: 0.35, offsetX: 0, offsetZ: 0,
  },
]