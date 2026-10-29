// 极简 markdown → HTML,规则与前端 page-18.html 的 renderMd() 保持一致(同一套报告排版)。
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function inline(s) {
  s = esc(s)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return s
}

export function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n')
  let html = ''
  let i = 0
  const isRow = l => /^\s*\|.*\|\s*$/.test(l)
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    const h = line.match(/^(#{2,4})\s+(.*)$/)
    if (h) { const lv = h[1].length; html += `<h${lv}>${inline(h[2])}</h${lv}>`; i++; continue }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { html += '<hr>'; i++; continue }
    if (isRow(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = line.split('|').slice(1, -1).map(c => `<th>${inline(c.trim())}</th>`).join('')
      i += 2
      let body = ''
      while (i < lines.length && isRow(lines[i])) {
        body += '<tr>' + lines[i].split('|').slice(1, -1).map(c => `<td>${inline(c.trim())}</td>`).join('') + '</tr>'
        i++
      }
      html += `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      let ol = ''
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { ol += `<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`; i++ }
      html += `<ol>${ol}</ol>`
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      let ul = ''
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { ul += `<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`; i++ }
      html += `<ul>${ul}</ul>`
      continue
    }
    const para = []
    const startI = i
    while (i < lines.length && lines[i].trim() &&
      !/^(#{2,4}\s|\s*\||\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])) { para.push(inline(lines[i])); i++ }
    if (i === startI) { para.push(inline(lines[i])); i++ } // 兜底:避免死循环
    html += `<p>${para.join('<br>')}</p>`
  }
  return html
}
