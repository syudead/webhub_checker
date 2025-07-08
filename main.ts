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

// Initialize KV store
const kv = await Deno.openKv();

const router = new Router();

// WebHub subscription
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
  
  // YouTube WebHub subscription request
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
    // Save to both KV and memory
    await kv.set(["subscriptions", subscription.id], subscription);
    subscriptions.push(subscription);
    ctx.response.body = { success: true, subscription };
  } else {
    ctx.response.status = 500;
    ctx.response.body = { error: "Failed to subscribe" };
  }
});

// WebHub notification reception
router.post("/webhook", async (ctx) => {
  const body = await ctx.request.body({ type: "text" }).value;
  
  // Parse XML (simple implementation)
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
    
    // Save to both KV and memory
    await kv.set(["notifications", notification.id], notification);
    notifications.unshift(notification);
    
    // Keep only latest 100 notifications
    if (notifications.length > 100) {
      const removedNotifications = notifications.splice(100);
      // Delete old notifications from KV as well
      for (const oldNotification of removedNotifications) {
        await kv.delete(["notifications", oldNotification.id]);
      }
    }
  }
  
  ctx.response.body = "OK";
});

// WebHub subscription verification
router.get("/webhook", (ctx) => {
  const challenge = ctx.request.url.searchParams.get("hub.challenge");
  if (challenge) {
    ctx.response.body = challenge;
  } else {
    ctx.response.body = "No challenge";
  }
});

// API to get notification list
router.get("/api/notifications", (ctx) => {
  ctx.response.body = notifications;
});

// API to get subscription list
router.get("/api/subscriptions", (ctx) => {
  ctx.response.body = subscriptions;
});

// Static file serving
router.get("/", async (ctx) => {
  const content = await Deno.readTextFile("./index.html");
  ctx.response.headers.set("Content-Type", "text/html");
  ctx.response.body = content;
});

// Data restoration at startup
async function initializeData() {
  console.log("Initializing data from KV store...");
  
  // Restore subscription data
  const subscriptionEntries = kv.list({ prefix: ["subscriptions"] });
  for await (const entry of subscriptionEntries) {
    const subscription = entry.value as Subscription;
    // Check expiration
    if (new Date(subscription.expiresAt) > new Date()) {
      subscriptions.push(subscription);
    } else {
      // Delete expired subscriptions
      await kv.delete(entry.key);
    }
  }
  
  // Restore notification data
  const notificationEntries = kv.list({ prefix: ["notifications"] });
  const tempNotifications: Notification[] = [];
  for await (const entry of notificationEntries) {
    tempNotifications.push(entry.value as Notification);
  }
  
  // Sort by received time (newest first)
  tempNotifications.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  
    // Keep only latest 100 notifications
  const keepNotifications = tempNotifications.slice(0, 100);
  notifications.push(...keepNotifications);
  
  // Delete old notifications exceeding 100 from KV
  if (tempNotifications.length > 100) {
    for (let i = 100; i < tempNotifications.length; i++) {
      await kv.delete(["notifications", tempNotifications[i].id]);
    }
  }
  
  console.log(`Restored ${subscriptions.length} subscriptions and ${notifications.length} notifications`);
}

// Execute data initialization
await initializeData();

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

const port = Number(Deno.env.get("PORT")) || 8000;
console.log(`Server running on port ${port}`);
await app.listen({ port });