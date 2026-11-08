'use client';

import { useEffect, useRef } from 'react';

type GlassFoldProps = {
  color1?: string;
  color2?: string;
  color3?: string;
  speed?: number;
  scale?: number;
  noise?: number;
  className?: string;
};

const vertexShader = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fragmentShader = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;
uniform float u_noise;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform vec3 u_color3;
varying vec2 v_uv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 uv = v_uv;
  vec2 p = (uv - 0.5) * vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  p *= u_scale;
  float t = u_time;

  float waveA = sin(p.x * 2.1 + t * 0.34 + sin(p.y * 2.7 - t * 0.21));
  float waveB = cos(p.y * 3.0 - t * 0.27 + sin(p.x * 1.8 + t * 0.18));
  float fold = sin((p.x + p.y * 0.62) * 3.6 + waveA * 1.25 + t * 0.16);
  float crease = exp(-abs(fold) * 4.2);
  float ribbon = 0.5 + 0.5 * sin(p.x * 1.65 - p.y * 2.2 + waveB * 1.7 + t * 0.12);
  float depth = clamp(0.48 + waveA * 0.17 + waveB * 0.14 + ribbon * 0.18, 0.0, 1.0);

  vec3 color = mix(u_color1, u_color2, smoothstep(0.05, 0.94, depth));
  color = mix(color, u_color3, smoothstep(0.66, 0.99, ribbon) * 0.48);
  color += crease * vec3(0.42, 0.5, 0.72) * 0.42;
  color += pow(max(0.0, 1.0 - abs(fold)), 18.0) * vec3(0.52, 0.62, 0.78) * 0.32;

  float vignette = 1.0 - smoothstep(0.12, 1.15, length((uv - 0.5) * vec2(1.1, 0.9)));
  float grain = noise2(uv * u_resolution * 0.42 + t * 0.07) - 0.5;
  color += grain * u_noise;
  color *= 0.76 + vignette * 0.24;
  float alpha = 0.34 + crease * 0.28 + ribbon * 0.12;
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.78));
}`;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map(char => char + char).join('') : clean;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return [0.2, 0.3, 0.5];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function GlassFold({
  color1 = '#142448', color2 = '#6e66b9', color3 = '#91e1e5',
  speed = 0.42, scale = 1.15, noise = 0.055, className = ''
}: GlassFoldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) return;

    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShader);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
    if (!vertex || !fragment) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const resolution = gl.getUniformLocation(program, 'u_resolution');
    const time = gl.getUniformLocation(program, 'u_time');
    const scaleUniform = gl.getUniformLocation(program, 'u_scale');
    const noiseUniform = gl.getUniformLocation(program, 'u_noise');
    const c1 = gl.getUniformLocation(program, 'u_color1');
    const c2 = gl.getUniformLocation(program, 'u_color2');
    const c3 = gl.getUniformLocation(program, 'u_color3');
    gl.uniform1f(scaleUniform, scale);
    gl.uniform1f(noiseUniform, noise);
    gl.uniform3fv(c1, hexToRgb(color1));
    gl.uniform3fv(c2, hexToRgb(color2));
    gl.uniform3fv(c3, hexToRgb(color3));

    let frame = 0;
    let start = 0;
    let width = 0;
    let height = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.8);
      width = Math.max(1, Math.floor(rect.width * dpr));
      height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      gl.uniform2f(resolution, width, height);
    };
    const draw = (timestamp: number) => {
      if (!start) start = timestamp;
      resize();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(time, reducedMotion ? 0 : ((timestamp - start) / 1000) * speed);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reducedMotion) frame = window.requestAnimationFrame(draw);
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    window.addEventListener('resize', resize);
    frame = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [color1, color2, color3, speed, scale, noise]);

  return <canvas ref={canvasRef} className={`glass-fold-canvas ${className}`} aria-hidden="true" />;
}
