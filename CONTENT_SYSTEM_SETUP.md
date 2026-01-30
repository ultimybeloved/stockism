# Stockism Content Generation System

## What's Been Built

I've created an automated content generation system for YouTube Shorts that:

1. **Monitors your game** for interesting events (price movements, volume spikes, daily movers)
2. **Generates professional videos** (1080x1920 vertical format for Shorts)
3. **Queues content for review** in your Admin Panel
4. **Provides approval workflow** before publishing

---

## What Was Added

### 1. Video Generation Engine (`functions/videoGenerator.js`)

Creates three types of videos:

**Character Spotlight** (15-20 seconds)
- Highlights trending characters with unusual price/volume activity
- Shows: Character name, price, % change, volume, timeframe
- Hook examples: "Gun Park IS TRENDING", "Everyone's watching Daniel Park"

**Market Movers** (20-30 seconds)
- Top 3 gainers or losers for the day
- Shows ranked list with % changes
- Generated daily at market close (4 PM EST)

**Drama Events** (15-25 seconds)
- Big moments: achievements, liquidations, price spikes >30%
- Alert-style format with bold text and stats
- Can be triggered manually for special events

**Visual Style:**
- Dark professional theme (not flashy/childish)
- Bold readable text with shadows
- Character images (when available)
- Clean animations
- "stockism.app" call-to-action

### 2. Content Monitoring (`functions/contentGeneration.js`)

**Scheduled Functions:**
- `generateMarketContent` - Runs every 2 hours, finds characters with >15% moves or high volume
- `generateDailyMovers` - Runs at 4 PM EST daily, creates top gainers/losers videos

**Manual Trigger:**
- `generateDramaVideo` - Call this when big events happen (admin function)

**Admin Functions:**
- `listPendingContent` - Get queue of videos to review
- `approveContent` - Mark video as approved (ready to publish)
- `rejectContent` - Mark video as rejected (discard)

### 3. Admin Panel Integration

**Content Queue Tab:**
- Component created at `src/components/ContentQueueTab.jsx`
- Shows all pending videos with preview
- Approve/reject buttons
- Displays video metadata (character, stats, type)
- Download links for manual posting

---

## Setup Required

### Step 1: Add Content Tab to Admin Panel

You need to add the Content tab to your Admin Panel UI. Here's what to add:

**In `src/AdminPanel.jsx`, add the tab content section:**

Find the line that says `{/* RECOVERY TAB */}` and after that closing `)}`, add:

```jsx
{/* CONTENT TAB */}
{activeTab === 'content' && (
  <div className="px-4 pb-4">
    <ContentQueueTab darkMode={darkMode} />
  </div>
)}
```

**Add the tab button** (find the tabs section with other buttons like "🔧 Recovery"):

After the Recovery button, add:

```jsx
<button
  onClick={() => setActiveTab('content')}
  className={`py-2.5 text-xs font-semibold transition-colors ${activeTab === 'content' ? 'text-pink-500 border-b-2 border-pink-500 bg-pink-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
>
  🎬 Content
</button>
```

### Step 2: Deploy Cloud Functions

```bash
cd functions
npm install
firebase deploy --only functions
```

This deploys:
- `generateMarketContent` (scheduled every 2 hours)
- `generateDailyMovers` (scheduled daily at 4 PM EST)
- `generateDramaVideo` (callable)
- `listPendingContent`, `approveContent`, `rejectContent` (admin functions)

### Step 3: Set Up Cloud Storage

Your Firebase project needs a Cloud Storage bucket (it should already have one). Videos will be stored in the `content/` folder.

### Step 4: Test the System

1. **Manual test**: In your admin panel, you can call the drama video generator with test data
2. **Wait for scheduled run**: The system will automatically generate content when it detects interesting market activity
3. **Check Admin Panel**: Go to the "🎬 Content" tab to see pending videos
4. **Review and approve**: Click preview to see the video, approve to mark it ready

---

## YouTube Shorts Publishing

### Option A: Manual (Immediate)

1. Videos appear in Content Queue with download links
2. Click "Preview Video" to download
3. Upload manually to YouTube Shorts:
   - Use YouTube Studio
   - Upload as Short (vertical video)
   - Add title and description (auto-generate based on content type)
   - Publish

### Option B: API Integration (Future Enhancement)

To auto-post to YouTube, you'll need:

1. **YouTube Data API v3 credentials**
   - Go to Google Cloud Console
   - Enable YouTube Data API v3
   - Create OAuth 2.0 credentials
   - Add authorized redirect URIs

2. **Add YouTube auth function**
   ```javascript
   // functions/youtubePublisher.js
   const { google } = require('googleapis');

   async function publishToYouTube(videoPath, title, description) {
     const youtube = google.youtube('v3');
     // Upload video with proper metadata
     // Mark as YouTube Short (vertical video)
   }
   ```

3. **Update approved content to auto-publish**

**Note:** YouTube API has quotas and requires approval. Manual posting is easier to start.

---

## Content Strategy

Based on research, here's what will perform best:

**Hook (First 2 seconds):**
- "Gun Park holders just made 34% this week"
- "Everyone's sleeping on Samuel Seo"
- "3 stocks moved 40%+ today"

**Content Mix:**
- 70% Character Spotlights (consistent, algorithm-friendly)
- 20% Market Movers (daily recap, reliable engagement)
- 10% Drama Events (when they happen, highest viral potential)

**Posting Schedule:**
- 1-2 videos per day (consistency > quantity)
- Post at peak times: 12 PM EST, 6 PM EST, 9 PM EST
- Review before posting to maintain quality

**Titles:**
- "Gun Park Up 34% This Week 📈"
- "Top 3 Losers Today | Stockism"
- "Daniel Park Most Traded Stock 3 Days Straight"

**Description Template:**
```
[Character/Event description]

Play the Lookism stock market game:
👉 stockism.app

#stockmarket #lookism #stocks #trading #investing
```

---

## Monitoring & Adjusting

**Week 1-2:** Manual posting only
- Review all generated videos
- See which styles get best engagement
- Adjust hooks and formats

**Week 3+:** Increase frequency
- Post 1-2x daily
- Mix content types based on what's working
- Eventually consider API integration if volume is high

**Analytics to track:**
- Views per video type
- Engagement rate (likes, comments, shares)
- Click-through to stockism.app
- New user signups from YouTube traffic

---

## Troubleshooting

**Video generation fails:**
- Check Cloud Functions logs: `firebase functions:log`
- Ensure canvas/ffmpeg dependencies installed
- Check Cloud Storage permissions

**No videos appearing in queue:**
- Verify scheduled functions are running
- Check market has sufficient activity (>15% price moves, >300 volume)
- Manually trigger test video to verify system works

**Can't see Content tab:**
- Verify ContentQueueTab component is imported
- Check tab button was added to Admin Panel
- Verify you're logged in as admin

**Video quality issues:**
- Templates are in `functions/videoGenerator.js`
- Adjust fonts, colors, layouts as needed
- Test locally before deploying

---

## Next Steps

1. **Add Content tab to Admin Panel** (see Step 1 above)
2. **Deploy functions**: `firebase deploy --only functions`
3. **Test**: Wait for scheduled run or trigger manually
4. **Review first video** in Admin Panel
5. **Post to YouTube Shorts** manually
6. **Monitor performance** and adjust

Once you have several videos posted and see what's working, we can optimize the templates, hooks, and posting strategy.

---

## Cost Estimate

**Firebase costs (monthly):**
- Cloud Functions: ~$2-5 (video generation compute)
- Cloud Storage: ~$1-2 (video files, cleaned up after posting)
- Firestore: ~$0.50 (content queue metadata)

**Total: ~$5-10/month** for automated content generation

**ROI:** If even 1% of viewers become players, this pays for itself quickly.
