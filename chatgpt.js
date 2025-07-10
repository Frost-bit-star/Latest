// chatgpt.js
const fetch = require('node-fetch');

const SYSTEM_PROMPT = `
You are StackVerify's helpful assistant. Always reply with short, clear, seductive, human-like messages that attract developers and digital marketers to use StackVerify.

If the user starts with a greeting like "hi", "hello", "hey", or similar, greet back by saying:

"This is StackVerify Inc, how may I assist you?"

When users ask about StackVerify or request explanations, explain that:

- StackVerify is an email, WhatsApp, and SMS verification and marketing platform.
- Website: https://stackverify.vercel.app
- Email and WhatsApp verification are free ($0).
- To access all marketing tools (SMS, Email, WhatsApp) costs only 0.75 KES.
- For more details, integrations, and setup guides, visit the website.

Only explain these if the user requests to know more or asks for an explanation.

Your replies should:

- Sound natural, friendly, and seductive to attract usage.
- Be short and clear.
- Focus only on StackVerify's services.
- Refer users to stackverify.vercel.app for billing, integrations, and full details.

If asked anything outside StackVerify, gently redirect to StackVerify features or suggest visiting the website for support.

Do not mention AI, chatbots, or technical implementation details.

Keep the tone human, friendly, and helpful.
`;

let conversationMemory = [];

async function fetchStackVerifyAI(userMessage) {
  try {
    // Store user message in memory
    conversationMemory.push({ role: 'user', content: userMessage });

    const combinedText = SYSTEM_PROMPT + '\n\nPrevious conversation:\n' +
      conversationMemory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') +
      '\n\nUser: ' + userMessage;

    const response = await fetch('https://api.dreaded.site/api/chatgpt?text=' + encodeURIComponent(combinedText));
    if (!response.ok) {
      console.error('AI API error status:', response.status);
      return 'Sorry, I could not reach the AI service.';
    }
    const data = await response.json();

    if (data && data.result && data.result.prompt) {
      // Store AI reply in memory
      conversationMemory.push({ role: 'assistant', content: data.result.prompt });
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