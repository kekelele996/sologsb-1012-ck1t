import { Component, Host, State, h, Listen } from '@stencil/core';
import {
  cloneProject,
  createDemoProject,
  selectedModule,
  selectedStep,
  STORAGE_KEY,
  validateProject,
  type CameraAngle,
  type CaptionPosition,
  type CourseModule,
  type CourseProject,
  type Difficulty,
  type GestureZone,
  type LessonStep,
  type ProjectSnapshot,
  type ReviewAnnotation,
  type ReviewDecision,
  type ReviewRound,
  type ValidationCheck,
} from '../../models';
import {
  SAMPLE_ANNOTATIONS,
  annotationFingerprint,
  applyAcceptedAnnotations,
  baseSnapshot,
  evaluateAnnotation,
  fieldLabel,
  fieldOptions,
  loadRounds,
  parseAnnotations,
  revalidateCandidate,
  roundStats,
  saveRounds,
  viewTarget,
  type TargetView,
} from '../../review';

type PreviewSize = 'phone' | 'tablet';
type ActivePanel = 'editor' | 'checks' | 'review';
type AlertState = {
  title: string;
  message: string;
  confirmText: string;
  onConfirm: () => void;
};

@Component({
  tag: 'app-root',
  styleUrl: 'app-root.css',
  scoped: true,
})
export class AppRoot {
  @State() project: CourseProject = createDemoProject();
  @State() previewSize: PreviewSize = 'phone';
  @State() activePanel: ActivePanel = 'editor';
  @State() playing = false;
  @State() playProgress = 0;
  @State() offline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
  @State() toast?: { color: string; message: string };
  @State() rounds: ReviewRound[] = [];
  @State() importText = '';
  @State() newRoundVersionId = '';
  @State() alertState?: AlertState;
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
    this.rounds = loadRounds();
    const openRound = this.rounds.find((round) => round.status === 'open');
    this.newRoundVersionId = openRound?.baseVersionId ?? this.project.frozenVersions[0]?.id ?? '';
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

  private get openRound(): ReviewRound | undefined {
    return this.rounds.find((round) => round.status === 'open');
  }

  private persistRounds(): void {
    saveRounds(this.rounds);
    this.rounds = [...this.rounds];
  }

  private updateRound(roundId: string, update: (round: ReviewRound) => ReviewRound): void {
    this.rounds = this.rounds.map((round) => (round.id === roundId ? update(structuredClone(round)) : round));
    saveRounds(this.rounds);
  }

  private createRound(): void {
    if (this.openRound) {
      this.showToast('warning', '已有进行中的审阅回合，请先完成或放弃。');
      return;
    }
    const base = this.project.frozenVersions.find((version) => version.id === this.newRoundVersionId) ?? this.project.frozenVersions[0];
    if (!base) {
      this.showToast('danger', '还没有冻结版本，请先冻结一个版本再发起审阅。');
      return;
    }
    const round: ReviewRound = {
      id: `round-${Date.now().toString(36)}`,
      title: `审阅回合 · ${base.label}`,
      createdAt: new Date().toISOString(),
      baseVersionId: base.id,
      annotations: [],
      status: 'open',
    };
    this.rounds = [round, ...this.rounds];
    this.importText = '';
    this.persistRounds();
    this.showToast('success', `已基于“${base.label}”开启审阅回合，可粘贴离线批注。`);
  }

  private discardRound(roundId: string): void {
    const round = this.rounds.find((item) => item.id === roundId);
    if (!round) return;
    this.alertState = {
      title: '放弃审阅回合？',
      message: `“${round.title}”及其 ${round.annotations.length} 条批注处理记录将被删除，冻结版本不受影响。`,
      confirmText: '放弃回合',
      onConfirm: () => {
        this.rounds = this.rounds.filter((item) => item.id !== roundId);
        this.persistRounds();
        this.alertState = undefined;
        this.showToast('medium', '审阅回合已放弃。');
      },
    };
  }

  private importAnnotations(): void {
    const round = this.openRound;
    if (!round) return;
    const parsed = parseAnnotations(this.importText);
    if (!parsed.annotations.length) {
      this.showToast('danger', parsed.errors.length ? `未导入任何批注：${parsed.errors[0]}` : '没有识别到批注内容。');
      return;
    }

    const seen = new Set<string>();
    this.rounds.forEach((item) => item.annotations.forEach((annotation) => seen.add(annotation.fingerprint)));
    const nextOrdinal = round.annotations.length;
    const imported: ReviewAnnotation[] = [];
    let duplicates = 0;

    for (const item of parsed.annotations) {
      const fingerprint = annotationFingerprint(item);
      if (seen.has(fingerprint)) {
        duplicates += 1;
        continue;
      }
      seen.add(fingerprint);
      const evaluated = evaluateAnnotation(item, round, this.project.frozenVersions);
      imported.push({
        id: `note-${Date.now().toString(36)}-${imported.length}`,
        ordinal: nextOrdinal + imported.length + 1,
        targetType: item.targetType,
        targetId: evaluated.targetId,
        moduleId: evaluated.moduleId,
        stepOrdinal: item.stepOrdinal,
        targetHint: item.targetHint,
        basedOnLabel: item.basedOnLabel,
        field: item.field,
        suggestedValue: item.suggestedValue,
        originalValue: item.originalValue,
        comment: item.comment,
        candidateValue: evaluated.candidateValue,
        decision: 'pending',
        conflicts: evaluated.conflicts,
        fingerprint,
        importedAt: new Date().toISOString(),
      });
    }

    if (imported.length === 0) {
      this.showToast('warning', `识别到 ${parsed.annotations.length} 条，但全部为已导入过的重复意见，未重复处理。`);
      return;
    }

    this.updateRound(round.id, (draft) => ({ ...draft, annotations: [...draft.annotations, ...imported] }));
    this.importText = '';
    const conflictCount = imported.filter((item) => item.conflicts.length > 0).length;
    const details = [`新增 ${imported.length} 条批注`];
    if (duplicates) details.push(`跳过重复 ${duplicates} 条`);
    if (conflictCount) details.push(`${conflictCount} 条存在冲突待核实`);
    if (parsed.errors.length) details.push(`${parsed.errors.length} 行未识别`);
    this.showToast(conflictCount ? 'warning' : 'success', `${details.join('，')}。`);
  }

  private setDecision(roundId: string, annotationId: string, decision: ReviewDecision): void {
    this.updateRound(roundId, (round) => ({
      ...round,
      annotations: round.annotations.map((annotation) => {
        if (annotation.id !== annotationId) return annotation;
        const resetConflict = decision !== 'accepted' ? false : annotation.conflictAcknowledged;
        return { ...annotation, decision, decidedAt: new Date().toISOString(), conflictAcknowledged: resetConflict };
      }),
    }));
  }

  private acknowledgeConflict(roundId: string, annotationId: string): void {
    this.updateRound(roundId, (round) => ({
      ...round,
      annotations: round.annotations.map((annotation) => annotation.id === annotationId ? { ...annotation, conflictAcknowledged: true } : annotation),
    }));
  }

  private editCandidate(roundId: string, annotationId: string, value: string): void {
    this.updateRound(roundId, (round) => ({
      ...round,
      annotations: round.annotations.map((annotation) => {
        if (annotation.id !== annotationId) return annotation;
        const updated = { ...annotation, candidateValue: value, conflictAcknowledged: false };
        updated.conflicts = revalidateCandidate(updated, this.project.frozenVersions, round.baseVersionId);
        return updated;
      }),
    }));
  }

  private locateAnnotation(annotation: ReviewAnnotation): void {
    const round = this.rounds.find((item) => item.annotations.some((note) => note.id === annotation.id));
    const snapshot = round ? baseSnapshot(this.project.frozenVersions, round.baseVersionId) : undefined;
    if (!round || !snapshot) return;
    const view: TargetView = viewTarget({
      targetType: annotation.targetType,
      targetId: annotation.targetId,
      moduleId: annotation.moduleId,
      stepOrdinal: annotation.stepOrdinal,
      targetHint: annotation.targetHint,
    }, snapshot);
    if (!view.module) {
      this.showToast('warning', '基准冻结版本中找不到该对象，无法定位。');
      return;
    }
    // 在当前课程中按冻结快照的标题/id 定位；确认前当前内容可能与冻结版不同
    const sourceTitle = view.module.title;
    const currentModule = this.project.modules.find((item) => item.title === sourceTitle) ?? this.project.modules.find((item) => item.id === view.module!.id);
    if (!currentModule) {
      this.showToast('warning', `“${sourceTitle}”在当前课程中已找不到，可在审阅回合中查看冻结版本记录。`);
      return;
    }
    const step = view.step ? currentModule.steps.find((item) => item.title === view.step!.title) ?? currentModule.steps.find((item) => item.id === view.step!.id) : undefined;
    this.selectModule(currentModule.id);
    if (step) this.selectStep(step.id);
    this.activePanel = 'editor';
    this.showToast('medium', `批注来自冻结版本“${this.versionLabel(round.baseVersionId)}”，此处为当前课程内容。`);
  }

  private versionLabel(versionId: string): string {
    return this.project.frozenVersions.find((version) => version.id === versionId)?.label ?? '未知冻结版本';
  }

  private roundBlockingReason(round: ReviewRound): string | undefined {
    const stats = roundStats(round);
    if (stats.total === 0) return '还没有导入任何批注。';
    if (stats.pending > 0) return `还有 ${stats.pending} 条意见未选择采纳或保留。`;
    const unresolved = round.annotations.filter((item) => item.decision === 'accepted' && item.conflicts.length > 0 && !item.conflictAcknowledged);
    if (unresolved.length) return `${unresolved.length} 条采纳意见仍有未核实的冲突。`;
    const base = this.project.frozenVersions.find((version) => version.id === round.baseVersionId);
    if (!base) return '基准冻结版本已不存在，无法生成修订版。';
    return undefined;
  }

  private confirmRound(roundId: string): void {
    const round = this.rounds.find((item) => item.id === roundId);
    if (!round) return;
    const reason = this.roundBlockingReason(round);
    if (reason) {
      this.showToast('danger', reason);
      return;
    }
    const snapshot = baseSnapshot(this.project.frozenVersions, round.baseVersionId)!;
    const accepted = round.annotations.filter((item) => item.decision === 'accepted');
    const kept = round.annotations.filter((item) => item.decision === 'kept');
    this.alertState = {
      title: '确认生成新修订版？',
      message: `将从冻结版本“${this.versionLabel(round.baseVersionId)}”复制内容，套用 ${accepted.length} 条采纳修改，${kept.length} 条保留意见仅留档。旧冻结版本与本回合处理记录都会保留。`,
      confirmText: '生成修订版',
      onConfirm: () => this.executeRound(roundId, snapshot, accepted.map((item) => item.id)),
    };
  }

  private executeRound(roundId: string, snapshot: ProjectSnapshot, acceptedIds: string[]): void {
    const round = this.rounds.find((item) => item.id === roundId);
    this.alertState = undefined;
    if (!round) return;
    const acceptedSet = new Set(acceptedIds);
    const preparedAnnotations = round.annotations.map((annotation) => acceptedSet.has(annotation.id) ? { ...annotation, applied: false } : annotation);
    const result = applyAcceptedAnnotations(snapshot, preparedAnnotations);
    const appliedSet = new Set(result.appliedIds);
    const newRevision = Math.max(this.project.revision, ...this.project.frozenVersions.map((version) => version.snapshot.revision), snapshot.revision) + 1;
    const before = cloneProject(this.project);
    const next: CourseProject = {
      ...this.project,
      ...result.snapshot,
      frozenVersions: this.project.frozenVersions,
      status: 'changes',
      revision: newRevision,
      lastSavedAt: new Date().toISOString(),
    };
    this.past = [...this.past, before].slice(-80);
    this.future = [];
    this.project = next;
    this.persist();
    this.updateRound(roundId, (draft) => ({
      ...draft,
      status: 'completed',
      completedAt: new Date().toISOString(),
      resultLabel: `修订版 v${newRevision}`,
      resultRevision: newRevision,
      annotations: draft.annotations.map((annotation) => appliedSet.has(annotation.id) ? { ...annotation, applied: true } : annotation),
    }));
    this.activePanel = 'editor';
    const commentOnly = round.annotations.filter((note) => acceptedSet.has(note.id) && !note.field).length;
    const missing = acceptedIds.length - result.appliedIds.length - commentOnly;
    const notes: string[] = [];
    if (commentOnly) notes.push(`${commentOnly} 条纯意见仅留档`);
    if (missing > 0) notes.push(`${missing} 条因基准版本中对象缺失未写入`);
    const tail = notes.length ? `（${notes.join('，')}）` : '';
    this.showToast('success', `已从冻结版本生成修订版 v${newRevision}，字段类采纳意见全部写入，可继续编辑后重新提交。${tail}`);
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
      this.newRoundVersionId = version.id;
      return { ...draft, status: 'frozen', frozenVersions: [version, ...frozenVersions] };
    }, '当前课程版本已冻结。');
    this.playing = false;
  }

  private reviseFrozen(): void {
    this.commit((draft) => ({ ...draft, status: 'draft' }), '已创建修订版，可继续编辑。');
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

        {this.openRound && (
          <div class="review-callout">
            <div>
              <strong>审阅回合进行中 · {this.versionLabel(this.openRound.baseVersionId)}</strong>
              <span>批注处理在“审阅回合”页完成；此处直接修改不会记入该回合，确认回合时会以冻结版本为准生成修订版。</span>
            </div>
            <ion-button size="small" fill="outline" class="studio-button" onClick={() => { this.activePanel = 'review'; }}>回到审阅回合</ion-button>
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

  private annotationView(annotation: ReviewAnnotation): TargetView | undefined {
    const round = this.openRound ?? this.rounds.find((item) => item.annotations.some((note) => note.id === annotation.id));
    const snapshot = round ? baseSnapshot(this.project.frozenVersions, round.baseVersionId) : undefined;
    if (!snapshot) return undefined;
    return viewTarget({
      targetType: annotation.targetType,
      targetId: annotation.targetId,
      moduleId: annotation.moduleId,
      stepOrdinal: annotation.stepOrdinal,
      targetHint: annotation.targetHint,
    }, snapshot);
  }

  private renderConflictList(annotation: ReviewAnnotation) {
    if (!annotation.conflicts.length) return null;
    return (
      <div class="annotation-conflicts">
        {annotation.conflicts.map((conflict) => (
          <div class={`annotation-conflict ${conflict.type}`}>
            <strong>{this.conflictLabel(conflict.type)}</strong>
            <span>{conflict.message}</span>
          </div>
        ))}
      </div>
    );
  }

  private conflictLabel(type: ReviewAnnotation['conflicts'][number]['type']): string {
    switch (type) {
      case 'target-missing': return '原对象不存在';
      case 'step-moved': return '步骤已移动';
      case 'version-stale': return '基于旧版本';
      case 'value-drift': return '内容已变化';
      case 'invalid-value': return '建议值非法';
    }
  }

  private renderCandidateEditor(round: ReviewRound, annotation: ReviewAnnotation) {
    if (annotation.field && annotation.suggestedValue === undefined && !annotation.comment) return null;
    const options = fieldOptions(annotation.field);
    const disabled = round.status === 'completed';
    return (
      <div class="candidate-editor">
        <div class="candidate-head">
          <span class="eyebrow">候选修改 · {fieldLabel(annotation.field)}</span>
          {annotation.applied && <ion-badge color="success">已写入修订版</ion-badge>}
          {round.status === 'completed' && annotation.decision === 'accepted' && !annotation.applied && (
            <ion-badge color="warning">未写入（基准版本中对象缺失）</ion-badge>
          )}
        </div>
        {annotation.field ? (
          options ? (
            <ion-select
              disabled={disabled}
              class="studio-input"
              value={annotation.candidateValue ?? ''}
              onIonChange={(event) => this.editCandidate(round.id, annotation.id, String(event.detail.value ?? ''))}
            >
              {options.map((option) => <ion-select-option value={option}>{option}</ion-select-option>)}
            </ion-select>
          ) : (
            <ion-textarea
              disabled={disabled}
              autoGrow
              class="studio-input"
              value={annotation.candidateValue ?? ''}
              onIonInput={(event) => this.editCandidate(round.id, annotation.id, event.detail.value ?? '')}
            />
          )
        ) : (
          <p class="comment-only-note">纯意见批注，采纳后仅记录处理结论，不产生字段修改。</p>
        )}
      </div>
    );
  }

  private renderAnnotationCard(round: ReviewRound, annotation: ReviewAnnotation) {
    const view = this.annotationView(annotation);
    const location = annotation.targetType === 'module'
      ? (view?.module?.title ?? annotation.targetHint ?? annotation.targetId)
      : `${view?.module?.title ?? annotation.moduleId ?? '未定位模块'} · 第${view?.stepOrdinal ?? annotation.stepOrdinal ?? '?'}步 ${view?.step?.title ?? annotation.targetHint ?? annotation.targetId}`;
    const readOnly = round.status === 'completed';
    const blocking = annotation.decision === 'accepted' && annotation.conflicts.length > 0 && !annotation.conflictAcknowledged;
    return (
      <article class={`annotation-card decision-${annotation.decision} ${annotation.conflicts.length ? 'has-conflict' : ''}`} key={annotation.id}>
        <header class="annotation-head">
          <span class="annotation-ordinal">#{annotation.ordinal}</span>
          <button class="annotation-target" onClick={() => this.locateAnnotation(annotation)} title="在编辑器中定位来源">
            <span class="target-type">{annotation.targetType === 'module' ? '模块' : '步骤'}</span>
            <strong>{location}</strong>
            <span class="locate-mark">定位 →</span>
          </button>
          {annotation.field && <ion-badge class="field-badge">{fieldLabel(annotation.field)}</ion-badge>}
          {annotation.basedOnLabel && <ion-badge color="light" class="version-badge">基于 {annotation.basedOnLabel}</ion-badge>}
        </header>

        {annotation.originalValue !== undefined && (
          <div class="annotation-original"><span>批注原值</span><del>{annotation.originalValue}</del></div>
        )}
        {annotation.comment && <p class="annotation-comment">{annotation.comment}</p>}
        {this.renderConflictList(annotation)}
        {(annotation.decision === 'accepted' || (readOnly && annotation.applied)) && this.renderCandidateEditor(round, annotation)}

        {!readOnly && (
          <footer class="annotation-actions">
            <button
              class={`decision-button accept ${annotation.decision === 'accepted' ? 'on' : ''}`}
              onClick={() => this.setDecision(round.id, annotation.id, annotation.decision === 'accepted' ? 'pending' : 'accepted')}
            >
              {annotation.decision === 'accepted' ? '✓ 已采纳' : '采纳（形成候选）'}
            </button>
            <button
              class={`decision-button keep ${annotation.decision === 'kept' ? 'on' : ''}`}
              onClick={() => this.setDecision(round.id, annotation.id, annotation.decision === 'kept' ? 'pending' : 'kept')}
            >
              {annotation.decision === 'kept' ? '— 已保留' : '保留意见'}
            </button>
            {blocking && (
              <button class="conflict-ack" onClick={() => this.acknowledgeConflict(round.id, annotation.id)}>
                已核实冲突，仍要采纳
              </button>
            )}
          </footer>
        )}
        {readOnly && (
          <footer class="annotation-actions read-only">
            <span class={`decision-readout ${annotation.decision}`}>
              {annotation.decision === 'accepted' ? `✓ 已采纳${annotation.applied && annotation.field ? '并写入' : ''}` : '— 保留意见'}
            </span>
            <span class="decided-time">{annotation.decidedAt ? `处理于 ${this.formatDate(annotation.decidedAt)}` : ''}</span>
          </footer>
        )}
      </article>
    );
  }

  private renderOpenRound(round: ReviewRound) {
    const stats = roundStats(round);
    const baseMissing = !this.project.frozenVersions.some((version) => version.id === round.baseVersionId);
    const blockingReason = this.roundBlockingReason(round);
    return (
      <section class="round-open">
        <div class="round-head">
          <div>
            <span class="eyebrow">进行中的审阅回合</span>
            <h2>{round.title}</h2>
            <p>
              创建于 {this.formatDate(round.createdAt)} · 基准：{this.versionLabel(round.baseVersionId)}
              {baseMissing && <span class="base-missing">（基准冻结版本已缺失）</span>}
            </p>
          </div>
          <div class="round-stats">
            <div><strong>{stats.total}</strong><span>意见</span></div>
            <div class="stat-accepted"><strong>{stats.accepted}</strong><span>采纳</span></div>
            <div class="stat-kept"><strong>{stats.kept}</strong><span>保留</span></div>
            <div class={stats.pending ? 'stat-pending' : ''}><strong>{stats.pending}</strong><span>待处理</span></div>
            <div class={stats.blockingConflicts ? 'stat-conflict' : ''}><strong>{stats.blockingConflicts}</strong><span>冲突未核实</span></div>
          </div>
        </div>

        <div class="import-card">
          <div class="import-head">
            <h3>粘贴离线批注</h3>
            <div class="import-tools">
              <button class="text-button" onClick={() => { this.importText = SAMPLE_ANNOTATIONS; }}>填入示例批注</button>
              <button class="text-button" onClick={() => { this.importText = ''; }}>清空</button>
            </div>
          </div>
          <p class="import-hint">
            格式：用“模块 模块名”“步骤 序号 步骤标题 @所属模块”标明对象；每行一条“字段：建议值 ｜ 意见 ｜ 批注原值”；
            首行可用“@版本：冻结版本 v1”标明批注依据；没有字段的行视为纯意见。同一意见重复导入会自动跳过。
          </p>
          <ion-textarea
            autoGrow
            class="studio-input import-textarea"
            placeholder={'模块 模块一 · 日常问候\n模块标题：日常问候与礼仪 ｜ 教研组建议覆盖道别内容\n步骤 2 拆解“你好”的手形 @模块一 · 日常问候\n字幕位置：下方安全区 ｜ 中央字幕挡住手部拆解 ｜ 画面中央'}
            value={this.importText}
            onIonInput={(event) => { this.importText = event.detail.value ?? ''; }}
          />
          <div class="import-actions">
            <ion-button class="studio-button" onClick={() => this.importAnnotations()}>导入并核对冲突</ion-button>
            <button class="text-button danger" onClick={() => this.discardRound(round.id)}>放弃本回合</button>
          </div>
        </div>

        <div class="annotation-list">
          {round.annotations.length === 0 && (
            <div class="round-empty">还没有批注。把教研组离线批注贴到上方输入框，导入后逐条采纳或保留。</div>
          )}
          {round.annotations.map((annotation) => this.renderAnnotationCard(round, annotation))}
        </div>

        <div class="round-footer">
          <p>{blockingReason ?? `冲突已全部核实，可以基于“${this.versionLabel(round.baseVersionId)}”生成新修订版。`}</p>
          <ion-button class="studio-button" color="primary" disabled={Boolean(blockingReason)} onClick={() => this.confirmRound(round.id)}>
            确认并生成修订版
          </ion-button>
        </div>
      </section>
    );
  }

  private renderCompletedRounds() {
    const completed = this.rounds.filter((round) => round.status === 'completed');
    if (!completed.length) return null;
    return (
      <section class="round-history">
        <h3>已完成回合（旧版与处理记录保留）</h3>
        {completed.map((round) => {
          const stats = roundStats(round);
          return (
            <details class="completed-round" key={round.id}>
              <summary>
                <strong>{round.title}</strong>
                <span>{round.resultLabel} · 采纳 {stats.accepted} / 保留 {stats.kept}</span>
                <small>{round.completedAt ? this.formatDate(round.completedAt) : ''} 完成</small>
              </summary>
              <div class="annotation-list compact">
                {round.annotations.map((annotation) => this.renderAnnotationCard(round, annotation))}
              </div>
            </details>
          );
        })}
      </section>
    );
  }

  private renderReviewPanel() {
    const open = this.openRound;
    return (
      <section class="review-panel">
        {!open && (
          <div class="round-setup card-block">
            <span class="eyebrow">审阅回合</span>
            <h2>基于冻结版本处理教研组批注</h2>
            <p>冻结内容保持只读；采纳的意见先生成候选修改，确认后才会从所选冻结版本复制出新修订版。</p>
            {this.project.frozenVersions.length === 0 ? (
              <div class="round-empty">当前还没有冻结版本。请先提交复核并冻结一个版本，教研组的离线批注再以该版本为基准。</div>
            ) : (
              <div class="round-setup-row">
                <ion-select
                  label="基准冻结版本"
                  labelPlacement="stacked"
                  class="studio-input"
                  value={this.newRoundVersionId}
                  onIonChange={(event) => { this.newRoundVersionId = String(event.detail.value ?? ''); }}
                >
                  {this.project.frozenVersions.map((version) => (
                    <ion-select-option value={version.id}>{version.label} · {this.formatDate(version.createdAt)}</ion-select-option>
                  ))}
                </ion-select>
                <ion-button class="studio-button" onClick={() => this.createRound()}>开启审阅回合</ion-button>
              </div>
            )}
          </div>
        )}
        {open && this.renderOpenRound(open)}
        {this.renderCompletedRounds()}
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
                  <button class={this.activePanel === 'review' ? 'active' : ''} onClick={() => { this.activePanel = 'review'; }}>
                    审阅回合
                    {this.openRound && <span class="review-badge">{roundStats(this.openRound).pending || roundStats(this.openRound).total}</span>}
                  </button>
                </div>
                <div class="editor-scroll">
                  {this.activePanel === 'editor'
                    ? this.renderStepEditor()
                    : this.activePanel === 'checks'
                      ? this.renderChecks()
                      : this.renderReviewPanel()}
                </div>
              </section>

              {this.renderPreview()}
            </main>
          </ion-content>
          <ion-toast isOpen={Boolean(this.toast)} message={this.toast?.message} color={this.toast?.color} duration={3200} onDidDismiss={() => { this.toast = undefined; }} />
          <ion-alert
            isOpen={Boolean(this.alertState)}
            header={this.alertState?.title}
            message={this.alertState?.message}
            buttons={[
              { text: '取消', role: 'cancel', handler: () => { this.alertState = undefined; } },
              { text: this.alertState?.confirmText ?? '确认', handler: () => this.alertState?.onConfirm() },
            ]}
          />
        </ion-app>
      </Host>
    );
  }
}
