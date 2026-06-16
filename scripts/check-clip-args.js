const assert = require('assert');
const {
  accurateVideoArgs,
  buildClipArgs,
  hasEncoder,
  parseFfmpegProgress,
  selectAccurateVideoEncoder
} = require('../src/main/clip-args');

assert.equal(hasEncoder(' V..... h264_videotoolbox VideoToolbox H.264', 'h264_videotoolbox'), true);
assert.equal(hasEncoder(' V..... libx264 H.264', 'h264_nvenc'), false);

assert.equal(selectAccurateVideoEncoder(' V..... h264_videotoolbox ', 'darwin'), 'h264_videotoolbox');
assert.equal(selectAccurateVideoEncoder(' V..... h264_videotoolbox ', 'win32'), 'libx264');
assert.equal(selectAccurateVideoEncoder(' V..... h264_nvenc ', 'win32'), 'h264_nvenc');
assert.equal(selectAccurateVideoEncoder(' V..... h264_qsv ', 'win32'), 'h264_qsv');
assert.equal(selectAccurateVideoEncoder(' V..... h264_amf ', 'win32'), 'h264_amf');
assert.equal(selectAccurateVideoEncoder('', 'win32'), 'libx264');

assert.deepEqual(accurateVideoArgs('h264_videotoolbox', 7), [
  '-c:v', 'h264_videotoolbox', '-b:v', '6000k', '-force_key_frames', 'expr:gte(t,n_forced*7)'
]);
assert.deepEqual(accurateVideoArgs('h264_nvenc', 7), [
  '-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23', '-b:v', '0', '-force_key_frames', 'expr:gte(t,n_forced*7)'
]);
assert.deepEqual(accurateVideoArgs('h264_qsv', 7), [
  '-c:v', 'h264_qsv', '-global_quality', '23', '-force_key_frames', 'expr:gte(t,n_forced*7)'
]);
assert.deepEqual(accurateVideoArgs('h264_amf', 7), [
  '-c:v', 'h264_amf', '-quality', 'speed', '-b:v', '6000k', '-force_key_frames', 'expr:gte(t,n_forced*7)'
]);
assert.deepEqual(accurateVideoArgs('libx264', 7), [
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-force_key_frames', 'expr:gte(t,n_forced*7)'
]);

const fastArgs = buildClipArgs({
  inputPath: 'input.mp4',
  outputPattern: 'output/clip-%03d.mp4',
  clipSeconds: 7,
  includeAudio: true,
  clipMode: 'fast'
});
assert(fastArgs.includes('-c'));
assert(fastArgs.includes('copy'));
assert(!fastArgs.includes('-segment_time_delta'));
assert(fastArgs.includes('-progress'));
assert(fastArgs.includes('pipe:1'));

const accurateArgs = buildClipArgs({
  inputPath: 'input.mp4',
  outputPattern: 'output/clip-%03d.mp4',
  clipSeconds: 7,
  includeAudio: true,
  clipMode: 'accurate',
  accurateEncoder: 'libx264'
});
assert(accurateArgs.includes('-segment_time_delta'));
assert(accurateArgs.includes('0.05'));
assert(accurateArgs.includes('ultrafast'));
assert(accurateArgs.includes('128k'));
assert(accurateArgs.includes('expr:gte(t,n_forced*7)'));

const noAudioArgs = buildClipArgs({
  inputPath: 'input.mp4',
  outputPattern: 'output/clip-%03d.mp4',
  clipSeconds: 7,
  includeAudio: false,
  clipMode: 'accurate',
  accurateEncoder: 'libx264'
});
assert(noAudioArgs.includes('-an'));
assert(!noAudioArgs.includes('-c:a'));

const progress = parseFfmpegProgress('out_time_ms=12345678\nspeed=2.3x\nprogress=continue\n');
assert.equal(progress.out_time_ms, '12345678');
assert.equal(progress.speed, '2.3x');
assert.equal(progress.progress, 'continue');

console.log('ok clip args');
