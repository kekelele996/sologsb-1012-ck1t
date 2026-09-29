import {
  cloneProject,
  confirmReviewRound,
  createDemoProject,
  createReviewRound,
  importReviewComments,
  parseReviewText,
  type CourseProject,
  type ReviewRound,
} from './models';

function freezeProject(project: CourseProject): CourseProject {
  const { frozenVersions, ...snapshot } = cloneProject(project);
  return {
    ...project,
    status: 'frozen',
    frozenVersions: [
      { id: 'frozen-1', label: '冻结版本 v1', createdAt: new Date().toISOString(), snapshot },
    ],
  };
}

function baseOf(project: CourseProject): CourseProject {
  return structuredClone(project.frozenVersions[0].snapshot) as CourseProject;
}

const SAMPLE = `版本：v1
[模块] 模块一 · 日常问候
- 建议在模块目标中补充与日常生活场景的联系
- 模块主题色可以更柔和

[步骤] 观察“你好”的完整动作
- 字幕与动作区域重叠，建议下移到安全区
- 手形说明可补充掌心方向

[步骤] 不存在的步骤标题
- 这条应该匹配不到
`;

describe('parseReviewText', () => {
  it('按模块/步骤分组并提取版本号与意见', () => {
    const parsed = parseReviewText(SAMPLE);
    expect(parsed.versionLabel).toContain('v1');
    expect(parsed.targets.length).toBe(3);
    expect(parsed.targets[0].target.type).toBe('module');
    expect(parsed.targets[0].comments.length).toBe(2);
    expect(parsed.targets[1].target.type).toBe('step');
    expect(parsed.targets[1].target.moduleHint).toContain('模块一');
    expect(parsed.targets[1].comments.length).toBe(2);
    expect(parsed.targets[2].comments.length).toBe(1);
  });
});

describe('importReviewComments', () => {
  it('把意见匹配到冻结版本中的模块与步骤', () => {
    const project = freezeProject(createDemoProject());
    const result = importReviewComments(SAMPLE, baseOf(project), project, [], 1);
    // 2 条模块意见 + 2 条步骤意见 + 1 条匹配不到的步骤意见
    expect(result.comments.length).toBe(5);
    const moduleComments = result.comments.filter((c) => c.targetType === 'module');
    const stepComments = result.comments.filter((c) => c.targetType === 'step');
    expect(moduleComments.length).toBe(2);
    expect(moduleComments[0].moduleId).toBe('module-1');
    expect(stepComments[0].stepId).toBe('step-1-1');
    expect(result.duplicateCount).toBe(0);
  });

  it('同一意见重复导入只处理一次', () => {
    const project = freezeProject(createDemoProject());
    const first = importReviewComments(SAMPLE, baseOf(project), project, [], 1);
    const existing: ReviewRound[] = [{
      ...createReviewRound(project, 'frozen-1'),
      comments: first.comments,
    }];
    const second = importReviewComments(SAMPLE, baseOf(project), project, existing, 1);
    expect(second.comments.length).toBe(0);
    expect(second.duplicateCount).toBe(5);
  });

  it('原步骤不存在时标记 missing 冲突', () => {
    const project = freezeProject(createDemoProject());
    const result = importReviewComments(SAMPLE, baseOf(project), project, [], 1);
    const missing = result.comments.find((c) => c.content.includes('匹配不到'));
    expect(missing?.conflictKind).toBe('missing');
    // 正常匹配的意见没有冲突
    expect(result.comments[0].conflictKind).toBeUndefined();
  });

  it('步骤在当前版本被移到其它模块时标记 moved 冲突', () => {
    const project = freezeProject(createDemoProject());
    const moved = cloneProject(project);
    const step = moved.modules[0].steps[0];
    moved.modules[0].steps = moved.modules[0].steps.filter((item) => item.id !== step.id);
    moved.modules[1].steps.push(step);
    const result = importReviewComments(SAMPLE, baseOf(project), moved, [], 1);
    const movedComment = result.comments.find((c) => c.stepId === 'step-1-1');
    expect(movedComment?.conflictKind).toBe('moved');
  });

  it('批注基于旧版本时标记 versionOld', () => {
    const project = freezeProject(createDemoProject());
    const result = importReviewComments(SAMPLE, baseOf(project), project, [], 2);
    expect(result.versionOld).toBe(true);
  });
});

describe('confirmReviewRound', () => {
  it('从所选冻结版本生成新修订版，应用采纳的候选修改并保留旧版本与记录', () => {
    let project = freezeProject(createDemoProject());
    const round = createReviewRound(project, 'frozen-1');
    const result = importReviewComments(SAMPLE, baseOf(project), project, [round], 1);
    round.comments = result.comments;

    const stepComment = round.comments.find((c) => c.stepId === 'step-1-1' && c.content.includes('字幕'));
    expect(stepComment).toBeDefined();
    stepComment!.decision = 'adopt';
    stepComment!.candidate = { field: 'caption', value: '新的字幕内容：动作示意后停留一拍。' };

    project = { ...project, reviewRounds: [round] };
    const next = confirmReviewRound(project, round.id);

    expect(next.status).toBe('draft');
    expect(next.revision).toBe(project.revision + 1);
    // 旧冻结版本保留
    expect(next.frozenVersions.length).toBe(1);
    expect(next.frozenVersions[0].id).toBe('frozen-1');
    // 处理记录保留
    expect(next.reviewRounds[0].status).toBe('confirmed');
    expect(next.reviewRounds[0].resultRevision).toBe(next.revision);
    // 候选修改写入新修订版
    const applied = next.modules[0].steps.find((item) => item.id === 'step-1-1');
    expect(applied?.caption).toBe('新的字幕内容：动作示意后停留一拍。');
  });
});
