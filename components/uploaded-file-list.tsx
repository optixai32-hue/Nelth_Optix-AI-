'use client'

import React from 'react'

import { IconLoader2 as Loader2, IconX as X } from '@tabler/icons-react'

import { UploadedFile } from '@/lib/types'

interface UploadedFileListProps {
  files: UploadedFile[]
  onRemove: (index: number) => void
  // When true (e.g. in a sent/historical message), the remove button is
  // hidden and onRemove is never called.
  readOnly?: boolean
}

export const UploadedFileList = React.memo(function UploadedFileList({
  files,
  onRemove,
  readOnly = false
}: UploadedFileListProps) {
  if (!files.length) return null

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-3">
      {files.map((file, index) => (
        <UploadedFilePill
          key={index}
          file={file}
          index={index}
          onRemove={onRemove}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
})

const UploadedFilePill = React.memo(function UploadedFilePill({
  file,
  index,
  onRemove,
  readOnly = false
}: {
  file: UploadedFile
  index: number
  onRemove: (index: number) => void
  readOnly?: boolean
}) {
  const [objectUrl, setObjectUrl] = React.useState<
    { file: File; url: string } | undefined
  >()
  const mediaType = file.mediaType ?? file.file?.type ?? ''
  const filename = file.name ?? file.file?.name ?? 'file'
  const isImage = mediaType.startsWith('image/')
  const ext = filename.split('.').pop()?.toUpperCase() ?? 'FILE'
  const imageSrc = file.url
    ? file.url
    : objectUrl && objectUrl.file === file.file
      ? objectUrl.url
      : undefined

  React.useEffect(() => {
    if ((file.url && file.status === 'uploaded') || !file.file) {
      setObjectUrl(undefined)
      return
    }

    const nextObjectUrl = URL.createObjectURL(file.file)
    setObjectUrl({ file: file.file, url: nextObjectUrl })

    return () => URL.revokeObjectURL(nextObjectUrl)
  }, [file.file, file.status, file.url])

  return (
    <div className="relative inline-flex max-w-[260px] items-center gap-2 rounded-xl border border-input bg-background py-1 pl-1.5 pr-1 text-xs">
      <span className="relative size-7 shrink-0 overflow-hidden rounded-md bg-muted/30">
        {isImage && imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageSrc} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-[9px] font-semibold text-muted-foreground">
            {ext}
          </span>
        )}
        {file.status === 'uploading' && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="animate-spin text-white" size={14} />
          </span>
        )}
      </span>

      <span className="truncate text-foreground">{filename}</span>

      {!readOnly && (
        <button
          type="button"
          aria-label="Remove file"
          onClick={() => onRemove(index)}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
})
