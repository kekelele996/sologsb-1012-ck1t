export type CourseStatus = 'draft' | 'review' | 'changes' | 'frozen';
export type Difficulty = '入门' | '进阶' | '挑战';
export type CameraAngle = '正面' | '左侧 45°' | '右侧 45°' | '俯拍手部' | '全身远景';
export type CaptionPosition = '下方安全区' | '上移 15%' | '角标提示' | '画面中央';
export type GestureZone = '左侧' | '中央' | '右侧';

export interface LessonStep {
  id: string;
  title: string;
  kind: '示范' | '讲解' | '练习';
  duration: number;
  demoTitle: string;
  demoUrl: string;
  handshape: string;
  gestureZone: GestureZone;
  caption: string;
  captionPosition: CaptionPosition;
  camera: CameraAngle;
  commonMistakes: string[];
  exercise: string;
  exerciseFeedback: string;
  altText: string;
  prerequisiteId: string;
  difficulty: Difficulty;
  cuePoints: number[];
}

export interface CourseModule {
  id: string;
  title: string;
  summary: string;
  color: string;
  steps: LessonStep[];
}

export interface FrozenVersion {
  id: string;
  label: string;
  createdAt: string;
  snapshot: Omit<CourseProject, 'frozenVersions'>;
}

export interface CourseProject {
  id: string;
  title: string;
  teacher: string;
  audience: string;
  status: CourseStatus;
  selectedModuleId: string;
  selectedStepId: string;
  modules: CourseModule[];
  frozenVersions: FrozenVersion[];
  reviewRounds: ReviewRound[];
  lastSavedAt: string;
  revision: number;
}

export interface ValidationCheck {
  id: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  stepId?: string;
  moduleId?: string;
}

// ===== 审阅回合（离线批注复核）=====
export type CommentDecision = 'pending' | 'adopt' | 'keep';
export type CommentTargetType = 'module' | 'step';
export type ConflictKind = 'missing' | 'moved' | 'version-old';

export interface CandidatePatch {
  field: string;
  value: string;
}

export interface ReviewComment {
  id: string;
  dedupKey: string;
  targetType: CommentTargetType;
  moduleId: string;
  stepId?: string;
  targetTitle: string;
  content: string;
  decision: CommentDecision;
  candidate?: CandidatePatch;
  conflictKind?: ConflictKind;
  conflictDetail?: string;
  retargeted?: boolean;
  importedAt: string;
  decidedAt?: string;
}

export interface ReviewRound {
  id: string;
  frozenVersionId: string;
  frozenLabel: string;
  basedOnRevision: number;
  basedOnLabel: string;
  createdAt: string;
  status: 'open' | 'confirmed';
  comments: ReviewComment[];
  confirmedAt?: string;
  resultRevision?: number;
}

export interface FieldSpec {
  value: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select';
  options?: string[];
}

export const STEP_FIELDS: FieldSpec[] = [
  { value: 'title', label: '步骤标题', type: 'text' },
  { value: 'kind', label: '步骤类型', type: 'select', options: ['示范', '讲解', '练习'] },
  { value: 'duration', label: '预计时长（秒）', type: 'number' },
  { value: 'difficulty', label: '难度标签', type: 'select', options: ['入门', '进阶', '挑战'] },
  { value: 'demoTitle', label: '示范片段名称', type: 'text' },
  { value: 'handshape', label: '手形说明', type: 'textarea' },
  { value: 'gestureZone', label: '主要手形区域', type: 'select', options: ['左侧', '中央', '右侧'] },
  { value: 'caption', label: '步骤字幕', type: 'textarea' },
  { value: 'captionPosition', label: '字幕位置', type: 'select', options: ['下方安全区', '上移 15%', '角标提示', '画面中央'] },
  { value: 'camera', label: '镜头角度', type: 'select', options: ['正面', '左侧 45°', '右侧 45°', '俯拍手部', '全身远景'] },
  { value: 'commonMistakes', label: '常见错误（每行一条）', type: 'textarea' },
  { value: 'exercise', label: '练习任务', type: 'textarea' },
  { value: 'exerciseFeedback', label: '练习反馈', type: 'textarea' },
  { value: 'altText', label: '替代文本', type: 'textarea' },
];

export const MODULE_FIELDS: FieldSpec[] = [
  { value: 'title', label: '模块标题', type: 'text' },
  { value: 'summary', label: '模块目标', type: 'textarea' },
  { value: 'color', label: '主题色', type: 'text' },
];

export interface ImportResult {
  comments: ReviewComment[];
  duplicateCount: number;
  versionOld: boolean;
  versionLabel?: string;
}

export const STORAGE_KEY = 'sologsb-1012-sign-course-project-v1';

export function createDemoProject(): CourseProject {
  const modules: CourseModule[] = [
    {
      id: 'module-1',
      title: '模块一 · 日常问候',
      summary: '建立手形、视线和面部表情之间的配合，完成三个基础问候。',
      color: '#15827a',
      steps: [
        {
          id: 'step-1-1',
          title: '观察“你好”的完整动作',
          kind: '示范',
          duration: 35,
          demoTitle: '你好 · 正面慢速示范',
          demoUrl: '',
          handshape: '右手掌张开，拇指向上，自额头向外送出',
          gestureZone: '右侧',
          caption: '你好：手掌从额前向前送出，同时保持微笑。',
          captionPosition: '下方安全区',
          camera: '正面',
          commonMistakes: ['手掌过于僵硬', '没有视线交流'],
          exercise: '跟随示范完成两次，每次保持两秒。',
          exerciseFeedback: '镜面检查手掌高度是否与眉线一致。',
          altText: '教师面向镜头，用右手掌从额头向前送出，并点头微笑。',
          prerequisiteId: '',
          difficulty: '入门',
          cuePoints: [4, 16, 28],
        },
        {
          id: 'step-1-2',
          title: '拆解“你好”的手形',
          kind: '讲解',
          duration: 50,
          demoTitle: '你好 · 手部近景',
          demoUrl: '',
          handshape: '四指并拢，拇指张开；掌心朝左前侧',
          gestureZone: '中央',
          caption: '注意四指并拢，动作沿身体中轴向前。',
          captionPosition: '画面中央',
          camera: '俯拍手部',
          commonMistakes: ['拇指贴住掌心', '动作方向偏向一侧'],
          exercise: '固定肩部，只移动前臂完成五次。',
          exerciseFeedback: '如果动作跑偏，先在镜前标记起点和终点。',
          altText: '手部近景展示四指并拢、拇指张开的起始手形。',
          prerequisiteId: 'step-1-1',
          difficulty: '入门',
          cuePoints: [6, 24, 42],
        },
        {
          id: 'step-1-3',
          title: '双人问候练习',
          kind: '练习',
          duration: 75,
          demoTitle: '你好 · 双人轮流练习',
          demoUrl: '',
          handshape: '保持标准手形，配合点头与视线交换',
          gestureZone: '中央',
          caption: '轮流问候，每次动作结束后停一拍，再交换角色。',
          captionPosition: '上移 15%',
          camera: '全身远景',
          commonMistakes: ['动作过早结束', '两人视线没有相遇'],
          exercise: '两人一组轮流完成问候，交换三次。',
          exerciseFeedback: '同伴负责确认视线和动作停顿。',
          altText: '两名学习者相对站立，交替做出问候动作并看向对方。',
          prerequisiteId: 'step-1-2',
          difficulty: '进阶',
          cuePoints: [10, 34, 57],
        },
      ],
    },
    {
      id: 'module-2',
      title: '模块二 · 数量表达',
      summary: '用数字、空间位置和顺序词完成价格询问。',
      color: '#8a3ffc',
      steps: [
        {
          id: 'step-2-1',
          title: '数字一到五的稳定手形',
          kind: '讲解',
          duration: 60,
          demoTitle: '数字 1—5 · 镜面视图',
          demoUrl: '',
          handshape: '食指到五指依次展开，手心朝前',
          gestureZone: '中央',
          caption: '数字一到五：从食指开始依次增加，不移动手腕。',
          captionPosition: '下方安全区',
          camera: '正面',
          commonMistakes: ['拇指遮挡手指数', '手腕左右摆动'],
          exercise: '按随机口令连续展示 1—5。',
          exerciseFeedback: '每个数字保持一秒，同伴随机报数。',
          altText: '教师手心朝前，依次伸出食指到五指，展示数字一到五。',
          prerequisiteId: '',
          difficulty: '入门',
          cuePoints: [8, 26, 44],
        },
        {
          id: 'step-2-2',
          title: '组合成“多少钱”',
          kind: '示范',
          duration: 45,
          demoTitle: '多少钱 · 双手组合动作',
          demoUrl: '',
          handshape: '双手在胸前交替翻转，随后食指向前点出',
          gestureZone: '中央',
          caption: '先做“钱”的交替手形，再用食指向前询问。',
          captionPosition: '角标提示',
          camera: '右侧 45°',
          commonMistakes: ['两手动作不同步', '疑问表情缺失'],
          exercise: '配合疑问表情完成三次询问。',
          exerciseFeedback: '录下动作，检查双手是否在胸前同一高度。',
          altText: '教师双手机械交替翻转后，食指朝前点出并抬眉疑问。',
          prerequisiteId: 'step-2-1',
          difficulty: '进阶',
          cuePoints: [5, 22, 37],
        },
      ],
    },
  ];

  return {
    id: 'sign-course-project',
    title: '零基础手语 · 问候与数量',
    teacher: '陈老师 / 特殊教育中心',
    audience: '初次接触手语的初中学习者',
    status: 'draft',
    selectedModuleId: 'module-1',
    selectedStepId: 'step-1-2',
    modules,
    frozenVersions: [],
    reviewRounds: [],
    lastSavedAt: new Date().toISOString(),
    revision: 1,
  };
}

export function selectedModule(project: CourseProject): CourseModule {
  return project.modules.find((module) => module.id === project.selectedModuleId) ?? project.modules[0];
}

export function selectedStep(project: CourseProject): LessonStep | undefined {
  const module = selectedModule(project);
  return module?.steps.find((step) => step.id === project.selectedStepId) ?? module?.steps[0];
}

export function validateProject(project: CourseProject): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  if (!project.title.trim()) checks.push({ id: 'title', severity: 'error', title: '课程标题缺失', detail: '发布前需要为课程填写清晰标题。' });
  if (project.modules.length === 0) checks.push({ id: 'modules', severity: 'error', title: '没有课程模块', detail: '至少需要创建一个包含学习步骤的模块。' });

  project.modules.forEach((module) => {
    if (!module.steps.length) {
      checks.push({ id: `empty-${module.id}`, severity: 'error', title: `${module.title} 没有学习步骤`, detail: '空模块无法进入复核。', moduleId: module.id });
    }
    module.steps.forEach((step, index) => {
      if (!step.altText.trim()) {
        checks.push({ id: `alt-${step.id}`, severity: 'error', title: `${step.title} 缺少替代文本`, detail: '示范片段需要描述手形、移动和面部表情。', stepId: step.id, moduleId: module.id });
      }
      if (!step.caption.trim()) {
        checks.push({ id: `caption-${step.id}`, severity: 'warning', title: `${step.title} 缺少字幕`, detail: '听障学习者在静音预览时无法获得说明。', stepId: step.id, moduleId: module.id });
      }
      if (step.captionPosition === '画面中央' && (step.gestureZone === '中央' || step.camera === '俯拍手部')) {
        checks.push({ id: `overlap-${step.id}`, severity: 'error', title: `${step.title} 字幕可能遮挡动作`, detail: `字幕位于${step.captionPosition}，而主要手形位于${step.gestureZone}。`, stepId: step.id, moduleId: module.id });
      }
      if (step.duration < 20) {
        checks.push({ id: `duration-${step.id}`, severity: 'warning', title: `${step.title} 时长过短`, detail: '示范与练习不足 20 秒，学习者来不及观察和跟做。', stepId: step.id, moduleId: module.id });
      }
      if (step.prerequisiteId) {
        const prerequisiteIndex = module.steps.findIndex((candidate) => candidate.id === step.prerequisiteId);
        if (prerequisiteIndex < 0) {
          checks.push({ id: `missing-pre-${step.id}`, severity: 'error', title: `${step.title} 的前置步骤不存在`, detail: '请重新选择前置条件或移除依赖。', stepId: step.id, moduleId: module.id });
        } else if (prerequisiteIndex >= index) {
          checks.push({ id: `jump-${step.id}`, severity: 'error', title: `${step.title} 出现步骤跳级`, detail: '前置步骤位于当前步骤之后，学习顺序无法成立。', stepId: step.id, moduleId: module.id });
        }
      }
      if (step.kind === '练习' && (!step.exercise.trim() || !step.exerciseFeedback.trim())) {
        checks.push({ id: `practice-${step.id}`, severity: 'warning', title: `${step.title} 的练习反馈不完整`, detail: '练习任务需要明确完成动作和即时反馈方式。', stepId: step.id, moduleId: module.id });
      }
      if (step.commonMistakes.filter(Boolean).length === 0) {
        checks.push({ id: `mistakes-${step.id}`, severity: 'info', title: `${step.title} 尚未记录常见错误`, detail: '补充常见错误有助于教师现场提示。', stepId: step.id, moduleId: module.id });
      }
    });
  });

  return checks;
}

export function cloneProject(project: CourseProject): CourseProject {
  return structuredClone(project);
}

// ===== 审阅回合：离线批注解析、匹配、冲突与生成 =====

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, '').replace(/[（）()【】\[\]：:，,。.、"'“”‘’·\-—_~～]/g, '').toLowerCase();
}

function hashKey(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function commentDedupKey(targetType: CommentTargetType, moduleId: string, stepId: string | undefined, content: string): string {
  return hashKey(`${targetType}|${moduleId}|${stepId ?? ''}|${normalizeTitle(content)}`);
}

const TARGET_RE = /^\s*[【\[]?\s*(模块|步骤)\s*[】\]]?\s*[:：]?\s*(.+?)\s*$/;
const COMMENT_RE = /^\s*(?:[-·*•]|\d+\s*[.、)）])\s*(.+?)\s*$/;
const VERSION_RE = /(?:版本|修订|ver)\s*[:：]?\s*v?\s*(\d+)/i;

interface ParsedTarget {
  type: CommentTargetType;
  title: string;
  moduleHint?: string;
}

interface ParsedBlock {
  versionLabel?: string;
  targets: { target: ParsedTarget; comments: string[] }[];
}

export function parseReviewText(text: string): ParsedBlock {
  const lines = text.split(/\r?\n/);
  const versionMatch = text.match(VERSION_RE);
  const versionLabel = versionMatch ? versionMatch[0] : undefined;

  const targets: { target: ParsedTarget; comments: string[] }[] = [];
  let current: { target: ParsedTarget; comments: string[] } | null = null;
  let currentModuleTitle: string | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || VERSION_RE.test(line)) continue;
    const targetMatch = line.match(TARGET_RE);
    if (targetMatch && !COMMENT_RE.test(line)) {
      const type: CommentTargetType = targetMatch[1] === '模块' ? 'module' : 'step';
      const title = targetMatch[2];
      if (type === 'module') currentModuleTitle = title;
      current = { target: { type, title, moduleHint: type === 'step' ? currentModuleTitle : undefined }, comments: [] };
      targets.push(current);
      continue;
    }
    const commentMatch = line.match(COMMENT_RE);
    if (commentMatch) {
      if (current) current.comments.push(commentMatch[1]);
    } else if (current && current.comments.length) {
      current.comments[current.comments.length - 1] += line;
    }
  }

  return { versionLabel, targets };
}

function extractVersionNumber(label: string | undefined): number {
  if (!label) return 0;
  const match = label.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function findModule(base: CourseProject, title: string): { module: CourseModule; exact: boolean } | null {
  const norm = normalizeTitle(title);
  if (!norm) return null;
  const exact = base.modules.find((item) => normalizeTitle(item.title) === norm);
  if (exact) return { module: exact, exact: true };
  const fuzzy = base.modules.find((item) => {
    const candidate = normalizeTitle(item.title);
    return candidate.includes(norm) || norm.includes(candidate);
  });
  return fuzzy ? { module: fuzzy, exact: false } : null;
}

function findStep(base: CourseProject, moduleHint: CourseModule | null, title: string): { module: CourseModule; step: LessonStep; exact: boolean } | null {
  const norm = normalizeTitle(title);
  if (!norm) return null;
  const ordered: CourseModule[] = moduleHint
    ? [moduleHint, ...base.modules.filter((item) => item.id !== moduleHint.id)]
    : base.modules;
  for (const mod of ordered) {
    const step = mod.steps.find((item) => normalizeTitle(item.title) === norm);
    if (step) return { module: mod, step, exact: true };
  }
  for (const mod of ordered) {
    const step = mod.steps.find((item) => {
      const candidate = normalizeTitle(item.title);
      return candidate.includes(norm) || norm.includes(candidate);
    });
    if (step) return { module: mod, step, exact: false };
  }
  return null;
}

function locateStep(project: CourseProject, stepId: string): { module: CourseModule; step: LessonStep } | null {
  for (const mod of project.modules) {
    const step = mod.steps.find((item) => item.id === stepId);
    if (step) return { module: mod, step };
  }
  return null;
}

export function importReviewComments(
  text: string,
  base: CourseProject,
  current: CourseProject,
  existing: ReviewRound[],
  baseVersionNumber: number,
): ImportResult {
  const parsed = parseReviewText(text);
  const importVersion = extractVersionNumber(parsed.versionLabel);
  const versionOld = importVersion > 0 && importVersion < baseVersionNumber;

  const seen = new Set<string>();
  for (const round of existing) for (const comment of round.comments) seen.add(comment.dedupKey);

  const comments: ReviewComment[] = [];
  let duplicateCount = 0;
  const now = new Date().toISOString();

  for (const block of parsed.targets) {
    const { type, title, moduleHint } = block.target;
    let moduleId = '';
    let stepId: string | undefined;
    let targetTitle = title;
    let conflictKind: ConflictKind | undefined;
    let conflictDetail: string | undefined;

    if (type === 'module') {
      const found = findModule(base, title);
      if (!found) {
        conflictKind = 'missing';
        conflictDetail = `在所选冻结版本中找不到模块「${title}」，请重新指定归属或跳过。`;
      } else {
        moduleId = found.module.id;
        targetTitle = found.module.title;
      }
    } else {
      const hint = moduleHint ? findModule(base, moduleHint)?.module ?? null : null;
      const found = findStep(base, hint, title);
      if (!found) {
        conflictKind = 'missing';
        conflictDetail = `在所选冻结版本中找不到步骤「${title}」，请重新指定归属或跳过。`;
      } else {
        moduleId = found.module.id;
        stepId = found.step.id;
        targetTitle = found.step.title;
        const located = locateStep(current, found.step.id);
        if (located && located.module.id !== found.module.id) {
          conflictKind = 'moved';
          conflictDetail = `步骤「${found.step.title}」在当前版本中已移到「${located.module.title}」，批注将按冻结版本的归属应用。`;
        }
      }
    }

    for (const content of block.comments) {
      const key = commentDedupKey(type, moduleId, stepId, content);
      if (seen.has(key)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(key);
      comments.push({
        id: `comment-${Date.now().toString(36)}-${comments.length}`,
        dedupKey: key,
        targetType: type,
        moduleId,
        stepId,
        targetTitle,
        content,
        decision: 'pending',
        conflictKind,
        conflictDetail: conflictKind ? conflictDetail : undefined,
        importedAt: now,
      });
    }
  }

  return { comments, duplicateCount, versionOld, versionLabel: parsed.versionLabel };
}

export function createReviewRound(project: CourseProject, frozenVersionId: string): ReviewRound {
  const frozen = project.frozenVersions.find((item) => item.id === frozenVersionId);
  const snapshot = frozen?.snapshot;
  return {
    id: `round-${Date.now().toString(36)}`,
    frozenVersionId,
    frozenLabel: frozen?.label ?? '冻结版本',
    basedOnRevision: snapshot?.revision ?? project.revision,
    basedOnLabel: frozen?.label ?? '',
    createdAt: new Date().toISOString(),
    status: 'open',
    comments: [],
  };
}

export function roundBaseSnapshot(project: CourseProject, round: ReviewRound): CourseProject | null {
  const frozen = project.frozenVersions.find((item) => item.id === round.frozenVersionId);
  return frozen ? (structuredClone(frozen.snapshot) as CourseProject) : null;
}

export function retargetComment(
  comment: ReviewComment,
  targetType: CommentTargetType,
  moduleId: string,
  stepId: string | undefined,
  targetTitle: string,
): ReviewComment {
  return {
    ...comment,
    targetType,
    moduleId,
    stepId,
    targetTitle,
    conflictKind: undefined,
    conflictDetail: undefined,
    retargeted: true,
  };
}

function applyCandidate(project: CourseProject, comment: ReviewComment): void {
  if (!comment.candidate) return;
  const { field, value } = comment.candidate;
  if (comment.targetType === 'module') {
    const mod = project.modules.find((item) => item.id === comment.moduleId);
    if (mod) (mod as unknown as Record<string, unknown>)[field] = value;
    return;
  }
  const mod = project.modules.find((item) => item.id === comment.moduleId);
  const step = mod?.steps.find((item) => item.id === comment.stepId);
  if (!step) return;
  if (field === 'commonMistakes') {
    step.commonMistakes = value.split('\n').map((item) => item.trim()).filter(Boolean);
  } else if (field === 'duration') {
    step.duration = Number(value) || 0;
  } else {
    (step as unknown as Record<string, unknown>)[field] = value;
  }
}

export function confirmReviewRound(project: CourseProject, roundId: string): CourseProject {
  const round = project.reviewRounds.find((item) => item.id === roundId);
  if (!round || round.status !== 'open') return project;
  const frozen = project.frozenVersions.find((item) => item.id === round.frozenVersionId);
  if (!frozen) return project;

  const next = structuredClone(frozen.snapshot) as CourseProject;
  next.modules = next.modules ?? [];
  next.frozenVersions = project.frozenVersions;
  next.reviewRounds = project.reviewRounds ?? [];

  for (const comment of round.comments) {
    if (comment.decision === 'adopt' && comment.candidate) applyCandidate(next, comment);
  }

  const confirmedAt = new Date().toISOString();
  next.status = 'draft';
  next.revision = project.revision + 1;
  next.lastSavedAt = confirmedAt;
  next.reviewRounds = next.reviewRounds.map((item) => (item.id === roundId
    ? { ...item, status: 'confirmed' as const, confirmedAt, resultRevision: next.revision }
    : item));
  return next;
}

export function roundProgress(round: ReviewRound): { total: number; decided: number; adopted: number; kept: number; pending: number; blocked: number } {
  const total = round.comments.length;
  const adopted = round.comments.filter((item) => item.decision === 'adopt').length;
  const kept = round.comments.filter((item) => item.decision === 'keep').length;
  const pending = round.comments.filter((item) => item.decision === 'pending').length;
  const blocked = round.comments.filter((item) => item.conflictKind === 'missing' || item.conflictKind === 'moved').length;
  return { total, decided: adopted + kept, adopted, kept, pending, blocked };
}

