"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.microsoftGraphClient = void 0;
const axios_1 = __importDefault(require("axios"));
class MicrosoftGraphClient {
    constructor() {
        this.accessToken = null;
        this.tokenExpiry = 0;
        this.tenantId = process.env.TENANT_ID || '';
        this.clientId = process.env.CLIENT_ID || '';
        this.clientSecret = process.env.CLIENT_SECRET || '';
        this.organizerEmail = process.env.ORGANIZER_EMAIL || '';
    }
    async getAccessToken() {
        // Check if we have a valid token
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }
        // Get new access token using client credentials flow
        const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
        const params = new URLSearchParams();
        params.append('client_id', this.clientId);
        params.append('client_secret', this.clientSecret);
        params.append('scope', 'https://graph.microsoft.com/.default');
        params.append('grant_type', 'client_credentials');
        try {
            const response = await axios_1.default.post(tokenUrl, params.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            });
            this.accessToken = response.data.access_token;
            // Set expiry to 5 minutes before actual expiry to be safe
            this.tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;
            return this.accessToken;
        }
        catch (error) {
            console.error('Error getting access token:', error.response?.data || error.message);
            throw new Error('Failed to get access token from Microsoft');
        }
    }
    async sendEmail(to, cc, subject, body) {
        try {
            const accessToken = await this.getAccessToken();
            // Ensure arrays for recipients
            const toRecipients = Array.isArray(to) ? to : [to];
            const ccRecipients = cc ? (Array.isArray(cc) ? cc : [cc]) : [];
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
            };
            const graphUrl = `https://graph.microsoft.com/v1.0/users/${this.organizerEmail}/sendMail`;
            await axios_1.default.post(graphUrl, emailPayload, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            });
            console.log(`Email sent successfully to ${toRecipients.join(', ')}`);
        }
        catch (error) {
            console.error('Error sending email via Microsoft Graph:', error.response?.data || error.message);
            throw new Error(`Failed to send email: ${error.response?.data?.error?.message || error.message}`);
        }
    }
}
exports.microsoftGraphClient = new MicrosoftGraphClient();
