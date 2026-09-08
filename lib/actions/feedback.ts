'use server'

import { FieldPath } from 'firebase-admin/firestore'

import { getDb } from '@/lib/firebase/admin'
import type { UIMessageMetadata } from '@/lib/types/ai'

function firestore() {
  return getDb()
}

export async function updateMessageFeedback(
  messageId: string,
  score: number,
  _userId: string | null = null
): Promise<{ success: boolean; error?: string }> {
  try {
    const snap = await firestore()
      .collectionGroup('messages')
      .where(FieldPath.documentId(), '==', messageId)
      .limit(1)
      .get()

    if (snap.empty) {
      return { success: false, error: 'Message not found' }
    }

    const ref = snap.docs[0].ref
    const data = snap.docs[0].data()
    const updatedMetadata = {
      ...(data.metadata || {}),
      feedbackScore: score
    }

    await ref.update({ metadata: updatedMetadata })
    return { success: true }
  } catch (error) {
    console.error('Error updating message feedback:', error)
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to update feedback'
    }
  }
}

export async function getMessageFeedback(
  messageId: string,
  _userId: string | null = null
): Promise<number | null> {
  try {
    const snap = await firestore()
      .collectionGroup('messages')
      .where(FieldPath.documentId(), '==', messageId)
      .limit(1)
      .get()

    if (snap.empty) return null

    const metadata = snap.docs[0].data()?.metadata as
      | UIMessageMetadata
      | undefined
    return (metadata as any)?.feedbackScore ?? null
  } catch (error) {
    console.error('Error getting message feedback:', error)
    return null
  }
}
