'use server'

import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore
} from 'firebase-admin/firestore'

import { getDb } from '@/lib/firebase/admin'
import type { UIMessage } from '@/lib/types/ai'
import type { PersistableUIMessage } from '@/lib/types/message-persistence'
import {
  buildUIMessageFromDB,
  mapUIMessagePartsToDBParts,
  mapUIMessageToDBMessage
} from '@/lib/utils/message-mapping'
import {
  compareMessagesForOrder,
  dedupeConsecutiveDuplicates,
  sortMessagesForOrder
} from '@/lib/utils/message-ordering'
import { perfLog, perfTime } from '@/lib/utils/perf-logging'
import { incrementDbOperationCount } from '@/lib/utils/perf-tracking'

import type {
  Chat,
  Feedback,
  LibraryFile,
  Message,
  NewLibraryFile,
  NewNote,
  Note
} from './schema'
import { generateId } from './schema'

function firestore(): Firestore {
  return getDb()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateSafe(value: unknown): Date {
  if (!value) return new Date(0)
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    if (!isNaN(d.getTime())) return d
  }
  if (
    typeof value === 'object' &&
    'toDate' in (value as any) &&
    typeof (value as any).toDate === 'function'
  ) {
    return (value as any).toDate()
  }
  return new Date(0)
}

function toChat(doc: DocumentSnapshot): Chat | null {
  const data = doc.data()
  if (!data) return null
  return {
    id: data.id,
    title: data.title,
    userId: data.userId,
    visibility: data.visibility,
    createdAt: toDateSafe(data.createdAt)
  }
}

function toMessageDoc(
  doc: DocumentSnapshot
): {
  id: string
  role: string
  createdAt: Date
  updatedAt: Date | null
  sequence: number | null
  metadata?: any
} {
  const data = doc.data() || {}
  return {
    id: doc.id,
    role: data.role,
    createdAt: toDateSafe(data.createdAt),
    updatedAt: data.updatedAt ? toDateSafe(data.updatedAt) : null,
    sequence: typeof data.sequence === 'number' ? data.sequence : null,
    metadata: data.metadata ?? undefined
  }
}

/**
 * Atomically allocate the next per-conversation sequence number.
 *
 * The counter lives on the chat document and is incremented inside a
 * Firestore transaction, so concurrent writers (e.g. a fast user message
 * followed by an assistant message) can never receive the same sequence and
 * the order is fully controlled by the database, never by client clocks.
 */
async function getNextSequence(chatId: string): Promise<number> {
  const chatRef = firestore().collection('chats').doc(chatId)
  return firestore().runTransaction(async tx => {
    const snap = await tx.get(chatRef)
    const current =
      snap.exists && typeof snap.data()?.messageCount === 'number'
        ? (snap.data()!.messageCount as number)
        : 0
    const next = current + 1
    tx.set(chatRef, { messageCount: next }, { merge: true })
    return next
  })
}

function toNote(doc: DocumentSnapshot): Note {
  const data = doc.data() || {}
  return {
    id: doc.id,
    userId: data.userId,
    chatId: data.chatId ?? null,
    sourceMessageId: data.sourceMessageId ?? null,
    title: data.title,
    content: data.content,
    createdAt: toDateSafe(data.createdAt),
    updatedAt: toDateSafe(data.updatedAt)
  }
}

function toLibraryFile(doc: DocumentSnapshot): LibraryFile {
  const data = doc.data() || {}
  return {
    id: doc.id,
    userId: data.userId,
    chatId: data.chatId ?? null,
    filename: data.filename,
    objectKey: data.objectKey,
    mediaType: data.mediaType,
    size: data.size ?? null,
    createdAt: toDateSafe(data.createdAt),
    updatedAt: toDateSafe(data.updatedAt)
  }
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

export async function createChat({
  id = generateId(),
  title,
  userId,
  visibility = 'private'
}: {
  id?: string
  title: string
  userId: string
  visibility?: 'public' | 'private'
}): Promise<Chat> {
  const now = new Date()
  const ref = firestore().collection('chats').doc(id)
  await ref.set({
    id,
    title,
    userId,
    visibility,
    createdAt: now,
    // Sequence counter for deterministic message ordering.
    messageCount: 0
  })
  return {
    id,
    title,
    userId,
    visibility,
    createdAt: now
  }
}

export async function getChat(
  chatId: string,
  userId?: string | null
): Promise<Chat | null> {
  const snap = await firestore().collection('chats').doc(chatId).get()
  if (!snap.exists) return null
  const chat = toChat(snap)
  if (!chat) return null

  if (chat.visibility === 'public') return chat
  if (chat.visibility === 'private' && userId && chat.userId === userId) {
    return chat
  }
  return null
}

export async function upsertMessage(
  message: PersistableUIMessage & { chatId: string },
  _userId?: string | null | null
): Promise<Message> {
  const count = incrementDbOperationCount()
  perfLog(`DB - upsertMessage called - count: ${count}`)

  const msgRef = firestore()
    .collection('chats')
    .doc(message.chatId)
    .collection('messages')
    .doc(message.id)

  const existing = await msgRef.get()
  const dbParts = mapUIMessagePartsToDBParts(
    message.parts as any[],
    message.id
  )
  const messageData = mapUIMessageToDBMessage(message as any)

  // Sequence: keep the existing value for updates (so re-saving a message during
  // streaming never reorders it), assign a fresh server-controlled sequence for
  // brand-new messages, and leave legacy messages (no sequence yet) untouched so
  // they keep ordering by createdAt alongside their peers.
  const existingData = existing.data()
  let sequence: number | null
  if (existing.exists) {
    sequence =
      typeof existingData?.sequence === 'number'
        ? existingData.sequence
        : null
  } else {
    sequence = await getNextSequence(message.chatId)
  }

  const now = new Date()
  const data = {
    id: message.id,
    chatId: message.chatId,
    role: messageData.role,
    metadata: messageData.metadata ?? null,
    createdAt: existing.exists ? (existing.data()?.createdAt ?? now) : now,
    updatedAt: now,
    sequence,
    parts: dbParts
  }

  await msgRef.set(data, { merge: true })

  return {
    id: message.id,
    chatId: message.chatId,
    role: messageData.role,
    createdAt: toDateSafe(data.createdAt),
    updatedAt: now,
    sequence,
    metadata: data.metadata
  }
}

export async function loadChat(
  chatId: string,
  _userId?: string | null | null
): Promise<UIMessage[]> {
  const snap = await firestore()
    .collection('chats')
    .doc(chatId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .get()

  const messages = snap.docs.map(doc => {
    const data = doc.data()
    return buildUIMessageFromDB(
      toMessageDoc(doc),
      (data?.parts as any[]) || [],
      chatId
    )
  })

  return dedupeConsecutiveDuplicates(sortMessagesForOrder(messages))
}

/**
 * Returns the id of an existing assistant message that directly follows the
 * given user message, if any. Used to make assistant persistence idempotent:
 * retried/duplicate requests must UPDATE the same assistant document instead of
 * creating a second one.
 */
export async function findExistingAssistantId(
  chatId: string,
  userMessageId: string
): Promise<string | null> {
  const snap = await firestore()
    .collection('chats')
    .doc(chatId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .get()

  const docs = snap.docs
  const idx = docs.findIndex(d => d.id === userMessageId)
  if (idx === -1) return null
  const next = docs[idx + 1]
  if (next && (next.data()?.role === 'assistant' || next.data()?.role === 'tool')) {
    return next.id
  }
  return null
}

export async function loadChatWithMessages(
  chatId: string,
  userId?: string | null
): Promise<(Chat & { messages: UIMessage[] }) | null> {
  const count = incrementDbOperationCount()
  perfLog(`DB - loadChatWithMessages called - count: ${count}`)

  let chatSnap
  let messagesSnap
  try {
    ;[chatSnap, messagesSnap] = await Promise.all([
      firestore().collection('chats').doc(chatId).get(),
      firestore()
        .collection('chats')
        .doc(chatId)
        .collection('messages')
        .orderBy('createdAt', 'asc')
        .get()
    ])
  } catch (error: unknown) {
    // Firestore returns code 5 / "NOT_FOUND" when the database (or collection)
    // resource is missing — e.g. Firestore is not provisioned in the project.
    // Treat as "chat not found" instead of crashing the page with a
    // Runtime Error; the caller renders a 404 in that case.
    const code = (error as { code?: number | string })?.code
    const message = (error as { message?: string })?.message ?? ''
    if (code === 5 || code === 'NOT_FOUND' || message.includes('NOT_FOUND')) {
      console.warn(
        `loadChatWithMessages: Firestore resource not found for chat ${chatId}. ` +
          'Is the Firestore database provisioned in this project?'
      )
      return null
    }
    throw error
  }

  if (!chatSnap.exists) return null
  const chat = toChat(chatSnap)
  if (!chat) return null

  if (chat.visibility === 'private' && (!userId || chat.userId !== userId)) {
    return null
  }

  const messages = sortMessagesForOrder(
    messagesSnap.docs.map(doc => {
      const data = doc.data()
      return buildUIMessageFromDB(
        toMessageDoc(doc),
        (data?.parts as any[]) || [],
        chatId
      )
    })
  )

  return { ...chat, messages: dedupeConsecutiveDuplicates(messages) }
}

export async function deleteMessagesAfter(
  chatId: string,
  messageId: string,
  _userId?: string | null | null
): Promise<{ count: number }> {
  const ordered = await loadOrderedMessageRefs(chatId)
  const index = ordered.findIndex(m => m.id === messageId)
  if (index === -1) return { count: 0 }

  const toDelete = ordered.slice(index + 1)
  if (toDelete.length === 0) return { count: 0 }

  const batch = firestore().batch()
  toDelete.forEach(m => batch.delete(m.ref))
  await batch.commit()

  return { count: toDelete.length }
}

export async function deleteMessagesFromIndex(
  chatId: string,
  messageId: string,
  _userId?: string | null | null
): Promise<{ count: number }> {
  const ordered = await loadOrderedMessageRefs(chatId)
  const index = ordered.findIndex(m => m.id === messageId)
  if (index === -1) return { count: 0 }

  const toDelete = ordered.slice(index)
  const batch = firestore().batch()
  toDelete.forEach(m => batch.delete(m.ref))
  await batch.commit()

  return { count: toDelete.length }
}

/**
 * Load a chat's message document references in deterministic order
 * (sequence ASC, fallback createdAt ASC). Used by deletion helpers so the
 * "from index" / "after" semantics follow the same order the UI renders.
 */
async function loadOrderedMessageRefs(
  chatId: string
): Promise<{ id: string; ref: DocumentReference }[]> {
  const snap = await firestore()
    .collection('chats')
    .doc(chatId)
    .collection('messages')
    .get()

  const mapped = snap.docs.map(d => ({
    id: d.id,
    ref: d.ref,
    sequence: typeof d.data()?.sequence === 'number' ? d.data()!.sequence : null,
    createdAt: d.data()?.createdAt
  }))

  return sortMessagesForOrder(mapped).map(({ id, ref }) => ({ id, ref }))
}

export async function getChats(userId: string): Promise<Chat[]> {
  const snap = await firestore()
    .collection('chats')
    .where('userId', '==', userId)
    .get()
  return snap.docs
    .map(d => toChat(d)!)
    .filter(Boolean)
    .sort(
      (a, b) =>
        toDateSafe(b.createdAt).getTime() - toDateSafe(a.createdAt).getTime()
    )
}

export async function getChatsPage(
  userId: string,
  limit = 20,
  offset = 0
): Promise<{ chats: Chat[]; nextOffset: number | null }> {
  try {
    const snap = await firestore()
      .collection('chats')
      .where('userId', '==', userId)
      .get()

    const all = snap.docs
      .map(d => toChat(d)!)
      .filter(Boolean)
      .sort(
        (a, b) =>
          toDateSafe(b.createdAt).getTime() - toDateSafe(a.createdAt).getTime()
      )

    const page = all.slice(offset, offset + limit)
    const nextOffset = offset + limit < all.length ? offset + limit : null
    return { chats: page, nextOffset }
  } catch (error) {
    console.error('Error fetching chat page:', error)
    return { chats: [], nextOffset: null }
  }
}

export async function deleteChat(
  chatId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const chatRef = firestore().collection('chats').doc(chatId)
    const chatSnap = await chatRef.get()
    if (!chatSnap.exists || chatSnap.data()?.userId !== userId) {
      return { success: false, error: 'Unauthorized' }
    }

    await deleteChatDocuments(chatId)
    return { success: true }
  } catch (error) {
    console.error('Error deleting chat:', error)
    return { success: false, error: 'Failed to delete chat' }
  }
}

async function deleteChatDocuments(chatId: string): Promise<void> {
  const chatRef = firestore().collection('chats').doc(chatId)
  const messages = await chatRef.collection('messages').get()

  const batchSize = 450
  for (let i = 0; i < messages.docs.length; i += batchSize) {
    const batch = firestore().batch()
    messages.docs.slice(i, i + batchSize).forEach(d => batch.delete(d.ref))
    batch.delete(chatRef)
    await batch.commit()
  }
  if (messages.docs.length === 0) {
    await chatRef.delete()
  }
}

export async function deleteUserChats(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const chats = await firestore()
      .collection('chats')
      .where('userId', '==', userId)
      .get()

    for (const chat of chats.docs) {
      await deleteChatDocuments(chat.id)
    }
    return { success: true }
  } catch (error) {
    console.error('Error deleting user chats:', error)
    return { success: false, error: 'Failed to delete user chats' }
  }
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function createNote(
  note: Omit<NewNote, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Note> {
  const id = generateId()
  const now = new Date()
  const ref = firestore().collection('users').doc(note.userId).collection('notes').doc(id)
  await ref.set({
    id,
    userId: note.userId,
    chatId: note.chatId ?? null,
    sourceMessageId: note.sourceMessageId ?? null,
    title: note.title,
    content: note.content,
    createdAt: now,
    updatedAt: now
  })
  return {
    id,
    userId: note.userId,
    chatId: note.chatId ?? null,
    sourceMessageId: note.sourceMessageId ?? null,
    title: note.title,
    content: note.content,
    createdAt: now,
    updatedAt: now
  }
}

export type NotesPageCursor = {
  updatedAt: string
  id: string
}

export async function getNotes(
  userId: string,
  {
    limit = 25,
    cursor
  }: {
    limit?: number
    cursor?: NotesPageCursor
  } = {}
): Promise<{
  notes: Note[]
  nextCursor: NotesPageCursor | null
  hasMore: boolean
}> {
  const pageLimit = Math.max(1, Math.min(limit, 50))
  let q = firestore()
    .collection('users')
    .doc(userId)
    .collection('notes')
    .orderBy('updatedAt', 'desc')
    .orderBy('id', 'desc')

  if (cursor) {
    const curDate = new Date(cursor.updatedAt)
    if (!isNaN(curDate.getTime())) {
      q = q.startAfter(curDate, cursor.id)
    }
  }

  const snap = await q.limit(pageLimit + 1).get()
  const docs = snap.docs
  const hasMore = docs.length > pageLimit
  const pageDocs = docs.slice(0, pageLimit)

  const notes = pageDocs.map(d => toNote(d))
  const last = pageDocs[pageDocs.length - 1]

  return {
    notes,
    nextCursor:
      hasMore && last
        ? {
            updatedAt: toDateSafe(last.data()?.updatedAt).toISOString(),
            id: last.id
          }
        : null,
    hasMore
  }
}

export async function searchNotes(
  userId: string,
  query: string,
  { limit = 20 }: { limit?: number } = {}
): Promise<Note[]> {
  const trimmed = query.trim().toLowerCase()
  const pageLimit = Math.max(1, Math.min(limit, 50))

  const snap = await firestore()
    .collection('users')
    .doc(userId)
    .collection('notes')
    .orderBy('updatedAt', 'desc')
    .get()

  const notes = snap.docs.map(d => toNote(d))
  if (!trimmed) return notes.slice(0, pageLimit)

  return notes
    .filter(n => n.title.toLowerCase().includes(trimmed))
    .slice(0, pageLimit)
}

export async function getNote(
  noteId: string,
  userId: string
): Promise<Note | null> {
  const snap = await firestore()
    .collection('users')
    .doc(userId)
    .collection('notes')
    .doc(noteId)
    .get()
  if (!snap.exists) return null
  if (snap.data()?.userId !== userId) return null
  return toNote(snap)
}

export async function deleteNote(
  noteId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const ref = firestore()
      .collection('users')
      .doc(userId)
      .collection('notes')
      .doc(noteId)
    const snap = await ref.get()
    if (!snap.exists || snap.data()?.userId !== userId) {
      return { success: false, error: 'Note not found' }
    }
    await ref.delete()
    return { success: true }
  } catch (error) {
    console.error('Error deleting note:', error)
    return { success: false, error: 'Failed to delete note' }
  }
}

export async function deleteUserNotes(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const snap = await firestore()
      .collection('users')
      .doc(userId)
      .collection('notes')
      .get()
    const batch = firestore().batch()
    snap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
    return { success: true }
  } catch (error) {
    console.error('Error deleting user notes:', error)
    return { success: false, error: 'Failed to delete user notes' }
  }
}

// ---------------------------------------------------------------------------
// Library files
// ---------------------------------------------------------------------------

export async function createLibraryFile(
  file: Omit<NewLibraryFile, 'id' | 'createdAt' | 'updatedAt'>
): Promise<LibraryFile> {
  let chatId = file.chatId ?? null
  if (chatId) {
    const chatSnap = await firestore().collection('chats').doc(chatId).get()
    if (!chatSnap.exists || chatSnap.data()?.userId !== file.userId) {
      chatId = null
    }
  }

  const id = generateId()
  const now = new Date()
  const ref = firestore()
    .collection('users')
    .doc(file.userId)
    .collection('files')
    .doc(id)
  await ref.set({
    id,
    userId: file.userId,
    chatId,
    filename: file.filename,
    objectKey: file.objectKey,
    mediaType: file.mediaType,
    size: file.size ?? null,
    createdAt: now,
    updatedAt: now
  })

  return {
    id,
    userId: file.userId,
    chatId,
    filename: file.filename,
    objectKey: file.objectKey,
    mediaType: file.mediaType,
    size: file.size ?? null,
    createdAt: now,
    updatedAt: now
  }
}

export type FilesPageCursor = {
  updatedAt: string
  id: string
}

export async function getLibraryFiles(
  userId: string,
  {
    limit = 25,
    cursor
  }: {
    limit?: number
    cursor?: FilesPageCursor
  } = {}
): Promise<{
  files: LibraryFile[]
  nextCursor: FilesPageCursor | null
  hasMore: boolean
}> {
  const pageLimit = Math.max(1, Math.min(limit, 50))
  let q = firestore()
    .collection('users')
    .doc(userId)
    .collection('files')
    .orderBy('updatedAt', 'desc')
    .orderBy('id', 'desc')

  if (cursor) {
    const curDate = new Date(cursor.updatedAt)
    if (!isNaN(curDate.getTime())) {
      q = q.startAfter(curDate, cursor.id)
    }
  }

  const snap = await q.limit(pageLimit + 1).get()
  const docs = snap.docs
  const hasMore = docs.length > pageLimit
  const pageDocs = docs.slice(0, pageLimit)

  const files = pageDocs.map(d => toLibraryFile(d))
  const last = pageDocs[pageDocs.length - 1]

  return {
    files,
    nextCursor:
      hasMore && last
        ? {
            updatedAt: toDateSafe(last.data()?.updatedAt).toISOString(),
            id: last.id
          }
        : null,
    hasMore
  }
}

export async function searchLibraryFiles(
  userId: string,
  query: string,
  { limit = 20 }: { limit?: number } = {}
): Promise<LibraryFile[]> {
  const trimmed = query.trim().toLowerCase()
  const pageLimit = Math.max(1, Math.min(limit, 50))

  const snap = await firestore()
    .collection('users')
    .doc(userId)
    .collection('files')
    .orderBy('updatedAt', 'desc')
    .get()

  const files = snap.docs.map(d => toLibraryFile(d))
  if (!trimmed) return files.slice(0, pageLimit)

  return files
    .filter(f => f.filename.toLowerCase().includes(trimmed))
    .slice(0, pageLimit)
}

export async function deleteLibraryFile(
  fileId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const ref = firestore()
      .collection('users')
      .doc(userId)
      .collection('files')
      .doc(fileId)
    const snap = await ref.get()
    if (!snap.exists || snap.data()?.userId !== userId) {
      return { success: false, error: 'File not found' }
    }
    await ref.delete()
    return { success: true }
  } catch (error) {
    console.error('Error deleting library file:', error)
    return { success: false, error: 'Failed to delete file' }
  }
}

export async function deleteUserLibraryFiles(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const snap = await firestore()
      .collection('users')
      .doc(userId)
      .collection('files')
      .get()
    const batch = firestore().batch()
    snap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
    return { success: true }
  } catch (error) {
    console.error('Error deleting user library files:', error)
    return { success: false, error: 'Failed to delete user files' }
  }
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export async function anonymizeUserFeedback(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const snap = await firestore()
      .collection('feedback')
      .where('userId', '==', userId)
      .get()
    const batch = firestore().batch()
    snap.docs.forEach(d => batch.update(d.ref, { userId: null }))
    await batch.commit()
    return { success: true }
  } catch (error) {
    console.error('Error anonymizing user feedback:', error)
    return { success: false, error: 'Failed to anonymize user feedback' }
  }
}

// ---------------------------------------------------------------------------
// Chat updates
// ---------------------------------------------------------------------------

export async function updateChatVisibility(
  chatId: string,
  userId: string,
  visibility: 'public' | 'private'
): Promise<Chat | null> {
  const chat = await getChat(chatId, userId)
  if (!chat || chat.userId !== userId) return null

  await firestore().collection('chats').doc(chatId).update({ visibility })
  return { ...chat, visibility }
}

export async function updateChatTitle(
  chatId: string,
  title: string,
  _userId?: string | null | null
): Promise<Chat | null> {
  const snap = await firestore().collection('chats').doc(chatId).get()
  if (!snap.exists) return null
  await firestore().collection('chats').doc(chatId).update({ title })
  return { ...toChat(snap)!, title }
}

export async function createChatWithFirstMessageTransaction({
  chatId,
  chatTitle,
  userId,
  message
}: {
  chatId: string
  chatTitle: string
  userId: string
  message: PersistableUIMessage
}): Promise<{ chat: Chat; message: Message }> {
  perfLog(`DB - createChatWithFirstMessageTransaction start`)
  const dbStart = performance.now()

  const now = new Date()
  const chatRef = firestore().collection('chats').doc(chatId)
  await chatRef.set({
    id: chatId,
    title: chatTitle.substring(0, 255),
    userId,
    visibility: 'private',
    createdAt: now,
    // First message gets sequence 1; counter starts at 1.
    messageCount: 1
  })

  const messageId = message.id || generateId()
  const msgRef = firestore()
    .collection('chats')
    .doc(chatId)
    .collection('messages')
    .doc(messageId)

  const dbParts = mapUIMessagePartsToDBParts(message.parts as any[], messageId)
  const messageData = mapUIMessageToDBMessage({
    ...message,
    id: messageId,
    chatId
  } as any)

  await msgRef.set({
    id: messageId,
    chatId,
    role: messageData.role,
    metadata: messageData.metadata ?? null,
    createdAt: now,
    updatedAt: now,
    sequence: 1,
    parts: dbParts
  })

  perfTime('DB - createChatWithFirstMessageTransaction completed', dbStart)

  return {
    chat: {
      id: chatId,
      title: chatTitle.substring(0, 255),
      userId,
      visibility: 'private',
      createdAt: now
    },
    message: {
      id: messageId,
      chatId,
      role: messageData.role,
      createdAt: now,
      updatedAt: now,
      metadata: messageData.metadata ?? null
    }
  }
}

// Note: types are not re-exported from this `'use server'` module, as Next.js
// compiles type-only re-exports into server-reference registrations. Consumers
// should import `Feedback` directly from `@/lib/db/schema`.



