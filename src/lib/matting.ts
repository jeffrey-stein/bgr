import type { FitMode } from '../types'
import type { MaskTexture } from './segmentation'
import { fitRect } from './utils'

/**
 * Full-resolution alpha refinement for the video cut-out.
 *
 * The segmentation model only ever sees 256x256, so its matte has to be
 * stretched onto the real frame. Three things decide whether that looks clean
 * or jagged:
 *
 * 1. **Edge-aware upsampling.** A plain bilinear stretch of a 256px mask leaves
 *    a stair-stepped silhouette. We refine the stretched alpha with a *guided
 *    filter* (He et al.) driven by a guide built from the frame itself —
 *    luminance plus colour distance to the local background. The guided filter
 *    is O(N) with box filters, has none of the gradient-reversal artefacts of
 *    the joint-bilateral it replaces, and lets the matte snap onto the real
 *    colour boundary instead of the model's blocky one.
 *
 * 2. **Local background estimation.** Alpha unmixing recovers the foreground
 *    from `C = a·F + (1-a)·B`, which needs `B`. A single frame-wide average
 *    only works for a flat backdrop; on a gradient or mixed background the
 *    edges keep a colour fringe. We estimate `B` per pixel from a quarter-res
 *    map of confident background pixels, falling back to the global mean where
 *    there is not enough local evidence.
 *
 * 3. **Spill suppression.** Whatever channel dominates the background bleeds
 *    into semi-transparent edge pixels. Instead of hard-coding green, we detect
 *    the dominant channel from the estimated background and pull it back toward
 *    the mean of the other two, weighted by how edge-like the pixel is.
 */

interface Scratch {
  frame: HTMLCanvasElement
  foreground: HTMLCanvasElement
  alpha: HTMLCanvasElement
  guide: Float32Array
  matte: Float32Array
  meanI: Float32Array
  meanP: Float32Array
  termA: Float32Array
  termB: Float32Array
  coefA: Float32Array
  coefB: Float32Array
  out: Float32Array
  boxTmp: Float32Array
  bgR: Float32Array
  bgG: Float32Array
  bgB: Float32Array
  bgN: Float32Array
  bgTmp: Float32Array
  width: number
  height: number
  bgWidth: number
  bgHeight: number
}

let scratch: Scratch | null = null

function fitArray(current: Float32Array, size: number): Float32Array {
  return current.length >= size ? current : new Float32Array(size)
}

function getScratch(width: number, height: number): Scratch {
  const size = width * height
  if (!scratch) {
    scratch = {
      frame: document.createElement('canvas'),
      foreground: document.createElement('canvas'),
      alpha: document.createElement('canvas'),
      guide: new Float32Array(size),
      matte: new Float32Array(size),
      meanI: new Float32Array(size),
      meanP: new Float32Array(size),
      termA: new Float32Array(size),
      termB: new Float32Array(size),
      coefA: new Float32Array(size),
      coefB: new Float32Array(size),
      out: new Float32Array(size),
      boxTmp: new Float32Array(size),
      bgR: new Float32Array(0),
      bgG: new Float32Array(0),
      bgB: new Float32Array(0),
      bgN: new Float32Array(0),
      bgTmp: new Float32Array(0),
      width: 0,
      height: 0,
      bgWidth: 0,
      bgHeight: 0,
    }
  }
  const s = scratch
  if (s.width !== width || s.height !== height) {
    s.width = width
    s.height = height
    s.guide = fitArray(s.guide, size)
    s.matte = fitArray(s.matte, size)
    s.meanI = fitArray(s.meanI, size)
    s.meanP = fitArray(s.meanP, size)
    s.termA = fitArray(s.termA, size)
    s.termB = fitArray(s.termB, size)
    s.coefA = fitArray(s.coefA, size)
    s.coefB = fitArray(s.coefB, size)
    s.out = fitArray(s.out, size)
    s.boxTmp = fitArray(s.boxTmp, size)
    s.frame.width = width
    s.frame.height = height
    s.foreground.width = width
    s.foreground.height = height
    s.alpha.width = width
    s.alpha.height = height
  }
  return s
}

function context2d(canvas: HTMLCanvasElement) {
  return canvas.getContext('2d', { willReadFrequently: true })
}

/**
 * Separable box blur with edge replication. Two linear sweeps, no exponentials,
 * so it is dramatically cheaper than the per-pixel joint-bilateral it replaces.
 */
function boxBlur(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  out: Float32Array,
  tmp: Float32Array,
) {
  const r = radius < 0 ? 0 : radius
  const count = 2 * r + 1

  for (let y = 0; y < height; y += 1) {
    const row = y * width
    let sum = 0
    for (let k = -r; k <= r; k += 1) {
      const x = k < 0 ? 0 : k >= width ? width - 1 : k
      sum += src[row + x]
    }
    for (let x = 0; x < width; x += 1) {
      tmp[row + x] = sum / count
      const remove = x - r
      const add = x + r + 1
      sum -= src[row + (remove < 0 ? 0 : remove >= width ? width - 1 : remove)]
      sum += src[row + (add < 0 ? 0 : add >= width ? width - 1 : add)]
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let k = -r; k <= r; k += 1) {
      const y = k < 0 ? 0 : k >= height ? height - 1 : k
      sum += tmp[y * width + x]
    }
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / count
      const remove = y - r
      const add = y + r + 1
      sum -=
        tmp[(remove < 0 ? 0 : remove >= height ? height - 1 : remove) * width + x]
      sum += tmp[(add < 0 ? 0 : add >= height ? height - 1 : add) * width + x]
    }
  }
}

/**
 * Guided filter: `q = mean_a · I + mean_b`, with `a = cov(I,p)/(var(I)+eps)`.
 * Where the guide is flat the output becomes the local mean of the matte (so
 * blocky 256px staircase disappears); where the guide has an edge the matte
 * follows that edge instead. Runs entirely on box-filtered statistics.
 */
function refineMatte(
  s: Scratch,
  width: number,
  height: number,
  radius: number,
  eps: number,
) {
  const size = width * height
  const { guide, matte, meanI, meanP, termA, termB, coefA, coefB, out, boxTmp } = s

  boxBlur(guide, width, height, radius, meanI, boxTmp)
  boxBlur(matte, width, height, radius, meanP, boxTmp)

  for (let i = 0; i < size; i += 1) {
    termA[i] = guide[i] * guide[i]
    termB[i] = guide[i] * matte[i]
  }
  boxBlur(termA, width, height, radius, termA, boxTmp)
  boxBlur(termB, width, height, radius, termB, boxTmp)

  for (let i = 0; i < size; i += 1) {
    const mi = meanI[i]
    const variance = termA[i] - mi * mi
    const covariance = termB[i] - mi * meanP[i]
    coefA[i] = covariance / (variance + eps)
    coefB[i] = meanP[i] - coefA[i] * mi
  }

  boxBlur(coefA, width, height, radius, coefA, boxTmp)
  boxBlur(coefB, width, height, radius, coefB, boxTmp)

  for (let i = 0; i < size; i += 1) {
    out[i] = coefA[i] * guide[i] + coefB[i]
  }
}

/** Bilinear sample of a down-scaled map at fractional cell coordinates. */
function sampleCell(
  arr: Float32Array,
  cellsWide: number,
  cellsHigh: number,
  fx: number,
  fy: number,
): number {
  const x = fx < 0 ? 0 : fx > cellsWide - 1 ? cellsWide - 1 : fx
  const y = fy < 0 ? 0 : fy > cellsHigh - 1 ? cellsHigh - 1 : fy
  const x0 = x | 0
  const y0 = y | 0
  const x1 = x0 + 1 < cellsWide ? x0 + 1 : cellsWide - 1
  const y1 = y0 + 1 < cellsHigh ? y0 + 1 : cellsHigh - 1
  const tx = x - x0
  const ty = y - y0
  const top = arr[y0 * cellsWide + x0] + (arr[y0 * cellsWide + x1] - arr[y0 * cellsWide + x0]) * tx
  const bottom = arr[y1 * cellsWide + x0] + (arr[y1 * cellsWide + x1] - arr[y1 * cellsWide + x0]) * tx
  return top + (bottom - top) * ty
}

export function drawPerson(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  mask: MaskTexture,
  fit: FitMode,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const alphaSource = mask.alpha
  if (!alphaSource || !mask.width) return false

  const w = Math.max(64, Math.min(1280, Math.round(rect.width)))
  const h = Math.max(64, Math.round((w * rect.height) / rect.width))
  const s = getScratch(w, h)
  const size = w * h

  const frameContext = context2d(s.frame)
  const fgContext = context2d(s.foreground)
  if (!frameContext || !fgContext) return false

  const frameRect = fitRect(w, h, video.videoWidth, video.videoHeight, fit)
  frameContext.clearRect(0, 0, w, h)
  frameContext.drawImage(
    video,
    frameRect.sourceX,
    frameRect.sourceY,
    frameRect.sourceWidth,
    frameRect.sourceHeight,
    frameRect.x,
    frameRect.y,
    frameRect.width,
    frameRect.height,
  )
  const pixels = frameContext.getImageData(0, 0, w, h).data

  // Stretch the 256px matte up to working resolution.
  const alphaContext = context2d(s.alpha)
  if (!alphaContext) return false
  alphaContext.clearRect(0, 0, w, h)
  alphaContext.imageSmoothingEnabled = true
  alphaContext.imageSmoothingQuality = 'high'
  alphaContext.drawImage(mask.canvas, 0, 0, w, h)
  const alphaPixels = alphaContext.getImageData(0, 0, w, h).data

  const matte = s.matte
  for (let i = 0; i < size; i += 1) {
    matte[i] = alphaPixels[i * 4 + 3] / 255
  }

  // --- local background estimate -----------------------------------------
  // Accumulate sums and counts per cell over confident-background pixels, then
  // box-blur both: dividing the blurred sum by the blurred count gives a
  // weighted average that fills cells with no direct evidence.
  const cell = 8
  const bgW = Math.max(1, Math.ceil(w / cell))
  const bgH = Math.max(1, Math.ceil(h / cell))
  const bgSize = bgW * bgH
  s.bgR = fitArray(s.bgR, bgSize)
  s.bgG = fitArray(s.bgG, bgSize)
  s.bgB = fitArray(s.bgB, bgSize)
  s.bgN = fitArray(s.bgN, bgSize)
  s.bgTmp = fitArray(s.bgTmp, bgSize)
  const bgR = s.bgR
  const bgG = s.bgG
  const bgB = s.bgB
  const bgN = s.bgN
  bgR.fill(0, 0, bgSize)
  bgG.fill(0, 0, bgSize)
  bgB.fill(0, 0, bgSize)
  bgN.fill(0, 0, bgSize)

  let globalR = 0
  let globalG = 0
  let globalB = 0
  let globalN = 0

  for (let y = 0; y < h; y += 1) {
    const cellRow = Math.min(bgH - 1, (y / cell) | 0) * bgW
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x
      if (matte[i] > 0.08) continue
      const offset = i * 4
      const r = pixels[offset]
      const g = pixels[offset + 1]
      const b = pixels[offset + 2]
      const index = cellRow + Math.min(bgW - 1, (x / cell) | 0)
      bgR[index] += r
      bgG[index] += g
      bgB[index] += b
      bgN[index] += 1
      globalR += r
      globalG += g
      globalB += b
      globalN += 1
    }
  }

  if (globalN > 0) {
    globalR /= globalN
    globalG /= globalN
    globalB /= globalN
  } else {
    globalR = 128
    globalG = 128
    globalB = 128
  }

  boxBlur(bgR, bgW, bgH, 2, bgR, s.bgTmp)
  boxBlur(bgG, bgW, bgH, 2, bgG, s.bgTmp)
  boxBlur(bgB, bgW, bgH, 2, bgB, s.bgTmp)
  boxBlur(bgN, bgW, bgH, 2, bgN, s.bgTmp)

  // --- guide --------------------------------------------------------------
  // Blend luminance with colour distance to the local background: the distance
  // term puts a hard step exactly on the silhouette even when subject and
  // backdrop share a luminance, while luminance keeps texture edges available.
  const guide = s.guide
  const invScale = 1 / cell
  for (let y = 0; y < h; y += 1) {
    const fy = y * invScale - 0.5
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x
      const offset = i * 4
      const r = pixels[offset]
      const g = pixels[offset + 1]
      const b = pixels[offset + 2]
      const fx = x * invScale - 0.5
      const count = sampleCell(bgN, bgW, bgH, fx, fy)
      let br = globalR
      let bg = globalG
      let bb = globalB
      if (count > 0.5) {
        br = sampleCell(bgR, bgW, bgH, fx, fy) / count
        bg = sampleCell(bgG, bgW, bgH, fx, fy) / count
        bb = sampleCell(bgB, bgW, bgH, fx, fy) / count
      }
      const dr = r - br
      const dg = g - bg
      const db = b - bb
      const distance = Math.sqrt(dr * dr + dg * dg + db * db) / 180
      const luma = (r * 0.299 + g * 0.587 + b * 0.114) / 255
      guide[i] = 0.5 * luma + 0.5 * (distance > 1 ? 1 : distance)
    }
  }

  refineMatte(s, w, h, 8, 0.001)

  // --- dominant background channel for spill suppression -------------------
  const meanGR = (globalG + globalB) * 0.5
  const meanGG = (globalR + globalB) * 0.5
  const meanGB = (globalR + globalG) * 0.5
  const devR = globalR - meanGR
  const devG = globalG - meanGG
  const devB = globalB - meanGB
  let spillChannel = -1
  let spillAmount = 0
  if (devR >= devG && devR >= devB) {
    spillChannel = 0
    spillAmount = devR
  } else if (devG >= devR && devG >= devB) {
    spillChannel = 1
    spillAmount = devG
  } else {
    spillChannel = 2
    spillAmount = devB
  }
  if (spillAmount < 10) spillChannel = -1
  const spillScale = spillAmount >= 40 ? 1 : (spillAmount - 10) / 30

  // --- composite ----------------------------------------------------------
  const out = s.out
  const fgImage = fgContext.createImageData(w, h)
  const fg = fgImage.data

  for (let y = 0; y < h; y += 1) {
    const fy = y * invScale - 0.5
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x
      const offset = i * 4
      let a = out[i]
      if (a < 0) a = 0
      else if (a > 1) a = 1

      if (a <= 0.005) {
        fg[offset + 3] = 0
        continue
      }

      let pr = pixels[offset]
      let pg = pixels[offset + 1]
      let pb = pixels[offset + 2]

      if (a < 0.995) {
        const fx = x * invScale - 0.5
        const count = sampleCell(bgN, bgW, bgH, fx, fy)
        let br = globalR
        let bg = globalG
        let bb = globalB
        if (count > 0.5) {
          br = sampleCell(bgR, bgW, bgH, fx, fy) / count
          bg = sampleCell(bgG, bgW, bgH, fx, fy) / count
          bb = sampleCell(bgB, bgW, bgH, fx, fy) / count
        }

        // Unmix, regularised so tiny alpha cannot explode the division.
        const divisor = a > 0.2 ? a : 0.2
        let ur = (pr - (1 - a) * br) / divisor
        let ug = (pg - (1 - a) * bg) / divisor
        let ub = (pb - (1 - a) * bb) / divisor
        if (ur < 0) ur = 0
        else if (ur > 255) ur = 255
        if (ug < 0) ug = 0
        else if (ug > 255) ug = 255
        if (ub < 0) ub = 0
        else if (ub > 255) ub = 255

        const trust = a < 0.1 ? 0 : a > 0.25 ? 1 : (a - 0.1) / 0.15
        pr += (ur - pr) * trust
        pg += (ug - pg) * trust
        pb += (ub - pb) * trust

        if (spillChannel >= 0) {
          const edge = a * (1 - a) * 4
          if (edge > 0.01) {
            const strength = 0.8 * edge * spillScale
            if (spillChannel === 1) {
              const neutral = (pr + pb) * 0.5
              if (pg > neutral) pg = neutral + (pg - neutral) * (1 - strength)
            } else if (spillChannel === 0) {
              const neutral = (pg + pb) * 0.5
              if (pr > neutral) pr = neutral + (pr - neutral) * (1 - strength)
            } else {
              const neutral = (pr + pg) * 0.5
              if (pb > neutral) pb = neutral + (pb - neutral) * (1 - strength)
            }
          }
        }
      }

      fg[offset] = pr < 0 ? 0 : pr > 255 ? 255 : pr
      fg[offset + 1] = pg < 0 ? 0 : pg > 255 ? 255 : pg
      fg[offset + 2] = pb < 0 ? 0 : pb > 255 ? 255 : pb
      fg[offset + 3] = Math.round(a * 255)
    }
  }

  fgContext.putImageData(fgImage, 0, 0)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(s.foreground, rect.x, rect.y, rect.width, rect.height)
  return true
}

/** Same decontamination pass for a still-image cutout PNG. */
export async function decontaminateImageBlob(
  blob: Blob,
  source?: Blob,
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    bitmap.close()
    return blob
  }
  context.drawImage(bitmap, 0, 0)
  bitmap.close()

  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  const count = data.length / 4

  // Background estimate. Sampling the cutout's own transparent pixels is
  // useless: the model zeroes them, so the average comes out near-black, and
  // unmixing against black degenerates into F = C / a — which amplified every
  // hair pixel by 1/a and painted white over the silhouette. The real backdrop
  // is still sitting in the source photo underneath, so sample that instead,
  // at exactly the coordinates the cutout believes are background.
  let bgR = 0
  let bgG = 0
  let bgB = 0
  let samples = 0

  if (source) {
    try {
      const sourceBitmap = await createImageBitmap(source)
      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = canvas.width
      sourceCanvas.height = canvas.height
      const sourceContext = sourceCanvas.getContext('2d', {
        willReadFrequently: true,
      })
      if (sourceContext) {
        sourceContext.drawImage(
          sourceBitmap,
          0,
          0,
          sourceCanvas.width,
          sourceCanvas.height,
        )
        const sourceData = sourceContext.getImageData(
          0,
          0,
          sourceCanvas.width,
          sourceCanvas.height,
        ).data
        for (let i = 0; i < count; i += 1) {
          if (data[i * 4 + 3] < 16) {
            const offset = i * 4
            bgR += sourceData[offset]
            bgG += sourceData[offset + 1]
            bgB += sourceData[offset + 2]
            samples += 1
          }
        }
      }
      sourceBitmap.close()
    } catch {
      samples = 0
    }
  }

  // Fallback: the cutout's own transparent pixels (poor, but all we have).
  if (samples < count * 0.01) {
    bgR = 0
    bgG = 0
    bgB = 0
    samples = 0
    for (let i = 0; i < count; i += 1) {
      if (data[i * 4 + 3] < 12) {
        const offset = i * 4
        bgR += data[offset]
        bgG += data[offset + 1]
        bgB += data[offset + 2]
        samples += 1
      }
    }
  }

  if (samples >= count * 0.01) {
    bgR /= samples
    bgG /= samples
    bgB /= samples

    // Unmixing solves C = a·F + (1−a)·B for F, i.e. F = (C − (1−a)·B) / a.
    // `k` is a Wiener-style regulariser: the correction is trusted only in
    // proportion to how much the pixel actually contributes, so the 1/a gain
    // falls back to 1 as alpha falls instead of racing to infinity. `MAX_GAIN`
    // is the hard ceiling that stops any pixel being driven far past its own
    // value — without it a hair wisp sitting a few levels off the backdrop
    // colour still clamps to 255.
    const k = 0.1
    const MAX_GAIN = 2.2

    for (let i = 0; i < count; i += 1) {
      const offset = i * 4
      const a = data[offset + 3] / 255
      if (a > 0.02 && a < 0.98) {
        const inverse = 1 - a
        const w = a / (a + k)
        const c0 = data[offset]
        const c1 = data[offset + 1]
        const c2 = data[offset + 2]

        let pr = c0 + w * ((c0 - inverse * bgR) / a - c0)
        let pg = c1 + w * ((c1 - inverse * bgG) / a - c1)
        let pb = c2 + w * ((c2 - inverse * bgB) / a - c2)

        // Spill suppression: pull excess green back toward the red/blue mean.
        const neutral = (pr + pb) * 0.5
        if (pg > neutral) pg = neutral + (pg - neutral) * 0.25

        const cap = Math.max(c0, 40) * MAX_GAIN
        const capG = Math.max(c1, 40) * MAX_GAIN
        const capB = Math.max(c2, 40) * MAX_GAIN
        data[offset] = Math.max(0, Math.min(cap, Math.min(255, pr)))
        data[offset + 1] = Math.max(0, Math.min(capG, Math.min(255, pg)))
        data[offset + 2] = Math.max(0, Math.min(capB, Math.min(255, pb)))
      }
    }
    context.putImageData(image, 0, 0)
  }

  return new Promise((resolve) => {
    canvas.toBlob((result) => resolve(result ?? blob), 'image/png')
  })
}
