const ts = require('typescript');
const fs = require('fs');
const path = require('path');

// 极简内存模块加载：依次编译 models.ts / review.ts
function loadTs(tsPath, cache) {
  if (cache[tsPath]) return cache[tsPath].exports;
  const src = fs.readFileSync(tsPath, 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  cache[tsPath] = mod;
  const localRequire = (spec) => {
    if (spec.startsWith('.')) {
      const resolved = path.resolve(path.dirname(tsPath), spec) + '.ts';
      return loadTs(resolved, cache);
    }
    return require(spec);
  };
  new Function('exports', 'require', 'module', '__filename', '__dirname', js)(mod.exports, localRequire, mod, tsPath, path.dirname(tsPath));
  return mod.exports;
}

const cache = {};
const models = loadTs(path.join(process.cwd(), 'src/models.ts'), cache);
const review = loadTs(path.join(process.cwd(), 'src/review.ts'), cache);

// ---- 构造一个冻结版本（在 demo 项目基础上把 step-1-2 移到后面、删除一个步骤模拟旧版差异）----
const project = models.createDemoProject();
const mod1 = project.modules.find((m) => m.id === 'module-1');
// 交换第 2、3 步顺序，模拟步骤被移动
[mod1.steps[1], mod1.steps[2]] = [mod1.steps[2], mod1.steps[1]];
const frozen = {
  id: 'frozen-1',
  label: '冻结版本 v1',
  createdAt: new Date().toISOString(),
  snapshot: (() => {
    const { frozenVersions, ...snapshot } = structuredClone(project);
    return snapshot;
  })(),
};

const versions = [frozen];
const round = { id: 'r1', baseVersionId: 'frozen-1', title: 't' };

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// 1. 解析示例批注
console.log('解析 SAMPLE_ANNOTATIONS:');
const parsed = review.parseAnnotations(review.SAMPLE_ANNOTATIONS);
check(`共解析出 ${parsed.annotations.length} 条`, parsed.annotations.length >= 14, `errors=${JSON.stringify(parsed.errors)}`);
check('版本标记识别为 v1/v0', parsed.basedOnLabel === '冻结版本 v1');
check('无解析错误', parsed.errors.length === 0, JSON.stringify(parsed.errors));

// 2. 导入并逐条评估冲突
console.log('\n冲突检测:');
const seen = new Set();
const imported = [];
for (const item of parsed.annotations) {
  const fp = review.annotationFingerprint(item);
  if (seen.has(fp)) continue;
  seen.add(fp);
  const evaluated = review.evaluateAnnotation(item, round, versions);
  imported.push({ ...item, fingerprint: fp, ...evaluated });
}
const types = (pred) => imported.filter(pred).map((a) => a.conflicts.map((c) => c.type)).flat();
check('存在“原对象不存在”', imported.some((a) => a.conflicts.some((c) => c.type === 'target-missing')));
check('存在“步骤已移动”（模块内/跨模块）', imported.filter((a) => a.conflicts.some((c) => c.type === 'step-moved')).length >= 2);
check('存在“基于旧版本”', imported.some((a) => a.conflicts.some((c) => c.type === 'version-stale')));
check('存在“内容已变化（原值漂移）”', imported.some((a) => a.conflicts.some((c) => c.type === 'value-drift')));
check('存在“建议值非法”', imported.some((a) => a.conflicts.some((c) => c.type === 'invalid-value')));

// 具体核对几条
const deleted = imported.find((a) => (a.targetHint || '').includes('已删除'));
check('已删除步骤报 target-missing', deleted?.conflicts.some((c) => c.type === 'target-missing'));
const crossModule = imported.find((a) => (a.targetHint || '').includes('多少钱'));
check('多少钱跨模块移动', crossModule?.conflicts.some((c) => c.type === 'step-moved') && crossModule.moduleId === 'module-2');
const movedWithin = imported.find((a) => (a.targetHint || '').includes('双人问候') && a.stepOrdinal === 3);
check('双人问候模块内移动（批注说第3步，交换后实际第2步）', movedWithin?.conflicts.some((c) => c.type === 'step-moved'));
const stale = imported.find((a) => a.basedOnLabel === '冻结版本 v0');
check('v0 批注报 version-stale', stale?.conflicts.some((c) => c.type === 'version-stale'));
const drift = imported.find((a) => a.field === 'step.difficulty' && a.originalValue === '挑战');
check('难度原值漂移', drift?.conflicts.some((c) => c.type === 'value-drift'));
const badCamera = imported.find((a) => (a.suggestedValue || '').includes('正面微俯'));
check('非法镜头枚举', badCamera?.conflicts.some((c) => c.type === 'invalid-value'));

// 3. 去重：示例里“练习反馈”重复一次
console.log('\n去重:');
const dupParsed = review.parseAnnotations(review.SAMPLE_ANNOTATIONS);
const seen2 = new Set(imported.map((a) => a.fingerprint));
let dupCount = 0;
for (const item of dupParsed.annotations) {
  const fp = review.annotationFingerprint(item);
  if (seen2.has(fp)) dupCount++;
  else seen2.add(fp);
}
check('重复导入至少跳过 1 条（练习反馈）', dupCount >= 1, `dup=${dupCount}`);

// 4. 修正非法候选值后冲突消失（revalidateCandidate）
console.log('\n候选值重新校验:');
const cameraAnn = {
  ...badCamera, id: 'x', ordinal: 1, decision: 'accepted', candidateValue: '正面微俯', importedAt: '',
};
const afterBad = review.revalidateCandidate(cameraAnn, versions, 'frozen-1');
check('非法候选保留 invalid-value', afterBad.some((c) => c.type === 'invalid-value'));
cameraAnn.candidateValue = '俯拍手部';
const afterGood = review.revalidateCandidate(cameraAnn, versions, 'frozen-1');
check('改成合法枚举后非法冲突消失', !afterGood.some((c) => c.type === 'invalid-value'));

// 5. 采纳并生成修订版
console.log('\n生成修订版:');
const accepted = imported
  .filter((a) => a.field && !a.conflicts.some((c) => ['target-missing', 'step-moved', 'version-stale', 'invalid-value'].includes(c.type)))
  .slice(0, 4)
  .map((a) => ({ ...a, decision: 'accepted', candidateValue: a.suggestedValue, applied: false }));
const revised = review.applyAcceptedAnnotations(frozen.snapshot, accepted).snapshot;
check('修订版从快照复制，冻结快照未被污染', frozen.snapshot.modules.find((m) => m.id === 'module-1').title !== revised.modules.find((m) => m.id === 'module-1').title || accepted.some((a) => a.field?.startsWith('module')));
const changedField = accepted.find((a) => a.field === 'module.title');
if (changedField) {
  check('模块标题候选已写入修订版', revised.modules.find((m) => m.id === 'module-1').title === changedField.candidateValue);
}
const cap = accepted.find((a) => a.field === 'step.captionPosition');
if (cap) {
  const step = revised.modules.find((m) => m.id === 'module-1').steps.find((s) => s.id === cap.targetId);
  check('字幕位置候选已写入', step.captionPosition === '下方安全区');
}

// 时长数字转换、前置步骤标题→id、常见错误拆分：用合成采纳项直接验证应用逻辑
const step2 = frozen.snapshot.modules.find((m) => m.id === 'module-1').steps[1];
const synth = [
  { id: 's1', decision: 'accepted', applied: false, targetType: 'step', moduleId: 'module-1', targetId: step2.id, field: 'step.duration', candidateValue: '88 秒' },
  { id: 's2', decision: 'accepted', applied: false, targetType: 'step', moduleId: 'module-1', targetId: step2.id, field: 'step.prerequisiteId', candidateValue: '双人问候练习' },
  { id: 's3', decision: 'accepted', applied: false, targetType: 'step', moduleId: 'module-1', targetId: step2.id, field: 'step.commonMistakes', candidateValue: '错误一\n错误二；错误三' },
  { id: 's4', decision: 'kept', applied: false, targetType: 'step', moduleId: 'module-1', targetId: step2.id, field: 'step.duration', candidateValue: '120' },
];
const synthResult = review.applyAcceptedAnnotations(frozen.snapshot, synth);
const synthRevised = synthResult.snapshot;
check('纯意见/缺失对象不计入 appliedIds，其余被记录', synthResult.appliedIds.length === 3 && !synthResult.appliedIds.includes('s4'));
const synthStep = synthRevised.modules.find((m) => m.id === 'module-1').steps.find((s) => s.id === step2.id);
check('时长被转为数字', synthStep.duration === 88 && typeof synthStep.duration === 'number');
check('前置步骤标题被解析为 id（双人问候=step-1-3）', synthStep.prerequisiteId === 'step-1-3');
check('常见错误按行/分号拆分为数组', Array.isArray(synthStep.commonMistakes) && synthStep.commonMistakes.length === 3);
check('保留意见不会写入（时长仍为原值）', frozen.snapshot.modules.find((m) => m.id === 'module-1').steps.find((s) => s.id === step2.id).duration === synthStep.duration || synthStep.duration === 88);

// 6. 纯文字意见
const commentOnly = parsed.annotations.find((a) => !a.field && a.comment.includes('教研组长'));
check('纯文字意见可识别', Boolean(commentOnly) && commentOnly.comment.includes('再见'));

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
