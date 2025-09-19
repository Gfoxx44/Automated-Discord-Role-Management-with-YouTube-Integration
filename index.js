// --- START OF FILE actualbot.js ---

require('dotenv').config(); // Line 1
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, Collection, WebhookClient } = require('discord.js');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { google } = require('googleapis');

// --- Environment Variables ---
const TOKEN = process.env.DISCORD_TOKEN;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const ADMIN_PASS_ROLE_ID = process.env.ADMIN_PASS_ROLE_ID;
const BANNED_FROM_VERIFICATION_ROLE_ID = process.env.BANNED_FROM_VERIFICATION_ROLE_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const LOG_WEBHOOK_URL = process.env.LOG_WEBHOOK_URL;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YT_VIDEO_IDS_STRING = process.env.YT_VIDEO_IDS || '';
const PASS_CHANNEL_ID = process.env.PASS_CHANNEL_ID;
const PASS_COOLDOWN_MS = parseInt(process.env.PASS_COOLDOWN_MS || '3600000', 10);
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS || '90000', 10);
const CHECK_DURATION_MS = parseInt(process.env.CHECK_DURATION_MS || '600000', 10);
const PING_TIMEOUT_DURATION_MS = parseInt(process.env.PING_TIMEOUT_DURATION_MS || '1800000', 10);
const PING_WARN_RESET_MS = parseInt(process.env.PING_WARN_RESET_MS || '3600000', 10);
// --- Inactivity Check ---
const INACTIVITY_THRESHOLD_DAYS = parseInt(process.env.INACTIVITY_THRESHOLD_DAYS || '3', 10);
const INACTIVITY_CHECK_INTERVAL_HOURS = parseInt(process.env.INACTIVITY_CHECK_INTERVAL_HOURS || '6', 10);
const INACTIVITY_CHECK_INTERVAL_MS = INACTIVITY_CHECK_INTERVAL_HOURS * 60 * 60 * 1000;
const PRIMARY_GUILD_ID = process.env.PRIMARY_GUILD_ID;

// --- Filenames ---
const ADMIN_PASS_FILE = 'admin_pass.txt';
const VERIFIED_USERS_FILE = 'verified_users.json';
const BANNED_USERS_FILE = 'banned_users.json';
const USED_PASS_CODES_FILE = 'used_pass_phrase_ids.json';

// --- Rule Message Details ---
const RULE_CHANNEL_ID = "1226512104761331782";
const RULE_MESSAGE_ID = "1356635730582962328";

// --- Auto-Reply for Unverified Users ---
const AUTO_REPLY_UNVERIFIED_CHANNEL_ID = process.env.UNVERIFIED_CHANNEL_ID;
const AUTO_REPLY_UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID;
const AUTO_REPLY_VERIFICATION_CHANNEL_ID = process.env.VERIFICATION_PROCESS_CHANNEL_ID;

// --- ARK Server Access Settings ---
const ACTIVE_ARK_PLAYERS_FILE = process.env.ACTIVE_ARK_PLAYERS_FILE || 'active_ark_players.json';
const ARK_JOIN_COOLDOWN_MS = parseInt(process.env.ARK_JOIN_COOLDOWN_MS || '60000', 10); // 1 min
const ARK_PASS_COMMAND_CHANNEL_ID = process.env.ARK_PASS_COMMAND_CHANNEL_ID; // Channel for !joinark
const ARK_ACTIVITY_CHECK_DURATION_MS = parseInt(process.env.ARK_ACTIVITY_CHECK_DURATION_MS || '1800000', 10); // 30 min
const ARK_ACTIVITY_CONFIRM_TIMEOUT_MS = parseInt(process.env.ARK_ACTIVITY_CONFIRM_TIMEOUT_MS || '300000', 10); // 5 min
const ARK_ACTIVITY_STRIKE_LIMIT = parseInt(process.env.ARK_ACTIVITY_STRIKE_LIMIT || '3', 10);
const ARK_REVERIFY_COOLDOWN_HOURS = parseInt(process.env.ARK_REVERIFY_COOLDOWN_HOURS || '24', 10);


// --- Check Environment Variables ---
if (!TOKEN || !ADMIN_ROLE_ID || !ADMIN_PASS_ROLE_ID || !LOG_CHANNEL_ID || !LOG_WEBHOOK_URL || !PASS_CHANNEL_ID) { console.error("MISSING BASE ENV VARS! Check: TOKEN, ADMIN_ROLE_ID, ADMIN_PASS_ROLE_ID, LOG_CHANNEL_ID, LOG_WEBHOOK_URL, PASS_CHANNEL_ID"); process.exit(1); }
if (!YOUTUBE_API_KEY) { console.error("MISSING YOUTUBE_API_KEY!"); process.exit(1); }
const YT_VIDEO_IDS = YT_VIDEO_IDS_STRING.split(',').map(id => id.trim()).filter(id => id);
if (YT_VIDEO_IDS.length === 0) { console.error("MISSING/INVALID YT_VIDEO_IDS!"); process.exit(1); }
if (!PRIMARY_GUILD_ID) { console.error("MISSING PRIMARY_GUILD_ID! This is required for inactivity removal and rule message linking."); process.exit(1); }
if (!BANNED_FROM_VERIFICATION_ROLE_ID) { console.warn("WARN: BANNED_FROM_VERIFICATION_ROLE_ID (from .env) is not set. The check to prevent users with this role from verifying will be skipped.");}
if (!AUTO_REPLY_UNVERIFIED_CHANNEL_ID || !AUTO_REPLY_UNVERIFIED_ROLE_ID || !AUTO_REPLY_VERIFICATION_CHANNEL_ID) { console.warn("WARN: One or more auto-reply ENV VARS are not set. Auto-reply for unverified users will be disabled.");}
if (!ARK_PASS_COMMAND_CHANNEL_ID) { console.warn("WARN: ARK_PASS_COMMAND_CHANNEL_ID is not set in .env. The !joinark command can be used in any channel by eligible users if not restricted by bot permissions."); }


// --- Initialize YouTube API Client ---
const youtube = google.youtube({ version: 'v3', auth: YOUTUBE_API_KEY });

// --- Initialize Discord Client ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMessageReactions
    ],
    partials: ['MESSAGE', 'CHANNEL', 'REACTION', 'USER']
});

// --- In-memory Storage ---
let verifiedUsers = {}; let bannedUsers = {}; let usedPassPhraseIDs = new Set();
let passCooldowns = new Collection(); let pendingPassChecks = new Collection(); let adminPingTracker = new Collection();
let inactivityCheckIntervalId = null;
let activeArkPlayers = {}; // For tracking players who requested ARK server pass
let arkJoinCooldowns = new Collection(); // Cooldowns for !joinark
let arkActivityCheckTimeouts = new Collection(); // Stores { userId: timeoutId }

// --- Phrase Pools (English Only) - MASSIVELY EXPANDED ---
const sentenceStarters = [
  // Original
  "Wow,", "Hey,", "Just watched this,", "Honestly,", "Okay,", "Checking this out,", "This is", "I think this is",
  "Definitely", "Just saw this and", "My thoughts exactly:", "Impressive stuff,", "Really enjoying this,", "Great to see",
  "Always appreciate", "Fantastic to discover", "Wanted to say,", "I'm new here, but", "As a long-time viewer,",
  "Just dropping by to mention,",
  // New additions
  "Awesome!,", "Yo,", "Just stumbled upon this,", "This just popped up in my recommendations,", "I'm so glad I found this,",
  "Let me just say,", "First-time commenter here,", "Not gonna lie,", "Okay, this is epic.", "Finally, someone talking about this!",
  "Came here to say,", "Seriously,", "Alright,", "This just made my entire day,", "The algorithm has blessed me today,",
  "Been a silent watcher for a while, but I had to comment on this one.", "Okay, hold up,", "I rarely comment, but",
  "Absolutely had to chime in and say,", "Look,"
];

const sentenceAdjectives = [
  // Original
  "amazing", "fantastic", "incredible", "really cool", "great", "awesome", "interesting", "superb", "quality",
  "top-notch", "brilliant", "excellent", "wonderful", "outstanding", "remarkable", "engaging", "insightful",
  "creative", "well-made", "polished", "professional", "unique", "fresh", "inspiring", "valuable", "helpful",
  "thought-provoking", "entertaining", "captivating", "masterful", "super",
  // New additions
  "phenomenal", "mind-blowing", "flawless", "next-level", "informative", "hilarious", "beautifully shot", "genius",
  "underrated", "refreshing", "authentic", "genuine", "impactful", "powerful", "charming", "well-researched",
  "articulate", "so good", "fire", "dope", "immaculate", "crisp", "stellar", "legendary", "unmatched",
  "heartwarming", "motivating", "reassuring", "relatable", "charismatic", "game-changing", "gorgeous", "first-class"
];

const sentenceNouns = [
  // Original
  "video", "work", "content", "stuff", "job", "perspective", "upload", "creation", "piece", "production", "effort",
  "presentation", "insight", "material", "clip", "episode", "segment", "approach", "style", "artistry", "skill",
  "dedication", "message", "topic",
  // New additions
  "masterpiece", "explanation", "breakdown", "analysis", "series", "tutorial", "vlog", "film", "art", "execution",
  "delivery", "commentary", "story", "gem", "review", "deep-dive", "take", "vibe", "channel", "vision", "guide",
  "cinematography", "commentary"
];

const sentenceConnectors = [
  // Original
  "and I think", "because it's", "especially the", "which is truly", "and it shows in the", "it's clear that the",
  "I can tell the", "and I love the", "because of the", "and I wanted to share that the",
  // New additions
  "I'm really impressed by", "what stands out to me is", "I especially appreciate", "and the way you explained",
  "it's obvious that", "you can really feel the", "and I just have to mention the", "what a great take on the",
  "and honestly,", "plus, the way that", "it's the little things like", "I'm genuinely blown away by",
  "and I've gotta say,", "what really got me was"
];

const sentenceQualities = [
  // Original
  "attention to detail", "passion behind it", "unique angle", "clear explanation", "visuals are stunning",
  "editing is crisp", "narration is on point", "message resonates", "topic is very relevant", "way it's presented",
  "effort put into it", "overall vibe", "storytelling is great", "production value",
  // New additions
  "sound design is perfect", "pacing is excellent", "authenticity shines through", "depth of the research",
  "honesty and transparency", "courage to tackle this topic", "camera work is cinematic", "color grading is beautiful",
  "script is so well-written", "energy you bring", "calm delivery style", "humor is fantastic", "B-roll is gorgeous",
  "flow of the narrative", "vulnerability shown here", "level of expertise", "graphic design is clean",
  "choice of music", "consistency of your uploads", "community you've built"
];

const sentenceEnders = [
  // Original
  "keep it up!", "sharing this!", "subscribed!", "well done!", "impressive!", "thanks for sharing!",
  "more like this please!", "two thumbs up!", "looking forward to more!", "you've earned a new fan!", "highly recommend!",
  "absolutely brilliant!", "truly inspiring!", "made my day!", "kudos to the creator!", "a must-watch!",
  "will be back for more!", "excellent work!",
  // New additions
  "You've got a new subscriber!", "Can't wait for the next video!", "Thanks for making this!", "This was exactly what I needed to see today.",
  "Keep up the fantastic work!", "Smashing the like button!", "Instant subscribe.", "Pure gold.", "You deserve way more views.",
  "Sending this to my friends.", "Legend!", "Massive respect.", "Take a bow!", "Game-changer.", "This is why I'm subscribed.",
  "You never disappoint!", "This helped me a lot, thank you.", "This is it, chief."
];
// --- END Phrase Pools ---

// --- Data Handling ---
async function loadData() {
    console.log("[Data] Loading...");
    try {
        if(fsSync.existsSync(VERIFIED_USERS_FILE)){ verifiedUsers = JSON.parse(await fs.readFile(VERIFIED_USERS_FILE,'utf8')); console.log(`[Data] ${Object.keys(verifiedUsers).length} verified loaded.`); } else { console.log(`[Data] ${VERIFIED_USERS_FILE} not found.`); verifiedUsers = {}; }
        if(fsSync.existsSync(BANNED_USERS_FILE)){ bannedUsers = JSON.parse(await fs.readFile(BANNED_USERS_FILE,'utf8')); console.log(`[Data] ${Object.keys(bannedUsers).length} banned loaded.`); } else { console.log(`[Data] ${BANNED_USERS_FILE} not found.`); bannedUsers = {}; }
        if(fsSync.existsSync(USED_PASS_CODES_FILE)){ const ids = JSON.parse(await fs.readFile(USED_PASS_CODES_FILE,'utf8')); usedPassPhraseIDs = new Set(ids); console.log(`[Data] ${usedPassPhraseIDs.size} used phrase IDs loaded.`); } else { console.log(`[Data] ${USED_PASS_CODES_FILE} not found.`); usedPassPhraseIDs = new Set(); }
        if(fsSync.existsSync(ACTIVE_ARK_PLAYERS_FILE)){ activeArkPlayers = JSON.parse(await fs.readFile(ACTIVE_ARK_PLAYERS_FILE,'utf8')); console.log(`[Data] ${Object.keys(activeArkPlayers).length} active ARK players loaded.`); } else { console.log(`[Data] ${ACTIVE_ARK_PLAYERS_FILE} not found.`); activeArkPlayers = {}; }
        passCooldowns.clear(); pendingPassChecks.clear(); adminPingTracker.clear(); arkJoinCooldowns.clear();
        arkActivityCheckTimeouts.forEach(timeoutId => clearTimeout(timeoutId)); arkActivityCheckTimeouts.clear();
        console.log("[Data] Load complete.");
    } catch(e) { console.error('[Data] LOAD ERROR:',e.message); verifiedUsers = {}; bannedUsers = {}; usedPassPhraseIDs = new Set(); activeArkPlayers = {}; }
}
async function saveData() { try{ await Promise.all([ fs.writeFile(VERIFIED_USERS_FILE, JSON.stringify(verifiedUsers,null,2), 'utf8'), fs.writeFile(BANNED_USERS_FILE, JSON.stringify(bannedUsers,null,2), 'utf8') ]); } catch(e) { console.error('[Data] Save user/ban error:', e.message); await logAction(`🚨 ERROR: Save user/ban fail! ${e.message}`); } }
async function saveUsedPhraseIDs() { try{ const ids = Array.from(usedPassPhraseIDs); await fs.writeFile(USED_PASS_CODES_FILE, JSON.stringify(ids,null,2), 'utf8'); } catch(e) { console.error('[Data] Save phrase IDs err:', e.message); await logAction(`🚨 CRITICAL: Save phrase IDs fail! ${e.message}`); } }
async function saveActiveArkPlayers() { try { await fs.writeFile(ACTIVE_ARK_PLAYERS_FILE, JSON.stringify(activeArkPlayers, null, 2), 'utf8'); } catch (e) { console.error('[Data] Save active ARK players error:', e.message); await logAction(`🚨 ERROR: Save active ARK players fail! ${e.message}`); } }

// --- Logging ---
async function logAction(action) { if(!LOG_WEBHOOK_URL){ console.warn('[LOG] No Webhook.'); console.log(`[LOG] ${action}`); return; } try{ const webhook = new WebhookClient({url: LOG_WEBHOOK_URL}); const messageContent = `\`[${new Date().toLocaleString('en-US')}]\` ${action}`; const truncatedMessage = messageContent.length > 2000 ? messageContent.slice(0,1997) + '...' : messageContent; await webhook.send({content: truncatedMessage, username:'Bot-Logger'}); } catch(e) { console.error('[WEBHOOK] Log error:', {message: e.message}); try{ const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(()=>null); if(logChannel?.isTextBased()) await logChannel.send(`🚨 Webhook Fail! ${e.message}\nAction:${action.slice(0,1000)}`); } catch(e2){ console.error('[LOG] Chan report fail:', e2.message); } } }

// --- Helpers ---
function generateUniqueInternalID() { const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; const len=7; let attempts = 0; while(attempts < 100) { let code = 'ID-'; for(let i=0; i < len; i++) code += chars.charAt(Math.floor(Math.random() * chars.length)); if(!usedPassPhraseIDs.has(code)) return code; attempts++; } console.error("Failed unique ID gen!"); logAction("🚨 CRITICAL: Failed unique ID gen!"); return `ID-fallback-${Date.now().toString().slice(-6)}`; }
function generateUniqueSentence() { const structureType = Math.floor(Math.random() * 4); const s = () => sentenceStarters[Math.floor(Math.random() * sentenceStarters.length)]; const a = () => sentenceAdjectives[Math.floor(Math.random() * sentenceAdjectives.length)]; const n = () => sentenceNouns[Math.floor(Math.random() * sentenceNouns.length)]; const e = () => sentenceEnders[Math.floor(Math.random() * sentenceEnders.length)]; const c = () => sentenceConnectors.length > 0 ? sentenceConnectors[Math.floor(Math.random() * sentenceConnectors.length)] : "it's"; const q = () => sentenceQualities.length > 0 ? sentenceQualities[Math.floor(Math.random() * sentenceQualities.length)] : "great"; let sentence; switch (structureType) { case 0: sentence = `${s()} ${a()} ${n()}, ${e()}`; break; case 1: sentence = `${s()} this ${n()} is really ${a()}, ${e()}`; break; case 2: sentence = `${s()} ${a()} ${n()}, ${c()} the ${q()}, ${e()}`; break; case 3: let adj = a(); sentence = `${adj.charAt(0).toUpperCase() + adj.slice(1)} ${n()}! ${s()} ${e()}`; break; default: sentence = `${s()} ${a()} ${n()}, ${e()}`; break; } return sentence; }
async function checkYouTubeCommentExact(videoId, requiredSentence) { let nextPageToken = null; let found = false; let page = 1; const maxPages = 5; try{ do { const res = await youtube.commentThreads.list({ part: ['snippet'], videoId: videoId, maxResults: 100, order: 'time', pageToken: nextPageToken || undefined, }); if(res.data.items?.length > 0){ for(const item of res.data.items){ const commentText = item.snippet?.topLevelComment?.snippet?.textDisplay; if(commentText === requiredSentence){ console.log(`[YT Check Exact] MATCH FOUND: "${commentText}"`); found = true; break; } } } if(found) break; nextPageToken = res.data.nextPageToken; page++; } while(nextPageToken && page <= maxPages); if(!found) console.log(`[YT Check Exact] Sentence "${requiredSentence}" NOT FOUND after ${page-1} pages.`); return found; } catch(e) { console.error(`[YT API Error Exact] Vid ${videoId}, Sentence "${requiredSentence}":`, e.response?.data?.error || e.message); throw e; } }
async function startCommentCheck(userId, dmChannelId, task) { const { videoId, requiredSentence, internalCode, startTime } = task; const user = await client.users.fetch(userId).catch(() => null); const dmChannel = await client.channels.fetch(dmChannelId).catch(() => null); console.log(`[Auto Check] Start ${user?.tag || userId} - Task ${internalCode}`); async function performCheck(attempt = 1) { if (!pendingPassChecks.has(userId) || pendingPassChecks.get(userId)?.internalCode !== internalCode) { console.log(`[Auto Check] Task ${internalCode} no longer pending. Stop.`); return; } const timeElapsed = Date.now() - startTime; if (timeElapsed > CHECK_DURATION_MS) { console.log(`[Auto Check] Timeout ${user?.tag || userId} - Task ${internalCode}`); await logAction(`⏱️ ${user?.tag || userId}'s check timed out (Task ${internalCode}, Vid ${videoId}).`); if (dmChannel) { try { await dmChannel.send(`⏰ Auto-check failed to find comment within ${CHECK_DURATION_MS / 60000} minutes. Check comment/video & try \`!pass\` again later.`); } catch(e){ console.error("Fail timeout DM", e);} } pendingPassChecks.delete(userId); return; } console.log(`[Auto Check] Attempt ${attempt} for ${user?.tag || userId} (Task ${internalCode})`); try { const found = await checkYouTubeCommentExact(videoId, requiredSentence); if (found) { console.log(`[Auto Check] SUCCESS ${user?.tag || userId} - Task ${internalCode}`); await logAction(`✅ SUCCESS: Auto check found comment for ${user?.tag || userId} (Task ${internalCode}, Vid ${videoId}). Sending pass.`); try { const pass = await fs.readFile(ADMIN_PASS_FILE, 'utf8'); if(dmChannel) { await dmChannel.send(`${pass}`); const arkPassInfoMessage = `\n\n--- :point_up_2: :point_up_2: :point_up_2: PASS ARK Server Access ---\n` + `To get access to the ARK game server, you must use specific commands:\n` + `1. When you want to join the ARK server, type \`!joinark\` in the <#${ARK_PASS_COMMAND_CHANNEL_ID || 'designated-ark-channel'}> channel.\n` + `   This will mark you as "online".\n` + `2. When you are done playing and leave the ARK server, type \`!leaveark\` in the same channel.\n` + `   This will mark you as "offline".\n\n` + `**⚠️ IMPORTANT: Failure to use \`!joinark\` before joining the ARK server or \`!leaveark\` after leaving may result in an immediate ban without further warning.**\n` + `This helps us monitor server activity. Thank you for your cooperation!`; try { await dmChannel.send(arkPassInfoMessage); await logAction(`📘 Sent ARK server activity instructions to ${user?.tag || userId} after !pass success.`); } catch (arkDmError) { console.error(`[PassFollowUp] Failed to send ARK instructions DM to ${user?.tag || userId}:`, arkDmError); await logAction(`⚠️ Failed to send ARK server activity instructions DM to ${user?.tag || userId}. Error: ${arkDmError.message}`); } } passCooldowns.set(userId, Date.now()); if (verifiedUsers[userId]) { verifiedUsers[userId].lastPassUsage = Date.now(); await saveData(); console.log(`[Data] Updated lastPassUsage for ${user?.tag || userId}`); } } catch (fileError) { if (fileError.code === 'ENOENT') { if(dmChannel) await dmChannel.send(`❌ Verified comment, but no admin pass file set!`); await logAction(`ℹ️ ${user?.tag || userId} passed ${internalCode}, BUT \`${ADMIN_PASS_FILE}\` not found.`); } else { console.error(`[Err] Read pass ${user?.tag || userId}:`, fileError); if(dmChannel) await dmChannel.send(`❌ Verified comment, but internal error getting password.`); await logAction(`🚨 ERROR reading pass for ${user?.tag || userId} after check ${internalCode}! ${fileError.message}`); } } finally { pendingPassChecks.delete(userId); } } else { const nextCheckId = setTimeout(() => performCheck(attempt + 1), CHECK_INTERVAL_MS); pendingPassChecks.set(userId, { ...task, timeoutId: nextCheckId }); console.log(`[Auto Check] Not found ${user?.tag || userId}, next check in ${CHECK_INTERVAL_MS/1000}s.`); } } catch (apiError) { console.error(`[Auto Check] API Error ${user?.tag || userId} (Task ${internalCode}):`, apiError); let userMsg = `❌ Error checking YouTube.`; let stopCheck = false; if (apiError.response?.data?.error?.errors?.length > 0) { const reason = apiError.response.data.error.errors[0].reason; if (reason === 'quotaExceeded') { userMsg = `❌ YouTube API quota exceeded. Try later/contact admin.`; stopCheck = true; await logAction(`🚨 YT API QUOTA EXCEEDED auto-check ${user?.tag || userId} task ${internalCode}!`); } else if (reason === 'forbidden' || reason === 'videoNotFound') { userMsg = `❌ Cannot access comments for video \`${videoId}\` (disabled/private/deleted?). Task cancelled.`; stopCheck = true; await logAction(`🚨 YT API FORBIDDEN/NOT_FOUND vid ${videoId} (User: ${user?.tag || userId}, Task ${internalCode}). Cancelled.`); } else { await logAction(`🚨 YT API ERROR (Reason: ${reason}) ${user?.tag || userId} task ${internalCode}: ${apiError.message}`); } } else { await logAction(`🚨 UNKNOWN YT API ERROR ${user?.tag || userId} task ${internalCode}: ${apiError.message}`); } if(dmChannel) { try { await dmChannel.send(userMsg); } catch(e){} } if (stopCheck) { pendingPassChecks.delete(userId); } else { const nextCheckId = setTimeout(() => performCheck(attempt + 1), CHECK_INTERVAL_MS * 2); pendingPassChecks.set(userId, { ...task, timeoutId: nextCheckId }); console.log(`[Auto Check] API err ${user?.tag || userId}, retry in ${CHECK_INTERVAL_MS*2/1000}s.`); } } } setTimeout(() => performCheck(1), 5000); }

// --- Inactivity Check Function for verifiedUsers (bot pass) ---
async function checkUserInactivity() { console.log(`[Inactivity] Starting check (Threshold: ${INACTIVITY_THRESHOLD_DAYS} days)...`); await logAction(`⏳ Running inactivity check (Threshold: ${INACTIVITY_THRESHOLD_DAYS} days).`); let guild; try { guild = await client.guilds.fetch(PRIMARY_GUILD_ID); } catch(err) { console.error(`[Inactivity] FAILED TO FETCH PRIMARY GUILD ${PRIMARY_GUILD_ID}:`, err.message); await logAction(`🚨 CRITICAL: Inactivity check failed - Cannot fetch primary guild ${PRIMARY_GUILD_ID}.`); return; } const adminPassRole = guild.roles.cache.get(ADMIN_PASS_ROLE_ID); if (!adminPassRole) { console.error(`[Inactivity] FAILED TO FIND ADMIN PASS ROLE ${ADMIN_PASS_ROLE_ID} in guild ${guild.name}.`); await logAction(`🚨 ERROR: Inactivity check skipped - Cannot find role <@&${ADMIN_PASS_ROLE_ID}> in guild ${guild.name}.`); return; } const now = Date.now(); const thresholdTime = now - (INACTIVITY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000); let removedCount = 0; let modified = false; const usersToCheck = Object.entries(verifiedUsers); for (const [userId, userData] of usersToCheck) { if (bannedUsers[userId]) { continue; } const lastUsageTimeMs = userData.lastPassUsage || 0; const verificationTimeMs = userData.timestamp ? new Date(userData.timestamp).getTime() : 0; let isInactive = false; let removalReason = ""; if (lastUsageTimeMs < thresholdTime && verificationTimeMs < thresholdTime) { isInactive = true; if (lastUsageTimeMs === 0) { removalReason = `Verified on ${new Date(verificationTimeMs).toLocaleDateString()} and never completed !pass successfully.`; } else { removalReason = `Last successful !pass was on ${new Date(lastUsageTimeMs).toLocaleDateString()}, which is older than threshold.`; } } if (isInactive && !(userData.cannotReverifyUntil && Date.now() < userData.cannotReverifyUntil)) { const userTag = userData.discordTag || `ID ${userId}`; const ign = userData.inGameName || 'UnknownIGN'; console.log(`[Inactivity] User ${userTag} (IGN: ${ign}) identified as inactive for bot pass. Reason: ${removalReason} Removing...`); await logAction(`🗑️ Removing inactive user ${userTag} (IGN: ${ign}) for bot pass. Reason: ${removalReason}`); let roleRemoved = false; try { const member = await guild.members.fetch(userId).catch(() => null); if (member) { if (member.roles.cache.has(adminPassRole.id)) { try { await member.roles.remove(adminPassRole); roleRemoved = true; await logAction(`   -> Role ${adminPassRole.name} removed from ${userTag}.`); await new Promise(resolve => setTimeout(resolve, 300)); } catch (roleError) { console.error(`[Inactivity] Failed to remove role from ${userTag}:`, roleError.message); await logAction(`   -> ⚠️ FAILED to remove role ${adminPassRole.name} from ${userTag}: ${roleError.message}`); } } else { await logAction(`   -> User ${userTag} did not have the role ${adminPassRole.name}.`); } try { await member.send(`ℹ️ Your verification and the '${adminPassRole.name}' role have been automatically removed due to inactivity regarding the bot password (no \`!pass\` command usage in the last ${INACTIVITY_THRESHOLD_DAYS} days). You can ask an admin to re-verify you if needed.`); await logAction(`   -> Inactivity notification DM sent to ${userTag}.`); await new Promise(resolve => setTimeout(resolve, 200)); } catch (dmError) { if (dmError.code !== 50007) { console.warn(`[Inactivity] Failed to send DM to ${userTag}:`, dmError.message); } await logAction(`   -> Failed to send inactivity DM to ${userTag} (Code: ${dmError.code || 'N/A'}).`); } } else { await logAction(`   -> User ${userTag} not found in guild ${guild.name}. Cannot remove role or DM.`); } } catch (fetchError) { console.error(`[Inactivity] Error fetching member ${userTag}:`, fetchError.message); await logAction(`   -> ⚠️ Error fetching member ${userTag}: ${fetchError.message}`); } delete verifiedUsers[userId]; removedCount++; modified = true; } } if (modified) { await saveData(); console.log(`[Inactivity] Saved data after removing ${removedCount} user(s).`); await logAction(`✅ Inactivity check complete. Removed ${removedCount} user(s). Data saved.`); } else { console.log(`[Inactivity] Check complete. No inactive users found for bot pass.`); await logAction(`✅ Inactivity check complete (bot pass). No users removed.`); } }

// --- ARK Player Activity Check Functions ---
async function removeActiveArkPlayer(userId, reason = "unknown", applyStrikeOverride = null) {
    // applyStrikeOverride kann sein: true (immer Strike), false (nie Strike), null (Standardverhalten basierend auf reason)
    const user = await client.users.fetch(userId).catch(() => null);
    const userTag = user ? user.tag : `ID ${userId}`;
    const playerData = activeArkPlayers[userId];
    const ign = playerData?.ign || 'N/A';

    if (playerData) {
        const wasCalledByAdminCommand = reason.toLowerCase().includes("manually removed by admin"); // Check if it's an admin removal

        delete activeArkPlayers[userId];
        await saveActiveArkPlayers();
        console.log(`[ARK Activity] Player ${userTag} (IGN: ${ign}) removed from active list. Reason: ${reason}.`);
        await logAction(`🔌 ARK Server: Player ${userTag} (IGN: ${ign}) removed from active list. Reason: ${reason}.`);

        let shouldApplyStrike = false;
        if (applyStrikeOverride === true) {
            shouldApplyStrike = true;
        } else if (applyStrikeOverride === false) {
            shouldApplyStrike = false;
        } else { // applyStrikeOverride is null, use default logic
            // Apply strike for confirmation timeout
            if (reason === "Confirmation timeout") {
                shouldApplyStrike = true;
            }
            // Apply strike if initial DM failed, as user couldn't participate in check
            else if (reason.includes("Failed to send initial confirmation DM")) {
                shouldApplyStrike = true;
            }
            // Add specific condition for admin removal if you want a strike there
            if (wasCalledByAdminCommand && reason.includes("with strike")) { // Example: Admin can specify a strike
                 shouldApplyStrike = true;
            }
        }


        if (shouldApplyStrike) {
            let currentStrikes = (verifiedUsers[userId]?.arkStrikes || 0) + 1;
            console.log(`[ARK Activity] Strike ${currentStrikes}/${ARK_ACTIVITY_STRIKE_LIMIT} for ${userTag}. Reason: ${reason}`);
            await logAction(`⚡ ARK Server: Strike ${currentStrikes}/${ARK_ACTIVITY_STRIKE_LIMIT} for ${userTag}. Reason: ${reason}`);

            if (currentStrikes >= ARK_ACTIVITY_STRIKE_LIMIT) {
                await handleArkStrikeout(userId, userTag, ign);
                 if(user) {
                    try {
                        // Changed message to reflect admin removal with strikeout if it was an admin command
                        const dmMsg = wasCalledByAdminCommand 
                            ? `You have been removed from the active ARK players list by an admin and received your ${currentStrikes}rd strike, leading to a temporary verification cooldown. Reason: ${reason}`
                            : `You did not respond to the ARK activity check, received your ${currentStrikes}rd strike, leading to a temporary verification cooldown. Reason: ${reason}`;
                        await user.send(dmMsg);
                    } catch(dmErr){ console.error(`Failed to DM user ${userTag} about admin removal/strikeout: ${dmErr.message}`);}
                }
            } else {
                if (verifiedUsers[userId]) {
                    verifiedUsers[userId].arkStrikes = currentStrikes;
                    await saveData();
                }
                 if(user) {
                    try {
                        // Changed message to reflect admin removal with strike if it was an admin command
                        const dmMsg = wasCalledByAdminCommand 
                            ? `You have been removed from the active ARK players list by an admin and received a strike. You now have ${currentStrikes}/${ARK_ACTIVITY_STRIKE_LIMIT} strikes. Reason: ${reason}`
                            : `You did not respond to the ARK activity check and received a strike. You now have ${currentStrikes}/${ARK_ACTIVITY_STRIKE_LIMIT} strikes. Reason: ${reason}`;
                        await user.send(dmMsg);
                    } catch(dmErr){ console.error(`Failed to DM user ${userTag} about admin removal/strike: ${dmErr.message}`);}
                }
            }
        } else if (wasCalledByAdminCommand && !shouldApplyStrike && user) { // Admin removed without strike
             try {
                await user.send(`An admin has manually removed you from the active ARK players list. No strike was issued for this action. Reason: ${reason}`);
            } catch(dmErr){ console.error(`Failed to DM user ${userTag} about admin removal without strike: ${dmErr.message}`);}
        }
    }
    if (arkActivityCheckTimeouts.has(userId)) {
        clearTimeout(arkActivityCheckTimeouts.get(userId));
        arkActivityCheckTimeouts.delete(userId);
    }
}

async function handleArkStrikeout(userId, userTag, ign) {
    console.log(`[ARK Activity] User ${userTag} (IGN: ${ign}) reached strike limit. Removing verification & role.`);
    await logAction(`🚫 ARK Server: User ${userTag} (IGN: ${ign}) reached ${ARK_ACTIVITY_STRIKE_LIMIT} strikes. Removing verification, role, and applying cooldown.`);

    const cannotReverifyTimestamp = Date.now() + (ARK_REVERIFY_COOLDOWN_HOURS * 60 * 60 * 1000);

    if (verifiedUsers[userId]) {
        verifiedUsers[userId].cannotReverifyUntil = cannotReverifyTimestamp;
        verifiedUsers[userId].arkStrikes = 0;
        await saveData();
    }

    try {
        const guild = await client.guilds.fetch(PRIMARY_GUILD_ID);
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
            const role = guild.roles.cache.get(ADMIN_PASS_ROLE_ID);
            if (role && member.roles.cache.has(role.id)) {
                await member.roles.remove(role);
                await logAction(`  -> Role <@&${ADMIN_PASS_ROLE_ID}> removed from ${userTag} due to ARK strikeout.`);
            }
        }
    } catch (e) {
        console.error(`[ARK Strikeout] Error removing role from ${userTag}:`, e);
        await logAction(`  -> ⚠️ Error removing role <@&${ADMIN_PASS_ROLE_ID}> from ${userTag} during ARK strikeout: ${e.message}`);
    }

    try {
        const userToDM = await client.users.fetch(userId);
        await userToDM.send(
            `❌ Your <@&${ADMIN_PASS_ROLE_ID}> role has been revoked due to repeated failures to confirm your activity on the ARK server or use \`!leaveark\`.\n` +
            `This was your ${ARK_ACTIVITY_STRIKE_LIMIT}rd unconfirmed session.\n` +
            `You may attempt to re-verify through an admin after ${ARK_REVERIFY_COOLDOWN_HOURS} hours (around ${new Date(cannotReverifyTimestamp).toLocaleString('en-US')}).\n` +
            `Please ensure you use \`!joinark\` and \`!leaveark\` correctly in the future.`
        );
        await logAction(`  -> DM sent to ${userTag} about ARK strikeout and re-verification cooldown.`);
    } catch (dmError) {
        console.error(`[ARK Strikeout] Failed to DM ${userTag}:`, dmError);
        await logAction(`  -> ⚠️ Failed to DM ${user.tag} about ARK strikeout. Error: ${dmError.message}`);
    }
}

async function promptArkActivityConfirmation(userId) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) { console.log(`[ARK Activity] User ${userId} not found for confirmation prompt.`); await removeActiveArkPlayer(userId, "User not found/left server"); return; }
    console.log(`[ARK Activity] Prompting ${user.tag} for activity confirmation.`);
    await logAction(`❓ ARK Server: Prompting ${user.tag} for activity confirmation.`);
    try {
        const dmChannel = await user.createDM();
        const confirmMsg = await dmChannel.send(
            `Hi ${user.username}, are you still playing on the ARK server? Please react with:\n` +
            `✅ to confirm you are still active (your session will be extended for another ${ARK_ACTIVITY_CHECK_DURATION_MS / 60000} minutes).\n` +
            `❌ to indicate you are done playing (you will be removed from the active list).\n` +
            `You have ${ARK_ACTIVITY_CONFIRM_TIMEOUT_MS / 60000} minutes to respond.`
        );
        try { await confirmMsg.react('✅'); await confirmMsg.react('❌'); } catch (reactErr) { console.error("Error reacting to DM for activity check:", reactErr); }
        const reactionFilter = (reaction, reactingUser) => ['✅', '❌'].includes(reaction.emoji.name) && reactingUser.id === userId;
        confirmMsg.awaitReactions({ filter: reactionFilter, max: 1, time: ARK_ACTIVITY_CONFIRM_TIMEOUT_MS, errors: ['time'] })
            .then(async collected => {
                const reaction = collected.first();
                if (reaction.emoji.name === '✅') {
                    console.log(`[ARK Activity] ${user.tag} confirmed still active.`);
                    await logAction(`👍 ARK Server: ${user.tag} confirmed still active.`);
                    if (activeArkPlayers[userId]) {
                        activeArkPlayers[userId].lastConfirmedActiveAt = Date.now();
                        // activeArkPlayers[userId].joinedAt = Date.now(); // Option to reset join time
                        await saveActiveArkPlayers();
                        startArkActivityCheckTimer(userId);
                        try { await dmChannel.send("✅ Thanks! Your active session on the ARK server has been extended."); } catch (e) {
                            if (e.code === 50007) {
                                console.warn(`[ARK Activity] Failed to send follow-up DM to ${user.tag} (DM Blocked - Code 50007).`);
                                await logAction(`⚠️ ARK Server: Follow-up DM to ${user.tag} blocked (Code 50007).`);
                            } else {
                                console.error(`[ARK Activity] Failed to send follow-up DM to ${user.tag}:`, e);
                                await logAction(`⚠️ ARK Server: Failed to send follow-up DM to ${user.tag}. Error: ${e.message}`);
                            }
                        }
                    }
                } else if (reaction.emoji.name === '❌') {
                    await removeActiveArkPlayer(userId, "User indicated they are done", false); // Changed from true to false: User voluntarily leaves, no strike
                    try { await dmChannel.send("Thanks for letting us know! You've been removed from the active ARK players list.");} catch (e) {
                        if (e.code === 50007) {
                            console.warn(`[ARK Activity] Failed to send follow-up DM to ${user.tag} (DM Blocked - Code 50007).`);
                            await logAction(`⚠️ ARK Server: Follow-up DM to ${user.tag} blocked (Code 50007).`);
                        } else {
                            console.error(`[ARK Activity] Failed to send follow-up DM to ${user.tag}:`, e);
                            await logAction(`⚠️ ARK Server: Failed to send follow-up DM to ${user.tag}. Error: ${e.message}`);
                        }
                    }
                }
            })
            .catch(async () => {
                console.log(`[ARK Activity] ${user.tag} did not confirm activity within ${ARK_ACTIVITY_CONFIRM_TIMEOUT_MS / 60000} minutes.`);
                // If initial DM sent successfully but no reaction, this is a timeout --> strike
                await removeActiveArkPlayer(userId, "Confirmation timeout");
                try {
                    const timeoutDm = await user.createDM();
                    await timeoutDm.send(`⏰ You did not respond to the ARK activity check in time and have been removed from the active list. Use \`!joinark\` again if you're still playing.`).catch(console.error);
                } catch (e) {
                    if (e.code === 50007) {
                        console.warn(`[ARK Activity] Failed to send timeout DM to ${user.tag} (DM Blocked - Code 50007).`);
                        await logAction(`⚠️ ARK Server: Timeout DM to ${user.tag} blocked (Code 50007).`);
                    } else {
                        console.error(`[ARK Activity] Failed to send timeout DM to ${user.tag}:`, e);
                        await logAction(`⚠️ ARK Server: Failed to send timeout DM to ${user.tag}. Error: ${e.message}`);
                    }
                }
            });
    } catch (dmError) {
        if (dmError.code === 50007) {
            console.warn(`[ARK Activity] Failed to DM ${user.tag} for confirmation (DM Blocked - Code 50007).`);
            await logAction(`⚠️ ARK Server: Initial activity confirmation DM to ${user.tag} blocked (Code 50007). User likely has DMs disabled. Removing from active players without strike.`);
            // If the initial DM fails, the user cannot interact, so remove them from active players without strike.
            await removeActiveArkPlayer(userId, "Failed to send initial confirmation DM", false); 
        } else {
            console.error(`[ARK Activity] Failed to DM ${user.tag} for confirmation:`, dmError);
            await logAction(`⚠️ ARK Server: Failed to DM ${user.tag} for activity confirmation. Error: ${dmError.message}. Removing from active players without strike.`);
            // Other DM errors, also remove without strike.
            await removeActiveArkPlayer(userId, "Failed to send initial confirmation DM - other error", false); 
        }
    }
}

function startArkActivityCheckTimer(userId) {
    if (arkActivityCheckTimeouts.has(userId)) { clearTimeout(arkActivityCheckTimeouts.get(userId)); arkActivityCheckTimeouts.delete(userId); }
    const timeoutId = setTimeout(() => { if (activeArkPlayers[userId]) { promptArkActivityConfirmation(userId); } arkActivityCheckTimeouts.delete(userId); }, ARK_ACTIVITY_CHECK_DURATION_MS);
    arkActivityCheckTimeouts.set(userId, timeoutId);
    console.log(`[ARK Activity] Activity check timer started for user ${userId} (${ARK_ACTIVITY_CHECK_DURATION_MS / 60000} min).`);
}
// --- Command Handler ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.member) { try { message.member = await message.guild.members.fetch(message.author.id); } catch (err) { if (err.code !== 10007) { console.warn(`[Warn] Failed to fetch member ${message.author.tag} (${message.author.id}): ${err.message}`); } } }
    if (!message.member && !['!rem_bann', '!remove', '!show', '!bann', '!remove_strike'].includes(message.content.split(' ')[0])) { console.log(`[Command] Member not found for ${message.author.tag}, skipping command: ${message.content.split(' ')[0]}`); return; }

    const userId = message.author.id;

    // --- Auto-Reply Logic ---
    if (AUTO_REPLY_UNVERIFIED_CHANNEL_ID && AUTO_REPLY_UNVERIFIED_ROLE_ID && AUTO_REPLY_VERIFICATION_CHANNEL_ID && message.channel.id === AUTO_REPLY_UNVERIFIED_CHANNEL_ID && message.member) { const hasUnverifiedRole = message.member.roles.cache.has(AUTO_REPLY_UNVERIFIED_ROLE_ID); const hasVerifiedRole = message.member.roles.cache.has(ADMIN_PASS_ROLE_ID); const isAdminUser = message.member.roles.cache.has(ADMIN_ROLE_ID); if (hasUnverifiedRole && !hasVerifiedRole && !isAdminUser) { try { await message.reply(`Hi ${message.author}, to see the rest of the server and access features, please verify yourself first by clicking "Verify" in https://discord.com/channels/1225086237619130419/1377395048836235324 .`); await logAction(`🤖 Auto-replied to unverified user ${message.author.tag} in #${message.channel.name} (any message).`); return; } catch (replyError) { console.error("[AutoReply] Failed to send auto-reply:", replyError); await logAction(`⚠️ Failed to send auto-reply to unverified user ${message.author.tag}. Error: ${replyError.message}`); return; } } }

    // --- Anti Admin Ping Logic ---
    if (message.channel.id === PASS_CHANNEL_ID && !message.author.bot && message.member) { const isAdminCheck = message.member.roles.cache.has(ADMIN_ROLE_ID); if (!isAdminCheck) { const mentionedAdmins = message.mentions.members?.filter(m => m.roles.cache.has(ADMIN_ROLE_ID)); if (mentionedAdmins && mentionedAdmins.size > 0) { const now = Date.now(); const tracker = adminPingTracker.get(userId) || { count: 0, lastPing: 0 }; if (now - tracker.lastPing > PING_WARN_RESET_MS) tracker.count = 0; tracker.count++; tracker.lastPing = now; adminPingTracker.set(userId, tracker); await logAction(`🚨 Admin Ping! User: ${message.author.tag}, Count: ${tracker.count}, Mentioned: ${mentionedAdmins.map(m=>m.user.tag).join(', ')} in <#${PASS_CHANNEL_ID}>`); if (tracker.count === 1) { await message.reply(`⚠️ Please do not ping admins for \`!pass\` help. Read bot instructions carefully. Further pings → timeout.`); } else if (tracker.count >= 2) { try { const botMember = message.guild.members.me ?? await message.guild.members.fetchMe(); if (!botMember.permissions.has(PermissionsBitField.Flags.ModerateMembers)) { await message.reply("⚠️ Cannot apply timeout - Missing 'Moderate Members' permission."); await logAction(`⚠️ Failed timeout ${message.author.tag} (Ping ${tracker.count}) - Missing Perms!`); } else if (message.member.moderatable) { const timeoutMinutes = PING_TIMEOUT_DURATION_MS / 60000; await message.member.timeout(PING_TIMEOUT_DURATION_MS, `Repeated admin pings in pass channel.`); await message.reply(`🚫 Timed out for ${timeoutMinutes} minutes for pinging admins after warning. Follow bot instructions.`); await logAction(`🚫 Timed out ${message.author.tag} for ${timeoutMinutes}m (Ping ${tracker.count})`); try { await message.author.send(`🚫 Timed out for ${timeoutMinutes} minutes for pinging admins after warning. Follow bot instructions.`); } catch {} } else { await message.reply(`⚠️ Cannot timeout ${message.author.tag} - They might have higher roles or permissions.`); await logAction(`⚠️ Failed timeout ${message.author.tag} (Ping ${tracker.count}) - User not moderatable.`); } } catch (timeoutError) { console.error(`Timeout fail ${message.author.tag}:`, timeoutError); await message.reply(`⚠️ Failed to timeout ${message.author.tag}. Missing 'Moderate Members' permission?`); await logAction(`⚠️ Failed timeout ${message.author.tag} (Ping ${tracker.count}) - Error: ${timeoutError.message}`); } tracker.count = 0; adminPingTracker.set(userId, tracker); } return; } } }

    // --- Normal Command Processing ---
    if (!message.content.startsWith('!')) return;

    try {
        const requireAdmin = async () => { if (!message.member) { await message.reply("❌ Cannot verify permissions - Member data missing."); await logAction(`⚠️ Permission check failed for ${message.author.tag}: Member object unavailable.`); return false; } const hasAdminRole = message.member.roles.cache.has(ADMIN_ROLE_ID); if (!hasAdminRole) { await message.reply("❌ You do not have permission for this command. Incident logged."); await logAction(`⚠️ Unauthorized cmd attempt by ${message.author.tag} (${userId}): ${message.content}`); return false; } return true; };
        const hasUserRole = message.member?.roles.cache.has(ADMIN_PASS_ROLE_ID) ?? false;
        const isVerifiedInFile = verifiedUsers.hasOwnProperty(userId);

        if (message.content.startsWith('!addpass ')) { if (!await requireAdmin()) return; const pw = message.content.slice(9).trim(); if (!pw) { await message.reply("ℹ️ Missing required argument(s)."); return; } try { await fs.writeFile(ADMIN_PASS_FILE, pw, 'utf8'); await message.reply(`✅ Success! Admin password updated.`); await logAction(`🔑 Bot Admin Pass changed by ${message.author.username}.`); if (message.deletable) await message.delete().catch(console.error); } catch (e) { console.error(`[Err] Save pass:`, e); await message.reply("❌ Oops! An internal error occurred. Incident logged."); await logAction(`🚨 ERROR saving bot admin pass! ${e.message}`); } return; }
        if (message.content.toLowerCase() === '!givepass') {const hasAdminRole = message.member.roles.cache.has(process.env.ADMIN_ROLE_ID);
const hasGivepassHelperRole = message.member.roles.cache.has(process.env.GIVEPASS_HELPER_ROLE_ID);

if (!hasAdminRole && !hasGivepassHelperRole) {
    await message.reply("❌ You do not have permission for this command. Incident logged.");
    await logAction(`⚠️ Unauthorized cmd attempt by ${message.author.tag} (${userId}): ${message.content}`);
    return;
} let botAdminPass = null; let errors = []; try { botAdminPass = await fs.readFile(ADMIN_PASS_FILE, 'utf8'); } catch (fileError) { if (fileError.code === 'ENOENT') { errors.push(`- Bot Admin Password file (\`${ADMIN_PASS_FILE}\`) is missing.`); await logAction(`🚨 ERROR: !givepass for ${message.author.tag} - Bot Admin pass file missing.`); } } let dmMessage = ""; if (botAdminPass) { dmMessage += `Bot Admin Password (for \`!pass\`):\n${botAdminPass}\n\n`; } else { dmMessage += `Bot Admin Password: Not available.\n\n`; } /* ARK Pass removed from here */ if (errors.length > 0) { dmMessage += `\n\n--- Errors encountered ---\n${errors.join('\n')}`; } try { await message.author.send(dmMessage.trim()); if (errors.length === 0) { await message.reply("✅ The Bot Admin password has been sent to your DMs."); await logAction(`🔑 Admin ${message.author.tag} used !givepass and received Bot Admin password via DM.`); } else { await message.reply(`⚠️ Password (or errors) sent to your DMs. The Bot Admin password might be missing due to file errors.`); await logAction(`🔑 Admin ${message.author.tag} used !givepass. Errors encountered for Bot Admin Pass: ${errors.join(', ')}`); } } catch (dmError) { console.error(`[GivePass] DM Error for ${message.author.tag}:`, dmError); await message.reply("❌ Could not send you the password(s) via DM. Please check your privacy settings."); await logAction(`⚠️ Failed to DM password(s) via !givepass to ${message.author.tag}. Error: ${dmError.message}`); } return; }
        if (message.content.toLowerCase() === '!pass') { if (message.channel.id !== PASS_CHANNEL_ID) { await message.reply(`❌ Please use \`!pass\` only in <#${PASS_CHANNEL_ID}>.`); return; } if (!isVerifiedInFile) { await message.reply("❌ Verified first."); return; } if (!message.member) { await message.reply("❌ Cannot verify your roles. Please try again or contact an admin if the issue persists."); await logAction(`⚠️ !pass check failed for ${message.author.tag}: Member object unavailable.`); return; } if (!hasUserRole) { await message.reply(`❌ Need <@&${ADMIN_PASS_ROLE_ID}> role. (Confirm rules via !add process if pending)`); return; } const now = Date.now(); const lastReq = passCooldowns.get(userId) || 0; const timeRem = (lastReq + PASS_COOLDOWN_MS) - now; if (timeRem > 0) { await message.reply(`⏳ Wait ${Math.ceil(timeRem / 60000)} min(s).`); return; } if (pendingPassChecks.has(userId)) { await message.reply("⏳ Auto-check already running. Check DMs for status/results."); return; } const videoId = YT_VIDEO_IDS[Math.floor(Math.random() * YT_VIDEO_IDS.length)]; const uniqueSentence = generateUniqueSentence(); const internalCode = generateUniqueInternalID(); usedPassPhraseIDs.add(internalCode); await saveUsedPhraseIDs(); const videoUrl = `https://www.youtube.com/watch?v=${videoId}`; let dmChannel; try { dmChannel = await message.author.createDM(); } catch (dmError) { console.error(`[DM Err] createDM fail ${message.author.tag}:`, dmError); await message.reply("❌ Cannot create DM. Check privacy settings."); await logAction(`⚠️ DM ERROR createDM ${message.author.username}! ${dmError.message}`); usedPassPhraseIDs.delete(internalCode); await saveUsedPhraseIDs(); return; } const taskData = { videoId: videoId, requiredSentence: uniqueSentence, internalCode: internalCode, startTime: now, dmChannelId: dmChannel.id }; pendingPassChecks.set(userId, taskData); setTimeout(() => { if (pendingPassChecks.has(userId) && pendingPassChecks.get(userId)?.internalCode === internalCode) { pendingPassChecks.delete(userId); logAction(`⌛️ Auto-cleared task ${internalCode} for ${message.author.tag} (Timeout or Success/Fail handled earlier)`); } }, CHECK_DURATION_MS + 120000); try { await dmChannel.send(`**Action Required for Admin Password YOU HAVE TO COPY ONE SENTENCE EXACTLY AS I GIVE IT TO YOU!!!!! THAT MEANS COPYING AND PASTEING IT INTO YOUTUBE UNDER THE VIDEO I SENT YOU!!!!! I WILL SEND YOU THE SENTENCE AS A SEPARATE MESSAGE UNDER THE VIDEO SO YOU CAN SIMPLY COPY AND PASTE IT:**\n\n1. Visit: ${videoUrl}\n2. Post the comment I'll send in the *next message*.\n3. Wait ~1 min.\n4. **I will check automatically** for ${CHECK_DURATION_MS / 60000} minutes and send you here the pass if u find the sentence! if you dont get it after 10 minutes i send error msg to you. Than you dont do the exact sentence ont the provided video result.\n\n*The comment to post is below 👇*`); await dmChannel.send(uniqueSentence); await message.reply("✅ Action required! Check DMs. **Read carefully!** Admins won't help."); await logAction(`👉 ${message.author.tag} initiated !pass task (Video: ${videoId}, TaskID: ${internalCode}). Auto-check started.`); startCommentCheck(userId, dmChannel.id, taskData); } catch (dmError) { console.error(`[DM Err] task send fail ${message.author.tag}:`, dmError); await message.reply("❌ Cannot DM instructions. Check settings."); await logAction(`⚠️ DM ERROR task send ${message.author.username}! ${dmError.message}`); pendingPassChecks.delete(userId); usedPassPhraseIDs.delete(internalCode); await saveUsedPhraseIDs(); } return; }

        // --- ARK Server Player Activity Commands ---
        if (message.content.toLowerCase() === '!joinark') {
            if (ARK_PASS_COMMAND_CHANNEL_ID && message.channel.id !== ARK_PASS_COMMAND_CHANNEL_ID) { await message.reply(`❌ Please use \`!joinark\` only in <#${ARK_PASS_COMMAND_CHANNEL_ID}>.`); return; }
            if (!isVerifiedInFile) { await message.reply("❌ You need to be verified first. Please complete the standard verification process."); return; }
            if (!message.member) { await message.reply("❌ Cannot verify your roles. Please try again."); return; }
            if (!hasUserRole) { await message.reply(`❌ You need the <@&${ADMIN_PASS_ROLE_ID}> role to use this command. Please complete the full verification process.`); return; }
            if (verifiedUsers[userId]?.cannotReverifyUntil && Date.now() < verifiedUsers[userId].cannotReverifyUntil) { const timeLeft = Math.ceil((verifiedUsers[userId].cannotReverifyUntil - Date.now()) / 3600000); await message.reply(`❌ You are currently on a cooldown from joining the ARK server due to previous inactivity. Please try again in about ${timeLeft} hour(s).`); await logAction(`⏳ ARK Server: ${message.author.tag} attempted !joinark but is on re-verification cooldown for ARK activity.`); return; }
            const now = Date.now(); const lastArkJoinReq = arkJoinCooldowns.get(userId) || 0; const arkTimeRem = (lastArkJoinReq + ARK_JOIN_COOLDOWN_MS) - now;
            if (arkTimeRem > 0) { await message.reply(`⏳ You can use \`!joinark\` again in ${Math.ceil(arkTimeRem / 60000)} min(s).`); return; }
            
            activeArkPlayers[userId] = { ign: verifiedUsers[userId]?.inGameName || 'Unknown IGN', tag: message.author.tag, joinedAt: now, lastConfirmedActiveAt: now, strikes: verifiedUsers[userId]?.arkStrikes || 0 };
            if (verifiedUsers[userId]) { delete verifiedUsers[userId].arkStrikes; delete verifiedUsers[userId].cannotReverifyUntil; await saveData(); }
            await saveActiveArkPlayers(); arkJoinCooldowns.set(userId, now); startArkActivityCheckTimer(userId);
            // Added explicit warning about DM settings
            await message.reply("✅ You have been marked as active on the ARK server! An activity check will be performed in 30 minutes. Remember to use `!leaveark` when you're done. Failure to respond to activity checks or use `!leaveark` will result in strikes.\n\n**⚠️ IMPORTANT: Make sure your Discord privacy settings allow DMs from server members, or you won't receive the activity check message!**");
            await logAction(`➕ ARK Server: ${message.author.tag} (IGN: ${activeArkPlayers[userId].ign}) used !joinark. Activity check started. Strikes: ${activeArkPlayers[userId].strikes}.`);
            // No ARK password is sent here anymore
            return;
        }
        // Removed !setarkpass from here
        if (message.content.toLowerCase() === '!activeplayers') { if (!await requireAdmin()) return; if (Object.keys(activeArkPlayers).length === 0) { await message.channel.send("ℹ️ No players currently marked as active on the ARK server via `!joinark`."); return; } const now = Date.now(); let activeList = []; for (const pUserId in activeArkPlayers) { const data = activeArkPlayers[pUserId]; let userTag = data.tag || `ID: ${pUserId}`; try { const member = await message.guild.members.fetch(pUserId).catch(()=>null); if(member) userTag = member.user.tag; } catch { /* User might have left */ } const ign = data.ign || 'N/A'; const lastActive = data.lastConfirmedActiveAt || data.joinedAt; const lastActiveTime = new Date(lastActive).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }); const durationMs = now - lastActive; const hours = Math.floor(durationMs / 3600000); const minutes = Math.floor((durationMs % 3600000) / 60000); activeList.push(`• ${userTag} (IGN: \`${ign}\`) - Last active: ${lastActiveTime} (${hours}h ${minutes}m ago) - Strikes: ${data.strikes || 0}`); } const embed = new EmbedBuilder().setTitle("🎮 Active ARK Players (via `!joinark`)").setColor(0x00FF00).setDescription(activeList.join('\n').slice(0, 4000)).setTimestamp().setFooter({ text: `Total: ${activeList.length}` }); await message.channel.send({ embeds: [embed] }); await logAction(`📊 Admin ${message.author.tag} viewed active ARK players list.`); return; }
        if (message.content.toLowerCase() === '!leaveark') { 
            if (!isVerifiedInFile || !hasUserRole) { await message.reply("❌ You need to be verified and have the correct role to use this command."); return; } 
            if (activeArkPlayers[userId]) { 
                // User voluntarily leaves, no strike should be applied.
                await removeActiveArkPlayer(userId, "User used !leaveark", false); 
                await message.reply("✅ You have been marked as no longer active on the ARK server. Thanks for playing!"); 
            } else { await message.reply("ℹ️ You are not currently marked as active on the ARK server."); } return; 
        }
        if (message.content.startsWith('!addactive ')) { if (!await requireAdmin()) return; const args = message.content.slice(11).trim().split(/ +/); const targetUser = message.mentions.users.first(); if (!targetUser) { await message.reply("ℹ️ Please mention a user. Usage: `!addactive @User [OptionalIGN]`"); return; } const ign = args.length > 1 ? args.slice(1).join(" ") : (verifiedUsers[targetUser.id]?.inGameName || 'ManuallyAdded'); if (!verifiedUsers[targetUser.id]) { await message.reply(`⚠️ User ${targetUser.tag} is not in the main verification list. Adding them as active without full verification details.`); } activeArkPlayers[targetUser.id] = { ign: ign, tag: targetUser.tag, joinedAt: Date.now(), lastConfirmedActiveAt: Date.now(), strikes: activeArkPlayers[targetUser.id]?.strikes || verifiedUsers[targetUser.id]?.arkStrikes || 0 }; if(verifiedUsers[targetUser.id]) { delete verifiedUsers[targetUser.id].arkStrikes; delete verifiedUsers[targetUser.id].cannotReverifyUntil; await saveData(); } await saveActiveArkPlayers(); startArkActivityCheckTimer(targetUser.id); await message.reply(`✅ User ${targetUser.tag} (IGN: ${ign}) has been manually added to the active ARK players list. Activity check timer started.`); await logAction(`🛠️ ARK Server: Admin ${message.author.tag} manually added ${targetUser.tag} (IGN: ${ign}) to active list.`); return; }
        if (message.content.startsWith('!removeactive ')) { // Admin Only
            if (!await requireAdmin()) return;
            const args = message.content.slice(14).trim().split(/ +/); // Command is `!removeactive ` (14 chars)
            const targetUserMention = message.mentions.users.first();
            
            if (!targetUserMention) {
                await message.reply("ℹ️ Please mention a user. Usage: `!removeactive @User [strike]`");
                return;
            }
            const targetUserId = targetUserMention.id;
            const applyStrike = args.some(arg => arg.toLowerCase() === 'strike'); // Check if 'strike' argument is present

            if (activeArkPlayers[targetUserId]) {
                let reason = "Manually removed by admin";
                if (applyStrike) {
                    reason += " with strike";
                }
                // Pass 'applyStrike' directly to the function.
                // If applyStrike is true, it will give a strike. If false, it won't.
                await removeActiveArkPlayer(targetUserId, reason, applyStrike);
                await message.reply(`✅ User ${targetUserMention.tag} has been manually removed from the active ARK players list.${applyStrike ? ' A strike has been applied.' : ''}`);
            } else {
                await message.reply(`ℹ️ User ${targetUserMention.tag} was not on the active ARK players list.`);
            }
            return;
        }

        // --- NEW: Remove Strike Command ---
        if (message.content.startsWith('!remove_strike ')) {
            if (!await requireAdmin()) return;
            const user = message.mentions.users.first();
            if (!user) {
                await message.reply("ℹ️ Please mention a user whose ARK strikes you want to remove. Usage: `!remove_strike @User`");
                return;
            }

            if (!verifiedUsers[user.id]) {
                await message.reply(`ℹ️ User ${user.tag} is not in the verification file, so they have no ARK strikes to manage.`);
                return;
            }

            const userData = verifiedUsers[user.id];
            if (userData.arkStrikes && userData.arkStrikes > 0) {
                const oldStrikes = userData.arkStrikes;
                userData.arkStrikes = 0; // Reset strikes to 0
                userData.cannotReverifyUntil = 0; // Also clear any re-verification cooldown
                await saveData();
                await message.reply(`✅ ARK strikes for ${user.tag} (IGN: \`${userData.inGameName}\`) reset from ${oldStrikes} to 0. Any re-verification cooldown has also been cleared.`);
                await logAction(`⚡ Admin ${message.author.tag} reset ARK strikes for ${user.tag} (IGN: ${userData.inGameName}) from ${oldStrikes} to 0 and cleared cooldown.`);
            } else {
                await message.reply(`ℹ️ User ${user.tag} (IGN: \`${userData.inGameName || 'N/A'}\`) has no ARK strikes to remove.`);
            }
            return;
        }
        // --- END NEW: Remove Strike Command ---

        // --- Other Admin-Only Commands ---
        if (message.content === '!help') { if (!await requireAdmin()) return; const hEmbed = new EmbedBuilder().setTitle("Admin Command List").setColor(0x0099FF).addFields( {name:'!add @user',value:"Starts interactive verification (IGN + rules) & assigns role."}, {name:'!forceadd @user IGN',value:"Directly adds user & assigns role (bypasses rules step)."}, {name:'!remove [@user|IGN|ID]',value:"Removes user from file & role."}, {name:'!change @user NewIGN',value:"Changes user's IGN in file."}, {name:'!bann [@user|IGN|ID]',value:"Bans user & removes role."}, {name:'!rem_bann [@user|ID]',value:"Unbans user."}, {name:'!send [msg]',value:`Sends DM to users with <@&${ADMIN_PASS_ROLE_ID}> role.`}, {name:'!list',value:"Shows last 10 from verification file."}, {name:'!fulllist',value:"Exports verification file as CSV."}, {name:'!show [@user|IGN|ID]',value:"Shows details from verification file (incl. ARK strikes/cooldown)."}, {name:'!show_banned',value:"Lists banned users."}, {name:'!accountage @user',value:"Shows Discord account age."}, {name:'!rolecheck',value:`Checks file vs <@&${ADMIN_PASS_ROLE_ID}> role.`}, {name:'!logtest',value:"Tests logging."}, {name:'!addpass [Pass]',value:"Sets bot admin password file."}, {name:'!givepass',value:"Sends current bot admin password to your DMs."}, {name:'!pass',value:`(User, <#${PASS_CHANNEL_ID}> only) Gets bot admin password via YouTube (needs <@&${ADMIN_PASS_ROLE_ID}>).`}, {name:'!joinark',value:`(User, <#${ARK_PASS_COMMAND_CHANNEL_ID || 'specific channel'}> only) Marks user as active on ARK server (needs <@&${ADMIN_PASS_ROLE_ID}>).`}, {name:'!leaveark',value:"(User) Marks you as no longer active on the ARK server."}, /* {name:'!setarkpass [password]',value:"(Admin) Sets the ARK server password."}, // Removed */ {name:'!activeplayers',value:"(Admin) Shows users currently marked as active on ARK server."}, {name:'!addactive @User [IGN]',value:"(Admin) Manually adds a user to the active ARK players list."}, {name:'!removeactive @User',value:"(Admin) Manually removes a user from the active ARK players list."},
            // NEW: Added the !remove_strike command to the help list
            {name:'!remove_strike @User',value:"(Admin) Resets a user's ARK activity strikes to 0 and clears any re-verification cooldown."}
        ).setFooter({text:'Bot by YourName/Community'}); await message.channel.send({embeds:[hEmbed]}); return; }
        if (message.content === '!channelcheck') { if (!await requireAdmin()) return; const logCh=process.env.LOG_CHANNEL_ID; const webhook=process.env.LOG_WEBHOOK_URL; const ytKey=process.env.YOUTUBE_API_KEY?'Set':'NOT SET'; const ytIds=process.env.YT_VIDEO_IDS||'NOT SET'; const passCh=process.env.PASS_CHANNEL_ID||'NOT SET'; const guildId=process.env.PRIMARY_GUILD_ID || 'NOT SET'; const ruleCh=RULE_CHANNEL_ID || 'NOT SET'; const ruleMsg=RULE_MESSAGE_ID || 'NOT SET'; const autoReplyChan = AUTO_REPLY_UNVERIFIED_CHANNEL_ID || 'N/S'; const autoReplyRole = AUTO_REPLY_UNVERIFIED_ROLE_ID || 'N/S'; const autoReplyVerChan = AUTO_REPLY_VERIFICATION_CHANNEL_ID || 'N/S'; const arkPassCmdChan = ARK_PASS_COMMAND_CHANNEL_ID || 'N/S (Any Channel)'; await message.reply(`**Debug:**\nLogChanID: ${logCh||'N/S'}\nWebhook: ${webhook?'Set':'N/S'}\nBotPassChanID: ${passCh}\nYT Key: ${ytKey}\nYT IDs: ${ytIds}\nPrimary Guild: ${guildId}\nRule Chan ID: ${ruleCh}\nRule Msg ID: ${ruleMsg}\nAutoReply Chan: ${autoReplyChan}\nAutoReply Role: ${autoReplyRole}\nAutoReply Ver Chan: ${autoReplyVerChan}\nARK Join Cmd Chan: ${arkPassCmdChan}`); return; }
        if (message.content === '!logtest') { if (!await requireAdmin()) return; await message.reply('Sending Webhook test...'); await logAction(`🧪 Log test by ${message.author.username}`); await message.channel.send('Webhook test sent.'); await message.channel.send(`Checking log channel ${LOG_CHANNEL_ID}...`); try{ const botMember = message.guild.members.me ?? await message.guild.members.fetchMe(); const ch=await client.channels.fetch(LOG_CHANNEL_ID); if(!ch?.isTextBased()){await message.channel.send(`❌ Log channel ID ${LOG_CHANNEL_ID} not found/text!`); return;} const p=ch.permissionsFor(botMember); if(!p){await message.channel.send("❌ Could not check perms for log channel."); return;} const rP=[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages]; const mP=rP.filter(perm=>!p.has(perm)); if(mP.length>0){const n=mP.map(perm=>Object.keys(PermissionsBitField.Flags).find(k=>PermissionsBitField.Flags[k]===perm)); await message.channel.send(`❌ Bot missing perms in log channel (${ch.name}): ${n.join(', ')}`); return;} await ch.send(`✅ Log test OK! (By ${message.author.tag})`); await message.reply(`✅ Test msg sent to ${ch.toString()}!`); }catch(e){console.error('[Logtest Err]:',e); await message.reply(`❌ Error testing log chan: ${e.message}`);} return; }
        if (message.content.startsWith('!add ')) { if (!await requireAdmin()) return; const user = message.mentions.users.first(); if(!user){await message.reply("ℹ️ Please mention a user."); return;} if(verifiedUsers[user.id] && !(verifiedUsers[user.id]?.cannotReverifyUntil && Date.now() < verifiedUsers[user.id].cannotReverifyUntil) ){await message.reply(`⚠️ User ${user.tag} is already verified as \`${verifiedUsers[user.id].inGameName}\`. Use !change or !remove.`); return;} if(verifiedUsers[user.id]?.cannotReverifyUntil && Date.now() < verifiedUsers[user.id].cannotReverifyUntil){ const timeLeft = Math.ceil((verifiedUsers[user.id].cannotReverifyUntil - Date.now()) / 3600000); await message.reply(`❌ User ${user.tag} is on a re-verification cooldown due to ARK activity strikes. They can be re-verified in about ${timeLeft} hour(s).`); return; } if(bannedUsers[user.id]){await message.reply(`⚠️ User ${user.tag} is banned.`); return;} let targetMemberForAdd; try { targetMemberForAdd = await message.guild.members.fetch(user.id); if (BANNED_FROM_VERIFICATION_ROLE_ID && targetMemberForAdd.roles.cache.has(BANNED_FROM_VERIFICATION_ROLE_ID)) { await message.reply(`❌ User ${user.tag} has a role that prevents them from being verified.`); await logAction(`🚫 Verification attempt blocked for ${user.tag} due to having role ID ${BANNED_FROM_VERIFICATION_ROLE_ID}.`); return; } } catch (fetchErr) { await message.reply(`ℹ️ Could not fetch member data for ${user.tag}. Are they on the server?`); console.error(`[Add Check Role/Age] Failed to fetch member ${user.tag}:`, fetchErr); await logAction(`⚠️ Failed to fetch member ${user.tag} during pre-checks for !add command.`); return; } const ageMs=Date.now()-targetMemberForAdd.user.createdAt.getTime(); const ageD=Math.floor(ageMs/(864e5)); if(ageD<21){await message.reply(`❌ ${user.tag}'s account is only ${ageD}d old (min 21). Use \`!forceadd\`.`); return;} const instrMsg=await message.channel.send(`${user}, **Verification Required:** Please reply to this message with ONLY your **In-Game Name**. It must be 3-16 characters long and contain only letters (a-z, A-Z), numbers (0-9), and spaces.\n**Example:** \`Player Name 123\`\n\nYou have **24 hours** to respond.`); const filter=(r)=>{if(r.author.id!==user.id)return false; const rgx=/^[a-zA-Z0-9 ]{3,16}$/; if(!rgx.test(r.content.trim())){r.reply("❌ Invalid In-Game Name format. It must be 3-16 characters and contain only letters, numbers, or spaces. Please try again.").then(m=>setTimeout(()=>m.delete().catch(console.error),10000)).catch(console.error); return false;} return true;}; let resp; let promptRuleMsg; try { const coll=await message.channel.awaitMessages({filter,max:1,time:86400000,errors:['time']}); resp=coll.first(); const ign=resp.content.trim(); console.log(`[DEBUG !add] IGN collected for ${user.tag}: ${ign}`); if (instrMsg.deletable) await instrMsg.delete().catch(console.error); if (resp && resp.deletable) await resp.delete().catch(console.error); verifiedUsers[user.id]={discordName:user.username,discordTag:user.tag,inGameName:ign,timestamp:new Date().toISOString(),verifiedBy:message.author.id, lastPassUsage: 0, arkStrikes: 0, cannotReverifyUntil: 0 }; await saveData(); await logAction(`📥 ${user.tag}(${ign}) provided valid IGN via !add by ${message.author.tag}. Proceeding to rule confirmation.`); const confirmationEmoji = '✅'; const ruleMessageLink = `https://discord.com/channels/${PRIMARY_GUILD_ID}/${RULE_CHANNEL_ID}/${RULE_MESSAGE_ID}`; promptRuleMsg = await message.channel.send(`${user}, thank you for providing your In-Game Name!\n\n**Next Step: Rule Confirmation**\nPlease go to the rule message here: ${ruleMessageLink}\n\nOnce you have read and understood the rules, please confirm by reacting to **that specific rule message** with the ${confirmationEmoji} emoji.\n\nThe bot will wait for your reaction there for **1 hour**.`); console.log(`[DEBUG !add] Sent rule prompt to channel.`); let ruleChannel; let ruleMessage; try { ruleChannel = await message.guild.channels.fetch(RULE_CHANNEL_ID); if (!ruleChannel || !ruleChannel.isTextBased()) { throw new Error(`Rule channel (${RULE_CHANNEL_ID}) not found or not text-based.`); } ruleMessage = await ruleChannel.messages.fetch(RULE_MESSAGE_ID); if (!ruleMessage) { throw new Error(`Rule message (${RULE_MESSAGE_ID}) not found in channel ${RULE_CHANNEL_ID}.`); } console.log(`[DEBUG !add] Successfully fetched rule message: ${ruleMessage.id}`); } catch (fetchError) { console.error("[Verify] Error fetching rule channel or message:", fetchError); await message.channel.send(`❌ Error: Could not find the specified rule message. Please contact an admin. (${fetchError.message})`); await logAction(`🚨 CRITICAL ERROR during !add for ${user.tag}: Failed to fetch rule message/channel. Check RULE_CHANNEL_ID and RULE_MESSAGE_ID. ${fetchError.message}`); if (promptRuleMsg && promptRuleMsg.deletable) await promptRuleMsg.delete().catch(console.error); return; } const reactionFilter = (reaction, reactingUser) => { console.log(`[DEBUG !add Filter] Reaction: ${reaction.emoji.name}, Reacting User: ${reactingUser.tag} (${reactingUser.id}), Target User: ${user.tag} (${user.id})`); return reaction.emoji.name === confirmationEmoji && reactingUser.id === user.id; }; console.log(`[DEBUG !add] Starting awaitReactions for user ${user.id} on message ${ruleMessage.id}`); try { await ruleMessage.awaitReactions({ filter: reactionFilter, max: 1, time: 3600000, errors: ['time'] }); console.log(`[DEBUG !add] Reaction collected successfully from ${user.tag}!`); await logAction(`👍 ${user.tag}(${ign}) confirmed rules by reacting to message ${RULE_MESSAGE_ID}.`); try { console.log(`[DEBUG !add] Attempting to assign role ${ADMIN_PASS_ROLE_ID} to ${user.tag}`); const member = await message.guild.members.fetch(user.id); if (!member) throw new Error("Member left the guild during rule confirmation."); const role = message.guild.roles.cache.get(ADMIN_PASS_ROLE_ID); if(role){ await member.roles.add(role); await message.channel.send(`✅ ${user} has been successfully verified as \`${ign}\`, confirmed the rules by reacting, and the <@&${ADMIN_PASS_ROLE_ID}> role has been assigned!\n\n**Next Step:** You can now use the \`!pass\` command in the <#${PASS_CHANNEL_ID}> channel to start the process of getting the admin password. **Read the bot's messages carefully!**\n\nℹ️ *If you need help with the \`!pass\` command or the YouTube comment process, watch this short video guide: https://discord.com/channels/1225086237619130419/1320116951720132608/1364262389494710462*`); await logAction(` R> Role ${role.name} assigned to ${user.tag}(${ign}) after rule confirmation.`); console.log(`[DEBUG !add] Role assignment successful.`); } else { console.error(`[Verify] Role ${ADMIN_PASS_ROLE_ID} not found!`); await message.channel.send(`⚠️ Role <@&${ADMIN_PASS_ROLE_ID}> not found. ${user} verified as \`${ign}\` and saved to file, rules confirmed, but the role could not be assigned. Please contact an administrator.`); await logAction(` R> Rule ${ADMIN_PASS_ROLE_ID} NOT FOUND for ${user.tag}(${ign}) after rule confirmation.`); console.log(`[DEBUG !add] Role assignment failed: Role not found.`); } } catch(roleE){ console.error(`[Verify] Role assign err ${user.tag}:`,roleE.message); console.log(`[DEBUG !add] Error during role assignment: ${roleE.message}`); await message.channel.send(`⚠️ ${user} verified as \`${ign}\`, rules confirmed, but there was an error assigning the role: ${roleE.message}. Please contact an administrator.`); await logAction(` R> ROLE ASSIGN FAIL for ${user.tag}(${ign}): ${roleE.message}.`); } } catch (reactionError) { console.log(`[DEBUG !add] awaitReactions failed or timed out.`); const reactionChannel = message.channel ?? await client.channels.fetch(message.channelId).catch(() => null); if (reactionError instanceof Collection && reactionError.size === 0) { if (reactionChannel) { await reactionChannel.send(`⏰ Rule confirmation time limit (1 hour waiting for reaction on rule message) expired for ${user}. Role not assigned. Please ask an admin to restart the process if needed.`); } else { console.warn(`[Verify Timeout] Original channel for ${user.tag} no longer available.`);} await logAction(`⏱️ Rule confirmation for ${user.tag}(${ign}) timed out (waiting on message ${RULE_MESSAGE_ID}). Role NOT assigned.`); } else { console.error(`[Verify] Error awaiting rule reaction on ${RULE_MESSAGE_ID} for ${user.tag}:`, reactionError); await logAction(`🚨 ERROR awaiting rule reaction on message ${RULE_MESSAGE_ID} for ${user.tag}(${ign}): ${reactionError.message}`); if(reactionChannel) await reactionChannel.send("❌ Oops! An internal error occurred. Incident logged."); } } finally { if (promptRuleMsg && promptRuleMsg.deletable) await promptRuleMsg.delete().catch(console.error); } } catch (ignError) { const ignErrorChannel = message.channel ?? await client.channels.fetch(message.channelId).catch(() => null); if (ignError instanceof Collection && ignError.size === 0) { if(ignErrorChannel) await ignErrorChannel.send(`⏰ Verification time limit (24 hours for IGN) expired for ${user}. Please ask an admin to restart the process if needed.`); await logAction(`⏱️ IGN verification for ${user.tag} by ${message.author.tag} expired.`); } else { console.error(`[Verify] Error during IGN collection for ${user.tag}:`, ignError); await logAction(`🚨 ERROR during !add IGN collection for ${user.tag}: ${ignError.message}`); if(ignErrorChannel) await ignErrorChannel.send("❌ Oops! An internal error occurred. Incident logged."); } if (instrMsg && instrMsg.deletable) await instrMsg.delete().catch(console.error); if (resp && resp.deletable) await resp.delete().catch(console.error); if (promptRuleMsg && promptRuleMsg.deletable) await promptRuleMsg.delete().catch(console.error); } return; }
        if (message.content.startsWith('!forceadd ')) { if (!await requireAdmin()) return; const args = message.content.slice(10).trim().split(/ +/); const user=message.mentions.users.first(); if (!user || args.length<2) { await message.reply("ℹ️ **Usage:** `!forceadd @User InGameName`\nExample: `!forceadd @ExampleUser Player 123`"); return; } const mentionStr=args[0]; const nameStartIdx=message.content.indexOf(mentionStr)+mentionStr.length; const ign=message.content.slice(nameStartIdx).trim(); if(!ign){ await message.reply("ℹ️ In-Game Name is missing."); return; } const nameRgx=/^[a-zA-Z0-9 ]{3,16}$/; if(!nameRgx.test(ign)){ await message.reply("❌ Invalid In-Game Name format (3-16 chars, letters/numbers/spaces)."); return; } if(verifiedUsers[user.id]){ await message.reply(`⚠️ User ${user.tag} is already verified as \`${verifiedUsers[user.id].inGameName}\`. Use !change or !remove.`); return; } if(bannedUsers[user.id]){ await message.reply(`⚠️ User ${user.tag} is banned.`); return; } if (BANNED_FROM_VERIFICATION_ROLE_ID) { try { const memberToForceAdd = await message.guild.members.fetch(user.id); if (memberToForceAdd.roles.cache.has(BANNED_FROM_VERIFICATION_ROLE_ID)) { await message.reply(`❌ User ${user.tag} has a role that prevents them from being force-added.`); await logAction(`🚫 Force-add attempt blocked for ${user.tag} due to having role ID ${BANNED_FROM_VERIFICATION_ROLE_ID}.`); return; } } catch (fetchErr) { await message.reply(`ℹ️ Could not fully check roles for ${user.tag} for force-add. Process halted.`); console.error(`[ForceAdd Check Role] Failed to fetch member ${user.tag}:`, fetchErr); await logAction(`⚠️ Failed to fetch member ${user.tag} during role check for !forceadd command. Force-add halted.`); return; } } verifiedUsers[user.id]={discordName:user.username,discordTag:user.tag,inGameName:ign,timestamp:new Date().toISOString(),verifiedBy:message.author.id,forced:true, lastPassUsage: 0, arkStrikes: 0, cannotReverifyUntil: 0 }; await saveData(); try{ const member=await message.guild.members.fetch(user.id); const role=message.guild.roles.cache.get(ADMIN_PASS_ROLE_ID); if(role){ await member.roles.add(role); await message.reply(`✅ ${user} has been directly added as \`${ign}\` & role <@&${ADMIN_PASS_ROLE_ID}> assigned! They can now use \`!pass\` in <#${PASS_CHANNEL_ID}>. (Rules confirmation bypassed)`); await logAction(`🛠️ ${user.tag}(${ign}) force-added by ${message.author.username}, role ${role.name} assigned.`); } else { console.error(`[ForceAdd] Role ${ADMIN_PASS_ROLE_ID} not found!`); await message.reply(`⚠️ Role <@&${ADMIN_PASS_ROLE_ID}> not found. ${user} added as \`${ign}\` to file, no role assigned. Check config.`); await logAction(`🛠️ ${user.tag}(${ign}) force-added, BUT ROLE ${ADMIN_PASS_ROLE_ID} NOT FOUND.`); }} catch(roleE){ if(roleE.code===10007||roleE.code===10013){ await message.reply(`✅ ${user} added as \`${ign}\` to file. Role fail (User not on server?).`); await logAction(`🛠️ ${user.tag}(${ign}) force-added, ROLE SKIP (User not found).`); } else { console.error('[ForceAdd] Role err:',roleE); await message.reply(`⚠️ ${user} added as \`${ign}\`, but error assigning role: ${roleE.message}.`); await logAction(`🛠️ ${user.tag}(${ign}) force-added, ROLE FAIL: ${roleE.message}.`); }} return; }
        if (message.content === '!list') { if (!await requireAdmin()) return; try{ const arr=Object.entries(verifiedUsers).map(([id,d])=>({id,...d,date:d.timestamp?new Date(d.timestamp):new Date(0)})).sort((a,b)=>b.date-a.date); const entries=arr.slice(0,10).map(e=>`• <@${e.id}> (\`${e.inGameName}\`) - ${e.date.toLocaleDateString('en-US')}`); const embed=new EmbedBuilder().setColor(0x00FF00).setTitle("📜 Last 10 Verified (File)").setDescription(entries.length>0?entries.join('\n'):"File empty.").setFooter({text:`Total in file: ${arr.length}`}).setTimestamp(); await message.channel.send({embeds:[embed]});} catch(e){console.error('List err:',e); await message.reply("❌ Oops! An internal error occurred. Incident logged."); await logAction(`🚨 ERROR !list: ${e.message}`);} return; }
        if (message.content === '!fulllist') { if (!await requireAdmin()) return; if(Object.keys(verifiedUsers).length===0){await message.reply("ℹ️ Verification file empty."); return;} try{ const h="Tag,IGN,ID,Timestamp,LastPassUsage,ArkStrikes,CannotReverifyUntil\n"; const c=Object.entries(verifiedUsers).map(([id,d])=>`"${(d.discordTag||d.discordName||'?').replace(/"/g,'""')}","${(d.inGameName||'?').replace(/"/g,'""')}",${id},${d.timestamp?new Date(d.timestamp).toISOString():'?'},${d.lastPassUsage ? new Date(d.lastPassUsage).toISOString() : 'N/A'},${d.arkStrikes || 0},${d.cannotReverifyUntil ? new Date(d.cannotReverifyUntil).toISOString() : 'N/A'}`).join('\n'); const fn=`verified_${Date.now()}.csv`; await fs.writeFile(fn,h+c,'utf8'); await message.channel.send({content: `📊 Full list from file (${Object.keys(verifiedUsers).length} entries):`, files:[fn]}); await fs.unlink(fn); await logAction(`📄 ${message.author.username} exported file list (!fulllist).`);} catch(e){console.error('[FullList Err]:',e); await message.reply("❌ Oops! An internal error occurred. Incident logged."); await logAction(`🚨 ERROR !fulllist: ${e.message}`);} return; }
        if (message.content.startsWith('!send ')) { if (!await requireAdmin()) return; const txt=message.content.slice(5).trim(); if(!txt){await message.reply("ℹ️ Missing required argument(s)."); return;} const role=message.guild.roles.cache.get(ADMIN_PASS_ROLE_ID); if(!role){await message.reply(`❌ Role <@&${ADMIN_PASS_ROLE_ID}> not found on this server!`); return;} await message.guild.members.fetch(); const members=message.guild.members.cache.filter(m=>m.roles.cache.has(ADMIN_PASS_ROLE_ID)); if(members.size===0){await message.reply(`ℹ️ No members have <@&${ADMIN_PASS_ROLE_ID}> role.`); return;} let sent=0,failed=[],skippedB=[],total=members.size,proc=0; const statMsg=await message.channel.send(`📨 Sending to ${total} members with ${role.name} role...`); for(const [memberId, m] of members){ proc++; if(proc%10===0||proc===total) await statMsg.edit(`Progress: ${proc}/${total} (OK:${sent}, Fail:${failed.length}, Skip:${skippedB.length})`).catch(console.error); if(bannedUsers[memberId]){skippedB.push(memberId); continue;} try{ await m.user.send(txt); sent++; await new Promise(r=>setTimeout(r,400)); } catch(e){ let rsn=e.message; if(e.code===50007)rsn="DM blocked"; else if(e.code===40003){rsn="Rate Limit"; await new Promise(r=>setTimeout(r,e.retryAfter?e.retryAfter*1e3:2e3));} console.error(`[Send Role] Fail ${m.user.tag}:`,rsn); failed.push({id:m.id,name:m.user.tag,error:rsn}); await new Promise(r=>setTimeout(r,200));}} const embed=new EmbedBuilder().setTitle(`📨 Dispatch Results (Role: <@&${ADMIN_PASS_ROLE_ID}>)`).setColor(failed.length>0?0xFFCC00:0x00FF00).addFields({name:'Attempted',value:`${total}`,inline:true},{name:'Sent OK',value:`${sent}`,inline:true},{name:'Failed',value:`${failed.length}`,inline:true},{name:'Banned (skip)',value:`${skippedB.length}`,inline:true}).setTimestamp(); if(failed.length>0)embed.addFields({name:'Fail Details (Excerpt)',value:failed.slice(0,5).map(f=>`${f.name}: ${f.error}`).join('\n')||'N/A'}); await statMsg.edit({content:`✅ Dispatch complete!`,embeds:[embed]}); await logAction(`📢 ${message.author.username} !send to role <@&${ADMIN_PASS_ROLE_ID}>. ${sent}/${total} OK, ${failed.length} fail, ${skippedB.length} banned.`); return; }
        if (message.content.startsWith('!remove ')) { if (!await requireAdmin()) return; const input=message.content.slice(8).trim(); let idToRemove=null; let identifier=input; const mention=message.mentions.users.first(); if(mention){idToRemove=mention.id;identifier=mention.tag;} else{const found=Object.entries(verifiedUsers).find(([id,d])=>d.inGameName.toLowerCase()===input.toLowerCase()); if(found){idToRemove=found[0];identifier=found[1].inGameName;}else if(/^\d+$/.test(input)){idToRemove=input;identifier=`ID ${input}`;}} if(!idToRemove){await message.reply(`ℹ️ User "${input}" not found or could not be identified.`); return;} let wasInFile=false; let ign='N/A'; let tag=identifier; if(verifiedUsers[idToRemove]){wasInFile=true; const d=verifiedUsers[idToRemove];ign=d.inGameName;tag=d.discordTag||d.discordName||identifier; delete verifiedUsers[idToRemove]; await saveData();}else{tag=(await client.users.fetch(idToRemove).catch(()=>null))?.tag||identifier;} let roleRemoved=false; try{const m=await message.guild.members.fetch(idToRemove).catch(()=>null); if(m){const r=message.guild.roles.cache.get(ADMIN_PASS_ROLE_ID); if(r&&m.roles.cache.has(r.id)){await m.roles.remove(r);roleRemoved=true;}}}catch(e){console.error(`[Remove] Role err ${idToRemove}:`,e.message); await message.channel.send(`⚠️ Error removing role from ${tag}. Check logs.`);} let responseMsg = ''; const memberExists = await message.guild.members.fetch(idToRemove).then(() => true).catch(() => false); if(wasInFile && roleRemoved) responseMsg = `🗑️ Removed "${ign}" (${tag}) from file. Role <@&${ADMIN_PASS_ROLE_ID}> removed.`; else if(wasInFile && !roleRemoved) { responseMsg = memberExists ? `🗑️ Removed "${ign}" (${tag}) from file. User lacked role/role not found.` : `🗑️ Removed "${ign}" (${tag}) from file. User not on server.`; } else if(!wasInFile && roleRemoved) responseMsg = `ℹ️ User ${tag} not in file. Role <@&${ADMIN_PASS_ROLE_ID}> removed (if they had it).`; else { responseMsg = memberExists ? `ℹ️ User ${tag} not in file. User lacked role/role not found.` : `ℹ️ User ${tag} not in file. User not on server.`; } await message.channel.send(responseMsg); await logAction(`📤 ${message.author.username} !remove ${tag}. File:${wasInFile}. Role:${roleRemoved}.`); return; }
        if (message.content.startsWith('!bann ')) { if (!await requireAdmin()) return; const input=message.content.slice(6).trim(); let idToBan=null; let identifier=input; let uData=null; const mention=message.mentions.users.first(); if(mention){idToBan=mention.id;identifier=mention.tag;uData=verifiedUsers[idToBan];}else{const found=Object.entries(verifiedUsers).find(([id,d])=>d.inGameName.toLowerCase()===input.toLowerCase());if(found){idToBan=found[0];uData=found[1];identifier=uData.inGameName;}else if(/^\d+$/.test(input)){idToBan=input;identifier=`ID ${input}`;uData=verifiedUsers[idToBan];}} if(!idToBan){if(!mention&&!/^\d+$/.test(input)){try{const m=message.guild.members.cache.find(mem=>mem.user.tag.toLowerCase()===input.toLowerCase()) || await message.guild.members.fetch({ query: input, limit: 1 }).then(col => col.first()).catch(() => null);if(m){idToBan=m.id;identifier=m.user.tag;}} catch(e){console.warn("Error searching member by tag:", e.message)}}if(!idToBan){await message.reply(`ℹ️ User "${input}" not found or could not be identified.`);return;}} if(identifier.startsWith('ID ')){const u=await client.users.fetch(idToBan).catch(()=>null);if(u)identifier=u.tag;} if(bannedUsers[idToBan]){await message.reply(`⚠️ User ${identifier} is already banned.`);return;} const nameBan=uData?uData.inGameName:identifier; let rmFile=false; if(verifiedUsers[idToBan]){delete verifiedUsers[idToBan]; rmFile=true;} bannedUsers[idToBan]={bannedBy:message.author.id,timestamp:new Date().toISOString(),originalName:nameBan}; await saveData(); let rmRole=false; try{const m=await message.guild.members.fetch(idToBan).catch(()=>null); if(m){const r=message.guild.roles.cache.get(ADMIN_PASS_ROLE_ID); if(r&&m.roles.cache.has(r.id)){await m.roles.remove(r);rmRole=true;}}}catch(e){console.error(`[Bann] Role err ${idToBan}:`,e.message);} await message.channel.send(`🔨 User "${nameBan}" (${identifier}) banned! ${rmFile?'File entry removed.':''} ${rmRole?'Role removed.':''}`); await logAction(`🚫 ${identifier}(as "${nameBan}") banned by ${message.author.username}. File:${rmFile}. Role:${rmRole}.`); return; }
        if (message.content.startsWith('!rem_bann ')) { if (!await requireAdmin()) return; const args=message.content.split(' '); const mention=message.mentions.users.first(); let idToUnban=null; let identifier='?'; if(mention){idToUnban=mention.id;identifier=mention.tag;}else if(args.length===2&&/^\d+$/.test(args[1])){idToUnban=args[1];identifier=`ID ${args[1]}`;}else{await message.reply("ℹ️ Usage: `!rem_bann @User` or `!rem_bann USER_ID`"); return;} if(!bannedUsers[idToUnban]){await message.reply(`ℹ️ User ${identifier} is not banned.`); return;} const name=bannedUsers[idToUnban].originalName||identifier; delete bannedUsers[idToUnban]; await saveData(); if(identifier.startsWith('ID ')){const u=await client.users.fetch(idToUnban).catch(()=>null);if(u)identifier=u.tag;} await message.channel.send(`🔓 Ban for "${name}" (${identifier}) lifted!`); await logAction(`🔄 ${identifier}(was "${name}") unbanned by ${message.author.username}.`); return; }
        if (message.content.startsWith('!show ')) { if (!await requireAdmin()) return; const input=message.content.slice(6).trim(); let idShow=null; let dShow=null; const mention=message.mentions.users.first(); if(mention){idShow=mention.id;}else{const found=Object.entries(verifiedUsers).find(([id,d])=>d.inGameName.toLowerCase()===input.toLowerCase());if(found)idShow=found[0];else if(/^\d+$/.test(input))idShow=input;} if(idShow&&verifiedUsers[idShow]){dShow=verifiedUsers[idShow];}else{const userExists = await client.users.fetch(idShow).catch(() => null); const tag = userExists ? userExists.tag : input; await message.reply(`ℹ️ User "${tag}" not found in verification file.`); return;} const embed=new EmbedBuilder().setTitle(`Verification File Info: ${dShow.inGameName}`).setColor(0x3498DB).addFields({name:'Tag',value:dShow.discordTag||'N/S',inline:true},{name:'ID',value:idShow,inline:true},{name:'IGN',value:dShow.inGameName,inline:true},{name:'Verified At',value:dShow.timestamp?new Date(dShow.timestamp).toLocaleString('en-US'):'?',inline:false},{name:'Last !pass Used', value: dShow.lastPassUsage ? new Date(dShow.lastPassUsage).toLocaleString('en-US') : 'Never', inline: false}, {name: 'ARK Strikes', value: `${dShow.arkStrikes || 0}`, inline: true}, {name: 'Cannot Re-verify Until', value: dShow.cannotReverifyUntil ? new Date(dShow.cannotReverifyUntil).toLocaleString('en-US') : 'N/A', inline: true}).setTimestamp(); if(dShow.verifiedBy){const admin=await client.users.fetch(dShow.verifiedBy).catch(()=>null);embed.addFields({name:'Verified By',value:admin?admin.tag:`ID: ${dShow.verifiedBy}`,inline:false});} if(dShow.forced)embed.addFields({name:'Note',value:'Directly added (forceadd)',inline:false}); await message.channel.send({embeds:[embed]}); return; }
        if (message.content === '!show_banned') { if (!await requireAdmin()) return; const bannedEntries=Object.entries(bannedUsers); if(bannedEntries.length===0){await message.reply("📭 Ban list empty."); return;} const listItems=await Promise.all(bannedEntries.map(async([id,d])=>{const u=await client.users.fetch(id).catch(()=>null);const tag=u?u.tag:`ID:${id}`;const name=d.originalName||'?';const ts=d.timestamp?new Date(d.timestamp).toLocaleDateString('en-US'):'?';const admin=d.bannedBy?await client.users.fetch(d.bannedBy).catch(()=>null):null;const by=admin?`by ${admin.tag}`:'by ?'; return `• ${tag} (as \`${name}\`) - On ${ts} ${by}`; })); let currentMsg = `🚫 Banned Users (${bannedEntries.length}):\n`; const MAX_LEN=1950; for(const item of listItems){if(currentMsg.length+item.length+2>MAX_LEN){await message.channel.send(currentMsg);currentMsg=item+'\n';}else{currentMsg+=item+'\n';}} await message.channel.send(currentMsg); return; }
        if (message.content.startsWith('!accountage ')) { if (!await requireAdmin()) return; const user=message.mentions.users.first(); if(!user){await message.reply("ℹ️ Please mention a user."); return;} const created=user.createdAt; const ageMs=Date.now()-created.getTime(); const ageD=Math.floor(ageMs/(864e5)); const ageY=Math.floor(ageD/365); const remD=ageD%365; const ageS=`${ageY}y ${remD}d (Total ${ageD}d)`; const embed=new EmbedBuilder().setTitle(`Acc Age: ${user.tag}`).setColor(0xF1C40F).addFields({name:'User',value:user.tag,inline:true},{name:'ID',value:user.id,inline:true},{name:'Age',value:ageS,inline:false},{name:'Created',value:created.toLocaleString('en-US'),inline:false}).setThumbnail(user.displayAvatarURL()).setTimestamp(); await message.channel.send({embeds:[embed]}); return; }
        if (message.content === '!rolecheck') { if (!await requireAdmin()) return; const userRole = message.guild.roles.cache.get(ADMIN_PASS_ROLE_ID); if(!userRole){await message.reply(`❌ Role <@&${ADMIN_PASS_ROLE_ID}> not found on this server!`); return;} await message.channel.send(`🔄 Checking file vs role <@&${ADMIN_PASS_ROLE_ID}>...`); await message.guild.members.fetch(); const membersWithRole = message.guild.members.cache.filter(m=>m.roles.cache.has(ADMIN_PASS_ROLE_ID)); const fileIDs=Object.keys(verifiedUsers); const bannedIDs=Object.keys(bannedUsers); const fileMissingRole = fileIDs.filter(id=>!membersWithRole.has(id)&&!bannedIDs.includes(id) && !(verifiedUsers[id]?.cannotReverifyUntil && Date.now() < verifiedUsers[id].cannotReverifyUntil) ); const roleMissingFile = [...membersWithRole.keys()].filter(id=>!verifiedUsers[id]&&!bannedIDs.includes(id)); const embed=new EmbedBuilder().setTitle(`🔍 Role Check (<@&${ADMIN_PASS_ROLE_ID}>)`).setColor(fileMissingRole.length>0||roleMissingFile.length>0?0xE74C3C:0x2ECC71).setTimestamp(); const createF=(t,ids)=>{if(ids.length===0)return{name:t,value:'✅ OK',inline:false};const MAX_DISPLAY = 15; const displayedIds = ids.slice(0, MAX_DISPLAY).map(id=>`<@${id}>`).join(', '); const moreCount = ids.length > MAX_DISPLAY ? ` (...${ids.length - MAX_DISPLAY} more)` : ''; return { name:`⚠️ ${t} (${ids.length})`, value: displayedIds + moreCount || 'None', inline:false }; }; embed.addFields(createF(`In File, MISSING Role`,fileMissingRole),createF(`Has Role, MISSING in File`,roleMissingFile)); await message.channel.send({embeds:[embed]}); await logAction(`📊 ${message.author.username} ran !rolecheck for ${userRole.name}.`); return; }
        if (message.content.startsWith('!change ')) { if (!await requireAdmin()) return; const args = message.content.slice(8).trim().split(/ +/); if(args.length<2){await message.reply("ℹ️ Usage: `!change @User NewIGN`"); return;} const user=message.mentions.users.first(); if(!user){await message.reply("ℹ️ Please mention a user."); return;} const mentionEnd=message.content.indexOf('>')+1; const newName=message.content.slice(mentionEnd).trim(); if(!verifiedUsers[user.id]){await message.reply(`ℹ️ User "${user.tag}" not found in verification file.`); return;} const nameRegex=/^[a-zA-Z0-9 ]{3,16}$/; if(!nameRegex.test(newName)){await message.reply("❌ Invalid IGN format."); return;} const oldName=verifiedUsers[user.id].inGameName; verifiedUsers[user.id].inGameName=newName; verifiedUsers[user.id].timestamp=new Date().toISOString(); verifiedUsers[user.id].changedBy=message.author.id; await saveData(); await message.channel.send(`✏️ IGN for ${user.toString()} changed: \`${oldName}\` -> \`${newName}\` (in file).`); await logAction(`🔄 ${message.author.username} changed IGN for ${user.tag}: "${oldName}" -> "${newName}".`); return; }

        // --- Fallback for unknown commands ---
        if (message.content.startsWith('!')) { const hasAdminRoleCheck = message.member?.roles.cache.has(ADMIN_ROLE_ID) ?? false; if (!hasAdminRoleCheck) { await message.reply("❌ Unknown command or insufficient permissions. Use `!pass` or `!joinark` if eligible. Incident logged."); await logAction(`⚠️ Unauthorized/Unknown cmd by ${message.author.tag}: ${message.content}`); } else { await message.reply("❌ Unknown command."); await logAction(`⚠️ Unknown command by ADMIN ${message.author.tag}: ${message.content}`); } return; }
    } catch (error) { console.error('[Command Error]:', error); const errorReply = "❌ Oops! An internal error occurred. Incident logged."; if (message.channel) { await message.reply(errorReply).catch(async () => { try { await message.channel.send(`${message.author}, ${errorReply}`); } catch (sendErr) { console.error("Failed to send error message to channel:", sendErr); } }); } else { console.error("Error occurred but message.channel is unavailable."); try { await message.author.send(errorReply + " (Original channel was unavailable)"); } catch (dmErr) { console.error("Failed to DM error message to user:", dmErr); } } await logAction(`🚨 **CRITICAL CMD ERROR Details** by ${message.author.tag} in #${message.channel?.name || 'DM/Unknown'} Cmd:${message.content.slice(0,200)} Err:${error.message}\n\`\`\`${error.stack?.slice(0, 1000)}\`\`\``); }
});

// --- Bot Startup ---
client.on('ready', async () => {
    console.log(`[Bot] Logged in: ${client.user.tag}`);
    console.log(`[Bot] Monitoring ${client.guilds.cache.size} servers.`);
    client.user.setActivity('YouTube & ARK Server', { type: 'WATCHING' });
    await loadData();
    arkActivityCheckTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    arkActivityCheckTimeouts.clear();
    console.log(`[ARK Activity] Cleared any pending activity check timeouts on startup.`);
    for (const userId in activeArkPlayers) {
        if (activeArkPlayers.hasOwnProperty(userId)) {
            const playerData = activeArkPlayers[userId];
            const lastActiveTime = playerData.lastConfirmedActiveAt || playerData.joinedAt;
            if(lastActiveTime){
                const timeSinceLastActive = Date.now() - lastActiveTime;
                let remainingTimeForNextPrompt = ARK_ACTIVITY_CHECK_DURATION_MS - timeSinceLastActive;
                if (remainingTimeForNextPrompt <= 0) {
                    console.log(`[ARK Activity Startup] User ${userId} activity check is overdue. Prompting now.`);
                    promptArkActivityConfirmation(userId);
                } else {
                     const newTimeoutId = setTimeout(() => {
                        if (activeArkPlayers[userId]) { promptArkActivityConfirmation(userId); }
                        arkActivityCheckTimeouts.delete(userId);
                    }, remainingTimeForNextPrompt);
                    arkActivityCheckTimeouts.set(userId, newTimeoutId);
                    console.log(`[ARK Activity Startup] Rescheduled activity check for user ${userId} in ~${Math.round(remainingTimeForNextPrompt / 60000)} min.`);
                }
            } else if (playerData.joinedAt) {
                const timeSinceJoined = Date.now() - playerData.joinedAt;
                let remainingTimeForFirstPrompt = ARK_ACTIVITY_CHECK_DURATION_MS - timeSinceJoined;
                if (remainingTimeForFirstPrompt <=0) {
                    console.log(`[ARK Activity Startup] User ${userId} first activity check is overdue. Prompting now.`);
                    promptArkActivityConfirmation(userId);
                } else {
                     const newTimeoutId = setTimeout(() => {
                        if (activeArkPlayers[userId]) { promptArkActivityConfirmation(userId); }
                        arkActivityCheckTimeouts.delete(userId);
                    }, remainingTimeForFirstPrompt);
                    arkActivityCheckTimeouts.set(userId, newTimeoutId);
                    console.log(`[ARK Activity Startup] Rescheduled first activity check for user ${userId} in ~${Math.round(remainingTimeForFirstPrompt / 60000)} min.`);
                }
            }
        }
    }
    try { const logCh = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null); if (logCh?.isTextBased()) { await logCh.send(`✅ Bot started! ARK Features & Activity Checks Active. (${new Date().toLocaleString('en-US')})`); } } catch (e) { console.warn(`[Startup] Log channel msg fail: ${e.message}`); }
    console.log(`[Inactivity] Scheduling user inactivity check every ${INACTIVITY_CHECK_INTERVAL_HOURS} hours.`);
    setTimeout(checkUserInactivity, 10000);
    if (inactivityCheckIntervalId) clearInterval(inactivityCheckIntervalId);
    inactivityCheckIntervalId = setInterval(checkUserInactivity, INACTIVITY_CHECK_INTERVAL_MS);
});

// --- Bot Login ---
client.login(TOKEN).catch(error => { console.error('[Login Error]:', error.message); if (error.code === 'DisallowedIntents') console.error('>> Check Bot Intents in Developer Portal!'); else if (error.code === 'TokenInvalid') console.error('>> Invalid TOKEN in .env file!'); process.exit(1); });

// --- Error Handling ---
process.on('unhandledRejection', error => { console.error('[Unhandled Rejection]:', error); logAction(`🚨 FATAL (Unhandled Rejection): ${error.message}\n\`\`\`${error.stack?.slice(0,1500)}\`\`\``).catch(console.error); });
process.on('uncaughtException', error => { console.error('[Uncaught Exception]:', error); logAction(`🚨 FATAL (Uncaught Exception): ${error.message}\n\`\`\`${error.stack?.slice(0,1500)}\`\`\``).catch(console.error); process.exit(1); });

console.log('[System] Bot script starting...');
