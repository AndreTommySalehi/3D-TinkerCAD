import { Grid } from '@react-three/drei'

export function Ground({ onPointerDown }) {
  return (
    <>
      {/* Invisible collision box so raycasters always have a ground target */}
      <mesh position={[0, -0.05, 0]} visible={false}>
        <boxGeometry args={[400, 0.1, 400]} />
        <meshStandardMaterial />
      </mesh>

      {/* Visible ground — receiveShadow so directional light casts shadows onto it */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onPointerDown={onPointerDown}
      >
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#c8dce8" roughness={0.9} transparent opacity={0.55} />
      </mesh>

      <Grid
        position={[0, 0.002, 0]}
        cellSize={1}
        cellThickness={0.4}
        cellColor="#7a96b0"
        sectionSize={5}
        sectionThickness={0.9}
        sectionColor="#4a6480"
        fadeDistance={90}
        fadeStrength={3}
        infiniteGrid
      />
    </>
  )
}