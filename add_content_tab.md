# Adding the Content Tab to Admin Panel

The Content Queue component is ready, but needs to be added to the Admin Panel tabs. Here's exactly what to do:

## Step 1: Find the Recovery Tab Content

Open `src/AdminPanel.jsx` and search for:
```
{/* RECOVERY TAB */}
{activeTab === 'recovery' && (
```

## Step 2: Scroll down to find the closing of the Recovery tab

Look for the closing `)}` for the Recovery tab (it will be after all the recovery content).

## Step 3: Add the Content tab content

Right after that closing `)}`, add this code:

```jsx
{/* CONTENT TAB */}
{activeTab === 'content' && (
  <div className="px-4 pb-4">
    <ContentQueueTab darkMode={darkMode} />
  </div>
)}
```

## Step 4: Add the Content tab button

Find the tab buttons section (look for the Recovery button):
```jsx
<button
  onClick={() => setActiveTab('recovery')}
  className={...}
>
  🔧 Recovery
</button>
```

Right after that button (but before the closing `</div>`), add:

```jsx
<button
  onClick={() => setActiveTab('content')}
  className={`py-2.5 text-xs font-semibold transition-colors ${activeTab === 'content' ? 'text-pink-500 border-b-2 border-pink-500 bg-pink-500/10' : \`\${mutedClass} hover:bg-slate-500/10\`}\`}
>
  🎬 Content
</button>
```

## Step 5: Save and test

1. Save the file
2. The app should hot-reload
3. Open Admin Panel
4. You should now see a "🎬 Content" tab

---

**Note:** The import for ContentQueueTab is already added at the top of AdminPanel.jsx, so you only need to add these two pieces.

If you have any issues, let me know and I can help debug!
