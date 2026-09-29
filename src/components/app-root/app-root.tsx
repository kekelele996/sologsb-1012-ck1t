import { Component, Host, State, h, Listen } from '@stencil/core';
import {
  cloneProject,
  confirmReviewRound,
  createDemoProject,
  createReviewRound,
  importReviewComments,
  MODULE_FIELDS,
  retargetComment,
  roundBaseSnapshot,
  roundProgress,
  selectedModule,
  selectedStep,
  STORAGE_KEY,
  STEP_FIELDS,
  validateProject,
  type CameraAngle,
  type CaptionPosition,
  type CommentTargetType,
  type CourseModule,
  type CourseProject,
  type Difficulty,
  type FieldSpec,
  type GestureZone,
  type LessonStep,
  type ReviewComment,
  type ReviewRound,
  type ValidationCheck,
} from '../../models';

type PreviewSize = 'phone' | 'tablet';

@Component({
  tag: 'app-root',
  styleUrl: 'app-root.css',
  scoped: true,
})
export class AppRoot {
  @State() project: CourseProject = createDemoProject();
  @State() previewSize: PreviewSize = 'phone';
  @State() activePanel: 'editor' | 'checks' | 'review' = 'editor';
  @State() activeRoundId?: string;
  @State() importText = '';
  @State() importVersionOld = false;
  @State() importVersionLabel?: string;
  @State() playing = false;
  @State() playProgress = 0;
  @State() offline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
  @State() toast?: { color: string; message: string };
  private past: CourseProject[] = [];
  private future: CourseProject[] = [];
  private playTimer?: number;

  componentWillLoad(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) this.project = JSON.parse(saved) as CourseProject;
    } catch {
      this.project = createDemoProject();
    }
  }

  disconnectedCallback(): void {
    if (this.playTimer) window.clearInterval(this.playTimer);
  }

  @Listen('online', { target: 'window' })
  handleOnline(): void {
    this.offline = false;
    this.showToast('success', '网络已恢复，本地草稿无需合并即可继续编辑。');
  }

  @Listen('offline', { target: 'window' })
  handleOffline(): void {
    this.offline = true;
    this.showToast('warning', '当前处于离线状态，修改会继续保存在本机。');
  }

  @Listen('keydown', { target: 'window' })
  handleKeyboard(event: KeyboardEvent): void {
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName);
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.saveDraft(true);
      return;
    }
    if (!editing && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      this.moveStep(event.key === 'ArrowUp' ? -1 : 1);
    }
  }

  private get currentModule(): CourseModule {
    return selectedModule(this.project);
  }

  private get currentStep(): LessonStep | undefined {
    return selectedStep(this.project);
  }

  private get checks(): ValidationCheck[] {
    return validateProject(this.project);
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project));
  }

  private commit(update: (draft: CourseProject) => CourseProject, toast?: string): void {
    if (this.project.status === 'frozen') {
      this.showToast('warning', '当前版本已冻结，请先创建修订版。');
      return;
    }
    const before = cloneProject(this.project);
    const next = update(cloneProject(this.project));
    next.revision = before.revision + 1;
    next.lastSavedAt = new Date().toISOString();
    this.past = [...this.past, before].slice(-80);
    this.future = [];
    this.project = next;
    this.persist();
    if (toast) this.showToast('success', toast);
  }

  private undo(): void {
    const previous = this.past.pop();
    if (!previous) return this.showToast('medium', '没有可撤销的修改。');
    this.future = [cloneProject(this.project), ...this.future].slice(0, 80);
    this.project = previous;
    this.persist();
  }

  private redo(): void {
    const next = this.future.shift();
    if (!next) return;
    this.past = [...this.past, cloneProject(this.project)].slice(-80);
    this.project = next;
    this.persist();
  }

  private showToast(color: string, message: string): void {
    this.toast = { color, message };
    window.setTimeout(() => {
      if (this.toast?.message === message) this.toast = undefined;
    }, 3_200);
  }

  private selectModule(moduleId: string): void {
    const module = this.project.modules.find((item) => item.id === moduleId);
    this.project = { ...this.project, selectedModuleId: moduleId, selectedStepId: module?.steps[0]?.id ?? '' };
    this.persist();
  }

  private selectStep(stepId: string): void {
    this.project = { ...this.project, selectedStepId: stepId };
    this.persist();
  }

  private updateStep(patch: Partial<LessonStep>, toast?: string): void {
    const stepId = this.currentStep?.id;
    if (!stepId) return;
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((module) => module.id === draft.selectedModuleId ? {
        ...module,
        steps: module.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step),
      } : module),
    }), toast);
  }

  private updateCurrentModule(patch: Partial<CourseModule>): void {
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((module) => module.id === draft.selectedModuleId ? { ...module, ...patch } : module),
    }));
  }

  private addModule(): void {
    const index = this.project.modules.length + 1;
    const module: CourseModule = {
      id: `module-${Date.now().toString(36)}`,
      title: `模块 ${index} · 未命名`,
      summary: '说明该模块的学习目标与适用场景。',
      color: ['#15827a', '#8a3ffc', '#b34331', '#376ea8'][index % 4],
      steps: [],
    };
    this.commit((draft) => ({ ...draft, modules: [...draft.modules, module], selectedModuleId: module.id, selectedStepId: '' }), '已创建课程模块。');
  }

  private addStep(kind: LessonStep['kind'] = '示范'): void {
    const module = this.currentModule;
    if (!module) return this.addModule();
    const prior = module.steps.at(-1);
    const step: LessonStep = {
      id: `step-${Date.now().toString(36)}`,
      title: `新${kind}步骤 ${module.steps.length + 1}`,
      kind,
      duration: 45,
      demoTitle: '等待上传或录制示范片段',
      demoUrl: '',
      handshape: '描述起始手形、掌心方向和运动路径。',
      gestureZone: '中央',
      caption: '填写送给学习者的字幕说明。',
      captionPosition: '下方安全区',
      camera: '正面',
      commonMistakes: [],
      exercise: kind === '练习' ? '填写练习任务。' : '',
      exerciseFeedback: kind === '练习' ? '填写反馈方式。' : '',
      altText: '',
      prerequisiteId: prior?.id ?? '',
      difficulty: '入门',
      cuePoints: [8, 20, 32],
    };
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((item) => item.id === module.id ? { ...item, steps: [...item.steps, step] } : item),
      selectedStepId: step.id,
    }), '已新增学习步骤。');
  }

  private duplicateStep(): void {
    const step = this.currentStep;
    if (!step) return;
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((module) => {
        if (module.id !== draft.selectedModuleId) return module;
        const index = module.steps.findIndex((item) => item.id === step.id);
        const duplicate = { ...structuredClone(step), id: `step-${Date.now().toString(36)}`, title: `${step.title}（副本）` };
        return { ...module, steps: [...module.steps.slice(0, index + 1), duplicate, ...module.steps.slice(index + 1)] };
      }),
    }), '已复制当前步骤。');
  }

  private deleteStep(stepId: string): void {
    if (this.currentModule.steps.length <= 1) {
      this.showToast('warning', '模块至少保留一个学习步骤。');
      return;
    }
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((module) => module.id === draft.selectedModuleId ? {
        ...module,
        steps: module.steps.filter((step) => step.id !== stepId),
      } : module),
      selectedStepId: this.currentModule.steps.find((step) => step.id !== stepId)?.id ?? '',
    }), '已删除学习步骤。');
  }

  private moveStep(direction: number): void {
    const stepId = this.currentStep?.id;
    if (!stepId) return;
    this.commit((draft) => ({
      ...draft,
      modules: draft.modules.map((module) => {
        if (module.id !== draft.selectedModuleId) return module;
        const index = module.steps.findIndex((step) => step.id === stepId);
        const nextIndex = Math.max(0, Math.min(module.steps.length - 1, index + direction));
        if (index === nextIndex) return module;
        const steps = [...module.steps];
        const [item] = steps.splice(index, 1);
        steps.splice(nextIndex, 0, item);
        return { ...module, steps };
      }),
    }), '已调整步骤顺序。');
  }

  private saveDraft(showMessage = true): void {
    if (this.project.status === 'frozen') {
      this.showToast('warning', '冻结版本不可覆盖，请先创建修订版。');
      return;
    }
    this.project = { ...this.project, status: 'draft', lastSavedAt: new Date().toISOString() };
    this.persist();
    if (showMessage) this.showToast('success', '草稿已保存在浏览器本地。');
  }

  private submitForReview(): void {
    const blocking = this.checks.filter((check) => check.severity === 'error');
    if (blocking.length) {
      this.activePanel = 'checks';
      this.showToast('danger', `仍有 ${blocking.length} 个阻断问题，修复后才能提交复核。`);
      return;
    }
    this.commit((draft) => ({ ...draft, status: 'review' }), '课程已提交复核。');
  }

  private returnForChanges(): void {
    this.commit((draft) => ({ ...draft, status: 'changes' }), '课程已退回修改。');
  }

  private freezeVersion(): void {
    const blocking = this.checks.filter((check) => check.severity === 'error');
    if (blocking.length) {
      this.activePanel = 'checks';
      this.showToast('danger', `冻结前仍有 ${blocking.length} 个阻断问题。`);
      return;
    }
    this.commit((draft) => {
      const { frozenVersions, ...snapshot } = cloneProject(draft);
      const version = {
        id: `frozen-${Date.now().toString(36)}`,
        label: `冻结版本 v${frozenVersions.length + 1}`,
        createdAt: new Date().toISOString(),
        snapshot,
      };
      return { ...draft, status: 'frozen', frozenVersions: [version, ...frozenVersions] };
    }, '当前课程版本已冻结。');
    this.playing = false;
  }

  private reviseFrozen(): void {
    this.commit((draft) => ({ ...draft, status: 'draft' }), '已创建修订版，可继续编辑。');
  }

  // ===== 审阅回合 =====
  private get activeRound(): ReviewRound | undefined {
    return this.project.reviewRounds.find((round) => round.id === this.activeRoundId);
  }

  private get openRoundCount(): number {
    return this.project.reviewRounds.filter((round) => round.status === 'open').length;
  }

  private openReviewPanel(): void {
    this.activePanel = 'review';
    const open = this.project.reviewRounds.find((round) => round.status === 'open');
    this.activeRoundId = open?.id;
    this.importText = '';
    this.importVersionOld = false;
    this.importVersionLabel = undefined;
  }

  private startRound(frozenVersionId: string): void {
    const round = createReviewRound(this.project, frozenVersionId);
    this.project = { ...this.project, reviewRounds: [round, ...this.project.reviewRounds] };
    this.activeRoundId = round.id;
    this.importText = '';
    this.importVersionOld = false;
    this.importVersionLabel = undefined;
    this.persist();
  }

  private openRound(roundId: string): void {
    this.activeRoundId = roundId;
    this.importText = '';
    this.importVersionOld = false;
    this.importVersionLabel = undefined;
  }

  private deleteRound(roundId: string): void {
    this.project = { ...this.project, reviewRounds: this.project.reviewRounds.filter((round) => round.id !== roundId) };
    if (this.activeRoundId === roundId) this.activeRoundId = undefined;
    this.persist();
    this.showToast('success', '已删除该审阅回合。');
  }

  private updateRound(roundId: string, patch: Partial<ReviewRound>): void {
    this.project = {
      ...this.project,
      reviewRounds: this.project.reviewRounds.map((round) => (round.id === roundId ? { ...round, ...patch } : round)),
    };
    this.persist();
  }

  private importComments(): void {
    const round = this.activeRound;
    if (!round) return;
    const text = this.importText.trim();
    if (!text) {
      this.showToast('warning', '请先粘贴教研组带回的离线批注。');
      return;
    }
    const base = roundBaseSnapshot(this.project, round);
    if (!base) {
      this.showToast('danger', '找不到该回合对应的冻结版本，无法匹配批注。');
      return;
    }
    const baseVersion = Number(round.frozenLabel.match(/(\d+)/)?.[1] ?? round.basedOnRevision);
    const result = importReviewComments(text, base, this.project, this.project.reviewRounds, baseVersion);
    if (result.comments.length === 0) {
      this.showToast('warning', result.duplicateCount
        ? `导入的 ${result.duplicateCount} 条意见均已处理过，已自动忽略。`
        : '未识别到可导入的意见，请按「[模块]/[步骤] + - 意见」格式粘贴。');
      return;
    }
    this.updateRound(round.id, { comments: [...round.comments, ...result.comments] });
    this.importText = '';
    this.importVersionOld = result.versionOld;
    this.importVersionLabel = result.versionLabel;
    const parts = [`已导入 ${result.comments.length} 条意见`];
    if (result.duplicateCount) parts.push(`忽略 ${result.duplicateCount} 条重复`);
    if (result.versionOld) parts.push('批注基于旧版本');
    this.showToast(result.versionOld ? 'warning' : 'success', `${parts.join('，')}。`);
  }

  private fieldSpecFor(comment: ReviewComment): FieldSpec[] {
    return comment.targetType === 'module' ? MODULE_FIELDS : STEP_FIELDS;
  }

  private fieldValueOf(comment: ReviewComment, field: string): string {
    const base = this.activeRound ? roundBaseSnapshot(this.project, this.activeRound) : null;
    if (!base) return '';
    if (comment.targetType === 'module') {
      const mod = base.modules.find((item) => item.id === comment.moduleId);
      return mod ? String((mod as unknown as Record<string, unknown>)[field] ?? '') : '';
    }
    const mod = base.modules.find((item) => item.id === comment.moduleId);
    const step = mod?.steps.find((item) => item.id === comment.stepId);
    if (!step) return '';
    if (field === 'commonMistakes') return step.commonMistakes.join('\n');
    return String((step as unknown as Record<string, unknown>)[field] ?? '');
  }

  private fieldLabelOf(comment: ReviewComment, field: string): string {
    return this.fieldSpecFor(comment).find((item) => item.value === field)?.label ?? field;
  }

  private moduleTitleOf(comment: ReviewComment): string {
    const base = this.activeRound ? roundBaseSnapshot(this.project, this.activeRound) : null;
    return base?.modules.find((item) => item.id === comment.moduleId)?.title ?? '未归属模块';
  }

  private suggestField(comment: ReviewComment): string {
    const content = comment.content;
    if (comment.targetType === 'module') {
      if (/目标|定位|summary/i.test(content)) return 'summary';
      if (/颜色|主题色|color/i.test(content)) return 'color';
      return 'title';
    }
    if (/字幕|caption/i.test(content)) return 'caption';
    if (/手形|手型|掌心|handshape/i.test(content)) return 'handshape';
    if (/时长|时间|duration|秒/i.test(content)) return 'duration';
    if (/镜头|机位|camera|角度/i.test(content)) return 'camera';
    if (/位置|区域|遮挡|zone/i.test(content)) return 'gestureZone';
    if (/替代文本|alt|无障碍/i.test(content)) return 'altText';
    if (/错误|mistake/i.test(content)) return 'commonMistakes';
    if (/练习|exercise/i.test(content)) return /反馈|feedback/i.test(content) ? 'exerciseFeedback' : 'exercise';
    if (/标题|名称|title/i.test(content)) return 'title';
    return 'caption';
  }

  private setCommentDecision(commentId: string, decision: ReviewComment['decision']): void {
    const round = this.activeRound;
    if (!round) return;
    const comments = round.comments.map((comment) => {
      if (comment.id !== commentId) return comment;
      if (decision === 'adopt') {
        const field = this.suggestField(comment);
        return { ...comment, decision, decidedAt: new Date().toISOString(), candidate: { field, value: this.fieldValueOf(comment, field) } };
      }
      return { ...comment, decision, decidedAt: new Date().toISOString(), candidate: decision === 'keep' ? undefined : comment.candidate };
    });
    this.updateRound(round.id, { comments });
  }

  private setCandidateField(commentId: string, field: string): void {
    const round = this.activeRound;
    if (!round) return;
    const comments = round.comments.map((comment) => (
      comment.id === commentId ? { ...comment, candidate: { field, value: this.fieldValueOf(comment, field) } } : comment
    ));
    this.updateRound(round.id, { comments });
  }

  private setCandidateValue(commentId: string, value: string): void {
    const round = this.activeRound;
    if (!round) return;
    const comments = round.comments.map((comment) => (
      comment.id === commentId && comment.candidate ? { ...comment, candidate: { ...comment.candidate, value } } : comment
    ));
    this.updateRound(round.id, { comments });
  }

  private skipConflict(commentId: string): void {
    const round = this.activeRound;
    if (!round) return;
    const comments = round.comments.map((comment) => (
      comment.id === commentId
        ? { ...comment, decision: 'keep' as const, candidate: undefined, conflictKind: undefined, conflictDetail: undefined, decidedAt: new Date().toISOString() }
        : comment
    ));
    this.updateRound(round.id, { comments });
  }

  private retarget(commentId: string, targetType: CommentTargetType, moduleId: string, stepId?: string): void {
    const round = this.activeRound;
    if (!round) return;
    const base = roundBaseSnapshot(this.project, round);
    if (!base) return;
    let targetTitle = '';
    if (targetType === 'module') {
      targetTitle = base.modules.find((item) => item.id === moduleId)?.title ?? '';
    } else {
      const mod = base.modules.find((item) => item.id === moduleId);
      targetTitle = mod?.steps.find((item) => item.id === stepId)?.title ?? '';
    }
    const comments = round.comments.map((comment) => (comment.id === commentId ? retargetComment(comment, targetType, moduleId, stepId, targetTitle) : comment));
    this.updateRound(round.id, { comments });
  }

  private confirmRound(): void {
    const round = this.activeRound;
    if (!round) return;
    const progress = roundProgress(round);
    if (progress.blocked > 0) {
      this.showToast('danger', '仍有冲突未处理，请先重新指定归属或跳过。');
      return;
    }
    if (progress.pending > 0) {
      this.showToast('warning', '还有意见未逐条选择采纳或保留。');
      return;
    }
    const missingCandidate = round.comments.some((comment) => comment.decision === 'adopt' && !comment.candidate?.value.trim());
    if (missingCandidate) {
      this.showToast('warning', '采纳的意见需要填写候选修改内容后再确认。');
      return;
    }
    const before = cloneProject(this.project);
    const next = confirmReviewRound(this.project, round.id);
    if (next === this.project) {
      this.showToast('danger', '生成修订版失败：找不到对应的冻结版本。');
      return;
    }
    this.past = [...this.past, before].slice(-80);
    this.future = [];
    this.project = next;
    this.activeRoundId = undefined;
    this.persist();
    this.showToast('success', `已基于「${round.frozenLabel}」生成新修订版（v${next.revision}），旧版本与处理记录已保留。`);
  }

  private togglePlay(): void {
    if (this.playTimer) {
      window.clearInterval(this.playTimer);
      this.playTimer = undefined;
      this.playing = false;
      return;
    }
    const duration = Math.max(10, this.currentStep?.duration ?? 40);
    this.playing = true;
    this.playTimer = window.setInterval(() => {
      this.playProgress += 0.25 / duration;
      if (this.playProgress >= 1) {
        this.playProgress = 0;
        this.playing = false;
        if (this.playTimer) window.clearInterval(this.playTimer);
        this.playTimer = undefined;
      }
    }, 250);
  }

  private formatDate(value: string): string {
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  }

  private renderStatusBadge() {
    if (this.project.status === 'review') return <ion-badge color="warning">待复核</ion-badge>;
    if (this.project.status === 'changes') return <ion-badge color="danger">已退回</ion-badge>;
    if (this.project.status === 'frozen') return <ion-badge color="success">已冻结</ion-badge>;
    return <ion-badge color="medium">草稿</ion-badge>;
  }

  private renderStepListItem(step: LessonStep, index: number) {
    const active = step.id === this.currentStep?.id;
    const issueCount = this.checks.filter((check) => check.stepId === step.id && check.severity !== 'info').length;
    return (
      <button class={`step-list-item ${active ? 'active' : ''}`} onClick={() => this.selectStep(step.id)}>
        <span class="step-index">{String(index + 1).padStart(2, '0')}</span>
        <span class="step-copy">
          <strong>{step.title}</strong>
          <small>{step.kind} · {step.duration}s · {step.difficulty}</small>
        </span>
        {issueCount > 0 && <span class="step-issue-count">{issueCount}</span>}
      </button>
    );
  }

  private renderStepEditor() {
    const step = this.currentStep;
    if (!step) {
      return (
        <div class="empty-editor">
          <div class="empty-glyph">手</div>
          <h2>这个模块还没有学习步骤</h2>
          <p>添加示范、讲解或练习步骤，然后设置前置条件与难度。</p>
          <ion-button class="studio-button" onClick={() => this.addStep('示范')}>添加第一个步骤</ion-button>
        </div>
      );
    }
    const frozen = this.project.status === 'frozen';
    const module = this.currentModule;
    const prerequisites = module.steps.filter((candidate, index) => candidate.id !== step.id && index < module.steps.findIndex((item) => item.id === step.id));
    return (
      <div class="step-editor">
        <div class="editor-title-row">
          <div>
            <span class="eyebrow">学习步骤 {module.steps.findIndex((item) => item.id === step.id) + 1}</span>
            <h1>{step.title}</h1>
            <p>最后修改 {this.formatDate(this.project.lastSavedAt)} · 修订号 {this.project.revision}</p>
          </div>
          <div class="title-actions">
            <ion-button fill="clear" class="studio-button" onClick={() => this.moveStep(-1)} title="Alt + ↑">上移</ion-button>
            <ion-button fill="clear" class="studio-button" onClick={() => this.moveStep(1)} title="Alt + ↓">下移</ion-button>
            <ion-button fill="outline" class="studio-button" onClick={() => this.duplicateStep()}>复制</ion-button>
            <ion-button fill="outline" color="danger" class="studio-button" onClick={() => this.deleteStep(step.id)}>删除</ion-button>
          </div>
        </div>

        {frozen && (
          <div class="frozen-callout">
            <div><strong>此版本已冻结</strong><span>字段已锁定，仍可预览和运行检查。</span></div>
            <ion-button size="small" class="studio-button" onClick={() => this.reviseFrozen()}>创建修订版</ion-button>
          </div>
        )}

        <section class="form-card">
          <div class="section-title"><span>01</span><div><h2>基础设计</h2><p>标题、类型、难度和预计时长</p></div></div>
          <div class="form-grid two">
            <ion-input disabled={frozen} label="步骤标题" labelPlacement="stacked" class="studio-input" value={step.title} onIonInput={(event) => this.updateStep({ title: event.detail.value ?? '' })} />
            <ion-select disabled={frozen} label="步骤类型" labelPlacement="stacked" class="studio-input" value={step.kind} onIonChange={(event) => this.updateStep({ kind: event.detail.value as LessonStep['kind'] })}>
              <ion-select-option value="示范">示范</ion-select-option>
              <ion-select-option value="讲解">讲解</ion-select-option>
              <ion-select-option value="练习">练习</ion-select-option>
            </ion-select>
            <ion-select disabled={frozen} label="难度标签" labelPlacement="stacked" class="studio-input" value={step.difficulty} onIonChange={(event) => this.updateStep({ difficulty: event.detail.value as Difficulty })}>
              {(['入门', '进阶', '挑战'] as Difficulty[]).map((item) => <ion-select-option value={item}>{item}</ion-select-option>)}
            </ion-select>
            <ion-input disabled={frozen} type="number" min="10" max="600" label="预计时长（秒）" labelPlacement="stacked" class="studio-input" value={String(step.duration)} onIonInput={(event) => this.updateStep({ duration: Number(event.detail.value) || 0 })} />
          </div>
        </section>

        <section class="form-card">
          <div class="section-title"><span>02</span><div><h2>示范片段与镜头</h2><p>记录素材标识、手形、镜头角度和动作区域</p></div></div>
          <div class="demo-row">
            <div class={`video-thumbnail zone-${step.gestureZone}`}>
              <span class="play-mark">▶</span>
              <strong>{step.kind}片段</strong>
              <small>{step.camera}</small>
            </div>
            <div class="demo-fields">
              <ion-input disabled={frozen} label="示范片段名称" labelPlacement="stacked" class="studio-input" value={step.demoTitle} onIonInput={(event) => this.updateStep({ demoTitle: event.detail.value ?? '' })} />
              <ion-input disabled={frozen} label="本地素材地址（可空）" labelPlacement="stacked" class="studio-input" value={step.demoUrl} placeholder="例如 assets/hello.mp4" onIonInput={(event) => this.updateStep({ demoUrl: event.detail.value ?? '' })} />
            </div>
          </div>
          <div class="form-grid two">
            <ion-select disabled={frozen} label="镜头角度" labelPlacement="stacked" class="studio-input" value={step.camera} onIonChange={(event) => this.updateStep({ camera: event.detail.value as CameraAngle })}>
              {(['正面', '左侧 45°', '右侧 45°', '俯拍手部', '全身远景'] as CameraAngle[]).map((item) => <ion-select-option value={item}>{item}</ion-select-option>)}
            </ion-select>
            <ion-select disabled={frozen} label="主要手形区域" labelPlacement="stacked" class="studio-input" value={step.gestureZone} onIonChange={(event) => this.updateStep({ gestureZone: event.detail.value as GestureZone })}>
              {(['左侧', '中央', '右侧'] as GestureZone[]).map((item) => <ion-select-option value={item}>{item}</ion-select-option>)}
            </ion-select>
          </div>
          <ion-textarea disabled={frozen} autoGrow label="手形说明" labelPlacement="stacked" class="studio-input" value={step.handshape} onIonInput={(event) => this.updateStep({ handshape: event.detail.value ?? '' })} />
        </section>

        <section class="form-card">
          <div class="section-title"><span>03</span><div><h2>字幕与无障碍</h2><p>检查字幕位置、动作遮挡与替代文本</p></div></div>
          <div class="form-grid two">
            <ion-select disabled={frozen} label="字幕位置" labelPlacement="stacked" class="studio-input" value={step.captionPosition} onIonChange={(event) => this.updateStep({ captionPosition: event.detail.value as CaptionPosition })}>
              {(['下方安全区', '上移 15%', '角标提示', '画面中央'] as CaptionPosition[]).map((item) => <ion-select-option value={item}>{item}</ion-select-option>)}
            </ion-select>
            <ion-input disabled={frozen} label="替代文本状态" labelPlacement="stacked" class={`studio-input ${step.altText ? '' : 'ion-invalid'}`} value={step.altText ? '已填写' : '缺失'} readonly />
          </div>
          <ion-textarea disabled={frozen} autoGrow label="步骤字幕" labelPlacement="stacked" class="studio-input" value={step.caption} onIonInput={(event) => this.updateStep({ caption: event.detail.value ?? '' })} />
          <ion-textarea disabled={frozen} autoGrow label="替代文本（必须描述动作与表情）" labelPlacement="stacked" class={`studio-input ${step.altText ? '' : 'ion-invalid'}`} value={step.altText} onIonInput={(event) => this.updateStep({ altText: event.detail.value ?? '' })} />
        </section>

        <section class="form-card">
          <div class="section-title"><span>04</span><div><h2>学习依赖与练习</h2><p>前置步骤、常见错误、练习任务与反馈</p></div></div>
          <div class="form-grid two">
            <ion-select disabled={frozen} label="前置条件" labelPlacement="stacked" class="studio-input" value={step.prerequisiteId} onIonChange={(event) => this.updateStep({ prerequisiteId: event.detail.value ?? '' })}>
              <ion-select-option value="">无前置条件</ion-select-option>
              {prerequisites.map((item) => <ion-select-option value={item.id}>{item.title}</ion-select-option>)}
            </ion-select>
            <ion-input disabled={frozen} label="检查点（秒，用逗号分隔）" labelPlacement="stacked" class="studio-input" value={step.cuePoints.join(', ')} onIonInput={(event) => this.updateStep({ cuePoints: (event.detail.value ?? '').split(/[,，\s]+/).map(Number).filter((value) => Number.isFinite(value)) })} />
          </div>
          <ion-textarea disabled={frozen} autoGrow label="常见错误（每行一条）" labelPlacement="stacked" class="studio-input" value={step.commonMistakes.join('\n')} onIonInput={(event) => this.updateStep({ commonMistakes: (event.detail.value ?? '').split('\n').filter(Boolean) })} />
          <div class="form-grid two">
            <ion-textarea disabled={frozen} autoGrow label="练习任务" labelPlacement="stacked" class="studio-input" value={step.exercise} onIonInput={(event) => this.updateStep({ exercise: event.detail.value ?? '' })} />
            <ion-textarea disabled={frozen} autoGrow label="练习反馈" labelPlacement="stacked" class="studio-input" value={step.exerciseFeedback} onIonInput={(event) => this.updateStep({ exerciseFeedback: event.detail.value ?? '' })} />
          </div>
        </section>
      </div>
    );
  }

  private renderPreview() {
    const step = this.currentStep;
    const progress = Math.round(this.playProgress * 100);
    return (
      <section class="preview-panel">
        <div class="preview-head">
          <div><span class="eyebrow">学习者预览</span><h2>设备与安全区检查</h2></div>
          <ion-segment value={this.previewSize} class="studio-segment" onIonChange={(event) => { this.previewSize = event.detail.value as PreviewSize; }}>
            <ion-segment-button value="phone">手机</ion-segment-button>
            <ion-segment-button value="tablet">平板</ion-segment-button>
          </ion-segment>
        </div>
        {step ? (
          <div class={`device-frame ${this.previewSize}`}>
            <div class="device-top"><span>{this.previewSize === 'phone' ? '9:16' : '4:3'}</span><span>{step.camera}</span></div>
            <div class={`preview-stage zone-${step.gestureZone} caption-${step.captionPosition.replace(/\s|%/g, '')} ${step.captionPosition === '画面中央' && step.gestureZone === '中央' ? 'overlap-warning' : ''}`}>
              <div class="stage-grid" />
              <div class="signer">
                <div class="head"><span class="face"><i /><i /></span></div>
                <div class="torso" />
                <div class="arm arm-left"><span class="hand" /></div>
                <div class="arm arm-right"><span class="hand" /></div>
              </div>
              <div class="gesture-marker" style={{ left: step.gestureZone === '左侧' ? '18%' : step.gestureZone === '右侧' ? '70%' : '43%' }} />
              <div class="caption-preview">{step.caption || '未填写字幕'}</div>
              {step.captionPosition === '角标提示' && <div class="corner-caption">{step.caption.slice(0, 18) || '角标提示'}</div>}
              <div class="safe-area"><span>字幕安全区</span></div>
            </div>
            <div class="player-controls">
              <button class="play-button" onClick={() => this.togglePlay()}>{this.playing ? 'Ⅱ' : '▶'}</button>
              <div class="player-timeline">
                <span style={{ width: `${progress}%` }} />
                {step.cuePoints.map((cue) => <i style={{ left: `${Math.min(100, (cue / Math.max(1, step.duration)) * 100)}%` }} title={`检查点 ${cue}s`} />)}
              </div>
              <span class="time-code">{String(Math.floor(this.playProgress * step.duration)).padStart(2, '0')} / {step.duration}s</span>
            </div>
            <div class="preview-meta">
              <div><strong>{step.kind}</strong><span>步骤类型</span></div>
              <div><strong>{step.difficulty}</strong><span>难度标签</span></div>
              <div><strong>{step.cuePoints.length}</strong><span>检查点</span></div>
            </div>
            <p class="preview-caption-text">{step.caption}</p>
          </div>
        ) : <div class="empty-preview">选择步骤后显示设备预览。</div>}
      </section>
    );
  }

  private renderChecks() {
    const errors = this.checks.filter((check) => check.severity === 'error');
    const warnings = this.checks.filter((check) => check.severity === 'warning');
    const info = this.checks.filter((check) => check.severity === 'info');
    return (
      <section class="checks-panel">
        <div class="checks-summary">
          <div class="check-stat danger"><strong>{errors.length}</strong><span>阻断问题</span></div>
          <div class="check-stat warning"><strong>{warnings.length}</strong><span>需注意</span></div>
          <div class="check-stat"><strong>{info.length}</strong><span>优化建议</span></div>
        </div>
        <div class="check-list">
          {this.checks.length === 0 && <div class="all-clear"><strong>✓ 未发现问题</strong><p>字幕遮挡、步骤跳级和替代文本检查均已通过。</p></div>}
          {this.checks.map((check) => (
            <button class={`check-item ${check.severity}`} onClick={() => {
              if (check.moduleId) this.selectModule(check.moduleId);
              if (check.stepId) this.selectStep(check.stepId);
              this.activePanel = 'editor';
            }}>
              <span class="check-severity">{check.severity === 'error' ? '!' : check.severity === 'warning' ? '△' : 'i'}</span>
              <span><strong>{check.title}</strong><small>{check.detail}</small></span>
              <span class="check-arrow">→</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  private renderReview() {
    const active = this.activeRound;
    return (
      <section class="review-panel">
        {active ? this.renderRoundDetail(active) : this.renderRoundList()}
      </section>
    );
  }

  private renderRoundList() {
    const frozen = this.project.frozenVersions;
    const rounds = this.project.reviewRounds;
    return (
      <div class="round-list">
        <div class="round-intro">
          <span class="eyebrow">离线批注复核</span>
          <h2>审阅回合</h2>
          <p>教研组带回的批注按冻结版本导入，逐条选择采纳或保留。采纳只形成候选修改、不覆盖冻结内容；确认后才从所选冻结版本生成新修订版，旧版本与处理记录都会保留，重开也能继续。</p>
        </div>

        {frozen.length === 0 ? (
          <div class="round-empty">
            <strong>还没有可审阅的冻结版本</strong>
            <p>先在课程处于「待复核」时冻结一个版本，再把教研组针对该版本的批注贴进来。</p>
          </div>
        ) : (
          <div class="round-start">
            <h3>新建审阅回合 · 选择冻结版本</h3>
            <div class="frozen-picker">
              {frozen.map((item) => (
                <button class="frozen-pick" key={item.id} onClick={() => this.startRound(item.id)}>
                  <strong>{item.label}</strong>
                  <small>{this.formatDate(item.createdAt)} · 修订号 {item.snapshot.revision}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        {rounds.length > 0 && (
          <div class="round-history">
            <h3>历史回合</h3>
            {rounds.map((round) => {
              const progress = roundProgress(round);
              return (
                <button class="round-card" key={round.id} onClick={() => this.openRound(round.id)}>
                  <div class="round-card-main">
                    <strong>{round.frozenLabel} 审阅回合</strong>
                    <small>{this.formatDate(round.createdAt)} · {round.comments.length} 条意见</small>
                  </div>
                  <div class="round-card-side">
                    {round.status === 'confirmed'
                      ? <span class="round-tag confirmed">已生成修订版 v{round.resultRevision}</span>
                      : <span class="round-tag open">进行中 · {progress.decided}/{progress.total}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  private renderRoundDetail(round: ReviewRound) {
    const progress = roundProgress(round);
    const confirmed = round.status === 'confirmed';
    const conflicts = round.comments.filter((comment) => comment.conflictKind === 'missing' || comment.conflictKind === 'moved');
    const ready = progress.blocked === 0 && progress.pending === 0
      && !round.comments.some((comment) => comment.decision === 'adopt' && !comment.candidate?.value.trim());

    return (
      <div class="round-detail">
        <div class="round-detail-head">
          <button class="back-button" onClick={() => { this.activeRoundId = undefined; }}>← 全部回合</button>
          <div class="round-detail-title">
            <h2>{round.frozenLabel} 审阅回合</h2>
            <p>基于修订号 {round.basedOnRevision} · {this.formatDate(round.createdAt)}</p>
          </div>
          {!confirmed && <button class="round-delete" onClick={() => this.deleteRound(round.id)}>删除回合</button>}
        </div>

        <div class="round-progress">
          <div><strong>{progress.total}</strong><span>意见总数</span></div>
          <div><strong>{progress.adopted}</strong><span>采纳</span></div>
          <div><strong>{progress.kept}</strong><span>保留</span></div>
          <div><strong>{progress.pending}</strong><span>待处理</span></div>
        </div>

        {!confirmed && (
          <div class="round-import">
            <h3>导入离线批注</h3>
            <p class="import-hint">
              粘贴教研组批注：用 <code>[模块] 标题</code> 或 <code>[步骤] 标题</code> 分组，意见以 <code>-</code> 开头；可在首行标注 <code>版本：v1</code> 表示批注基于的版本。同一意见重复导入只处理一次。
            </p>
            <textarea
              class="import-textarea"
              placeholder={'[模块] 模块一 · 日常问候\n- 建议在模块目标中补充与日常生活场景的联系\n\n[步骤] 观察“你好”的完整动作\n- 字幕与动作区域重叠，建议下移到安全区\n- 手形说明可补充掌心方向\n\n[步骤] 拆解“你好”的手形\n- 前置标注正确，保留即可'}
              value={this.importText}
              onInput={(event) => { this.importText = (event.target as HTMLTextAreaElement).value; }}
            />
            <div class="import-actions">
              <ion-button class="studio-button" onClick={() => this.importComments()}>导入批注</ion-button>
              <button class="link-button" onClick={() => { this.importText = ''; }}>清空</button>
            </div>
            {this.importVersionOld && (
              <div class="version-old-banner">这批批注基于旧版本（{this.importVersionLabel}），将按所选「{round.frozenLabel}」应用，请注意核对每条意见的归属。</div>
            )}
          </div>
        )}

        {conflicts.length > 0 && !confirmed && (
          <div class="conflict-summary">
            <strong>检测到 {conflicts.length} 个冲突</strong>
            <span>步骤被移动、原步骤不存在或批注基于旧版本时，请先在下方逐条重新指定归属或跳过，再决定采纳或保留。</span>
          </div>
        )}

        <div class="comment-list">
          {round.comments.length === 0 && (
            <div class="round-empty"><strong>还没有导入意见</strong><p>在上方粘贴教研组批注并导入，意见会按模块和步骤归类。</p></div>
          )}
          {round.comments.map((comment) => this.renderCommentCard(comment, confirmed))}
        </div>

        {!confirmed ? (
          <div class="round-confirm">
            <div class="confirm-readiness">
              {progress.blocked > 0 && <span class="warn">还有 {progress.blocked} 个冲突未处理</span>}
              {progress.blocked === 0 && progress.pending > 0 && <span class="warn">还有 {progress.pending} 条意见未决定</span>}
              {progress.blocked === 0 && progress.pending === 0 && round.comments.some((comment) => comment.decision === 'adopt' && !comment.candidate?.value.trim()) && <span class="warn">采纳的意见需填写候选修改</span>}
              {ready && <span class="ok">所有意见已处理，可基于「{round.frozenLabel}」生成新修订版</span>}
            </div>
            <ion-button color="success" class="studio-button" disabled={!ready} onClick={() => this.confirmRound()}>确认并生成新修订版</ion-button>
          </div>
        ) : (
          <div class="round-confirmed-banner">已基于「{round.frozenLabel}」生成新修订版 v{round.resultRevision}，旧版本与本回合处理记录均已保留，可返回步骤编排继续编辑。</div>
        )}
      </div>
    );
  }

  private renderCommentCard(comment: ReviewComment, confirmed: boolean) {
    const isModule = comment.targetType === 'module';
    const targetLabel = isModule ? comment.targetTitle : `${this.moduleTitleOf(comment)} · ${comment.targetTitle}`;
    const adopted = comment.decision === 'adopt';
    const kept = comment.decision === 'keep';
    const conflict = comment.conflictKind;

    return (
      <div class={`comment-card ${comment.decision !== 'pending' ? `decided ${comment.decision}` : ''} ${conflict ? 'has-conflict' : ''}`} key={comment.id}>
        <div class="comment-target">
          <span class={`target-badge ${isModule ? 'module' : 'step'}`}>{isModule ? '模块' : '步骤'}</span>
          <strong>{targetLabel}</strong>
          {comment.retargeted && <span class="retargeted-tag">已重新指定</span>}
        </div>
        <p class="comment-content">{comment.content}</p>

        {conflict && !confirmed && (
          <div class="conflict-box">
            <strong>{conflict === 'missing' ? '原目标不存在' : '目标已被移动'}</strong>
            <span>{comment.conflictDetail}</span>
            <div class="conflict-actions">
              {isModule ? this.renderModuleRetarget(comment) : this.renderStepRetarget(comment)}
              <button class="link-button danger" onClick={() => this.skipConflict(comment.id)}>跳过（保留原文）</button>
            </div>
          </div>
        )}

        {!confirmed && !conflict && (
          <div class="comment-decision">
            <button class={adopted ? 'active adopt' : ''} onClick={() => this.setCommentDecision(comment.id, 'adopt')}>采纳并修改</button>
            <button class={kept ? 'active keep' : ''} onClick={() => this.setCommentDecision(comment.id, 'keep')}>保留原文</button>
          </div>
        )}

        {adopted && comment.candidate && !confirmed && !conflict && (
          <div class="candidate-editor">
            <div class="candidate-field">
              <label>修改字段</label>
              <ion-select class="studio-input" value={comment.candidate.field} onIonChange={(event) => this.setCandidateField(comment.id, event.detail.value as string)}>
                {this.fieldSpecFor(comment).map((field) => <ion-select-option value={field.value}>{field.label}</ion-select-option>)}
              </ion-select>
            </div>
            <div class="candidate-value">
              <label>候选新值（不覆盖冻结内容，确认后才写入新修订版）</label>
              {this.renderCandidateInput(comment)}
            </div>
            <div class="candidate-diff"><span>原值：{this.fieldValueOf(comment, comment.candidate.field) || '（空）'}</span></div>
          </div>
        )}

        {confirmed && adopted && comment.candidate && (
          <div class="candidate-readonly">已采纳 · {this.fieldLabelOf(comment, comment.candidate.field)}：{comment.candidate.value}</div>
        )}
        {confirmed && kept && <div class="kept-note">已保留原文，未做修改。</div>}
      </div>
    );
  }

  private renderCandidateInput(comment: ReviewComment) {
    const candidate = comment.candidate;
    if (!candidate) return null;
    const spec = this.fieldSpecFor(comment).find((item) => item.value === candidate.field);
    if (!spec) return null;
    if (spec.type === 'textarea') {
      return <ion-textarea autoGrow class="studio-input" value={candidate.value} onIonInput={(event) => this.setCandidateValue(comment.id, event.detail.value ?? '')} />;
    }
    if (spec.type === 'number') {
      return <ion-input type="number" class="studio-input" value={candidate.value} onIonInput={(event) => this.setCandidateValue(comment.id, event.detail.value ?? '')} />;
    }
    if (spec.type === 'select' && spec.options) {
      return (
        <ion-select class="studio-input" value={candidate.value} onIonChange={(event) => this.setCandidateValue(comment.id, event.detail.value as string)}>
          {spec.options.map((option) => <ion-select-option value={option}>{option}</ion-select-option>)}
        </ion-select>
      );
    }
    return <ion-input class="studio-input" value={candidate.value} onIonInput={(event) => this.setCandidateValue(comment.id, event.detail.value ?? '')} />;
  }

  private renderModuleRetarget(comment: ReviewComment) {
    const base = this.activeRound ? roundBaseSnapshot(this.project, this.activeRound) : null;
    if (!base) return null;
    return (
      <div class="retarget-row">
        <ion-select
          class="studio-input retarget-select"
          value={comment.moduleId}
          placeholder="重新指定模块…"
          onIonChange={(event) => this.retarget(comment.id, 'module', event.detail.value as string)}
        >
          {base.modules.map((mod) => <ion-select-option value={mod.id}>{mod.title}</ion-select-option>)}
        </ion-select>
      </div>
    );
  }

  private renderStepRetarget(comment: ReviewComment) {
    const base = this.activeRound ? roundBaseSnapshot(this.project, this.activeRound) : null;
    if (!base) return null;
    const currentModule = base.modules.find((mod) => mod.id === comment.moduleId);
    const steps = currentModule?.steps ?? [];
    return (
      <div class="retarget-row">
        <ion-select
          class="studio-input retarget-select"
          value={comment.moduleId}
          placeholder="选择模块…"
          onIonChange={(event) => {
            const newModuleId = event.detail.value as string;
            const newModule = base.modules.find((mod) => mod.id === newModuleId);
            const keepStep = newModule?.steps.some((step) => step.id === comment.stepId) ? comment.stepId : undefined;
            this.retarget(comment.id, 'step', newModuleId, keepStep);
          }}
        >
          {base.modules.map((mod) => <ion-select-option value={mod.id}>{mod.title}</ion-select-option>)}
        </ion-select>
        <ion-select
          class="studio-input retarget-select"
          value={comment.stepId ?? ''}
          placeholder="选择步骤…"
          onIonChange={(event) => this.retarget(comment.id, 'step', comment.moduleId, event.detail.value as string)}
        >
          {steps.map((step) => <ion-select-option value={step.id}>{step.title}</ion-select-option>)}
        </ion-select>
      </div>
    );
  }

  render() {
    const module = this.currentModule;
    const errors = this.checks.filter((check) => check.severity === 'error').length;
    return (
      <Host>
        <ion-app>
          <ion-header class="studio-header">
            <ion-toolbar>
              <ion-buttons slot="start"><div class="logo-mark">手</div><div class="app-title"><strong>SignCourse Studio</strong><span>手语课程编排工具</span></div></ion-buttons>
              <ion-buttons slot="end" class="header-actions">
                <button class={`connection-status ${this.offline ? 'offline' : ''}`} onClick={() => { this.offline = !this.offline; this.showToast(this.offline ? 'warning' : 'success', this.offline ? '已进入离线模拟，编辑继续保存在本机。' : '已恢复在线模拟，本地草稿保持同步。'); }}><span />{this.offline ? '离线编辑中（点击恢复）' : '本地自动保存（点击模拟离线）'}</button>
                <ion-button fill="clear" class="studio-button" disabled={this.past.length === 0} onClick={() => this.undo()}>撤销</ion-button>
                <ion-button fill="clear" class="studio-button" disabled={this.future.length === 0} onClick={() => this.redo()}>重做</ion-button>
                <ion-button fill="outline" class="studio-button" onClick={() => this.saveDraft()}>保存草稿</ion-button>
                {this.project.status === 'review'
                  ? <ion-button color="success" class="studio-button" onClick={() => this.freezeVersion()}>冻结版本</ion-button>
                  : this.project.status === 'changes'
                    ? <ion-button color="warning" class="studio-button" onClick={() => this.submitForReview()}>重新提交</ion-button>
                    : this.project.status === 'frozen'
                      ? <ion-button class="studio-button" onClick={() => this.reviseFrozen()}>创建修订版</ion-button>
                      : <ion-button color="primary" class="studio-button" onClick={() => this.submitForReview()}>提交复核</ion-button>}
              </ion-buttons>
            </ion-toolbar>
          </ion-header>

          <ion-content fullscreen>
            <div class="project-ribbon">
              <div class="project-heading">
                {this.renderStatusBadge()}
                <ion-input value={this.project.title} class="project-title-input" onIonInput={(event) => { this.project = { ...this.project, title: event.detail.value ?? '' }; this.persist(); }} />
                <span>{this.project.teacher} · {this.project.audience}</span>
              </div>
              <div class="project-metrics">
                <div><strong>{this.project.modules.length}</strong><span>模块</span></div>
                <div><strong>{this.project.modules.reduce((sum, item) => sum + item.steps.length, 0)}</strong><span>步骤</span></div>
                <div><strong>{Math.ceil(this.project.modules.reduce((sum, item) => sum + item.steps.reduce((total, lesson) => total + lesson.duration, 0), 0) / 60)}</strong><span>分钟</span></div>
                <div class={errors ? 'has-errors' : ''}><strong>{errors}</strong><span>阻断问题</span></div>
              </div>
              <div class="workflow-actions">
                {this.project.status === 'review' && <ion-button fill="clear" color="danger" class="studio-button" onClick={() => this.returnForChanges()}>退回修改</ion-button>}
                {this.project.status === 'draft' && <ion-button fill="clear" class="studio-button" onClick={() => this.addModule()}>＋ 新建模块</ion-button>}
                <ion-button fill="clear" class="studio-button" onClick={() => this.addStep('练习')}>＋ 练习步骤</ion-button>
              </div>
            </div>

            <main class="studio-workspace">
              <aside class="course-panel">
                <div class="panel-heading"><div><span class="eyebrow">课程结构</span><h2>模块与步骤</h2></div><button class="add-step-button" onClick={() => this.addStep('示范')}>＋</button></div>
                <div class="module-list">
                  {this.project.modules.map((item) => (
                    <section class={`module-card ${item.id === module?.id ? 'active' : ''}`} key={item.id}>
                      <button class="module-head" onClick={() => this.selectModule(item.id)}>
                        <span class="module-color" style={{ background: item.color }} />
                        <span><strong>{item.title}</strong><small>{item.steps.length} 个学习步骤</small></span>
                      </button>
                      {item.id === module?.id && <div class="step-list">{item.steps.map((lesson, index) => this.renderStepListItem(lesson, index))}</div>}
                    </section>
                  ))}
                </div>
                <div class="module-editor">
                  <ion-input disabled={this.project.status === 'frozen'} label="当前模块标题" labelPlacement="stacked" class="studio-input" value={module?.title ?? ''} onIonInput={(event) => this.updateCurrentModule({ title: event.detail.value ?? '' })} />
                  <ion-textarea disabled={this.project.status === 'frozen'} autoGrow label="模块目标" labelPlacement="stacked" class="studio-input" value={module?.summary ?? ''} onIonInput={(event) => this.updateCurrentModule({ summary: event.detail.value ?? '' })} />
                </div>
              </aside>

              <section class="editor-panel">
                <div class="panel-switcher">
                  <button class={this.activePanel === 'editor' ? 'active' : ''} onClick={() => { this.activePanel = 'editor'; }}>步骤编排</button>
                  <button class={this.activePanel === 'checks' ? 'active' : ''} onClick={() => { this.activePanel = 'checks'; }}>发布前检查 <span>{this.checks.length}</span></button>
                  <button class={this.activePanel === 'review' ? 'active' : ''} onClick={() => this.openReviewPanel()}>审阅回合 {this.openRoundCount > 0 && <span>{this.openRoundCount}</span>}</button>
                </div>
                <div class="editor-scroll">
                  {this.activePanel === 'editor' ? this.renderStepEditor() : this.activePanel === 'checks' ? this.renderChecks() : this.renderReview()}
                </div>
              </section>

              {this.renderPreview()}
            </main>
          </ion-content>
          <ion-toast isOpen={Boolean(this.toast)} message={this.toast?.message} color={this.toast?.color} duration={3200} onDidDismiss={() => { this.toast = undefined; }} />
        </ion-app>
      </Host>
    );
  }
}
