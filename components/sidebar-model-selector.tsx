'use client'

import { useMemo } from 'react'

import {
  MODEL_SELECTION_COOKIE,
  serializeModelSelectionCookie
} from '@/lib/config/model-selection-cookie'
import type { ModelSelectorData } from '@/lib/types/model-selector'
import { setCookie } from '@/lib/utils/cookies'

import { useIsMobile } from '@/hooks/use-mobile'

import { useSidebar } from '@/components/ui/sidebar'

import {
  type ModelOption,
  ModelSelectorContent,
  ModelSelectorEffort,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorRoot,
  ModelSelectorSearch,
  ModelSelectorTrigger} from '@/components/model-selector'

function modelKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'tencent/hy3:free': 'Nelth-3.5',
  'stepfun/step-3.7-flash:free': 'Nelth-3.5 Thinking'
}

function displayName(model: { id: string; name: string }): string {
  return MODEL_DISPLAY_NAMES[model.id] ?? model.name
}

export default function SidebarModelSelector({
  modelSelectorData,
  isCloudDeployment = false,
  isGuest = false
}: {
  modelSelectorData?: ModelSelectorData
  isCloudDeployment?: boolean
  isGuest?: boolean
}) {
  const { state } = useSidebar()
  const isMobile = useIsMobile()

  const models = useMemo<ModelOption[]>(() => {
    if (!modelSelectorData) return []
    return Object.entries(modelSelectorData.modelsByProvider).flatMap(
      ([, list]) =>
        list.map(model => ({
          id: modelKey(model.providerId, model.id),
        name: displayName(model),
        description: ''
        }))
    )
  }, [modelSelectorData])

  if (isCloudDeployment || isGuest || !modelSelectorData) return null
  if (!models.length) return null

  const selectedId = modelSelectorData.selectedModelKey || models[0]?.id

  const handleValueChange = (value: string) => {
    const separatorIndex = value.indexOf(':')
    if (separatorIndex <= 0) return
    const providerId = value.slice(0, separatorIndex)
    const modelId = value.slice(separatorIndex + 1)
    setCookie(
      MODEL_SELECTION_COOKIE,
      serializeModelSelectionCookie({ providerId, modelId })
    )
  }

  const position = isMobile
    ? 'right-3'
    : state === 'expanded'
      ? 'left-[calc(var(--sidebar-width)+8px)]'
      : 'left-10'

  return (
    <div className={`fixed top-3 z-50 ${position}`}>
      <ModelSelectorRoot
        models={models}
        defaultValue={selectedId}
        onValueChange={handleValueChange}
      >
        <ModelSelectorTrigger variant="ghost" />
        <ModelSelectorContent searchable={false}>
          <ModelSelectorList>
            <ModelSelectorEmpty />
            <ModelSelectorGroup heading="Models">
              {models.map(model => (
                <ModelSelectorItem key={model.id} model={model} />
              ))}
            </ModelSelectorGroup>
          </ModelSelectorList>
          <ModelSelectorEffort label="Thinking" />
        </ModelSelectorContent>
      </ModelSelectorRoot>
    </div>
  )
}
