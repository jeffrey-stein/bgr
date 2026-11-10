import {
  FilesetResolver,
  ImageSegmenter,
  type ImageSegmenterResult,
} from '@mediapipe/tasks-vision'

const BASE = import.meta.env.BASE_URL
const WASM_PATH = `${BASE}mediapipe/wasm`

/**
 * The multiclass selfie model separates hair, face, body skin and clothes, so
 * the alpha matte keeps fine detail (flyaway hair, fingers) that the binary
 * selfie segmenter simply cannot resolve. Falls back to the small model if the
 * multiclass file is missing.
 */
const MODELS = [
  `${BASE}models/selfie_multiclass.tflite`,
  `${BASE}models/selfie_segmenter.tflite`,
]

type RunningMode = 'IMAGE' | 'VIDEO'

const segmenterCache = new Map<RunningMode, Promise<ImageSegmenter>>()

async function createSegmenter(
  mode: RunningMode,
  modelPath: string,
): Promise<ImageSegmenter> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
  const options = {
    baseOptions: { modelAssetPath: modelPath, delegate: 'CPU' as const },
    runningMode: mode,
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  }
  try {
    return await ImageSegmenter.createFromOptions(fileset, options)
  } catch {
    return await ImageSegmenter.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'GPU' },
    })
  }
}

export function loadSegmenter(mode: RunningMode): Promise<ImageSegmenter> {
  const cached = segmenterCache.get(mode)
  if (cached) return cached

  const promise = (async () => {
    let lastError: unknown = null
    for (const modelPath of MODELS) {
      try {
        return await createSegmenter(mode, modelPath)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError ?? new Error('The segmentation model could not be loaded.')
  })().catch((error) => {
    segmenterCache.delete(mode)
    throw error
  })

  segmenterCache.set(mode, promise)
  return promise
}

export interface MaskTexture {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  imageData: ImageData
  /** Soft alpha band around the subject edge (colour decontamination zone). */
  edgeCanvas: HTMLCanvasElement
  edgeContext: CanvasRenderingContext2D
  edgeImageData: ImageData
  width: number
  height: number
  previous: Float32Array | null
  /** Latest alpha matte, kept for foreground colour unmixing. */
  alpha: Float32Array | null
}

export function createMaskTexture(): MaskTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const edgeCanvas = document.createElement('canvas')
  edgeCanvas.width = 256
  edgeCanvas.height = 256
  const edgeContext = edgeCanvas.getContext('2d', { willReadFrequently: true })
  if (!context || !edgeContext) {
    throw new Error('Canvas 2D is unavailable in this browser.')
  }
  return {
    canvas,
    context,
    imageData: context.createImageData(256, 256),
    edgeCanvas,
    edgeContext,
    edgeImageData: edgeContext.createImageData(256, 256),
    width: 256,
    height: 256,
    previous: null,
    alpha: null,
  }
}

export function resetMaskTexture(texture: MaskTexture) {
  texture.previous = null
  texture.alpha = null
}

function smoothstep(value: number) {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}

interface PickedMask {
  mask: ImageSegmenterResult['confidenceMasks'][number] | NonNullable<
    ImageSegmenterResult['categoryMask']
  >
  alphaSource: 'confidence' | 'category'
  invertChannel?: boolean
  /**
   * Confidence for the hair class only, when the multiclass model provides it.
   * Hair sits below the body's confidence and a single global threshold amputates
   * it, so `renderMask` lowers the threshold proportionally to this channel.
   */
  hair?: Float32Array
}

function pickPersonMask(
  result: ImageSegmenterResult,
  segmenter: ImageSegmenter,
): PickedMask {
  const confidenceMasks = result.confidenceMasks
  if (!confidenceMasks?.length) {
    if (result.categoryMask) {
      return { mask: result.categoryMask, alphaSource: 'category' as const }
    }
    throw new Error('The model did not return a segmentation mask.')
  }

  const labels = segmenter.getLabels()

  // Multiclass selfie model exposes hair as its own class. Read it before the
  // person mask so the hair channel can relax the threshold later on.
  let hair: Float32Array | undefined
  const hairIndex = labels.findIndex((label) => /\bhair\b/i.test(label))
  if (hairIndex >= 0 && confidenceMasks[hairIndex]) {
    hair = confidenceMasks[hairIndex].getAsFloat32Array()
  }

  const background = labels.findIndex((label) => /background/i.test(label))
  if (background >= 0 && confidenceMasks[background]) {
    return {
      mask: confidenceMasks[background],
      alphaSource: 'confidence' as const,
      invertChannel: true,
      hair,
    }
  }

  if (confidenceMasks.length === 1) {
    return {
      mask: confidenceMasks[0],
      alphaSource: 'confidence' as const,
      hair,
    }
  }

  // Binary selfie segmenter: [background, person].
  return {
    mask: confidenceMasks[1],
    alphaSource: 'confidence' as const,
    hair,
  }
}

/** Cheap separable box blur — smooths the 256px confidence map before thresholding. */
function blur(values: Float32Array, width: number, height: number) {
  const tmp = new Float32Array(values.length)
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      const a = values[row + Math.max(0, x - 2)]
      const l = values[row + Math.max(0, x - 1)]
      const c = values[row + x]
      const r = values[row + Math.min(width - 1, x + 1)]
      const rr = values[row + Math.min(width - 1, x + 2)]
      tmp[row + x] = (a + l + c + c + r + rr) / 6
    }
  }
  const out = new Float32Array(values.length)
  for (let y = 0; y < height; y += 1) {
    const up = Math.max(0, y - 1) * width
    const mid = y * width
    const down = Math.min(height - 1, y + 1) * width
    for (let x = 0; x < width; x += 1) {
      out[mid + x] = (tmp[up + x] + tmp[mid + x] * 2 + tmp[down + x]) * 0.25
    }
  }
  return out
}


/** Removes isolated specks and fills holes so the matte is one clean shape. */
function cleanBinary(binary: Uint8Array, width: number, height: number) {
  const total = width * height
  const visited = new Uint8Array(total)
  const stack = new Int32Array(total)
  const minArea = Math.max(18, Math.round(total * 0.0008))

  // Drop connected person blobs that are too small (segmentation speckles).
  for (let seed = 0; seed < total; seed += 1) {
    if (!binary[seed] || visited[seed]) continue
    let top = 0
    stack[top++] = seed
    visited[seed] = 1
    const members: number[] = []
    while (top > 0) {
      const index = stack[--top]
      members.push(index)
      const x = index % width
      const y = (index - x) / width
      if (x > 0 && binary[index - 1] && !visited[index - 1]) {
        visited[index - 1] = 1
        stack[top++] = index - 1
      }
      if (x < width - 1 && binary[index + 1] && !visited[index + 1]) {
        visited[index + 1] = 1
        stack[top++] = index + 1
      }
      if (y > 0 && binary[index - width] && !visited[index - width]) {
        visited[index - width] = 1
        stack[top++] = index - width
      }
      if (y < height - 1 && binary[index + width] && !visited[index + width]) {
        visited[index + width] = 1
        stack[top++] = index + width
      }
    }
    if (members.length < minArea) {
      for (const index of members) binary[index] = 0
    }
  }

  // Fill enclosed holes: flood the background from the border, then any zero
  // pixel the flood never reaches is an interior hole.
  const reached = new Uint8Array(total)
  let top = 0
  for (let x = 0; x < width; x += 1) {
    stack[top++] = x
    stack[top++] = (height - 1) * width + x
  }
  for (let y = 0; y < height; y += 1) {
    stack[top++] = y * width
    stack[top++] = y * width + width - 1
  }
  while (top > 0) {
    const index = stack[--top]
    if (reached[index] || binary[index]) continue
    reached[index] = 1
    const x = index % width
    const y = (index - x) / width
    if (x > 0) stack[top++] = index - 1
    if (x < width - 1) stack[top++] = index + 1
    if (y > 0) stack[top++] = index - width
    if (y < height - 1) stack[top++] = index + width
  }
  for (let i = 0; i < total; i += 1) {
    if (!binary[i] && !reached[i]) binary[i] = 1
  }
}

/**
 * Builds the alpha matte from a segmentation result.
 *
 * `video` is accepted for call-site compatibility but is no longer used here.
 * Edge alignment used to happen by guiding the 256px mask with frame
 * luminance captured on the *first* frame only, so once the subject moved the
 * matte was snapped to a stale silhouette — which is what left background bits
 * behind. The guide now lives in `matting.ts`, where it is rebuilt every frame
 * from the full-resolution frame (luminance plus colour distance to the local
 * background) while the matte is being refined.
 */
export function renderMask(
  texture: MaskTexture,
  result: ImageSegmenterResult,
  segmenter: ImageSegmenter,
  options: {
    threshold: number
    feather: number
    invert?: boolean
    smoothing?: number
  },
  video?: HTMLVideoElement,
) {
  void video
  const picked = pickPersonMask(result, segmenter)
  const mask = picked.mask
  const width = mask.width
  const height = mask.height

  if (texture.width !== width || texture.height !== height) {
    texture.canvas.width = width
    texture.canvas.height = height
    texture.edgeCanvas.width = width
    texture.edgeCanvas.height = height
    texture.width = width
    texture.height = height
    texture.imageData = texture.context.createImageData(width, height)
    texture.edgeImageData = texture.edgeContext.createImageData(width, height)
    texture.previous = null
  }

  const raw =
    picked.alphaSource === 'confidence'
      ? mask.getAsFloat32Array()
      : mask.getAsUint8Array()
  let values: Float32Array
  if (picked.alphaSource === 'confidence') {
    values = raw as Float32Array
    if (picked.invertChannel) {
      values = values.slice()
      for (let i = 0; i < values.length; i += 1) values[i] = 1 - values[i]
    }
    // Blur once to remove the blocky 256-grid staircase before thresholding.
    values = blur(values, width, height)
  } else {
    const bytes = raw as Uint8Array
    values = new Float32Array(bytes.length)
    for (let i = 0; i < bytes.length; i += 1) values[i] = bytes[i] > 0 ? 1 : 0
  }

  const smoothing = Math.min(0.9, Math.max(0, options.smoothing ?? 0))
  const hair = picked.hair
  const hairLift = hair && hair.length === values.length ? 0.22 : 0

  // Temporal smoothing runs on the *confidence* field, before thresholding.
  // Smoothing the binarised alpha instead made the silhouette jump between two
  // discrete shapes every frame, which is what reads as "boiling" edges.
  const previous =
    texture.previous && texture.previous.length === values.length
      ? texture.previous
      : null
  const next = previous ?? new Float32Array(values.length)
  if (previous && smoothing > 0) {
    for (let i = 0; i < values.length; i += 1) {
      const delta = Math.abs(values[i] - previous[i])
      // Moving pixels adopt the new frame quickly; still ones keep most of the
      // history so sensor noise cannot flicker the outline.
      const factor = smoothing * (delta > 0.18 ? 0.25 : 1)
      values[i] = previous[i] * factor + values[i] * (1 - factor)
      next[i] = values[i]
    }
  } else {
    for (let i = 0; i < values.length; i += 1) next[i] = values[i]
    values = next
  }
  texture.previous = next

  const data = texture.imageData.data
  const edgeData = texture.edgeImageData.data
  const feather = Math.max(0.004, options.feather)

  // Threshold, then repair the silhouette. Hair is held back by a global cut,
  // so the threshold is relaxed wherever the hair class is confident.
  const binary = new Uint8Array(width * height)
  for (let i = 0; i < values.length; i += 1) {
    const lift = hairLift > 0 ? hairLift * hair![i] : 0
    binary[i] = values[i] > options.threshold - lift ? 1 : 0
  }
  const before = binary.slice()
  cleanBinary(binary, width, height)

  // Fold the repair back into the confidence field instead of hard-gating the
  // alpha. Specks drop to 0, holes rise to solid, and the feather band around
  // the real silhouette stays continuous — previously alpha stepped from 0 to
  // 0.55 at the boundary, which produced a jagged edge and a bright fringe.
  const solid = options.threshold + feather
  for (let i = 0; i < values.length; i += 1) {
    if (before[i] && !binary[i]) values[i] = 0
    else if (!before[i] && binary[i] && values[i] < solid) values[i] = solid
  }

  const alpha = new Float32Array(values.length)

  for (let i = 0; i < values.length; i += 1) {
    const lift = hairLift > 0 ? hairLift * hair![i] : 0
    const centre = options.threshold - lift
    const low = centre - feather
    const high = centre + feather
    let a = smoothstep((values[i] - low) / (high - low || 0.0001))
    if (options.invert) a = 1 - a

    alpha[i] = a
    const offset = i * 4
    data[offset] = 255
    data[offset + 1] = 255
    data[offset + 2] = 255
    data[offset + 3] = Math.round(a * 255)

    // Edge band: peaks at 50% alpha, where colour contamination lives.
    const band = Math.round(a * (1 - a) * 4 * 255)
    edgeData[offset] = 255
    edgeData[offset + 1] = 255
    edgeData[offset + 2] = 255
    edgeData[offset + 3] = band
  }

  texture.context.putImageData(texture.imageData, 0, 0)
  texture.edgeContext.putImageData(texture.edgeImageData, 0, 0)
  texture.alpha = alpha
  return texture.canvas
}

export async function removeImageWithMediaPipe(
  image: HTMLImageElement,
): Promise<Blob> {
  const segmenter = await loadSegmenter('IMAGE')
  const result = segmenter.segment(image)
  const texture = createMaskTexture()
  renderMask(texture, result, segmenter, {
    threshold: 0.5,
    feather: 0.06,
    smoothing: 0,
  })

  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable in this browser.')

  context.drawImage(image, 0, 0)
  context.globalCompositeOperation = 'destination-in'
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(texture.canvas, 0, 0, canvas.width, canvas.height)
  context.globalCompositeOperation = 'source-over'

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('The cutout could not be encoded.'))
    }, 'image/png')
  })
}
