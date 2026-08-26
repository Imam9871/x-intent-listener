import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

const STOPWORDS = new Set([
  "a","an","the","and","or","for","to","of","in","on","with",
  "someone","people","person","looking","need","needs","help",
  "please","who","is","are","i","we","you","me","my","can",
  "could","want","wants","find","posts","post","tweet","tweets",
  "x","twitter"
]);

const INTENT_TERMS = {
  video: [
    "ai video","video creation","text to video",
    "image to video","video generator","runway","veo","sora","kling"
  ],
  workflow: [
    "ai workflow","workflow","automation","agent",
    "n8n","make.com","zapier","pipeline"
  ],
  image: [
    "ai image","image generation","midjourney",
    "flux","stable diffusion","image generator"
  ],
  coding: [
    "coding","developer","bug","javascript",
    "typescript","python","api","sdk","code"
  ],
  design: [
    "design","ui","ux","figma","landing page","logo"
  ],
  writing: [
    "copywriting","writing","content","article","thread"
  ]
};

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function parseIntent(input) {
  const text = input.toLowerCase().trim();

  const tokens = tokenize(input)
    .filter(t => !STOPWORDS.has(t));

  const detected = [];

  for (const [intent, terms] of Object.entries(INTENT_TERMS)) {
    if (terms.some(term => text.includes(term))) {
      detected.push(intent);
    }
  }

  const quoted = [
    ...input.matchAll(/"([^"]+)"/g)
  ]
    .map(m => m[1].trim())
    .filter(Boolean);

  const keywords = [
    ...new Set([
      ...tokens,
      ...quoted.flatMap(tokenize)
    ])
  ].slice(0, 18);

  const expanded = [
    ...new Set([
      ...keywords,
      ...detected.flatMap(
        k => INTENT_TERMS[k].slice(0, 4)
      )
    ])
  ];

  const positive = expanded.slice(0, 12);

  const query = positive.length
    ? `(${positive.map(
        x => `"${x.replace(/"/g, "")}"`
      ).join(" OR ")}) -is:retweet`
    : "-is:retweet";

  return {
    original: input,
    intents: detected,
    keywords: positive,
    query
  };
}

function scorePost(post, parsed) {
  const text = (post.text || "").toLowerCase();

  let score = 0;

  for (const keyword of parsed.keywords) {
    if (text.includes(keyword.toLowerCase())) {
      score += 8;
    }
  }

  if (
    /\bhelp|looking for|need|recommend|anyone|how do i|can someone\b/i
      .test(text)
  ) {
    score += 12;
  }

  if (
    /\bhire|hiring|job|giveaway|airdrop|follow me|dm me\b/i
      .test(text)
  ) {
    score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

async function searchX(parsed, limit = 20) {
  const token = process.env.X_BEARER_TOKEN;

  if (!token || token.includes("PASTE_YOUR")) {
    return {
      configured: false,
      posts: [],
      query: parsed.query
    };
  }

  const params = new URLSearchParams({
    query: parsed.query,
    max_results: String(
      Math.min(100, Math.max(10, limit))
    ),
    "tweet.fields":
      "created_at,author_id,public_metrics,lang",
    expansions: "author_id",
    "user.fields":
      "name,username,profile_image_url,verified"
  });

  const response = await fetch(
    `https://api.x.com/2/tweets/search/recent?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body?.detail ||
      body?.title ||
      `X API error ${response.status}`
    );
  }

  const users = new Map(
    (body.includes?.users || [])
      .map(user => [user.id, user])
  );

  const posts = (body.data || [])
    .map(post => {
      const user = users.get(post.author_id) || {};

      const item = {
        id: post.id,
        text: post.text,
        created_at: post.created_at,

        author: {
          id: post.author_id,
          name: user.name || "Unknown",
          username: user.username || "unknown",
          profile_image_url:
            user.profile_image_url || "",
          verified: !!user.verified
        },

        metrics: post.public_metrics || {},

        url:
          `https://x.com/${user.username || "i"}/status/${post.id}`,

        lang: post.lang || ""
      };

      return {
        ...item,
        relevance: scorePost(item, parsed)
      };
    })
    .sort(
      (a, b) => b.relevance - a.relevance
    );

  return {
    configured: true,
    posts,
    query: parsed.query,
    result_count: posts.length
  };
}

app.post("/api/search", async (req, res) => {
  try {
    const input = String(
      req.body?.q || ""
    ).trim();

    if (!input) {
      return res.status(400).json({
        error:
          "Enter a natural-language intent or keywords."
      });
    }

    const parsed = parseIntent(input);

    const result = await searchX(
      parsed,
      Number(req.body?.limit || 20)
    );

    if (!result.configured) {
      result.demo = true;

      result.posts = [
        {
          id: "demo-1",
          text:
            "Looking for someone who can help me turn a product idea into an AI-generated video. Any tools or workflow recommendations?",
          created_at:
            new Date().toISOString(),

          author: {
            name: "Demo Builder",
            username: "demo_builder",
            profile_image_url: "",
            verified: false
          },

          metrics: {
            like_count: 18,
            reply_count: 6,
            repost_count: 2
          },

          url: "#",
          lang: "en",
          relevance: 92
        },

        {
          id: "demo-2",
          text:
            "Need an AI workflow that can automate short-form video creation from a script. What are you using?",
          created_at:
            new Date(Date.now() - 420000)
              .toISOString(),

          author: {
            name: "Demo Creator",
            username: "demo_creator",
            profile_image_url: "",
            verified: false
          },

          metrics: {
            like_count: 9,
            reply_count: 4,
            repost_count: 1
          },

          url: "#",
          lang: "en",
          relevance: 86
        },

        {
          id: "demo-3",
          text:
            "Trying different video generators. Would love recommendations for a reliable AI video tool.",
          created_at:
            new Date(Date.now() - 960000)
              .toISOString(),

          author: {
            name: "Demo User",
            username: "demo_user",
            profile_image_url: "",
            verified: false
          },

          metrics: {
            like_count: 5,
            reply_count: 2,
            repost_count: 0
          },

          url: "#",
          lang: "en",
          relevance: 78
        }
      ];
    }

    res.json({
      ...result,
      parsed
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/api/config", (_req, res) => {
  res.json({
    configured:
      !!process.env.X_BEARER_TOKEN &&
      !process.env.X_BEARER_TOKEN.includes(
        "PASTE_YOUR"
      )
  });
});

app.get("*", (_req, res) => {
  res.sendFile(
    new URL(
      "./public/index.html",
      import.meta.url
    ).pathname
  );
});

app.listen(PORT, () => {
  console.log(
    `X Intent Listener running on http://localhost:${PORT}`
  );
});
