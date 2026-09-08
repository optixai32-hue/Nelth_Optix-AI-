import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the modules before any imports
vi.mock('@/lib/firebase/admin', () => ({
  getDb: vi.fn()
}))

// Import after mocking
import { getDb } from '@/lib/firebase/admin'

import { getMessageFeedback, updateMessageFeedback } from '../feedback'

const mockGet = vi.fn()
const mockUpdate = vi.fn()
const mockColGroup = vi.fn()

function chain() {
  return {
    where: () => ({
      limit: () => ({ get: (...args: any[]) => mockGet(...args) })
    })
  }
}

describe('Feedback Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockColGroup.mockReturnValue(chain())
    vi.mocked(getDb).mockReturnValue({
      collectionGroup: (...args: any[]) => {
        mockColGroup(...args)
        return chain()
      }
    } as any)
  })

  describe('updateMessageFeedback', () => {
    it('should update message feedback successfully', async () => {
      const docRef = { update: mockUpdate }
      mockGet.mockResolvedValue({
        empty: false,
        docs: [{ ref: docRef, data: () => ({ metadata: {} }) }]
      })

      const result = await updateMessageFeedback('test-message-id', 1)

      expect(result).toEqual({ success: true })
      expect(mockColGroup).toHaveBeenCalledWith('messages')
      expect(mockUpdate).toHaveBeenCalledWith({
        metadata: { feedbackScore: 1 }
      })
    })

    it('should return error when message not found', async () => {
      mockGet.mockResolvedValue({ empty: true, docs: [] })

      const result = await updateMessageFeedback('non-existent-id', 1)

      expect(result).toEqual({
        success: false,
        error: 'Message not found'
      })
    })

    it('should handle errors gracefully', async () => {
      mockGet.mockRejectedValue(new Error('Database error'))

      const result = await updateMessageFeedback('test-message-id', -1)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Database error')
    })
  })

  describe('getMessageFeedback', () => {
    it('should retrieve feedback score successfully', async () => {
      mockGet.mockResolvedValue({
        empty: false,
        docs: [{ data: () => ({ metadata: { feedbackScore: 1 } }) }]
      })

      const result = await getMessageFeedback('test-message-id')

      expect(result).toBe(1)
    })

    it('should return null when message not found', async () => {
      mockGet.mockResolvedValue({ empty: true, docs: [] })

      const result = await getMessageFeedback('non-existent-id')

      expect(result).toBeNull()
    })

    it('should return null when no feedback score exists', async () => {
      mockGet.mockResolvedValue({
        empty: false,
        docs: [{ data: () => ({ metadata: {} }) }]
      })

      const result = await getMessageFeedback('test-message-id')

      expect(result).toBeNull()
    })

    it('should handle errors and return null', async () => {
      mockGet.mockRejectedValue(new Error('Database error'))

      const result = await getMessageFeedback('test-message-id')

      expect(result).toBeNull()
    })
  })
})
