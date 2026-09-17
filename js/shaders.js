// GLSL shaders for the Sun, planets, rings, atmospheres, belts and comet tail.

export const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){ float f=0.0; float a=0.5; for(int i=0;i<5;i++){ f+=a*snoise(p); p*=2.02; a*=0.5; } return f; }
`;

export const SUN_VERT = /* glsl */`
varying vec3 vNormal; varying vec3 vPos; varying vec3 vView;
void main(){
  vNormal = normalize(normalMatrix * normal);
  vPos = position;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
export const SUN_FRAG = /* glsl */`
uniform float uTime; varying vec3 vNormal; varying vec3 vPos; varying vec3 vView;
${NOISE_GLSL}
void main(){
  vec3 p = normalize(vPos);
  float t = uTime * 0.05;
  // granulation cells: layered noise that slowly boils
  float n1 = fbm(p * 6.0 + vec3(t, -t*0.7, t*0.3));
  float n2 = fbm(p * 18.0 - vec3(t*1.3, t*0.4, -t));
  float n3 = snoise(p * 40.0 + vec3(0.0, t*2.0, 0.0));
  float g = 0.55 + 0.35 * n1 + 0.18 * n2 + 0.06 * n3;
  // sunspots: rare dark patches near the equator
  float spot = smoothstep(0.62, 0.78, fbm(p * 3.0 + vec3(5.0, t*0.2, 1.0))) * (1.0 - smoothstep(0.35, 0.6, abs(p.y)));
  g = mix(g, g * 0.35, spot);
  vec3 cold = vec3(0.95, 0.35, 0.05); vec3 hot = vec3(1.0, 0.85, 0.55); vec3 white = vec3(1.0, 0.97, 0.9);
  vec3 col = mix(cold, hot, smoothstep(0.2, 0.75, g));
  col = mix(col, white, smoothstep(0.8, 1.05, g));
  // limb darkening
  float mu = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
  float limb = 0.35 + 0.65 * pow(mu, 0.55);
  col *= limb;
  gl_FragColor = vec4(col * 1.45, 1.0);
}`;

export const CORONA_FRAG = /* glsl */`
uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
${NOISE_GLSL}
void main(){
  vec2 c = vUv - 0.5; float r = length(c) * 2.0;
  float ang = atan(c.y, c.x);
  float streaks = 0.5 + 0.5 * snoise(vec3(ang * 3.0, r * 4.0 - uTime * 0.08, uTime * 0.03));
  float glow = pow(max(0.0, 1.0 - r), 2.2) * (0.75 + 0.5 * streaks);
  float halo = exp(-r * 3.2) * 1.6;
  float a = clamp(glow + halo, 0.0, 1.0);
  a *= smoothstep(1.0, 0.85, r);
  gl_FragColor = vec4(uColor * a * 1.1, a);
}`;
export const SPRITE_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Planet: Lambert shading from the Sun with optional night lights, ocean glint,
// atmospheric rim scatter and analytic ring shadow.
export const PLANET_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vWorldPos; varying vec3 vWorldNormal;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
export const PLANET_FRAG = /* glsl */`
uniform sampler2D uMap; uniform sampler2D uNight; uniform sampler2D uRingMap;
uniform float uHasNight; uniform float uOcean; uniform float uHasRingShadow;
uniform vec3 uSunPos; uniform vec3 uAtmoColor; uniform float uAtmo; uniform float uAmbient;
uniform vec3 uCenter; uniform vec3 uPoleAxis; uniform float uRingInner; uniform float uRingOuter;
uniform vec3 uCamPos; uniform float uLightScale;
varying vec2 vUv; varying vec3 vWorldPos; varying vec3 vWorldNormal;
void main(){
  vec3 N = normalize(vWorldNormal);
  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 V = normalize(uCamPos - vWorldPos);
  float ndl = dot(N, L);
  float diffuse = clamp(ndl, 0.0, 1.0);
  float shadow = 1.0;
  if (uHasRingShadow > 0.5) {
    // Intersect the ray from this point toward the Sun with the ring plane.
    float denom = dot(uPoleAxis, L);
    if (abs(denom) > 1e-4) {
      float tt = dot(uPoleAxis, uCenter - vWorldPos) / denom;
      if (tt > 0.0) {
        vec3 hit = vWorldPos + L * tt;
        float rr = length(hit - uCenter);
        if (rr > uRingInner && rr < uRingOuter) {
          float u = (rr - uRingInner) / (uRingOuter - uRingInner);
          shadow = 1.0 - texture2D(uRingMap, vec2(u, 0.5)).a * 0.92;
        }
      }
    }
  }
  vec4 base = texture2D(uMap, vUv);
  vec3 day = base.rgb;
  // soft terminator
  float twilight = smoothstep(-0.08, 0.25, ndl);
  vec3 col = day * (diffuse * shadow * uLightScale + uAmbient);
  if (uHasNight > 0.5) {
    vec3 night = texture2D(uNight, vUv).rgb;
    float nightMix = 1.0 - smoothstep(-0.12, 0.12, ndl);
    col += night * night * 2.4 * nightMix;
  }
  if (uOcean > 0.5) {
    float mask = clamp((base.b - max(base.r, base.g)) * 5.0, 0.0, 1.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 60.0) * mask * diffuse * shadow;
    col += vec3(1.0, 0.95, 0.85) * spec * 0.9;
  }
  // atmosphere rim: scatter brightest where the limb is sunlit
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uAtmoColor * rim * uAtmo * (0.15 + 0.85 * twilight);
  gl_FragColor = vec4(col, 1.0);
}`;

export const ATMO_VERT = /* glsl */`
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main(){
  vec4 wp = modelMatrix * vec4(position,1.0);
  vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
export const ATMO_FRAG = /* glsl */`
uniform vec3 uColor; uniform vec3 uSunPos; uniform float uIntensity;
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main(){
  vec3 L = normalize(uSunPos - vW);
  float lit = clamp(dot(vN, L) * 1.2 + 0.35, 0.0, 1.0);
  float fres = pow(1.0 - clamp(dot(vN, vV), 0.0, 1.0), 4.0);
  float a = fres * lit * uIntensity;
  gl_FragColor = vec4(uColor * a * 1.6, a);
}`;

export const RING_VERT = /* glsl */`
varying vec3 vWorldPos; varying float vR;
uniform float uInner; uniform float uOuter;
void main(){
  vec4 wp = modelMatrix * vec4(position,1.0);
  vWorldPos = wp.xyz;
  vR = (length(position.xy) - uInner) / (uOuter - uInner);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
export const RING_FRAG = /* glsl */`
uniform sampler2D uRingMap; uniform vec3 uSunPos; uniform vec3 uCenter; uniform float uPlanetRadius; uniform vec3 uPoleAxis; uniform float uLightScale; uniform vec3 uCamPos;
varying vec3 vWorldPos; varying float vR;
void main(){
  vec4 ring = texture2D(uRingMap, vec2(clamp(vR, 0.0, 1.0), 0.5));
  if (ring.a < 0.01) discard;
  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 V = normalize(uCamPos - vWorldPos);
  // planet shadow on the rings: does the ray toward the Sun hit the planet sphere?
  vec3 toC = uCenter - vWorldPos; float t = dot(toC, L);
  float shadow = 1.0;
  if (t > 0.0) { float d = length(toC - L * t); shadow = smoothstep(uPlanetRadius * 0.985, uPlanetRadius * 1.01, d); }
  float cosSun = dot(uPoleAxis, L); float cosView = dot(uPoleAxis, V);
  float facing = abs(cosSun);
  // lit side vs. back-lit transmission through the ring particles
  float sameSide = step(0.0, cosSun * cosView);
  float lit = mix(0.45 * (1.0 - ring.a * 0.5), 1.0, sameSide) * (0.7 + 0.3 * facing);
  vec3 col = ring.rgb * (lit * shadow * uLightScale + 0.03);
  gl_FragColor = vec4(col, ring.a);
}`;

// Asteroid & Kuiper belts computed on the GPU from orbital parameters.
export const BELT_VERT = /* glsl */`
attribute float aA; attribute float aPhase; attribute float aIncl; attribute float aNode; attribute float aSize; attribute float aEcc;
uniform float uDays; uniform float uMix; uniform float uAuScale; uniform float uPixelRatio;
varying float vAlpha;
void main(){
  float n = 6.283185 / (365.25 * pow(aA, 1.5));
  float M = aPhase + n * uDays;
  float E = M + aEcc * sin(M);
  float r = aA * (1.0 - aEcc * cos(E));
  float th = M + 2.0 * aEcc * sin(M);
  vec3 p = vec3(cos(th) * r, 0.0, -sin(th) * r);
  // inclination about node
  float cn = cos(aNode), sn = sin(aNode), ci = cos(aIncl), si = sin(aIncl);
  vec3 q = vec3(cn * p.x + sn * p.z, 0.0, -sn * p.x + cn * p.z);
  q = vec3(q.x, -q.z * si, q.z * ci);
  q = vec3(cn * q.x - sn * q.z, q.y, sn * q.x + cn * q.z);
  float rr = length(q);
  float rVis = uAuScale * pow(rr, 0.55);
  float rTrue = uAuScale * rr;
  float rs = mix(rVis, rTrue, uMix);
  vec3 pos = q / rr * rs;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = aSize * uPixelRatio * (300.0 / -mv.z) + 0.6;
  vAlpha = aSize;
  gl_Position = projectionMatrix * mv;
}`;
export const BELT_FRAG = /* glsl */`
uniform vec3 uColor; varying float vAlpha;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.15, d) * 0.55 * vAlpha;
  gl_FragColor = vec4(uColor, a);
}`;

export const TAIL_VERT = /* glsl */`
attribute float aT; attribute float aSpread; attribute float aSeed;
uniform vec3 uHead; uniform vec3 uDir; uniform float uLength; uniform float uTime; uniform float uPixelRatio; uniform float uWidth;
varying float vT;
void main(){
  vT = aT;
  vec3 up = abs(uDir.y) < 0.9 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  vec3 s = normalize(cross(uDir, up)); vec3 b = cross(uDir, s);
  float ang = aSeed * 6.283 + uTime * 0.2 * (0.5 + aSeed);
  float spread = aSpread * aT * uWidth;
  vec3 pos = uHead + uDir * (aT * uLength) + (s * cos(ang) + b * sin(ang)) * spread;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = (2.0 + 6.0 * aT) * uPixelRatio * (200.0 / -mv.z) + 1.0;
  gl_Position = projectionMatrix * mv;
}`;
export const TAIL_FRAG = /* glsl */`
uniform vec3 uColor; varying float vT;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d) * (1.0 - vT) * 0.5;
  gl_FragColor = vec4(uColor, a);
}`;

export const STAR_VERT = /* glsl */`
attribute float aSize; attribute vec3 aColor; uniform float uPixelRatio; varying vec3 vColor;
void main(){ vColor = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uPixelRatio; gl_Position = projectionMatrix * mv; }`;
export const STAR_FRAG = /* glsl */`
varying vec3 vColor;
void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(vColor * a, a); }`;
