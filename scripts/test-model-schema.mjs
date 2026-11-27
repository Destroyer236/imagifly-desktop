// 校验上游目录 → 参数控件的通用映射：给定模型 payload，未知的 <x>Options
// 必须变成参数，并且提交字段名去掉 Options 后缀。
// 运行：node scripts/test-model-schema.mjs
import assert from 'node:assert/strict';
import { extraParams, humanLabel, optionFormKey, defaultExtraValue, normalizeOptions, promptLanguage, prefersEnglishPrompt } from '../web/js/model-schema.js';

const cases = [];
function test(name, fn) {
  try {
    fn();
    cases.push(`PASS ${name}`);
  } catch (e) {
    cases.push(`FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

test('cameraMotionOptions → cameraMotion / 镜头运动', () => {
  const params = extraParams({
    id: 'MiniMax-H3',
    cameraMotionOptions: [{ id: 'pan', label: '横摇' }, { id: 'zoom', label: '推拉' }],
  });
  assert.equal(params.length, 1);
  assert.equal(params[0].formKey, 'cameraMotion');
  assert.equal(params[0].label, '镜头运动');
  assert.deepEqual(params[0].options, [
    { value: 'pan', label: '横摇' },
    { value: 'zoom', label: '推拉' },
  ]);
});

test('字符串数组也能用', () => {
  const params = extraParams({ stylePresetOptions: ['film', 'anime'] });
  assert.equal(params.length, 1);
  assert.equal(params[0].formKey, 'stylePreset');
  assert.deepEqual(params[0].options.map((o) => o.value), ['film', 'anime']);
});

test('已知参数不会被当成未知参数', () => {
  const params = extraParams({
    durationOptions: ['5s', '10s'],
    resolutionOptions: [{ size: '1280x736', label: '720P' }],
    fpsOptions: [24, 30],
    aspectRatios: ['16:9'],
    variants: [{ id: 'v1' }],
    workflowFormats: [{ id: 't2v' }],
    qualityOptions: [{ id: 'high' }],
    stepsOptions: [20],
  });
  assert.deepEqual(params, []);
});

test('与保留字段重名的参数被挡掉', () => {
  const params = extraParams({ sizeOptions: ['1024x1024'], seedOptions: [1] });
  // size/seed 是保留字段，sizeOptions 也在已知列表里
  assert.deepEqual(params, []);
});

test('非法 options（空数组 / 非数组）被忽略', () => {
  assert.deepEqual(extraParams({ fooOptions: [] }), []);
  assert.deepEqual(extraParams({ barOptions: 'nope' }), []);
  assert.deepEqual(extraParams(null), []);
});

test('default 值可作为初始选中', () => {
  const spec = { cameraMotionOptions: [{ id: 'pan' }], defaultCameraMotion: 'pan' };
  const [param] = extraParams(spec);
  assert.equal(defaultExtraValue(spec, param), 'pan');
});

test('对象 options 的值优先 id / size', () => {
  assert.deepEqual(normalizeOptions([{ resolution: '720P', size: '1280x736', imagiflyCredits: 100 }]), [
    { value: '1280x736', label: '720P' },
  ]);
});

test('标签回退：不认识就保留键名', () => {
  assert.equal(humanLabel('foobarOptions'), 'foobar');
  assert.equal(optionFormKey('cameraMotionOptions'), 'cameraMotion');
});

test('英文优先模型识别', () => {
  assert.equal(prefersEnglishPrompt({ id: 'gpt-image-2' }), true);
  assert.equal(prefersEnglishPrompt({ id: 'Wai-SDXL-V170' }), true);
  assert.equal(prefersEnglishPrompt({ id: 'nano-banana-2' }), true);
  assert.equal(prefersEnglishPrompt({ id: 'grok-imagine-image' }), true);
  assert.equal(prefersEnglishPrompt({ id: 'Qwen-Image-Edit' }), false);
  assert.equal(prefersEnglishPrompt({ id: 'MiniMax-H3' }), false);
  assert.equal(prefersEnglishPrompt({ id: 'seedance' }), false);
});

test('上游显式 language 字段优先', () => {
  assert.equal(promptLanguage({ id: 'qwen-image', language: 'en' }), 'en');
  assert.equal(promptLanguage({ id: 'gpt-image-2', promptLanguage: 'zh-CN' }), 'zh');
  assert.equal(promptLanguage({ id: 'unknown-model-1' }), '');
});

console.log(cases.join('\n'));
console.log(process.exitCode ? '\n有失败用例' : `\n全部通过（${cases.length} 项）`);
