shader_type spatial;
render_mode diffuse_burley, specular_disabled;
uniform vec4 ground_color : source_color = vec4(0.3, 0.45, 0.3, 1.0);
varying vec3 world_position;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise21(vec2 p) {
    vec2 cell = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), f.x),
               mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0)), f.x), f.y);
}
void vertex() { world_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
    float broad = noise21(world_position.xz * 0.16);
    float grain = noise21(world_position.xz * 5.0);
    float patch = smoothstep(0.46, 0.72, broad);
    vec3 earth = ground_color.rgb * vec3(1.14, 0.91, 0.72);
    ALBEDO = mix(ground_color.rgb, earth, patch * 0.48) * (0.86 + broad * 0.2 + grain * 0.05);
    ROUGHNESS = 1.0;
}
