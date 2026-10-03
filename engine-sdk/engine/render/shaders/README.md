# Shader System Architecture

This engine uses a **modular JavaScript-based shader system** where WGSL code is stored in JavaScript files as template literals.

## Key Benefits

- **String interpolation** for compile-time constants (`${Math.PI}`)
- **ES module imports** for shader composition
- **No async loading** - bundled with the application
- **Conditional compilation** via tagged template literals

## Folder Structure

```
shaders/
├── modules/
│   ├── chunks/                 # ← Reusable WGSL fragments
│   │   ├── math_common.js      # PI, TAU, saturate(), remap(), sq(), pow5()
│   │   ├── structs_common.js   # Light, Camera, Frame, Material structs
│   │   ├── lighting_common.js  # Attenuation, diffuse, specular functions
│   │   ├── noise2d.js          # 2D noise: hash2d, noise2d, fbm2d
│   │   ├── noise3d.js          # 3D noise: hash3d, noise3d, fbm3d
│   │   ├── fullscreen_quad.js  # Fullscreen triangle vertex shader
│   │   └── raymarching.js      # Ray-box, phase functions, Beer-Lambert
│   ├── core/                   # Complete particle/billboard shaders
│   │   ├── particles_billboard.js
│   │   ├── particles_shared.js
│   │   └── particles_point.js
│   └── postfx/                 # Post-processing effects
│       ├── volume_smoke.js
│       └── fluid_water_*.js
├── core/                       # Standard/legacy complete shaders
│   ├── standard.js             # Main PBR shader with lighting
│   ├── lighting.js             # Legacy lighting functions
│   └── global_common.js        # Minimal frame uniforms
├── materials/                  # PBR material shaders
│   ├── pbr_brdf.js             # GGX/Schlick BRDF
│   ├── pbr_ibl.js              # Image-based lighting
│   └── shadow_pcf.js           # Percentage-closer filtering
├── debug/                      # Debug visualization shaders
├── WgslPreprocessor.js         # Tagged template for #if/#else/#endif
├── ShaderSources.js            # Central registry (import here)
└── ShaderLoaderJS.js           # getShaderSource() function
```

## Usage Examples

### Basic Composition
```javascript
import { mathCommonWGSL } from "./modules/chunks/math_common.js";
import { noise3dWGSL } from "./modules/chunks/noise3d.js";

const myShader = mathCommonWGSL + noise3dWGSL + /* wgsl */`
  @fragment
  fn fs_main() -> @location(0) vec4<f32> {
    let n = noise3d(vec3<f32>(1.0, 2.0, 3.0));
    return vec4<f32>(n, n, n, 1.0);
  }
`;
```

### Conditional Compilation
```javascript
import { wgsl } from "./WgslPreprocessor.js";

const useShadows = true;
const lightCount = 4;

const shader = wgsl`
  const MAX_LIGHTS : u32 = ${lightCount}u;
  
  #if ${useShadows}
    fn sampleShadow(pos: vec3<f32>) -> f32 {
      // Shadow sampling code
      return 1.0;
    }
  #else
    fn sampleShadow(pos: vec3<f32>) -> f32 {
      return 1.0; // No shadows
    }
  #endif
`;
```

### Using Shared Structs
```javascript
import { lightStructWGSL } from "./modules/chunks/structs_common.js";
import { lightAttenuationWGSL } from "./modules/chunks/lighting_common.js";

const myLitShader = lightStructWGSL + lightAttenuationWGSL + /* wgsl */`
  fn calculateLight(light: Light, fragPos: vec3<f32>) -> f32 {
    let dist = length(light.position - fragPos);
    return attenuatePoint(dist);
  }
`;
```

## Available Math Utilities (`math_common.js`)

| Constant/Function | Description |
|-------------------|-------------|
| `PI`, `TAU`, `HALF_PI` | Circle constants |
| `INV_PI` | 1/π for normalization |
| `EPSILON` | Small value for comparisons |
| `DEG_TO_RAD`, `RAD_TO_DEG` | Angle conversion |
| `saturate(x)` | Clamp to [0, 1] |
| `saturate3(v)`, `saturate4(v)` | Vector saturate |
| `lerpf(a, b, t)` | Linear interpolation |
| `inverseLerp(a, b, v)` | Inverse lerp |
| `remap(v, inMin, inMax, outMin, outMax)` | Range remapping |
| `sq(x)` | x² (faster than pow) |
| `pow5(x)` | x⁵ (for Fresnel) |
| `lengthSq2(v)`, `lengthSq3(v)` | Squared length |
| `safeNormalize(v)` | Handles zero vectors |

## Shared Structs (`structs_common.js`)

| Struct | Fields |
|--------|--------|
| `Light` | position, lightType, color, innerCone, direction, outerCone |
| `CameraUniforms` | viewProj, invViewProj, view, projection, position, forward, right, up |
| `FrameUniforms` | viewProj, time, deltaTime |
| `PbrMaterial` | baseColor, metallic, roughness, ao, emissive, emissiveStrength |

## Best Practices

1. **Import chunks at top of file** - Keep dependencies clear
2. **Use shared structs** - Avoid duplicate definitions
3. **Compose with `+`** - Order matters (structs before functions)
4. **Use `saturate()` not `clamp(x, 0.0, 1.0)`** - Clearer intent
5. **Use `PI` not `3.14159`** - Consistent precision
6. **Document dependencies** - Comment what chunks are required
