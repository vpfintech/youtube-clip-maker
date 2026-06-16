function hasEncoder(encodersText, encoderName) {
  return new RegExp(`\\b${encoderName}\\b`).test(String(encodersText || ''));
}

function selectAccurateVideoEncoder(encodersText, platform = process.platform) {
  if (platform === 'darwin' && hasEncoder(encodersText, 'h264_videotoolbox')) return 'h264_videotoolbox';
  if (hasEncoder(encodersText, 'h264_nvenc')) return 'h264_nvenc';
  if (hasEncoder(encodersText, 'h264_qsv')) return 'h264_qsv';
  if (hasEncoder(encodersText, 'h264_amf')) return 'h264_amf';
  return 'libx264';
}

function accurateVideoArgs(encoder, clipSeconds) {
  const forceKeyframes = ['-force_key_frames', `expr:gte(t,n_forced*${clipSeconds})`];

  if (encoder === 'h264_videotoolbox') {
    return ['-c:v', 'h264_videotoolbox', '-b:v', '6000k', ...forceKeyframes];
  }
  if (encoder === 'h264_nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23', '-b:v', '0', ...forceKeyframes];
  }
  if (encoder === 'h264_qsv') {
    return ['-c:v', 'h264_qsv', '-global_quality', '23', ...forceKeyframes];
  }
  if (encoder === 'h264_amf') {
    return ['-c:v', 'h264_amf', '-quality', 'speed', '-b:v', '6000k', ...forceKeyframes];
  }
  return ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', ...forceKeyframes];
}

function buildClipArgs({ inputPath, outputPattern, clipSeconds, includeAudio, clipMode, accurateEncoder }) {
  const mode = clipMode === 'accurate' ? 'accurate' : 'fast';
  const args = [
    '-y',
    '-progress', 'pipe:1',
    '-i', inputPath,
    '-map', '0:v:0'
  ];

  if (includeAudio) args.push('-map', '0:a?');
  else args.push('-an');

  if (mode === 'accurate') {
    args.push(...accurateVideoArgs(accurateEncoder || 'libx264', clipSeconds));
    if (includeAudio) args.push('-c:a', 'aac', '-b:a', '128k');
  } else {
    args.push('-c', 'copy');
  }

  args.push(
    '-f', 'segment',
    '-segment_time', String(clipSeconds)
  );

  if (mode === 'accurate') args.push('-segment_time_delta', '0.05');

  args.push(
    '-reset_timestamps', '1',
    '-avoid_negative_ts', 'make_zero',
    outputPattern
  );

  return args;
}

function parseFfmpegProgress(text) {
  const progress = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) progress[key] = value;
  }
  return progress;
}

module.exports = {
  hasEncoder,
  selectAccurateVideoEncoder,
  accurateVideoArgs,
  buildClipArgs,
  parseFfmpegProgress
};
