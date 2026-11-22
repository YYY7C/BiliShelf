import type { AiTaxonomy } from './types';

export const DEFAULT_MAX_TAGS = 12;
export const DEFAULT_MIN_CONFIDENCE = 0.5;

/** 一次库级分析最多抽多少条视频（main / ipc / renderer 共用，避免各写一份） */
export const MAX_ANALYSIS_SAMPLES = 1000;
/** 分层采样时每个来源 / UP 主至少抽几条 */
export const MIN_SAMPLES_PER_GROUP = 3;
/** 视觉校验最多看多少条代表视频（含随机补充） */
export const MAX_VISION_TARGETS = 16;
/** 其中随机补充几条 */
export const VISION_RANDOM_EXTRA = 2;
/** 库级分析合并后的分类上限（估算请求数与最终裁剪共用） */
export const MAX_ANALYSIS_CATEGORIES = 12;
/** 合并后保留的关注点上限 */
export const MAX_ANALYSIS_FOCUS = 10;

export const DEFAULT_FOCUS = ['人物形象', '服饰', '动作', '场景', '风格', 'BGM', '情绪'];

export const DEFAULT_TAXONOMY: AiTaxonomy = {
  categories: [
    {
      name: '人物',
      description: '人物形象、发型、气质、人数、性别表达',
      examples: ['长发', '短发', '戴眼镜', '单人', '多人']
    },
    {
      name: '服饰',
      description: '服装类型、制服、配饰、颜色、风格',
      examples: ['上衣', '长裙', '外套', '帽子', '眼镜']
    },
    {
      name: '动作',
      description: '舞蹈动作、手势、走位、运动、镜头互动',
      examples: ['舞蹈', '旋转', '跳跃', '挥手']
    },
    {
      name: '场景',
      description: '室内/室外、舞台、街景、教室、自然、摄影棚',
      examples: ['舞台', '教室', '街道', '夜景']
    },
    {
      name: '风格',
      description: '二次元、国风、赛博朋克、复古、极简、电影感、手绘',
      examples: ['国风', '赛博朋克', '电影感', '复古']
    },
    {
      name: 'BGM',
      description: '曲名、艺术家、流派、节奏、乐器',
      examples: ['电子流行', '钢琴', '民谣']
    },
    {
      name: '情绪',
      description: '欢快、治愈、热血、忧郁、紧张、浪漫',
      examples: ['欢快', '治愈', '热血']
    },
    {
      name: '其他',
      description: '无法归类的具体特征',
      examples: []
    }
  ],
  stopwords: ['视频', 'B站', 'bilibili', '二次元', '好看', '搬运', '合集'],
  aliases: {}
};

export const DEFAULT_SYSTEM_PROMPT = `你是 BiliShelf 的视频素材标注助手。你会收到一个视频的封面、若干视频帧、标题、UP 主、简介和原始标签。
规则：
1. 只根据画面和给定信息打标，不要臆测画面中不存在的内容。
2. 标签使用简体中文，尽量是 2–8 个字的短名词短语；不要输出“视频”“B站”“二次元”“好看”等泛词。
3. 按给定的分类输出；每个标签给出 0–1 的置信度；不确定就不要输出。
4. 人物、服饰、动作、场景、风格、情绪要分开归类；同一概念不要重复输出。
5. BGM：只有当画面或原始标签明显表明这是音乐、舞蹈、演奏、翻唱、MV 等内容时，才调用 identify_music 工具；工具无结果时不要编造曲名，可标注推断的音乐风格。
6. 只输出 JSON，不要 Markdown 代码块，不要解释。`;

export const DEFAULT_PROMPT_TEMPLATE = `视频信息：
标题：{{title}}
UP 主：{{upName}}
时长：{{duration}}
来源：{{sourceName}}
简介：{{description}}
原始标签：{{originalTags}}
BGM 线索：{{bgmHint}}

本次关注点：{{focus}}
分类体系：
{{taxonomy}}

输出要求：
- 最多 {{maxTags}} 个标签，置信度低于 {{minConfidence}} 的不要输出。
- 标签分类必须来自上面的分类体系；无法归类时用「其他」。
- 输出 JSON 结构：
{{schema}}`;

export const OUTPUT_SCHEMA_JSON = JSON.stringify(
  {
    summary: '一句话概括视频内容，60 字以内',
    tags: [{ name: '标签名', category: '分类名', confidence: 0.94, evidence: '第 2 帧人物穿着' }],
    bgm: {
      title: '曲名或 null',
      artists: ['艺术家'],
      genres: ['电子流行'],
      source: 'acrcloud | bilibili_tag | inferred',
      confidence: 0.9
    }
  },
  null,
  2
);

