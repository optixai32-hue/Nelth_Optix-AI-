'use server'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { generateId } from '@/lib/db/schema'
import { getDb } from '@/lib/firebase/admin'
import { hasFirebaseConfig } from '@/lib/firebase/config'

function firestore() {
  return getDb()
}

export async function submitFeedback(data: {
  sentiment: 'positive' | 'neutral' | 'negative'
  message: string
  pageUrl: string
}) {
  try {
    // Get current user if logged in
    let userId: string | undefined
    let userEmail: string | undefined

    if (hasFirebaseConfig()) {
      const user = await getCurrentUser()
      userId = user?.uid
      userEmail = user?.email
    }

    // Get user agent from headers
    const { headers } = await import('next/headers')
    const headersList = await headers()
    const userAgent = headersList.get('user-agent') || undefined

    // Save to Firestore
    const id = generateId()
    await firestore()
      .collection('feedback')
      .doc(id)
      .set({
        id,
        userId: userId ?? null,
        sentiment: data.sentiment,
        message: data.message,
        pageUrl: data.pageUrl,
        userAgent: userAgent ?? null,
        createdAt: new Date()
      })

    // Send to Slack if webhook URL is configured
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL
    if (slackWebhookUrl) {
      try {
        const sentimentEmoji = {
          positive: '😊',
          neutral: '😐',
          negative: '😞'
        }[data.sentiment]

        const slackMessage = {
          text: `New feedback received ${sentimentEmoji}`,
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: `New Feedback ${sentimentEmoji}`
              }
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: `*Sentiment:*\n${data.sentiment}`
                },
                {
                  type: 'mrkdwn',
                  text: `*From:*\n${userEmail || 'Anonymous'}`
                }
              ]
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Message:*\n${data.message}`
              }
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `Page: ${data.pageUrl} | Time: ${new Date().toISOString()}`
                }
              ]
            }
          ]
        }

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)

        try {
          await fetch(slackWebhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(slackMessage),
            signal: controller.signal
          })
        } finally {
          clearTimeout(timeout)
        }
      } catch (slackError) {
        console.error('Failed to send Slack notification:', slackError)
      }
    }

    return { success: true, id }
  } catch (error) {
    console.error('Failed to save feedback:', error)
    return { success: false, error: 'Failed to save feedback' }
  }
}
