export type MediaKind = 'image' | 'video'

export type RatioKey = '16:9' | '9:16' | '1:1' | '4:5' | 'original'

export type FitMode = 'contain' | 'cover'

export type Background =
  | { mode: 'transparent' }
  | { mode: 'color'; color: string }

export type CutoutStatus = 'idle' | 'processing' | 'done' | 'error'

export type AiStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ExtractedAudio {
  blob: Blob
  url: string
  duration: number
  waveform: number[]
  sampleRate: number
}

export interface MediaAsset {
  id: string
  file: File
  name: string
  kind: MediaKind
  url: string
  thumbUrl: string
  width: number
  height: number
  duration: number
  size: number
  cutoutUrl?: string
  cutoutBlob?: Blob
  cutoutStatus: CutoutStatus
  videoCutout: boolean
  audio?: ExtractedAudio
  audioMode?: 'full' | 'voice' | 'background'
}

export interface VideoMeta {
  time: number
  duration: number
  playing: boolean
}

export type ToolKey = 'media' | 'cutout' | 'backdrop' | 'audio' | 'export'

export interface ToastItem {
  id: string
  title: string
  message?: string
  tone?: 'default' | 'success' | 'error'
}

export interface ProcessingState {
  assetId: string
  kind: 'image-cutout' | 'audio'
  label: string
  progress: number
}
