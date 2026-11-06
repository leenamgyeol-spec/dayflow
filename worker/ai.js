/* DAYFLOW AI — Claude가 비서 대화와 아침 브리핑을 맡는다.
 * 일정 데이터는 기기에 있으므로, 앱이 요청마다 필요한 일정 목록을 함께 보낸다.
 * Claude는 답변 문장과 함께 "추가/변경/삭제/완료" 도구 호출을 돌려주고, 실제 반영은 앱이 한다
 * (추가는 바로, 변경·삭제·완료는 사용자 확인 뒤). */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-5-5'; // 비용을 낮추려고 Haiku 사용 (사용자 선택)
const CATEGORIES = ['학교', '공부', '운동', '개인 약속', '가족', '취미', '기타'];

const SYSTEM = `너는 DAYFLOW라는 개인 일정 앱의 비서다. 사용자는 한국에 사는 학생이고, 시간대는 항상 한국 시간(Asia/Seoul)이다.
매 요청의 사용자 메시지 앞부분에 [지금]과 [일정] 데이터가 붙어 온다. 일정에 관한 답은 반드시 이 데이터만 근거로 한다. 없는 일정을 지어내지 않는다.

말투: 친근한 존댓말, 짧고 자연스럽게. 과장된 칭찬이나 오글거리는 표현은 쓰지 않는다. 마크다운 제목·표는 쓰지 말고, 목록이 필요하면 줄바꿈과 "· "만 쓴다.

일정을 바꾸는 요청이면 도구를 쓴다.
- add_event: 새 일정이나 "~라고 알려줘", "깨워줘" 같은 알림 요청. 알림 요청은 reminder_minutes에 [0]을 넣는다. "N분 뒤/후"는 [지금] 시각에 더해 계산한다. 정보가 조금 부족해도 합리적으로 채우고, 날짜를 정말 알 수 없을 때만 되묻는다. 추가는 앱이 바로 반영하므로 답변에서는 "추가했어요"처럼 말한다.
- change_event, delete_event, set_done: 기존 일정은 [일정]의 id를 그대로 쓴다. 이 셋은 사용자가 확인 버튼을 눌러야 반영되므로, 답변에서는 "이렇게 바꿀까요?"처럼 확인을 구하는 말투로 쓴다. 반복·여러 날 일정의 하루만 바꾸려면 occurrence_date에 그 날짜를, 전체면 null을 넣는다.
- 어느 일정인지 애매하면 도구를 쓰지 말고 되묻는다.
질문(언제 바쁜지, 몇 번 했는지, 무엇부터 준비할지 등)에는 데이터를 계산해서 바로 답한다. 시간은 "오후 4시", "16:00"처럼 쓴다.`;

const nul = t => ({ type: [t, 'null'] });
const TOOLS = [
  {
    name: 'add_event',
    description: '새 일정을 추가한다. 시간 미정이면 start=null. 여러 날 일정은 end_date, 반복은 repeat_freq로.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'date', 'end_date', 'start', 'end', 'location', 'category', 'priority', 'repeat_freq', 'repeat_days', 'repeat_until', 'reminder_minutes'],
      properties: {
        title: { type: 'string', description: '짧은 일정 제목. 예: "수학 학원", "씻기"' },
        date: { type: 'string', description: 'YYYY-MM-DD (반복이면 첫 날)' },
        end_date: nul('string'),
        start: { type: ['string', 'null'], description: 'HH:MM 24시간' },
        end: { type: ['string', 'null'], description: 'HH:MM 24시간' },
        location: nul('string'),
        category: { type: 'string', enum: CATEGORIES },
        priority: { type: 'string', enum: ['high', 'normal', 'low'] },
        repeat_freq: { type: 'string', enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly'] },
        repeat_days: { type: ['array', 'null'], items: { type: 'integer' }, description: '매주 반복 요일 (0=일 … 6=토)' },
        repeat_until: nul('string'),
        reminder_minutes: { type: 'array', items: { type: 'integer' }, description: '시작 몇 분 전에 알릴지. 0=정시' }
      }
    }
  },
  {
    name: 'change_event',
    description: '기존 일정을 바꾼다. 바꾸지 않을 항목은 null.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['event_id', 'occurrence_date', 'title', 'date', 'start', 'end', 'location', 'priority'],
      properties: {
        event_id: { type: 'string' },
        occurrence_date: { type: ['string', 'null'], description: '반복·여러 날 일정의 그 하루만 바꿀 때 그 날짜' },
        title: nul('string'),
        date: { type: ['string', 'null'], description: '옮길 날짜 YYYY-MM-DD' },
        start: nul('string'),
        end: nul('string'),
        location: nul('string'),
        priority: { type: ['string', 'null'], enum: ['high', 'normal', 'low', null] }
      }
    }
  },
  {
    name: 'delete_event',
    description: '일정을 지운다. occurrence_date가 있으면 반복·여러 날 일정의 그 하루만.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['event_id', 'occurrence_date'],
      properties: { event_id: { type: 'string' }, occurrence_date: nul('string') }
    }
  },
  {
    name: 'set_done',
    description: '그날 일정을 완료(또는 완료 취소)로 표시한다.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['event_id', 'occurrence_date', 'done'],
      properties: { event_id: { type: 'string' }, occurrence_date: { type: 'string' }, done: { type: 'boolean' } }
    }
  }
];

function client(env) { return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }); }

/** 비서 대화 한 번. history: [{role, text}] (최근 몇 턴), context: 앱이 만든 [지금]/[일정] 텍스트 */
export async function chat(env, { history, context, message }) {
  const messages = [];
  (Array.isArray(history) ? history.slice(-10) : []).forEach(h => {
    if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string' && h.text.trim()) {
      messages.push({ role: h.role, content: h.text.slice(0, 2000) });
    }
  });
  while (messages.length && messages[0].role !== 'user') messages.shift();
  messages.push({ role: 'user', content: `${String(context).slice(0, 60000)}\n\n[사용자]\n${String(message).slice(0, 2000)}` });

  const res = await client(env).messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low' },
    cache_control: { type: 'ephemeral' },
    system: SYSTEM,
    tools: TOOLS,
    tool_choice: { type: 'auto' },
    messages
  });
  if (res.stop_reason === 'refusal') return { text: '그 요청은 도와드리기 어려워요. 다르게 말씀해 주시겠어요?', actions: [] };
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  const actions = res.content.filter(b => b.type === 'tool_use').map(b => ({ name: b.name, input: b.input }));
  return { text, actions, usage: res.usage };
}

/** 아침 브리핑 글 — 앱이 올려 둔 그날 일정과 날씨를 바탕으로 */
export async function morningBrief(env, { date, dow, events, weather, name }) {
  const lines = events.length
    ? events.map(e => `· ${e.start || '시간 미정'}${e.end ? '~' + e.end : ''} ${e.title}${e.location ? ` (${e.location})` : ''}${e.priority === 'high' ? ' [중요]' : ''}`).join('\n')
    : '(일정 없음)';
  const prompt = `[날짜] ${date} ${dow}요일\n[사용자 이름] ${name || '(모름)'}\n[날씨] ${weather || '(정보 없음)'}\n[오늘 일정]\n${lines}\n\n` +
    `위 데이터만으로 아침 브리핑을 써 줘. 형식:\n첫 줄: 알림에 그대로 뜰 한 문장 요약 (40자 안팎)\n빈 줄\n` +
    `그다음 5~9줄: 오늘 일정 흐름, 가장 신경 쓸 일정, 일정 사이 빈 시간과 쉬기 좋은 때, 미리 챙길 것(날씨 포함), 마지막에 자연스러운 한마디. ` +
    `일정이 없으면 여유로운 날이라고만 하고 일정을 지어내지 마. 줄마다 "· "로 시작하고, 마크다운은 쓰지 마.`;
  const res = await client(env).messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }]
  });
  if (res.stop_reason === 'refusal') return null;
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) return null;
  const [summary, ...rest] = text.split('\n');
  return { summary: summary.trim(), body: rest.join('\n').trim() };
}
