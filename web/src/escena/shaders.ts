// ORIGEN: /opt/data/pythagoras/web/src/escena/shaders.ts @ 1ac4185 (PYTHAGORAS 9): el tramo del halo instanciado
// (VERT_HALO_INSTANCIADO y FRAG_HALO_INSTANCIADO), copiado sin cambios; el resto del archivo es del sistema solar y no
// se trae. tests/test_escena.py coteja que el tramo siga siendo idéntico al original.
/**
 * Halo de cuerpos instanciados: un cuadrado que mira a la cámara, centrado en cada instancia. Tamaño mínimo en
 * píxeles con el truco de las neuronas de aria-graph/brain/shaders.js (`max(escala, -mv.z * uMinWorld)`): desde la
 * vista general una luna de 0,15 unidades sigue siendo un punto visible. Escala 0 = instancia oculta.
 */
export const VERT_HALO_INSTANCIADO = /* glsl */ `
uniform float uTam;
uniform float uMundoPorPx;
uniform float uMinPx;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vec4 centro = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float escala = length(instanceMatrix[0].xyz);
  float lado = escala > 0.0 ? max(escala * uTam, -centro.z * uMundoPorPx * uMinPx) : 0.0;
  centro.xy += position.xy * lado;
  vUv = uv;
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #else
    vColor = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * centro;
}`;

export const FRAG_HALO_INSTANCIADO = /* glsl */ `
uniform float uIntensidad;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float a = 1.0 - smoothstep(0.0, 1.0, r);
  a = a * a * a;
  gl_FragColor = vec4(vColor * a * uIntensidad, 1.0);
  #include <colorspace_fragment>
}`;
