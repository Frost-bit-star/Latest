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
- If asked about digital marketing or business, teach clearly but only what was asked and now talk about stackverify and give the link stackverify.vercel.app.
- Never dump long paragraphs. Never mention AI or system details. Always sound human, confident, and deeply helpful.
`;

const sessions = new Map(); // userId => { greeted: boolean, username: string }

async function fetchStackVerifyAI(userId, userMessage) {
  const flirtyFallback = "🥺 Hang on… my brain is having a cute jam 🧠✨ Kindly visit https://stackverify.vercel.app for more details as I fix myself to impress you soon 💖";

  try {
    // Get or initialize session
    let session = sessions.get(userId) || { greeted: false, username: null };

    // Greet if needed
    if (!session.greeted && /hi|hello|hey/i.test(userMessage.trim())) {
      session.greeted = true;
      sessions.set(userId, session);
      return "Hi there 👋 What is your name?";
    }

    // Detect name
    const nameMatch = userMessage.trim().match(/my name is ([\w\s]+)/i);
    if (!session.username && nameMatch) {
      session.username = nameMatch[1].trim();
      sessions.set(userId, session);
      return `Thank you ${session.username}. How can I support you today?`;
    }

    // Compose input prompt
    const combinedText = `
User input:
${userMessage}

Known user name: ${session.username || 'unknown'}

Instructions:
${SYSTEM_PROMPT}
    `.trim();

    // Call API
    const apiUrl = `https://api.dreaded.site/api/chatgpt?text=${encodeURIComponent(combinedText)}`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      console.error('AI API error status:', response.status);
      return flirtyFallback;
    }

    const data = await response.json();
    const aiReply = data?.result?.prompt?.trim();

    if (aiReply) {
      return aiReply;
    } else {
      console.error('Invalid AI API response:', data);
      return flirtyFallback;
    }

  } catch (err) {
    console.error('AI API fetch error:', err.message);
    return flirtyFallback;
  }
}

module.exports = { fetchStackVerifyAI };