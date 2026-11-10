import { removeBackground } from '@imgly/background-removal'
import { decontaminateImageBlob } from './matting'

export interface CutoutProgress {
  label: string
  percent: number
}

function progressFromKey(
  key: string,
  current: number,
  total: number,
): CutoutProgress {
  if (key.startsWith('fetch:')) {
    const ratio = total > 0 ? current / total : 0
    return {
      label: 'Downloading cutout model',
      percent: Math.min(76, 6 + ratio * 70),
    }
  }
  if (key.includes('decode')) {
    return { label: 'Preparing your image', percent: 78 }
  }
  if (key.includes('inference')) {
    return { label: 'Finding the subject', percent: 86 }
  }
  if (key.includes('mask')) {
    return { label: 'Softening the edges', percent: 93 }
  }
  return { label: 'Encoding transparent PNG', percent: 97 }
}

export async function removeImageBackgroundAI(
  file: File,
  onProgress: (progress: CutoutProgress) => void,
): Promise<Blob> {
  const supportsWebGpu = 'gpu' in navigator

  const run = (device: 'gpu' | 'cpu', model: 'isnet' | 'isnet_fp16' | 'isnet_quint8' = 'isnet') =>
    removeBackground(file, {
      model,
      device,
      proxyToWorker: true,
      output: { format: 'image/png', quality: 1 },
      progress: (key, current, total) => {
        onProgress(progressFromKey(key, current, total))
      },
    })

  if (supportsWebGpu) {
    try {
      const blob = await run('gpu', 'isnet')
      onProgress({ label: 'Cleaning up edge colours', percent: 98 })
      return await decontaminateImageBlob(blob, file)
    } catch {
      onProgress({ label: 'Switching to a faster model', percent: 18 })
      try {
        const blob = await run('gpu', 'isnet_fp16')
        onProgress({ label: 'Cleaning up edge colours', percent: 98 })
        return await decontaminateImageBlob(blob, file)
      } catch {
        onProgress({ label: 'Switching to on-device CPU', percent: 18 })
      }
    }
  }

  try {
    const blob = await run('cpu', 'isnet')
    onProgress({ label: 'Cleaning up edge colours', percent: 98 })
    return await decontaminateImageBlob(blob, file)
  } catch {
    onProgress({ label: 'Trying a lighter model', percent: 22 })
  }
  const blob = await run('cpu', 'isnet_fp16')
  onProgress({ label: 'Cleaning up edge colours', percent: 98 })
  return await decontaminateImageBlob(blob, file)
}
