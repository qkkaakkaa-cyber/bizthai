// DeepSeek 工具调用循环(OpenAI 兼容 /chat/completions,流式)。
// 每轮:流式请求 → 边收边把正文 token 推给前端(onDelta);若模型要调工具则累积 tool_calls,
// 执行(并行)→ 回灌结果 → 进入下一轮;直到模型不再调工具(给出最终答案)。
import { config } from './config.js'
import { TOOLS, execTool } from './tools.js'

const DS = config.deepseek

function parseDsmlValue(raw, isString) {
  const text = raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
  if (isString) return text
  try { return JSON.parse(text) } catch { /* fall through */ }
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null') return null
  return text
}

function normalizeDsml(raw) {
  return String(raw || '')
    .replace(/[｜︱∣❘❙❚]/g, '|')
    .replace(/<\s*\|\s*\|\s*DSML\s*\|\s*\|\s*([^>]+?)>/gi, (_m, tag) => `<|DSML|${tag.trim()}>`)
    .replace(/<\s*\/\s*\|\s*\|\s*DSML\s*\|\s*\|\s*([^>]+?)>/gi, (_m, tag) => `</|DSML|${tag.trim()}>`)
}

function extractDsmlToolCalls(raw) {
  const toolCalls = []
  const normalized = normalizeDsml(raw)
  const cleanContent = normalized.replace(/<\|DSML\|tool_calls>([\s\S]*?)<\/\|DSML\|tool_calls>/g, (_block, body) => {
    const invokeRe = /<\|DSML\|invoke\s+name="([^"]+)">([\s\S]*?)<\/\|DSML\|invoke>/g
    let invoke
    while ((invoke = invokeRe.exec(body))) {
      const args = {}
      const paramRe = /<\|DSML\|parameter\s+name="([^"]+)"\s+string="(true|false)">([\s\S]*?)<\/\|DSML\|parameter>/g
      let param
      while ((param = paramRe.exec(invoke[2]))) {
        args[param[1]] = parseDsmlValue(param[3], param[2] === 'true')
      }
      toolCalls.push({
        id: `dsml_${toolCalls.length}_${Date.now()}`,
        name: invoke[1],
        args: JSON.stringify(args),
      })
    }
    return ''
  }).replace(/<\|DSML\|invoke\b[\s\S]*?<\/\|DSML\|invoke>/g, '')
    .replace(/<\|DSML\|parameter\b[\s\S]*?<\/\|DSML\|parameter>/g, '')
    .replace(/^\s*<\|DSML\|.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { cleanContent, toolCalls }
}

// 开一轮流式请求。带 AbortController:① fetch+整轮 90s 硬上限;② 见 readRound 的空闲看门狗。
async function openStream(messages, useTools) {
  const body = {
    model: DS.model,
    messages,
    stream: true,
    temperature: DS.temperature,
  }
  if (useTools) { body.tools = TOOLS; body.tool_choice = 'auto' }
  const ac = new AbortController()
  const hard = setTimeout(() => ac.abort(new Error('round timeout')), DS.roundTimeoutMs)
  let r
  try {
    r = await fetch(DS.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DS.apiKey}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
  } catch (e) {
    clearTimeout(hard)
    throw new Error(`deepseek fetch failed: ${(e && e.message) || e}`)
  }
  if (!r.ok || !r.body) {
    clearTimeout(hard)
    const txt = await r.text().catch(() => '')
    throw new Error(`deepseek ${r.status}: ${txt.slice(0, 300)}`)
  }
  return { body: r.body, ac, hard }
}

// 读一轮完整响应。带空闲看门狗:超过 idleMs 没有新数据 → 中止当轮(防 DeepSeek 流挂死)。
// 中止/网络错误时不抛出,而是返回已收到的部分(正文已通过 onDelta 流给前端),让上层正常收尾。
async function readRound(stream, ac, onDelta) {
  let content = ''
  let reasoningContent = ''
  const byIndex = new Map()
  const finish = () => {
    const parsed = extractDsmlToolCalls(content)
    const structured = [...byIndex.values()].filter(c => c.name)
    const toolCalls = structured.concat(parsed.toolCalls)
    content = parsed.cleanContent
    if (!toolCalls.length && content && onDelta) onDelta(content)
    return { content, toolCalls, reasoningContent }
  }
  const dec = new TextDecoder()
  let buf = ''
  let idle
  const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => ac.abort(new Error('stream idle')), DS.idleMs) }
  resetIdle()
  try {
    for await (const chunk of stream) {
      resetIdle()
      buf += dec.decode(chunk, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') { clearTimeout(idle); return finish() }
        let j
        try { j = JSON.parse(data) } catch { continue }
        const choice = j.choices && j.choices[0]
        if (!choice) continue
        const delta = choice.delta || {}
        if (delta.reasoning_content) reasoningContent += delta.reasoning_content
        if (delta.content) content += delta.content
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const i = tc.index == null ? 0 : tc.index
            const cur = byIndex.get(i) || { id: '', name: '', args: '' }
            if (tc.id) cur.id = tc.id
            if (tc.function && tc.function.name) cur.name = tc.function.name
            if (tc.function && tc.function.arguments) cur.args += tc.function.arguments
            byIndex.set(i, cur)
          }
        }
      }
    }
  } catch (e) {
    // 流被中止(超时/空闲)或断开:已流式的部分前端已收到,按已有内容收尾
    console.error('[ai] readRound 中止:', (e && e.message) || e)
  } finally {
    clearTimeout(idle)
  }
  return finish()
}

// 运行整个 agent。callbacks:
//   onStatus({tool,args})   工具开始执行(给前端「正在检索…」)
//   onDelta(text)           最终答案的流式 token
//   onCards(cards)          某轮工具产出的公司卡(去重后增量推送)
export async function runAgent({ messages, onStatus, onDelta, onCards, onTool, maxRounds }) {
  const rounds_ = maxRounds || DS.maxRounds
  const hardRounds = rounds_ + 2
  const seen = new Set()
  const pushCards = (cards, tool) => {
    if (!onCards || !cards || !cards.length) return
    const fresh = cards.filter(c => c.jpno && !seen.has(c.jpno))
    fresh.forEach(c => seen.add(c.jpno))
    if (fresh.length) onCards(fresh, tool)
  }

  for (let round = 0; round < hardRounds; round++) {
    const lastRound = round >= rounds_ - 1
    // 最后一轮禁用工具,强制收尾给出答案
    const _t0 = Date.now()
    const { body: stream, ac, hard } = await openStream(messages, !lastRound)
    const _t1 = Date.now()
    let content, toolCalls, reasoningContent
    try {
      ({ content, toolCalls, reasoningContent } = await readRound(stream, ac, onDelta))
    } finally {
      clearTimeout(hard)
    }
    const _t2 = Date.now()
    console.log(`[ai] round ${round}: openStream=${_t1 - _t0}ms readRound=${_t2 - _t1}ms tools=${toolCalls.length} msgs=${messages.length}`)

    if (!toolCalls.length) return { content }
    if (round === hardRounds - 1) return { content: '', truncated: true }

    // 模型要调工具:登记 assistant(tool_calls)消息
    const assistantMessage = {
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })),
    }
    if (reasoningContent) assistantMessage.reasoning_content = reasoningContent
    messages.push(assistantMessage)

    // 并行执行,回灌 tool 结果 + 增量推卡
    const results = await Promise.all(toolCalls.map(async c => {
      let args = {}
      try { args = JSON.parse(c.args || '{}') } catch { /* 容错:坏 JSON 当空参 */ }
      onStatus && onStatus({ tool: c.name, args })
      try {
        const out = await execTool(c.name, args)
        if (out.cards) pushCards(out.cards, c.name)
        if (onTool) onTool(c.name, args, out)
        return { id: c.id, content: JSON.stringify(out.llm).slice(0, 12000) }
      } catch (e) {
        return { id: c.id, content: JSON.stringify({ error: String((e && e.message) || e) }) }
      }
    }))
    for (const res of results) {
      messages.push({ role: 'tool', tool_call_id: res.id, content: res.content })
    }
    console.log(`[ai] round ${round}: toolExec=${Date.now() - _t2}ms (${toolCalls.map(c => c.name).join(',')})`)
  }
  return { content: '', truncated: true }
}
