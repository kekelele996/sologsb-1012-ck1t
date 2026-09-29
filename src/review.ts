import {
  type AnnotationConflict,
  type CameraAngle,
  type CaptionPosition,
  type CourseModule,
  type Difficulty,
  type FrozenVersion,
  type GestureZone,
  type LessonStep,
  type ProjectSnapshot,
  type ReviewAnnotation,
  type ReviewFieldType,
  type ReviewRound,
  type ReviewTargetType,
} from './models';

export const REVIEW_STORAGE_KEY = 'sologsb-1012-sign-course-review-rounds-v1';

/* ------------------------------------------------------------------ */
/* 字段元数据：解析、校验与候选值合法化                                */
/* ------------------------------------------------------------------ */

type CoercedValue = string | number | string[];

interface FieldMeta {
  field: ReviewFieldType;
  target: ReviewTargetType;
  label: string;
  aliases: string[];
  options?: readonly string[];
}

const STEP_ENUMS: { kind: readonly LessonStep['kind'][]; difficulty: readonly Difficulty[]; gestureZone: readonly GestureZone[]; captionPosition: readonly CaptionPosition[]; camera: readonly CameraAngle[] } = {
  kind: ['示范', '讲解', '练习'],
  difficulty: ['入门', '进阶', '挑战'],
  gestureZone: ['左侧', '中央', '右侧'],
  captionPosition: ['下方安全区', '上移 15%', '角标提示', '画面中央'],
  camera: ['正面', '左侧 45°', '右侧 45°', '俯拍手部', '全身远景'],
};

export const FIELD_METAS: FieldMeta[] = [
  { field: 'module.title', target: 'module', label: '模块标题', aliases: ['模块标题', '标题', 'title'] },
  { field: 'module.summary', target: 'module', label: '模块目标', aliases: ['模块目标', '目标', '简介', '说明', 'summary'] },
  { field: 'module.color', target: 'module', label: '主题色', aliases: ['主题色', '颜色', 'color'] },
  { field: 'step.title', target: 'step', label: '步骤标题', aliases: ['步骤标题', '标题', 'title'] },
  { field: 'step.kind', target: 'step', label: '步骤类型', aliases: ['步骤类型', '类型', 'kind'] , options: STEP_ENUMS.kind },
  { field: 'step.duration', target: 'step', label: '预计时长', aliases: ['预计时长', '时长', 'duration'] },
  { field: 'step.difficulty', target: 'step', label: '难度标签', aliases: ['难度标签', '难度', 'difficulty'], options: STEP_ENUMS.difficulty },
  { field: 'step.demoTitle', target: 'step', label: '示范片段名称', aliases: ['示范片段名称', '片段名称', '素材名称', 'demo'] },
  { field: 'step.demoUrl', target: 'step', label: '本地素材地址', aliases: ['本地素材地址', '素材地址', '地址', 'url'] },
  { field: 'step.handshape', target: 'step', label: '手形说明', aliases: ['手形说明', '手形', 'handshape'] },
  { field: 'step.gestureZone', target: 'step', label: '主要手形区域', aliases: ['主要手形区域', '手形区域', '动作区域', '区域', 'zone'], options: STEP_ENUMS.gestureZone },
  { field: 'step.caption', target: 'step', label: '步骤字幕', aliases: ['步骤字幕', '字幕', 'caption'] },
  { field: 'step.captionPosition', target: 'step', label: '字幕位置', aliases: ['字幕位置', '字幕方位', 'captionPosition'], options: STEP_ENUMS.captionPosition },
  { field: 'step.camera', target: 'step', label: '镜头角度', aliases: ['镜头角度', '镜头', '机位', 'camera'], options: STEP_ENUMS.camera },
  { field: 'step.commonMistakes', target: 'step', label: '常见错误', aliases: ['常见错误', '易犯错误', '错误', 'mistakes'] },
  { field: 'step.exercise', target: 'step', label: '练习任务', aliases: ['练习任务', '练习', '任务', 'exercise'] },
  { field: 'step.exerciseFeedback', target: 'step', label: '练习反馈', aliases: ['练习反馈', '反馈', 'feedback'] },
  { field: 'step.altText', target: 'step', label: '替代文本', aliases: ['替代文本', 'alt文本', 'alt', 'alttext'] },
  { field: 'step.prerequisiteId', target: 'step', label: '前置步骤', aliases: ['前置步骤', '前置条件', '前置', 'prerequisite'] },
];

export function fieldLabel(field: ReviewFieldType | undefined): string {
  return FIELD_METAS.find((meta) => meta.field === field)?.label ?? '批注意见';
}

/** 枚举字段的可选项，供候选修改下拉选择 */
export function fieldOptions(field: ReviewFieldType | undefined): readonly string[] | undefined {
  return FIELD_METAS.find((meta) => meta.field === field)?.options;
}

function normalizeColor(value: string): string {
  const trimmed = value.trim();
  if (/^#?[0-9a-fA-F]{3}$/.test(trimmed) || /^#?[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  }
  return trimmed;
}

function coerceValue(field: ReviewFieldType, raw: string): CoercedValue {
  switch (field) {
    case 'step.duration':
      return Number(raw.replace(/[^\d.]/g, ''));
    case 'step.commonMistakes':
      return raw.split(/[\n;；]/).map((item) => item.trim()).filter(Boolean);
    case 'module.color':
      return normalizeColor(raw);
    default:
      return raw.trim();
  }
}

/** 校验候选值是否可写入字段；非法时返回冲突描述 */
function validateValue(field: ReviewFieldType, value: string, snapshot: ProjectSnapshot, hostModuleId: string | undefined): string | undefined {
  const raw = value.trim();
  if (field === 'step.commonMistakes') {
    if (!raw) return '常见错误至少保留一条内容。';
    return undefined;
  }
  if (!raw) return `${fieldLabel(field)}的建议内容为空。`;
  const meta = FIELD_METAS.find((item) => item.field === field);
  if (meta?.options && !meta.options.includes(raw)) {
    return `“${raw}”不是${meta.label}的可选值（${meta.options.join('、')}）。`;
  }
  if (field === 'step.duration') {
    const seconds = Number(raw.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(seconds) || seconds < 10 || seconds > 600) return '时长需为 10—600 秒之间的数字。';
  }
  if (field === 'module.color' && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw)) {
    return '主题色需为 #15827a 这类十六进制色值。';
  }
  if (field === 'step.prerequisiteId') {
    const module = snapshot.modules.find((item) => item.id === hostModuleId);
    const target = module?.steps.find((step) => step.title.trim() === raw);
    if (!target) return `同模块内找不到标题为“${raw}”的前置步骤。`;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* 批注文本解析                                                        */
/* ------------------------------------------------------------------ */

export interface ParsedAnnotation {
  targetType: ReviewTargetType;
  targetId: string;
  moduleId?: string;
  stepOrdinal?: number;
  targetHint?: string;
  basedOnLabel?: string;
  field?: ReviewFieldType;
  suggestedValue?: string;
  originalValue?: string;
  comment: string;
}

export interface ParseResult {
  basedOnLabel?: string;
  annotations: ParsedAnnotation[];
  errors: string[];
}

const MODULE_HEADER = /^模块(?:\s+(.+?))?\s*$/;
const STEP_HEADER = /^步骤(?:\s+(\d+))?(?:\s+(.+?))?(?:\s*[@＠]\s*(.+))?\s*$/;

function matchFieldName(name: string): { meta?: FieldMeta; stripped: string } {
  const trimmed = name.trim();
  const meta = FIELD_METAS.find((item) => item.aliases.some((alias) => alias.toLowerCase() === trimmed.toLowerCase()));
  return { meta, stripped: trimmed };
}

export function parseAnnotations(text: string): ParseResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const annotations: ParsedAnnotation[] = [];
  const errors: string[] = [];
  let basedOnLabel: string | undefined;
  let current: { type: ReviewTargetType; id: string; moduleId?: string; ordinal?: number; hint?: string } | undefined;

  const push = (draft: Omit<ParsedAnnotation, 'targetType' | 'targetId' | 'moduleId' | 'stepOrdinal' | 'targetHint'>): void => {
    if (!current) {
      errors.push(`第${lines.length}行附近存在游离内容：批注需要先以“模块/步骤”开头标明对象。`);
      return;
    }
    annotations.push({
      targetType: current.type,
      targetId: current.id,
      moduleId: current.moduleId,
      stepOrdinal: current.ordinal,
      targetHint: current.hint,
      basedOnLabel,
      ...draft,
    });
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const lineNo = index + 1;
    if (!line || ['#', '//', '注：', '说明：'].some((prefix) => line.startsWith(prefix))) return;

    let match = line.match(/^[@＠]版本\s*[：:]\s*(.+)$/);
    if (match) {
      basedOnLabel = match[1].trim();
      return;
    }

    match = line.match(MODULE_HEADER);
    if (match) {
      const hint = match[1]?.trim();
      if (!hint) {
        errors.push(`第${lineNo}行：模块批注需要写明模块，例如“模块 模块一 · 日常问候”。`);
        return;
      }
      current = { type: 'module', id: hint, hint };
      return;
    }

    match = line.match(STEP_HEADER);
    if (match) {
      const ordinal = match[1] ? Number(match[1]) : undefined;
      const hint = match[2]?.trim();
      const moduleHint = match[3]?.trim();
      if (!ordinal && !hint) {
        errors.push(`第${lineNo}行：步骤批注至少写明序号或步骤标题，例如“步骤 2 拆解“你好”的手形”。`);
        return;
      }
      current = {
        type: 'step',
        id: hint ?? `step-ordinal-${ordinal}`,
        ordinal,
        hint,
        moduleId: moduleHint,
      };
      return;
    }

    const divider = line.search(/[：:]/);
    if (divider < 0) {
      if (!current) {
        errors.push(`第${lineNo}行无法识别：请以“模块/步骤”开头，或使用“字段：建议值 ｜ 意见”的格式。`);
        return;
      }
      push({ comment: line });
      return;
    }

    const namePart = line.slice(0, divider).trim();
    const rest = line.slice(divider + 1).trim();
    if (namePart === '模块目标' && !current) {
      errors.push(`第${lineNo}行：模块目标需要跟在“模块”对象之后。`);
      return;
    }
    const { meta } = matchFieldName(namePart);
    if (!current) {
      errors.push(`第${lineNo}行的“${namePart}”缺少所属的模块或步骤。`);
      return;
    }
    if (!meta) {
      push({ comment: `${namePart}：${rest}` });
      return;
    }
    if (meta.target !== current.type) {
      errors.push(`第${lineNo}行：“${namePart}”属于${meta.target === 'step' ? '步骤' : '模块'}字段，不能写在${current.type === 'step' ? '步骤' : '模块'}批注下。`);
      return;
    }
    const segments = rest.split(/\s*[|｜]\s*/);
    push({
      field: meta.field,
      suggestedValue: segments[0]?.trim() || '',
      comment: segments[1]?.trim() || '',
      originalValue: segments[2]?.trim() || undefined,
    });
  });

  return { basedOnLabel, annotations, errors };
}

/* ------------------------------------------------------------------ */
/* 指纹去重：同一意见重复导入只处理一次                                */
/* ------------------------------------------------------------------ */

function stableString(value: string | number | string[] | undefined): string {
  if (Array.isArray(value)) return value.join('␟');
  return value === undefined ? '' : String(value);
}

export function annotationFingerprint(item: Pick<ParsedAnnotation, 'targetId' | 'moduleId' | 'stepOrdinal' | 'field' | 'suggestedValue' | 'originalValue' | 'comment'>): string {
  return [
    item.targetId,
    item.moduleId ?? '',
    item.stepOrdinal ?? '',
    item.field ?? 'comment',
    stableString(item.suggestedValue),
    stableString(item.originalValue),
    item.comment,
  ].join('␞');
}

/* ------------------------------------------------------------------ */
/* 基准版本定位与冲突检测                                              */
/* ------------------------------------------------------------------ */

export function baseSnapshot(versions: FrozenVersion[], baseVersionId: string): ProjectSnapshot | undefined {
  return versions.find((version) => version.id === baseVersionId)?.snapshot;
}

export interface TargetRef {
  targetType: ReviewTargetType;
  targetId: string;
  moduleId?: string;
  stepOrdinal?: number;
  targetHint?: string;
}

export interface TargetView {
  type: ReviewTargetType;
  module?: CourseModule;
  step?: LessonStep;
  stepOrdinal?: number;
}

/** 在基准冻结版本中定位批注对象，步骤优先按标题、其次按 id / 序号 */
export function viewTarget(item: TargetRef, snapshot: ProjectSnapshot): TargetView {
  const findModule = (ref: string): CourseModule | undefined =>
    snapshot.modules.find((module) => module.id === ref || module.title === ref || module.title.includes(ref) || ref.includes(module.title));

  if (item.targetType === 'module') {
    return { type: 'module', module: findModule(item.targetId) };
  }

  const hosts = item.moduleId ? [findModule(item.moduleId)].filter(Boolean) as CourseModule[] : snapshot.modules;
  for (const host of hosts) {
    const byHint = host.steps.find((step) => step.title === item.targetId || step.id === item.targetId);
    if (byHint) return { type: 'step', module: host, step: byHint, stepOrdinal: host.steps.findIndex((step) => step.id === byHint.id) + 1 };
  }
  // 指定模块内没有时全局再找一次：找到说明步骤被移到了其他模块
  if (item.moduleId) {
    for (const host of snapshot.modules) {
      const elsewhere = host.steps.find((step) => step.title === item.targetId || step.id === item.targetId);
      if (elsewhere) return { type: 'step', module: host, step: elsewhere, stepOrdinal: host.steps.findIndex((step) => step.id === elsewhere.id) + 1 };
    }
  }
  // 只有序号时，退回到指定/首个模块对应序号
  const fallbackHost = hosts[0];
  const byOrdinal = item.stepOrdinal ? fallbackHost?.steps[item.stepOrdinal - 1] : undefined;
  if (fallbackHost && byOrdinal) {
    return { type: 'step', module: fallbackHost, step: byOrdinal, stepOrdinal: item.stepOrdinal };
  }
  return { type: 'step', module: hosts[0] };
}

function entityValue(view: TargetView, field: ReviewFieldType): string | number | string[] | undefined {
  const entity = view.type === 'module' ? view.module : view.step;
  if (!entity) return undefined;
  return (entity as unknown as Record<string, string | number | string[]>)[field.split('.')[1]];
}

export function evaluateAnnotation(item: ParsedAnnotation, round: Pick<ReviewRound, 'baseVersionId'>, versions: FrozenVersion[]): { conflicts: AnnotationConflict[]; moduleId?: string; targetId: string; candidateValue?: string } {
  const conflicts: AnnotationConflict[] = [];
  const snapshot = baseSnapshot(versions, round.baseVersionId);
  if (!snapshot) {
    return { conflicts: [{ type: 'target-missing', message: '基准冻结版本已不存在，无法核对批注。' }], targetId: item.targetId };
  }

  const baseVersion = versions.find((version) => version.id === round.baseVersionId);
  if (item.basedOnLabel && baseVersion && item.basedOnLabel !== baseVersion.label) {
    conflicts.push({ type: 'version-stale', message: `批注基于“${item.basedOnLabel}”，本回合基准为“${baseVersion.label}”，内容可能已经变化。` });
  }

  const view = viewTarget(item, snapshot);

  if (!view.module || (item.targetType === 'step' && !view.step)) {
    const name = item.targetHint ?? item.targetId;
    conflicts.push({
      type: 'target-missing',
      message: item.targetType === 'step'
        ? `原步骤“${name}”在基准冻结版本中不存在（可能已删除或并入其他步骤）。`
        : `模块“${name}”在基准冻结版本中不存在。`,
    });
    return { conflicts, moduleId: view.module?.id, targetId: item.targetId };
  }

  if (item.targetType === 'step' && view.step && view.module) {
    if (item.stepOrdinal && view.stepOrdinal !== item.stepOrdinal) {
      conflicts.push({ type: 'step-moved', message: `批注指向第 ${item.stepOrdinal} 步，“${view.step.title}”现在是第 ${view.stepOrdinal} 步。` });
    }
    if (item.moduleId && !view.module.title.includes(item.moduleId) && view.module.id !== item.moduleId) {
      conflicts.push({ type: 'step-moved', message: `批注时该步骤属于“${item.moduleId}”，现位于“${view.module.title}”。` });
    }
  }

  let candidateValue: string | undefined;
  if (item.field) {
    if (item.suggestedValue !== undefined) {
      candidateValue = item.suggestedValue;
      const invalid = validateValue(item.field, candidateValue, snapshot, view.module.id);
      if (invalid) conflicts.push({ type: 'invalid-value', message: invalid });
    }
    if (item.originalValue !== undefined && item.field !== 'step.prerequisiteId') {
      const present = entityValue(view, item.field);
      if (stableString(present) !== item.originalValue && stableString(coerceValue(item.field, item.originalValue)) !== stableString(present)) {
        const current = Array.isArray(present) ? present.join('；') : String(present ?? '');
        conflicts.push({ type: 'value-drift', message: `批注记录的原值为“${item.originalValue}”，基准版本现值为“${current}”。` });
      }
    }
  }

  return { conflicts, moduleId: view.module.id, targetId: view.type === 'step' ? view.step!.id : view.module.id, candidateValue };
}

/* ------------------------------------------------------------------ */
/* 候选值编辑后重新检测非法值冲突（结构类冲突保留）                    */
/* ------------------------------------------------------------------ */

export function revalidateCandidate(annotation: ReviewAnnotation, versions: FrozenVersion[], baseVersionId: string): AnnotationConflict[] {
  const snapshot = baseSnapshot(versions, baseVersionId);
  if (!snapshot || !annotation.field) {
    return annotation.conflicts.filter((conflict) => conflict.type !== 'invalid-value');
  }
  const structural = annotation.conflicts.filter((conflict) => conflict.type !== 'invalid-value');
  const invalid = validateValue(annotation.field, annotation.candidateValue ?? '', snapshot, annotation.moduleId);
  return invalid ? [...structural, { type: 'invalid-value', message: invalid }] : structural;
}

/* ------------------------------------------------------------------ */
/* 确认回合：把采纳的候选修改写入从冻结快照复制的新修订版              */
/* ------------------------------------------------------------------ */

export interface ApplyResult {
  snapshot: ProjectSnapshot;
  /** 真正写入到修订版的采纳意见 id（对象缺失或纯意见不在其中） */
  appliedIds: string[];
}

export function applyAcceptedAnnotations(snapshot: ProjectSnapshot, annotations: ReviewAnnotation[]): ApplyResult {
  const next: ProjectSnapshot = structuredClone(snapshot);
  const appliedIds: string[] = [];

  for (const annotation of annotations) {
    if (annotation.decision !== 'accepted' || annotation.applied) continue;
    const module = next.modules.find((item) => item.id === annotation.moduleId);
    if (!module) continue;

    if (annotation.targetType === 'module') {
      if (annotation.field) {
        (module as unknown as Record<string, CoercedValue>)[annotation.field.split('.')[1]] = coerceValue(annotation.field, annotation.candidateValue ?? '');
        appliedIds.push(annotation.id);
      }
      continue;
    }

    const stepIndex = module.steps.findIndex((item) => item.id === annotation.targetId);
    if (stepIndex < 0) continue;
    const step = module.steps[stepIndex];

    if (!annotation.field) continue;
    const key = annotation.field.split('.')[1] as keyof LessonStep;
    const writable = step as unknown as Record<string, CoercedValue>;
    if (annotation.field === 'step.prerequisiteId') {
      const target = module.steps.find((candidate) => candidate.title.trim() === (annotation.candidateValue ?? '').trim());
      writable[key as string] = target ? target.id : '';
    } else {
      writable[key as string] = coerceValue(annotation.field, annotation.candidateValue ?? '');
    }
    appliedIds.push(annotation.id);
  }

  return { snapshot: next, appliedIds };
}

/* ------------------------------------------------------------------ */
/* 回合持久化                                                          */
/* ------------------------------------------------------------------ */

export function loadRounds(): ReviewRound[] {
  try {
    const saved = localStorage.getItem(REVIEW_STORAGE_KEY);
    return saved ? (JSON.parse(saved) as ReviewRound[]) : [];
  } catch {
    return [];
  }
}

export function saveRounds(rounds: ReviewRound[]): void {
  localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(rounds));
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

export interface RoundStats {
  total: number;
  pending: number;
  accepted: number;
  kept: number;
  blockingConflicts: number;
}

export function roundStats(round: ReviewRound): RoundStats {
  return {
    total: round.annotations.length,
    pending: round.annotations.filter((item) => item.decision === 'pending').length,
    accepted: round.annotations.filter((item) => item.decision === 'accepted').length,
    kept: round.annotations.filter((item) => item.decision === 'kept').length,
    blockingConflicts: round.annotations.filter((item) => item.decision === 'accepted' && item.conflicts.length > 0 && !item.conflictAcknowledged).length,
  };
}

/* ------------------------------------------------------------------ */
/* 示例批注：覆盖移动、删除、旧版本与重复导入场景                      */
/* ------------------------------------------------------------------ */

export const SAMPLE_ANNOTATIONS = `@版本：冻结版本 v1
模块 模块一 · 日常问候
模块标题：日常问候与礼仪 | 标题需要覆盖礼仪内容
模块目标：建立手形、视线和面部表情配合，能在真实场景完成三个问候与道别 | 目标要写得更可观察

步骤 2 拆解“你好”的手形 @模块一 · 日常问候
字幕位置：下方安全区 ｜ 中央字幕挡住手形拆解 ｜ 画面中央
替代文本：手部近景展示四指并拢、拇指张开的起始手形，镜头缓慢推近。 ｜ 补出镜头运动
时长：55 ｜ 50 秒来不及看清两次示范 ｜ 50
前置步骤：观察“你好”的完整动作 ｜ 用步骤标题指代，便于离线流转
镜头角度：正面微俯 ｜ 建议略带俯拍，此值非法，用于演示“建议值非法”冲突

步骤 3 双人问候练习 @模块一 · 日常问候
练习反馈：同伴用手势确认视线接触，并在动作停顿时数两秒再交换。 ｜ 反馈方式再具体些
练习反馈：同伴用手势确认视线接触，并在动作停顿时数两秒再交换。 ｜ 反馈方式再具体些

步骤 1 观察“你好”的完整动作 @模块一 · 日常问候
纯文字意见：教研组长建议在本步结束后增加“再见”的衔接示范。

# 下面分别演示：模块内移动、跨模块移动、原步骤不存在、旧版本、原值漂移
步骤 2 双人问候练习 @模块一 · 日常问候
难度：挑战 | 批注说“现在是第 2 步”，实际已移动到第 3 步

步骤 2 组合成“多少钱” @模块一 · 日常问候
字幕：先做“钱”的交替手形，再面向学生向前询问。 | 该步骤实际位于模块二，跨模块移动

步骤 9 已删除的旧问候步骤 @模块一 · 日常问候
字幕：本步骤已在 v1 删除，批注应报“原步骤不存在”

@版本：冻结版本 v0
步骤 1 数字一到五的稳定手形 @模块二 · 数量表达
手形说明：食指到小指依次展开，手心朝上 | 这条批注基于旧版本 v0，需要人工确认

@版本：冻结版本 v1
步骤 1 观察“你好”的完整动作 @模块一 · 日常问候
难度：进阶 | 冻结版本现值为“入门”，批注原值写的是“挑战”，属于旧版本内容 ｜ 挑战`;
