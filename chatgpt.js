// fetchStackVerifyAI.js

const fetch = require('node-fetch');

const SYSTEM_PROMPT = `
You are StackVerify's trusted assistant with over 10 years of experience as an executive assistant and business professor.

Instructions:
- Read and understand the user's input carefully.
- If you don't know the user's name, politely ask for it once and use it in future replies.
- Reply ONLY based on what the user specifically asks. No extra suggestions unless requested.
- Keep replies short, warm, natural, and human-like, addressing the user by name if known.
- Do NOT mention StackVerify at all unless the user specifically asks about it.
- If asked about website building or online stores, mention Trover (https://trover.42web.io/partner.php) only if the user requests it.
- If asked about digital marketing or business, teach clearly and now make sure you suggest  stackverify and give the link stackverify.vercel.app.
- Never dump long paragraphs. Never mention AI or system details. Always sound human, confident, and deeply helpful.
`;

const users = new Map(); // userId -> username

async function fetchStackVerifyAI(userId, userMessage) {
  const flirtyFallback = "🥺 Hang on… my brain is having a cute jam 🧠✨ Kindly visit https://stackverify.vercel.app for more details as I fix myself to impress you soon 💖";

  try {
    // Validate inputs
    if (!userId || typeof userId !== 'string') {
      console.error('❌ Invalid userId input:', userId);
      return flirtyFallback;
    }

    if (!userMessage || typeof userMessage !== 'string') {
      console.error('❌ Invalid userMessage input:', userMessage);
      return flirtyFallback;
    }

    console.log('📥 Processing AI call with userId:', userId, 'userMessage:', userMessage);

    // Get or initialize username
    let username = users.get(userId) || 'unknown';

    // Detect name input safely
    const nameMatch = userMessage.match(/my name is ([\w\s]+)/i);
    if (!users.get(userId) && nameMatch && nameMatch[1]) {
      username = nameMatch[1].trim();
      users.set(userId, username);
      console.log(`👤 New username saved for ${userId}: ${username}`);
      return `Thank you ${username}. How can I support you today?`;
    }

    // Compose input with system prompt
    const combinedText = `
User input:
${userMessage}

Known user name: ${username}

Instructions:
${SYSTEM_PROMPT}
    `;

    const apiUrl = 'https://api.dreaded.site/api/chatgpt?text=' + encodeURIComponent(combinedText);
    console.log('📡 Sending request to:', apiUrl);

    const response = await fetch(apiUrl, { method: 'GET' });
    console.log('🔎 Response status:', response.status);

    if (!response.ok) {
      console.error('AI API error status:', response.status);
      return flirtyFallback;
    }

    const data = await response.json();
    console.log('📝 Full API response:', JSON.stringify(data, null, 2));

    const aiReply = data?.result?.prompt;
    console.log('✅ Extracted AI reply:', aiReply);

    if (aiReply && typeof aiReply === 'string') {
      return aiReply.trim();
    } else {
      console.error('❌ No valid aiReply found in data.');
      return flirtyFallback;
    }

  } catch (err) {
    console.error('🔥 AI API fetch error:', err.message);
    return flirtyFallback;
  }
}

module.exports = { fetchStackVerifyAI };