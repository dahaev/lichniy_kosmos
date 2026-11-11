import { BufferAttribute, BufferGeometry, Mesh, Points, ShaderMaterial, Vector2, Vector3 } from 'three'

import type { OrbitSystem } from './compositions'
import { pointOnEllipse, type Ellipse, type Star } from './geometry'
import type { Circle } from './plates'

// All layers draw in CSS pixels with y down and output premultiplied alpha:
// the canvas is transparent over the DOM poster plate.

interface LayerUniforms {
  uIntensity: { value: number }
  uOffset: { value: Vector2 }
}

function material(vertexShader: string, fragmentShader: string, uniforms: Record<string, { value: unknown }>): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uIntensity: { value: 1 }, uOffset: { value: new Vector2() }, ...uniforms },
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
  })
}

export function setLayerState(object: Mesh | Points, intensity: number, offset: Vector2): void {
  const uniforms = (object.material as ShaderMaterial).uniforms as unknown as LayerUniforms
  uniforms.uIntensity.value = intensity
  uniforms.uOffset.value.copy(offset)
}

const starVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aPhase;
  attribute float aRate;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uIntensity;
  uniform vec2 uOffset;
  varying float vAlpha;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy + uOffset, 0.0, 1.0);
    gl_PointSize = aSize * 2.0 * uPixelRatio;
    vAlpha = aAlpha * uIntensity * (0.72 + 0.28 * sin(uTime * aRate + aPhase));
  }
`

const starFragment = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = vAlpha * pow(1.0 - smoothstep(0.0, 1.0, d), 2.0);
    gl_FragColor = vec4(vec3(0.96, 0.94, 0.9) * a, a);
  }
`

export function createStars(stars: readonly Star[]): Points {
  const geometry = new BufferGeometry()
  const position = new Float32Array(stars.length * 3)
  const size = new Float32Array(stars.length)
  const alpha = new Float32Array(stars.length)
  const phase = new Float32Array(stars.length)
  const rate = new Float32Array(stars.length)
  stars.forEach((star, i) => {
    position[i * 3] = star.x
    position[i * 3 + 1] = star.y
    size[i] = star.size
    alpha[i] = star.alpha
    phase[i] = star.phase
    rate[i] = star.rate
  })
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('aSize', new BufferAttribute(size, 1))
  geometry.setAttribute('aAlpha', new BufferAttribute(alpha, 1))
  geometry.setAttribute('aPhase', new BufferAttribute(phase, 1))
  geometry.setAttribute('aRate', new BufferAttribute(rate, 1))
  return new Points(geometry, material(starVertex, starFragment, { uTime: { value: 0 }, uPixelRatio: { value: 1 } }))
}

const orbitVertex = /* glsl */ `
  attribute vec2 aNormal;
  attribute float aSide;
  attribute float aFar;
  uniform float uHalfWidth;
  uniform vec2 uOffset;
  varying vec2 vPos;
  varying float vDist;
  varying float vFar;
  void main() {
    // One extra pixel on each side carries the antialiased edge.
    float h = uHalfWidth + 1.0;
    vec2 p = position.xy + aNormal * aSide * h + uOffset;
    vPos = p;
    vDist = aSide * h;
    vFar = aFar;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
  }
`

const orbitFragment = /* glsl */ `
  uniform float uHalfWidth;
  uniform float uOpacity;
  uniform float uBackOverPlanet;
  uniform float uIntensity;
  uniform vec3 uPlanet;
  varying vec2 vPos;
  varying float vDist;
  varying float vFar;
  void main() {
    float coverage = clamp(uHalfWidth + 0.5 - abs(vDist), 0.0, 1.0);
    float inside = 1.0 - smoothstep(uPlanet.z - 1.5, uPlanet.z + 1.5, distance(vPos, uPlanet.xy));
    float a = coverage * uOpacity * uIntensity * mix(1.0, uBackOverPlanet, inside * vFar);
    gl_FragColor = vec4(vec3(0.93, 0.91, 0.86) * a, a);
  }
`

const ORBIT_SEGMENTS = 720

/** Ribbon mesh instead of GL lines: lines are one device pixel wide, too thin on retina. */
export function createOrbit(ellipse: Ellipse, system: OrbitSystem, planet: Circle, u: number): Mesh {
  const count = ORBIT_SEGMENTS + 1
  const position = new Float32Array(count * 2 * 3)
  const normal = new Float32Array(count * 2 * 2)
  const side = new Float32Array(count * 2)
  const far = new Float32Array(count * 2)
  const index: number[] = []
  for (let i = 0; i < count; i++) {
    const t = (i / ORBIT_SEGMENTS) * Math.PI * 2
    const p = pointOnEllipse(ellipse, t)
    const q = pointOnEllipse(ellipse, t + 0.001)
    const length = Math.hypot(q.x - p.x, q.y - p.y) || 1
    const nx = -(q.y - p.y) / length
    const ny = (q.x - p.x) / length
    // Smooth 0→1 across the limbs instead of a hard switch at sin t = 0.
    const farness = Math.min(Math.max(-Math.sin(t) * 6, 0), 1)
    for (let k = 0; k < 2; k++) {
      const v = i * 2 + k
      position[v * 3] = p.x
      position[v * 3 + 1] = p.y
      normal[v * 2] = nx
      normal[v * 2 + 1] = ny
      side[v] = k === 0 ? -1 : 1
      far[v] = farness
    }
    if (i < ORBIT_SEGMENTS) {
      const a = i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('aNormal', new BufferAttribute(normal, 2))
  geometry.setAttribute('aSide', new BufferAttribute(side, 1))
  geometry.setAttribute('aFar', new BufferAttribute(far, 1))
  geometry.setIndex(index)
  return new Mesh(
    geometry,
    material(orbitVertex, orbitFragment, {
      uHalfWidth: { value: (system.width * u) / 2 },
      uOpacity: { value: system.opacity },
      uBackOverPlanet: { value: system.backOverPlanet },
      uPlanet: { value: new Vector3(planet.x, planet.y, planet.r) },
    }),
  )
}

const bodyVertex = /* glsl */ `
  attribute float aSize;
  uniform float uPixelRatio;
  uniform float uSpread;
  uniform vec2 uOffset;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy + uOffset, 0.0, 1.0);
    gl_PointSize = aSize * uSpread * uPixelRatio;
  }
`

const glowFragment = /* glsl */ `
  uniform float uSpread;
  uniform float uIntensity;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0 * uSpread;
    float core = 1.0 - smoothstep(0.75, 1.15, d);
    float halo = 0.42 * exp(-d * d * 0.09);
    float a = clamp(core + halo, 0.0, 1.0) * uIntensity;
    gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a, a);
  }
`

const moonFragment = /* glsl */ `
  uniform float uSpread;
  uniform float uIntensity;
  void main() {
    vec2 c = (gl_PointCoord * 2.0 - 1.0) * uSpread;
    c.y = -c.y;
    float r2 = dot(c, c);
    float edge = 1.0 - smoothstep(0.86, 1.0, r2);
    vec3 n = vec3(c, sqrt(max(1.0 - r2, 0.0)));
    // Lit from the same warm side as the planet rim.
    float light = max(dot(n, normalize(vec3(0.9, 0.25, 0.35))), 0.0);
    vec3 color = mix(vec3(0.07, 0.08, 0.1), vec3(0.96, 0.84, 0.66), pow(light, 1.4));
    float a = edge * uIntensity;
    gl_FragColor = vec4(color * a, a);
  }
`

export function createBodies(sizes: readonly number[], kind: 'glow' | 'moon'): Points {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(sizes.length * 3), 3))
  geometry.setAttribute('aSize', new BufferAttribute(Float32Array.from(sizes), 1))
  const spread = kind === 'glow' ? 7 : 1
  return new Points(
    geometry,
    material(bodyVertex, kind === 'glow' ? glowFragment : moonFragment, {
      uPixelRatio: { value: 1 },
      uSpread: { value: spread },
    }),
  )
}
