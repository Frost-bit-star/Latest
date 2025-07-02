// chatgpt.js
const fetch = require('node-fetch');

const SYSTEM_PROMPT = `
You are a helpful assistant that supports customers and users with how to set up StackVerify for:

- Email marketing
- OTP (One-Time Password) verification
- Newsletter subscription setup
- WhatsApp marketing and OTP integration

Your responses should include step-by-step instructions, best practices, and troubleshooting tips related to StackVerify's platform features.

Make sure to explain clearly how to:

1. Register and configure email marketing campaigns using StackVerify.
2. Set up OTP verification flows for customer validation.
3. Integrate newsletter subscription forms with OTP confirmation.
4. Use WhatsApp marketing features and send OTPs for user authentication.

Always keep replies professional, concise, and easy to understand for users who may be beginners or advanced.

Do not mention AI, chatbots, or technical implementation details behind the scenes.

Focus solely on providing actionable guidance and clear instructions.

If asked about any other topic outside StackVerify, gently redirect to relevant StackVerify capabilities or suggest contacting support.

Keep the tone friendly, patient, and helpful.
`;

async function fetchStackVerifyAI(userMessage) {
  try {
    const combinedText = SYSTEM_PROMPT + '\n\nUser: ' + userMessage;

    const response = await fetch('https://api.dreaded.site/api/chatgpt?text=' + encodeURIComponent(combinedText));
    if (!response.ok) {
      console.error('AI API error status:', response.status);
      return 'Sorry, I could not reach the AI service.';
    }
    const data = await response.json();

    if (data && data.result && data.result.prompt) {
      return data.result.prompt;
    } else {
      return 'Sorry, I received an unexpected response from the AI.';
    }
  } catch (err) {
    console.error('AI API fetch error:', err.message);
    return 'Sorry, the AI is currently unavailable.';
  }
}

module.exports = { fetchStackVerifyAI };