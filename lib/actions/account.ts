'use server'

import { revalidateTag } from 'next/cache'

import { trackAccountDeleted } from '@/lib/analytics'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import * as dbActions from '@/lib/db/actions'
import { getAuth } from '@/lib/firebase/admin'
import { deleteUserObjects } from '@/lib/storage/r2-client'

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Failed to delete account'
}

export async function deleteAccount(): Promise<{
  success: boolean
  error?: string
}> {
  if (process.env.ENABLE_AUTH === 'false') {
    return {
      success: false,
      error: 'Account deletion is unavailable in anonymous mode.'
    }
  }

  const user = await getCurrentUser()
  if (!user) {
    return { success: false, error: 'User not authenticated' }
  }

  try {
    const deleteChatsResult = await dbActions.deleteUserChats(user.uid)
    if (!deleteChatsResult.success) {
      return {
        success: false,
        error: deleteChatsResult.error ?? 'Failed to delete account data'
      }
    }

    const deleteNotesResult = await dbActions.deleteUserNotes(user.uid)
    if (!deleteNotesResult.success) {
      return {
        success: false,
        error: deleteNotesResult.error ?? 'Failed to delete account data'
      }
    }

    const deleteFilesResult = await dbActions.deleteUserLibraryFiles(user.uid)
    if (!deleteFilesResult.success) {
      return {
        success: false,
        error: deleteFilesResult.error ?? 'Failed to delete account data'
      }
    }

    const anonymizeFeedbackResult = await dbActions.anonymizeUserFeedback(
      user.uid
    )
    if (!anonymizeFeedbackResult.success) {
      return {
        success: false,
        error:
          anonymizeFeedbackResult.error ?? 'Failed to anonymize user feedback'
      }
    }

    await deleteUserObjects(user.uid)

    await getAuth().deleteUser(user.uid)

    revalidateTag('chat', 'max')
    await trackAccountDeleted(user.uid)

    return { success: true }
  } catch (error) {
    console.error(`Error deleting account for user ${user.uid}:`, error)
    return { success: false, error: getErrorMessage(error) }
  }
}
