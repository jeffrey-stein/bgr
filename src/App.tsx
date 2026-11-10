import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Image as ImageIcon, UploadCloud } from 'lucide-react'
import './App.css'
import type {
  AiStatus,
  Background,
  FitMode,
  MediaAsset,
  ProcessingState,
  RatioKey,
  ToastItem,
  ToolKey,
  VideoMeta,
} from './types'
import { Landing } from './components/Landing'
import { ProjectsPage } from './components/ProjectsPage'
import { AuthModal } from './components/AuthModal'
import { TopBar } from './components/TopBar'
import { Rail } from './components/Rail'
import { LibraryPanel } from './components/LibraryPanel'
import { Inspector } from './components/Inspector'
import { Stage } from './components/Stage'
import { CanvasFooter } from './components/CanvasFooter'
import { ExportModal } from './components/ExportModal'
import { Toasts } from './components/Toasts'
import type { VideoStageHandle } from './components/VideoStage'
import { removeImageBackgroundAI } from './lib/backgroundRemoval'
import { removeImageWithMediaPipe } from './lib/segmentation'
import { extractAudio } from './lib/audio'
import { composeImage } from './lib/compose'
import { getPreferredVideoFormat } from './lib/video'
import { getCurrentUser, signOut, type User } from './lib/auth'
import {
  createProject,
  getProject,
  touchProject,
  type ProjectRecord,
} from './lib/projects'
import {
  captureVideoThumbnail,
  downloadBlob,
  fileBaseName,
  getImageDimensions,
  getOutputSize,
  loadImage,
  loadVideoMeta,
  ratioValue,
  uid,
} from './lib/utils'

const SUPPORTED_IMAGE = /\.(png|jpe?g|webp|avif|gif|bmp)$/i
const SUPPORTED_VIDEO = /\.(mp4|webm|mov|m4v|ogv)$/i

function isVideoFile(file: File) {
  return file.type.startsWith('video/') || SUPPORTED_VIDEO.test(file.name)
}

function isSupportedFile(file: File) {
  return (
    file.type.startsWith('image/') ||
    file.type.startsWith('video/') ||
    SUPPORTED_IMAGE.test(file.name) ||
    SUPPORTED_VIDEO.test(file.name)
  )
}

async function createAsset(file: File): Promise<MediaAsset> {
  const kind = isVideoFile(file) ? 'video' : 'image'
  const url = URL.createObjectURL(file)

  try {
    if (kind === 'image') {
      const { width, height } = await getImageDimensions(url)
      return {
        id: uid('media'),
        file,
        name: file.name,
        kind,
        url,
        thumbUrl: url,
        width,
        height,
        duration: 0,
        size: file.size,
        cutoutStatus: 'idle',
        videoCutout: false,
      }
    }

    const meta = await loadVideoMeta(url)
    const thumb = await captureVideoThumbnail(url, meta.duration)
    return {
      id: uid('media'),
      file,
      name: file.name,
      kind,
      url,
      thumbUrl: thumb,
      width: meta.width,
      height: meta.height,
      duration: meta.duration,
      size: file.size,
      cutoutStatus: 'idle',
      videoCutout: false,
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

function App() {
  const [view, setView] = useState<'home' | 'projects' | 'editor'>('home')
  const [user, setUser] = useState<User | null>(() => getCurrentUser())
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | null>(null)
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)

  const [projectName, setProjectName] = useState('Untitled project')
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [ratio, setRatio] = useState<RatioKey>('16:9')
  const [fit, setFit] = useState<FitMode>('contain')
  const [background, setBackground] = useState<Background>({
    mode: 'color',
    color: '#00B140',
  })
  const [tool, setTool] = useState<ToolKey>('media')
  const [libraryOpen, setLibraryOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth > 880,
  )
  const [inspectorOpen, setInspectorOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth > 1180,
  )
  const [threshold, setThreshold] = useState(0.5)
  const [feather, setFeather] = useState(0.05)
  const [invert, setInvert] = useState(false)
  const [videoAiStatus, setVideoAiStatus] = useState<AiStatus>('idle')
  const [videoMeta, setVideoMeta] = useState<VideoMeta>({
    time: 0,
    duration: 0,
    playing: false,
  })
  const [processing, setProcessing] = useState<ProcessingState | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [exportOpen, setExportOpen] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<VideoStageHandle | null>(null)
  const dragDepth = useRef(0)
  const assetsRef = useRef<MediaAsset[]>([])

  const activeAsset = useMemo(
    () => assets.find((asset) => asset.id === activeId) ?? null,
    [activeId, assets],
  )
  const videoCutout = activeAsset?.kind === 'video' && activeAsset.videoCutout
  const outputSize = useMemo(
    () => getOutputSize(ratio, activeAsset),
    [activeAsset, ratio],
  )
  const previewRatio = useMemo(
    () => ratioValue(ratio, activeAsset),
    [activeAsset, ratio],
  )
  const videoFormat = useMemo(() => getPreferredVideoFormat(), [])
  const formatLabel =
    activeAsset?.kind === 'video' ? (videoFormat?.label ?? 'Video') : 'PNG'
  const audioCount = assets.filter((asset) => asset.audio).length

  assetsRef.current = assets

  const notify = useCallback(
    (title: string, message?: string, tone: ToastItem['tone'] = 'default') => {
      const id = uid('toast')
      setToasts((current) => [...current, { id, title, message, tone }])
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id))
      }, 4600)
    },
    [],
  )

  const patchAsset = useCallback((id: string, patch: Partial<MediaAsset>) => {
    setAssets((current) =>
      current.map((asset) => (asset.id === id ? { ...asset, ...patch } : asset)),
    )
  }, [])

  const resetEditor = useCallback(() => {
    assetsRef.current.forEach((asset) => {
      URL.revokeObjectURL(asset.url)
      if (asset.cutoutUrl) URL.revokeObjectURL(asset.cutoutUrl)
      if (asset.audio) URL.revokeObjectURL(asset.audio.url)
    })
    setAssets([])
    setActiveId(null)
    setRatio('16:9')
    setFit('contain')
    setBackground({ mode: 'color', color: '#00B140' })
    setTool('media')
    setThreshold(0.5)
    setFeather(0.05)
    setInvert(false)
    setVideoAiStatus('idle')
    setVideoMeta({ time: 0, duration: 0, playing: false })
    setProcessing(null)
  }, [])

  const openEditor = useCallback(
    (project?: ProjectRecord | null, opts?: { fresh?: boolean }) => {
      resetEditor()
      if (project) {
        setCurrentProjectId(project.id)
        setProjectName(project.name || 'Untitled project')
        touchProject(project.id, {})
      } else if (opts?.fresh && user) {
        const p = createProject(user.id)
        setCurrentProjectId(p.id)
        setProjectName(p.name)
      } else {
        setCurrentProjectId(null)
        setProjectName('Untitled project')
      }
      setView('editor')
    },
    [resetEditor, user],
  )

  useEffect(() => {
    setVideoAiStatus('idle')
    setVideoMeta({
      time: 0,
      duration: activeAsset?.duration ?? 0,
      playing: false,
    })
  }, [activeAsset?.duration, activeAsset?.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const inField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        if (view === 'editor') setExportOpen(true)
        return
      }

      if (
        event.code === 'Space' &&
        !inField &&
        !exportOpen &&
        activeAsset?.kind === 'video'
      ) {
        event.preventDefault()
        videoRef.current?.toggle()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeAsset?.kind, exportOpen, view])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1180px)')
    const handle = () => {
      if (media.matches) setInspectorOpen(false)
    }
    media.addEventListener('change', handle)
    return () => media.removeEventListener('change', handle)
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 880px)')
    const handle = () => {
      if (media.matches) setLibraryOpen(false)
    }
    media.addEventListener('change', handle)
    return () => media.removeEventListener('change', handle)
  }, [])

  useEffect(() => {
    return () => {
      assetsRef.current.forEach((asset) => {
        URL.revokeObjectURL(asset.url)
        if (asset.cutoutUrl) URL.revokeObjectURL(asset.cutoutUrl)
        if (asset.audio) URL.revokeObjectURL(asset.audio.url)
      })
    }
  }, [])

  useEffect(() => {
    if (user && currentProjectId) {
      touchProject(currentProjectId, { name: projectName })
    }
  }, [projectName, user, currentProjectId])

  const addFiles = async (fileList: FileList | File[]) => {
    if (uploading) return
    const files = Array.from(fileList)
    const supported = files.filter(isSupportedFile)
    if (!supported.length) {
      notify('Unsupported file', 'Upload an image or video file.', 'error')
      return
    }

    setUploading(true)
    const created: MediaAsset[] = []
    let failed = 0

    for (const file of supported) {
      try {
        created.push(await createAsset(file))
      } catch {
        failed += 1
      }
    }

    if (created.length) {
      setAssets((current) => [...current, ...created])
      setActiveId((current) => current ?? created[0].id)
      setTool('media')
      setLibraryOpen(true)
      notify(
        created.length === 1 ? 'Media added' : `${created.length} files added`,
        'Ready for cutout and green screen.',
        'success',
      )
      if (user && currentProjectId) touchProject(currentProjectId, {})
    }

    if (failed) {
      notify(
        'Some files could not be read',
        'Try an MP4 (H.264) or WebM video, or a standard image file.',
        'error',
      )
    }
    setUploading(false)
  }

  const removeAsset = (asset: MediaAsset) => {
    const index = assets.findIndex((item) => item.id === asset.id)
    const next = assets[index + 1] ?? assets[index - 1] ?? null
    URL.revokeObjectURL(asset.url)
    if (asset.cutoutUrl) URL.revokeObjectURL(asset.cutoutUrl)
    if (asset.audio) URL.revokeObjectURL(asset.audio.url)
    setAssets((current) => current.filter((item) => item.id !== asset.id))
    if (activeId === asset.id) setActiveId(next?.id ?? null)
    notify('Removed from project', asset.name)
  }

  const handleRemoveImage = async () => {
    if (!activeAsset || activeAsset.kind !== 'image' || processing) return
    setProcessing({
      assetId: activeAsset.id,
      kind: 'image-cutout',
      label: 'Preparing the cutout model',
      progress: 3,
    })

    try {
      let blob: Blob | null = null
      let fallback = false
      try {
        blob = await removeImageBackgroundAI(activeAsset.file, (progress) => {
          setProcessing({
            assetId: activeAsset.id,
            kind: 'image-cutout',
            label: progress.label,
            progress: progress.percent,
          })
        })
      } catch {
        fallback = true
        setProcessing({
          assetId: activeAsset.id,
          kind: 'image-cutout',
          label: 'Trying the on-device person model',
          progress: 52,
        })
        const image = await loadImage(activeAsset.url)
        blob = await removeImageWithMediaPipe(image)
      }

      if (!blob) throw new Error('The cutout could not be created.')
      const cutoutUrl = URL.createObjectURL(blob)
      patchAsset(activeAsset.id, {
        cutoutUrl,
        cutoutBlob: blob,
        cutoutStatus: 'done',
      })
      notify(
        'Background removed',
        fallback
          ? 'Used the on-device person cutout. Your green screen is ready.'
          : 'Your subject is ready for chroma green.',
        'success',
      )
      setBackground((current) =>
        current.mode === 'transparent'
          ? { mode: 'color', color: '#00B140' }
          : current,
      )
    } catch (error) {
      patchAsset(activeAsset.id, { cutoutStatus: 'error' })
      notify(
        'Could not remove the background',
        error instanceof Error ? error.message : 'Please try another image.',
        'error',
      )
    } finally {
      setProcessing(null)
    }
  }

  const handleRestoreImage = () => {
    if (!activeAsset || activeAsset.kind !== 'image') return
    if (activeAsset.cutoutUrl) URL.revokeObjectURL(activeAsset.cutoutUrl)
    patchAsset(activeAsset.id, {
      cutoutUrl: undefined,
      cutoutBlob: undefined,
      cutoutStatus: 'idle',
    })
    notify('Original restored', 'The transparent cutout was removed.')
  }

  const handleToggleVideoCutout = (next: boolean) => {
    if (!activeAsset || activeAsset.kind !== 'video') return
    patchAsset(activeAsset.id, { videoCutout: next })
    if (!next) setVideoAiStatus('idle')
    if (next) {
      setBackground((current) =>
        current.mode === 'transparent'
          ? { mode: 'color', color: '#00B140' }
          : current,
      )
    }
  }

  const handleQuickCutout = () => {
    if (!activeAsset) return
    if (activeAsset.kind === 'video') {
      handleToggleVideoCutout(true)
    } else {
      void handleRemoveImage()
    }
  }

  const handleExtractAudio = async (
    asset: MediaAsset | null = activeAsset,
    mode: 'full' | 'voice' | 'background' = asset?.audioMode ?? 'full',
  ) => {
    if (!asset || asset.kind !== 'video' || processing) return
    setProcessing({
      assetId: asset.id,
      kind: 'audio',
      label: 'Decoding the soundtrack',
      progress: 28,
    })
    try {
      const audio = await extractAudio(asset.file, mode)
      patchAsset(asset.id, { audio, audioMode: mode })
      setProcessing({
        assetId: asset.id,
        kind: 'audio',
        label: 'Writing WAV file',
        progress: 94,
      })
      setTool('audio')
      setLibraryOpen(true)
      const modeLabel =
        mode === 'voice' ? 'Vocals isolated' : mode === 'background' ? 'Background isolated' : 'Soundtrack extracted'
      notify(
        modeLabel,
        `${fileBaseName(asset.name)}-audio.wav is ready to download.`,
        'success',
      )
    } catch (error) {
      notify(
        'Could not extract audio',
        error instanceof Error ? error.message : 'Try another video file.',
        'error',
      )
    } finally {
      setProcessing(null)
    }
  }

  const handleDownloadAudio = (asset: MediaAsset | null = activeAsset) => {
    if (!asset?.audio) return
    downloadBlob(asset.audio.blob, `${fileBaseName(asset.name)}-audio.wav`)
    notify('Audio downloaded', 'WAV saved to your device.', 'success')
  }

  const handleVideoError = useCallback(
    (message: string) => notify('Video issue', message, 'error'),
    [notify],
  )

  const handleExportImage = async (): Promise<Blob> => {
    if (!activeAsset || activeAsset.kind !== 'image') {
      throw new Error('Select an image to export.')
    }
    return composeImage(activeAsset, {
      background,
      fit,
      width: outputSize.width,
      height: outputSize.height,
    })
  }

  const handleExportVideo = async (options: {
    mimeType: string
    onProgress: (progress: number) => void
  }): Promise<Blob> => {
    if (!activeAsset || activeAsset.kind !== 'video' || !videoRef.current) {
      throw new Error('Select a video to export.')
    }
    return videoRef.current.exportVideo({
      width: outputSize.width,
      height: outputSize.height,
      mimeType: options.mimeType,
      onProgress: options.onProgress,
    })
  }

  const handleTool = (nextTool: ToolKey) => {
    if (tool === nextTool) {
      setLibraryOpen((current) => !current)
      return
    }
    setTool(nextTool)
    setLibraryOpen(true)
  }

  const handleBackground = (next: Background) => {
    setBackground(next)
  }

  const handleSignOut = () => {
    signOut()
    setUser(null)
    setView('home')
  }

  if (view === 'home') {
    return (
      <>
        <Landing
          user={user}
          onOpenProjects={() => setView('projects')}
          onSignIn={() => setAuthMode('signin')}
          onSignUp={() => setAuthMode('signup')}
          onSignOut={handleSignOut}
        />
        {authMode ? (
          <AuthModal
            mode={authMode}
            onClose={() => setAuthMode(null)}
            onAuthed={(u) => {
              setUser(u)
              setAuthMode(null)
              setView('projects')
            }}
          />
        ) : null}
      </>
    )
  }

  if (view === 'projects') {
    return (
      <>
        <ProjectsPage
          user={user}
          onHome={() => setView('home')}
          onOpenProject={(p) => openEditor(p)}
          onNewProject={(id) => {
            if (id) {
              const p = getProject(id)
              openEditor(p)
            } else {
              openEditor(null)
            }
          }}
          onSignIn={() => setAuthMode('signin')}
          onSignOut={handleSignOut}
        />
        {authMode ? (
          <AuthModal
            mode={authMode}
            onClose={() => setAuthMode(null)}
            onAuthed={(u) => {
              setUser(u)
              setAuthMode(null)
            }}
          />
        ) : null}
      </>
    )
  }

  return (
    <div
      className={`app ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return
        event.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        void addFiles(event.dataTransfer.files)
      }}
    >
      <TopBar
        projectName={projectName}
        onProjectName={setProjectName}
        activeAsset={activeAsset}
        onHome={() => setView('home')}
        onProjects={() => setView('projects')}
        onExport={() => setExportOpen(true)}
        onToggleLibrary={() => setLibraryOpen((current) => !current)}
        onToggleInspector={() => setInspectorOpen((current) => !current)}
        libraryOpen={libraryOpen}
        inspectorOpen={inspectorOpen}
        user={user}
        onSignIn={() => setAuthMode('signin')}
      />

      <div
        className={`app-shell ${libraryOpen ? 'library-open' : ''} ${
          inspectorOpen ? 'inspector-open' : ''
        }`}
      >
        <Rail activeTool={tool} onTool={handleTool} audioCount={audioCount} />

        {libraryOpen ? (
          <LibraryPanel
            tool={tool}
            onClose={() => setLibraryOpen(false)}
            assets={assets}
            activeAsset={activeAsset}
            processing={processing}
            videoAiStatus={videoAiStatus}
            videoCutout={Boolean(videoCutout)}
            background={background}
            ratio={ratio === 'original' ? 'Auto' : ratio}
            threshold={threshold}
            feather={feather}
            invert={invert}
            outputWidth={outputSize.width}
            outputHeight={outputSize.height}
            formatLabel={formatLabel}
            uploading={uploading}
            onUpload={() => fileInputRef.current?.click()}
            onSelect={setActiveId}
            onRemoveAsset={removeAsset}
            onToggleVideoCutout={handleToggleVideoCutout}
            onRemoveImage={handleRemoveImage}
            onRestoreImage={handleRestoreImage}
            onBackground={handleBackground}
            onExtractAudio={(mode) => void handleExtractAudio(undefined, mode)}
            onDownloadAudio={handleDownloadAudio}
            onOpenExport={() => setExportOpen(true)}
            onThreshold={setThreshold}
            onFeather={setFeather}
            onInvert={setInvert}
            onTool={setTool}
          />
        ) : null}

        <main className="workspace">
          <Stage
            asset={activeAsset}
            ratio={ratio}
            fit={fit}
            background={background}
            videoCutout={Boolean(videoCutout)}
            videoMeta={videoMeta}
            processing={processing}
            videoRef={videoRef}
            onUpload={() => fileInputRef.current?.click()}
            onQuickCutout={handleQuickCutout}
            onTogglePlay={() => videoRef.current?.toggle()}
            onVideoMeta={setVideoMeta}
            onVideoAiStatus={setVideoAiStatus}
            onVideoError={handleVideoError}
            threshold={threshold}
            feather={feather}
            invert={invert}
            videoAiStatus={videoAiStatus}
          />
          <CanvasFooter
            asset={activeAsset}
            meta={videoMeta}
            videoCutout={Boolean(videoCutout)}
            processing={processing}
            onTogglePlay={() => videoRef.current?.toggle()}
            onSeek={(time) => videoRef.current?.seek(time)}
            onOpenAudio={() => {
              setTool('audio')
              setLibraryOpen(true)
            }}
            onExport={() => setExportOpen(true)}
          />
        </main>

        {inspectorOpen ? (
          <Inspector
            asset={activeAsset}
            ratio={ratio}
            fit={fit}
            background={background}
            videoCutout={Boolean(videoCutout)}
            processing={processing}
            videoAiStatus={videoAiStatus}
            threshold={threshold}
            feather={feather}
            invert={invert}
            outputWidth={outputSize.width}
            outputHeight={outputSize.height}
            formatLabel={formatLabel}
            onClose={() => setInspectorOpen(false)}
            onRatio={setRatio}
            onFit={setFit}
            onBackground={handleBackground}
            onToggleVideoCutout={handleToggleVideoCutout}
            onRemoveImage={handleRemoveImage}
            onRestoreImage={handleRestoreImage}
            onExtractAudio={(mode) => void handleExtractAudio(undefined, mode)}
            onDownloadAudio={() => handleDownloadAudio()}
            onOpenExport={() => setExportOpen(true)}
            onThreshold={setThreshold}
            onFeather={setFeather}
            onInvert={setInvert}
          />
        ) : null}
      </div>

      <Toasts
        toasts={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((toast) => toast.id !== id))
        }
      />

      <ExportModal
        open={exportOpen}
        asset={activeAsset}
        background={background}
        width={outputSize.width}
        height={outputSize.height}
        previewRatio={previewRatio}
        formatLabel={formatLabel}
        videoFormat={videoFormat}
        onClose={() => setExportOpen(false)}
        onExportImage={handleExportImage}
        onExportVideo={handleExportVideo}
        onDownloadAudio={() => handleDownloadAudio()}
      />

      {authMode ? (
        <AuthModal
          mode={authMode}
          onClose={() => setAuthMode(null)}
          onAuthed={(u) => {
            setUser(u)
            setAuthMode(null)
          }}
        />
      ) : null}

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/gif,video/mp4,video/webm,video/quicktime"
        multiple
        onChange={(event) => {
          if (event.target.files) void addFiles(event.target.files)
          event.target.value = ''
        }}
      />

      {dragging ? (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            <div className="drop-overlay-icon">
              <UploadCloud size={30} />
              <span className="drop-orbit">
                <ImageIcon size={13} />
              </span>
            </div>
            <h2>Drop it. We'll cut it out.</h2>
            <p>PNG, JPG, WEBP, MP4, MOV, or WEBM</p>
            <div className="drop-overlay-privacy">Stays on this device</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
