/**
 * Video Generation Module for Stockism Content
 * Creates short-form vertical videos (1080x1920) for YouTube Shorts
 */

const { createCanvas, loadImage, registerFont } = require('canvas');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Video dimensions for YouTube Shorts / TikTok (9:16 aspect ratio)
const WIDTH = 1080;
const HEIGHT = 1920;

// Brand colors (matching Stockism theme)
const COLORS = {
  background: '#1a1a1a',      // Dark background
  backgroundAlt: '#2a2520',   // Beige-brown alt (ladder game inspired)
  text: '#ffffff',            // White text
  textSecondary: '#a0a0a0',   // Gray secondary text
  accent: '#d4af37',          // Gold accent
  positive: '#10b981',        // Green (gains)
  negative: '#ef4444',        // Red (losses)
  neutral: '#6b7280'          // Gray (neutral)
};

/**
 * Helper to format currency
 */
function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * Helper to format percentage
 */
function formatPercent(value) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Draw text with shadow for better readability
 */
function drawTextWithShadow(ctx, text, x, y, fontSize, color = COLORS.text, align = 'center') {
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillText(text, x + 3, y + 3);

  // Main text
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * Template: Character Spotlight
 * Shows trending character with stats
 */
async function renderCharacterSpotlight(data) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, COLORS.background);
  gradient.addColorStop(1, COLORS.backgroundAlt);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Title section at top
  const titleY = 250;
  drawTextWithShadow(ctx, data.hook || 'TRENDING NOW', WIDTH / 2, titleY, 80);

  // Character name and ticker
  const nameY = 500;
  drawTextWithShadow(ctx, data.characterName, WIDTH / 2, nameY, 120);
  drawTextWithShadow(ctx, `$${data.ticker}`, WIDTH / 2, nameY + 120, 80, COLORS.textSecondary);

  // Price
  const priceY = 850;
  drawTextWithShadow(ctx, formatCurrency(data.price), WIDTH / 2, priceY, 140, COLORS.accent);

  // Change percentage (color based on direction)
  const changeColor = data.changePercent >= 0 ? COLORS.positive : COLORS.negative;
  drawTextWithShadow(
    ctx,
    formatPercent(data.changePercent),
    WIDTH / 2,
    priceY + 150,
    100,
    changeColor
  );

  // Stats section
  const statsY = 1200;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.fillRect(80, statsY, WIDTH - 160, 300);

  drawTextWithShadow(ctx, data.statLabel || 'TODAY', WIDTH / 2, statsY + 60, 50, COLORS.textSecondary);

  if (data.volume) {
    drawTextWithShadow(ctx, `${data.volume.toLocaleString()} trades`, WIDTH / 2, statsY + 140, 60);
  }

  if (data.timeframe) {
    drawTextWithShadow(ctx, data.timeframe, WIDTH / 2, statsY + 220, 50, COLORS.textSecondary);
  }

  // Call to action
  const ctaY = 1700;
  drawTextWithShadow(ctx, 'stockism.app', WIDTH / 2, ctaY, 70, COLORS.accent);

  return canvas;
}

/**
 * Template: Market Movers
 * Shows top gainers or losers
 */
async function renderMarketMovers(data) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, COLORS.background);
  gradient.addColorStop(1, COLORS.backgroundAlt);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Title
  const isGainers = data.type === 'gainers';
  const titleColor = isGainers ? COLORS.positive : COLORS.negative;
  const titleText = isGainers ? 'TOP GAINERS' : 'TOP LOSERS';

  drawTextWithShadow(ctx, titleText, WIDTH / 2, 250, 90, titleColor);
  drawTextWithShadow(ctx, data.timeframe || 'TODAY', WIDTH / 2, 370, 60, COLORS.textSecondary);

  // List of movers (top 3)
  const startY = 600;
  const itemHeight = 280;

  data.movers.slice(0, 3).forEach((mover, index) => {
    const y = startY + (index * itemHeight);

    // Background box
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(80, y, WIDTH - 160, 240);

    // Rank number
    drawTextWithShadow(ctx, `${index + 1}`, 180, y + 120, 80, COLORS.textSecondary, 'center');

    // Character name
    drawTextWithShadow(ctx, mover.name, 400, y + 80, 70, COLORS.text, 'left');

    // Ticker
    drawTextWithShadow(ctx, `$${mover.ticker}`, 400, y + 160, 50, COLORS.textSecondary, 'left');

    // Change percentage
    const changeColor = mover.change >= 0 ? COLORS.positive : COLORS.negative;
    drawTextWithShadow(
      ctx,
      formatPercent(mover.change),
      WIDTH - 180,
      y + 120,
      80,
      changeColor,
      'right'
    );
  });

  // Call to action
  drawTextWithShadow(ctx, 'Play now at stockism.app', WIDTH / 2, 1750, 60, COLORS.accent);

  return canvas;
}

/**
 * Template: Drama Event
 * Highlights big moments (liquidations, achievements, etc.)
 */
async function renderDramaEvent(data) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Alert banner at top
  ctx.fillStyle = data.alertColor || COLORS.accent;
  ctx.fillRect(0, 150, WIDTH, 200);

  drawTextWithShadow(ctx, data.alertText || 'ALERT', WIDTH / 2, 250, 100, COLORS.background);

  // Main content
  const mainY = 700;

  if (data.headline) {
    // Split headline into multiple lines if too long
    const words = data.headline.split(' ');
    let line = '';
    let lineY = mainY;
    const lineHeight = 140;

    words.forEach((word, index) => {
      const testLine = line + word + ' ';
      ctx.font = 'bold 90px sans-serif';
      const metrics = ctx.measureText(testLine);

      if (metrics.width > WIDTH - 160 && line !== '') {
        drawTextWithShadow(ctx, line.trim(), WIDTH / 2, lineY, 90);
        line = word + ' ';
        lineY += lineHeight;
      } else {
        line = testLine;
      }

      if (index === words.length - 1) {
        drawTextWithShadow(ctx, line.trim(), WIDTH / 2, lineY, 90);
      }
    });
  }

  // Stats box
  if (data.stat) {
    const statsY = 1200;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(80, statsY, WIDTH - 160, 250);

    drawTextWithShadow(ctx, data.statLabel || 'VALUE', WIDTH / 2, statsY + 70, 50, COLORS.textSecondary);
    drawTextWithShadow(ctx, data.stat, WIDTH / 2, statsY + 170, 90, data.statColor || COLORS.accent);
  }

  // CTA
  drawTextWithShadow(ctx, 'stockism.app', WIDTH / 2, 1750, 70, COLORS.accent);

  return canvas;
}

/**
 * Generate video from canvas frames
 * Creates a 15-second video with static frame (can be enhanced with animations)
 */
async function generateVideo(canvas, outputPath, duration = 15) {
  return new Promise((resolve, reject) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockism-video-'));
    const framePath = path.join(tempDir, 'frame.png');

    // Save canvas as PNG
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(framePath, buffer);

    // Create video using ffmpeg
    // Loop the static image for the specified duration
    ffmpeg()
      .input(framePath)
      .inputOptions([
        '-loop 1',
        `-t ${duration}`
      ])
      .outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-r 30',  // 30 fps
        '-shortest'
      ])
      .output(outputPath)
      .on('end', () => {
        // Cleanup
        fs.unlinkSync(framePath);
        fs.rmdirSync(tempDir);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        // Cleanup on error
        try {
          fs.unlinkSync(framePath);
          fs.rmdirSync(tempDir);
        } catch (e) {
          // Ignore cleanup errors
        }
        reject(err);
      })
      .run();
  });
}

/**
 * Main function to create content video
 */
async function createContentVideo(type, data, outputPath) {
  let canvas;

  switch (type) {
    case 'character-spotlight':
      canvas = await renderCharacterSpotlight(data);
      break;
    case 'market-movers':
      canvas = await renderMarketMovers(data);
      break;
    case 'drama-event':
      canvas = await renderDramaEvent(data);
      break;
    default:
      throw new Error(`Unknown video type: ${type}`);
  }

  await generateVideo(canvas, outputPath, data.duration || 15);
  return outputPath;
}

module.exports = {
  createContentVideo,
  renderCharacterSpotlight,
  renderMarketMovers,
  renderDramaEvent,
  generateVideo
};
