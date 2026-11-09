// Resolve linear scene radiance; tone mapping and the display transfer run once, at output.
export const outputVertex = /* glsl */`
varying vec2 screenUV;
void main() {
  screenUV = uv;
  gl_Position = vec4(position, 1.0);
}`;

export const outputFragment = /* glsl */`
uniform sampler2D sceneColor;
uniform vec2 sceneSize, outputSize;
varying vec2 screenUV;

vec3 resolveColor() {
#if AA_TAPS > 0
  // Exact pixel-area box integration on the finer geometry grid, even at fractional ratios.
  vec2 ratio = sceneSize / outputSize;
  vec2 lo = floor(gl_FragCoord.xy) * ratio;
  vec2 hi = lo + ratio;
  ivec2 first = ivec2(floor(lo));
#if AA_TAPS == 3
  // Pair the first two texels on each axis with hardware linear interpolation.
  vec2 head = min(ratio, vec2(first) + 1.0 - lo);
  vec2 tail = max(vec2(0.0), hi - vec2(first) - 2.0);
  vec2 pair = ratio - tail;
  vec2 a = (vec2(first) + 0.5 + (pair - head) / pair) / sceneSize;
  vec2 b = (vec2(first) + 2.5) / sceneSize;
  vec3 sum = texture2D(sceneColor, a).rgb * pair.x * pair.y;
  sum += texture2D(sceneColor, vec2(a.x, b.y)).rgb * pair.x * tail.y;
  sum += texture2D(sceneColor, vec2(b.x, a.y)).rgb * tail.x * pair.y;
  sum += texture2D(sceneColor, b).rgb * tail.x * tail.y;
#else
  vec3 sum = vec3(0.0);
  for (int y = 0; y < AA_TAPS; y++) {
    for (int x = 0; x < AA_TAPS; x++) {
      ivec2 p = first + ivec2(x, y);
      vec2 overlap = max(vec2(0.0), min(hi, vec2(p) + 1.0) - max(lo, vec2(p)));
      sum += texelFetch(sceneColor, min(p, ivec2(sceneSize) - 1), 0).rgb * overlap.x * overlap.y;
    }
  }
#endif
  return sum / (ratio.x * ratio.y);
#else
  return texture2D(sceneColor, screenUV).rgb;
#endif
}

#ifdef DESKTOP_OPTICS
uniform sampler2D sceneDepth;
uniform float cameraNear, cameraFar, focusDistance;

float depthAt(vec2 uv) {
  float z = texture2D(sceneDepth, uv).r;
  return cameraNear * cameraFar / mix(cameraFar, cameraNear, z);
}

vec3 optics(vec3 center) {
  vec2 px = 1.0 / outputSize;
  float depth = depthAt(screenUV);
  // Keep the foreground hand and a wide plane around the subject sharp.
  float defocus = abs(1.0 / depth - 1.0 / focusDistance);
  float radius = 1.85 * smoothstep(0.19, 0.75, defocus) * smoothstep(0.28, 0.49, depth);
  vec3 color = center;
  if (radius > 0.12) {
    float weight = 2.0;
    color *= weight;
    for (int i = 0; i < 6; i++) {
      float angle = float(i) * 1.04719755;
      vec2 uv = screenUV + vec2(cos(angle), sin(angle)) * px * radius;
      float tap = 1.0 - smoothstep(0.06, 0.22, abs(depthAt(uv) - depth) / depth);
      color += texture2D(sceneColor, uv).rgb * tap;
      weight += tap;
    }
    color /= weight;
  }
  // A small color separation around lit transitions. Flat bright areas and dark edges stay neutral.
  vec3 left = texture2D(sceneColor, screenUV - vec2(px.x * 0.85, 0.0)).rgb;
  vec3 right = texture2D(sceneColor, screenUV + vec2(px.x * 0.85, 0.0)).rgb;
  vec3 luma = vec3(0.2126, 0.7152, 0.0722);
  float edge = abs(dot(right - left, luma));
  float light = max(dot(center, luma), max(dot(left, luma), dot(right, luma)));
#ifdef TONE_MAPPING
  float highlight = smoothstep(0.85, 1.65, light);
#else
  float highlight = smoothstep(0.69, 0.93, light);
#endif
  vec3 shift = vec3(right.r - left.r, 0.0, left.b - right.b);
  return max(vec3(0.0), color + clamp(shift, -0.4, 0.4) * 0.22 * highlight * smoothstep(0.05, 0.3, edge));
}
#endif

void main() {
  vec3 color = resolveColor();
#ifdef DESKTOP_OPTICS
  color = optics(color);
#endif
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
