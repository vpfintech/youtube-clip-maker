const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

const ffmpeg = ffmpegInstaller.path;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-clip-maker-modes-'));
const source = path.join(tmp, 'source.mp4');

function run(args, label) {
  const started = Date.now();
  const result = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  const elapsedMs = Date.now() - started;
  if (result.status !== 0) {
    throw new Error(`${label} failed\n${result.stderr || result.stdout}`);
  }
  return { result, elapsedMs };
}

function durationSeconds(filePath) {
  const result = spawnSync(ffmpeg, ['-i', filePath], { encoding: 'utf8' });
  const text = `${result.stderr || ''}\n${result.stdout || ''}`;
  const match = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`Could not read duration for ${filePath}\n${text}`);
  return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
}

function readDurations(outputDir) {
  const clips = fs.readdirSync(outputDir).filter((file) => file.endsWith('.mp4')).sort();
  if (!clips.length) throw new Error(`No clips generated in ${outputDir}`);
  const durations = clips.map((file) => durationSeconds(path.join(outputDir, file)));
  for (const duration of durations) {
    if (duration <= 0) throw new Error(`Expected positive-duration clips, got ${durations.map((d) => d.toFixed(3)).join(', ')}`);
  }
  return { clips, durations };
}

// Sparse 10s keyframes make fast stream-copy very fast but approximate.
run([
  '-y',
  '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30',
  '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100',
  '-t', '120',
  '-c:v', 'libx264', '-g', '300', '-keyint_min', '300', '-sc_threshold', '0',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  source
], 'source generation');

const fastDir = path.join(tmp, 'fast');
fs.mkdirSync(fastDir, { recursive: true });
const fastSeconds = 30;
const fast = run([
  '-y',
  '-progress', 'pipe:1',
  '-i', source,
  '-map', '0:v:0',
  '-map', '0:a?',
  '-c', 'copy',
  '-f', 'segment',
  '-segment_time', String(fastSeconds),
  '-reset_timestamps', '1',
  '-avoid_negative_ts', 'make_zero',
  path.join(fastDir, 'clip-%03d.mp4')
], 'fast stream-copy clipping');
const fastResult = readDurations(fastDir);
if (fastResult.clips.length < 3) throw new Error(`Expected multiple fast clips, got ${fastResult.clips.length}`);
if (fast.elapsedMs > 5000) {
  throw new Error(`Expected fast stream-copy clipping under 5s for 120s fixture, took ${(fast.elapsedMs / 1000).toFixed(2)}s`);
}

const accurateDir = path.join(tmp, 'accurate');
fs.mkdirSync(accurateDir, { recursive: true });
const accurateSeconds = 7;
const encoders = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
if (encoders.status !== 0) throw new Error(`ffmpeg encoder detection failed\n${encoders.stderr || encoders.stdout}`);
run([
  '-y',
  '-progress', 'pipe:1',
  '-i', source,
  '-map', '0:v:0',
  '-map', '0:a?',
  '-c:v', 'libx264',
  '-preset', 'ultrafast',
  '-crf', '23',
  '-force_key_frames', `expr:gte(t,n_forced*${accurateSeconds})`,
  '-c:a', 'aac',
  '-b:a', '128k',
  '-f', 'segment',
  '-segment_time', String(accurateSeconds),
  '-segment_time_delta', '0.05',
  '-reset_timestamps', '1',
  '-avoid_negative_ts', 'make_zero',
  path.join(accurateDir, 'clip-%03d.mp4')
], 'accurate re-encode clipping');
const accurateResult = readDurations(accurateDir);
const fullAccurateClips = accurateResult.durations.slice(0, -1);
for (const duration of fullAccurateClips) {
  if (Math.abs(duration - accurateSeconds) > 0.25) {
    throw new Error(`Expected accurate full clips near ${accurateSeconds}s, got ${accurateResult.durations.map((d) => d.toFixed(3)).join(', ')}`);
  }
}

console.log(`ok clip modes: fast ${(fast.elapsedMs / 1000).toFixed(2)}s/${fastResult.clips.length} clips; accurate clips=${accurateResult.clips.length}, durations=${accurateResult.durations.slice(0, 4).map((d) => d.toFixed(3)).join(', ')}...`);
