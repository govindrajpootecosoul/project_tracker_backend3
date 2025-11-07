import axios from 'axios'

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

class MicrosoftGraphClient {
  private tenantId: string
  private clientId: string
  private clientSecret: string
  private organizerEmail: string
  private accessToken: string | null = null
  private tokenExpiry: number = 0

  constructor() {
    this.tenantId = process.env.TENANT_ID || ''
    this.clientId = process.env.CLIENT_ID || ''
    this.clientSecret = process.env.CLIENT_SECRET || ''
    this.organizerEmail = process.env.ORGANIZER_EMAIL || ''
  }

  private async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }

    // Get new access token using client credentials flow
    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`
    
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('scope', 'https://graph.microsoft.com/.default')
    params.append('grant_type', 'client_credentials')

    try {
      const response = await axios.post<TokenResponse>(tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      this.accessToken = response.data.access_token
      // Set expiry to 5 minutes before actual expiry to be safe
      this.tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000
      
      return this.accessToken
    } catch (error: any) {
      console.error('Error getting access token:', error.response?.data || error.message)
      throw new Error('Failed to get access token from Microsoft')
    }
  }

  async sendEmail(to: string | string[], cc: string | string[] | null, subject: string, body: string): Promise<void> {
    try {
      const accessToken = await this.getAccessToken()
      
      // Ensure arrays for recipients
      const toRecipients = Array.isArray(to) ? to : [to]
      const ccRecipients = cc ? (Array.isArray(cc) ? cc : [cc]) : []

      const emailPayload = {
        message: {
          subject: subject,
          body: {
            contentType: 'HTML',
            content: body,
          },
          toRecipients: toRecipients.map((email) => ({
            emailAddress: {
              address: email,
            },
          })),
          ...(ccRecipients.length > 0 && {
            ccRecipients: ccRecipients.map((email) => ({
              emailAddress: {
                address: email,
              },
            })),
          }),
        },
        saveToSentItems: true,
      }

      const graphUrl = `https://graph.microsoft.com/v1.0/users/${this.organizerEmail}/sendMail`
      
      await axios.post(graphUrl, emailPayload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      console.log(`Email sent successfully to ${toRecipients.join(', ')}`)
    } catch (error: any) {
      console.error('Error sending email via Microsoft Graph:', error.response?.data || error.message)
      throw new Error(`Failed to send email: ${error.response?.data?.error?.message || error.message}`)
    }
  }
}

export const microsoftGraphClient = new MicrosoftGraphClient()


