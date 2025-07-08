import { Application, Router } from "oak";
import { serveStatic } from "std/http/file_server.ts";

interface Notification {
  id: string;
  channelId: string;
  videoId: string;
  title: string;
  publishedAt: string;
  channelTitle: string;
  receivedAt: string;
}

interface Subscription {
  id: string;
  channelId: string;
  channelTitle: string;
  hubTopic: string;
  leaseSeconds: number;
  expiresAt: string;
  createdAt: string;
}

const notifications: Notification[] = [];
const subscriptions: Subscription[] = [];

const router = new Router();

// WebHub購読
router.post("/subscribe", async (ctx) => {
  const body = await ctx.request.body({ type: "json" }).value;
  const { channelId, channelTitle } = body;
  
  const hubTopic = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;
  const callbackUrl = `${ctx.request.url.origin}/webhook`;
  
  const subscription: Subscription = {
    id: crypto.randomUUID(),
    channelId,
    channelTitle,
    hubTopic,
    leaseSeconds: 432000, // 5 days
    expiresAt: new Date(Date.now() + 432000 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  };
  
  // YouTube WebHub購読リクエスト
  const subscribeResponse = await fetch("https://pubsubhubbub.appspot.com/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      "hub.callback": callbackUrl,
      "hub.topic": hubTopic,
      "hub.verify": "sync",
      "hub.mode": "subscribe",
      "hub.lease_seconds": "432000"
    })
  });
  
  if (subscribeResponse.ok) {
    subscriptions.push(subscription);
    ctx.response.body = { success: true, subscription };
  } else {
    ctx.response.status = 500;
    ctx.response.body = { error: "Failed to subscribe" };
  }
});

// WebHub通知受信
router.post("/webhook", async (ctx) => {
  const body = await ctx.request.body({ type: "text" }).value;
  
  // XMLをパース（簡単な実装）
  const videoIdMatch = body.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
  const titleMatch = body.match(/<title>([^<]+)<\/title>/);
  const channelIdMatch = body.match(/<yt:channelId>([^<]+)<\/yt:channelId>/);
  const publishedMatch = body.match(/<published>([^<]+)<\/published>/);
  const channelTitleMatch = body.match(/<name>([^<]+)<\/name>/);
  
  if (videoIdMatch && titleMatch && channelIdMatch) {
    const notification: Notification = {
      id: crypto.randomUUID(),
      channelId: channelIdMatch[1],
      videoId: videoIdMatch[1],
      title: titleMatch[1],
      publishedAt: publishedMatch?.[1] || new Date().toISOString(),
      channelTitle: channelTitleMatch?.[1] || "Unknown Channel",
      receivedAt: new Date().toISOString()
    };
    
    notifications.unshift(notification);
    
    // 最新100件のみ保持
    if (notifications.length > 100) {
      notifications.splice(100);
    }
  }
  
  ctx.response.body = "OK";
});

// WebHub購読確認
router.get("/webhook", (ctx) => {
  const challenge = ctx.request.url.searchParams.get("hub.challenge");
  if (challenge) {
    ctx.response.body = challenge;
  } else {
    ctx.response.body = "No challenge";
  }
});

// 通知一覧取得API
router.get("/api/notifications", (ctx) => {
  ctx.response.body = notifications;
});

// 購読一覧取得API
router.get("/api/subscriptions", (ctx) => {
  ctx.response.body = subscriptions;
});

// 静的ファイル配信
router.get("/", async (ctx) => {
  const content = await Deno.readTextFile("./index.html");
  ctx.response.headers.set("Content-Type", "text/html");
  ctx.response.body = content;
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

const port = Number(Deno.env.get("PORT")) || 8000;
console.log(`Server running on port ${port}`);
await app.listen({ port });